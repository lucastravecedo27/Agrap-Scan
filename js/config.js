// Configuración global de la app. Lo que cambia por versión o por regla de negocio vive aquí.

export const VERSION = '2.0.2';

export const PIN_POR_DEFECTO = '1234';

// Minutos que dura desbloqueado el modo administrador sin actividad.
export const MINUTOS_ADMIN = 5;

// Lecturas repetidas del mismo código dentro de esta ventana se ignoran (estación fija:
// la página queda debajo de la cámara mientras la operaria digita).
export const MS_REPETIDO = 3000;

// Alerta de cantidad: más de N veces el promedio histórico del producto en la bodega.
export const FACTOR_ALERTA = 2;
// Líneas propias mínimas antes de confiar en el historial de la app en vez del
// promedio de referencia importado.
export const MIN_LINEAS_HISTORIAL = 3;

// Borrado de registros exportados.
export const DIAS_RETENCION = 30;

export const COLUMNAS_EXPORTE = [
  'fecha', 'hora', 'bodega', 'despacho_id', 'finca', 'lote', 'labor',
  'codigo_producto', 'producto', 'unidad', 'cantidad', 'responsable', 'recibe',
];

export const COLUMNAS_PRODUCTOS = ['codigo', 'nombre', 'unidad', 'categoria', 'promedio_referencia', 'foto_url'];
export const COLUMNAS_DESTINOS = ['codigo', 'finca', 'lote', 'labor'];
export const COLUMNAS_BODEGAS = ['codigo', 'nombre', 'finca', 'responsable'];

// Formatos de los QR. El código de producto es el de WorldOffice tal cual (puede traer
// ceros a la izquierda, espacios o «$»), por eso todo lo que sigue al prefijo es el código.
export const RE_BODEGA = /^B\d{2,3}$/;
export const RE_QR = /^(B\d{2,3})-(INS|DST)-(.+)$/;
export const CMD_CERRAR = 'CMD-CERRAR';
export const CMD_DESHACER = 'CMD-DESHACER';

export const qrProducto = (bodega, codigo) => `${bodega}-INS-${codigo}`;
export const qrDestino = (bodega, codigo) => `${bodega}-DST-${codigo}`;
// Carné de jornada: número consecutivo que da la oficina. Se imprime en blanco para las
// fincas y se asigna a la persona cuando la oficina la registra.
export const RE_CARNE = /^CARNE-(\d+)$/i;
export const formatoCarne = (n) => String(Number(n)).padStart(5, '0');
export const qrCarne = (n) => `CARNE-${formatoCarne(n)}`;
// RDT: filas de datos desde la 13; hasta 4 lotes por fila (los que suma «Unidades a pagar»).
export const RDT_FILA_INICIAL = 13;
export const RDT_LOTES = [['O', 'P'], ['S', 'T'], ['W', 'X'], ['AA', 'AB']];
// Jornada: alerta si la cantidad real se aleja más de esta fracción de la planeada.
export const DESVIO_JORNADA = 0.25;
