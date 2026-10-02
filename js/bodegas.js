// Bodegas: alta, edición, desactivación, bodega activa, PIN de administrador y copia de catálogo.

import * as db from './db.js';
import { PIN_POR_DEFECTO, MINUTOS_ADMIN, RE_BODEGA } from './config.js';
import { pedirPin, aviso } from './ui.js';

// ---------- Bodegas ----------
export async function listar({ soloActivas = false } = {}) {
  const b = (await db.todos('bodegas')).sort((x, y) => x.codigo.localeCompare(y.codigo));
  return soloActivas ? b.filter((x) => x.activa !== false) : b;
}

export const obtener = (codigo) => db.get('bodegas', codigo);

export function normalizar(b) {
  return {
    codigo: String(b.codigo || '').trim().toUpperCase(),
    nombre: String(b.nombre || '').trim(),
    finca: String(b.finca || '').trim(),
    responsable: String(b.responsable || '').trim(),
    sociedad: String(b.sociedad || '').trim(),
  };
}

export function validar(b) {
  if (!RE_BODEGA.test(b.codigo)) return 'El código debe ser B seguido de 2 dígitos (B01, B02…).';
  if (!b.nombre) return 'Falta el nombre.';
  return null;
}

/** Crea o actualiza conservando consecutivo y estado. */
export async function guardar(datos, { nueva = false } = {}) {
  const b = normalizar(datos);
  const err = validar(b);
  if (err) throw new Error(err);
  const previa = await obtener(b.codigo);
  if (nueva && previa) throw new Error(`Ya existe la bodega ${b.codigo}.`);
  const reg = {
    ...previa,
    ...b,
    activa: datos.activa ?? previa?.activa ?? true,
    consecutivo: previa?.consecutivo ?? 0,
    creada: previa?.creada ?? new Date().toISOString(),
  };
  await db.put('bodegas', reg);
  return reg;
}

export async function fijarActiva(codigo, activa) {
  const b = await obtener(codigo);
  if (!b) return;
  b.activa = activa;
  await db.put('bodegas', b);
  if (!activa && (await bodegaActiva()) === codigo) {
    const otra = (await listar({ soloActivas: true }))[0];
    await db.fijarAjuste('bodegaActiva', otra ? otra.codigo : null);
  }
}

// ---------- Bodega activa ----------
export const bodegaActiva = () => db.ajuste('bodegaActiva', null);

export async function cambiarActiva(codigo) {
  const b = await obtener(codigo);
  if (!b || b.activa === false) throw new Error('Bodega no disponible.');
  await db.fijarAjuste('bodegaActiva', codigo);
  return b;
}

/** Garantiza que haya una bodega activa válida (la primera disponible si no). */
export async function asegurarActiva() {
  const actual = await bodegaActiva();
  const b = actual && (await obtener(actual));
  if (b && b.activa !== false) return b;
  const primera = (await listar({ soloActivas: true }))[0] || null;
  await db.fijarAjuste('bodegaActiva', primera ? primera.codigo : null);
  return primera;
}

// ---------- Copiar catálogo ----------
/**
 * Copia productos y destinos de una bodega a otra como punto de partida. Los que ya
 * existen en el destino (mismo código) NO se pisan: la otra bodega puede tener datos
 * distintos para el mismo producto.
 */
export async function copiarCatalogo(origen, destino) {
  if (origen === destino) throw new Error('Origen y destino son la misma bodega.');
  const [prods, dests, yaP, yaD] = await Promise.all([
    db.porIndice('productos', 'bodega', origen), db.porIndice('destinos', 'bodega', origen),
    db.porIndice('productos', 'bodega', destino), db.porIndice('destinos', 'bodega', destino),
  ]);
  const existeP = new Set(yaP.map((p) => p.codigo));
  const existeD = new Set(yaD.map((d) => d.codigo));
  const ahora = new Date().toISOString();
  const nuevosP = prods.filter((p) => !existeP.has(p.codigo))
    .map((p) => ({ ...p, id: `${destino}|${p.codigo}`, bodega: destino, creado: ahora }));
  const nuevosD = dests.filter((d) => !existeD.has(d.codigo))
    .map((d) => ({ ...d, id: `${destino}|${d.codigo}`, bodega: destino, creado: ahora }));
  await db.putVarios('productos', nuevosP);
  await db.putVarios('destinos', nuevosD);
  return { productos: nuevosP.length, destinos: nuevosD.length, omitidosP: prods.length - nuevosP.length, omitidosD: dests.length - nuevosD.length };
}

// ---------- PIN y modo administrador ----------
let _adminHasta = 0;

export const pinActual = () => db.ajuste('pin', PIN_POR_DEFECTO);
export async function pinEsPorDefecto() { return (await pinActual()) === PIN_POR_DEFECTO; }

export async function cambiarPin(nuevo) {
  if (!/^\d{4,8}$/.test(nuevo)) throw new Error('El PIN debe tener de 4 a 8 dígitos.');
  await db.fijarAjuste('pin', nuevo);
}

export const adminVigente = () => Date.now() < _adminHasta;
export const renovarAdmin = () => { if (adminVigente()) _adminHasta = Date.now() + MINUTOS_ADMIN * 60000; };
export const salirAdmin = () => { _adminHasta = 0; };

/** Pide el PIN si el modo administrador no está vigente. Resuelve true/false. */
export async function exigirAdmin(motivo = '') {
  if (adminVigente()) { renovarAdmin(); return true; }
  const pin = await pedirPin('PIN de administrador', motivo);
  if (pin == null) return false;
  if (pin !== (await pinActual())) { aviso('PIN incorrecto', 'error'); return false; }
  _adminHasta = Date.now() + MINUTOS_ADMIN * 60000;
  return true;
}

/** Siempre pide el PIN (acciones destructivas), aunque el modo admin esté vigente. */
export async function exigirPinSiempre(motivo = '') {
  const pin = await pedirPin('Confirme con el PIN', motivo);
  if (pin == null) return false;
  if (pin !== (await pinActual())) { aviso('PIN incorrecto', 'error'); return false; }
  return true;
}
