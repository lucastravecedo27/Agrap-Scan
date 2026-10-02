// Generador del libro de códigos: A4, 3 columnas, QR de 30 mm, una sección por categoría,
// encabezado con la bodega en cada página, destinos y página de comandos.
// La paginación se hace aquí (no con CSS) para que el encabezado salga en TODAS las
// páginas en Safari, que no repite elementos fijos al imprimir.

import * as db from './db.js';
import * as bodegas from './bodegas.js';
import * as catalogo from './catalogo.js';
import { qrProducto, qrDestino, CMD_CERRAR, CMD_DESHACER } from './config.js';
import { $, h, vaciar, num, aviso, confirmar } from './ui.js';

const POR_PAGINA = 15;          // 3 columnas × 5 filas
const DESTINOS_POR_PAGINA = 15;

function svgQR(texto, celda = 4) {
  const qr = window.qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: celda, margin: 2, scalable: true });
}

const claveImpreso = (b) => `impreso:${b}`;

export async function productosNuevos(bodega) {
  const impreso = await db.ajuste(claveImpreso(bodega), null);
  const ya = new Set(impreso?.codigos || []);
  return (await catalogo.productos(bodega, { incluirInactivos: false })).filter((p) => !ya.has(p.codigo));
}

async function marcarImpresos(bodega, productos) {
  const previo = await db.ajuste(claveImpreso(bodega), null);
  const codigos = new Set([...(previo?.codigos || []), ...productos.map((p) => p.codigo)]);
  await db.fijarAjuste(claveImpreso(bodega), { fecha: new Date().toISOString(), codigos: [...codigos] });
}

function trocear(lista, n) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

function pagina(bodega, seccion, contenido) {
  return h('div.hoja',
    h('header.hoja-cab',
      h('div.hoja-bodega', `${bodega.codigo} · ${bodega.nombre}`),
      h('div.hoja-seccion', seccion),
      h('div.hoja-app', 'Agrap Salidas')),
    contenido,
    h('footer.hoja-pie'));
}

/** Construye las hojas del libro. opciones: {bodega, alcance:'todo'|'categoria'|'nuevos', categoria, destinos, comandos} */
export async function construir({ bodega: cod, alcance = 'todo', categoria = null, destinos = true, comandos = true }) {
  const b = await bodegas.obtener(cod);
  let prods = await catalogo.productos(cod, { incluirInactivos: false });
  if (alcance === 'categoria') prods = prods.filter((p) => (p.categoria || 'Sin categoría') === categoria);
  if (alcance === 'nuevos') prods = await productosNuevos(cod);
  const hojas = [];

  if (comandos) {
    hojas.push(pagina(b, 'Comandos', h('div.comandos',
      [[CMD_CERRAR, 'CERRAR DESPACHO', 'Cierra el despacho actual'], [CMD_DESHACER, 'DESHACER', 'Borra la última línea (pide confirmación)']]
        .map(([c, t, d]) => h('div.comando', h('div.qr-grande', { html: svgQR(c, 8) }), h('div.comando-titulo', t), h('div.comando-desc', d), h('div.qr-texto', c))))));
  }

  if (destinos) {
    const dests = await catalogo.destinos(cod, { incluirInactivos: false });
    trocear(dests, DESTINOS_POR_PAGINA).forEach((grupo, i, arr) => {
      hojas.push(pagina(b, `Destinos${arr.length > 1 ? ` (${i + 1}/${arr.length})` : ''}`, h('div.rejilla',
        grupo.map((d) => h('div.celda.celda-destino',
          h('div.qr', { html: svgQR(qrDestino(cod, d.codigo)) }),
          h('div.celda-nombre', d.finca),
          h('div.celda-linea', `Lote: ${d.lote}`),
          h('div.celda-linea.fuerte', d.labor),
          h('div.qr-texto', qrDestino(cod, d.codigo)))))));
    });
  }

  // Las categorías corren seguidas (cada una con su título) y una página nueva solo se
  // abre cuando no cabe la siguiente fila: así una categoría de 2 productos no gasta una hoja.
  const porCat = new Map();
  for (const p of prods) {
    const c = p.categoria || 'Sin categoría';
    if (!porCat.has(c)) porCat.set(c, []);
    porCat.get(c).push(p);
  }
  const ALTO_UTIL = 260, ALTO_FILA = 49, ALTO_TITULO = 9;
  let actual = null;
  const nuevaHoja = () => { actual = { rejilla: h('div.rejilla'), usado: 0, cats: [] }; hojasProd.push(actual); };
  const hojasProd = [];
  for (const [cat, lista] of [...porCat.entries()].sort((a, b2) => a[0].localeCompare(b2[0]))) {
    lista.sort((x, y) => x.nombre.localeCompare(y.nombre));
    trocear(lista, 3).forEach((fila, i) => {
      const titulo = i === 0;
      const alto = ALTO_FILA + (titulo ? ALTO_TITULO : 0);
      if (!actual || actual.usado + alto > ALTO_UTIL) {
        nuevaHoja();
        if (!titulo) { actual.rejilla.append(h('div.cat-titulo', `${cat} (continuación)`)); actual.usado += ALTO_TITULO; }
      }
      if (titulo) actual.rejilla.append(h('div.cat-titulo', cat));
      if (!actual.cats.includes(cat)) actual.cats.push(cat);
      actual.usado += alto;
      for (const p of fila) {
        actual.rejilla.append(h('div.celda',
          h('div.qr', { html: svgQR(qrProducto(cod, p.codigo)) }),
          h('div.celda-nombre', p.nombre),
          h('div.celda-linea.fuerte', `Unidad: ${p.unidad}`),
          h('div.qr-texto', qrProducto(cod, p.codigo))));
      }
      for (let k = fila.length; k < 3; k++) actual.rejilla.append(h('div.celda-vacia'));
    });
  }
  for (const hp of hojasProd) hojas.push(pagina(b, hp.cats.join(' · '), hp.rejilla));
  return { hojas, productos: prods, bodega: b };
}

// ---------- Pantalla Libro ----------
let raiz = null;
let ultimo = null;
let preseleccion = null;

/** Abre la pantalla con bodega y alcance ya escogidos (desde «Productos nuevos»). */
export function preseleccionar(op) { preseleccion = op; }

export function montar(contenedor) { raiz = contenedor; }

export async function alMostrar() {
  const activa = await bodegas.bodegaActiva();
  const lista = await bodegas.listar();
  vaciar(raiz);
  if (!lista.length) { raiz.append(h('p.vacio', 'No hay bodegas.')); return; }
  const selBod = h('select', lista.map((b) => h('option', { value: b.codigo, selected: b.codigo === activa }, `${b.codigo} · ${b.nombre}`)));
  const selAlc = h('select',
    h('option', { value: 'todo' }, 'Todo el catálogo'),
    h('option', { value: 'categoria' }, 'Una categoría'),
    h('option', { value: 'nuevos' }, 'Solo productos nuevos desde la última impresión'));
  const selCat = h('select');
  const campoCat = h('label.campo', { hidden: true }, h('span', 'Categoría'), selCat);
  const chkDest = h('input', { type: 'checkbox', checked: true });
  const chkCmd = h('input', { type: 'checkbox', checked: true });
  const info = h('p.nota');
  const vista = h('div.vista-libro#vistaLibro');

  const actualizar = async () => {
    const cats = await catalogo.categorias(selBod.value);
    vaciar(selCat).append(...cats.map((c) => h('option', { value: c }, c)));
    campoCat.hidden = selAlc.value !== 'categoria';
    const nuevos = await productosNuevos(selBod.value);
    const imp = await db.ajuste(claveImpreso(selBod.value), null);
    info.textContent = imp
      ? `Última impresión marcada: ${new Date(imp.fecha).toLocaleString('es-CO')}. Productos nuevos desde entonces: ${nuevos.length}.`
      : 'Esta bodega no tiene impresiones marcadas: «nuevos» incluye todo el catálogo.';
  };
  selBod.onchange = actualizar; selAlc.onchange = actualizar;

  const generar = async () => {
    vaciar(vista).append(h('p.vacio', 'Generando…'));
    await new Promise((r) => setTimeout(r, 30));
    ultimo = await construir({ bodega: selBod.value, alcance: selAlc.value, categoria: selCat.value, destinos: chkDest.checked, comandos: chkCmd.checked });
    vaciar(vista).append(...ultimo.hojas);
    aviso(`${ultimo.hojas.length} página(s) · ${ultimo.productos.length} producto(s)`, 'ok');
    btnImp.disabled = !ultimo.hojas.length;
  };
  const btnImp = h('button.btn.primario.btn-grande', {
    type: 'button', disabled: true,
    onclick: async () => {
      if (!ultimo) return;
      document.body.classList.add('imprimiendo');
      window.print();
      document.body.classList.remove('imprimiendo');
      if (ultimo.productos.length && await confirmar('¿Se imprimió bien?', `Marcar ${ultimo.productos.length} producto(s) como impresos. La opción «solo nuevos» los dejará por fuera la próxima vez.`, { si: 'Sí, marcar', no: 'No' })) {
        await marcarImpresos(ultimo.bodega.codigo, ultimo.productos);
        actualizar();
      }
    },
  }, '🖨 Imprimir');

  raiz.append(h('section.tarjeta.no-imprimir',
    h('h2', 'Libro de códigos QR'),
    h('div.fila-campos', h('label.campo', h('span', 'Bodega'), selBod), h('label.campo', h('span', 'Qué imprimir'), selAlc)),
    campoCat,
    h('div.fila-campos', h('label.campo.check', chkDest, h('span', 'Incluir destinos')), h('label.campo.check', chkCmd, h('span', 'Incluir página de comandos'))),
    info,
    h('div.fila-botones', h('button.btn.secundario.btn-grande', { type: 'button', onclick: generar }, 'Generar vista previa'), btnImp),
    h('p.nota', 'Papel A4, escala 100 % («Tamaño real»), sin encabezados del navegador. QR de 30 mm.')),
  vista);
  if (preseleccion) {
    if (preseleccion.bodega) selBod.value = preseleccion.bodega;
    if (preseleccion.alcance) selAlc.value = preseleccion.alcance;
    if (preseleccion.alcance === 'nuevos') { chkDest.checked = false; chkCmd.checked = false; }
    preseleccion = null;
    await actualizar();
    await generar();
    return;
  }
  await actualizar();
}

export { num };
