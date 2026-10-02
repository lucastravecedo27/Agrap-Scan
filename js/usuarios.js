// Usuarios que digitan en la finca. La oficina los crea, les asigna fincas y los manda en
// el catálogo; en el teléfono cada usuario solo ve sus fincas. Sin usuarios creados la app
// funciona abierta, como antes. La contraseña nunca se guarda: solo sal + SHA-256.
//   ajustes.usuarios  [{usuario, nombre, sal, hash, fincas: ['B01'], activo}]
//   ajustes.sesion    {usuario, nombre, fincas}

import * as db from './db.js';

const normalizarUsuario = (u) => String(u || '').trim().toLowerCase().replace(/\s+/g, '');

async function cifrar(sal, clave) {
  if (!crypto?.subtle) throw new Error('Este navegador no permite contraseñas (abra la app por https).');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sal}:${clave}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const nuevaSal = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const listar = async () => (await db.ajuste('usuarios', [])).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
export const hayUsuarios = async () => (await listar()).some((u) => u.activo !== false);

/** Crea o actualiza. clave vacía al editar = se conserva la anterior. */
export async function guardar({ usuario, nombre, clave = '', fincas = [], activo = true }, { nuevo = false } = {}) {
  const u = normalizarUsuario(usuario);
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new Error('El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes.');
  if (!String(nombre || '').trim()) throw new Error('Falta el nombre de la persona.');
  if (!fincas.length) throw new Error('Asigne al menos una finca.');
  const l = await db.ajuste('usuarios', []);
  const previo = l.find((x) => x.usuario === u);
  if (nuevo && previo) throw new Error(`Ya existe el usuario «${u}».`);
  if (!previo && clave.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  if (clave && clave.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  const reg = { ...previo, usuario: u, nombre: String(nombre).trim(), fincas: [...new Set(fincas)].sort(), activo };
  if (clave) { reg.sal = nuevaSal(); reg.hash = await cifrar(reg.sal, clave); }
  await db.fijarAjuste('usuarios', [...l.filter((x) => x.usuario !== u), reg]);
  return reg;
}

export async function eliminar(usuario) {
  await db.fijarAjuste('usuarios', (await db.ajuste('usuarios', [])).filter((x) => x.usuario !== usuario));
}

/** Los usuarios que tienen alguna de las bodegas (para el catálogo que se manda). */
export async function paraBodegas(codigos) {
  return (await db.ajuste('usuarios', [])).filter((u) => u.fincas.some((f) => codigos.includes(f)));
}

/** La finca recibe la lista de la oficina tal cual; la sesión sigue si el usuario aún existe. */
export async function recibir(lista) {
  if (!Array.isArray(lista)) return;
  await db.fijarAjuste('usuarios', lista.map((u) => ({ ...u, usuario: normalizarUsuario(u.usuario) })));
  const s = await sesion();
  if (!s) return;
  const u = lista.find((x) => x.usuario === s.usuario && x.activo !== false);
  await db.fijarAjuste('sesion', u ? { usuario: u.usuario, nombre: u.nombre, fincas: u.fincas } : null);
}

// ---------- Sesión en el teléfono ----------
export const sesion = () => db.ajuste('sesion', null);

/** -> sesión o lanza error con el motivo. */
export async function ingresar(usuario, clave) {
  const u = (await db.ajuste('usuarios', [])).find((x) => x.usuario === normalizarUsuario(usuario));
  if (!u || u.activo === false || (await cifrar(u.sal, clave)) !== u.hash) throw new Error('Usuario o contraseña incorrectos.');
  const s = { usuario: u.usuario, nombre: u.nombre, fincas: u.fincas };
  await db.fijarAjuste('sesion', s);
  return s;
}

export const salir = () => db.fijarAjuste('sesion', null);

/** Bodegas que puede ver este teléfono: null = todas (no hay usuarios creados). */
export async function fincasPermitidas() {
  if (!(await hayUsuarios())) return null;
  const s = await sesion();
  return s ? s.fincas : [];
}
