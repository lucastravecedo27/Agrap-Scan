// Interfaz común: crear elementos, diálogos, avisos, sonido, vibración y formatos.
// Ningún otro módulo toca alert/confirm/prompt: en una PWA de iOS bloquean y se ven mal.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** h('div.clase#id', {atributos, onclick}, hijos…) */
export function h(tag, attrs = {}, ...hijos) {
  const [, nombre, resto] = tag.match(/^([a-z0-9]+)?(.*)$/i);
  const e = document.createElement(nombre || 'div');
  (resto.match(/[.#][^.#]+/g) || []).forEach((p) => {
    if (p[0] === '.') e.classList.add(p.slice(1)); else e.id = p.slice(1);
  });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { hijos.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') { if (v) e.classList.add(...String(v).split(/\s+/).filter(Boolean)); }
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const vaciar = (e) => { while (e.firstChild) e.firstChild.remove(); return e; };

// ---------- Formatos ----------
export const hoy = () => fechaLocal(new Date());
export function fechaLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function horaLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function fechaLarga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
/** Número con coma decimal, como se escribe en Colombia. */
export function num(n) {
  if (n == null || n === '' || isNaN(n)) return '';
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

// ---------- Avisos ----------
let _toastTimer;
export function aviso(texto, tipo = 'info', ms = 3500) {
  let t = $('#toast');
  if (!t) { t = h('div#toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.className = `toast ${tipo}`;
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Diálogos ----------
/**
 * Abre un diálogo modal. contenido: Node. botones: [{texto, clase, valor}].
 * Resuelve con el valor del botón pulsado (o null si se cierra).
 */
export function dialogo({ titulo, contenido, botones = [{ texto: 'Aceptar', clase: 'primario', valor: true }], clase = '', alAbrir }) {
  return new Promise((resolve) => {
    const capa = h('div.capa', { role: 'dialog', 'aria-modal': 'true' });
    const caja = h(`div.dialogo${clase ? '.' + clase : ''}`);
    let cerrado = false;
    const cerrar = (v) => { if (cerrado) return; cerrado = true; capa.remove(); document.removeEventListener('keydown', tecla, true); resolve(v); };
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); }
    };
    if (titulo) caja.append(h('h2', titulo));
    if (contenido) caja.append(contenido);
    const pie = h('div.dialogo-botones');
    botones.forEach((b) => pie.append(h(`button.btn.${b.clase || 'secundario'}`, {
      type: 'button',
      onclick: async () => {
        if (b.antes) { const ok = await b.antes(); if (ok === false) return; }
        cerrar(typeof b.valor === 'function' ? b.valor() : b.valor);
      },
    }, b.texto)));
    caja.append(pie);
    capa.append(caja);
    document.body.append(capa);
    document.addEventListener('keydown', tecla, true);
    capa._cerrar = cerrar;
    if (alAbrir) alAbrir(caja, cerrar);
    else pie.querySelector('.primario, .peligro')?.focus();
  });
}

export const confirmar = (titulo, texto, { si = 'Sí', no = 'Cancelar', peligro = false } = {}) =>
  dialogo({
    titulo,
    contenido: h('p.dialogo-texto', texto),
    botones: [{ texto: no, valor: false }, { texto: si, clase: peligro ? 'peligro' : 'primario', valor: true }],
  });

export const informar = (titulo, texto) => dialogo({ titulo, contenido: typeof texto === 'string' ? h('p.dialogo-texto', texto) : texto });

/** Formulario simple. campos: [{nombre, etiqueta, valor, tipo, opciones, requerido}] */
export function formulario(titulo, campos, { aceptar = 'Guardar', validar } = {}) {
  const form = h('form.formulario', { onsubmit: (e) => e.preventDefault() });
  const inputs = {};
  for (const c of campos) {
    let input;
    if (c.tipo === 'select') {
      input = h('select', { name: c.nombre }, c.opciones.map((o) => h('option', { value: o.valor, selected: String(o.valor) === String(c.valor) }, o.texto)));
    } else if (c.tipo === 'checkbox') {
      input = h('input', { type: 'checkbox', name: c.nombre, checked: !!c.valor });
    } else {
      input = h('input', {
        type: c.tipo || 'text', name: c.nombre, value: c.valor ?? '', placeholder: c.placeholder || '',
        inputmode: c.inputmode, autocomplete: 'off', autocapitalize: c.mayusculas ? 'characters' : 'sentences',
        readOnly: !!c.soloLectura, list: c.lista,
      });
    }
    inputs[c.nombre] = input;
    form.append(h(`label.campo${c.tipo === 'checkbox' ? '.check' : ''}`, h('span', c.etiqueta), input));
  }
  const error = h('p.error-form', { hidden: true });
  form.append(error);
  const leer = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === 'checkbox' ? i.checked : i.value.trim()]));
  return dialogo({
    titulo,
    contenido: form,
    botones: [
      { texto: 'Cancelar', valor: null },
      {
        texto: aceptar, clase: 'primario', valor: leer,
        antes: async () => {
          const v = leer();
          for (const c of campos) {
            if (c.requerido && !v[c.nombre]) { error.textContent = `Falta: ${c.etiqueta}`; error.hidden = false; return false; }
          }
          if (validar) {
            const msg = await validar(v);
            if (msg) { error.textContent = msg; error.hidden = false; return false; }
          }
          return true;
        },
      },
    ],
    alAbrir: () => setTimeout(() => form.querySelector('input:not([readonly]),select')?.focus(), 50),
  });
}

/** Pide el PIN con un teclado numérico grande. Resuelve con el texto o null. */
export function pedirPin(titulo = 'PIN de administrador', nota = '') {
  let valor = '';
  const puntos = h('div.pin-puntos');
  const pintar = () => { puntos.textContent = valor ? '●'.repeat(valor.length) : '—'; };
  pintar();
  return new Promise((resolve) => {
    let cerrarDlg;
    const teclado = tecladoNumerico({
      decimal: false,
      alTeclear: (k) => {
        if (k === 'borrar') valor = valor.slice(0, -1);
        else if (k === 'ok') { cerrarDlg(valor); return; }
        else if (k === 'cancelar') { cerrarDlg(null); return; }
        else if (valor.length < 8) valor += k;
        pintar();
      },
    });
    dialogo({
      titulo, clase: 'dialogo-pin',
      contenido: h('div', nota ? h('p.dialogo-texto', nota) : null, puntos, teclado.elemento),
      botones: [],
      alAbrir: (caja, cerrar) => { cerrarDlg = cerrar; },
    }).then((v) => { teclado.destruir(); resolve(v); });
  });
}

/**
 * Teclado numérico grande en pantalla (botones ≥ 70 px). También escucha el teclado
 * físico (dígitos, coma/punto, Retroceso, Enter, Escape).
 */
export function tecladoNumerico({ decimal = true, alTeclear }) {
  const teclas = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimal ? ',' : '', '0', 'borrar'];
  const el = h('div.teclado');
  for (const k of teclas) {
    if (!k) { el.append(h('span')); continue; }
    el.append(h(`button.tecla${k === 'borrar' ? '.tecla-borrar' : ''}`, {
      type: 'button', 'aria-label': k === 'borrar' ? 'Borrar' : k,
      onclick: () => alTeclear(k),
    }, k === 'borrar' ? '⌫ Borrar' : k));
  }
  el.append(h('button.tecla.tecla-cancelar', { type: 'button', onclick: () => alTeclear('cancelar') }, 'Cancelar'));
  el.append(h('button.tecla.tecla-ok', { type: 'button', onclick: () => alTeclear('ok') }, 'Enter ✓'));
  const fisico = (e) => {
    if (e.target.matches?.('input, textarea, select')) return;
    let k = null;
    if (/^[0-9]$/.test(e.key)) k = e.key;
    else if (decimal && (e.key === ',' || e.key === '.')) k = ',';
    else if (e.key === 'Backspace' || e.key === 'Delete') k = 'borrar';
    else if (e.key === 'Enter') k = 'ok';
    else if (e.key === 'Escape') k = 'cancelar';
    if (k) { e.preventDefault(); e.stopPropagation(); alTeclear(k); }
  };
  document.addEventListener('keydown', fisico, true);
  return { elemento: el, destruir: () => document.removeEventListener('keydown', fisico, true) };
}

// ---------- Sonido y vibración ----------
// El pito de lector: tono agudo y fuerte (~2,7 kHz, como un lector de código de barras).
// En iOS el audio web se calla con el interruptor de silencio; con audioSession
// «playback» (Safari 16.4+) suena igual, como un reproductor de música.
let _audio;
let _sonido = true;
export function fijarSonido(activo) { _sonido = !!activo; }

/** Debe llamarse desde un toque del usuario: iOS solo deja sonar audio desbloqueado así. */
export function desbloquearAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
    if (_audio.state !== 'running') _audio.resume();
    const o = _audio.createOscillator(); const g = _audio.createGain();
    g.gain.value = 0; o.connect(g).connect(_audio.destination); o.start(); o.stop(_audio.currentTime + 0.01);
  } catch { /* sin audio */ }
}

function tono(freq, inicio, dur, vol = 0.5, tipo = 'square') {
  if (!_audio || !_sonido) return;
  // iOS suspende el audio al bloquear o salir de la app: se reanuda en cada pito.
  if (_audio.state !== 'running') _audio.resume();
  const o = _audio.createOscillator(); const g = _audio.createGain();
  o.type = tipo; o.frequency.value = freq;
  const t = _audio.currentTime + inicio + 0.01;
  // Rampa de 5 ms para que no chasquee.
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.setValueAtTime(vol, t + dur - 0.005);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(_audio.destination); o.start(t); o.stop(t + dur + 0.02);
}
/** Lectura correcta: un pito agudo. */
export function sonidoOk() {
  tono(2700, 0, 0.15, 0.6);
  if (navigator.vibrate) navigator.vibrate(60);
}
/** Cantidad guardada: dos pitos cortos, para saber que quedó registrada. */
export function sonidoGuardado() {
  tono(2200, 0, 0.07, 0.5); tono(2900, 0.1, 0.09, 0.5);
  if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
}
/** Error: dos pitos graves y largos. */
export function sonidoError() {
  tono(300, 0, 0.22, 0.7); tono(300, 0.32, 0.22, 0.7);
  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
}

// ---------- Archivos ----------
export function elegirArchivo({ aceptar = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept: aceptar, multiple, style: 'display:none' });
    i.onchange = () => { resolve([...i.files]); i.remove(); };
    document.body.append(i);
    i.click();
  });
}

export function descargar(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre, style: 'display:none' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Compartir con el menú de iOS. Resuelve 'compartido', 'cancelado' o 'no-soportado'.
 */
export async function compartirArchivo(nombre, contenido, tipo = 'text/csv') {
  try {
    const archivo = new File([contenido], nombre, { type: tipo });
    if (!navigator.canShare || !navigator.canShare({ files: [archivo] })) return 'no-soportado';
    await navigator.share({ files: [archivo], title: nombre });
    return 'compartido';
  } catch (e) {
    return e && e.name === 'AbortError' ? 'cancelado' : 'no-soportado';
  }
}
