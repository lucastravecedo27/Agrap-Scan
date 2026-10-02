// Arranque. Dos modos con el mismo código:
//   finca   (index.html)   lobby → Escanear, Registros, Ajustes (solo recibir catálogo)
//   oficina (oficina.html) Catálogo (productos nuevos, bodegas, destinos, enviar) y Libro

import { VERSION } from './config.js';
import * as db from './db.js';
import * as bodegas from './bodegas.js';
import * as catalogo from './catalogo.js';
import * as escaneo from './escaneo.js';
import * as exportar from './exportar.js';
import * as libro from './libro.js';
import * as configuracion from './configuracion.js';
import { $, $$, h, vaciar, aviso, desbloquearAudio } from './ui.js';

const MODO = document.body.dataset.modo === 'oficina' ? 'oficina' : 'finca';
const PANTALLAS = MODO === 'finca'
  ? { escanear: escaneo, registros: exportar, ajustes: configuracion }
  : { catalogo: configuracion, libro };
let actual = null;

async function irA(nombre) {
  if (actual === nombre) return;
  if (actual && PANTALLAS[actual].alOcultar) PANTALLAS[actual].alOcultar();
  actual = nombre;
  $$('.pantalla').forEach((p) => { p.hidden = p.dataset.pantalla !== nombre; });
  $$('.pestana').forEach((b) => b.classList.toggle('activa', b.dataset.ir === nombre));
  document.body.dataset.pantalla = nombre;
  window.scrollTo(0, 0);
  await PANTALLAS[nombre].alMostrar?.();
}

async function refrescarCabecera() {
  if (MODO === 'oficina') return;
  const b = await bodegas.asegurarActiva();
  $('#bodegaActiva').textContent = b ? `${b.codigo} · ${b.nombre}` : 'Sin bodega';
  $('#bodegaFinca').textContent = b ? (b.finca && b.finca !== b.nombre ? b.finca : 'Bodega activa · tocar para cambiar') : '';
  const p = await exportar.resumenPendientes(b?.codigo || null);
  const ind = $('#pendientes');
  ind.hidden = !p.total;
  ind.textContent = `${p.total} sin exportar`;
  ind.classList.toggle('alerta-dias', p.antiguas > 0);
  const banda = $('#bandaPendientes');
  banda.hidden = !p.antiguas;
  banda.textContent = p.antiguas ? `⚠ Hay ${p.antiguas} línea(s) sin exportar de días anteriores (${p.dias.join(', ')}). Vaya a Registros › Enviar CSV.` : '';
}

// ---------- Lobby (finca) ----------
async function mostrarLobby() {
  if (actual && PANTALLAS[actual].alOcultar) PANTALLAS[actual].alOcultar();
  actual = null;
  const lista = await bodegas.listar({ soloActivas: true });
  const activa = await bodegas.bodegaActiva();
  const cont = vaciar($('#lobbyFincas'));
  if (!lista.length) cont.append(h('p.lobby-vacio', 'No hay fincas cargadas. El encargado debe recibir el catálogo de la oficina en Ajustes.'));
  for (const b of lista) {
    cont.append(h(`button.lobby-finca${b.codigo === activa ? '.actual' : ''}`, { type: 'button', onclick: () => escogerFinca(b) },
      h('span.lobby-codigo', b.codigo),
      h('span.lobby-nombre', b.nombre),
      h('span.lobby-sub', [b.finca !== b.nombre ? b.finca : '', b.codigo === activa ? 'Última usada' : '', b.ejemplo ? 'Ejemplo' : ''].filter(Boolean).join(' · ') || ' ')));
  }
  $('#lobby').hidden = false;
  document.body.classList.add('en-lobby');
}

function cerrarLobby() {
  $('#lobby').hidden = true;
  document.body.classList.remove('en-lobby');
}

async function escogerFinca(b) {
  desbloquearAudio(); // este toque deja sonar el pitido y abrir la cámara sin otro toque
  const activa = await bodegas.bodegaActiva();
  if (b.codigo !== activa && (await db.ajuste('pinCambioFinca', true))) {
    if (!(await bodegas.exigirAdmin(`Cambiar la finca a ${b.codigo} · ${b.nombre}`))) return;
  }
  await bodegas.cambiarActiva(b.codigo);
  cerrarLobby();
  await refrescarCabecera();
  actual = null;
  escaneo.audioDesbloqueado();
  await irA('escanear');
}

async function iniciar() {
  $$('.version-app').forEach((e) => { e.textContent = `v${VERSION}`; });
  try {
    await db.abrir();
  } catch (e) {
    document.body.append(h('div.alerta.alerta-error', `No se pudo abrir la base de datos local: ${e.message}. Salga del modo privado de Safari.`));
    return;
  }
  const pre = await catalogo.precargarSiHaceFalta();
  if (pre) aviso(pre.origen === 'ejemplo' ? 'Se cargó un catálogo de EJEMPLO.' : `Datos iniciales cargados: ${pre.bodegas} bodegas, ${pre.productos} productos.`, 'info', 6000);

  const cambio = () => refrescarCabecera();
  if (MODO === 'finca') {
    escaneo.montar($('[data-pantalla=escanear]'), { alCambiarDatos: cambio });
    exportar.montar($('[data-pantalla=registros]'), { alCambiarDatos: cambio });
    configuracion.montar($('[data-pantalla=ajustes]'), { alCambiarDatos: cambio, modo: 'finca' });
    $('#btnCambiarFinca').addEventListener('click', mostrarLobby);
    $('#lobbyAjustes').addEventListener('click', async () => { cerrarLobby(); await refrescarCabecera(); await irA('ajustes'); });
    $('#pendientes').addEventListener('click', () => irA('registros'));
  } else {
    configuracion.montar($('[data-pantalla=catalogo]'), { alCambiarDatos: cambio, modo: 'oficina' });
    configuracion.alImprimirNuevos((bodega) => { libro.preseleccionar({ bodega, alcance: 'nuevos' }); irA('libro'); });
    libro.montar($('[data-pantalla=libro]'));
  }
  $$('.pestana').forEach((b) => b.addEventListener('click', () => irA(b.dataset.ir)));
  document.addEventListener('pointerdown', () => bodegas.renovarAdmin(), { passive: true });

  // Para pruebas desde la consola: agrap.simular('B01-INS-0045')
  window.agrap = { simular: escaneo.simular, irA, db, VERSION, MODO };
  registrarSW();
  await refrescarCabecera();
  if (MODO === 'finca') await mostrarLobby(); else await irA('catalogo');
}

// ---------- Service worker: offline y actualización automática ----------
function registrarSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const revisar = () => reg.update().catch(() => {});
    setInterval(revisar, 30 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  }).catch((e) => console.warn('SW', e));
  let recargando = false;
  // La primera instalación también dispara controllerchange: ahí no hay nada que recargar.
  const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || !habiaControlador) return;
    recargando = true;
    // No recargar con el teclado de cantidad o un diálogo abierto: esperar a que se cierre.
    const intentar = () => {
      if (document.querySelector('.capa-cantidad, .capa')) { setTimeout(intentar, 2000); return; }
      location.reload();
    };
    intentar();
  });
}

iniciar();
