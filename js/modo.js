// Qué registra el teléfono ahora: salidas de bodega o personal (jornada). Se escoge al
// entrar a la finca; un usuario con un solo permiso entra directo a ese modo.

import * as db from './db.js';
import * as usuarios from './usuarios.js';
import { FUNCIONES } from './config.js';

export const MODOS = {
  salidas: { icono: '📦', nombre: 'Salidas de bodega', detalle: 'Materiales, cantidad y quién recibe', permiso: 'salidas' },
  personal: { icono: '👷', nombre: 'Personal (jornada)', detalle: 'Carnés: inicio y fin de labores', permiso: 'jornada' },
};

export async function disponibles() {
  const out = [];
  for (const [clave, m] of Object.entries(MODOS)) {
    if (clave === 'personal' && !FUNCIONES.jornada) continue; // apagado, no borrado
    if (await usuarios.permite(m.permiso)) out.push(clave);
  }
  return out;
}

export async function actual() {
  const d = await disponibles();
  const m = await db.ajuste('modo', d[0] || 'salidas');
  return d.includes(m) ? m : d[0] || 'salidas';
}

export const fijar = (m) => db.fijarAjuste('modo', m);
