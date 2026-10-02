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
import * as traspaso from './traspaso.js';
import * as empleados from './empleados.js';
import * as ingresos from './ingresos.js';
import * as catalogo from './catalogo.js';
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
    // Compacta: la finca solo aparece si el gasto va a otra finca distinta a la de la bodega.
    const b = await bodegas.obtener(bod);
    const otraFinca = d.finca && b && d.finca !== b.finca && d.finca !== b.nombre;
    franja.append(
      h('div.franja-top',
        h('span.franja-id', d.id),
        h('span.franja-chip', d.lote),
        otraFinca ? h('span.franja-chip.franja-otra', `→ ${d.finca}`) : null),
      h('div.franja-labor', d.labor),
    );
  } else {
    franja.classList.remove('con-despacho');
    franja.append(h('div.franja-vacia', (await db.ajuste('pedirDestino', false)) ? '① Escanee un DESTINO para abrir un despacho' : '📦 Escanee un PRODUCTO para registrar su salida'));
  }
  const lineas = d ? await despacho.lineasDe(d.id) : [];
  const ultima = lineas[lineas.length - 1];
  vaciar(ult);
  if (ultima) {
    ult.append(...[h('small', 'Último registrado'),
      h('div.ultimo-nombre', ultima.producto),
      h('div.ultimo-cant', `${num(ultima.cantidad)} ${ultima.unidad}`),
      ultima.recibe ? h('div.ultimo-recibe', `→ ${ultima.recibe}`) : null].filter(Boolean));
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
    // QR de la pantalla de la oficina (empleados): vale en cualquier modo.
    if (traspaso.esTraspaso(texto)) { await recibirTraspaso(texto, bod); return; }
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
        let d = await despacho.abierto(bod);
        if (!d) {
          if (await db.ajuste('pedirDestino', false)) { error('Primero escanee un DESTINO.'); break; }
          d = (await despacho.abrir(bod, await destinoGeneral(bod))).despacho;
        }
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

/**
 * Sin paso de destino: el despacho se abre solo con el lote GENERAL de la finca (el del
 * catálogo si existe; si no, uno fijo).
 */
async function destinoGeneral(bod) {
  const b = await bodegas.obtener(bod);
  const ds = await catalogo.destinos(bod, { incluirInactivos: false });
  const finca = b?.finca || b?.nombre || bod;
  const gen = ds.find((x) => /^GENERAL$/i.test(x.lote) && x.finca === finca);
  return { codigo: gen?.codigo || 'GEN', finca, lote: 'GENERAL', labor: 'General' };
}

/** Partes del QR de empleados que muestra la oficina; al juntarlas todas, se cargan. */
async function recibirTraspaso(texto, bod) {
  const r = traspaso.recibir(texto);
  if (!r.completo) { sonidoOk(); mostrarMensaje(`📲 Recibiendo de la oficina: ${r.recibidas} de ${r.total}. Siga apuntando a la pantalla.`, 'aviso'); return; }
  const d = r.datos;
  if (d?.tipo !== 'empleados' || !Array.isArray(d.empleados)) { error('Ese código de la oficina no es una lista de empleados.'); return; }
  sonidoOk();
  const lista = d.empleados.map((e) => ({ codigo: String(e.c), nombre: e.n, carne: e.k, fincas: e.f, activo: e.a !== 0, cedula: '' }));
  const ok = await confirmar('Empleados de la oficina', `${lista.length} empleado(s) de ${d.bodegas.join(', ')}. Desde ahora el teléfono reconoce sus carnés.`, { si: 'Cargar' });
  if (!ok) { mostrarMensaje('No se cargaron los empleados.', ''); return; }
  await empleados.recibirDeBodegas(lista, d.bodegas);
  await ingresos.depurar();
  sonidoGuardado();
  mostrarMensaje(`✓ ${lista.length} empleado(s) cargados. Ya se pueden escanear los carnés.`, 'ok');
  void bod;
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
            const recibe = await pedirQuienRecibe(d, p, cant, previas.length ? previas[previas.length - 1].recibe : '');
            if (!recibe) { guardando = false; return; } // vuelve al teclado con la cantidad
            const emp = (await empleados.deBodega(d.bodega)).find((e) => e.nombre === recibe);
            const l = await despacho.agregarLinea(d, p, cant, recibe, emp?.codigo || '');
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

/**
 * ¿Quién recibe? Lo normal es que el trabajador ponga su CARNÉ bajo la cámara; si no lo
 * trae, se escriben 3 letras del nombre. Resuelve con el nombre o null.
 */
async function pedirQuienRecibe(d, p, cant, sugerida) {
  let escoger = null;
  // La cámara queda tapada por el teclado y el diálogo: se muestra en vivo dentro del diálogo
  // y el escáner lee de ese video visible (iOS puede dejar de actualizar un video tapado).
  let vista = null;
  const videoOriginal = escaner.video;
  if (!escaner.activo) { try { await escaner.iniciar(); } catch { /* sin cámara: queda escribir */ } }
  if (escaner.activo) {
    const v = h('video', { playsinline: true, muted: true, autoplay: true });
    v.muted = true; v.setAttribute('playsinline', '');
    v.srcObject = escaner.stream;
    v.play().catch(() => {});
    escaner.video = v;
    vista = h('div.persona-camara', v, h('div.persona-guia'));
  }
  escaner.interceptor = (texto) => {
    const m = String(texto).trim().match(RE_CARNE);
    if (!m) return false; // un producto u otro código: se ignora mientras se espera el carné
    empleados.porCarne(Number(m[1])).then((e) => {
      if (!e || e.activo === false) { sonidoError(); aviso(`Carné ${m[1]} sin trabajador asignado en este teléfono.`, 'error', 4000); return; }
      sonidoOk();
      escoger?.(e.nombre);
    });
    return true;
  };
  try {
    return await personas.elegir(d.bodega, {
      subtitulo: `${p.nombre} · ${num(cant)} ${p.unidad}`,
      aviso: '📷 Ponga el CARNÉ del trabajador frente a la cámara',
      extra: vista,
      sugerida,
      enlazar: (fn) => { escoger = fn; },
    });
  } finally {
    escaner.interceptor = null;
    escaner.video = videoOriginal;
  }
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
