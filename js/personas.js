// Listas que la app aprende por bodega (personas que reciben, labores): la primera vez
// se escribe completo y después basta con 2–3 letras para escogerlo.
// Se guardan en «ajustes» (entran solos en el respaldo) como [{nombre, usos, ultimo}].
// Una lista puede traer una base fija de nombres que aparece sin haberse usado.
// Las sugerencias salen desde la 3.ª letra.

import * as db from './db.js';
import * as empleados from './empleados.js';
import { formatoCarne } from './config.js';
import { h, vaciar, dialogo, aviso } from './ui.js';

const MAX_SUGERENCIAS = 8;
export const MIN_LETRAS = 3;

/** Sin tildes, minúsculas: «Ñ» se conserva distinta de «N» porque cambia el nombre. */
export const normalizar = (s) => String(s || '').toLowerCase()
  .replace(/ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'ñ')
  .replace(/\s+/g, ' ').trim();

/** «juan  PÉREZ» → «Juan Pérez» */
export function formatear(nombre) {
  return String(nombre || '').replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, letra) => sep + letra.toUpperCase());
}

/** Nombres que empiezan por el texto (por el nombre o cualquier otra palabra), desde 3 letras. */
export function filtrar(lista, texto) {
  const t = normalizar(texto);
  if (t.length < MIN_LETRAS) return [];
  const empiezaTodo = []; const empiezaPalabra = [];
  for (const p of lista) {
    const n = normalizar(p.nombre);
    if (n.startsWith(t)) empiezaTodo.push(p);
    else if (n.split(' ').some((pal) => pal.startsWith(t))) empiezaPalabra.push(p);
  }
  return [...empiezaTodo, ...empiezaPalabra].slice(0, MAX_SUGERENCIAS);
}

/**
 * Crea una lista aprendida. prefijo: clave en ajustes; formatearFn: cómo se escribe un
 * nombre nuevo; base: nombres que salen aunque no se hayan usado; textos: rótulos;
 * enterPrimera: Enter toma la primera sugerencia (para listas cerradas como las labores);
 * cerrada: solo se escoge de la base, no se crean nombres nuevos; detalle(nombre): texto
 * corto a la derecha de cada opción. baseDe(bodega): base que depende de la bodega (p. ej.
 * sus empleados) -> [{nombre, detalle}].
 */
export function crearLista({ prefijo, formatear: formatearFn = formatear, base = [], baseDe = null, textos, enterPrimera = false, cerrada = false, detalle = null }) {
  const clave = (bodega) => `${prefijo}:${bodega}`;
  const canonico = new Map(base.map((n) => [normalizar(n), n]));
  const detalles = new Map();
  // Base fija + la de la bodega (se lee cada vez: los empleados cambian al recibirlos).
  async function cargarBase(bodega) {
    const extra = baseDe ? await baseDe(bodega) : [];
    for (const e of extra) { canonico.set(normalizar(e.nombre), e.nombre); if (e.detalle) detalles.set(e.nombre, e.detalle); }
    return [...base, ...extra.map((e) => e.nombre)];
  }
  // Lo que coincide con la base (sin importar tildes ni mayúsculas) queda con la ortografía de la base.
  const escribir = (nombre) => { const f = formatearFn(nombre); return canonico.get(normalizar(f)) || f; };

  async function listar(bodega, { soloAprendidos = false } = {}) {
    const l = await db.ajuste(clave(bodega), []);
    const todaBase = await cargarBase(bodega);
    const vistos = new Set(l.map((p) => normalizar(p.nombre)));
    const extra = soloAprendidos ? [] : todaBase.filter((n) => !vistos.has(normalizar(n))).map((nombre) => ({ nombre, usos: 0, ultimo: '' }));
    return [...l, ...extra]
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
      if (cerrada && !canonico.has(normalizar(escribir(nombre)))) { aviso(textos.sinCoincidencias, 'error'); input.focus(); return; }
      cerrar(await registrar(bodega, nombre));
    };
    const pintar = () => {
      const texto = input.value;
      const nuevo = escribir(texto);
      const exacto = lista.find((p) => normalizar(p.nombre) === normalizar(nuevo));
      const encontrados = filtrar(lista, texto);
      // Escrito completo pero con otra forma (mayúsculas, sin tildes, «al día»…): ese de primero.
      if (normalizar(texto).length >= MIN_LETRAS && exacto && !encontrados.includes(exacto)) encontrados.unshift(exacto);
      vaciar(sugerencias);
      // Lo mismo suele repetirse seguido: un toque o Enter sin escribir.
      if (sugerida && !texto) {
        sugerencias.append(h('button.persona-opcion.persona-misma', { type: 'button', onclick: () => confirmar(sugerida) },
          h('span', `↩ ${textos.mismo}: ${sugerida}`), h('small', 'Enter')));
      }
      for (const p of encontrados) {
        if (sugerida && !texto && p.nombre === sugerida) continue;
        sugerencias.append(h('button.persona-opcion', { type: 'button', role: 'option', onclick: () => confirmar(p.nombre) },
          h('span', p.nombre), h('small', detalle ? detalle(p.nombre) : [detalles.get(p.nombre), p.usos ? `${p.usos} ${p.usos === 1 ? textos.uso : textos.usos}` : ''].filter(Boolean).join(' · '))));
      }
      if (!cerrada && normalizar(texto).length >= MIN_LETRAS && nuevo && !exacto) {
        sugerencias.append(h('button.persona-opcion.persona-nueva', { type: 'button', onclick: () => confirmar(nuevo) },
          h('span', `+ ${textos.nuevo}: ${nuevo}`), h('small', 'se guarda para la próxima')));
      }
      const n = normalizar(texto).length;
      nota.textContent = !lista.length ? textos.primera : n < MIN_LETRAS ? textos.ayuda : (!encontrados.length ? textos.sinCoincidencias : '');
    };
    input.addEventListener('input', pintar);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!input.value.trim() && sugerida) { confirmar(sugerida); return; }
      // Enter: si lo escrito coincide con uno o hay una sola sugerencia, ese; si no, nuevo.
      const enc = filtrar(lista, input.value);
      const exacto = lista.find((p) => normalizar(p.nombre) === normalizar(escribir(input.value)));
      const tomar = enc.length && (enterPrimera || enc.length === 1);
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
  // Los empleados de la finca salen como sugerencia aunque nunca hayan recibido nada.
  baseDe: async (bodega) => (await empleados.deBodega(bodega)).filter((e) => e.activo !== false)
    .map((e) => ({ nombre: e.nombre, detalle: `cód. ${e.codigo}${e.carne ? ` · carné ${formatoCarne(e.carne)}` : ''}` })),
  textos: {
    titulo: '¿Quién recibe?', placeholder: 'Escriba el nombre…', aria: 'Nombre de quien recibe',
    vacio: 'Escriba el nombre de quien recibe.', mismo: 'Mismo', nuevo: 'Nueva', uso: 'entrega', usos: 'entregas',
    primera: 'Primera vez: escriba el nombre completo. La app lo recordará.',
    ayuda: 'Escriba 3 letras del nombre o apellido (salen los trabajadores de la finca).',
    sinCoincidencias: 'No hay nadie con esas letras: se guardará como nuevo.',
  },
});
