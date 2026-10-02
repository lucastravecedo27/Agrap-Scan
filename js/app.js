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
import * as usuarios from './usuarios.js';
import * as jornada from './jornada.js';
import * as modo from './modo.js';
import { $, $$, h, vaciar, aviso, desbloquearAudio, fijarSonido } from './ui.js';

const MODO = document.body.dataset.modo === 'oficina' ? 'oficina' : 'finca';
const PANTALLAS = MODO === 'finca'
  ? { escanear: escaneo, jornada, registros: exportar, ajustes: configuracion }
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
  const s = await usuarios.sesion();
  // Las pestañas siguen el modo: Registros para salidas, Jornada para personal.
  const m = await modo.actual();
  document.body.dataset.modo = m;
  $('.pestana[data-ir=jornada]').hidden = m !== 'personal';
  $('.pestana[data-ir=registros]').hidden = m !== 'salidas';
  $('.pestanas').className = 'pestanas pestanas-3';
  $('#bodegaActiva').textContent = b ? `${b.codigo} · ${b.nombre}` : 'Sin bodega';
  $('#bodegaFinca').textContent = [`${modo.MODOS[m].icono} ${modo.MODOS[m].nombre}`, s?.nombre, 'tocar para cambiar'].filter(Boolean).join(' · ');
  const p = await exportar.resumenPendientes(m === 'salidas' ? b?.codigo || null : '—');
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
  const cont = vaciar($('#lobbyFincas'));
  $('#lobby').hidden = false;
  document.body.classList.add('en-lobby');
  $('#lobbyInstalar').hidden = !instalar;
  // Con usuarios creados por la oficina, primero se ingresa y solo salen las fincas asignadas.
  const permitidas = await usuarios.fincasPermitidas();
  const s = await usuarios.sesion();
  if (permitidas && !s) { mostrarIngreso(cont); return; }
  $('.lobby-pregunta').textContent = s ? `Hola, ${s.nombre.split(' ')[0]}. ¿En qué finca está?` : '¿En qué finca está?';
  const lista = (await bodegas.listar({ soloActivas: true })).filter((b) => !permitidas || permitidas.includes(b.codigo));
  const activa = await bodegas.bodegaActiva();
  if (!lista.length) cont.append(h('p.lobby-vacio', permitidas ? 'Su usuario no tiene fincas activas en este teléfono. Avise a la oficina.' : 'No hay fincas cargadas. El encargado debe recibir el catálogo de la oficina en Ajustes.'));
  for (const b of lista) {
    cont.append(h(`button.lobby-finca${b.codigo === activa ? '.actual' : ''}`, { type: 'button', onclick: () => escogerFinca(b) },
      h('span.lobby-codigo', b.codigo),
      h('span.lobby-nombre', b.nombre),
      h('span.lobby-sub', [b.finca !== b.nombre ? b.finca : '', b.codigo === activa ? 'Última usada' : '', b.ejemplo ? 'Ejemplo' : ''].filter(Boolean).join(' · ') || ' ')));
  }
  if (s) {
    cont.append(h('button.btn.btn-claro.lobby-salir', {
      type: 'button',
      onclick: async () => { await usuarios.salir(); await refrescarCabecera(); mostrarLobby(); },
    }, `Salir (${s.usuario})`));
  }
}

function mostrarIngreso(cont) {
  $('.lobby-pregunta').textContent = 'Ingrese con su usuario';
  const usuario = h('input.lobby-input', { type: 'text', placeholder: 'Usuario', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: false });
  const clave = h('input.lobby-input', { type: 'password', placeholder: 'Contraseña', autocomplete: 'current-password' });
  const error = h('p.lobby-error', { role: 'alert' });
  const form = h('form.lobby-ingreso', {
    onsubmit: async (e) => {
      e.preventDefault();
      desbloquearAudio();
      try {
        const s = await usuarios.ingresar(usuario.value, clave.value);
        const suyas = (await bodegas.listar({ soloActivas: true })).filter((b) => s.fincas.includes(b.codigo));
        // Una sola finca: entra directo a escanear.
        if (suyas.length === 1) { await escogerFinca(suyas[0]); return; }
        await refrescarCabecera(); mostrarLobby();
      } catch (err) { error.textContent = err.message; clave.value = ''; clave.focus(); }
    },
  }, usuario, clave, error, h('button.btn.primario.btn-grande', { type: 'submit' }, 'Ingresar'));
  cont.append(form);
  setTimeout(() => usuario.focus(), 60);
}

function cerrarLobby() {
  $('#lobby').hidden = true;
  document.body.classList.remove('en-lobby');
}

async function escogerFinca(b) {
  desbloquearAudio(); // este toque deja sonar el pitido y abrir la cámara sin otro toque
  const activa = await bodegas.bodegaActiva();
  // Un usuario cambia entre sus fincas sin PIN: la oficina ya se las asignó.
  if (b.codigo !== activa && !(await usuarios.sesion()) && (await db.ajuste('pinCambioFinca', true))) {
    if (!(await bodegas.exigirAdmin(`Cambiar la finca a ${b.codigo} · ${b.nombre}`))) return;
  }
  await bodegas.cambiarActiva(b.codigo);
  const d = await modo.disponibles();
  if (d.length > 1) { mostrarModos(b, d); return; }
  await entrar(d[0] || 'salidas');
}

/** Segunda pregunta del inicio: qué va a registrar en esta finca. */
async function mostrarModos(b, disponibles) {
  const cont = vaciar($('#lobbyFincas'));
  const previo = await modo.actual();
  $('.lobby-pregunta').textContent = `${b.nombre}: ¿qué va a registrar?`;
  for (const clave of disponibles) {
    const m = modo.MODOS[clave];
    cont.append(h(`button.lobby-finca.lobby-modo${clave === previo ? '.actual' : ''}`, { type: 'button', onclick: () => { desbloquearAudio(); entrar(clave); } },
      h('span.lobby-icono', m.icono), h('span.lobby-nombre', m.nombre), h('span.lobby-sub', m.detalle)));
  }
  cont.append(h('button.btn.btn-claro.lobby-salir', { type: 'button', onclick: mostrarLobby }, '← Otra finca'));
}

async function entrar(clave) {
  await modo.fijar(clave);
  cerrarLobby();
  await refrescarCabecera();
  actual = null;
  escaneo.audioDesbloqueado();
  await escaneo.refrescar();
  await irA('escanear');
}

async function iniciar() {
  $$('.version-app').forEach((e) => { e.textContent = `v${VERSION}`; });
  try {
    await db.abrir();
  } catch (e) {
    document.body.append(h('div.alerta.alerta-error', `No se pudo abrir la base de datos local: ${e.message}. Salga del modo privado o incógnito del navegador.`));
    return;
  }
  fijarSonido(await db.ajuste('sonido', true));
  const pre = await catalogo.precargarSiHaceFalta();
  if (pre) aviso(pre.origen === 'ejemplo' ? 'Se cargó un catálogo de EJEMPLO.' : `Datos iniciales cargados: ${pre.bodegas} bodegas, ${pre.productos} productos.`, 'info', 6000);

  const cambio = () => refrescarCabecera();
  if (MODO === 'finca') {
    escaneo.montar($('[data-pantalla=escanear]'), { alCambiarDatos: cambio });
    exportar.montar($('[data-pantalla=registros]'), { alCambiarDatos: cambio });
    jornada.montar($('[data-pantalla=jornada]'), { alCambiarDatos: cambio });
    configuracion.montar($('[data-pantalla=ajustes]'), { alCambiarDatos: cambio, modo: 'finca' });
    $('#btnCambiarFinca').addEventListener('click', mostrarLobby);
    $('#lobbyAjustes').addEventListener('click', async () => { cerrarLobby(); await refrescarCabecera(); await irA('ajustes'); });
    $('#pendientes').addEventListener('click', () => irA('registros'));
  } else {
    configuracion.montar($('[data-pantalla=catalogo]'), { alCambiarDatos: cambio, modo: 'oficina' });
    configuracion.alImprimirNuevos((bodega) => { libro.preseleccionar({ bodega, alcance: 'nuevos' }); irA('libro'); });
    configuracion.alImprimirCarnes((op) => { libro.preseleccionar(op); irA('libro'); });
    libro.montar($('[data-pantalla=libro]'));
  }
  $$('.pestana').forEach((b) => b.addEventListener('click', () => irA(b.dataset.ir)));
  // Cada toque reactiva el audio: iOS lo suspende al bloquear la pantalla o cambiar de app.
  document.addEventListener('pointerdown', () => { bodegas.renovarAdmin(); if (MODO === 'finca') desbloquearAudio(); }, { passive: true });

  // Para pruebas desde la consola: agrap.simular('B01-INS-0045')
  window.agrap = { simular: escaneo.simular, irA, db, VERSION, MODO };
  registrarSW();
  if (MODO === 'finca') { guardarAtras(); ofrecerInstalacion(); }
  await refrescarCabecera();
  if (MODO === 'finca') await mostrarLobby(); else await irA('catalogo');
}

// ---------- Android: botón atrás e instalación ----------
// En Android el botón atrás cierra la app instalada. Se deja siempre un paso de historial
// propio: atrás cierra el diálogo o el teclado abierto y nunca saca de la app.
function guardarAtras() {
  history.pushState({ agrap: true }, '');
  window.addEventListener('popstate', () => {
    history.pushState({ agrap: true }, '');
    const dialogos = $$('.capa');
    if (dialogos.length) { dialogos[dialogos.length - 1]._cerrar?.(null); return; }
    $('.capa-cantidad .tecla-cancelar')?.click();
  });
}

// Chrome en Android avisa que la app se puede instalar: se ofrece un botón en el inicio.
let instalar = null;
function ofrecerInstalacion() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    instalar = e;
    const b = $('#lobbyInstalar');
    if (b) b.hidden = $('#lobby').hidden;
  });
  window.addEventListener('appinstalled', () => { instalar = null; const b = $('#lobbyInstalar'); if (b) b.hidden = true; });
  $('#lobbyInstalar')?.addEventListener('click', async () => {
    if (!instalar) return;
    instalar.prompt();
    await instalar.userChoice.catch(() => {});
    instalar = null; $('#lobbyInstalar').hidden = true;
  });
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
