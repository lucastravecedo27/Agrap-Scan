// Registros y exportación: lista de despachos por bodega y día, CSV para Agrap, marcar
// como exportado, reexportar por rango, pendientes y borrado de lo exportado viejo.

import * as db from './db.js';
import * as bodegas from './bodegas.js';
import * as despacho from './despacho.js';
import { serializar } from './csv.js';
import { COLUMNAS_EXPORTE, DIAS_RETENCION } from './config.js';
import {
  $, h, vaciar, num, hoy, fechaLocal, fechaLarga, aviso, confirmar, dialogo,
  descargar, compartirArchivo,
} from './ui.js';

// ---------- Datos ----------
export async function pendientes(bodega = null) {
  const l = await db.porIndice('lineas', 'exportado', 0);
  return bodega ? l.filter((x) => x.bodega === bodega) : l;
}

/** {total, antiguas (de días anteriores), dias:[...]} de líneas sin exportar. */
export async function resumenPendientes(bodega = null) {
  const l = await pendientes(bodega);
  const h0 = hoy();
  const antiguas = l.filter((x) => x.fecha < h0);
  return { total: l.length, antiguas: antiguas.length, dias: [...new Set(antiguas.map((x) => x.fecha))].sort() };
}

function aFila(l, bodegasPorCodigo) {
  return {
    fecha: l.fecha, hora: l.hora,
    bodega: bodegasPorCodigo[l.bodega]?.nombre || l.bodega,
    despacho_id: l.despacho, finca: l.finca, lote: l.lote, labor: l.labor,
    codigo_producto: l.codigo, producto: l.producto, unidad: l.unidad,
    // Punto decimal: el separador de columnas es la coma.
    cantidad: String(l.cantidad),
    responsable: l.responsable || '',
  };
}

/**
 * Arma el CSV. alcance: código de bodega o 'todas'. modo 'pendientes' o 'rango'.
 * -> {nombre, contenido, lineas}
 */
export async function generar({ alcance, modo = 'pendientes', desde = null, hasta = null }) {
  let lineas;
  if (modo === 'pendientes') lineas = await pendientes(alcance === 'todas' ? null : alcance);
  else {
    lineas = (await db.todos('lineas')).filter((l) => (alcance === 'todas' || l.bodega === alcance)
      && (!desde || l.fecha >= desde) && (!hasta || l.fecha <= hasta));
  }
  lineas.sort((a, b) => a.bodega.localeCompare(b.bodega) || a.ts.localeCompare(b.ts) || a.n - b.n);
  const bods = Object.fromEntries((await bodegas.listar()).map((b) => [b.codigo, b]));
  const contenido = serializar(COLUMNAS_EXPORTE, lineas.map((l) => aFila(l, bods)));
  const nombre = `salidas_${hoy().replace(/-/g, '')}_${alcance === 'todas' ? 'todas' : alcance}.csv`;
  return { nombre, contenido, lineas };
}

export async function marcarExportadas(lineas) {
  const ahora = new Date().toISOString();
  await db.tx('lineas', 'readwrite', (s) => {
    for (const l of lineas) s.lineas.put({ ...l, exportado: 1, exportadoEn: l.exportadoEn || ahora });
  });
}

// ---------- Corregir líneas ----------
/** Cambia la cantidad de una línea no exportada (guarda la original la primera vez). */
export async function corregirLinea(n, cantidad) {
  const l = await db.get('lineas', n);
  if (!l) throw new Error('La línea ya no existe.');
  if (l.exportado) throw new Error('Esta línea ya se exportó; no se puede cambiar.');
  if (!(cantidad > 0)) throw new Error('La cantidad debe ser mayor que cero.');
  const c = Math.round(cantidad * 1000) / 1000;
  if (c === l.cantidad) return l;
  const nueva = { ...l, cantidad: c, cantidadOriginal: l.cantidadOriginal ?? l.cantidad, editadaEn: new Date().toISOString() };
  await db.put('lineas', nueva);
  return nueva;
}

export async function quitarLinea(n) {
  const l = await db.get('lineas', n);
  if (l && l.exportado) throw new Error('Esta línea ya se exportó; no se puede quitar.');
  await db.del('lineas', n);
}

const aNumero = (t) => Number(String(t).trim().replace(/\./g, (m, i, s2) => (s2.includes(',') ? '' : '.')).replace(',', '.'));

/**
 * Muestra lo que se va a exportar, agrupado por despacho, con la cantidad editable y un
 * botón para quitar cada línea. Resuelve true si la persona confirma (cambios guardados).
 */
export async function revisar(lineas, titulo) {
  const cambios = new Map();   // n -> cantidad nueva
  const quitadas = new Set();
  const porDespacho = new Map();
  for (const l of lineas) { if (!porDespacho.has(l.despacho)) porDespacho.set(l.despacho, []); porDespacho.get(l.despacho).push(l); }
  const resumen = h('p.revision-resumen');
  const pintarResumen = () => {
    const vivas = lineas.filter((l) => !quitadas.has(l.n));
    resumen.textContent = `${vivas.length} línea(s) en ${new Set(vivas.map((l) => l.despacho)).size} despacho(s)` +
      (cambios.size || quitadas.size ? ` · ${cambios.size} corregida(s), ${quitadas.size} quitada(s)` : '');
  };
  const cuerpo = h('div.revision');
  for (const [id, ls] of porDespacho) {
    const d = ls[0];
    cuerpo.append(h('div.revision-despacho',
      h('div.revision-cab', h('strong', id), ` · ${d.finca} · ${d.lote} · ${d.labor}`),
      ls.map((l) => {
        const input = h('input.revision-cant', { type: 'text', inputmode: 'decimal', value: num(l.cantidad).replace(/\./g, ''), disabled: !!l.exportado, 'aria-label': `Cantidad de ${l.producto}` });
        const fila = h('div.revision-linea', { class: l.exportado ? 'exportada' : '' },
          h('div.revision-prod', h('div', l.producto), h('small', `${l.codigo} · ${l.fecha} ${l.hora.slice(0, 5)}${l.exportado ? ' · ya exportada' : ''}${l.cantidadOriginal != null ? ` · antes ${num(l.cantidadOriginal)}` : ''}`)),
          h('div.revision-edit', input, h('span.revision-und', l.unidad)),
          l.exportado ? h('span') : h('button.btn.mini.quitar', {
            type: 'button', 'aria-label': `Quitar ${l.producto}`,
            onclick: () => {
              if (quitadas.has(l.n)) { quitadas.delete(l.n); fila.classList.remove('quitada'); input.disabled = false; } else { quitadas.add(l.n); fila.classList.add('quitada'); input.disabled = true; }
              pintarResumen();
            },
          }, 'Quitar'));
        input.addEventListener('input', () => {
          const v = aNumero(input.value);
          input.classList.toggle('invalida', !(v > 0));
          if (v > 0 && v !== l.cantidad) cambios.set(l.n, v); else cambios.delete(l.n);
          fila.classList.toggle('editada', cambios.has(l.n));
          pintarResumen();
        });
        return fila;
      })));
  }
  pintarResumen();
  const ok = await dialogo({
    titulo: titulo || 'Revise antes de exportar',
    clase: 'dialogo-revision',
    contenido: h('div', h('p.nota', 'Corrija la cantidad si se equivocó o quite la línea. Los cambios se guardan al continuar.'), resumen, cuerpo),
    botones: [
      { texto: 'Volver', valor: false },
      {
        texto: 'Guardar y continuar', clase: 'primario', valor: true,
        antes: () => {
          if (cuerpo.querySelector('.revision-cant.invalida:not(:disabled)')) { aviso('Hay cantidades inválidas (deben ser mayores que cero).', 'error'); return false; }
          return true;
        },
      },
    ],
  });
  if (!ok) return false;
  for (const n of quitadas) await quitarLinea(n);
  for (const [n, c] of cambios) if (!quitadas.has(n)) await corregirLinea(n, c);
  return true;
}

/** Revisa, luego comparte (menú de iOS) o descarga; marca exportado solo si el archivo salió. */
export async function exportar(opciones, { forma = 'compartir' } = {}) {
  let r = await generar(opciones);
  if (!r.lineas.length) { aviso('No hay líneas para exportar.', 'aviso'); return null; }
  if (!(await revisar(r.lineas))) return null;
  r = await generar(opciones);
  if (!r.lineas.length) { aviso('No quedaron líneas para exportar.', 'aviso'); return null; }
  let salida = 'descargado';
  if (forma === 'compartir') {
    salida = await compartirArchivo(r.nombre, r.contenido);
    if (salida === 'cancelado') { aviso('Exportación cancelada. Las líneas siguen pendientes.', 'aviso'); return null; }
    if (salida === 'no-soportado') { descargar(r.nombre, r.contenido); salida = 'descargado'; }
  } else descargar(r.nombre, r.contenido);
  await marcarExportadas(r.lineas.filter((l) => !l.exportado));
  aviso(`${r.lineas.length} línea(s) exportadas en ${r.nombre}`, 'ok', 5000);
  return { ...r, salida };
}

/** Borra líneas exportadas con más de DIAS_RETENCION días (y despachos que queden vacíos). */
export async function contarBorrables() {
  const limite = fechaLocal(new Date(Date.now() - DIAS_RETENCION * 86400000));
  return (await db.porIndice('lineas', 'exportado', 1)).filter((l) => l.fecha < limite);
}

export async function borrarViejas() {
  const viejas = await contarBorrables();
  const despachosTocados = new Set(viejas.map((l) => l.despacho));
  await db.tx(['lineas', 'despachos'], 'readwrite', async (s) => {
    viejas.forEach((l) => s.lineas.delete(l.n));
    for (const id of despachosTocados) {
      const quedan = await db.prom(s.lineas.index('despacho').count(id));
      if (quedan === 0) {
        const d = await db.prom(s.despachos.get(id));
        if (d && !d.abierto) s.despachos.delete(id);
      }
    }
  });
  return viejas.length;
}

// ---------- Pantalla Registros ----------
let raiz = null;
const estado = { alcance: null, fecha: null };
let alCambio = () => {};

export function montar(contenedor, { alCambiarDatos }) {
  raiz = contenedor;
  alCambio = alCambiarDatos || (() => {});
}

export async function alMostrar() {
  const activa = await bodegas.bodegaActiva();
  if (!estado.alcance) estado.alcance = activa || 'todas';
  if (!estado.fecha) estado.fecha = hoy();
  await pintar();
}

async function pintar() {
  const activa = await bodegas.bodegaActiva();
  const lista = await bodegas.listar();
  const pend = await resumenPendientes(estado.alcance === 'todas' ? null : estado.alcance);
  vaciar(raiz);

  // --- Exportar ---
  const desde = h('input', { type: 'date', value: estado.fecha });
  const hasta = h('input', { type: 'date', value: estado.fecha });
  const alcanceExp = h('select', h('option', { value: activa || '', selected: true }, `Bodega activa (${activa || '—'})`), h('option', { value: 'todas' }, 'Todas las bodegas'));
  const correr = async (modo, forma) => {
    const alcance = alcanceExp.value || 'todas';
    if (modo === 'rango' && desde.value > hasta.value) { aviso('El rango de fechas está al revés.', 'error'); return; }
    await exportar({ alcance, modo, desde: desde.value, hasta: hasta.value }, { forma });
    alCambio(); await pintar();
  };
  raiz.append(h('section.tarjeta',
    h('h2', 'Exportar a Agrap'),
    h('p.nota', '«Enviar» abre el menú de compartir del iPhone: escoja WhatsApp y el contacto del encargado. «Descargar» guarda el archivo en Archivos.'),
    pend.total
      ? h('p.pendientes-texto', `${pend.total} línea(s) sin exportar${pend.antiguas ? ` · ${pend.antiguas} de días anteriores (${pend.dias.join(', ')})` : ''}.`)
      : h('p.pendientes-texto.ok', 'Todo exportado.'),
    h('label.campo', h('span', 'Qué exportar'), alcanceExp),
    h('div.fila-botones',
      h('button.btn.primario.btn-grande', { type: 'button', onclick: () => correr('pendientes', 'compartir') }, 'Enviar CSV (WhatsApp…)'),
      h('button.btn.secundario.btn-grande', { type: 'button', onclick: () => correr('pendientes', 'descargar') }, '↓ Descargar CSV')),
    h('details.reexportar',
      h('summary', 'Reexportar por rango de fechas'),
      h('div.fila-campos', h('label.campo', h('span', 'Desde'), desde), h('label.campo', h('span', 'Hasta'), hasta)),
      h('p.nota', 'Incluye líneas ya exportadas. Las nuevas del rango quedan marcadas como exportadas.'),
      h('div.fila-botones',
        h('button.btn.secundario', { type: 'button', onclick: () => correr('rango', 'compartir') }, 'Enviar rango (WhatsApp…)'),
        h('button.btn.secundario', { type: 'button', onclick: () => correr('rango', 'descargar') }, '↓ Descargar rango'))),
  ));

  // --- Lista por bodega y día ---
  const selBod = h('select', { onchange: (e) => { estado.alcance = e.target.value; pintar(); } },
    h('option', { value: 'todas', selected: estado.alcance === 'todas' }, 'Todas las bodegas'),
    lista.map((b) => h('option', { value: b.codigo, selected: estado.alcance === b.codigo }, `${b.codigo} · ${b.nombre}`)));
  const selFecha = h('input', { type: 'date', value: estado.fecha, onchange: (e) => { estado.fecha = e.target.value || hoy(); pintar(); } });
  const mover = (dias) => {
    const [a, m, d] = estado.fecha.split('-').map(Number);
    estado.fecha = fechaLocal(new Date(a, m - 1, d + dias)); pintar();
  };
  const cont = h('div.lista-despachos');
  raiz.append(h('section.tarjeta',
    h('h2', 'Despachos'),
    h('div.fila-campos', h('label.campo', h('span', 'Bodega'), selBod), h('label.campo', h('span', 'Día'), selFecha)),
    h('div.fila-botones.navegar-dia',
      h('button.btn.secundario', { type: 'button', onclick: () => mover(-1) }, '‹ Día anterior'),
      h('button.btn.secundario', { type: 'button', onclick: () => { estado.fecha = hoy(); pintar(); } }, 'Hoy'),
      h('button.btn.secundario', { type: 'button', onclick: () => mover(1) }, 'Día siguiente ›')),
    h('p.fecha-larga', fechaLarga(estado.fecha)),
    cont));

  // Líneas del día (un despacho abierto ayer con líneas hoy aparece en los dos días).
  const lineasDia = (await db.porIndice('lineas', 'fecha', estado.fecha))
    .filter((l) => estado.alcance === 'todas' || l.bodega === estado.alcance);
  const despachosDia = (await db.porIndice('despachos', 'fecha', estado.fecha))
    .filter((d) => estado.alcance === 'todas' || d.bodega === estado.alcance);
  const ids = new Set([...despachosDia.map((d) => d.id), ...lineasDia.map((l) => l.despacho)]);
  if (!ids.size) cont.append(h('p.vacio', 'No hay despachos este día.'));
  const porDespacho = {};
  for (const l of lineasDia) (porDespacho[l.despacho] ||= []).push(l);
  for (const id of [...ids].sort().reverse()) {
    const d = despachosDia.find((x) => x.id === id) || (await db.get('despachos', id));
    if (!d) continue;
    const lineas = (porDespacho[id] || []).sort((a, b) => a.n - b.n);
    const exportadas = lineas.filter((l) => l.exportado).length;
    const est = d.abierto ? ['abierto', 'Abierto'] : !lineas.length ? ['vacio', 'Sin líneas'] : exportadas === lineas.length ? ['exportado', 'Exportado'] : exportadas ? ['parcial', `Parcial ${exportadas}/${lineas.length}`] : ['pendiente', 'Pendiente'];
    const totales = despacho.acumular(lineas);
    cont.append(h('details.despacho',
      h('summary',
        h('div.despacho-cab', h('strong', d.id), h(`span.etiqueta.${est[0]}`, est[1])),
        h('div.despacho-sub', `${d.finca} · ${d.lote} · ${d.labor} · ${lineas.length} línea(s) · ${(d.inicio || '').slice(11, 16) ? new Date(d.inicio).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}`)),
      h('h4', 'Totales por producto'),
      h('table.tabla', h('thead', h('tr', h('th', 'Código'), h('th', 'Producto'), h('th.num', 'Total'), h('th', 'Und.'))),
        h('tbody', totales.map((t) => h('tr', h('td', t.codigo), h('td', t.producto), h('td.num', num(t.cantidad)), h('td', t.unidad))))),
      h('h4', 'Líneas'),
      h('table.tabla', h('thead', h('tr', h('th', 'Hora'), h('th', 'Producto'), h('th.num', 'Cant.'), h('th', 'Estado'))),
        h('tbody', lineas.map((l) => h('tr', h('td', l.hora.slice(0, 5)), h('td', l.producto), h('td.num', `${num(l.cantidad)} ${l.unidad}`), h('td', l.exportado ? 'Exportada' : 'Pendiente'))))),
      lineas.some((l) => !l.exportado) ? h('button.btn.secundario', {
        type: 'button',
        onclick: async () => {
          if (await revisar(lineas.filter((l) => !l.exportado), `Corregir ${d.id}`)) { aviso('Cambios guardados', 'ok'); alCambio(); pintar(); }
        },
      }, '✎ Corregir cantidades') : null,
    ));
  }

  // --- Mantenimiento ---
  const borrables = await contarBorrables();
  raiz.append(h('section.tarjeta',
    h('h2', 'Limpieza'),
    h('p.nota', `Líneas exportadas con más de ${DIAS_RETENCION} días: ${borrables.length}.`),
    h('button.btn.peligro', {
      type: 'button', disabled: !borrables.length,
      onclick: async () => {
        if (!(await bodegas.exigirPinSiempre(`Borrar ${borrables.length} línea(s) exportadas con más de ${DIAS_RETENCION} días.`))) return;
        if (!(await confirmar('¿Borrar registros viejos?', `Se borrarán ${borrables.length} línea(s) ya exportadas. No se puede deshacer. Haga un respaldo antes si lo necesita.`, { si: 'Borrar', peligro: true }))) return;
        const n = await borrarViejas();
        aviso(`${n} línea(s) borradas.`, 'ok');
        alCambio(); pintar();
      },
    }, 'Borrar exportados viejos…')));
}

export { dialogo };
