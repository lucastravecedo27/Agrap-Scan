// Decodifica cuadros de la cámara fuera del hilo principal para que el teclado no se trabe.
importScripts('../lib/jsQR.js');

self.onmessage = (e) => {
  const { id, ancho, alto, datos } = e.data;
  let texto = null;
  try {
    // El libro va impreso negro sobre blanco: no hace falta probar invertido (es más rápido).
    const r = jsQR(new Uint8ClampedArray(datos), ancho, alto, { inversionAttempts: 'dontInvert' });
    if (r && r.data) texto = r.data;
  } catch { /* cuadro ilegible */ }
  self.postMessage({ id, texto });
};
