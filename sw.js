// Service worker: todo en caché para uso 100 % offline.
// Al publicar cambios, subir VERSION (igual que js/config.js): el navegador detecta que
// este archivo cambió, instala la caché nueva, toma el control y la app se recarga sola.
const VERSION = '1.9.1';
const CACHE = `agrap-salidas-${VERSION}`;
const ARCHIVOS = [
  './', './index.html', './oficina.html', './instalar.html', './manifest.json',
  './css/app.css', './css/impresion.css',
  './js/app.js', './js/config.js', './js/db.js', './js/csv.js', './js/ui.js', './js/bodegas.js',
  './js/catalogo.js', './js/personas.js', './js/labores.js', './js/usuarios.js', './js/empleados.js', './js/jornada.js', './js/labores-nomina.js', './js/ingresos.js', './js/modo.js', './js/rdt.js', './js/despacho.js', './js/escaneo.js', './js/scanner.js', './js/scanner-worker.js',
  './js/exportar.js', './js/libro.js', './js/configuracion.js',
  './lib/jsQR.js', './lib/qrcode.js', './lib/jszip.min.js', './plantillas/rdt.xlsx',
  './fuentes/outfit-400.woff2', './fuentes/outfit-600.woff2', './fuentes/outfit-700.woff2',
  './iconos/icono-192.png', './iconos/icono-512.png', './iconos/icono-maskable-512.png',
  './iconos/apple-touch-icon.png', './iconos/simbolo-crema.svg',
  './ejemplo/bodegas.csv', './ejemplo/productos.csv', './ejemplo/destinos.csv',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('agrap-salidas-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // datos-iniciales solo existe al servir la app en local: siempre a la red.
  if (req.url.includes('/datos-iniciales/')) return;
  // En desarrollo (localhost) primero la red, para ver los cambios sin subir VERSION.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req).then((resp) => {
      if (resp.ok && resp.type === 'basic') { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return resp;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
