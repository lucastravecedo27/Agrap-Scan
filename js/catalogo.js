// Catálogo por bodega: productos y destinos. Importación desde CSV con validación previa,
// edición desde la app, precarga inicial y promedio histórico para la alerta de cantidad.

import * as db from './db.js';
import * as bodegas from './bodegas.js';
import * as labores from './labores.js';
import * as usuarios from './usuarios.js';
import { aObjetos } from './csv.js';
import { RE_BODEGA, MIN_LINEAS_HISTORIAL } from './config.js';

const limpiar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Acepta «B01-INS-0045» o «0045» en la columna código y devuelve «0045». */
function codigoCorto(codigo, bodega, tipo) {
  const c = limpiar(codigo);
  const pref = `${bodega}-${tipo}-`;
  if (c.toUpperCase().startsWith(pref)) return c.slice(pref.length);
  const m = c.match(/^B\d{2,3}-(INS|DST)-(.+)$/i);
  return m ? m[2] : c;
}

function numeroODesconocido(v) {
  if (v === '' || v == null) return { ok: true, valor: null };
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? { ok: true, valor: n } : { ok: false };
}

// ---------- Consultas ----------
export async function productos(bodega, { incluirInactivos = true } = {}) {
  const l = await db.porIndice('productos', 'bodega', bodega);
  return l.filter((p) => incluirInactivos || p.activo !== false)
    .sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.nombre.localeCompare(b.nombre));
}
export async function destinos(bodega, { incluirInactivos = true } = {}) {
  const l = await db.porIndice('destinos', 'bodega', bodega);
  return l.filter((d) => incluirInactivos || d.activo !== false).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}
export const producto = (bodega, codigo) => db.get('productos', `${bodega}|${codigo}`);
export const destino = (bodega, codigo) => db.get('destinos', `${bodega}|${codigo}`);

export async function categorias(bodega) {
  return [...new Set((await productos(bodega)).map((p) => p.categoria || 'Sin categoría'))].sort();
}

// ---------- Validación de filas ----------
function validarProducto(r, bodega) {
  const p = {
    id: '', bodega,
    codigo: codigoCorto(r.codigo, bodega, 'INS'),
    nombre: limpiar(r.nombre),
    unidad: limpiar(r.unidad),
    categoria: limpiar(r.categoria) || 'Sin categoría',
    promedio_referencia: null,
    foto_url: limpiar(r.foto_url),
    activo: true,
  };
  const errores = [];
  if (!p.codigo) errores.push('código vacío');
  else if (/[\r\n]/.test(p.codigo) || p.codigo.length > 40) errores.push('código con formato inválido');
  if (!p.nombre) errores.push('nombre vacío');
  if (!p.unidad) errores.push('unidad vacía');
  const prom = numeroODesconocido(r.promedio_referencia);
  if (!prom.ok) errores.push(`promedio_referencia no es un número («${r.promedio_referencia}»)`);
  else p.promedio_referencia = prom.valor;
  if (p.foto_url && !/^(https?:\/\/|data:image\/|\.?\/?[\w-]+\/)/i.test(p.foto_url)) errores.push('foto_url no es una dirección válida');
  p.id = `${bodega}|${p.codigo}`;
  return { registro: p, errores };
}

function validarDestino(r, bodega) {
  const d = {
    id: '', bodega,
    codigo: codigoCorto(r.codigo, bodega, 'DST'),
    finca: limpiar(r.finca), lote: limpiar(r.lote), labor: limpiar(r.labor) ? labores.escribir(limpiar(r.labor)) : '',
    activo: true,
  };
  const errores = [];
  if (!d.codigo) errores.push('código vacío');
  else if (d.codigo.length > 20 || /[\r\n]/.test(d.codigo)) errores.push('código con formato inválido');
  if (!d.finca) errores.push('finca vacía');
  if (!d.lote) errores.push('lote vacío');
  d.id = `${bodega}|${d.codigo}`;
  return { registro: d, errores };
}

/**
 * Analiza un CSV sin guardar nada. tipo: 'productos' | 'destinos'.
 * Si el CSV trae columna «bodega», solo se toman las filas de esa bodega cuando
 * se pasa bodega; sin bodega se usa la de cada fila (paquete inicial).
 * -> {validos, errores:[{fila, codigo, motivos}], nuevos, actualizados, columnasFaltantes}
 */
export async function analizarCsv(texto, tipo, bodega = null) {
  const { columnas, registros } = aObjetos(texto);
  const requeridas = tipo === 'productos' ? ['codigo', 'nombre', 'unidad', 'categoria'] : ['codigo', 'finca', 'lote'];
  const columnasFaltantes = requeridas.filter((c) => !columnas.includes(c));
  if (!bodega && !columnas.includes('bodega')) columnasFaltantes.push('bodega');
  const res = { validos: [], errores: [], nuevos: 0, actualizados: 0, columnasFaltantes, total: registros.length, otrasBodegas: 0 };
  if (columnasFaltantes.length) return res;
  const vistos = new Map();
  const existentes = new Map();
  for (const r of registros) {
    let b = bodega;
    if (columnas.includes('bodega') && r.bodega) {
      const rb = r.bodega.toUpperCase();
      if (bodega && rb !== bodega) { res.otrasBodegas++; continue; }
      b = rb;
    }
    if (!b || !RE_BODEGA.test(b)) { res.errores.push({ fila: r._fila, codigo: r.codigo, motivos: [`bodega inválida («${r.bodega || ''}»)`] }); continue; }
    const { registro, errores } = tipo === 'productos' ? validarProducto(r, b) : validarDestino(r, b);
    if (registro.codigo && vistos.has(registro.id)) errores.push(`código repetido (ya está en la fila ${vistos.get(registro.id)})`);
    if (errores.length) { res.errores.push({ fila: r._fila, codigo: r.codigo, motivos: errores }); continue; }
    vistos.set(registro.id, r._fila);
    if (!existentes.has(b)) {
      const l = await db.porIndice(tipo, 'bodega', b);
      existentes.set(b, new Map(l.map((x) => [x.id, x])));
    }
    const previo = existentes.get(b).get(registro.id);
    if (previo) { res.actualizados++; registro.creado = previo.creado; registro.activo = previo.activo !== false; } else res.nuevos++;
    registro.creado = registro.creado || new Date().toISOString();
    res.validos.push(registro);
  }
  return res;
}

/** Guarda los registros válidos de un análisis (crea o actualiza; nunca borra). */
export async function confirmarImportacion(tipo, validos) {
  await db.putVarios(tipo, validos);
  return validos.length;
}

// ---------- Edición desde la app ----------
export async function guardarProducto(bodega, datos, { nuevo = false } = {}) {
  const { registro, errores } = validarProducto(datos, bodega);
  if (errores.length) throw new Error(errores.join(', '));
  const previo = await db.get('productos', registro.id);
  if (nuevo && previo) throw new Error(`El código ${registro.codigo} ya existe en ${bodega}.`);
  registro.activo = datos.activo ?? previo?.activo ?? true;
  registro.creado = previo?.creado || new Date().toISOString();
  await db.put('productos', registro);
  return registro;
}

export async function guardarDestino(bodega, datos, { nuevo = false } = {}) {
  const { registro, errores } = validarDestino(datos, bodega);
  if (errores.length) throw new Error(errores.join(', '));
  const previo = await db.get('destinos', registro.id);
  if (nuevo && previo) throw new Error(`El código ${registro.codigo} ya existe en ${bodega}.`);
  registro.activo = datos.activo ?? previo?.activo ?? true;
  registro.creado = previo?.creado || new Date().toISOString();
  await db.put('destinos', registro);
  return registro;
}

export async function siguienteCodigoDestino(bodega) {
  const nums = (await destinos(bodega)).map((d) => parseInt(d.codigo, 10)).filter(Number.isFinite);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
}

// ---------- Promedio para la alerta ----------
/**
 * Promedio histórico de cantidad por línea del producto en la bodega. Con menos de
 * MIN_LINEAS_HISTORIAL líneas propias se usa el promedio de referencia importado.
 */
export async function promedioHistorico(bodega, codigo) {
  const lineas = (await db.porIndice('lineas', 'bodega', bodega)).filter((l) => l.codigo === codigo);
  if (lineas.length >= MIN_LINEAS_HISTORIAL) {
    return { valor: lineas.reduce((s, l) => s + l.cantidad, 0) / lineas.length, fuente: 'historial', n: lineas.length };
  }
  const p = await producto(bodega, codigo);
  if (p && p.promedio_referencia > 0) return { valor: p.promedio_referencia, fuente: 'referencia', n: 0 };
  return null;
}

// ---------- Paquete inicial (bodegas + productos + destinos) ----------
/**
 * Analiza los tres CSV del paquete (bodegas.csv, productos.csv, destinos.csv con columna
 * bodega). No guarda nada.
 */
export async function analizarPaquete({ bodegasCsv, productosCsv, destinosCsv }) {
  const resumen = { bodegas: [], erroresBodegas: [], productos: null, destinos: null };
  if (bodegasCsv) {
    const { columnas, registros } = aObjetos(bodegasCsv);
    const falt = ['codigo', 'nombre'].filter((c) => !columnas.includes(c));
    if (falt.length) resumen.erroresBodegas.push({ fila: 1, motivos: [`faltan columnas: ${falt.join(', ')}`] });
    else {
      const vistos = new Set();
      for (const r of registros) {
        const b = bodegas.normalizar(r);
        const err = bodegas.validar(b);
        if (err) resumen.erroresBodegas.push({ fila: r._fila, codigo: r.codigo, motivos: [err] });
        else if (vistos.has(b.codigo)) resumen.erroresBodegas.push({ fila: r._fila, codigo: r.codigo, motivos: ['código repetido'] });
        else { vistos.add(b.codigo); resumen.bodegas.push(b); }
      }
    }
  }
  if (productosCsv) resumen.productos = await analizarCsv(productosCsv, 'productos');
  if (destinosCsv) resumen.destinos = await analizarCsv(destinosCsv, 'destinos');
  return resumen;
}

/** Elimina por completo una bodega con su catálogo y sus registros (datos de ejemplo). */
export async function eliminarBodegaCompleta(codigo) {
  await db.tx(['bodegas', 'productos', 'destinos', 'despachos', 'lineas', 'ajustes'], 'readwrite', async (s) => {
    s.bodegas.delete(codigo);
    for (const st of ['productos', 'destinos', 'despachos', 'lineas']) {
      const claves = await db.prom(s[st].index('bodega').getAllKeys(codigo));
      claves.forEach((k) => s[st].delete(k));
    }
    s.ajustes.delete(`despachoAbierto:${codigo}`);
    s.ajustes.delete(`impreso:${codigo}`);
  });
}

export async function guardarPaquete(resumen, { reemplazarEjemplo = false } = {}) {
  if (reemplazarEjemplo) {
    for (const b of await bodegas.listar()) if (b.ejemplo) await eliminarBodegaCompleta(b.codigo);
  }
  for (const b of resumen.bodegas) await bodegas.guardar({ ...b, ejemplo: false });
  // Las bodegas que llegaron en el paquete dejan de ser de ejemplo.
  for (const b of resumen.bodegas) { const r = await bodegas.obtener(b.codigo); delete r.ejemplo; await db.put('bodegas', r); }
  const codigos = new Set((await bodegas.listar()).map((b) => b.codigo));
  const filtrar = (l) => (l || []).filter((r) => codigos.has(r.bodega));
  const p = filtrar(resumen.productos?.validos); const d = filtrar(resumen.destinos?.validos);
  await db.putVarios('productos', p);
  await db.putVarios('destinos', d);
  await bodegas.asegurarActiva();
  return { bodegas: resumen.bodegas.length, productos: p.length, destinos: d.length,
    sinBodega: (resumen.productos?.validos.length || 0) - p.length + (resumen.destinos?.validos.length || 0) - d.length };
}

/**
 * La primera vez que se abre la app: carga ./datos-iniciales si existe (servido en
 * local con los datos reales) y si no, ./ejemplo (lo único que va en el repositorio).
 */
export async function precargarSiHaceFalta() {
  if (await db.ajuste('inicializado', false)) return null;
  if ((await db.contar('bodegas')) > 0) { await db.fijarAjuste('inicializado', true); return null; }
  for (const [carpeta, ejemplo] of [['datos-iniciales', false], ['ejemplo', true]]) {
    try {
      const leer = async (n) => {
        const r = await fetch(`${carpeta}/${n}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(n);
        const t = await r.text();
        if (/^\s*</.test(t)) throw new Error('no es CSV'); // página 404 servida como HTML
        return t;
      };
      const [bodegasCsv, productosCsv, destinosCsv] = await Promise.all(['bodegas.csv', 'productos.csv', 'destinos.csv'].map(leer));
      const resumen = await analizarPaquete({ bodegasCsv, productosCsv, destinosCsv });
      if (!resumen.bodegas.length) continue;
      const r = await guardarPaquete(resumen);
      if (ejemplo) for (const b of resumen.bodegas) { const x = await bodegas.obtener(b.codigo); x.ejemplo = true; await db.put('bodegas', x); }
      await db.fijarAjuste('origenDatos', ejemplo ? 'ejemplo' : 'iniciales');
      await db.fijarAjuste('inicializado', true);
      return { ...r, origen: ejemplo ? 'ejemplo' : 'iniciales' };
    } catch { /* probar la siguiente carpeta */ }
  }
  await db.fijarAjuste('inicializado', true);
  return null;
}

// ---------- Actualización de catálogo: oficina → finca ----------
/**
 * Archivo único que la oficina manda a la finca (por WhatsApp). Lleva bodegas,
 * productos y destinos completos, incluidos los desactivados, para que la finca
 * quede igual que la oficina.
 */
export async function exportarActualizacion(codigosBodega) {
  const bods = (await bodegas.listar()).filter((b) => codigosBodega.includes(b.codigo));
  const out = { app: 'agrap-salidas', tipo: 'catalogo', fecha: new Date().toISOString(), bodegas: [], productos: [], destinos: [] };
  for (const b of bods) {
    out.bodegas.push({ codigo: b.codigo, nombre: b.nombre, finca: b.finca, responsable: b.responsable, sociedad: b.sociedad || '', activa: b.activa !== false });
    out.productos.push(...(await db.porIndice('productos', 'bodega', b.codigo)));
    out.destinos.push(...(await db.porIndice('destinos', 'bodega', b.codigo)));
  }
  out.usuarios = await usuarios.paraBodegas(bods.map((b) => b.codigo));
  return out;
}

export function validarActualizacion(json) {
  if (!json || json.app !== 'agrap-salidas' || json.tipo !== 'catalogo') throw new Error('El archivo no es un catálogo de Agrap Salidas (debe venir de la página de oficina).');
  for (const k of ['bodegas', 'productos', 'destinos']) if (!Array.isArray(json[k])) throw new Error(`Archivo incompleto: falta «${k}».`);
  return { bodegas: json.bodegas.length, productos: json.productos.length, destinos: json.destinos.length, usuarios: json.usuarios?.length ?? 0, fecha: json.fecha };
}

/** Aplica el catálogo de la oficina. Nunca toca despachos ni líneas de la finca. */
export async function importarActualizacion(json, { reemplazarEjemplo = false } = {}) {
  validarActualizacion(json);
  if (reemplazarEjemplo) for (const b of await bodegas.listar()) if (b.ejemplo) await eliminarBodegaCompleta(b.codigo);
  for (const b of json.bodegas) {
    await bodegas.guardar(b);
    const r = await bodegas.obtener(b.codigo.toUpperCase());
    delete r.ejemplo; r.activa = b.activa !== false;
    await db.put('bodegas', r);
  }
  const codigos = new Set(json.bodegas.map((b) => b.codigo.toUpperCase()));
  const ok = (r) => r && codigos.has(r.bodega) && r.codigo && r.id === `${r.bodega}|${r.codigo}`;
  const prods = json.productos.filter(ok); const dests = json.destinos.filter(ok);
  // Lo que la oficina ya no tiene se desactiva (no se borra: puede haber líneas que lo citen).
  for (const cod of codigos) {
    const enviados = new Set(prods.filter((p) => p.bodega === cod).map((p) => p.id));
    const viejos = (await db.porIndice('productos', 'bodega', cod)).filter((p) => !enviados.has(p.id) && p.activo !== false);
    await db.putVarios('productos', viejos.map((p) => ({ ...p, activo: false })));
    const enviadosD = new Set(dests.filter((d) => d.bodega === cod).map((d) => d.id));
    const viejosD = (await db.porIndice('destinos', 'bodega', cod)).filter((d) => !enviadosD.has(d.id) && d.activo !== false);
    await db.putVarios('destinos', viejosD.map((d) => ({ ...d, activo: false })));
  }
  await db.putVarios('productos', prods);
  await db.putVarios('destinos', dests);
  await usuarios.recibir(json.usuarios);
  await db.fijarAjuste('catalogoRecibido', json.fecha);
  if ((await db.ajuste('origenDatos')) === 'ejemplo' && reemplazarEjemplo) await db.fijarAjuste('origenDatos', 'oficina');
  await bodegas.asegurarActiva();
  return { bodegas: json.bodegas.length, productos: prods.length, destinos: dests.length, usuarios: json.usuarios?.length ?? 0 };
}
