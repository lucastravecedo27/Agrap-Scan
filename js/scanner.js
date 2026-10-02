// Cámara trasera en escaneo continuo (estación fija) + decodificación QR con jsQR en un worker.
// Las lecturas repetidas del mismo código dentro de MS_REPETIDO se ignoran.

import { MS_REPETIDO } from './config.js';

const LADO_MAX = 720;     // px del lado mayor del cuadro que se decodifica
const MS_ENTRE_CUADROS = 90;

export class Escaner {
  constructor({ video, alLeer, alEstado }) {
    this.video = video;
    this.alLeer = alLeer;
    this.alEstado = alEstado || (() => {});
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.pausado = false;
    this.ocupado = false;
    this.ultimo = { texto: null, t: 0 };
    this.worker = null;
    this.pid = 0;
    this._bucle = this._bucle.bind(this);
  }

  get activo() { return !!this.stream; }

  async iniciar() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara. Abra la app en Safari (iPhone) o Chrome (Android).');
    this.alEstado('iniciando');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    // Enfoque continuo donde el navegador lo permita (el libro queda a distancia fija).
    try {
      const pista = this.stream.getVideoTracks()[0];
      const cap = pista.getCapabilities?.() || {};
      if (cap.focusMode?.includes('continuous')) await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch { /* opcional */ }
    if (!this.worker) {
      this.worker = new Worker(new URL('./scanner-worker.js', import.meta.url));
      this.worker.onmessage = (e) => this._resultado(e.data);
    }
    pista(this.stream, () => this.detener('La cámara se desconectó.'));
    this.alEstado('activo');
    this._timer = setTimeout(this._bucle, MS_ENTRE_CUADROS);
  }

  detener(motivo = null) {
    clearTimeout(this._timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ocupado = false;
    this.alEstado('detenido', motivo);
  }

  pausar() { this.pausado = true; }
  reanudar() { this.pausado = false; }

  /** Olvida la última lectura (p. ej. tras cancelar) para poder volver a leer el mismo código. */
  olvidar() { this.ultimo = { texto: null, t: 0 }; }

  _bucle() {
    if (!this.stream) return;
    this._timer = setTimeout(this._bucle, MS_ENTRE_CUADROS);
    // En pausa (teclado abierto) se sigue decodificando solo para extender la ventana de
    // repetido: la página del producto queda debajo y no debe volver a leerse al guardar.
    if (this.ocupado || document.hidden) return;
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const esc = Math.min(1, LADO_MAX / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * esc), hgt = Math.round(v.videoHeight * esc);
    if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = hgt; }
    this.ctx.drawImage(v, 0, 0, w, hgt);
    const img = this.ctx.getImageData(0, 0, w, hgt);
    this.ocupado = true;
    this.worker.postMessage({ id: ++this.pid, ancho: w, alto: hgt, datos: img.data.buffer }, [img.data.buffer]);
  }

  _resultado({ texto }) {
    this.ocupado = false;
    if (texto) this.entregar(texto);
  }

  /** Punto único de entrada de un código (cámara, digitado o simulado). */
  entregar(texto) {
    texto = String(texto).trim();
    if (!texto) return false;
    const ahora = Date.now();
    if (this.pausado) {
      // Con un diálogo que espera un código (p. ej. el carné de quien recibe), ese código
      // pasa aunque la pantalla esté en pausa. La ventana de repetido sigue valiendo.
      if (this.interceptor && !(texto === this.ultimo.texto && ahora - this.ultimo.t < MS_REPETIDO)) {
        this.ultimo = { texto, t: ahora };
        return this.interceptor(texto) !== false;
      }
      if (texto === this.ultimo.texto) this.ultimo.t = ahora;
      return false;
    }
    if (texto === this.ultimo.texto && ahora - this.ultimo.t < MS_REPETIDO) {
      this.ultimo.t = ahora; // la página sigue debajo: se extiende la ventana
      return false;
    }
    this.ultimo = { texto, t: ahora };
    this.alLeer(texto);
    return true;
  }
}

function pista(stream, alTerminar) {
  const t = stream.getVideoTracks()[0];
  if (t) t.addEventListener('ended', alTerminar, { once: true });
}

// ---------- Pantalla encendida ----------
let _lock = null;
export async function mantenerPantalla(activar) {
  try {
    if (activar && 'wakeLock' in navigator) {
      if (!_lock || _lock.released) _lock = await navigator.wakeLock.request('screen');
      return true;
    }
    if (!activar && _lock) { await _lock.release(); _lock = null; }
  } catch { /* no disponible */ }
  return false;
}
// El bloqueo se suelta solo al ocultar la app; se pide otra vez al volver.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _lock && _lock.released) mantenerPantalla(true);
});
