// Labores a las que se cargan las salidas. Misma lógica que las personas: se aprenden por
// bodega y se escogen con 2–3 letras. La base sale del registro de labores de nómina de
// Don Gaspar (2026), sin las variantes de pago (festivo, dominical, al día, H.e.d., color
// de cinta) y con la ortografía corregida.

import { crearLista, normalizar } from './personas.js';

const BASE = {
  'Corte y empaque': ['Corte y empaque', 'Corte mercado nacional', 'Cargue de cajas', 'Botada de vástago', 'Acarreo de fruta', 'Precalibración'],
  'Embolse': ['Embolse y amarre', 'Desflore e identificación', 'Protección de fruta', 'Reamarre y desvío', 'Colocación de yumbolón',
    'Protección contra quema de sol', 'Conteo de cinta'],
  'Control de Sigatoka': ['Deshoje', 'Fumigación aérea'],
  'Control de maleza': ['Control de maleza', 'Limpia con guadaña', 'Limpia a machete', 'Desbejuque', 'Desguasque', 'Limpia de linderos',
    'Limpia de reservorio'],
  'Control de enfermedades': ['Control de Moko', 'Mantenimiento de pediluvio', 'Control de insectos', 'Bioseguridad'],
  'Control de población': ['Desmache', 'Repique de matas'],
  'Fertilización': ['Aplicación de fertilizante', 'Aplicación foliar', 'Descargue de fertilizante'],
  'Riego': ['Riego', 'Mantenimiento de riego', 'Mantenimiento de manguera', 'Instalación de riego', 'Motor de riego'],
  'Drenajes': ['Chapia de canal', 'Recava de canal', 'Limpia de canal de riego', 'Limpia de jarillón'],
  'Siembra': ['Siembra', 'Resiembra', 'Vivero'],
  'Mantenimiento': ['Mantenimiento de cable vía', 'Mantenimiento de infraestructura', 'Mantenimiento de cerca', 'Mantenimiento de garruchas',
    'Mantenimiento de guadaña', 'Mantenimiento de motor', 'Mantenimiento de retroexcavadora', 'Mantenimiento de empacadora', 'Pintura'],
  'Aseo': ['Aseo de empacadora', 'Aseo de bodega', 'Aseo de plantación', 'Aseo de casa administrativa', 'Aseo general'],
  'Administración': ['Administración', 'Almacén', 'Casino', 'Celaduría', 'Dotación y EPP', 'Descargue de cartón', 'Descargue de insumos',
    'Recolección de plástico'],
};

// Palabras que en nómina y WorldOffice llegan sin tilde o en mayúsculas.
const PALABRAS = Object.fromEntries(`aplicación fertilización protección identificación instalación recolección población
  administración precalibración clasificación fumigación dotación colocación aérea aéreo vía guadaña vástago plástico jarillón
  yumbolón palín cartón desagüe plantación celaduría almacén desvío café área árbol caído químico orgánico eléctrico
  mecánico electricidad sanitaria cosecha`.split(/\s+/).filter(Boolean)
  .flatMap((p) => [[normalizar(p), p], [normalizar(p).replace(/ñ/g, 'n'), p]]));
const PROPIAS = { moko: 'Moko', sigatoka: 'Sigatoka', epp: 'EPP', pvc: 'PVC' };

// Variantes de pago de nómina que no cambian la labor: «… al día», «… festivo», «… cinta roja».
const VARIANTES = /\s+(al dia|festivo|dominical|h ?e ?d|und|adm|cinta (blanca|amarilla|morada|roja|azul|verde|negra|cafe|gris))$/;

/** «CONTROL DE MALEZA AL DIA» → «Control de maleza»: sin variantes de pago, mayúscula inicial y tildes. */
export function formatear(texto) {
  let t = String(texto || '').replace(/[.\s]+/g, ' ').trim().toLowerCase();
  for (let n = normalizar(t), m; (m = n.match(VARIANTES)); n = normalizar(t)) t = t.slice(0, t.length - m[0].length).trim();
  const palabras = t.split(' ').filter(Boolean)
    .map((p) => PROPIAS[normalizar(p)] || PALABRAS[normalizar(p)] || p);
  const s = palabras.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const { listar, registrar, eliminar, elegir } = crearLista({
  prefijo: 'labores',
  formatear,
  enterPrimera: true,
  base: Object.entries(BASE).flatMap(([grupo, l]) => l.map((nombre) => ({ nombre, grupo }))),
  textos: {
    titulo: '¿Qué labor?', placeholder: 'Escriba la labor…', aria: 'Labor', mayusculas: 'sentences',
    vacio: 'Escriba la labor.', mismo: 'Misma', nuevo: 'Nueva', uso: 'despacho', usos: 'despachos',
    primera: 'Escriba la labor. La app la recordará.',
    ayuda: 'Escriba 2–3 letras (fert, mal, emb…) o toque una labor.',
    sinCoincidencias: 'No hay labores con esas letras: se guardará como nueva.',
  },
});

/** Ortografía de la base para una labor que llega escrita de otra forma (catálogo, CSV). */
export function escribir(texto) {
  const f = formatear(texto);
  for (const l of Object.values(BASE)) for (const n of l) if (normalizar(n) === normalizar(f)) return n;
  return f;
}
