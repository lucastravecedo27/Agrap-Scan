// Jornada: horas reales por persona. La persona escanea su carné al empezar (labor Agrosoft
// y cantidad planeada en su unidad de pago) y otra vez al terminar (cantidad real y, si la
// labor es por lote, los lotes). Un carné en blanco abre el ingreso de personal: fotos de la
// cédula y de la persona que se mandan a la oficina; mientras tanto ya puede trabajar.
// Salida: el RDT del día (Excel de nómina).

import * as db from './db.js';
import * as empleados from './empleados.js';
import * as ingresos from './ingresos.js';
import * as usuarios from './usuarios.js';
import * as bodegas from './bodegas.js';
import * as catalogo from './catalogo.js';
import * as rdt from './rdt.js';
import { crearLista } from './personas.js';
import { LABORES_NOMINA } from './labores-nomina.js';
import { DESVIO_JORNADA, formatoCarne } from './config.js';
import {
  h, vaciar, num, hoy, horaLocal, aviso, confirmar, dialogo, formulario, informar, tecladoNumerico,
  descargar, compartirArchivo, sonidoGuardado, sonidoError, tomarFoto,
} from './ui.js';

const porEtiqueta = new Map(LABORES_NOMINA.map((l) => [l.etiqueta, l]));
const listaLabores = crearLista({
  prefijo: 'laboresNomina',
  formatear: (t) => String(t || '').replace(/\s+/g, ' ').trim(),
  base: LABORES_NOMINA.map((l) => l.etiqueta),
  enterPrimera: true,
  cerrada: true,
  detalle: (n) => (porEtiqueta.get(n) ? `${porEtiqueta.get(n).codigo} · ${porEtiqueta.get(n).unidad}` : ''),
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
const primerNombre = (n) => { const p = String(n).split(' '); return p.length > 2 ? p[2] : p[p.length - 1]; };

// ---------- Datos ----------
export async function abiertaDe(carne) {
  return (await db.porIndice('jornadas', 'empleado', Number(carne))).find((j) => j.estado === 'abierta') || null;
}
export const deBodega = async (bodega) => (await db.porIndice('jornadas', 'bodega', bodega)).sort((a, b) => a.inicio.localeCompare(b.inicio));

/** Números de lote de la finca, sacados de sus destinos («LOTE 7» → 7). */
async function lotesDe(bodega) {
  const ls = (await catalogo.destinos(bodega, { incluirInactivos: false }))
    .map((d) => String(d.lote).match(/^LOTE\s*(\w+)$/i)?.[1]).filter(Boolean);
  return [...new Set(ls)].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
}

async function guardarInicio(bodega, persona, labor, plan) {
  const b = await bodegas.obtener(bodega);
  const ahora = new Date();
  const j = {
    bodega, finca: b?.finca || bodega, fecha: hoy(), empleado: Number(persona.carne), carne: Number(persona.carne),
    codigoEmpleado: persona.codigo || '', nombre: persona.nombre,
    codigoLabor: labor.codigo, labor: labor.nombre, und: labor.und, unidad: labor.unidad, porLote: labor.porLote, plan,
    real: null, lotes: [], inicio: ahora.toISOString(), fin: null, horas: null, estado: 'abierta',
    registro: (await usuarios.sesion())?.nombre || '', cierre: '', exportado: 0, exportadoEn: null,
  };
  j.n = await db.put('jornadas', j);
  await db.fijarAjuste(`laborCarne:${persona.carne}`, labor.etiqueta);
  return j;
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

/** Lotes donde se hizo la labor: uno o varios; con varios se reparte la cantidad. */
async function pedirLotes(bodega, j, real) {
  const lotes = await lotesDe(bodega);
  if (!lotes.length) return [];
  const marcados = new Set();
  const botones = lotes.map((l) => h('button.lote-boton', {
    type: 'button', 'aria-pressed': 'false',
    onclick: (e) => { if (marcados.has(l)) marcados.delete(l); else marcados.add(l); e.currentTarget.setAttribute('aria-pressed', String(marcados.has(l))); },
  }, l));
  const elegidos = await dialogo({
    titulo: '¿En qué lotes?', clase: 'dialogo-lotes',
    contenido: h('div', h('p.persona-sub', `${j.nombre} · ${j.labor} · ${num(real)} ${j.unidad}`), h('div.lotes-rejilla', botones)),
    botones: [{ texto: 'Sin lote', valor: [] }, { texto: 'Continuar', clase: 'primario', valor: () => lotes.filter((l) => marcados.has(l)) }],
  });
  if (elegidos == null) return null;
  if (elegidos.length <= 1) return elegidos.map((lote) => ({ lote, cantidad: real }));
  const out = []; let resta = real;
  for (const [k, lote] of elegidos.entries()) {
    if (k === elegidos.length - 1) { out.push({ lote, cantidad: Math.round(resta * 1000) / 1000 }); break; }
    const c = await pedirNumero({ titulo: `Lote ${lote}: ¿cuántas ${j.unidad}?`, subtitulo: `Quedan ${num(resta)} de ${num(real)} ${j.unidad} por repartir`, unidad: j.unidad });
    if (c == null) return null;
    if (c >= resta) { sonidoError(); aviso(`En el lote ${lote} debe quedar menos de ${num(resta)}: el resto va al último lote.`, 'error'); return pedirLotes(bodega, j, real); }
    out.push({ lote, cantidad: c }); resta -= c;
  }
  return out;
}

/** Un paso de foto: el toque en el botón abre la cámara (los teléfonos no la abren sin un toque). */
const pasoFoto = (titulo, texto, lado) => dialogo({
  titulo, contenido: h('p.dialogo-texto', texto),
  botones: [{ texto: 'Cancelar', valor: null }, { texto: '📷 Tomar foto', clase: 'primario', valor: () => tomarFoto(lado, 0.8) }],
});

/** Carné en blanco: fotos de la cédula y de la persona para la oficina. */
async function registrarIngreso(carne, bodega) {
  const ok = await confirmar(`Carné ${formatoCarne(carne)} sin asignar`, h('div',
    h('p.dialogo-texto', 'Es una persona nueva. Tome dos fotos: la cédula (por delante, que se lea) y la persona (de frente).'),
    h('p.dialogo-texto', 'La oficina la registra con esas fotos. Mientras tanto ya puede empezar a trabajar.')), { si: 'Continuar' });
  if (!ok) return null;
  const fotoCedula = await pasoFoto('Foto 1 de 2: la cédula', 'Por delante, completa y que se lean el número y el nombre.', 1280);
  if (!fotoCedula) return null;
  const fotoPersona = await pasoFoto('Foto 2 de 2: la persona', 'De frente, con la cara descubierta.', 800);
  if (!fotoPersona) return null;
  const listo = await confirmar('¿Se ven bien?', h('div.ingreso-fotos', h('img', { src: fotoCedula, alt: 'Cédula' }), h('img', { src: fotoPersona, alt: 'Persona' })), { si: 'Sí, guardar', no: 'Repetir' });
  if (!listo) return registrarIngreso(carne, bodega);
  return ingresos.crear({ carne, bodega, fotoCedula, fotoPersona, registro: (await usuarios.sesion())?.nombre || '' });
}

async function flujoInicio(bodega, persona) {
  const etiqueta = await listaLabores.elegir(bodega, {
    titulo: persona.codigo ? `¿Qué labor hace ${primerNombre(persona.nombre)}?` : '¿Qué labor hace la persona nueva?', subtitulo: `${persona.nombre} · carné ${formatoCarne(persona.carne)}`,
    sugerida: await db.ajuste(`laborCarne:${persona.carne}`, ''),
  });
  const labor = etiqueta && porEtiqueta.get(etiqueta);
  if (!labor) return { texto: 'Jornada no iniciada.', tipo: '' };
  const plan = await pedirNumero({
    titulo: `¿Cuántas ${labor.unidad}?`, subtitulo: `${persona.nombre} · ${labor.nombre} (${labor.codigo})`,
    unidad: labor.unidad, valor: labor.und === 'hora' ? 8 : '',
  });
  if (plan == null) return { texto: 'Jornada no iniciada.', tipo: '' };
  const j = await guardarInicio(bodega, persona, labor, plan);
  sonidoGuardado();
  return { texto: `▶ ${persona.nombre}: ${j.labor} · ${num(plan)} ${j.unidad} · inicio ${hhmm(j.inicio)}`, tipo: 'ok' };
}

/** Cierra una jornada abierta pidiendo la cantidad real (y los lotes). Resuelve la jornada cerrada o null. */
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
    unidad: j.unidad, valor: j.und === 'hora' ? Math.round(horas * 4) / 4 || '' : j.plan,
  });
  if (real == null) return null;
  if (Math.abs(real - j.plan) > DESVIO_JORNADA * j.plan) {
    sonidoError();
    const ok = await confirmar('Cantidad distinta a la planeada',
      `${num(real)} ${j.unidad} contra ${num(j.plan)} planeadas (${real > j.plan ? '+' : ''}${Math.round(((real - j.plan) / j.plan) * 100)} %). ¿Es correcto?`,
      { si: 'Sí, es correcto', no: 'Corregir' });
    if (!ok) return flujoCierre(j);
  }
  const lotes = j.porLote ? await pedirLotes(j.bodega, j, real) : [];
  if (lotes == null) return null;
  const c = { ...j, real, lotes, fin, horas, estado: 'cerrada', cierre: (await usuarios.sesion())?.nombre || '' };
  await db.put('jornadas', c);
  sonidoGuardado();
  return c;
}

/** Lo que pasa al escanear un carné. -> {texto, tipo} para el mensaje de la pantalla. */
export async function alEscanearCarne(carne, bodega) {
  const n = Number(carne);
  const emp = await empleados.porCarne(n);
  let persona;
  if (emp) {
    if (emp.activo === false) return { texto: `${emp.nombre} está desactivado en nómina.`, tipo: 'error' };
    if (!emp.fincas.includes(bodega)
      && !(await confirmar('Empleado de otra finca', `${emp.nombre} es de ${emp.fincas.join(', ')}. ¿Registrar su jornada en ${bodega}?`, { si: 'Sí, registrar' }))) {
      return { texto: 'Jornada no registrada.', tipo: '' };
    }
    persona = { carne: n, codigo: emp.codigo, nombre: emp.nombre };
  } else {
    const pendiente = (await ingresos.deCarne(n)) || (await registrarIngreso(n, bodega));
    if (!pendiente) return { texto: `Carné ${formatoCarne(n)}: ingreso no registrado.`, tipo: '' };
    persona = { carne: n, codigo: '', nombre: `Nuevo · carné ${formatoCarne(n)}` };
  }
  const abierta = await abiertaDe(n);
  if (!abierta) return flujoInicio(bodega, persona);
  const c = await flujoCierre(abierta);
  if (!c) return { texto: `${persona.nombre} sigue en ${abierta.labor}.`, tipo: '' };
  const fin = `■ ${persona.nombre}: ${c.labor} · ${num(c.real)} ${c.unidad} · ${duracion(c.horas)}`;
  if (c.fecha === hoy() && await confirmar('Labor terminada', `${fin}. ¿Empieza otra labor ahora?`, { si: 'Sí, otra labor', no: 'No, terminó la jornada' })) {
    return flujoInicio(bodega, persona);
  }
  return { texto: fin, tipo: 'ok' };
}

// ---------- Envíos ----------
async function descargarRdt(bodega, fecha) {
  const jornadas = (await deBodega(bodega)).filter((j) => j.fecha === fecha && j.estado === 'cerrada');
  if (!jornadas.length) { aviso('Ese día no tiene labores terminadas.', 'info'); return; }
  const r = await rdt.generar({ bodega, fecha, jornadas });
  const res = await compartirArchivo(r.nombre, r.blob, r.blob.type);
  if (res === 'cancelado') return;
  if (res === 'no-soportado') descargar(r.nombre, r.blob);
  const ahora = new Date().toISOString();
  await db.tx('jornadas', 'readwrite', (s) => { for (const j of jornadas) s.jornadas.put({ ...j, exportado: 1, exportadoEn: j.exportadoEn || ahora }); });
  if (r.sinCodigo) informar('RDT con personas sin código', `${r.sinCodigo} fila(s) son de personas nuevas que la oficina aún no registra: van sin código y con la nota «SIN CÓDIGO». Cuando llegue el catálogo con su registro, vuelva a descargar el RDT.`);
  else aviso(`${r.nombre}: ${r.filas} fila(s)`, 'ok', 5000);
  alMostrar();
}

async function enviarIngresos(bodega) {
  const json = await ingresos.archivo(bodega);
  if (!json.ingresos.length) return;
  const nombre = `ingresos_${hoy().replace(/-/g, '')}_${bodega}.json`;
  const texto = JSON.stringify(json);
  const r = await compartirArchivo(nombre, texto, 'application/json');
  if (r === 'cancelado') return;
  if (r === 'no-soportado') descargar(nombre, texto, 'application/json');
  await ingresos.marcarEnviados(json.ingresos.map((i) => i.id));
  aviso(`${json.ingresos.length} ingreso(s) enviados a la oficina`, 'ok', 5000);
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
  const personas = new Set([...abiertas, ...hechas].map((j) => j.carne)).size;
  const pendIng = await ingresos.pendientes(bod);
  const dias = [...new Set(todas.filter((j) => j.estado === 'cerrada').map((j) => j.fecha))].sort().reverse().slice(0, 21);

  const terminar = (j) => h('button.btn.mini', { type: 'button', onclick: async () => { if (await flujoCierre(j)) { alCambio(); alMostrar(); } } }, 'Terminar');
  const desvio = (j) => (j.plan ? (j.real - j.plan) / j.plan : 0);
  const kpi = (valor, rotulo, clase = '') => h(`div.kpi${clase}`, h('div.kpi-valor', valor), h('div.kpi-rotulo', rotulo));
  const lotesTxt = (j) => (j.lotes?.length ? ` · lote ${j.lotes.map((l) => (j.lotes.length > 1 ? `${l.lote} (${num(l.cantidad)})` : l.lote)).join(', ')}` : '');
  const selDia = h('select', dias.map((d) => h('option', { value: d }, d === h0 ? `Hoy (${d})` : d)));

  raiz.append(
    h('div.kpis',
      kpi(String(abiertas.length), 'En labor ahora'),
      kpi(String(personas), 'Personas hoy'),
      kpi(num(Math.round(horasHoy * 10) / 10), 'Horas reales hoy'),
      kpi(String(viejas.length), 'Sin cerrar de días anteriores', viejas.length ? '.kpi-alerta' : '')),
    h('p.nota', 'Para empezar o terminar una labor, la persona escanea su carné en la pantalla Escanear. Un carné en blanco registra a una persona nueva.'),
    viejas.length ? h('section.tarjeta.tarjeta-alerta',
      h('h2', '⚠ Jornadas sin cerrar de días anteriores'),
      h('p.nota', 'Termínelas con la hora real de salida para que las horas cuenten.'),
      h('div.tabla-scroll', h('table.tabla.tabla-jornada',
        h('thead', h('tr', h('th', 'Persona · labor'), h('th', 'Inicio'), h('th', ''))),
        h('tbody', viejas.map((j) => h('tr', h('td', j.nombre, h('small.sub', `${j.labor} · ${j.codigoLabor}`)),
          h('td', j.fecha.slice(5), h('small.sub', hhmm(j.inicio))), h('td.acciones-celda', terminar(j)))))))) : null,
    pendIng.length ? h('section.tarjeta.tarjeta-alerta',
      h('h2', `Personas nuevas para la oficina · ${pendIng.length}`),
      h('p.nota', 'Carnés en blanco con fotos de cédula y persona. Envíelos a la oficina; cuando los registre, llegan con el catálogo.'),
      h('div.ingresos-lista', pendIng.map((i) => h('div.ingreso',
        h('img', { src: i.fotoPersona, alt: '' }),
        h('div', h('strong', `Carné ${formatoCarne(i.carne)}`), h('small.sub', `${i.fecha} · ${i.enviado ? 'enviado, esperando registro' : 'sin enviar'}`))))),
      h('button.btn.primario.btn-grande', { type: 'button', onclick: () => enviarIngresos(bod) }, 'Enviar ingresos a la oficina')) : null,
    h('section.tarjeta',
      h('h2', `En labor ahora · ${abiertas.length}`),
      abiertas.length ? h('div.tabla-scroll', h('table.tabla.tabla-jornada',
        h('thead', h('tr', h('th', 'Persona · labor'), h('th.num', 'Lleva'), h('th', ''))),
        h('tbody', abiertas.map((j) => h('tr', h('td', j.nombre, h('small.sub', `${j.labor} · ${j.codigoLabor} · plan ${num(j.plan)} ${j.unidad}`)),
          h('td.num', duracion(horasEntre(j.inicio, ahora)), h('small.sub', `desde ${hhmm(j.inicio)}`)), h('td.acciones-celda', terminar(j)))))))
        : h('p.vacio', 'Nadie en labor.')),
    h('section.tarjeta',
      h('h2', `Terminadas hoy · ${hechas.length}`),
      hechas.length ? h('div.tabla-scroll', h('table.tabla.tabla-jornada',
        h('thead', h('tr', h('th', 'Persona · labor'), h('th.num', 'Horas'), h('th.num', 'Real / plan'))),
        h('tbody', hechas.map((j) => h('tr', h('td', j.nombre, h('small.sub', `${j.labor} · ${j.codigoLabor}${lotesTxt(j)}`)),
          h('td.num', num(j.horas), h('small.sub', `${hhmm(j.inicio)}–${hhmm(j.fin)}`)),
          h(`td.num${Math.abs(desvio(j)) > DESVIO_JORNADA ? '.desvio' : ''}`, `${num(j.real)} ${j.unidad}`, h('small.sub', `plan ${num(j.plan)}`)))))))
        : h('p.vacio', 'Todavía no hay labores terminadas.')),
    h('section.tarjeta',
      h('h2', 'RDT para nómina'),
      h('p.nota', 'El Reporte Diario en el formato de Agrosoft: una fila por persona y labor terminada, con código, horas, unidades a pagar y lotes.'),
      dias.length ? h('div.fila-campos', h('label.campo', h('span', 'Día'), selDia)) : h('p.vacio', 'Todavía no hay labores terminadas.'),
      h('button.btn.primario.btn-grande', { type: 'button', disabled: !dias.length, onclick: () => descargarRdt(bod, selDia.value) }, '⇩ Descargar RDT')));
  clearInterval(reloj);
  reloj = setInterval(() => { if (!document.querySelector('.capa')) alMostrar(); }, 60000);
}
