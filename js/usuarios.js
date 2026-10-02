// Usuarios que digitan en la finca. La oficina los crea, les asigna fincas y los manda en
// el catálogo; en el teléfono cada usuario solo ve sus fincas. Sin usuarios creados la app
// funciona abierta, como antes. La contraseña nunca se guarda: solo sal + SHA-256.
//   ajustes.usuarios  [{usuario, nombre, sal, hash, fincas: ['B01'], permisos: {salidas, jornada}, activo}]
//   ajustes.sesion    {usuario, nombre, fincas, permisos}

import * as db from './db.js';

const normalizarUsuario = (u) => String(u || '').trim().toLowerCase().replace(/\s+/g, '');

async function cifrar(sal, clave) {
  const datos = new TextEncoder().encode(`${sal}:${clave}`);
  // crypto.subtle solo existe con https o localhost; la oficina puede abrir la página por
  // http en la red local o desde el disco: ahí se usa la misma función escrita en JS.
  const buf = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', datos)) : sha256(datos);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 (FIPS 180-4) para navegadores sin crypto.subtle. */
export function sha256(bytes) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const largo = Math.ceil((bytes.length + 9) / 64) * 64;
  const m = new Uint8Array(largo);
  m.set(bytes); m[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(largo - 8, Math.floor(bits / 2 ** 32)); dv.setUint32(largo - 4, bits >>> 0);
  const W = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < largo; i += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rot(W[t - 15], 7) ^ rot(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rot(W[t - 2], 17) ^ rot(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  H.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
}

const nuevaSal = () => [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const listar = async () => (await db.ajuste('usuarios', [])).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
export const hayUsuarios = async () => (await listar()).some((u) => u.activo !== false);

/** -> mensaje de error o null. Se usa también en el formulario para no cerrarlo. */
export async function validar({ usuario, nombre, clave = '', fincas = [], permisos = { salidas: true, jornada: true } }, { nuevo = false } = {}) {
  const u = normalizarUsuario(usuario);
  if (!String(nombre || '').trim()) return 'Falta el nombre de la persona.';
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return 'El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes.';
  if (nuevo && (await db.ajuste('usuarios', [])).some((x) => x.usuario === u)) return `Ya existe el usuario «${u}».`;
  if ((nuevo || clave) && clave.length < 4) return 'La contraseña debe tener al menos 4 caracteres.';
  if (!fincas.length) return 'Marque al menos una finca.';
  if (!permisos.salidas && !permisos.jornada) return 'Marque al menos un permiso: salidas o jornada.';
  return null;
}

/** Crea o actualiza. clave vacía al editar = se conserva la anterior. */
export async function guardar({ usuario, nombre, clave = '', fincas = [], permisos = { salidas: true, jornada: true }, activo = true }, { nuevo = false } = {}) {
  const error = await validar({ usuario, nombre, clave, fincas, permisos }, { nuevo });
  if (error) throw new Error(error);
  const u = normalizarUsuario(usuario);
  const l = await db.ajuste('usuarios', []);
  const previo = l.find((x) => x.usuario === u);
  const reg = { ...previo, usuario: u, nombre: String(nombre).trim(), fincas: [...new Set(fincas)].sort(), permisos, activo };
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
  await db.fijarAjuste('sesion', u ? sesionDe(u) : null);
}

// ---------- Sesión en el teléfono ----------
const sesionDe = (u) => ({ usuario: u.usuario, nombre: u.nombre, fincas: u.fincas, permisos: u.permisos || { salidas: true, jornada: true } });

/** ¿Puede este teléfono hacer 'salidas' o 'jornada'? Sin usuarios creados, todo. */
export async function permite(tipo) {
  if (!(await hayUsuarios())) return true;
  const s = await sesion();
  return !!s && (s.permisos?.[tipo] ?? true);
}

export const sesion = () => db.ajuste('sesion', null);

/** -> sesión o lanza error con el motivo. */
export async function ingresar(usuario, clave) {
  const u = (await db.ajuste('usuarios', [])).find((x) => x.usuario === normalizarUsuario(usuario));
  if (!u || u.activo === false || (await cifrar(u.sal, clave)) !== u.hash) throw new Error('Usuario o contraseña incorrectos.');
  const s = sesionDe(u);
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
