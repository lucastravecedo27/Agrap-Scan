// Listas que la app aprende por bodega (personas que reciben, labores): la primera vez
// se escribe completo y después basta con 2–3 letras para escogerlo.
// Se guardan en «ajustes» (entran solos en el respaldo) como [{nombre, usos, ultimo}].
// Una lista puede traer una base fija [{nombre, grupo}] que aparece sin haberse usado.

import * as db from './db.js';
import { h, vaciar, dialogo, aviso } from './ui.js';

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

/** Nombres que empiezan por el texto (por el nombre, cualquier otra palabra o el grupo). */
export function filtrar(lista, texto) {
  const t = normalizar(texto);
  if (!t) return lista.slice(0, MAX_SUGERENCIAS);
  const empiezaTodo = []; const empiezaPalabra = []; const empiezaGrupo = [];
  const enPalabras = (s) => normalizar(s).split(' ').some((pal) => pal.startsWith(t));
  for (const p of lista) {
    const n = normalizar(p.nombre);
    if (n.startsWith(t)) empiezaTodo.push(p);
    else if (enPalabras(p.nombre)) empiezaPalabra.push(p);
    else if (p.grupo && enPalabras(p.grupo)) empiezaGrupo.push(p);
  }
  return [...empiezaTodo, ...empiezaPalabra, ...empiezaGrupo].slice(0, MAX_SUGERENCIAS);
}

/**
 * Crea una lista aprendida. prefijo: clave en ajustes; formatearFn: cómo se escribe un
 * nombre nuevo; base: [{nombre, grupo}] que sale aunque no se haya usado; textos: rótulos;
 * enterPrimera: Enter toma la primera sugerencia (para listas cerradas como las labores).
 */
export function crearLista({ prefijo, formatear: formatearFn = formatear, base = [], textos, enterPrimera = false }) {
  const clave = (bodega) => `${prefijo}:${bodega}`;
  const grupoDe = new Map(base.map((b) => [normalizar(b.nombre), b.grupo || '']));
  const canonico = new Map(base.map((b) => [normalizar(b.nombre), b.nombre]));
  // Lo que coincide con la base (sin importar tildes ni mayúsculas) queda con la ortografía de la base.
  const escribir = (nombre) => { const f = formatearFn(nombre); return canonico.get(normalizar(f)) || f; };

  async function listar(bodega, { soloAprendidos = false } = {}) {
    const l = await db.ajuste(clave(bodega), []);
    const vistos = new Set(l.map((p) => normalizar(p.nombre)));
    const extra = soloAprendidos ? [] : base.filter((b) => !vistos.has(normalizar(b.nombre))).map((b) => ({ ...b, usos: 0, ultimo: '' }));
    return [...l.map((p) => ({ ...p, grupo: grupoDe.get(normalizar(p.nombre)) || '' })), ...extra]
      .sort((a, b) => b.usos - a.usos || (b.ultimo || '').localeCompare(a.ultimo || '') || a.nombre.localeCompare(b.nombre, 'es'));
  }

  /** Suma un uso (o lo crea) y devuelve el nombre tal como quedó guardado. */
  async function registrar(bodega, nombre) {
    const limpio = escribir(nombre);
    if (!limpio) return '';
    const l = await db.ajuste(clave(bodega), []);
    const ya = l.find((p) => normalizar(p.nombre) === normalizar(limpio));
    const ahora = new Date().toISOString();
    if (ya) { ya.usos += 1; ya.ultimo = ahora; } else l.push({ nombre: limpio, usos: 1, ultimo: ahora });
    await db.fijarAjuste(clave(bodega), l);
    return ya ? ya.nombre : limpio;
  }

  async function eliminar(bodega, nombre) {
    const l = await db.ajuste(clave(bodega), []);
    await db.fijarAjuste(clave(bodega), l.filter((p) => p.nombre !== nombre));
  }

  /**
   * Pantalla de elección: campo grande + sugerencias que se filtran al escribir.
   * Resuelve con el nombre escogido (ya registrado) o null si se cancela.
   */
  async function elegir(bodega, { titulo = textos.titulo, subtitulo = '', actual = '', sugerida = '' } = {}) {
    const lista = await listar(bodega);
    const input = h('input.persona-input', {
      type: 'text', value: actual, placeholder: textos.placeholder,
      autocomplete: 'off', autocorrect: 'off', autocapitalize: textos.mayusculas || 'words', spellcheck: false, enterkeyhint: 'done',
      'aria-label': textos.aria,
    });
    const sugerencias = h('div.persona-sugerencias', { role: 'listbox' });
    const nota = h('p.persona-nota');
    let cerrar;

    const confirmar = async (nombre) => {
      if (!escribir(nombre)) { aviso(textos.vacio, 'error'); input.focus(); return; }
      cerrar(await registrar(bodega, nombre));
    };
    const pintar = () => {
      const texto = input.value;
      const nuevo = escribir(texto);
      const exacto = lista.find((p) => normalizar(p.nombre) === normalizar(nuevo));
      const encontrados = filtrar(lista, texto);
      // Escrito completo pero con otra forma (mayúsculas, sin tildes, «al día»…): ese de primero.
      if (texto && exacto && !encontrados.includes(exacto)) encontrados.unshift(exacto);
      vaciar(sugerencias);
      // Lo mismo suele repetirse seguido: un toque o Enter sin escribir.
      if (sugerida && !texto) {
        sugerencias.append(h('button.persona-opcion.persona-misma', { type: 'button', onclick: () => confirmar(sugerida) },
          h('span', `↩ ${textos.mismo}: ${sugerida}`), h('small', 'Enter')));
      }
      for (const p of encontrados) {
        if (sugerida && !texto && p.nombre === sugerida) continue;
        sugerencias.append(h('button.persona-opcion', { type: 'button', role: 'option', onclick: () => confirmar(p.nombre) },
          h('span', p.nombre), h('small', p.usos ? `${p.usos} ${p.usos === 1 ? textos.uso : textos.usos}` : p.grupo)));
      }
      if (nuevo && !exacto) {
        sugerencias.append(h('button.persona-opcion.persona-nueva', { type: 'button', onclick: () => confirmar(nuevo) },
          h('span', `+ ${textos.nuevo}: ${nuevo}`), h('small', 'se guarda para la próxima')));
      }
      nota.textContent = !lista.length ? textos.primera
        : !texto ? textos.ayuda : (!encontrados.length ? textos.sinCoincidencias : '');
    };
    input.addEventListener('input', pintar);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!input.value.trim() && sugerida) { confirmar(sugerida); return; }
      // Enter: si lo escrito coincide con uno o hay una sola sugerencia, ese; si no, nuevo.
      const enc = filtrar(lista, input.value);
      const exacto = lista.find((p) => normalizar(p.nombre) === normalizar(escribir(input.value)));
      const tomar = enc.length && input.value.trim().length >= 2 && (enterPrimera || enc.length === 1);
      confirmar(exacto ? exacto.nombre : (tomar ? enc[0].nombre : input.value));
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

  return { listar, registrar, eliminar, elegir };
}

export const { listar, registrar, eliminar, elegir } = crearLista({
  prefijo: 'personas',
  textos: {
    titulo: '¿Quién recibe?', placeholder: 'Escriba el nombre…', aria: 'Nombre de quien recibe',
    vacio: 'Escriba el nombre de quien recibe.', mismo: 'Mismo', nuevo: 'Nueva', uso: 'entrega', usos: 'entregas',
    primera: 'Primera vez: escriba el nombre completo. La app lo recordará.',
    ayuda: 'Escriba las primeras letras o toque un nombre.',
    sinCoincidencias: 'No hay nadie con esas letras: se guardará como nuevo.',
  },
});
