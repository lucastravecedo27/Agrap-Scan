// Despachos: interpretar lo que lee la cámara, abrir/cerrar despachos con consecutivo por
// bodega, guardar líneas, deshacer y acumular. Sin pantalla: la usa escaneo.js.

import * as db from './db.js';
import * as catalogo from './catalogo.js';
import * as bodegas from './bodegas.js';
import { RE_QR, CMD_CERRAR, CMD_DESHACER, FACTOR_ALERTA } from './config.js';
import { fechaLocal, horaLocal } from './ui.js';

const claveAbierto = (bodega) => `despachoAbierto:${bodega}`;
export const idDespacho = (bodega, n) => `${bodega}-D-${String(n).padStart(4, '0')}`;

/**
 * Traduce el texto de un QR a una acción. Nunca guarda nada.
 * -> {tipo:'cerrar'|'deshacer'|'destino'|'producto'|'error', registro?, mensaje?}
 */
export async function interpretar(texto, bodegaActiva) {
  const t = String(texto || '').trim();
  if (t.toUpperCase() === CMD_CERRAR) return { tipo: 'cerrar' };
  if (t.toUpperCase() === CMD_DESHACER) return { tipo: 'deshacer' };
  const m = t.match(RE_QR);
  if (!m) return { tipo: 'error', mensaje: `Código desconocido: «${t.slice(0, 40)}»` };
  const [, bod, clase, codigo] = m;
  if (bod.toUpperCase() !== bodegaActiva) {
    const otra = await bodegas.obtener(bod.toUpperCase());
    return { tipo: 'error', mensaje: `Este libro pertenece a la bodega ${bod}${otra ? ` (${otra.nombre})` : ''}. La bodega activa es ${bodegaActiva}.` };
  }
  if (clase === 'DST') {
    const d = await catalogo.destino(bodegaActiva, codigo);
    if (!d) return { tipo: 'error', mensaje: `Destino ${codigo} no existe en ${bodegaActiva}.` };
    if (d.activo === false) return { tipo: 'error', mensaje: `El destino ${codigo} está desactivado.` };
    return { tipo: 'destino', registro: d };
  }
  const p = await catalogo.producto(bodegaActiva, codigo);
  if (!p) return { tipo: 'error', mensaje: `Producto ${codigo} no existe en el catálogo de ${bodegaActiva}.` };
  if (p.activo === false) return { tipo: 'error', mensaje: `El producto ${p.nombre} está desactivado.` };
  return { tipo: 'producto', registro: p };
}

export async function abierto(bodega) {
  const id = await db.ajuste(claveAbierto(bodega), null);
  if (!id) return null;
  const d = await db.get('despachos', id);
  return d && d.abierto ? d : null;
}

/** Abre un despacho nuevo para el destino (cierra el que esté abierto). */
export async function abrir(bodega, destino) {
  const previo = await abierto(bodega);
  let cerrado = null;
  if (previo) cerrado = await cerrar(bodega);
  const ahora = new Date();
  const despacho = await db.tx(['bodegas', 'despachos', 'ajustes'], 'readwrite', async (s) => {
    const b = await db.prom(s.bodegas.get(bodega));
    if (!b) throw new Error('Bodega no encontrada');
    b.consecutivo = (b.consecutivo || 0) + 1;
    s.bodegas.put(b);
    const d = {
      id: idDespacho(bodega, b.consecutivo), bodega, numero: b.consecutivo,
      destino: destino.codigo, finca: destino.finca, lote: destino.lote, labor: destino.labor,
      responsable: b.responsable || '',
      abierto: true, inicio: ahora.toISOString(), fin: null, fecha: fechaLocal(ahora),
    };
    s.despachos.put(d);
    s.ajustes.put({ clave: claveAbierto(bodega), valor: d.id });
    return d;
  });
  return { despacho, cerrado };
}

/**
 * Cierra el despacho abierto. Uno sin líneas se elimina y, si era el último número,
 * devuelve el consecutivo: así no quedan huecos por un destino leído por error.
 */
export async function cerrar(bodega) {
  const d = await abierto(bodega);
  if (!d) return null;
  const n = await db.contar('lineas', 'despacho', d.id);
  await db.tx(['bodegas', 'despachos', 'ajustes'], 'readwrite', async (s) => {
    s.ajustes.delete(claveAbierto(bodega));
    if (n === 0) {
      s.despachos.delete(d.id);
      const b = await db.prom(s.bodegas.get(bodega));
      if (b && b.consecutivo === d.numero) { b.consecutivo -= 1; s.bodegas.put(b); }
    } else {
      s.despachos.put({ ...d, abierto: false, fin: new Date().toISOString() });
    }
  });
  return { ...d, lineas: n, eliminado: n === 0 };
}

/** ¿La cantidad pide confirmación? -> null o {promedio, fuente} */
export async function revisarCantidad(bodega, codigo, cantidad) {
  const prom = await catalogo.promedioHistorico(bodega, codigo);
  if (prom && prom.valor > 0 && cantidad > FACTOR_ALERTA * prom.valor) return prom;
  return null;
}

export async function agregarLinea(despacho, producto, cantidad, recibe = '') {
  if (!(cantidad > 0)) throw new Error('La cantidad debe ser mayor que cero.');
  const ahora = new Date();
  const b = await bodegas.obtener(despacho.bodega);
  const linea = {
    despacho: despacho.id, bodega: despacho.bodega,
    fecha: fechaLocal(ahora), hora: horaLocal(ahora), ts: ahora.toISOString(),
    codigo: producto.codigo, producto: producto.nombre, unidad: producto.unidad,
    cantidad: Math.round(cantidad * 1000) / 1000,
    finca: despacho.finca, lote: despacho.lote, labor: despacho.labor,
    responsable: b?.responsable || despacho.responsable || '',
    recibe,
    exportado: 0, exportadoEn: null,
  };
  linea.n = await db.put('lineas', linea);
  return linea;
}

export async function lineasDe(despachoId) {
  return (await db.porIndice('lineas', 'despacho', despachoId)).sort((a, b) => a.n - b.n);
}

/** Borra la última línea del despacho abierto (si no se ha exportado). */
export async function deshacer(bodega) {
  const d = await abierto(bodega);
  if (!d) return { ok: false, mensaje: 'No hay despacho abierto.' };
  const l = await lineasDe(d.id);
  if (!l.length) return { ok: false, mensaje: 'El despacho no tiene líneas.' };
  const ultima = l[l.length - 1];
  if (ultima.exportado) return { ok: false, mensaje: 'La última línea ya se exportó; no se puede borrar.' };
  await db.del('lineas', ultima.n);
  return { ok: true, linea: ultima };
}

export async function ultimaLinea(bodega) {
  const d = await abierto(bodega);
  if (!d) return null;
  const l = await lineasDe(d.id);
  return l[l.length - 1] || null;
}

/** Totales por producto, en el orden en que se leyeron por primera vez. */
export function acumular(lineas) {
  const m = new Map();
  for (const l of lineas) {
    const a = m.get(l.codigo) || { codigo: l.codigo, producto: l.producto, unidad: l.unidad, cantidad: 0, lecturas: 0 };
    a.cantidad = Math.round((a.cantidad + l.cantidad) * 1000) / 1000;
    a.lecturas++;
    m.set(l.codigo, a);
  }
  return [...m.values()];
}
