// IndexedDB: un envoltorio pequeño con promesas. Nadie más abre la base.
//
// Almacenes:
//   ajustes    {clave, valor}                      PIN, bodega activa, despacho abierto…
//   bodegas    {codigo, nombre, finca, responsable, sociedad, activa, consecutivo}
//   productos  {id: 'B01|0045', bodega, codigo, nombre, unidad, categoria, …, activo}
//   destinos   {id: 'B01|003', bodega, codigo, finca, lote, labor, activo}
//   despachos  {id: 'B01-D-0001', bodega, numero, destino, finca, lote, labor, abierto, inicio, fin, fecha}
//   lineas     {n (auto), despacho, bodega, fecha, hora, ts, codigo, producto, unidad,
//               cantidad, finca, lote, labor, responsable, exportado (0/1), exportadoEn}
//   jornadas   {n (auto), bodega, finca, fecha, empleado, nombre, codigoLabor, labor, unidad,
//               plan, real, inicio, fin, horas, estado ('abierta'|'cerrada'), registro,
//               cierre, exportado (0/1), exportadoEn}

const NOMBRE = 'agrap-salidas';
const VERSION_DB = 2;
export const ALMACENES = ['ajustes', 'bodegas', 'productos', 'destinos', 'despachos', 'lineas', 'jornadas'];

let _db = null;

export function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE, VERSION_DB);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 2) {
        const j = db.createObjectStore('jornadas', { keyPath: 'n', autoIncrement: true });
        for (const i of ['bodega', 'fecha', 'empleado', 'estado', 'exportado']) j.createIndex(i, i);
      }
      if (e.oldVersion >= 1) return;
      db.createObjectStore('ajustes', { keyPath: 'clave' });
      db.createObjectStore('bodegas', { keyPath: 'codigo' });
      const p = db.createObjectStore('productos', { keyPath: 'id' });
      p.createIndex('bodega', 'bodega');
      const d = db.createObjectStore('destinos', { keyPath: 'id' });
      d.createIndex('bodega', 'bodega');
      const de = db.createObjectStore('despachos', { keyPath: 'id' });
      de.createIndex('bodega', 'bodega');
      de.createIndex('fecha', 'fecha');
      const l = db.createObjectStore('lineas', { keyPath: 'n', autoIncrement: true });
      l.createIndex('despacho', 'despacho');
      l.createIndex('bodega', 'bodega');
      l.createIndex('fecha', 'fecha');
      l.createIndex('exportado', 'exportado');
    };
    req.onsuccess = () => {
      _db = req.result;
      // Otra pestaña con una versión nueva de la base: soltar la conexión.
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

const prom = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/** Corre fn(stores) dentro de UNA transacción y resuelve cuando la transacción termina. */
export async function tx(nombres, modo, fn) {
  const db = await abrir();
  const lista = Array.isArray(nombres) ? nombres : [nombres];
  return new Promise((resolve, reject) => {
    const t = db.transaction(lista, modo);
    const stores = Object.fromEntries(lista.map((n) => [n, t.objectStore(n)]));
    let resultado;
    t.oncomplete = () => resolve(resultado);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción abortada'));
    Promise.resolve(fn(stores, t)).then((r) => { resultado = r; }, (e) => { try { t.abort(); } catch {} reject(e); });
  });
}

export const get = (store, key) => tx(store, 'readonly', (s) => prom(s[store].get(key)));
export const put = (store, valor) => tx(store, 'readwrite', (s) => prom(s[store].put(valor)));
export const del = (store, key) => tx(store, 'readwrite', (s) => prom(s[store].delete(key)));
export const todos = (store) => tx(store, 'readonly', (s) => prom(s[store].getAll()));
export const porIndice = (store, indice, valor) =>
  tx(store, 'readonly', (s) => prom(s[store].index(indice).getAll(valor)));
export const contar = (store, indice, valor) =>
  tx(store, 'readonly', (s) => prom(indice ? s[store].index(indice).count(valor) : s[store].count()));

export async function putVarios(store, valores) {
  return tx(store, 'readwrite', (s) => Promise.all(valores.map((v) => prom(s[store].put(v)))));
}

export { prom };

// ---- Ajustes (clave/valor) ----
export async function ajuste(clave, defecto = null) {
  const r = await get('ajustes', clave);
  return r ? r.valor : defecto;
}
export const fijarAjuste = (clave, valor) => put('ajustes', { clave, valor });

// ---- Respaldo completo ----
export async function exportarTodo() {
  const out = { app: 'agrap-salidas', version_db: VERSION_DB, fecha: new Date().toISOString(), datos: {} };
  for (const n of ALMACENES) out.datos[n] = await todos(n);
  return out;
}

export async function restaurarTodo(json) {
  if (!json || json.app !== 'agrap-salidas' || !json.datos) throw new Error('El archivo no es un respaldo de Agrap Salidas.');
  for (const n of ALMACENES) if (!Array.isArray(json.datos[n])) throw new Error(`Respaldo incompleto: falta «${n}».`);
  await tx(ALMACENES, 'readwrite', async (s) => {
    for (const n of ALMACENES) {
      await prom(s[n].clear());
      for (const v of json.datos[n]) s[n].put(v);
    }
  });
}

export async function borrarTodo() {
  await tx(ALMACENES, 'readwrite', (s) => Promise.all(ALMACENES.map((n) => prom(s[n].clear()))));
}
