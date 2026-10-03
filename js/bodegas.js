// Bodegas: alta, edición, desactivación, bodega activa, PIN de administrador y copia de catálogo.

import * as db from './db.js';
import { PIN_POR_DEFECTO, MINUTOS_ADMIN, RE_BODEGA } from './config.js';
import { pedirPin, aviso, informar } from './ui.js';
import { sha256 } from './usuarios.js';

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
    // ID del cuaderno de salidas de esta finca en la app Materiales (hoja «Ficha (no tocar)»)
    cuaderno: String(b.cuaderno || '').trim().toLowerCase(),
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

// El PIN se guarda cifrado (sal + SHA-256), nunca como texto: ajustes.pinSeguro {sal, hash}.
// Los teléfonos que venían con el PIN en texto (ajustes.pin) se pasan al cifrado la primera
// vez que se ingresa bien. Tras MAX_FALLOS intentos errados se bloquea un rato que va creciendo.
const MAX_FALLOS = 5;
const SEG_BLOQUEO = 60;

async function cifrarPin(sal, pin) {
  const datos = new TextEncoder().encode(`pin:${sal}:${pin}`);
  const buf = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', datos)) : sha256(datos);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const nuevaSal = () => [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function guardarPin(pin) {
  const sal = nuevaSal();
  await db.fijarAjuste('pinSeguro', { sal, hash: await cifrarPin(sal, pin) });
  await db.del('ajustes', 'pin'); // borra el viejo en texto
}

/** ¿El PIN escrito es el correcto? (sin contar intentos) */
async function pinCorrecto(pin) {
  const seguro = await db.ajuste('pinSeguro', null);
  if (seguro) return (await cifrarPin(seguro.sal, pin)) === seguro.hash;
  const viejo = await db.ajuste('pin', PIN_POR_DEFECTO);
  if (pin !== viejo) return false;
  if (viejo !== PIN_POR_DEFECTO) await guardarPin(pin); // migración al cifrado
  return true;
}

export async function pinEsPorDefecto() {
  if (await db.ajuste('pinSeguro', null)) return false;
  return (await db.ajuste('pin', PIN_POR_DEFECTO)) === PIN_POR_DEFECTO;
}

/** PIN obvio que no se acepta: 1234, 0000, 1111, 4321, 2580… */
function pinDebil(p) {
  if (/^(\d)\1+$/.test(p)) return true;
  const sube = '01234567890'; const baja = '09876543210';
  return sube.includes(p) || baja.includes(p) || ['2580', '0852', '1212', '1004', '2000', '1122'].includes(p);
}

export async function cambiarPin(nuevo) {
  if (!/^\d{4,8}$/.test(nuevo)) throw new Error('El PIN debe tener de 4 a 8 dígitos.');
  if (pinDebil(nuevo)) throw new Error('Ese PIN es muy fácil de adivinar (seguidos o repetidos). Escoja otro.');
  await guardarPin(nuevo);
}

/** Verifica contando intentos. -> true / false (y avisa el motivo). */
async function verificar(pin) {
  const bloqueo = await db.ajuste('pinBloqueo', { fallos: 0, hasta: 0 });
  if (Date.now() < bloqueo.hasta) {
    aviso(`Demasiados intentos. Espere ${Math.ceil((bloqueo.hasta - Date.now()) / 1000)} s.`, 'error', 4000);
    return false;
  }
  if (await pinCorrecto(pin)) { await db.fijarAjuste('pinBloqueo', { fallos: 0, hasta: 0 }); return true; }
  const fallos = bloqueo.fallos + 1;
  const extra = fallos >= MAX_FALLOS ? SEG_BLOQUEO * (fallos - MAX_FALLOS + 1) * 1000 : 0;
  await db.fijarAjuste('pinBloqueo', { fallos, hasta: extra ? Date.now() + extra : 0 });
  aviso(extra ? `PIN incorrecto. Bloqueado ${extra / 1000} s.` : `PIN incorrecto (${fallos} de ${MAX_FALLOS}).`, 'error', 4000);
  return false;
}

/** Con el PIN de fábrica no se sigue: hay que poner uno propio (una sola vez por aparato). */
async function obligarCambio() {
  if (!(await pinEsPorDefecto())) return true;
  await informar('Cambie el PIN', 'Este aparato todavía tiene el PIN de fábrica (1234), que cualquiera conoce. Escoja uno propio de 4 a 8 dígitos para continuar.');
  for (;;) {
    const a = await pedirPin('Nuevo PIN', 'De 4 a 8 dígitos, que no sean seguidos ni repetidos.');
    if (a == null) return false;
    const b = await pedirPin('Repita el nuevo PIN');
    if (b == null) return false;
    if (a !== b) { aviso('Los PIN no coinciden. Intente otra vez.', 'error'); continue; }
    try { await cambiarPin(a); aviso('PIN guardado', 'ok'); return true; } catch (e) { aviso(e.message, 'error', 5000); }
  }
}

export const adminVigente = () => Date.now() < _adminHasta;
export const renovarAdmin = () => { if (adminVigente()) _adminHasta = Date.now() + MINUTOS_ADMIN * 60000; };
export const salirAdmin = () => { _adminHasta = 0; };

/** Pide el PIN si el modo administrador no está vigente. Resuelve true/false. */
export async function exigirAdmin(motivo = '') {
  if (adminVigente()) { renovarAdmin(); return true; }
  const pin = await pedirPin('PIN de administrador', motivo);
  if (pin == null) return false;
  if (!(await verificar(pin))) return false;
  if (!(await obligarCambio())) return false;
  _adminHasta = Date.now() + MINUTOS_ADMIN * 60000;
  return true;
}

/** Siempre pide el PIN (acciones destructivas), aunque el modo admin esté vigente. */
export async function exigirPinSiempre(motivo = '') {
  const pin = await pedirPin('Confirme con el PIN', motivo);
  if (pin == null) return false;
  return verificar(pin);
}
