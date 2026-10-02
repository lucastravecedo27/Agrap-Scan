// Empleados de nómina con carné QR. La oficina los importa (CSV codigo,nombre,finca) y viajan
// en el catálogo; nunca van en el repositorio (son datos personales).
//   ajustes.empleados  [{codigo, nombre, fincas: ['B01'], activo}]

import * as db from './db.js';
import { aObjetos } from './csv.js';

const limpiarCodigo = (c) => String(c ?? '').trim().replace(/\.0+$/, '');
/** «GONZALEZ  pushaina rafael» → «Gonzalez Pushaina Rafael» */
const formatearNombre = (n) => String(n || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, letra) => sep + letra.toUpperCase());

export const listar = async () => (await db.ajuste('empleados', [])).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
export const obtener = async (codigo) => (await db.ajuste('empleados', [])).find((e) => e.codigo === limpiarCodigo(codigo)) || null;
export const deBodega = async (bodega) => (await listar()).filter((e) => e.fincas.includes(bodega));

/**
 * Lee el CSV sin guardar. Un mismo código en varias filas suma fincas.
 * -> {validos:[{codigo,nombre,fincas}], errores:[{fila, motivo}], faltan:[columnas]}
 */
export function analizarCsv(texto, bodegasValidas) {
  const { columnas, registros } = aObjetos(texto);
  const faltan = ['codigo', 'nombre', 'finca'].filter((c) => !columnas.includes(c));
  const res = { validos: [], errores: [], faltan };
  if (faltan.length) return res;
  const porCodigo = new Map();
  registros.forEach((r, i) => {
    const codigo = limpiarCodigo(r.codigo); const nombre = formatearNombre(r.nombre); const finca = String(r.finca || '').trim().toUpperCase();
    const motivo = !codigo ? 'código vacío' : !nombre ? 'nombre vacío' : !bodegasValidas.includes(finca) ? `finca «${r.finca}» no existe (use el código: B01…)` : null;
    if (motivo) { res.errores.push({ fila: i + 2, motivo }); return; }
    const e = porCodigo.get(codigo) || { codigo, nombre, fincas: [] };
    if (!e.fincas.includes(finca)) e.fincas.push(finca);
    porCodigo.set(codigo, e);
  });
  res.validos = [...porCodigo.values()];
  return res;
}

/** Reemplaza los empleados de las fincas que trae el CSV; los que ya no vienen quedan inactivos. */
export async function importar(validos) {
  const fincasCsv = new Set(validos.flatMap((e) => e.fincas));
  const nuevos = new Map(validos.map((e) => [e.codigo, e]));
  const actual = await db.ajuste('empleados', []);
  const out = [];
  for (const e of actual) {
    if (nuevos.has(e.codigo)) continue;
    const quedan = e.fincas.filter((f) => !fincasCsv.has(f));
    out.push(quedan.length === e.fincas.length ? e : { ...e, activo: quedan.length ? e.activo : false });
  }
  for (const e of nuevos.values()) out.push({ ...e, activo: true });
  await db.fijarAjuste('empleados', out);
  return { importados: nuevos.size, inactivados: out.filter((e) => e.activo === false && !nuevos.has(e.codigo)).length };
}

export async function fijarActivo(codigo, activo) {
  const l = await db.ajuste('empleados', []);
  await db.fijarAjuste('empleados', l.map((e) => (e.codigo === codigo ? { ...e, activo } : e)));
}

export async function paraBodegas(codigos) {
  return (await db.ajuste('empleados', [])).filter((e) => e.fincas.some((f) => codigos.includes(f)));
}

/** La finca recibe la lista de la oficina tal cual. */
export async function recibir(lista) {
  if (Array.isArray(lista)) await db.fijarAjuste('empleados', lista);
}
