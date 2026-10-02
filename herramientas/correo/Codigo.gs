/**
 * Agrap Scan · Servicio de correo (Google Apps Script)
 *
 * Igual que el módulo Correo de AGRAP, pero sin servidor propio: corre en la cuenta de
 * Google con la que se publica (la MISMA de AGRAP, agritravecedo@gmail.com, para que el
 * correo salga del mismo remitente).
 *
 *  - El teléfono entrega el cierre YA AUTORIZADO por el encargado (clave CLAVE).
 *  - Los contactos, la copia, la firma y el nombre los manda la OFICINA (clave CLAVE_ADMIN,
 *    que nunca viaja a los teléfonos). El teléfono no escoge a quién se manda.
 *  - Cada envío, bueno o fallido, queda en una hoja de cálculo («bitácora»), que la
 *    Oficina lee para ver los envíos de todas las fincas.
 *
 * Propiedades del script (Configuración del proyecto › Propiedades del script):
 *   CLAVE        clave de los teléfonos (mín. 12 caracteres)
 *   CLAVE_ADMIN  clave de la oficina (otra distinta, mín. 12)
 * Lo demás (CONTACTOS, NOMBRE, FIRMA, HOJA_ID) lo escribe el propio servicio.
 *
 * Publicar: Implementar › Nueva implementación › Aplicación web ·
 *   Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
 */

const MAX_POR_HORA = 30;
const MAX_BYTES = 20 * 1024 * 1024;
const RE_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function doGet() {
  return json({ ok: true, app: 'agrap-correo', version: 2 });
}

function doPost(e) {
  let d = {};
  try {
    d = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const tipo = d.tipo || 'envio';
    if (tipo === 'config' || tipo === 'bitacora') {
      if (!props.getProperty('CLAVE_ADMIN') || d.claveAdmin !== props.getProperty('CLAVE_ADMIN')) return json({ ok: false, error: 'Clave de oficina incorrecta.' });
      return json(tipo === 'config' ? guardarConfig(props, d) : leerBitacora(d.limite || 200));
    }
    if (!props.getProperty('CLAVE') || d.clave !== props.getProperty('CLAVE')) return json({ ok: false, error: 'Clave incorrecta. Revise Oficina › Correo.' });
    return json(enviar(props, d, tipo === 'prueba'));
  } catch (err) {
    const msg = String(err && err.message || err);
    try { registrar({ bodega: d.bodega, rango: d.rango, asunto: d.asunto, autorizadoPor: d.autorizadoPor, ok: false, error: msg }); } catch (e2) { /* sin hoja */ }
    return json({ ok: false, error: msg });
  }
}

/** La oficina manda contactos, nombre del remitente y firma. */
function guardarConfig(props, d) {
  const contactos = (d.contactos || []).map(function (c) {
    return { correo: String(c.correo || '').trim().toLowerCase(), nombre: String(c.nombre || '').trim(), cargo: String(c.cargo || '').trim(), rol: c.rol === 'copia' ? 'copia' : 'para', activo: c.activo !== false };
  }).filter(function (c) { return RE_CORREO.test(c.correo); });
  props.setProperty('CONTACTOS', JSON.stringify(contactos));
  props.setProperty('NOMBRE', String(d.nombre || 'Agrap Scan').slice(0, 60));
  props.setProperty('FIRMA', String(d.firma || '').slice(0, 2000));
  return { ok: true, contactos: contactos.length, activos: contactos.filter(function (c) { return c.activo; }).length, remitente: Session.getEffectiveUser().getEmail() };
}

function enviar(props, d, prueba) {
  const contactos = JSON.parse(props.getProperty('CONTACTOS') || '[]').filter(function (c) { return c.activo; });
  const para = contactos.filter(function (c) { return c.rol === 'para'; }).map(function (c) { return c.correo; });
  const cc = contactos.filter(function (c) { return c.rol === 'copia'; }).map(function (c) { return c.correo; });
  if (!para.length) return { ok: false, error: 'No hay contactos activos. La oficina debe agregarlos en Oficina › Correo.' };

  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('envios') || 0);
  if (n >= MAX_POR_HORA) return { ok: false, error: 'Demasiados correos en la última hora. Intente más tarde.' };

  const adjuntos = (d.adjuntos || []).map(function (a) {
    return Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', a.nombre);
  });
  const peso = adjuntos.reduce(function (s, b) { return s + b.getBytes().length; }, 0);
  if (peso > MAX_BYTES) return { ok: false, error: 'Los adjuntos pasan de 20 MB.' };

  const firma = props.getProperty('FIRMA') || '';
  const html = String(d.html || '') + (firma ? '<div style="margin-top:18px;padding-top:10px;border-top:1px solid #ddd;color:#5b6770;font-family:Arial,sans-serif;font-size:13px;white-space:pre-line">' + escapar(firma) + '</div>' : '');
  const asunto = String(d.asunto || 'Agrap Scan').slice(0, 200);
  MailApp.sendEmail({
    to: para.join(','), cc: cc.join(','), subject: asunto, htmlBody: html,
    body: String(d.texto || '') + (firma ? '\n\n' + firma : ''), attachments: adjuntos,
    name: props.getProperty('NOMBRE') || 'Agrap Scan',
  });
  cache.put('envios', String(n + 1), 3600);
  registrar({ bodega: d.bodega || (prueba ? 'PRUEBA' : ''), rango: d.rango || '', asunto: asunto, autorizadoPor: d.autorizadoPor || '', para: para.concat(cc).join(', '), adjuntos: adjuntos.map(function (b) { return b.getName(); }).join(', '), ok: true, error: '' });
  return { ok: true, destinatarios: para.length + cc.length, adjuntos: adjuntos.length };
}

// ---------- Bitácora en una hoja de cálculo ----------
function hoja() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('HOJA_ID');
  let libro = null;
  if (id) { try { libro = SpreadsheetApp.openById(id); } catch (e) { libro = null; } }
  if (!libro) {
    libro = SpreadsheetApp.create('Agrap Scan · Bitácora de correo');
    props.setProperty('HOJA_ID', libro.getId());
    libro.getSheets()[0].appendRow(['Fecha', 'Finca', 'Cierre', 'Asunto', 'Autorizó', 'Destinatarios', 'Adjuntos', 'Estado', 'Error']);
  }
  return libro.getSheets()[0];
}

function registrar(r) {
  hoja().appendRow([new Date(), r.bodega || '', r.rango || '', r.asunto || '', r.autorizadoPor || '', r.para || '', r.adjuntos || '', r.ok ? 'Enviado' : 'Falló', r.error || '']);
}

function leerBitacora(limite) {
  const h = hoja();
  const n = h.getLastRow() - 1;
  if (n < 1) return { ok: true, filas: [], hoja: h.getParent().getUrl() };
  const desde = Math.max(2, h.getLastRow() - limite + 1);
  const filas = h.getRange(desde, 1, h.getLastRow() - desde + 1, 9).getValues().reverse().map(function (f) {
    return { ts: new Date(f[0]).toISOString(), bodega: f[1], rango: f[2], asunto: f[3], autorizadoPor: f[4], para: f[5], adjuntos: f[6], ok: f[7] === 'Enviado', error: f[8] };
  });
  return { ok: true, filas: filas, hoja: h.getParent().getUrl() };
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
