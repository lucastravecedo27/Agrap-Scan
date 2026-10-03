// Excel para la app Materiales: reemplaza el cuaderno de salidas que hoy se digita a mano.
//
// Materiales (core/salidas.py) lee un cuaderno por finca: un .xlsx con la hoja «Salidas»
// (columnas por TÍTULO) y la hoja «Ficha (no tocar)» con el ID del cuaderno. Este módulo
// arma ESE MISMO archivo con lo registrado en Agrap Scan, así Materiales lo procesa sin
// ningún cambio: bandeja, sello, huella y archivo plano de WorldOffice como siempre.
//
// Reglas que lo hacen seguro:
//  - El ID del cuaderno es el de la finca en Materiales (Oficina › Bodegas): sin él no se
//    genera, porque un cuaderno desconocido Materiales lo rechaza (y debe).
//  - Cada archivo trae los últimos DIAS_ARCHIVO días, en orden fijo. Si un día no se
//    procesó, el siguiente archivo trae esas filas; lo ya contabilizado Materiales lo
//    salta por su huella (fecha, vale, código, cantidad, centro, nota).
//  - Las filas no cambian de contenido entre un archivo y otro (misma huella): por eso lo
//    que va al archivo queda marcado como exportado y ya no se edita en el teléfono.

import * as db from './db.js';
import * as bodegas from './bodegas.js';
import { hoy } from './ui.js';

export const DIAS_ARCHIVO = 45;
const SEPARADOR = '  ·  '; // el mismo de Materiales entre nombre y código
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidValido = (u) => RE_UUID.test(String(u || '').trim());

const ENCABEZADOS = ['Fecha', 'N. de vale', 'Cantidad', 'Producto  (escoger de la lista)', 'Se carga a', 'Nota',
  'Codigo WO (automatico)', 'Unidad (automatico)', 'Contabilizada (NO ESCRIBIR)', 'Aviso de la app (NO ESCRIBIR)'];

const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = (i) => String.fromCharCode(65 + i); // A..J alcanzan
const serialExcel = (iso) => { const [a, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); };

function celdaTexto(ref, v, s = 0) { return v === '' || v == null ? '' : `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`; }
function celdaNum(ref, v, s = 0) { return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`; }

function hoja(filas, anchos) {
  const cols = anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${filas.join('')}</sheetData></worksheet>`;
}

/** Lo que va a la nota: quién recibió (va al detalle del documento de WorldOffice). */
const nota = (l) => (l.recibe ? `Recibe: ${l.recibe}${l.recibeCodigo ? ` (${l.recibeCodigo})` : ''}` : '');

/**
 * Arma el .xlsx de la bodega. -> {nombre, blob, lineas, nuevas}
 * Lanza error si la bodega no tiene el ID del cuaderno de Materiales.
 */
export async function generar(bodega) {
  if (!window.JSZip) throw new Error('Falta la librería para crear el Excel. Abra la app una vez con internet.');
  const b = await bodegas.obtener(bodega);
  if (!uuidValido(b?.cuaderno)) {
    throw new Error(`La bodega ${bodega} no tiene el ID de su cuaderno en Materiales. La oficina lo pone en Oficina › Bodegas (sale en la hoja «Ficha (no tocar)» del cuaderno) y envía el catálogo.`);
  }
  const desde = new Date(Date.now() - DIAS_ARCHIVO * 864e5);
  const corte = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-${String(desde.getDate()).padStart(2, '0')}`;
  const lineas = (await db.porIndice('lineas', 'bodega', bodega)).filter((l) => l.fecha >= corte && l.fecha <= hoy())
    .sort((x, y) => x.fecha.localeCompare(y.fecha) || x.ts.localeCompare(y.ts) || x.n - y.n);
  if (!lineas.length) throw new Error(`No hay salidas de ${bodega} en los últimos ${DIAS_ARCHIVO} días.`);

  const finca = (b.finca || b.nombre || '').trim().toUpperCase();
  const filas = [`<row r="1">${ENCABEZADOS.map((t, i) => celdaTexto(`${col(i)}1`, t, 2)).join('')}</row>`];
  lineas.forEach((l, i) => {
    const r = i + 2;
    // «Se carga a» vacío = esta misma finca (como se llena el cuaderno hoy); otra finca solo si el despacho la tenía.
    const otra = l.finca && l.finca.trim().toUpperCase() !== finca ? l.finca.trim() : '';
    filas.push(`<row r="${r}">${[
      celdaNum(`A${r}`, serialExcel(l.fecha), 1),
      celdaTexto(`B${r}`, l.despacho),
      celdaNum(`C${r}`, l.cantidad),
      celdaTexto(`D${r}`, `${l.producto}${SEPARADOR}${l.codigo}`),
      celdaTexto(`E${r}`, otra),
      celdaTexto(`F${r}`, nota(l)),
      celdaTexto(`G${r}`, l.codigo),
      celdaTexto(`H${r}`, l.unidad),
    ].join('')}</row>`);
  });
  const ficha = [
    ['Cuaderno', b.cuaderno.trim()], ['Finca / bodega', finca], ['Sociedad', b.sociedad || ''],
    ['Creado', new Date().toLocaleDateString('es-CO')], ['', ''],
    ['Origen', `Agrap Scan · últimos ${DIAS_ARCHIVO} días · ${lineas.length} salida(s)`],
    ['Para qué sirve', 'Con esto Materiales reconoce el cuaderno de la finca. No lo borre.'],
  ].map(([a, v], i) => `<row r="${i + 1}">${celdaTexto(`A${i + 1}`, a, 2)}${celdaTexto(`B${i + 1}`, v)}</row>`);

  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Salidas" sheetId="1" r:id="rId1"/><sheet name="Ficha (no tocar)" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  // Estilos: 0 normal · 1 fecha dd/mm/aaaa · 2 títulos en negrilla
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf xfId="0"/><xf numFmtId="164" xfId="0" applyNumberFormat="1"/><xf fontId="1" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', hoja(filas, [12, 14, 10, 52, 14, 34, 12, 10, 24, 30]));
  zip.file('xl/worksheets/sheet2.xml', hoja(ficha, [22, 60]));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { nombre: `Salidas ${finca}.xlsx`, blob, lineas, nuevas: lineas.filter((l) => !l.exportado) };
}

/** Lo que fue al archivo queda exportado (ya no se edita en el teléfono). */
export async function marcar(lineas) {
  const ahora = new Date().toISOString();
  await db.tx('lineas', 'readwrite', (s) => { for (const l of lineas) if (!l.exportado) s.lineas.put({ ...l, exportado: 1, exportadoEn: ahora }); });
}
