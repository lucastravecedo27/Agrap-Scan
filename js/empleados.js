// Empleados de nómina. Solo la oficina los registra: importa el CSV (codigo,nombre,finca) o
// recibe el ingreso que manda la finca (fotos de cédula y persona + un carné en blanco).
// Cada empleado tiene un carné (número consecutivo). Viajan en el catálogo sin fotos; nunca
// van en el repositorio (son datos personales).
//   ajustes.empleados       [{codigo, nombre, cedula, fincas: ['B01'], carne, fotos?, activo}]
//   ajustes.carneSiguiente  próximo número de carné (solo en la oficina)

import * as db from './db.js';
import { aObjetos } from './csv.js';

const limpiarCodigo = (c) => String(c ?? '').trim().replace(/\.0+$/, '');
/** «GONZALEZ  pushaina rafael» → «Gonzalez Pushaina Rafael» */
export const formatearNombre = (n) => String(n || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, letra) => sep + letra.toUpperCase());

const todos = () => db.ajuste('empleados', []);
const guardarTodos = (l) => db.fijarAjuste('empleados', l);

export const listar = async () => (await todos()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
export const obtener = async (codigo) => (await todos()).find((e) => e.codigo === limpiarCodigo(codigo)) || null;
export const porCarne = async (carne) => (await todos()).find((e) => Number(e.carne) === Number(carne)) || null;
export const deBodega = async (bodega) => (await listar()).filter((e) => e.fincas.includes(bodega));

// ---------- Carnés ----------
/** Reserva n números de carné nuevos (para imprimir en blanco o asignar). */
export async function reservarCarnes(n) {
  const usados = (await todos()).map((e) => Number(e.carne) || 0);
  const desde = Math.max(await db.ajuste('carneSiguiente', 1), ...usados.map((u) => u + 1));
  await db.fijarAjuste('carneSiguiente', desde + n);
  return Array.from({ length: n }, (_, i) => desde + i);
}

/** Da carné a los empleados que no tienen (los importados por CSV). -> cuántos. */
export async function asignarCarnesFaltantes() {
  const l = await todos();
  const sin = l.filter((e) => !e.carne).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!sin.length) return 0;
  const nums = await reservarCarnes(sin.length);
  sin.forEach((e, i) => { e.carne = nums[i]; });
  await guardarTodos(l);
  return sin.length;
}

// ---------- Importar CSV ----------
/**
 * Lee el CSV sin guardar. Un mismo código en varias filas suma fincas.
 * -> {validos:[{codigo,nombre,cedula,fincas}], errores:[{fila, motivo}], faltan:[columnas]}
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
    const e = porCodigo.get(codigo) || { codigo, nombre, cedula: limpiarCodigo(r.cedula), fincas: [] };
    if (!e.fincas.includes(finca)) e.fincas.push(finca);
    porCodigo.set(codigo, e);
  });
  res.validos = [...porCodigo.values()];
  return res;
}

/** Reemplaza los empleados de las fincas del CSV (conserva carné y fotos); los que no vienen quedan inactivos. */
export async function importar(validos) {
  const fincasCsv = new Set(validos.flatMap((e) => e.fincas));
  const nuevos = new Map(validos.map((e) => [e.codigo, e]));
  const actual = await todos();
  const previo = new Map(actual.map((e) => [e.codigo, e]));
  const out = [];
  for (const e of actual) {
    if (nuevos.has(e.codigo)) continue;
    const quedan = e.fincas.filter((f) => !fincasCsv.has(f));
    out.push(quedan.length === e.fincas.length ? e : { ...e, activo: quedan.length ? e.activo : false });
  }
  for (const e of nuevos.values()) {
    const p = previo.get(e.codigo);
    out.push({ ...p, ...e, cedula: e.cedula || p?.cedula || '', carne: p?.carne || null, activo: true });
  }
  await guardarTodos(out);
  const conCarne = await asignarCarnesFaltantes();
  return { importados: nuevos.size, inactivados: out.filter((e) => e.activo === false && !nuevos.has(e.codigo)).length, carnes: conCarne };
}

/** Registro de una persona nueva desde el ingreso de la finca (queda con el carné que le dieron allá). */
export async function registrar({ codigo, nombre, cedula, finca, carne, fotos }) {
  const c = limpiarCodigo(codigo);
  if (!c) throw new Error('Falta el código de nómina (Agrosoft).');
  if (!formatearNombre(nombre)) throw new Error('Falta el nombre.');
  const l = await todos();
  const otro = l.find((e) => Number(e.carne) === Number(carne) && e.codigo !== c);
  if (otro) throw new Error(`El carné ${carne} ya es de ${otro.nombre}.`);
  const previo = l.find((e) => e.codigo === c);
  const reg = {
    ...previo, codigo: c, nombre: formatearNombre(nombre), cedula: limpiarCodigo(cedula),
    fincas: [...new Set([...(previo?.fincas || []), finca])], carne: Number(carne), fotos, activo: true,
  };
  await guardarTodos([...l.filter((e) => e.codigo !== c), reg]);
  if (Number(carne) >= (await db.ajuste('carneSiguiente', 1))) await db.fijarAjuste('carneSiguiente', Number(carne) + 1);
  return reg;
}

export async function fijarActivo(codigo, activo) {
  await guardarTodos((await todos()).map((e) => (e.codigo === codigo ? { ...e, activo } : e)));
}

/** Para el catálogo: los de esas fincas, sin fotos (pesan y no se necesitan en la finca). */
export async function paraBodegas(codigos) {
  return (await todos()).filter((e) => e.fincas.some((f) => codigos.includes(f))).map(({ fotos, ...e }) => e);
}

/** La finca recibe la lista de la oficina tal cual. */
export async function recibir(lista) {
  if (Array.isArray(lista)) await guardarTodos(lista);
}
