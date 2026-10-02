// Traspaso por QR: la oficina muestra en su pantalla uno o varios QR con datos (hoy, los
// empleados de una finca) y el teléfono los lee con la cámara de Escanear. Sirve sin
// internet y sin WhatsApp, apuntando el teléfono a la pantalla del PC.
//   AGRAP-DATOS:<id>:<parte>/<total>:<trozo de JSON>
// El JSON va solo en ASCII (tildes como \uXXXX) para que ningún lector lo dañe.

import { h, dialogo } from './ui.js';

const PREFIJO = 'AGRAP-DATOS:';
const TAM_TROZO = 450;      // caracteres por QR: denso pero fácil de leer desde una pantalla
const MS_CAMBIO = 1300;     // cada cuánto cambia el QR en la pantalla de la oficina

export const esTraspaso = (texto) => String(texto || '').startsWith(PREFIJO);

const ascii = (s) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Objeto → lista de textos para QR. */
export function partir(objeto) {
  const json = ascii(JSON.stringify(objeto));
  const id = Math.random().toString(36).slice(2, 6);
  const n = Math.max(1, Math.ceil(json.length / TAM_TROZO));
  return Array.from({ length: n }, (_, i) => `${PREFIJO}${id}:${i + 1}/${n}:${json.slice(i * TAM_TROZO, (i + 1) * TAM_TROZO)}`);
}

function svg(texto) {
  const qr = window.qrcode(0, 'L');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

/** Oficina: muestra los QR en pantalla, rotando solos hasta que se cierre. */
export function mostrar(objeto, { titulo, nota }) {
  const partes = partir(objeto);
  const caja = h('div.traspaso-qr');
  const cuenta = h('div.traspaso-cuenta');
  let i = 0;
  const pintar = () => {
    caja.innerHTML = svg(partes[i]);
    cuenta.textContent = partes.length > 1 ? `Código ${i + 1} de ${partes.length} · cambia solo` : 'Un solo código';
    i = (i + 1) % partes.length;
  };
  pintar();
  const reloj = partes.length > 1 ? setInterval(pintar, MS_CAMBIO) : null;
  return dialogo({
    titulo, clase: 'dialogo-traspaso',
    contenido: h('div', h('p.dialogo-texto', nota), caja, cuenta),
    botones: [{ texto: 'Listo', clase: 'primario', valor: true }],
  }).finally(() => clearInterval(reloj));
}

// ---------- Teléfono: juntar las partes ----------
const enCurso = new Map(); // id -> {n, trozos: Map}

/**
 * Recibe un texto leído. -> {completo:false, recibidas, total} o {completo:true, datos}
 * Lanza error si el contenido no se entiende.
 */
export function recibir(texto) {
  const m = String(texto).match(/^AGRAP-DATOS:(\w+):(\d+)\/(\d+):([\s\S]*)$/);
  if (!m) throw new Error('Código de la oficina incompleto. Acerque o aleje el teléfono de la pantalla.');
  const [, id, i, n, trozo] = m;
  const t = enCurso.get(id) || { n: Number(n), trozos: new Map() };
  t.trozos.set(Number(i), trozo);
  enCurso.set(id, t);
  if (t.trozos.size < t.n) return { completo: false, recibidas: t.trozos.size, total: t.n };
  enCurso.delete(id);
  const json = Array.from({ length: t.n }, (_, k) => t.trozos.get(k + 1)).join('');
  return { completo: true, datos: JSON.parse(json) };
}
