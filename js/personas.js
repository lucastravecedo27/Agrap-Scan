// Personas que reciben el material. La app va aprendiendo los nombres por bodega: la
// primera vez se escribe completo y después basta con 2–3 letras para escogerlo.
// Se guardan en «ajustes» (entran solos en el respaldo) como [{nombre, usos, ultimo}].

import * as db from './db.js';
import { h, vaciar, dialogo, aviso } from './ui.js';

const clave = (bodega) => `personas:${bodega}`;
const MAX_SUGERENCIAS = 8;

/** Sin tildes, minúsculas: «Ñ» se conserva distinta de «N» porque cambia el nombre. */
export const normalizar = (s) => String(s || '').toLowerCase()
  .replace(/ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'ñ')
  .replace(/\s+/g, ' ').trim();

/** «juan  PÉREZ» → «Juan Pérez» */
export function formatear(nombre) {
  return String(nombre || '').replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, letra) => sep + letra.toUpperCase());
}

export async function listar(bodega) {
  const l = await db.ajuste(clave(bodega), []);
  return [...l].sort((a, b) => b.usos - a.usos || (b.ultimo || '').localeCompare(a.ultimo || ''));
}

/** Nombres que empiezan por el texto (por el nombre o por cualquier apellido). */
export function filtrar(lista, texto) {
  const t = normalizar(texto);
  if (!t) return lista.slice(0, MAX_SUGERENCIAS);
  const empiezaTodo = []; const empiezaPalabra = [];
  for (const p of lista) {
    const n = normalizar(p.nombre);
    if (n.startsWith(t)) empiezaTodo.push(p);
    else if (n.split(' ').some((pal) => pal.startsWith(t))) empiezaPalabra.push(p);
  }
  return [...empiezaTodo, ...empiezaPalabra].slice(0, MAX_SUGERENCIAS);
}

/** Suma un uso (o crea la persona) y devuelve el nombre tal como quedó guardado. */
export async function registrar(bodega, nombre) {
  const limpio = formatear(nombre);
  if (!limpio) return '';
  const l = await db.ajuste(clave(bodega), []);
  const ya = l.find((p) => normalizar(p.nombre) === normalizar(limpio));
  const ahora = new Date().toISOString();
  if (ya) { ya.usos += 1; ya.ultimo = ahora; } else l.push({ nombre: limpio, usos: 1, ultimo: ahora });
  await db.fijarAjuste(clave(bodega), l);
  return ya ? ya.nombre : limpio;
}

export async function eliminar(bodega, nombre) {
  const l = await db.ajuste(clave(bodega), []);
  await db.fijarAjuste(clave(bodega), l.filter((p) => p.nombre !== nombre));
}

/**
 * Pantalla «¿Quién recibe?»: campo grande + sugerencias que se filtran al escribir.
 * Resuelve con el nombre escogido (ya registrado) o null si se cancela.
 */
export async function elegir(bodega, { titulo = '¿Quién recibe?', subtitulo = '', actual = '', sugerida = '' } = {}) {
  const lista = await listar(bodega);
  const input = h('input.persona-input', {
    type: 'text', value: actual, placeholder: 'Escriba el nombre…',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'words', spellcheck: false, enterkeyhint: 'done',
    'aria-label': 'Nombre de quien recibe',
  });
  const sugerencias = h('div.persona-sugerencias', { role: 'listbox' });
  const nota = h('p.persona-nota');
  let cerrar;

  const confirmar = async (nombre) => {
    if (!formatear(nombre)) { aviso('Escriba el nombre de quien recibe.', 'error'); input.focus(); return; }
    cerrar(await registrar(bodega, nombre));
  };
  const pintar = () => {
    const texto = input.value;
    const encontrados = filtrar(lista, texto);
    vaciar(sugerencias);
    // La misma persona suele recibir varias cosas seguidas: un toque o Enter sin escribir.
    if (sugerida && !texto) {
      sugerencias.append(h('button.persona-opcion.persona-misma', { type: 'button', onclick: () => confirmar(sugerida) },
        h('span', `↩ Mismo: ${sugerida}`), h('small', 'Enter')));
    }
    for (const p of encontrados) {
      if (sugerida && !texto && p.nombre === sugerida) continue;
      sugerencias.append(h('button.persona-opcion', { type: 'button', role: 'option', onclick: () => confirmar(p.nombre) },
        h('span', p.nombre), h('small', `${p.usos} entrega${p.usos === 1 ? '' : 's'}`)));
    }
    const nuevo = formatear(texto);
    const existe = lista.some((p) => normalizar(p.nombre) === normalizar(nuevo));
    if (nuevo && !existe) {
      sugerencias.append(h('button.persona-opcion.persona-nueva', { type: 'button', onclick: () => confirmar(nuevo) },
        h('span', `+ Nueva: ${nuevo}`), h('small', 'se guarda para la próxima')));
    }
    nota.textContent = !lista.length ? 'Primera vez: escriba el nombre completo. La app lo recordará.'
      : !texto ? 'Escriba las primeras letras o toque un nombre.' : (!encontrados.length ? 'No hay nadie con esas letras: se guardará como nuevo.' : '');
  };
  input.addEventListener('input', pintar);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!input.value.trim() && sugerida) { confirmar(sugerida); return; }
    // Enter: si lo escrito coincide con alguien o hay una sola sugerencia, ese; si no, nuevo.
    const enc = filtrar(lista, input.value);
    const exacto = lista.find((p) => normalizar(p.nombre) === normalizar(input.value));
    confirmar(exacto ? exacto.nombre : (enc.length === 1 && input.value.trim().length >= 2 ? enc[0].nombre : input.value));
  });
  pintar();

  return dialogo({
    titulo, clase: 'dialogo-persona',
    contenido: h('div', subtitulo ? h('p.persona-sub', subtitulo) : null, input, nota, sugerencias),
    botones: [
      { texto: 'Cancelar', valor: null },
      { texto: 'Aceptar', clase: 'primario', valor: () => undefined, antes: async () => { await confirmar(input.value); return false; } },
    ],
    alAbrir: (caja, c) => { cerrar = c; setTimeout(() => input.focus(), 60); },
  });
}
