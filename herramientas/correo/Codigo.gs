/**
 * Agrap Scan · Servicio de correo (Google Apps Script)
 *
 * Recibe del teléfono el cierre del día YA AUTORIZADO por el encargado y lo manda por
 * correo desde la cuenta de Google de la empresa. Los destinatarios viven AQUÍ, en las
 * propiedades del script: el teléfono no puede escoger a quién se manda (así nadie lo usa
 * para mandar correos a otros).
 *
 * Propiedades del script (Configuración del proyecto › Propiedades del script):
 *   CLAVE          una clave larga; la misma que se pone en Oficina › Correo
 *   DESTINATARIOS  correos separados por coma (nómina, materiales, gerencia…)
 *   NOMBRE         nombre del remitente (por defecto «Agrap Scan»)
 *
 * Publicar: Implementar › Nueva implementación › Aplicación web ·
 *   Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
 * La URL que termina en /exec es la que se pone en Oficina › Correo.
 */

const MAX_POR_HORA = 30;            // freno por si algo se enloquece
const MAX_BYTES = 20 * 1024 * 1024; // adjuntos (Gmail permite 25 MB)

function doGet() {
  return json({ ok: true, app: 'agrap-correo', version: 1 });
}

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const clave = props.getProperty('CLAVE');
    const para = (props.getProperty('DESTINATARIOS') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
    if (!clave || !para.length) return json({ ok: false, error: 'El servicio no tiene CLAVE o DESTINATARIOS configurados.' });

    const d = JSON.parse(e.postData.contents);
    if (d.clave !== clave) return json({ ok: false, error: 'Clave incorrecta. Revise Oficina › Correo.' });

    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('envios') || 0);
    if (n >= MAX_POR_HORA) return json({ ok: false, error: 'Demasiados correos en la última hora. Intente más tarde.' });

    const adjuntos = (d.adjuntos || []).map(function (a) {
      return Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', a.nombre);
    });
    const peso = adjuntos.reduce(function (s, b) { return s + b.getBytes().length; }, 0);
    if (peso > MAX_BYTES) return json({ ok: false, error: 'Los adjuntos pasan de 20 MB.' });

    MailApp.sendEmail({
      to: para.join(','),
      subject: String(d.asunto || 'Agrap Scan').slice(0, 200),
      htmlBody: String(d.html || ''),
      body: String(d.texto || ''),
      attachments: adjuntos,
      name: props.getProperty('NOMBRE') || 'Agrap Scan',
    });
    cache.put('envios', String(n + 1), 3600);
    return json({ ok: true, destinatarios: para.length, adjuntos: adjuntos.length });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
