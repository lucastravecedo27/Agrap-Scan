// Correo: el cierre del día (RDT, CSV de salidas, ingresos de personal y un resumen) sale
// por correo SOLO cuando el encargado lo autoriza con su PIN. Lo autorizado queda en cola y
// se manda solo apenas hay señal. El envío lo hace un servicio de Google Apps Script con la
// cuenta de la empresa (herramientas/correo/Codigo.gs); los destinatarios viven allá.
//   ajustes.correo           {url, clave, hora}      (lo pone la oficina; viaja en el catálogo)
//   ajustes.correoCola       envíos autorizados que todavía no han salido
//   ajustes.correoBitacora   últimos envíos, buenos y fallidos

import * as db from './db.js';
import * as bodegas from './bodegas.js';
import * as usuarios from './usuarios.js';
import * as ingresos from './ingresos.js';
import * as rdt from './rdt.js';
import { csvDe } from './exportar.js';
import { VERSION, FUNCIONES } from './config.js';
import { h, num, hoy, horaLocal, aviso, dialogo } from './ui.js';

const MAX_BITACORA = 50;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Configuración ----------
export const config = () => db.ajuste('correo', null);
export const configurado = async () => { const c = await config(); return !!(c && c.url && c.clave); };
export async function guardarConfig({ url, clave, hora }) {
  const u = String(url || '').trim();
  if (u && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) throw new Error('La URL debe ser la de la aplicación web de Apps Script (https://script.google.com/macros/s/…/exec).');
  if (u && String(clave || '').length < 12) throw new Error('La clave debe tener al menos 12 caracteres.');
  if (hora && !/^\d{2}:\d{2}$/.test(hora)) throw new Error('Hora inválida.');
  const previo = await config();
  await db.fijarAjuste('correo', { url: u, clave: String(clave || ''), hora: hora || '17:00', vista: previo?.vista || [] });
}

// ---------- Oficina: contactos, copia, firma y bitácora (como el módulo Correo de AGRAP) ----------
//   ajustes.correoOficina {claveAdmin, nombre, firma, contactos: [{correo, nombre, cargo, rol: 'para'|'copia', activo}]}
// La clave de oficina y la lista completa nunca viajan a los teléfonos.
export const RE_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const oficina = async () => db.ajuste('correoOficina', { claveAdmin: '', nombre: 'Agrap', firma: '', contactos: [] });
export async function guardarOficina(o) {
  const vistos = new Set();
  const contactos = (o.contactos || []).map((c) => ({ correo: String(c.correo || '').trim().toLowerCase(), nombre: String(c.nombre || '').trim(), cargo: String(c.cargo || '').trim(), rol: c.rol === 'copia' ? 'copia' : 'para', activo: c.activo !== false }))
    .filter((c) => RE_CORREO.test(c.correo) && !vistos.has(c.correo) && vistos.add(c.correo));
  await db.fijarAjuste('correoOficina', { claveAdmin: String(o.claveAdmin || ''), nombre: String(o.nombre || 'Agrap'), firma: String(o.firma || ''), contactos });
  // Lo que ven los teléfonos al autorizar: solo nombres de los activos (sin correos).
  const c = await config();
  if (c) await db.fijarAjuste('correo', { ...c, vista: contactos.filter((x) => x.activo).map((x) => x.nombre || x.correo.split('@')[0]) });
}

/** Manda contactos, nombre y firma al servicio (clave de oficina). */
export async function sincronizar() {
  const c = await config(); const o = await oficina();
  if (!c?.url) throw new Error('Falta la URL del servicio.');
  if ((o.claveAdmin || '').length < 12) throw new Error('Falta la clave de oficina (mín. 12 caracteres).');
  const r = await postear(c, { tipo: 'config', claveAdmin: o.claveAdmin, contactos: o.contactos, nombre: o.nombre, firma: o.firma });
  if (!r.ok) throw new Error(r.error || 'No se pudo sincronizar.');
  return r;
}

/** Bitácora de TODAS las fincas, guardada por el servicio en una hoja de cálculo. */
export async function bitacoraServicio() {
  const c = await config(); const o = await oficina();
  if (!c?.url || !o.claveAdmin) throw new Error('Configure la URL y la clave de oficina.');
  const r = await postear(c, { tipo: 'bitacora', claveAdmin: o.claveAdmin, limite: 200 });
  if (!r.ok) throw new Error(r.error || 'No se pudo leer la bitácora.');
  return r;
}

/** CSV de contactos (nombre,correo,cargo) — p. ej. exportados de AGRAP. Entran desactivados. */
export function leerContactosCsv(texto, actuales) {
  const filas = String(texto).replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.split(/[;,]/).map((x) => x.trim().replace(/^"|"$/g, '')));
  const enc = (filas.shift() || []).map((x) => x.toLowerCase());
  const i = { nombre: enc.indexOf('nombre'), correo: enc.indexOf('correo'), cargo: enc.indexOf('cargo') };
  if (i.correo < 0) throw new Error('El CSV debe tener una columna «correo» (y opcionales «nombre», «cargo»).');
  const ya = new Set(actuales.map((c) => c.correo));
  const nuevos = filas.filter((f) => RE_CORREO.test((f[i.correo] || '').toLowerCase()) && !ya.has(f[i.correo].toLowerCase()))
    .map((f) => ({ correo: f[i.correo].toLowerCase(), nombre: i.nombre >= 0 ? f[i.nombre] || '' : '', cargo: i.cargo >= 0 ? f[i.cargo] || '' : '', rol: 'para', activo: false }));
  return nuevos;
}

// ---------- Qué hay para mandar ----------
async function enCola() {
  const cola = await db.ajuste('correoCola', []);
  return {
    cola,
    lineas: new Set(cola.flatMap((e) => e.refs.lineas)),
    jornadas: new Set(cola.flatMap((e) => e.refs.jornadas)),
    ingresos: new Set(cola.flatMap((e) => e.refs.ingresos)),
  };
}

/** Lo pendiente de una bodega que todavía no está ni enviado ni en cola. */
export async function pendiente(bodega) {
  const ya = await enCola();
  const lineas = (await db.porIndice('lineas', 'bodega', bodega)).filter((l) => !l.exportado && !l.correoEn && !ya.lineas.has(l.n));
  // Con la jornada apagada no van RDT ni ingresos (las jornadas viejas se quedan en la base).
  const todas = FUNCIONES.jornada ? await db.porIndice('jornadas', 'bodega', bodega) : [];
  const jornadas = todas.filter((j) => j.estado === 'cerrada' && !j.exportado && !j.correoEn && !ya.jornadas.has(j.n));
  const abiertas = todas.filter((j) => j.estado === 'abierta');
  const ings = FUNCIONES.jornada ? (await ingresos.pendientes(bodega)).filter((i) => !i.enviado && !ya.ingresos.has(i.id)) : [];
  return { lineas, jornadas, abiertas, ingresos: ings, total: lineas.length + jornadas.length + ings.length };
}

/** ¿Ya pasó la hora de cierre y hay algo por autorizar? (para el aviso de la cabecera) */
export async function listoParaAutorizar(bodega) {
  const c = await config();
  if (!c?.url || !bodega) return null;
  const p = await pendiente(bodega);
  if (!p.total) return null;
  const ahora = horaLocal(new Date()).slice(0, 5);
  const viejos = [...p.lineas, ...p.jornadas].some((x) => x.fecha < hoy());
  return ahora >= (c.hora || '17:00') || viejos ? p : null;
}

// ---------- Armado del correo ----------
async function aBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function tabla(titulo, cols, filas) {
  if (!filas.length) return '';
  const th = cols.map((c, i) => `<th style="text-align:${i ? 'right' : 'left'};padding:6px 8px;border-bottom:2px solid #003b5c;font-size:12px;color:#5b6770">${esc(c)}</th>`).join('');
  const tr = filas.map((f) => `<tr>${f.map((v, i) => `<td style="text-align:${i ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #e3e5e0">${esc(v)}</td>`).join('')}</tr>`).join('');
  return `<h3 style="color:#003b5c;margin:22px 0 6px;font-size:16px">${esc(titulo)}</h3><table style="border-collapse:collapse;width:100%;font-size:14px">${th ? `<tr>${th}</tr>` : ''}${tr}</table>`;
}

/** Arma asunto, cuerpo y adjuntos de lo pendiente. No guarda nada. */
export async function armar(bodega, p, autorizadoPor) {
  const b = await bodegas.obtener(bodega);
  const finca = b?.finca || b?.nombre || bodega;
  const fechas = [...new Set([...p.lineas, ...p.jornadas].map((x) => x.fecha))].sort();
  const rango = fechas.length ? (fechas.length === 1 ? fechas[0] : `${fechas[0]} a ${fechas.at(-1)}`) : hoy();
  const adjuntos = [];

  // RDT: uno por día con labores terminadas
  for (const f of [...new Set(p.jornadas.map((j) => j.fecha))].sort()) {
    const r = await rdt.generar({ bodega, fecha: f, jornadas: p.jornadas.filter((j) => j.fecha === f) });
    adjuntos.push({ nombre: r.nombre, mime: r.blob.type, base64: await aBase64(r.blob) });
  }
  if (p.lineas.length) {
    const csv = await csvDe(p.lineas);
    adjuntos.push({ nombre: `salidas_${rango.replace(/-/g, '').replace(' a ', '-')}_${bodega}.csv`, mime: 'text/csv', base64: await aBase64(new Blob([csv])) });
  }
  if (p.ingresos.length) {
    const json = { app: 'agrap-salidas', tipo: 'ingresos', fecha: new Date().toISOString(), bodega, ingresos: p.ingresos };
    adjuntos.push({ nombre: `ingresos_${hoy().replace(/-/g, '')}_${bodega}.json`, mime: 'application/json', base64: await aBase64(new Blob([JSON.stringify(json)])) });
  }

  // Resumen: labores y materiales
  const porLabor = new Map();
  for (const j of p.jornadas) {
    const k = `${j.codigoLabor}|${j.labor}|${j.unidad}`;
    const a = porLabor.get(k) || { labor: `${j.labor} (${j.codigoLabor})`, unidad: j.unidad, personas: new Set(), horas: 0, cantidad: 0 };
    a.personas.add(j.carne); a.horas += j.horas || 0; a.cantidad += j.real || 0; porLabor.set(k, a);
  }
  const porMaterial = new Map();
  for (const l of p.lineas) {
    const a = porMaterial.get(l.codigo) || { producto: `${l.producto} (${l.codigo})`, unidad: l.unidad, cantidad: 0, entregas: 0 };
    a.cantidad += l.cantidad; a.entregas += 1; porMaterial.set(l.codigo, a);
  }
  const personas = new Set(p.jornadas.map((j) => j.carne)).size;
  const horas = p.jornadas.reduce((s, j) => s + (j.horas || 0), 0);
  const ahora = new Date();
  const asunto = `Agrap Scan · Cierre ${finca} · ${rango}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#10202b;max-width:720px">
<div style="background:#003b5c;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
<div style="font-size:22px;font-weight:bold;letter-spacing:.08em">AGRAP</div>
<div style="font-size:16px;margin-top:4px">Cierre de ${esc(finca)} · ${esc(rango)}</div></div>
<div style="background:#f9f9f7;padding:16px 20px;border-radius:0 0 10px 10px">
<p style="margin:0 0 6px"><b>Jornada:</b> ${personas} persona(s), ${num(Math.round(horas * 10) / 10)} horas medidas, ${p.jornadas.length} labor(es) terminada(s).</p>
<p style="margin:0 0 6px"><b>Salidas de bodega:</b> ${p.lineas.length} entrega(s) de ${porMaterial.size} material(es).</p>
${p.ingresos.length ? `<p style="margin:0 0 6px"><b>Personal nuevo:</b> ${p.ingresos.length} carné(s) en blanco con fotos (adjunto ingresos).</p>` : ''}
${p.abiertas.length ? `<p style="margin:8px 0;color:#a5281b"><b>⚠ ${p.abiertas.length} labor(es) siguen abiertas</b> y no van en este cierre.</p>` : ''}
${tabla('Labores', ['Labor', 'Personas', 'Horas', 'Cantidad'], [...porLabor.values()].map((a) => [a.labor, a.personas.size, num(Math.round(a.horas * 10) / 10), `${num(a.cantidad)} ${a.unidad}`]))}
${tabla('Materiales entregados', ['Material', 'Entregas', 'Cantidad'], [...porMaterial.values()].map((a) => [a.producto, a.entregas, `${num(a.cantidad)} ${a.unidad}`]))}
<p style="margin:22px 0 0;font-size:13px;color:#5b6770">Autorizado por <b>${esc(autorizadoPor)}</b> el ${esc(ahora.toLocaleString('es-CO'))}.<br>Adjuntos: ${adjuntos.map((a) => esc(a.nombre)).join(', ') || 'ninguno'}.<br>Enviado desde Agrap Scan v${VERSION}.</p>
</div></div>`;
  const texto = `Cierre de ${finca} · ${rango}\nJornada: ${personas} personas, ${p.jornadas.length} labores.\nSalidas: ${p.lineas.length} entregas.\nAutorizado por ${autorizadoPor}.`;
  return {
    id: `${bodega}-${Date.now()}`, bodega, rango, asunto, html, texto, adjuntos, autorizadoPor, autorizadoEn: ahora.toISOString(),
    refs: { lineas: p.lineas.map((l) => l.n), jornadas: p.jornadas.map((j) => j.n), ingresos: p.ingresos.map((i) => i.id) },
  };
}

// ---------- Cola y envío ----------
async function bitacora(reg) {
  const l = await db.ajuste('correoBitacora', []);
  await db.fijarAjuste('correoBitacora', [reg, ...l].slice(0, MAX_BITACORA));
}
export const leerBitacora = () => db.ajuste('correoBitacora', []);
export const leerCola = () => db.ajuste('correoCola', []);

async function marcarEnviado(envio) {
  const ahora = new Date().toISOString();
  const L = new Set(envio.refs.lineas); const J = new Set(envio.refs.jornadas);
  await db.tx(['lineas', 'jornadas'], 'readwrite', async (s) => {
    for (const n of L) { const l = await db.prom(s.lineas.get(n)); if (l) s.lineas.put({ ...l, exportado: 1, exportadoEn: l.exportadoEn || ahora, correoEn: ahora }); }
    for (const n of J) { const j = await db.prom(s.jornadas.get(n)); if (j) s.jornadas.put({ ...j, exportado: 1, exportadoEn: j.exportadoEn || ahora, correoEn: ahora }); }
  });
  if (envio.refs.ingresos.length) await ingresos.marcarEnviados(envio.refs.ingresos);
}

async function postear(c, cuerpo) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 90000);
  try {
    // text/plain: Apps Script no responde la consulta previa (CORS) de application/json.
    const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), redirect: 'follow', signal: ctl.signal });
    const j = await r.json().catch(() => ({ ok: false, error: `Respuesta inesperada del servicio (${r.status}).` }));
    return j;
  } finally { clearTimeout(t); }
}

let enviando = false;
/** Manda lo que está en cola (autorizado). Se llama sola al abrir, al volver la señal y cada rato. */
export async function procesarCola() {
  if (enviando || !navigator.onLine) return { enviados: 0 };
  const c = await config();
  if (!c?.url) return { enviados: 0 };
  enviando = true;
  let enviados = 0;
  try {
    for (const envio of await db.ajuste('correoCola', [])) {
      let r;
      try { r = await postear(c, { tipo: 'envio', clave: c.clave, bodega: envio.bodega, rango: envio.rango, autorizadoPor: envio.autorizadoPor, asunto: envio.asunto, html: envio.html, texto: envio.texto, adjuntos: envio.adjuntos }); } catch (e) { r = { ok: false, error: e.name === 'AbortError' ? 'Sin respuesta (señal débil).' : 'Sin conexión.' }; }
      const reg = { ts: new Date().toISOString(), bodega: envio.bodega, rango: envio.rango, asunto: envio.asunto, adjuntos: envio.adjuntos.map((a) => a.nombre), autorizadoPor: envio.autorizadoPor, ok: !!r.ok, error: r.ok ? '' : r.error, destinatarios: r.destinatarios || 0 };
      await bitacora(reg);
      if (!r.ok) {
        // Clave o configuración mala: no tiene caso reintentar hasta que la corrijan; la señal sí.
        const cola = await db.ajuste('correoCola', []);
        await db.fijarAjuste('correoCola', cola.map((e) => (e.id === envio.id ? { ...e, intentos: (e.intentos || 0) + 1, error: r.error } : e)));
        if (!/conexión|señal/i.test(r.error)) aviso(`Correo no enviado: ${r.error}`, 'error', 6000);
        break;
      }
      await marcarEnviado(envio);
      await db.fijarAjuste('correoCola', (await db.ajuste('correoCola', [])).filter((e) => e.id !== envio.id));
      enviados++;
    }
  } finally { enviando = false; }
  if (enviados) aviso(`📧 ${enviados} correo(s) de cierre enviados.`, 'ok', 5000);
  return { enviados };
}

/** Revisión + autorización con PIN. -> true si quedó autorizado (y en cola). */
export async function revisarYAutorizar(bodega) {
  if (!(await configurado())) { aviso('El correo no está configurado. La oficina debe ponerlo en Oficina › Correo y enviar el catálogo.', 'error', 6000); return false; }
  const p = await pendiente(bodega);
  if (!p.total) { aviso('No hay nada pendiente para enviar.', 'info'); return false; }
  const s = await usuarios.sesion();
  const quien = s?.nombre || 'Encargado (PIN)';
  const previa = await armar(bodega, p, quien);
  const caja = h('div.correo-previa');
  caja.innerHTML = previa.html; // armado aquí mismo, con todo escapado
  const ok = await dialogo({
    titulo: 'Cierre del día: revisar y autorizar',
    clase: 'dialogo-correo',
    contenido: h('div', h('p.nota', `Se enviará a ${(await config())?.vista?.length ? (await config()).vista.join(', ') : 'los contactos de la oficina'} con ${previa.adjuntos.length} adjunto(s): ${previa.adjuntos.map((a) => a.nombre).join(', ')}.`), caja),
    botones: [{ texto: 'Ahora no', valor: false }, { texto: '✓ Autorizar y enviar', clase: 'primario', valor: true }],
  });
  if (!ok) return false;
  if (!(await bodegas.exigirPinSiempre('Autorizar el envío del cierre por correo.'))) return false;
  await db.fijarAjuste('correoCola', [...(await db.ajuste('correoCola', [])), previa]);
  aviso(navigator.onLine ? 'Autorizado. Enviando…' : 'Autorizado. Se enviará apenas haya señal.', 'ok', 4000);
  await procesarCola();
  return true;
}

/** Correo de prueba (desde la oficina o Ajustes). */
export async function probar() {
  const c = await config();
  if (!c?.url) throw new Error('Falta la URL del servicio.');
  const r = await postear(c, { tipo: 'prueba', clave: c.clave, asunto: 'Agrap Scan · correo de prueba', html: `<p>Prueba de correo desde Agrap Scan v${VERSION} (${esc(new Date().toLocaleString('es-CO'))}).</p>`, texto: 'Prueba de correo desde Agrap Scan.', adjuntos: [] });
  if (!r.ok) throw new Error(r.error || 'No se pudo enviar.');
  return r;
}

/** Arranque: manda la cola al abrir, al volver la señal y cada 3 minutos. */
export function vigilar() {
  procesarCola();
  window.addEventListener('online', () => procesarCola());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) procesarCola(); });
  setInterval(() => procesarCola(), 180000);
}

// ---------- Tarjeta «Cierre del día» (Registros y Jornada) ----------
export async function tarjeta(bodega, alCambio = () => {}) {
  if (!(await configurado())) return null;
  const p = await pendiente(bodega);
  const cola = (await leerCola()).filter((e) => e.bodega === bodega);
  const ult = (await leerBitacora()).find((r) => r.bodega === bodega);
  const partes = [p.jornadas.length ? `${p.jornadas.length} labor(es)` : '', p.lineas.length ? `${p.lineas.length} salida(s)` : '', p.ingresos.length ? `${p.ingresos.length} ingreso(s)` : ''].filter(Boolean);
  return h('section.tarjeta.tarjeta-correo',
    h('h2', '📧 Cierre del día por correo'),
    partes.length ? h('p', h('strong', 'Pendiente: '), partes.join(', '), '.') : h('p.vacio', 'Nada pendiente por enviar.'),
    cola.length ? h('p.correo-cola', `⏳ ${cola.length} cierre(s) autorizados esperando señal para salir.`) : null,
    ult ? h('p.nota', `Último envío: ${new Date(ult.ts).toLocaleString('es-CO')} · ${ult.ok ? `✓ enviado a ${ult.destinatarios} correo(s)` : `✗ ${ult.error}`}`) : null,
    h('div.fila-botones',
      h('button.btn.primario.btn-grande', { type: 'button', disabled: !p.total, onclick: async () => { if (await revisarYAutorizar(bodega)) alCambio(); } }, 'Revisar y autorizar envío'),
      cola.length ? h('button.btn.secundario', { type: 'button', onclick: async () => { await procesarCola(); alCambio(); } }, 'Reintentar ahora') : null),
    h('p.nota', 'Solo sale con el PIN del encargado. Lo autorizado se manda solo apenas haya señal.'));
}
