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
//
// En un PC (Chrome/Edge) el archivo se guarda SOLO en la carpeta de Drive que vigila
// Materiales (sincronizar): cada cambio reescribe el cuaderno. Antes de escribir se lee el
// que hay, y los renglones que Materiales ya selló («WO 493 · 03/10/2026») quedan cerrados
// aquí: lo contabilizado no se vuelve a tocar. Lo que no tiene sello se sigue corrigiendo.
// Cada renglón lleva su Id (columna propia, que Materiales ignora) para casar el sello.

import * as db from './db.js';
import * as bodegas from './bodegas.js';
import { hoy } from './ui.js';

export const DIAS_ARCHIVO = 45;
const SEPARADOR = '  ·  '; // el mismo de Materiales entre nombre y código
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidValido = (u) => RE_UUID.test(String(u || '').trim());

const COL_ID = 'Id Agrap Scan (NO TOCAR)';
const ENCABEZADOS = ['Fecha', 'N. de vale', 'Cantidad', 'Producto  (escoger de la lista)', 'Se carga a', 'Nota',
  'Codigo WO (automatico)', 'Unidad (automatico)', 'Contabilizada (NO ESCRIBIR)', 'Aviso de la app (NO ESCRIBIR)', COL_ID];
const idLinea = (l) => `${l.bodega}-${l.n}`;

const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = (i) => String.fromCharCode(65 + i); // A..K alcanzan
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
 * avisos: Id → texto que Materiales dejó en el archivo (se conserva al reescribirlo).
 */
export async function generar(bodega, { avisos = new Map(), vacio = false } = {}) {
  if (!window.JSZip) throw new Error('Falta la librería para crear el Excel. Abra la app una vez con internet.');
  const b = await bodegas.obtener(bodega);
  if (!uuidValido(b?.cuaderno)) {
    throw new Error(`La bodega ${bodega} no tiene el ID de su cuaderno en Materiales. La oficina lo pone en Oficina › Bodegas (sale en la hoja «Ficha (no tocar)» del cuaderno) y envía el catálogo.`);
  }
  const desde = new Date(Date.now() - DIAS_ARCHIVO * 864e5);
  const corte = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-${String(desde.getDate()).padStart(2, '0')}`;
  const lineas = (await db.porIndice('lineas', 'bodega', bodega)).filter((l) => l.fecha >= corte && l.fecha <= hoy())
    .sort((x, y) => x.fecha.localeCompare(y.fecha) || x.ts.localeCompare(y.ts) || x.n - y.n);
  if (!lineas.length && !vacio) throw new Error(`No hay salidas de ${bodega} en los últimos ${DIAS_ARCHIVO} días.`);

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
      celdaTexto(`I${r}`, l.sello || ''),
      celdaTexto(`J${r}`, l.sello ? '' : (avisos.get(idLinea(l)) || '')),
      celdaTexto(`K${r}`, idLinea(l)),
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
  zip.file('xl/worksheets/sheet1.xml', hoja(filas, [12, 14, 10, 52, 14, 34, 12, 10, 24, 30, 16]));
  zip.file('xl/worksheets/sheet2.xml', hoja(ficha, [22, 60]));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { nombre: `Salidas ${finca}.xlsx`, blob, lineas, nuevas: lineas.filter((l) => !l.exportado) };
}

/** Lo que fue al archivo queda exportado (ya no se edita en el teléfono). */
export async function marcar(lineas) {
  const ahora = new Date().toISOString();
  await db.tx('lineas', 'readwrite', (s) => { for (const l of lineas) if (!l.exportado) s.lineas.put({ ...l, exportado: 1, exportadoEn: ahora }); });
}

// ---------- PC: guardar solo en la carpeta que vigila Materiales ----------
// El aparato de la finca (portátil con Chrome o Edge) escoge UNA vez el archivo dentro de
// la carpeta de Drive que Materiales vigila. Desde ahí, cada cambio lo reescribe solo.
// El permiso del navegador se puede perder al cerrarlo: entonces se pide con un toque.

const claveArchivo = (bodega) => `archivoMateriales:${bodega}`;
export const puedeGuardarSolo = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;
const esManija = (x) => !!x && typeof x.queryPermission === 'function'; // un respaldo restaurado la pierde

export async function archivoDe(bodega) {
  const r = await db.ajuste(claveArchivo(bodega), null);
  return r && esManija(r.handle) ? r : null;
}

/** 'granted' | 'prompt' | 'denied' | null (sin archivo). */
export async function permiso(bodega) {
  const r = await archivoDe(bodega);
  if (!r) return null;
  try { return await r.handle.queryPermission({ mode: 'readwrite' }); } catch { return 'prompt'; }
}

/** Pide el permiso otra vez. Llamar SOLO desde un toque del usuario. */
export async function reconectar(bodega) {
  const r = await archivoDe(bodega);
  if (!r) return false;
  const ok = (await r.handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  if (ok) await sincronizar(bodega);
  return ok;
}

/** Escoger (o cambiar) el archivo. Llamar desde un toque del usuario. */
export async function elegirArchivo(bodega) {
  const b = await bodegas.obtener(bodega);
  if (!uuidValido(b?.cuaderno)) throw new Error(`La bodega ${bodega} no tiene el ID de su cuaderno en Materiales.`);
  const finca = (b.finca || b.nombre || bodega).trim().toUpperCase();
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: `Salidas ${finca} (Agrap Scan).xlsx`,
      types: [{ description: 'Cuaderno de salidas (Excel)', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
    });
  } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  // Antes de adoptarlo: si ya existe, tiene que ser de ESTA finca y no un cuaderno digitado a mano.
  const previo = await leerDeManija(handle);
  revisarAjeno(previo, b);
  await db.fijarAjuste(claveArchivo(bodega), { handle, nombre: handle.name, desde: new Date().toISOString() });
  return sincronizar(bodega);
}

export async function olvidarArchivo(bodega) { await db.del('ajustes', claveArchivo(bodega)); }

function revisarAjeno(previo, b) {
  if (!previo) return;
  if (previo.uuid && previo.uuid !== b.cuaderno) {
    throw new Error('Ese archivo es el cuaderno de OTRA finca en Materiales. Escoja otro nombre o la carpeta correcta.');
  }
  if (previo.ajenas) {
    throw new Error(`Ese archivo es un cuaderno digitado a mano (${previo.ajenas} renglón(es)). No se reemplaza: guarde con otro nombre, el sugerido «… (Agrap Scan).xlsx».`);
  }
}

async function leerDeManija(handle) {
  let f;
  try { f = await handle.getFile(); } catch { return null; } // no existe todavía
  if (!f.size) return null;
  return leerCuaderno(f);
}

/**
 * Lee el archivo (sellos y avisos de Materiales), cierra lo ya contabilizado y lo reescribe.
 * -> {estado:'ok'|'sin-archivo'|'sin-permiso', lineas, contabilizadas, avisos}
 * Uno a la vez (cola): dos escrituras cruzadas dejarían el archivo a medias.
 */
let cola = Promise.resolve();
export function sincronizar(bodega) {
  const r = cola.then(() => sincronizarYa(bodega));
  cola = r.catch(() => {});
  return r;
}

async function sincronizarYa(bodega) {
  const reg = await archivoDe(bodega);
  if (!reg) return { estado: 'sin-archivo' };
  if ((await reg.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') return { estado: 'sin-permiso' };
  try {
    const b = await bodegas.obtener(bodega);
    const previo = await leerDeManija(reg.handle).catch(() => null);
    revisarAjeno(previo, b);
    const ahora = new Date().toISOString();
    if (previo?.sellos.size) {
      const cambian = (await db.porIndice('lineas', 'bodega', bodega))
        .filter((l) => previo.sellos.has(idLinea(l)) && (l.sello !== previo.sellos.get(idLinea(l)) || !l.exportado));
      if (cambian.length) {
        await db.tx('lineas', 'readwrite', (s) => {
          for (const l of cambian) s.lineas.put({ ...l, sello: previo.sellos.get(idLinea(l)), exportado: 1, exportadoEn: l.exportadoEn || ahora });
        });
      }
    }
    const x = await generar(bodega, { avisos: previo?.avisos, vacio: true });
    const w = await reg.handle.createWritable();
    try { await w.write(x.blob); await w.close(); } catch (e) { await w.abort().catch(() => {}); throw e; }
    const res = {
      estado: 'ok', lineas: x.lineas.length, contabilizadas: x.lineas.filter((l) => l.sello).length,
      avisos: x.lineas.filter((l) => !l.sello && previo?.avisos.get(idLinea(l))).length,
    };
    await db.fijarAjuste(claveArchivo(bodega), { ...reg, ultima: ahora, ...res, error: null });
    return res;
  } catch (e) {
    await db.fijarAjuste(claveArchivo(bodega), { ...reg, error: e.message, errorEn: new Date().toISOString() });
    throw e;
  }
}

// Tras cada cambio se guarda a los pocos segundos (varios cambios seguidos = un guardado).
let temporizador = null;
const oyentes = new Set();
export const alSincronizar = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn); };
export function programar(bodega, ms = 2500) {
  if (!bodega || !puedeGuardarSolo()) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    let r;
    try { r = await sincronizar(bodega); } catch (e) { r = { estado: 'error', error: e.message }; }
    oyentes.forEach((fn) => { try { fn(bodega, r); } catch { /* una pantalla cerrada */ } });
  }, ms);
}

// ---------- Leer el cuaderno (lo que escribió Materiales encima) ----------
const normal = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const letrasAColumna = (ref) => { let n = 0; for (const c of ref.replace(/\d+$/, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

/**
 * Lee un .xlsx de cuaderno (el nuestro, o el mismo después de que Materiales lo selló con
 * openpyxl, que pasa los textos a sharedStrings). -> {uuid, sellos, avisos, ajenas}
 * ajenas = renglones con datos y sin Id de Agrap Scan: los digitados a mano en el cuaderno.
 */
export async function leerCuaderno(blob) {
  const zip = await window.JSZip.loadAsync(blob);
  const leerXml = async (ruta) => {
    const f = zip.file(ruta);
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
  };
  const porTag = (nodo, tag) => [...nodo.getElementsByTagNameNS('*', tag)];
  const compartidos = [];
  const ss = await leerXml('xl/sharedStrings.xml');
  if (ss) for (const si of porTag(ss, 'si')) compartidos.push(porTag(si, 't').map((t) => t.textContent).join(''));
  const wb = await leerXml('xl/workbook.xml');
  const rels = await leerXml('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('El archivo no es un Excel válido.');
  const destino = new Map(porTag(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const rutaHoja = (nombre) => {
    const s = porTag(wb, 'sheet').find((x) => x.getAttribute('name') === nombre);
    if (!s) return null;
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    const t = destino.get(rid) || '';
    return t.startsWith('/') ? t.slice(1) : `xl/${t}`;
  };
  const filas = async (nombre) => {
    const ruta = rutaHoja(nombre);
    const x = ruta ? await leerXml(ruta) : null;
    if (!x) return [];
    return porTag(x, 'row').map((row) => {
      const out = [];
      for (const c of porTag(row, 'c')) {
        const t = c.getAttribute('t');
        const v = porTag(c, 'v')[0]?.textContent ?? '';
        out[letrasAColumna(c.getAttribute('r'))] = t === 's' ? compartidos[Number(v)] ?? ''
          : t === 'inlineStr' ? porTag(c, 't').map((n) => n.textContent).join('') : v;
      }
      return out;
    });
  };
  const ficha = await filas('Ficha (no tocar)');
  const uuid = String(ficha.find((f) => normal(f[0]) === 'CUADERNO')?.[1] || '').trim().toLowerCase();
  const [cab = [], ...datos] = await filas('Salidas');
  const busca = (inicio) => cab.findIndex((t) => normal(t).startsWith(inicio));
  const cSello = busca('CONTABILIZADA'); const cAviso = busca('AVISO'); const cId = busca('ID AGRAP SCAN');
  const cProd = busca('PRODUCTO'); const cCant = busca('CANTIDAD');
  const sellos = new Map(); const avisos = new Map(); let ajenas = 0;
  for (const f of datos) {
    const id = cId >= 0 ? String(f[cId] || '').trim() : '';
    const sello = cSello >= 0 ? String(f[cSello] || '').trim() : '';
    const aviso = cAviso >= 0 ? String(f[cAviso] || '').trim() : '';
    if (id) { if (sello) sellos.set(id, sello); if (aviso) avisos.set(id, aviso); }
    else if ((cProd >= 0 && String(f[cProd] || '').trim()) || (cCant >= 0 && String(f[cCant] || '').trim())) ajenas++;
  }
  return { uuid, sellos, avisos, ajenas };
}
