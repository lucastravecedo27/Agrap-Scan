// CSV: leer (RFC 4180, con comillas) y escribir. Lo comparten la importación y el exporte.

/** Texto CSV -> arreglo de filas (arreglos de celdas). Acepta coma o punto y coma. */
export function parsear(texto) {
  texto = String(texto || '').replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const sep = (primera.split(';').length > primera.split(',').length) ? ';' : ',';
  const filas = [];
  let fila = [], celda = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else comillas = false;
      } else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}

/** Filas con encabezado -> objetos con claves en minúscula y sin tildes. */
export function aObjetos(texto) {
  const filas = parsear(texto);
  if (!filas.length) return { columnas: [], registros: [] };
  const columnas = filas[0].map(normalizarColumna);
  const registros = filas.slice(1).map((f, i) => {
    const o = { _fila: i + 2 };
    columnas.forEach((c, j) => { o[c] = (f[j] ?? '').trim(); });
    return o;
  });
  return { columnas, registros };
}

export function normalizarColumna(c) {
  return String(c).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
}

function celda(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function serializar(columnas, filas) {
  return [columnas.map(celda).join(','), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(','))].join('\r\n') + '\r\n';
}
