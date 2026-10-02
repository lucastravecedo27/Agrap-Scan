# Agrap Salidas

PWA para registrar salidas de insumos de bodega en fincas de banano con códigos QR.
HTML, CSS y JavaScript nativos, sin backend; funciona 100 % offline (IndexedDB + service worker).

| Página | Quién la usa | Qué hace |
|---|---|---|
| `index.html` | iPhone fijo en la bodega de la finca | Lobby (escoger finca) → escanear destino y productos, digitar cantidad → Registros: revisar/corregir y enviar el CSV por WhatsApp |
| `oficina.html` | Computador de la oficina | Productos nuevos, catálogo por bodega, destinos, **usuarios por finca**, libro de QR para imprimir y **enviar el catálogo a las fincas** (archivo `catalogo_….json`) |
| `instalar.html` | Quien instala | Pasos para iPhone (Safari → Agregar a inicio, Acceso Guiado) y Android (Chrome → Instalar app, Fijar app) |

## Flujo

1. **Oficina** carga el paquete inicial (`bodegas.csv`, `productos.csv`, `destinos.csv`), imprime el libro de cada bodega y manda `catalogo_….json` por WhatsApp.
2. **Finca** (encargado): Ajustes › Recibir catálogo de la oficina. Si la oficina creó usuarios, cada persona ingresa con usuario y contraseña y solo ve sus fincas; su nombre va como `responsable` en el CSV.
3. **Operaria**: escoge la finca, pone la página del destino bajo la cámara (si el destino es solo un lote, escoge **la labor**), luego la de cada producto, digita la cantidad y escoge **quién recibe**. Labores y nombres se aprenden: desde la 3.ª letra se sugieren y quedan bien escritos («CONTROL DE MALEZA AL DIA» → «Control de maleza»).
4. **Fin del día**: Registros › Enviar CSV → revisión editable → menú de compartir (WhatsApp) o descarga.

## Jornada (horas reales por persona) → RDT

1. **Oficina › Empleados** (solo la oficina registra): importa `codigo,nombre,finca[,cedula]`; cada empleado recibe un carné (`CARNE-00001`). Imprime carnés con nombre y **carnés en blanco** para cada finca.
2. **Persona nueva en la finca**: escanea un carné en blanco → fotos de la cédula y de la persona → ya puede trabajar. Jornada › **Enviar ingresos a la oficina** (`ingresos_….json`).
3. **Oficina › Personas nuevas**: recibe el archivo, ve las fotos y registra código Agrosoft, nombre y cédula con ese carné. Vuelve a la finca con el catálogo.
4. **Labor**: escanear el carné → labor de `Lista_Labores` (Agrosoft, 1.586, `js/labores-nomina.js`) con 3 letras → cantidad planeada. Al terminar: cantidad real y, si la labor es por hectárea/unidad/racimo/metro, los lotes (hasta 4).
5. **Jornada › Descargar RDT**: llena `plantillas/rdt.xlsx` (plantilla real sin datos personales) con encabezado (código de finca, periodo, fecha, año, semana), una fila por persona y labor, lotes y la hoja `lista_trabajadores`. Fórmulas, tablas y validaciones quedan intactas.

Cada usuario tiene permisos: salidas, jornada o ambos. `lib/jszip.min.js` (MIT) arma el Excel en el teléfono.

CSV de salida: `fecha,hora,bodega,despacho_id,finca,lote,labor,codigo_producto,producto,unidad,cantidad,responsable,recibe`
(`salidas_AAAAMMDD_Bxx.csv` o `salidas_AAAAMMDD_todas.csv`).

## Códigos QR

`B01-DST-003` destino (lote; la labor es opcional: vacía se escoge al escanear) · `B01-INS-0045` producto (el código de WorldOffice tal cual) · `CMD-CERRAR` · `CMD-DESHACER`.

## Desarrollo

```
python3 -m http.server 8765      # y abrir http://127.0.0.1:8765/
```

En `localhost` el service worker usa la red primero. Al publicar cambios, subir `VERSION`
en `js/config.js` **y** en `sw.js`: los teléfonos se actualizan solos.

`datos-iniciales/` trae el catálogo real publicado (hoy: B01 Don Gaspar, 547 productos y
17 destinos). Un equipo nuevo o que solo tenga el `ejemplo/` lo carga solo al abrir la app.
Usuarios y contraseñas nunca van aquí: viajan en el catálogo que manda la oficina.
`Materiales/` sigue fuera del repositorio.

Librerías locales: `lib/jsQR.js` (Apache-2.0) y `lib/qrcode.js` (qrcode-generator, MIT).
