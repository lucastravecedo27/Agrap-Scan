// Pantalla Escanear: cámara arriba, franja de destino, último producto y acumulado del
// despacho. Toda lectura (cámara, código digitado o simulada) entra por procesar().

import * as despacho from './despacho.js';
import * as bodegas from './bodegas.js';
import * as personas from './personas.js';
import * as labores from './labores.js';
import * as jornada from './jornada.js';
import * as usuarios from './usuarios.js';
import { RE_CARNE } from './config.js';
import * as modo from './modo.js';
import * as db from './db.js';
import { Escaner, mantenerPantalla } from './scanner.js';
import {
  $, h, vaciar, num, aviso, confirmar, dialogo, tecladoNumerico,
  sonidoOk, sonidoError, sonidoGuardado, desbloquearAudio,
} from './ui.js';

let escaner = null;
let raiz = null;
let procesando = false;
let tecladoAbierto = false;
let alCambio = () => {};
let audioListo = false;

export function montar(contenedor, { alCambiarDatos }) {
  raiz = contenedor;
  alCambio = alCambiarDatos || (() => {});
  vaciar(raiz).append(
    h('div.camara',
      h('video#video', { playsinline: true, muted: true, autoplay: true }),
      h('div.guia'),
      h('div.camara-estado#camaraEstado', { hidden: true }),
      h('button.btn.primario.btn-iniciar#btnIniciar', { type: 'button', onclick: iniciarCamara }, '▶ Iniciar escaneo'),
    ),
    h('div.franja-destino#franja'),
    h('div.mensaje-lectura#mensaje', { role: 'status', 'aria-live': 'assertive' }),
    h('div.ultimo#ultimo'),
    h('div.acumulado-caja', h('h3', 'Acumulado del despacho'), h('div.acumulado#acumulado')),
    h('div.acciones-escaneo',
      h('button.btn.secundario.btn-grande.solo-salidas', { type: 'button', onclick: () => procesar('CMD-DESHACER') }, '↶ Deshacer'),
      h('button.btn.oscuro.btn-grande.solo-salidas', { type: 'button', onclick: () => procesar('CMD-CERRAR') }, '■ Cerrar despacho'),
      h('button.btn.secundario.btn-grande', { type: 'button', onclick: digitarCodigo, title: 'Digitar un código' }, '⌨ Código'),
    ),
  );
  escaner = new Escaner({
    video: $('#video', raiz),
    alLeer: (t) => procesar(t),
    alEstado: (estado, motivo) => {
      const btn = $('#btnIniciar', raiz); const est = $('#camaraEstado', raiz);
      if (!btn) return;
      btn.hidden = estado === 'activo' || estado === 'iniciando';
      est.hidden = estado !== 'iniciando';
      est.textContent = 'Abriendo cámara…';
      if (estado === 'detenido' && motivo) mostrarMensaje(motivo, 'error');
    },
  });
  mostrarMensaje('', '');
  refrescar();
}

/** Llamar desde un toque del usuario (el lobby): la cámara arranca sin pedir otro toque. */
export function audioDesbloqueado() { audioListo = true; }

export async function alMostrar() {
  await refrescar();
  // Si el audio ya se desbloqueó con un toque, la cámara arranca sola al volver.
  if (audioListo && !escaner.activo) iniciarCamara();
}

export function alOcultar() {
  if (escaner) escaner.detener();
  mantenerPantalla(false);
}

async function iniciarCamara() {
  desbloquearAudio();
  audioListo = true;
  try {
    await escaner.iniciar();
    const ok = await mantenerPantalla(true);
    if (!ok) console.info('Wake Lock no disponible: configure el bloqueo automático en «Nunca».');
  } catch (e) {
    escaner.detener();
    const msg = e && e.name === 'NotAllowedError'
      ? 'Permiso de cámara negado. En Ajustes › Safari › Cámara elija «Permitir».'
      : (e.message || 'No se pudo abrir la cámara.');
    mostrarMensaje(msg, 'error');
  }
}

function mostrarMensaje(texto, tipo) {
  const m = $('#mensaje', raiz);
  if (!m) return;
  m.className = `mensaje-lectura ${tipo}`;
  m.textContent = texto || 'Listo para leer.';
}

export async function refrescar() {
  if (!raiz) return;
  const bod = await bodegas.bodegaActiva();
  const franja = $('#franja', raiz);
  const ult = $('#ultimo', raiz);
  const acum = $('#acumulado', raiz);
  if (!bod) {
    vaciar(franja).append(h('div.franja-vacia', 'No hay bodega activa. Configure una en Configuración.'));
    vaciar(ult); vaciar(acum);
    return;
  }
  if ((await modo.actual()) === 'personal') {
    franja.classList.remove('con-despacho');
    vaciar(franja).append(h('div.franja-vacia', '👷 Escanee el CARNÉ de la persona: al empezar y al terminar la labor'));
    vaciar(ult); vaciar(acum);
    return;
  }
  const d = await despacho.abierto(bod);
  vaciar(franja);
  if (d) {
    franja.classList.add('con-despacho');
    franja.append(
      h('div.franja-id', d.id),
      h('div.franja-datos',
        h('span', h('small', 'Finca'), d.finca),
        h('span', h('small', 'Lote'), d.lote),
        h('span', h('small', 'Labor'), d.labor)),
    );
  } else {
    franja.classList.remove('con-despacho');
    franja.append(h('div.franja-vacia', '① Escanee un DESTINO para abrir un despacho'));
  }
  const lineas = d ? await despacho.lineasDe(d.id) : [];
  const ultima = lineas[lineas.length - 1];
  vaciar(ult);
  if (ultima) {
    ult.append(h('small', 'Último registrado'),
      h('div.ultimo-nombre', ultima.producto),
      h('div.ultimo-cant', `${num(ultima.cantidad)} ${ultima.unidad}`),
      ultima.recibe ? h('div.ultimo-recibe', `→ ${ultima.recibe}`) : null);
  } else if (d) {
    ult.append(h('div.ultimo-vacio', '② Escanee un PRODUCTO'));
  }
  vaciar(acum);
  const totales = despacho.acumular(lineas);
  if (!totales.length) acum.append(h('p.vacio', d ? 'Sin líneas todavía.' : '—'));
  else {
    acum.append(h('table.tabla.tabla-acumulado',
      h('thead', h('tr', h('th', 'Producto'), h('th.num', 'Cantidad'), h('th', 'Und.'), h('th.num', 'Lect.'))),
      h('tbody', totales.map((t) => h('tr', h('td', t.producto), h('td.num', num(t.cantidad)), h('td', t.unidad), h('td.num', t.lecturas))))));
  }
}

/** Entrada única de códigos. */
export async function procesar(texto) {
  if (procesando || tecladoAbierto) return;
  procesando = true;
  escaner?.pausar();
  try {
    const bod = await bodegas.bodegaActiva();
    if (!bod) { error('No hay bodega activa.'); return; }
    // Carné de empleado: jornada (inicio o fin de labor).
    const carne = String(texto || '').trim().match(RE_CARNE);
    const m = await modo.actual();
    if (carne && m !== 'personal') { error('Está registrando SALIDAS. Para un carné, toque la cabecera y escoja Personal.'); return; }
    if (!carne && m === 'personal') { error('Está registrando PERSONAL: escanee el carné. Para salidas, toque la cabecera y escoja Salidas.'); return; }
    if (carne) {
      if (!(await usuarios.permite('jornada'))) { error('Su usuario no registra jornadas.'); return; }
      sonidoOk();
      const m = await jornada.alEscanearCarne(carne[1].trim(), bod);
      if (m.tipo === 'error') error(m.texto); else mostrarMensaje(m.texto, m.tipo);
      return;
    }
    if (!(await usuarios.permite('salidas'))) { error('Su usuario solo registra jornadas: escanee carnés.'); return; }
    const r = await despacho.interpretar(texto, bod);
    switch (r.tipo) {
      case 'error': error(r.mensaje); break;
      case 'cerrar': {
        const c = await despacho.cerrar(bod);
        if (!c) { error('No hay despacho abierto para cerrar.'); break; }
        sonidoOk();
        mostrarMensaje(c.eliminado ? `Despacho ${c.id} cerrado sin líneas (descartado).` : `Despacho ${c.id} cerrado · ${c.lineas} línea(s).`, 'ok');
        break;
      }
      case 'deshacer': {
        const ult = await despacho.ultimaLinea(bod);
        if (!ult) { error((await despacho.abierto(bod)) ? 'El despacho no tiene líneas.' : 'No hay despacho abierto.'); break; }
        sonidoOk();
        const ok = await confirmar('¿Borrar la última línea?',
          h('div.confirmar-deshacer', h('div.ultimo-nombre', ult.producto), h('div.ultimo-cant', `${num(ult.cantidad)} ${ult.unidad}`), h('small', `Leída a las ${ult.hora}`)),
          { si: 'Sí, borrar', no: 'No', peligro: true });
        if (!ok) { mostrarMensaje('Deshacer cancelado.', ''); break; }
        const res = await despacho.deshacer(bod);
        if (res.ok) mostrarMensaje(`Borrada: ${res.linea.producto} · ${num(res.linea.cantidad)} ${res.linea.unidad}`, 'aviso');
        else error(res.mensaje);
        break;
      }
      case 'destino': {
        const actual = await despacho.abierto(bod);
        if (actual && actual.destino === r.registro.codigo) {
          sonidoOk();
          mostrarMensaje(`El despacho ${actual.id} ya está abierto para este destino.`, 'ok');
          break;
        }
        // Destino solo con lote: la labor se escoge aquí (la última del lote sale de primera).
        let destino = r.registro;
        if (!destino.labor) {
          sonidoOk();
          const clave = `laborLote:${bod}|${destino.codigo}`;
          const labor = await labores.elegir(bod, { subtitulo: `${destino.finca} · ${destino.lote}`, sugerida: await db.ajuste(clave, '') });
          if (!labor) { mostrarMensaje('Despacho no abierto: falta la labor.', ''); break; }
          await db.fijarAjuste(clave, labor);
          destino = { ...destino, labor };
        }
        const { despacho: nuevo, cerrado } = await despacho.abrir(bod, destino);
        sonidoOk();
        mostrarMensaje(`${cerrado && !cerrado.eliminado ? `Cerrado ${cerrado.id}. ` : ''}Abierto ${nuevo.id} → ${nuevo.finca} · ${nuevo.labor}`, 'ok');
        break;
      }
      case 'producto': {
        const d = await despacho.abierto(bod);
        if (!d) { error('Primero escanee un DESTINO.'); break; }
        sonidoOk();
        await pedirCantidad(d, r.registro);
        break;
      }
    }
  } catch (e) {
    console.error(e);
    error(e.message || String(e));
  } finally {
    procesando = false;
    escaner?.reanudar();
    await refrescar();
    alCambio();
  }
}

function error(msg) {
  sonidoError();
  mostrarMensaje(msg, 'error');
}

/** Teclado grande para la cantidad. Enter guarda, Borrar corrige, Cancelar descarta. */
function pedirCantidad(d, p) {
  return new Promise((resolve) => {
    tecladoAbierto = true;
    let valor = '';
    const visor = h('div.cantidad-visor', '0');
    const pintar = () => { visor.textContent = valor || '0'; visor.classList.remove('sacudir'); };
    let guardando = false;
    const capa = h('div.capa-cantidad', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cantidad' });
    const cerrar = () => { teclado.destruir(); capa.remove(); tecladoAbierto = false; resolve(); };
    const teclado = tecladoNumerico({
      decimal: true,
      alTeclear: async (k) => {
        if (guardando) return;
        if (k === 'cancelar') { mostrarMensaje(`Descartado: ${p.nombre}`, ''); cerrar(); return; }
        if (k === 'borrar') { valor = valor.slice(0, -1); pintar(); return; }
        if (k === ',') { if (!valor.includes(',')) valor = (valor || '0') + ','; pintar(); return; }
        if (k === 'ok') {
          const cant = Number(valor.replace(',', '.'));
          if (!(cant > 0)) { sonidoError(); visor.classList.add('sacudir'); return; }
          guardando = true;
          try {
            const alerta = await despacho.revisarCantidad(d.bodega, p.codigo, cant);
            if (alerta) {
              sonidoError();
              const ok = await confirmar('Cantidad inusual',
                h('div', h('p.dialogo-texto', `${num(cant)} ${p.unidad} es más del doble del promedio ${alerta.fuente === 'historial' ? 'histórico' : 'de referencia'} (${num(Math.round(alerta.valor * 100) / 100)} ${p.unidad}).`),
                  h('p.dialogo-texto', '¿La cantidad es correcta?')),
                { si: 'Sí, guardar', no: 'Corregir' });
              if (!ok) { guardando = false; return; }
            }
            const previas = await despacho.lineasDe(d.id);
            const recibe = await personas.elegir(d.bodega, {
              subtitulo: `${p.nombre} · ${num(cant)} ${p.unidad}`,
              sugerida: previas.length ? previas[previas.length - 1].recibe : '',
            });
            if (!recibe) { guardando = false; return; } // vuelve al teclado con la cantidad
            const l = await despacho.agregarLinea(d, p, cant, recibe);
            sonidoGuardado();
            mostrarMensaje(`✓ ${l.producto} · ${num(l.cantidad)} ${l.unidad} → ${l.recibe}`, 'ok');
            cerrar();
          } catch (e) {
            guardando = false;
            sonidoError(); aviso(e.message, 'error');
          }
          return;
        }
        if (valor.replace(',', '').length >= 9) return;
        valor = valor === '0' ? k : valor + k;
        pintar();
      },
    });
    capa.append(
      h('div.cantidad-producto',
        p.foto_url ? h('img.cantidad-foto', { src: p.foto_url, alt: '', onerror: (e) => e.target.remove() }) : null,
        h('div',
          h('div.cantidad-nombre', p.nombre),
          h('div.cantidad-unidad', `Unidad: ${p.unidad}`),
          h('div.cantidad-codigo', `${p.codigo} · ${d.id}`))),
      h('div.cantidad-fila', visor, h('div.cantidad-und', p.unidad)),
      teclado.elemento,
    );
    document.body.append(capa);
  });
}

async function digitarCodigo() {
  const input = h('input', { type: 'text', autocapitalize: 'characters', autocomplete: 'off', placeholder: 'B01-INS-0045' });
  const v = await dialogo({
    titulo: 'Digitar código',
    contenido: h('form', { onsubmit: (e) => { e.preventDefault(); input.closest('.capa')._cerrar(input.value); } },
      h('label.campo', h('span', 'Código del QR'), input)),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Leer', clase: 'primario', valor: () => input.value }],
    alAbrir: () => setTimeout(() => input.focus(), 50),
  });
  if (v && v.trim()) {
    desbloquearAudio();
    // Digitado a mano: no aplica la ventana de repetido.
    escaner.olvidar();
    escaner.entregar(v.trim());
  }
}

/** Para pruebas y depuración: simula que la cámara leyó un código. */
export function simular(texto) { return escaner ? escaner.entregar(texto) : false; }
