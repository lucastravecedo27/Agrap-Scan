// Ingresos de personal nuevo. En la finca: carné en blanco + foto de la cédula + foto de la
// persona → archivo que se manda a la oficina (WhatsApp). En la oficina: se reciben, se
// registran con código, nombre y cédula, y vuelven a la finca en el catálogo.
//   ajustes.ingresos          finca:   [{id, carne, bodega, fecha, ts, fotoCedula, fotoPersona, registro, enviado}]
//   ajustes.ingresosOficina   oficina: los recibidos, pendientes de registrar

import * as db from './db.js';
import * as empleados from './empleados.js';
import { hoy } from './ui.js';

// ---------- Finca ----------
export const pendientes = async (bodega) => (await db.ajuste('ingresos', [])).filter((i) => !bodega || i.bodega === bodega);
export const deCarne = async (carne) => (await db.ajuste('ingresos', [])).find((i) => Number(i.carne) === Number(carne)) || null;

export async function crear({ carne, bodega, fotoCedula, fotoPersona, registro }) {
  const l = await db.ajuste('ingresos', []);
  const i = { id: `${bodega}-${carne}-${Date.now()}`, carne: Number(carne), bodega, fecha: hoy(), ts: new Date().toISOString(), fotoCedula, fotoPersona, registro, enviado: false };
  await db.fijarAjuste('ingresos', [...l.filter((x) => Number(x.carne) !== Number(carne)), i]);
  return i;
}

/** Archivo para la oficina con todos los ingresos de la bodega que siguen sin registrar. */
export async function archivo(bodega) {
  const l = await pendientes(bodega);
  return { app: 'agrap-salidas', tipo: 'ingresos', fecha: new Date().toISOString(), bodega, ingresos: l };
}

export async function marcarEnviados(ids) {
  const l = await db.ajuste('ingresos', []);
  await db.fijarAjuste('ingresos', l.map((i) => (ids.includes(i.id) ? { ...i, enviado: true } : i)));
}

/** Al recibir el catálogo: los carnés que la oficina ya registró dejan de estar pendientes. */
export async function depurar() {
  const asignados = new Set((await empleados.listar()).map((e) => Number(e.carne)));
  const l = await db.ajuste('ingresos', []);
  await db.fijarAjuste('ingresos', l.filter((i) => !asignados.has(Number(i.carne))));
}

// ---------- Oficina ----------
export const recibidos = () => db.ajuste('ingresosOficina', []);

export async function recibir(json) {
  if (!json || json.app !== 'agrap-salidas' || json.tipo !== 'ingresos' || !Array.isArray(json.ingresos)) {
    throw new Error('El archivo no es un envío de ingresos de Agrap (debe venir de Jornada › Enviar ingresos).');
  }
  const asignados = new Set((await empleados.listar()).map((e) => Number(e.carne)));
  const l = await recibidos();
  const ids = new Set(l.map((i) => i.id));
  const nuevos = json.ingresos.filter((i) => !ids.has(i.id) && !asignados.has(Number(i.carne)));
  await db.fijarAjuste('ingresosOficina', [...l, ...nuevos]);
  return { nuevos: nuevos.length, total: json.ingresos.length };
}

export async function registrar(id, { codigo, nombre, cedula }) {
  const l = await recibidos();
  const i = l.find((x) => x.id === id);
  if (!i) throw new Error('El ingreso ya no está.');
  const e = await empleados.registrar({ codigo, nombre, cedula, finca: i.bodega, carne: i.carne, fotos: { cedula: i.fotoCedula, persona: i.fotoPersona } });
  await db.fijarAjuste('ingresosOficina', l.filter((x) => x.id !== id));
  return e;
}

export async function descartar(id) {
  await db.fijarAjuste('ingresosOficina', (await recibidos()).filter((x) => x.id !== id));
}
