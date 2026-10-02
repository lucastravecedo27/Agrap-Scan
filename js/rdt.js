// RDT (Reporte Diario Travecedo) de la jornada: se llena la plantilla real (plantillas/rdt.xlsx)
// escribiendo las celdas en su XML, así quedan intactas las fórmulas, tablas, validaciones y
// estilos. Una fila por persona y labor cerrada del día; las labores por lote van con sus
// lotes (hasta 4) y «Unidades a pagar» las suma con la fórmula de la plantilla.

import * as bodegas from './bodegas.js';
import * as empleados from './empleados.js';
import { RDT_FILA_INICIAL, RDT_LOTES, formatoCarne } from './config.js';
import { horaLocal, num } from './ui.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const colNum = (letras) => [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const partir = (ref) => { const m = ref.match(/^([A-Z]+)(\d+)$/); return [m[1], Number(m[2])]; };

/** Semana ISO y su año. */
export function semanaIso(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { anio: d.getUTCFullYear(), semana: Math.ceil(((d - inicio) / 86400000 + 1) / 7) };
}

// ---------- Escritura de celdas en el XML de una hoja ----------
function fila(doc, n) {
  const datos = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
  let antes = null;
  for (const r of datos.children) {
    const k = Number(r.getAttribute('r'));
    if (k === n) return r;
    if (k > n) { antes = r; break; }
  }
  const r = doc.createElementNS(NS, 'row'); r.setAttribute('r', String(n));
  datos.insertBefore(r, antes);
  return r;
}

function celda(doc, ref) {
  const [col, n] = partir(ref);
  const r = fila(doc, n);
  let antes = null;
  for (const c of r.children) {
    const cr = c.getAttribute('r');
    if (cr === ref) return c;
    if (colNum(partir(cr)[0]) > colNum(col)) { antes = c; break; }
  }
  const c = doc.createElementNS(NS, 'c'); c.setAttribute('r', ref);
  r.insertBefore(c, antes);
  return c;
}

const quitar = (c, nombres) => [...c.children].filter((x) => nombres.includes(x.localName)).forEach((x) => x.remove());

/** Escribe un valor. Número o texto; con conFormula conserva la fórmula y pone el valor calculado. */
function escribir(doc, ref, valor, { conFormula = false } = {}) {
  if (valor == null || valor === '') return;
  const c = celda(doc, ref);
  const esNumero = typeof valor === 'number' && Number.isFinite(valor);
  quitar(c, conFormula ? ['v', 'is'] : ['v', 'is', 'f']);
  if (esNumero) {
    c.removeAttribute('t');
    const v = doc.createElementNS(NS, 'v'); v.textContent = String(valor); c.append(v);
  } else {
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is'); const t = doc.createElementNS(NS, 't');
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.textContent = String(valor); is.append(t); c.append(is);
  }
}

function leer(doc, ref) {
  const c = [...doc.getElementsByTagNameNS(NS, 'c')].find((x) => x.getAttribute('r') === ref);
  if (!c) return '';
  return (c.getAttribute('t') === 'inlineStr' ? c.getElementsByTagNameNS(NS, 't')[0]?.textContent : c.getElementsByTagNameNS(NS, 'v')[0]?.textContent) || '';
}

const numOTexto = (s) => (/^\d+$/.test(String(s)) ? Number(s) : String(s));

// ---------- Armado ----------
async function hojas(zip) {
  const wb = new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml');
  const rels = new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml');
  const destino = Object.fromEntries([...rels.getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target').replace(/^\//, '')]));
  return Object.fromEntries([...wb.getElementsByTagNameNS(NS, 'sheet')].map((s) => {
    const ruta = destino[s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')];
    return [s.getAttribute('name'), ruta.startsWith('xl/') ? ruta : `xl/${ruta}`];
  }));
}

/**
 * Genera el RDT de una bodega y un día. jornadas: las cerradas de ese día.
 * -> {nombre, blob, filas, sinCodigo}
 */
export async function generar({ bodega, fecha, jornadas }) {
  if (!window.JSZip) throw new Error('Falta la librería para crear el Excel. Recargue la app con internet una vez.');
  const resp = await fetch('plantillas/rdt.xlsx');
  if (!resp.ok) throw new Error('No se encontró la plantilla del RDT.');
  const zip = await window.JSZip.loadAsync(await resp.arrayBuffer());
  const rutas = await hojas(zip);
  const abrir = async (nombre) => new DOMParser().parseFromString(await zip.file(rutas[nombre]).async('string'), 'application/xml');
  const [rdt, trab, archivo] = await Promise.all([abrir('RDT'), abrir('lista_trabajadores'), abrir('Archivo')]);

  // Código Agrosoft de la finca: de la hoja «Archivo» de la plantilla.
  const b = await bodegas.obtener(bodega);
  let codFinca = '';
  for (let r = 3; r < 130; r++) {
    const nombre = leer(archivo, `B${r}`);
    if (nombre && [b?.finca, b?.nombre].some((x) => sinTildes(x) === sinTildes(nombre))) { codFinca = leer(archivo, `A${r}`); break; }
  }
  const dia = new Date(`${fecha}T12:00:00`);
  const { anio, semana } = semanaIso(dia);
  const periodo = anio * 100 + Math.ceil(semana / 2);
  const aaaammdd = Number(fecha.replace(/-/g, ''));
  escribir(rdt, 'D4', codFinca);
  escribir(rdt, 'D6', periodo);
  escribir(rdt, 'D7', aaaammdd);
  escribir(rdt, 'D8', anio);
  escribir(rdt, 'D9', semana);

  const emps = await empleados.listar();
  const porCarne = new Map(emps.map((e) => [Number(e.carne), e]));
  const hhmm = (iso) => horaLocal(new Date(iso)).slice(0, 5);
  let sinCodigo = 0;
  const orden = [...jornadas].sort((x, y) => x.labor.localeCompare(y.labor, 'es') || x.nombre.localeCompare(y.nombre, 'es'));
  orden.forEach((j, i) => {
    const n = RDT_FILA_INICIAL + i;
    const e = porCarne.get(Number(j.carne)) || null;
    const codigo = e?.codigo || j.codigoEmpleado || '';
    if (!codigo) sinCodigo++;
    escribir(rdt, `C${n}`, codigo ? numOTexto(codigo) : null);
    escribir(rdt, `D${n}`, e?.nombre || j.nombre);
    // Horas de la labor: en labores por hora, las confirmadas; en las demás, las medidas.
    escribir(rdt, `H${n}`, Math.round((j.und === 'hora' ? j.real : j.horas) * 100) / 100);
    escribir(rdt, `J${n}`, numOTexto(j.codigoLabor));
    escribir(rdt, `K${n}`, j.labor);
    const lotes = (j.lotes || []).slice(0, RDT_LOTES.length);
    if (lotes.length) lotes.forEach((l, k) => { escribir(rdt, `${RDT_LOTES[k][0]}${n}`, numOTexto(l.lote)); escribir(rdt, `${RDT_LOTES[k][1]}${n}`, l.cantidad); });
    else escribir(rdt, `P${n}`, j.real);
    escribir(rdt, `L${n}`, lotes.length ? lotes.reduce((s, l) => s + l.cantidad, 0) : j.real, { conFormula: true });
    escribir(rdt, `AT${n}`, [`${hhmm(j.inicio)}–${hhmm(j.fin)} (${num(j.horas)} h medidas)`, `carné ${formatoCarne(j.carne)}`,
      codigo ? '' : 'SIN CÓDIGO: registrar en oficina'].filter(Boolean).join(' · '));
  });

  // Trabajadores de la finca, para que la fórmula del código sirva en filas agregadas a mano.
  emps.filter((e) => e.fincas.includes(bodega) && e.activo !== false).forEach((e, i) => {
    const n = 2 + i;
    escribir(trab, `A${n}`, numOTexto(e.codigo)); escribir(trab, `B${n}`, e.nombre); escribir(trab, `C${n}`, e.nombre);
    escribir(trab, `D${n}`, codFinca ? Number(codFinca) : ''); escribir(trab, `E${n}`, numOTexto(e.codigo));
  });

  const xml = (doc) => new XMLSerializer().serializeToString(doc);
  zip.file(rutas.RDT, xml(rdt));
  zip.file(rutas.lista_trabajadores, xml(trab));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const [y, m, d] = fecha.split('-').map(Number);
  const nombre = `RDT - ${b?.finca || bodega} - ${d}-${m}-${y} -${DIAS[dia.getDay()]} - ${semana} - ${periodo}.xlsx`;
  return { nombre, blob, filas: orden.length, sinCodigo };
}
