// Jornada: horas reales por persona. El empleado escanea su carné al empezar (escoge la labor
// de nómina y la cantidad planeada en su unidad de pago) y otra vez al terminar (confirma la
// cantidad real). Las horas reales salen de los dos escaneos. Pantalla con lo que está en
// labor ahora, lo terminado hoy, lo que quedó sin cerrar y el CSV para nómina.

import * as db from './db.js';
import * as empleados from './empleados.js';
import * as usuarios from './usuarios.js';
import * as bodegas from './bodegas.js';
import { crearLista } from './personas.js';
import { LABORES_NOMINA } from './labores-nomina.js';
import { serializar } from './csv.js';
import { COLUMNAS_JORNADAS, DESVIO_JORNADA } from './config.js';
import {
  h, vaciar, num, hoy, horaLocal, aviso, confirmar, dialogo, formulario, tecladoNumerico,
  descargar, compartirArchivo, sonidoGuardado, sonidoError,
} from './ui.js';

const porNombre = new Map(LABORES_NOMINA.map((l) => [l.nombre, l]));
const listaLabores = crearLista({
  prefijo: 'laboresNomina',
  formatear: (t) => String(t || '').replace(/\s+/g, ' ').trim(),
  base: LABORES_NOMINA.map((l) => l.nombre),
  enterPrimera: true,
  cerrada: true,
  detalle: (n) => (porNombre.get(n) ? `${porNombre.get(n).codigo} · ${porNombre.get(n).unidad}` : ''),
  textos: {
    titulo: '¿Qué labor va a hacer?', placeholder: 'Escriba la labor…', aria: 'Labor de nómina', mayusculas: 'sentences',
    vacio: 'Escriba la labor.', mismo: 'Misma', nuevo: 'Nueva', uso: 'vez', usos: 'veces',
    primera: '', ayuda: 'Escriba 3 letras de la labor (cor, des, emb…).',
    sinCoincidencias: 'No hay labores de nómina con esas letras.',
  },
});

const horasEntre = (a, b) => Math.round(((new Date(b) - new Date(a)) / 3600000) * 100) / 100;
const hhmm = (iso) => (iso ? horaLocal(new Date(iso)).slice(0, 5) : '—');
const duracion = (horas) => `${Math.floor(horas)} h ${String(Math.round((horas % 1) * 60)).padStart(2, '0')} min`;
const primerNombre = (n) => { const p = n.split(' '); return p.length > 2 ? p[2] : p[p.length - 1]; };

// ---------- Datos ----------
export async function abiertaDe(empleado) {
  return (await db.porIndice('jornadas', 'empleado', empleado)).find((j) => j.estado === 'abierta') || null;
}
export const deBodega = async (bodega) => (await db.porIndice('jornadas', 'bodega', bodega)).sort((a, b) => a.inicio.localeCompare(b.inicio));

async function guardarInicio(bodega, emp, labor, plan) {
  const b = await bodegas.obtener(bodega);
  const ahora = new Date();
  const j = {
    bodega, finca: b?.finca || bodega, fecha: hoy(), empleado: emp.codigo, nombre: emp.nombre,
    codigoLabor: labor.codigo, labor: labor.nombre, unidad: labor.unidad, plan,
    real: null, inicio: ahora.toISOString(), fin: null, horas: null, estado: 'abierta',
    registro: (await usuarios.sesion())?.nombre || '', cierre: '', exportado: 0, exportadoEn: null,
  };
  j.n = await db.put('jornadas', j);
  await db.fijarAjuste(`laborEmp:${emp.codigo}`, labor.nombre);
  return j;
}

async function guardarCierre(j, real, fin) {
  const c = { ...j, real, fin, horas: horasEntre(j.inicio, fin), estado: 'cerrada', cierre: (await usuarios.sesion())?.nombre || '' };
  await db.put('jornadas', c);
  return c;
}

// ---------- Diálogos ----------
/** Teclado grande para una cantidad. Resuelve con el número o null. */
function pedirNumero({ titulo, subtitulo, unidad, valor = '' }) {
  let v = valor ? String(valor).replace('.', ',') : '';
  const visor = h('div.cantidad-visor');
  const pintar = () => { visor.textContent = v || '0'; };
  pintar();
  return new Promise((resolve) => {
    let cerrarDlg;
    const teclado = tecladoNumerico({
      decimal: true,
      alTeclear: (k) => {
        if (k === 'cancelar') { cerrarDlg(null); return; }
        if (k === 'ok') {
          const n = Number(v.replace(',', '.'));
          if (n > 0) cerrarDlg(n); else { sonidoError(); visor.classList.add('sacudir'); setTimeout(() => visor.classList.remove('sacudir'), 400); }
          return;
        }
        if (k === 'borrar') v = v.slice(0, -1);
        else if (k === ',') { if (!v.includes(',')) v = (v || '0') + ','; } else if (v.replace(',', '').length < 7) v = v === '0' ? k : v + k;
        pintar();
      },
    });
    dialogo({
      titulo, clase: 'dialogo-numero',
      contenido: h('div', subtitulo ? h('p.persona-sub', subtitulo) : null, h('div.cantidad-fila', visor, h('div.cantidad-und', unidad)), teclado.elemento),
      botones: [],
      alAbrir: (caja, cerrar) => { cerrarDlg = cerrar; },
    }).then((r) => { teclado.destruir(); resolve(r); });
  });
}

async function flujoInicio(bodega, emp) {
  const nombre = await listaLabores.elegir(bodega, {
    titulo: `¿Qué labor hace ${primerNombre(emp.nombre)}?`, subtitulo: `${emp.nombre} · ${emp.codigo}`,
    sugerida: await db.ajuste(`laborEmp:${emp.codigo}`, ''),
  });
  const labor = nombre && porNombre.get(nombre);
  if (!labor) return { texto: 'Jornada no iniciada.', tipo: '' };
  const plan = await pedirNumero({
    titulo: `¿Cuántas ${labor.unidad}?`, subtitulo: `${emp.nombre} · ${labor.nombre} (${labor.codigo})`,
    unidad: labor.unidad, valor: labor.unidad === 'horas' ? 8 : '',
  });
  if (plan == null) return { texto: 'Jornada no iniciada.', tipo: '' };
  const j = await guardarInicio(bodega, emp, labor, plan);
  sonidoGuardado();
  return { texto: `▶ ${emp.nombre}: ${j.labor} · ${num(plan)} ${j.unidad} · inicio ${hhmm(j.inicio)}`, tipo: 'ok' };
}

/** Cierra una jornada abierta pidiendo la cantidad real. Resuelve la jornada cerrada o null. */
export async function flujoCierre(j) {
  let fin = new Date().toISOString();
  if (j.fecha !== hoy()) {
    // Quedó abierta de otro día: la hora de fin la dice el encargado.
    const v = await formulario(`Jornada sin cerrar del ${j.fecha}`, [
      { nombre: 'hora', etiqueta: `${j.nombre} · ${j.labor} · inicio ${hhmm(j.inicio)}. ¿A qué hora terminó?`, tipo: 'time', valor: '', requerido: true },
    ], { aceptar: 'Continuar', validar: (x) => (new Date(`${j.fecha}T${x.hora}`) > new Date(j.inicio) ? null : 'La hora de fin debe ser después del inicio.') });
    if (!v) return null;
    fin = new Date(`${j.fecha}T${v.hora}`).toISOString();
  }
  const horas = horasEntre(j.inicio, fin);
  const real = await pedirNumero({
    titulo: `Terminar: ${j.labor}`,
    subtitulo: `${j.nombre} · ${hhmm(j.inicio)} → ${hhmm(fin)} (${duracion(horas)}) · planeado ${num(j.plan)} ${j.unidad}`,
    unidad: j.unidad, valor: j.unidad === 'horas' ? Math.round(horas * 4) / 4 || '' : j.plan,
  });
  if (real == null) return null;
  if (Math.abs(real - j.plan) > DESVIO_JORNADA * j.plan) {
    sonidoError();
    const ok = await confirmar('Cantidad distinta a la planeada',
      `${num(real)} ${j.unidad} contra ${num(j.plan)} planeadas (${real > j.plan ? '+' : ''}${Math.round(((real - j.plan) / j.plan) * 100)} %). ¿Es correcto?`,
      { si: 'Sí, es correcto', no: 'Corregir' });
    if (!ok) return flujoCierre(j);
  }
  const c = await guardarCierre(j, real, fin);
  sonidoGuardado();
  return c;
}

/** Lo que pasa al escanear un carné. -> {texto, tipo} para el mensaje de la pantalla. */
export async function alEscanearCarne(codigo, bodega) {
  const emp = await empleados.obtener(codigo);
  if (!emp) return { texto: `Carné ${codigo} no está en la lista de empleados. Avise a la oficina.`, tipo: 'error' };
  if (emp.activo === false) return { texto: `${emp.nombre} está desactivado en nómina.`, tipo: 'error' };
  if (!emp.fincas.includes(bodega)
    && !(await confirmar('Empleado de otra finca', `${emp.nombre} es de ${emp.fincas.join(', ')}. ¿Registrar su jornada en ${bodega}?`, { si: 'Sí, registrar' }))) {
    return { texto: 'Jornada no registrada.', tipo: '' };
  }
  const abierta = await abiertaDe(emp.codigo);
  if (!abierta) return flujoInicio(bodega, emp);
  const c = await flujoCierre(abierta);
  if (!c) return { texto: `${emp.nombre} sigue en ${abierta.labor}.`, tipo: '' };
  const fin = `■ ${emp.nombre}: ${c.labor} · ${num(c.real)} ${c.unidad} · ${duracion(c.horas)}`;
  if (c.fecha === hoy() && await confirmar('Labor terminada', `${fin}. ¿Empieza otra labor ahora?`, { si: 'Sí, otra labor', no: 'No, terminó la jornada' })) {
    return flujoInicio(bodega, emp);
  }
  return { texto: fin, tipo: 'ok' };
}

// ---------- CSV para nómina ----------
async function pendientesCsv(bodega) {
  return (await deBodega(bodega)).filter((j) => j.estado === 'cerrada' && !j.exportado);
}

async function enviarCsv(bodega) {
  const lista = await pendientesCsv(bodega);
  if (!lista.length) { aviso('No hay jornadas terminadas sin enviar.', 'info'); return; }
  const filas = lista.map((j) => ({
    fecha: j.fecha, finca: j.finca, codigo_empleado: j.empleado, empleado: j.nombre, codigo_labor: j.codigoLabor, labor: j.labor,
    unidad: j.unidad, cantidad_plan: String(j.plan), cantidad_real: String(j.real), hora_inicio: hhmm(j.inicio), hora_fin: hhmm(j.fin),
    horas_reales: String(j.horas), registro_inicio: j.registro, registro_fin: j.cierre,
  }));
  const nombre = `jornadas_${hoy().replace(/-/g, '')}_${bodega}.csv`;
  const contenido = serializar(COLUMNAS_JORNADAS, filas);
  const r = await compartirArchivo(nombre, contenido, 'text/csv');
  if (r === 'cancelado') return;
  if (r === 'no-soportado') descargar(nombre, contenido);
  const ahora = new Date().toISOString();
  await db.tx('jornadas', 'readwrite', (s) => { for (const j of lista) s.jornadas.put({ ...j, exportado: 1, exportadoEn: ahora }); });
  aviso(`${nombre}: ${lista.length} jornada(s)`, 'ok', 5000);
  alMostrar();
}

// ---------- Pantalla ----------
let raiz = null;
let reloj = null;
let alCambio = () => {};

export function montar(contenedor, { alCambiarDatos } = {}) { raiz = contenedor; alCambio = alCambiarDatos || (() => {}); }
export function alOcultar() { clearInterval(reloj); reloj = null; }

export async function alMostrar() {
  const bod = await bodegas.bodegaActiva();
  vaciar(raiz);
  if (!bod) { raiz.append(h('p.vacio', 'No hay finca activa.')); return; }
  const todas = await deBodega(bod);
  const h0 = hoy(); const ahora = new Date().toISOString();
  const abiertas = todas.filter((j) => j.estado === 'abierta' && j.fecha === h0);
  const viejas = todas.filter((j) => j.estado === 'abierta' && j.fecha < h0);
  const hechas = todas.filter((j) => j.estado === 'cerrada' && j.fecha === h0);
  const horasHoy = hechas.reduce((s, j) => s + j.horas, 0) + abiertas.reduce((s, j) => s + horasEntre(j.inicio, ahora), 0);
  const personas = new Set([...abiertas, ...hechas].map((j) => j.empleado)).size;
  const pend = (await pendientesCsv(bod)).length;

  const terminar = (j) => h('button.btn.mini', { type: 'button', onclick: async () => { if (await flujoCierre(j)) { alCambio(); alMostrar(); } } }, 'Terminar');
  const desvio = (j) => (j.plan ? (j.real - j.plan) / j.plan : 0);
  const kpi = (valor, rotulo, clase = '') => h(`div.kpi${clase}`, h('div.kpi-valor', valor), h('div.kpi-rotulo', rotulo));

  raiz.append(
    h('div.kpis',
      kpi(String(abiertas.length), 'En labor ahora'),
      kpi(String(personas), 'Personas hoy'),
      kpi(num(Math.round(horasHoy * 10) / 10), 'Horas reales hoy'),
      kpi(String(viejas.length), 'Sin cerrar de días anteriores', viejas.length ? '.kpi-alerta' : '')),
    h('p.nota', 'Para empezar o terminar una labor, el empleado escanea su carné en la pantalla Escanear.'),
    viejas.length ? h('section.tarjeta.tarjeta-alerta',
      h('h2', '⚠ Jornadas sin cerrar de días anteriores'),
      h('p.nota', 'Termínelas con la hora real de salida para que las horas cuenten.'),
      h('div.tabla-scroll', h('table.tabla.tabla-jornada',
        h('thead', h('tr', h('th', 'Empleado · labor'), h('th', 'Inicio'), h('th', ''))),
        h('tbody', viejas.map((j) => h('tr', h('td', j.nombre, h('small.sub', `${j.labor} · ${j.codigoLabor}`)),
          h('td', j.fecha.slice(5), h('small.sub', hhmm(j.inicio))), h('td.acciones-celda', terminar(j)))))))) : null,
    h('section.tarjeta',
      h('h2', `En labor ahora · ${abiertas.length}`),
      abiertas.length ? h('div.tabla-scroll', h('table.tabla.tabla-jornada',
        h('thead', h('tr', h('th', 'Empleado · labor'), h('th.num', 'Lleva'), h('th', ''))),
        h('tbody', abiertas.map((j) => h('tr', h('td', j.nombre, h('small.sub', `${j.labor} · ${j.codigoLabor} · plan ${num(j.plan)} ${j.unidad}`)),
          h('td.num', duracion(horasEntre(j.inicio, ahora)), h('small.sub', `desde ${hhmm(j.inicio)}`)), h('td.acciones-celda', terminar(j)))))))
        : h('p.vacio', 'Nadie en labor.')),
    h('section.tarjeta',
      h('h2', `Terminadas hoy · ${hechas.length}`),
      hechas.length ? h('div.tabla-scroll', h('table.tabla.tabla-jornada',
        h('thead', h('tr', h('th', 'Empleado · labor'), h('th.num', 'Horas'), h('th.num', 'Real / plan'))),
        h('tbody', hechas.map((j) => h('tr', h('td', j.nombre, h('small.sub', `${j.labor} · ${j.codigoLabor}`)),
          h('td.num', num(j.horas), h('small.sub', `${hhmm(j.inicio)}–${hhmm(j.fin)}`)),
          h(`td.num${Math.abs(desvio(j)) > DESVIO_JORNADA ? '.desvio' : ''}`, `${num(j.real)} ${j.unidad}`, h('small.sub', `plan ${num(j.plan)}`)))))))
        : h('p.vacio', 'Todavía no hay labores terminadas.')),
    h('section.tarjeta',
      h('h2', 'Enviar a nómina'),
      h('p.nota', `${pend} jornada(s) terminada(s) sin enviar. El CSV lleva por persona y labor: código de nómina, unidad, cantidad planeada y real, hora de inicio y fin, y horas reales.`),
      h('button.btn.primario.btn-grande', { type: 'button', disabled: !pend, onclick: () => enviarCsv(bod) }, 'Enviar CSV de jornadas')));
  clearInterval(reloj);
  reloj = setInterval(() => { if (!document.querySelector('.capa')) alMostrar(); }, 60000);
}
