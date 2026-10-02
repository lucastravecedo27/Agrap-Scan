// Pantalla Configuración (protegida por PIN): bodegas, catálogos, importación CSV,
// paquete inicial, PIN, respaldo y versión.

import * as db from './db.js';
import * as bodegas from './bodegas.js';
import * as catalogo from './catalogo.js';
import * as personas from './personas.js';
import * as labores from './labores.js';
import * as usuarios from './usuarios.js';
import { VERSION, COLUMNAS_PRODUCTOS, COLUMNAS_DESTINOS } from './config.js';
import {
  h, vaciar, num, aviso, confirmar, dialogo, formulario, informar, pedirPin,
  elegirArchivo, descargar, hoy, compartirArchivo,
  desbloquearAudio, sonidoOk, sonidoGuardado, sonidoError, fijarSonido,
} from './ui.js';

let raiz = null;
let alCambio = () => {};
let modo = 'oficina';
const estado = { bodega: null, buscar: '', limite: 60, pestana: 'productos' };

export function montar(contenedor, { alCambiarDatos, modo: m = 'oficina' }) {
  raiz = contenedor;
  alCambio = alCambiarDatos || (() => {});
  modo = m;
}

export async function alMostrar() {
  if (!(await bodegas.exigirAdmin(modo === 'finca' ? 'Ajustes es solo para el encargado.' : 'La oficina está protegida.'))) {
    vaciar(raiz).append(h('section.tarjeta', h('h2', modo === 'finca' ? 'Ajustes' : 'Oficina'), h('p', 'Requiere el PIN de administrador.'),
      h('button.btn.primario.btn-grande', { type: 'button', onclick: alMostrar }, 'Ingresar PIN')));
    return;
  }
  if (modo === 'finca') await pintarFinca(); else await pintar();
}

// ---------- Finca: solo recibir el catálogo de la oficina ----------
async function pintarFinca() {
  bodegas.renovarAdmin();
  vaciar(raiz);
  if (await bodegas.pinEsPorDefecto()) {
    raiz.append(h('div.alerta.alerta-aviso', h('strong', 'El PIN sigue siendo 1234.'), ' Cámbielo abajo para que nadie más cambie la finca.'));
  }
  const lista = await bodegas.listar();
  const recibido = await db.ajuste('catalogoRecibido', null);
  const hayEjemplo = lista.some((b) => b.ejemplo);
  const resumen = [];
  for (const b of lista.filter((x) => x.activa !== false)) {
    resumen.push(h('li', `${b.codigo} · ${b.nombre}: ${(await catalogo.productos(b.codigo, { incluirInactivos: false })).length} productos, ${(await catalogo.destinos(b.codigo, { incluirInactivos: false })).length} destinos${b.ejemplo ? ' (EJEMPLO)' : ''}`));
  }
  raiz.append(h('section.tarjeta',
    h('h2', 'Catálogo de la oficina'),
    h('p.nota', 'Los productos y destinos se manejan en la oficina. Cuando le manden el archivo catalogo_….json por WhatsApp, guárdelo en Archivos y cárguelo aquí.'),
    hayEjemplo ? h('div.alerta.alerta-info', 'Este teléfono tiene el catálogo de EJEMPLO. Al recibir el de la oficina se reemplaza.') : null,
    h('p', recibido ? `Último catálogo recibido: ${new Date(recibido).toLocaleString('es-CO')}` : 'Todavía no se ha recibido catálogo de la oficina.'),
    h('ul.resumen', resumen),
    h('button.btn.primario.btn-grande', { type: 'button', onclick: recibirCatalogo }, '⇩ Recibir catálogo de la oficina')));
  raiz.append(await seccionAprendidos(personas, 'Personas que reciben', 'Nombre', 'Entregas', 'Todavía no hay nombres.'));
  raiz.append(await seccionAprendidos(labores, 'Labores', 'Labor', 'Despachos', 'Todavía no se ha escrito ninguna labor nueva.'));
  const sonido = await db.ajuste('sonido', true);
  const probar = (fn) => () => { desbloquearAudio(); fijarSonido(true); fn(); fijarSonido(chkSonido.checked); };
  const chkSonido = h('input', { type: 'checkbox', checked: sonido, onchange: async (e) => { await db.fijarAjuste('sonido', e.target.checked); fijarSonido(e.target.checked); aviso('Guardado', 'ok'); } });
  raiz.append(h('section.tarjeta',
    h('h2', 'Sonido'),
    h('label.campo.check', chkSonido, h('span', 'Pitar al leer un código')),
    h('div.fila-botones',
      h('button.btn.secundario', { type: 'button', onclick: probar(sonidoOk) }, '🔊 Pito de lectura'),
      h('button.btn.secundario', { type: 'button', onclick: probar(sonidoGuardado) }, '🔊 Pito de guardado'),
      h('button.btn.secundario', { type: 'button', onclick: probar(sonidoError) }, '🔊 Pito de error')),
    h('p.nota', 'Suba el volumen del iPhone con los botones laterales. El pito suena aunque el interruptor de silencio esté puesto.')));
  raiz.append(await seccionAjustes());
}

async function seccionAprendidos(lista_, titulo, columna, conteo, vacio) {
  const bod = await bodegas.bodegaActiva();
  const lista = bod ? await lista_.listar(bod, { soloAprendidos: true }) : [];
  return h('section.tarjeta',
    h('h2', `${titulo}${bod ? ` · ${bod}` : ''}`),
    h('p.nota', 'La app las aprende sola al escribirlas en cada despacho. Borre aquí las que quedaron mal escritas.'),
    lista.length ? h('div.tabla-scroll.corta', h('table.tabla',
      h('thead', h('tr', h('th', columna), h('th.num', conteo), h('th', ''))),
      h('tbody', lista.map((p) => h('tr', h('td', p.nombre), h('td.num', p.usos),
        h('td.acciones-celda', h('button.btn.mini', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Borrar?', `«${p.nombre}» deja de salir en las sugerencias. Los registros ya hechos no cambian.`, { si: 'Borrar', peligro: true }))) return;
            await lista_.eliminar(bod, p.nombre); pintarFinca();
          },
        }, 'Borrar'))))))) : h('p.vacio', vacio));
}

async function recibirCatalogo() {
  const [f] = await elegirArchivo({ aceptar: '.json,application/json' });
  if (!f) return;
  let json, info;
  try { json = JSON.parse(await f.text()); info = catalogo.validarActualizacion(json); } catch (e) { informar('Archivo no válido', e.message); return; }
  const hayEjemplo = (await bodegas.listar()).some((b) => b.ejemplo);
  const ok = await confirmar('Recibir catálogo', `Catálogo de la oficina del ${new Date(info.fecha).toLocaleString('es-CO')}: ${info.bodegas} bodega(s), ${info.productos} productos, ${info.destinos} destinos, ${info.usuarios} usuario(s). Los registros de salidas no se tocan.`, { si: 'Recibir' });
  if (!ok) return;
  try {
    const r = await catalogo.importarActualizacion(json, { reemplazarEjemplo: hayEjemplo });
    informar('Catálogo actualizado', `${r.bodegas} bodega(s), ${r.productos} productos, ${r.destinos} destinos y ${r.usuarios} usuario(s).`);
    alCambio(); pintarFinca();
  } catch (e) { aviso(e.message, 'error'); }
}

// ---------- Oficina: enviar catálogo a las fincas ----------
function seccionEnviar(lista) {
  const activas = lista.filter((b) => b.activa !== false);
  const marcas = lista.map((b) => h('input', { type: 'checkbox', value: b.codigo, checked: b.activa !== false }));
  const correr = async (forma) => {
    const cods = marcas.filter((m) => m.checked).map((m) => m.value);
    if (!cods.length) { aviso('Escoja al menos una bodega.', 'error'); return; }
    const json = await catalogo.exportarActualizacion(cods);
    const nombre = `catalogo_${hoy().replace(/-/g, '')}_${cods.length === activas.length ? 'todas' : cods.join('-')}.json`;
    const texto = JSON.stringify(json);
    if (forma === 'compartir') {
      const r = await compartirArchivo(nombre, texto, 'application/json');
      if (r === 'cancelado') return;
      if (r === 'no-soportado') descargar(nombre, texto, 'application/json');
    } else descargar(nombre, texto, 'application/json');
    aviso(`${nombre}: ${json.productos.length} productos, ${json.destinos.length} destinos`, 'ok', 5000);
  };
  return h('section.tarjeta.tarjeta-nuevos',
    h('h2', 'Enviar catálogo a las fincas'),
    h('p.nota', 'Genera un archivo con bodegas, productos, destinos y usuarios. Mándelo por WhatsApp al encargado: en el teléfono de la finca se carga en Ajustes › Recibir catálogo. Lo desactivado aquí queda desactivado allá.'),
    h('div.marcas-bodegas', lista.map((b, i) => h('label.campo.check', marcas[i], h('span', `${b.codigo} · ${b.nombre}`)))),
    h('div.fila-botones',
      h('button.btn.primario.btn-grande', { type: 'button', onclick: () => correr('compartir') }, 'Enviar (WhatsApp…)'),
      h('button.btn.secundario.btn-grande', { type: 'button', onclick: () => correr('descargar') }, '↓ Descargar archivo')));
}

const leerTexto = (f) => f.text();

async function pintar() {
  bodegas.renovarAdmin();
  const lista = await bodegas.listar();
  if (!estado.bodega || !lista.find((b) => b.codigo === estado.bodega)) estado.bodega = (await bodegas.bodegaActiva()) || lista[0]?.codigo || null;
  vaciar(raiz);

  if (await bodegas.pinEsPorDefecto()) {
    raiz.append(h('div.alerta.alerta-aviso', h('strong', 'El PIN sigue siendo 1234.'), ' Cámbielo abajo en «Seguridad» para que nadie más cambie la finca ni el catálogo.'));
  }
  if ((await db.ajuste('origenDatos')) === 'ejemplo' && lista.some((b) => b.ejemplo)) {
    raiz.append(h('div.alerta.alerta-info', h('strong', 'Está usando el catálogo de EJEMPLO.'), ' Cargue los datos reales con «Paquete inicial» (los 3 CSV de datos-iniciales).'));
  }

  raiz.append(await seccionNuevos(lista));
  raiz.append(seccionEnviar(lista));
  raiz.append(seccionBodegas(lista));
  raiz.append(await seccionUsuarios(lista));
  if (estado.bodega) raiz.append(await seccionCatalogo(lista));
  raiz.append(seccionPaquete(lista));
  raiz.append(await seccionAjustes());
}

// ---------- Productos nuevos ----------
/** Foto tomada con la cámara, reducida a 320 px para que quepa en la base sin pesar. */
async function tomarFoto() {
  const [f] = await new Promise((resolve) => {
    const i = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
    i.onchange = () => { resolve([...i.files]); i.remove(); };
    document.body.append(i); i.click();
  });
  if (!f) return null;
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const esc = Math.min(1, 320 / Math.max(img.width, img.height));
    const c = h('canvas', { width: Math.round(img.width * esc), height: Math.round(img.height * esc) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  } finally { URL.revokeObjectURL(url); }
}

async function seccionNuevos(lista) {
  const activas = lista.filter((b) => b.activa !== false);
  const actual = estado.bodega;
  const marcas = activas.map((b) => h('input', { type: 'checkbox', value: b.codigo, checked: b.codigo === actual }));
  const elegidas = () => marcas.filter((m) => m.checked).map((m) => m.value);
  const cats = new Set();
  for (const b of activas) (await catalogo.categorias(b.codigo)).forEach((c) => cats.add(c));
  const dl = h('datalist#lista-cat-nuevos', [...cats].sort().map((c) => h('option', { value: c })));
  const campo = (nombre, etiqueta, extra = {}) => h('label.campo', h('span', etiqueta), h('input', { name: nombre, autocomplete: 'off', ...extra }));
  const form = h('form.formulario-nuevo', { onsubmit: (e) => e.preventDefault() },
    h('div.fila-campos', campo('codigo', 'Código (el de WorldOffice)'), campo('nombre', 'Nombre')),
    h('div.fila-campos', campo('unidad', 'Unidad', { value: 'Und.' }), campo('categoria', 'Categoría', { list: 'lista-cat-nuevos' }), campo('promedio_referencia', 'Promedio (opcional)', { inputmode: 'decimal' })));
  let foto = '';
  const vistaFoto = h('img.foto-nuevo', { hidden: true, alt: '' });
  const btnFoto = h('button.btn.secundario', { type: 'button', onclick: async () => {
    const f = await tomarFoto(); if (!f) return;
    foto = f; vistaFoto.src = f; vistaFoto.hidden = false; btnFoto.textContent = '📷 Cambiar foto';
  } }, '📷 Tomar foto (opcional)');
  const ultimoAgregado = h('p.nota');

  const agregar = async () => {
    const v = Object.fromEntries(new FormData(form).entries());
    const bods = elegidas();
    if (!bods.length) { aviso('Escoja al menos una bodega.', 'error'); return; }
    if (!v.codigo || !v.nombre || !v.unidad || !v.categoria) { aviso('Faltan código, nombre, unidad o categoría.', 'error'); return; }
    const ya = [];
    for (const b of bods) if (await catalogo.producto(b, v.codigo.trim())) ya.push(b);
    if (ya.length && !(await confirmar('El código ya existe', `${v.codigo} ya está en ${ya.join(', ')}. ¿Reemplazar sus datos con estos?`, { si: 'Reemplazar' }))) return;
    try {
      for (const b of bods) await catalogo.guardarProducto(b, { ...v, foto_url: foto });
      aviso(`${v.nombre} agregado a ${bods.join(', ')}`, 'ok');
      ultimoAgregado.textContent = `Último agregado: ${v.codigo} · ${v.nombre} (${bods.join(', ')}). Recuerde imprimir su QR.`;
      form.querySelector('[name=codigo]').value = ''; form.querySelector('[name=nombre]').value = '';
      form.querySelector('[name=promedio_referencia]').value = '';
      foto = ''; vistaFoto.hidden = true; btnFoto.textContent = '📷 Tomar foto (opcional)';
      form.querySelector('[name=codigo]').focus();
    } catch (e) { aviso(e.message, 'error'); }
  };

  const subirLista = async () => {
    const bods = elegidas();
    if (!bods.length) { aviso('Escoja al menos una bodega.', 'error'); return; }
    const [f] = await elegirArchivo({ aceptar: '.csv,text/csv' });
    if (!f) return;
    const texto = await f.text();
    const analisis = [];
    for (const b of bods) analisis.push([b, await catalogo.analizarCsv(texto, 'productos', b)]);
    const falt = analisis[0][1].columnasFaltantes;
    if (falt.length) { informar('Formato incorrecto', `Faltan columnas: ${falt.join(', ')}. Use: ${COLUMNAS_PRODUCTOS.join(',')}`); return; }
    const ok = await dialogo({
      titulo: 'Subir productos nuevos',
      contenido: h('div',
        h('ul.resumen', analisis.map(([b, r]) => h('li', `${b}: ${r.nuevos} nuevos, ${r.actualizados} se actualizan, ${r.errores.length} con errores`))),
        tablaErrores(analisis[0][1].errores)),
      botones: [{ texto: 'Cancelar', valor: false }, { texto: 'Subir', clase: 'primario', valor: true }],
    });
    if (!ok) return;
    let n = 0;
    for (const [, r] of analisis) n += await catalogo.confirmarImportacion('productos', r.validos);
    aviso(`${n} producto(s) guardados`, 'ok');
    pintar();
  };

  return h('section.tarjeta.tarjeta-nuevos',
    h('h2', 'Productos nuevos'),
    h('p.nota', 'Agregue un producto que llegó a bodega. Puede crearlo en varias bodegas a la vez (cada una conserva sus propios datos).'),
    h('div.campo', h('span', 'Agregar en'), h('div.marcas-bodegas', activas.map((b, i) => h('label.campo.check', marcas[i], h('span', `${b.codigo} · ${b.nombre}`))))),
    dl, form,
    h('div.fila-botones', btnFoto, vistaFoto),
    h('div.fila-botones',
      h('button.btn.primario.btn-grande', { type: 'button', onclick: agregar }, '+ Agregar producto'),
      h('button.btn.secundario.btn-grande', { type: 'button', onclick: subirLista }, '⇧ Subir lista CSV'),
      h('button.btn.secundario.btn-grande', { type: 'button', onclick: () => irALibroNuevos(elegidas()[0] || actual) }, '🖨 Imprimir QR nuevos')),
    ultimoAgregado);
}

let irALibroNuevos = () => {};
export function alImprimirNuevos(fn) { irALibroNuevos = fn; }

// ---------- Bodegas ----------
function seccionBodegas(lista) {
  return h('section.tarjeta',
    h('h2', 'Bodegas / fincas'),
    h('table.tabla',
      h('thead', h('tr', h('th', 'Código'), h('th', 'Nombre'), h('th', 'Finca'), h('th', 'Responsable'), h('th', 'Estado'), h('th', ''))),
      h('tbody', lista.map((b) => h('tr', { class: b.activa === false ? 'inactivo' : '' },
        h('td', h('strong', b.codigo)), h('td', b.nombre, b.ejemplo ? h('span.etiqueta.vacio', 'ejemplo') : null), h('td', b.finca), h('td', b.responsable || '—'),
        h('td', b.activa === false ? 'Desactivada' : 'Activa'),
        h('td.acciones-celda',
          h('button.btn.mini', { type: 'button', onclick: () => editarBodega(b) }, 'Editar'),
          h('button.btn.mini', { type: 'button', onclick: async () => { await bodegas.fijarActiva(b.codigo, b.activa === false); alCambio(); pintar(); } }, b.activa === false ? 'Activar' : 'Desactivar')))))),
    h('div.fila-botones',
      h('button.btn.primario', { type: 'button', onclick: () => editarBodega(null, lista) }, '+ Nueva bodega'),
      h('button.btn.secundario', { type: 'button', disabled: lista.length < 2, onclick: () => copiar(lista) }, 'Copiar catálogo entre bodegas')));
}

// ---------- Usuarios ----------
async function seccionUsuarios(lista) {
  const us = await usuarios.listar();
  const nombreFinca = (c) => lista.find((b) => b.codigo === c)?.nombre || c;
  return h('section.tarjeta',
    h('h2', 'Usuarios que digitan'),
    h('p.nota', 'Cada usuario solo ve en el teléfono las fincas que tenga asignadas. Viajan en el catálogo: después de crear o cambiar un usuario, envíe el catálogo a esas fincas. Sin usuarios, el teléfono queda abierto como antes.'),
    us.length ? h('div.tabla-scroll', h('table.tabla',
      h('thead', h('tr', h('th', 'Nombre'), h('th', 'Usuario'), h('th', 'Fincas'), h('th', 'Estado'), h('th', ''))),
      h('tbody', us.map((u) => h('tr', { class: u.activo === false ? 'inactivo' : '' },
        h('td', u.nombre), h('td', h('strong', u.usuario)), h('td', u.fincas.map((f) => `${f} · ${nombreFinca(f)}`).join(', ')),
        h('td', u.activo === false ? 'Desactivado' : 'Activo'),
        h('td.acciones-celda',
          h('button.btn.mini', { type: 'button', onclick: () => editarUsuario(u, lista) }, 'Editar'),
          h('button.btn.mini', {
            type: 'button',
            onclick: async () => {
              if (!(await confirmar('¿Eliminar usuario?', `«${u.usuario}» ya no podrá ingresar después de enviar el catálogo. Sus registros no cambian.`, { si: 'Eliminar', peligro: true }))) return;
              await usuarios.eliminar(u.usuario); pintar();
            },
          }, 'Eliminar')))))))
      : h('p.vacio', 'Todavía no hay usuarios: los teléfonos entran sin contraseña.'),
    h('div.fila-botones', h('button.btn.primario', { type: 'button', disabled: !lista.length, onclick: () => editarUsuario(null, lista) }, '+ Nuevo usuario')));
}

async function editarUsuario(u, lista) {
  const v = await formulario(u ? `Editar ${u.usuario}` : 'Nuevo usuario', [
    { nombre: 'nombre', etiqueta: 'Nombre de la persona', valor: u?.nombre, requerido: true },
    { nombre: 'usuario', etiqueta: 'Usuario (sin espacios)', valor: u?.usuario, soloLectura: !!u, requerido: true },
    { nombre: 'clave', etiqueta: u ? 'Contraseña nueva (vacía = no cambia)' : 'Contraseña (mínimo 4)', tipo: 'password', requerido: !u },
    ...lista.map((b) => ({ nombre: `f_${b.codigo}`, etiqueta: `${b.codigo} · ${b.nombre}`, tipo: 'checkbox', valor: u ? u.fincas.includes(b.codigo) : lista.length === 1 })),
    { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox', valor: u ? u.activo !== false : true },
  ], { validar: (x) => (lista.some((b) => x[`f_${b.codigo}`]) ? null : 'Marque al menos una finca.') });
  if (!v) return;
  try {
    await usuarios.guardar({ ...v, fincas: lista.filter((b) => v[`f_${b.codigo}`]).map((b) => b.codigo) }, { nuevo: !u });
    aviso('Usuario guardado. Envíe el catálogo a sus fincas.', 'ok', 5000); pintar();
  } catch (e) { aviso(e.message, 'error'); }
}

async function editarBodega(b, lista = []) {
  const sugerido = `B${String((lista.map((x) => parseInt(x.codigo.slice(1), 10)).filter(Number.isFinite).reduce((a, c) => Math.max(a, c), 0)) + 1).padStart(2, '0')}`;
  const v = await formulario(b ? `Editar ${b.codigo}` : 'Nueva bodega', [
    { nombre: 'codigo', etiqueta: 'Código (B01, B02…)', valor: b?.codigo || sugerido, soloLectura: !!b, requerido: true, mayusculas: true },
    { nombre: 'nombre', etiqueta: 'Nombre', valor: b?.nombre, requerido: true },
    { nombre: 'finca', etiqueta: 'Finca', valor: b?.finca, requerido: true },
    { nombre: 'responsable', etiqueta: 'Responsable (va en el CSV)', valor: b?.responsable },
  ], { validar: (x) => bodegas.validar(bodegas.normalizar(x)) });
  if (!v) return;
  try {
    await bodegas.guardar({ ...b, ...v }, { nueva: !b });
    if (!(await bodegas.bodegaActiva())) await bodegas.asegurarActiva();
    aviso('Bodega guardada', 'ok'); alCambio(); pintar();
  } catch (e) { aviso(e.message, 'error'); }
}

async function copiar(lista) {
  const ops = lista.map((b) => ({ valor: b.codigo, texto: `${b.codigo} · ${b.nombre}` }));
  const v = await formulario('Copiar catálogo', [
    { nombre: 'origen', etiqueta: 'Copiar desde', tipo: 'select', opciones: ops, valor: estado.bodega },
    { nombre: 'destino', etiqueta: 'Hacia', tipo: 'select', opciones: ops, valor: ops.find((o) => o.valor !== estado.bodega)?.valor },
  ], { aceptar: 'Copiar', validar: (x) => (x.origen === x.destino ? 'Escoja dos bodegas distintas.' : null) });
  if (!v) return;
  const r = await bodegas.copiarCatalogo(v.origen, v.destino);
  informar('Catálogo copiado', `${r.productos} producto(s) y ${r.destinos} destino(s) copiados a ${v.destino}. Se omitieron ${r.omitidosP + r.omitidosD} que ya existían allí (no se pisan).`);
  pintar();
}

// ---------- Catálogo ----------
async function seccionCatalogo(lista) {
  const cod = estado.bodega;
  const selBod = h('select', { onchange: (e) => { estado.bodega = e.target.value; estado.limite = 60; pintar(); } },
    lista.map((b) => h('option', { value: b.codigo, selected: b.codigo === cod }, `${b.codigo} · ${b.nombre}`)));
  const tabs = h('div.segmentos',
    ['productos', 'destinos'].map((t) => h(`button.segmento${estado.pestana === t ? '.activo' : ''}`, { type: 'button', onclick: () => { estado.pestana = t; pintar(); } }, t === 'productos' ? 'Productos' : 'Destinos')));
  const cuerpo = estado.pestana === 'productos' ? await tablaProductos(cod) : await tablaDestinos(cod);
  return h('section.tarjeta',
    h('h2', 'Catálogo por bodega'),
    h('label.campo', h('span', 'Bodega'), selBod),
    tabs, cuerpo);
}

async function tablaProductos(cod) {
  const todos = await catalogo.productos(cod);
  const q = estado.buscar.toLowerCase();
  const filtrados = q ? todos.filter((p) => `${p.codigo} ${p.nombre} ${p.categoria}`.toLowerCase().includes(q)) : todos;
  const buscar = h('input', { type: 'search', placeholder: 'Buscar código, nombre o categoría', value: estado.buscar });
  buscar.addEventListener('input', () => {
    clearTimeout(buscar._t);
    buscar._t = setTimeout(() => { estado.buscar = buscar.value; estado.limite = 60; pintar().then(() => { const i = raiz.querySelector('input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 300);
  });
  return h('div',
    h('div.fila-botones',
      h('button.btn.primario', { type: 'button', onclick: () => editarProducto(cod, null) }, '+ Producto'),
      h('button.btn.secundario', { type: 'button', onclick: () => importar(cod, 'productos') }, '⇧ Importar CSV'),
      h('button.btn.secundario', { type: 'button', onclick: () => plantilla('productos', cod) }, 'Plantilla CSV')),
    h('label.campo', h('span', `${todos.length} productos · ${todos.filter((p) => p.activo === false).length} desactivados`), buscar),
    h('div.tabla-scroll', h('table.tabla',
      h('thead', h('tr', h('th', 'Código'), h('th', 'Nombre'), h('th', 'Und.'), h('th', 'Categoría'), h('th.num', 'Prom. ref.'), h('th', ''))),
      h('tbody', filtrados.slice(0, estado.limite).map((p) => h('tr', { class: p.activo === false ? 'inactivo' : '' },
        h('td', p.codigo), h('td', p.nombre), h('td', p.unidad), h('td', p.categoria), h('td.num', num(p.promedio_referencia)),
        h('td.acciones-celda',
          h('button.btn.mini', { type: 'button', onclick: () => editarProducto(cod, p) }, 'Editar'),
          h('button.btn.mini', { type: 'button', onclick: async () => { await catalogo.guardarProducto(cod, { ...p, activo: p.activo === false }); pintar(); } }, p.activo === false ? 'Activar' : 'Desactivar'))))))),
    filtrados.length > estado.limite ? h('button.btn.secundario', { type: 'button', onclick: () => { estado.limite += 200; pintar(); } }, `Ver más (${filtrados.length - estado.limite} restantes)`) : null);
}

async function editarProducto(cod, p) {
  const cats = await catalogo.categorias(cod);
  document.body.append(h('datalist#lista-categorias', cats.map((c) => h('option', { value: c }))));
  const v = await formulario(p ? `Editar ${p.codigo}` : `Nuevo producto en ${cod}`, [
    { nombre: 'codigo', etiqueta: 'Código (el de WorldOffice)', valor: p?.codigo, soloLectura: !!p, requerido: true },
    { nombre: 'nombre', etiqueta: 'Nombre', valor: p?.nombre, requerido: true },
    { nombre: 'unidad', etiqueta: 'Unidad', valor: p?.unidad || 'Und.', requerido: true },
    { nombre: 'categoria', etiqueta: 'Categoría', valor: p?.categoria, requerido: true, lista: 'lista-categorias' },
    { nombre: 'promedio_referencia', etiqueta: 'Promedio de referencia (opcional)', valor: p?.promedio_referencia ?? '', inputmode: 'decimal' },
    { nombre: 'foto_url', etiqueta: 'Foto (URL, opcional)', valor: p?.foto_url },
  ]);
  document.getElementById('lista-categorias')?.remove();
  if (!v) return;
  try { await catalogo.guardarProducto(cod, { ...p, ...v }, { nuevo: !p }); aviso('Producto guardado', 'ok'); pintar(); } catch (e) { aviso(e.message, 'error'); }
}

async function tablaDestinos(cod) {
  const todos = await catalogo.destinos(cod);
  return h('div',
    h('div.fila-botones',
      h('button.btn.primario', { type: 'button', onclick: () => editarDestino(cod, null) }, '+ Destino'),
      h('button.btn.secundario', { type: 'button', onclick: () => importar(cod, 'destinos') }, '⇧ Importar CSV'),
      h('button.btn.secundario', { type: 'button', onclick: () => plantilla('destinos', cod) }, 'Plantilla CSV')),
    h('div.tabla-scroll', h('table.tabla',
      h('thead', h('tr', h('th', 'Código'), h('th', 'Finca'), h('th', 'Lote'), h('th', 'Labor'), h('th', ''))),
      h('tbody', todos.map((d) => h('tr', { class: d.activo === false ? 'inactivo' : '' },
        h('td', d.codigo), h('td', d.finca), h('td', d.lote), h('td', d.labor || '— se escoge al escanear'),
        h('td.acciones-celda',
          h('button.btn.mini', { type: 'button', onclick: () => editarDestino(cod, d) }, 'Editar'),
          h('button.btn.mini', { type: 'button', onclick: async () => { await catalogo.guardarDestino(cod, { ...d, activo: d.activo === false }); pintar(); } }, d.activo === false ? 'Activar' : 'Desactivar'))))))));
}

async function editarDestino(cod, d) {
  const b = await bodegas.obtener(cod);
  const v = await formulario(d ? `Editar destino ${d.codigo}` : `Nuevo destino en ${cod}`, [
    { nombre: 'codigo', etiqueta: 'Código', valor: d?.codigo || await catalogo.siguienteCodigoDestino(cod), soloLectura: !!d, requerido: true },
    { nombre: 'finca', etiqueta: 'Finca', valor: d?.finca || b?.finca, requerido: true },
    { nombre: 'lote', etiqueta: 'Lote', valor: d?.lote, requerido: true },
    { nombre: 'labor', etiqueta: 'Labor (vacía: se escoge al escanear)', valor: d?.labor },
  ]);
  if (!v) return;
  try { await catalogo.guardarDestino(cod, { ...d, ...v }, { nuevo: !d }); aviso('Destino guardado', 'ok'); pintar(); } catch (e) { aviso(e.message, 'error'); }
}

function plantilla(tipo, cod) {
  const cols = tipo === 'productos' ? COLUMNAS_PRODUCTOS : COLUMNAS_DESTINOS;
  const ej = tipo === 'productos' ? '0045,GUANTE NITRILO,Und.,Elementos de protección personal,10,' : '001,DON GASPAR,LOTE 1,';
  descargar(`plantilla_${tipo}_${cod}.csv`, `${cols.join(',')}\r\n${ej}\r\n`);
}

function tablaErrores(errores) {
  if (!errores.length) return null;
  return h('div',
    h('h3', `${errores.length} fila(s) con errores (no se importan)`),
    h('div.tabla-scroll.corta', h('table.tabla',
      h('thead', h('tr', h('th', 'Fila'), h('th', 'Código'), h('th', 'Problema'))),
      h('tbody', errores.slice(0, 200).map((e) => h('tr', h('td', e.fila), h('td', e.codigo || '—'), h('td', e.motivos.join('; '))))))),
    errores.length > 200 ? h('p.nota', `… y ${errores.length - 200} más.`) : null);
}

async function importar(cod, tipo) {
  const [f] = await elegirArchivo({ aceptar: '.csv,text/csv' });
  if (!f) return;
  const r = await catalogo.analizarCsv(await leerTexto(f), tipo, cod);
  if (r.columnasFaltantes.length) {
    informar('Formato incorrecto', `Faltan columnas: ${r.columnasFaltantes.join(', ')}. Columnas esperadas: ${(tipo === 'productos' ? COLUMNAS_PRODUCTOS : COLUMNAS_DESTINOS).join(',')}`);
    return;
  }
  const ok = await dialogo({
    titulo: `Importar ${tipo} a ${cod}`,
    contenido: h('div',
      h('ul.resumen',
        h('li', `Filas leídas: ${r.total}`),
        h('li', `Nuevos: ${r.nuevos}`),
        h('li', `Se actualizan: ${r.actualizados}`),
        h('li', `Con errores: ${r.errores.length}`),
        r.otrasBodegas ? h('li', `De otras bodegas (ignoradas): ${r.otrasBodegas}`) : null),
      tablaErrores(r.errores)),
    botones: [{ texto: 'Cancelar', valor: false }, { texto: `Importar ${r.validos.length}`, clase: 'primario', valor: true }],
  });
  if (!ok || !r.validos.length) return;
  await catalogo.confirmarImportacion(tipo, r.validos);
  aviso(`${r.validos.length} ${tipo} importados`, 'ok');
  pintar();
}

// ---------- Paquete inicial ----------
function seccionPaquete(lista) {
  return h('section.tarjeta',
    h('h2', 'Paquete inicial (datos reales)'),
    h('p.nota', 'Escoja juntos los tres archivos de la carpeta datos-iniciales: bodegas.csv, productos.csv y destinos.csv. Crea o actualiza bodegas, productos y destinos; no borra registros de salidas.'),
    h('button.btn.primario', { type: 'button', onclick: () => cargarPaquete(lista) }, '⇧ Cargar paquete inicial'));
}

async function cargarPaquete(lista) {
  const archivos = await elegirArchivo({ aceptar: '.csv,text/csv', multiple: true });
  if (!archivos.length) return;
  const buscar = (n) => archivos.find((f) => f.name.toLowerCase().startsWith(n));
  const fb = buscar('bodegas'); const fp = buscar('productos'); const fd = buscar('destinos');
  if (!fb && !fp && !fd) { informar('Archivos no reconocidos', 'Los nombres deben empezar por bodegas, productos o destinos (.csv).'); return; }
  const r = await catalogo.analizarPaquete({
    bodegasCsv: fb && await leerTexto(fb), productosCsv: fp && await leerTexto(fp), destinosCsv: fd && await leerTexto(fd),
  });
  const hayEjemplo = lista.some((b) => b.ejemplo);
  const chk = h('input', { type: 'checkbox', checked: hayEjemplo });
  const errores = [...r.erroresBodegas, ...(r.productos?.errores || []), ...(r.destinos?.errores || [])];
  const faltan = [...(r.productos?.columnasFaltantes || []).map((c) => `productos: ${c}`), ...(r.destinos?.columnasFaltantes || []).map((c) => `destinos: ${c}`)];
  const ok = await dialogo({
    titulo: 'Cargar paquete inicial',
    contenido: h('div',
      h('ul.resumen',
        h('li', `Archivos: ${[fb, fp, fd].filter(Boolean).map((f) => f.name).join(', ')}`),
        h('li', `Bodegas: ${r.bodegas.length} (${r.bodegas.map((b) => b.codigo).join(', ') || '—'})`),
        r.productos ? h('li', `Productos válidos: ${r.productos.validos.length}`) : null,
        r.destinos ? h('li', `Destinos válidos: ${r.destinos.validos.length}`) : null,
        faltan.length ? h('li.error-form', `Columnas faltantes: ${faltan.join(', ')}`) : null),
      tablaErrores(errores),
      hayEjemplo ? h('label.campo.check', chk, h('span', 'Borrar primero las bodegas de EJEMPLO (con sus registros de prueba)')) : null),
    botones: [{ texto: 'Cancelar', valor: false }, { texto: 'Cargar', clase: 'primario', valor: true }],
  });
  if (!ok) return;
  const res = await catalogo.guardarPaquete(r, { reemplazarEjemplo: hayEjemplo && chk.checked });
  if (hayEjemplo && chk.checked) await db.fijarAjuste('origenDatos', 'iniciales');
  informar('Paquete cargado', `${res.bodegas} bodega(s), ${res.productos} producto(s) y ${res.destinos} destino(s).${res.sinBodega ? ` ${res.sinBodega} fila(s) ignoradas porque su bodega no existe.` : ''}`);
  alCambio(); pintar();
}

// ---------- Ajustes ----------
async function seccionAjustes() {
  const pinFinca = await db.ajuste('pinCambioFinca', true);
  return h('section.tarjeta',
    h('h2', 'Seguridad, respaldo y versión'),
    h('div.fila-botones',
      h('button.btn.primario', { type: 'button', onclick: cambiarPin }, 'Cambiar PIN'),
      h('button.btn.secundario', { type: 'button', onclick: () => { bodegas.salirAdmin(); alMostrar(); } }, 'Salir del modo administrador')),
    modo !== 'finca' ? null : h('label.campo.check',
      h('input', { type: 'checkbox', checked: pinFinca, onchange: async (e) => { await db.fijarAjuste('pinCambioFinca', e.target.checked); aviso('Guardado', 'ok'); } }),
      h('span', 'Pedir PIN para escoger una finca distinta en el inicio')),
    h('h3', 'Respaldo'),
    h('p.nota', 'Guarda TODA la base (bodegas, catálogos, despachos y líneas) en un archivo JSON.'),
    h('div.fila-botones',
      h('button.btn.secundario', { type: 'button', onclick: respaldar }, '↓ Descargar respaldo'),
      h('button.btn.peligro', { type: 'button', onclick: restaurar }, '⇧ Restaurar respaldo…')),
    h('h3', 'Versión'),
    h('p', `Agrap Salidas v${VERSION}`),
    h('button.btn.secundario', { type: 'button', onclick: buscarActualizacion }, 'Buscar actualización'));
}

async function cambiarPin() {
  const a = await pedirPin('Nuevo PIN', 'De 4 a 8 dígitos.');
  if (a == null) return;
  const b = await pedirPin('Repita el nuevo PIN');
  if (b == null) return;
  if (a !== b) { aviso('Los PIN no coinciden.', 'error'); return; }
  try { await bodegas.cambiarPin(a); aviso('PIN cambiado', 'ok'); pintar(); } catch (e) { aviso(e.message, 'error'); }
}

async function respaldar() {
  const json = await db.exportarTodo();
  descargar(`respaldo_agrap_salidas_${hoy().replace(/-/g, '')}.json`, JSON.stringify(json), 'application/json');
}

async function restaurar() {
  const [f] = await elegirArchivo({ aceptar: '.json,application/json' });
  if (!f) return;
  let json;
  try { json = JSON.parse(await f.text()); } catch { aviso('El archivo no es JSON válido.', 'error'); return; }
  const n = (k) => json?.datos?.[k]?.length ?? 0;
  if (!(await confirmar('¿Restaurar respaldo?', `Se REEMPLAZA toda la base actual por el respaldo del ${json?.fecha ? new Date(json.fecha).toLocaleString('es-CO') : '?'}: ${n('bodegas')} bodegas, ${n('productos')} productos, ${n('despachos')} despachos, ${n('lineas')} líneas.`, { si: 'Restaurar', peligro: true }))) return;
  if (!(await bodegas.exigirPinSiempre('Restaurar reemplaza todos los datos.'))) return;
  try { await db.restaurarTodo(json); await bodegas.asegurarActiva(); aviso('Respaldo restaurado', 'ok'); alCambio(); pintar(); } catch (e) { aviso(e.message, 'error'); }
}

async function buscarActualizacion() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) { aviso('Sin service worker (modo desarrollo).', 'aviso'); return; }
  await reg.update();
  aviso(reg.installing || reg.waiting ? 'Actualización encontrada: se aplicará en segundos.' : 'Ya tiene la última versión.', 'ok');
}
