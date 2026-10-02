# Agrap Salidas

PWA para registrar salidas de insumos de bodega en fincas de banano con códigos QR.
HTML, CSS y JavaScript nativos, sin backend; funciona 100 % offline (IndexedDB + service worker).

| Página | Quién la usa | Qué hace |
|---|---|---|
| `index.html` | iPhone fijo en la bodega de la finca | Lobby (escoger finca) → escanear destino y productos, digitar cantidad → Registros: revisar/corregir y enviar el CSV por WhatsApp |
| `oficina.html` | Computador de la oficina | Productos nuevos, catálogo por bodega, destinos, libro de QR para imprimir y **enviar el catálogo a las fincas** (archivo `catalogo_….json`) |
| `instalar.html` | Quien instala | Pasos para iPhone: Safari → Compartir → Agregar a inicio, cámara, Acceso Guiado |

## Flujo

1. **Oficina** carga el paquete inicial (`bodegas.csv`, `productos.csv`, `destinos.csv`), imprime el libro de cada bodega y manda `catalogo_….json` por WhatsApp.
2. **Finca** (encargado): Ajustes › Recibir catálogo de la oficina.
3. **Operaria**: escoge la finca, pone la página del destino bajo la cámara (si el destino es solo un lote, escoge **la labor**), luego la de cada producto, digita la cantidad y escoge **quién recibe**. Labores y nombres se aprenden: con 2–3 letras se sugieren y quedan bien escritos («CONTROL DE MALEZA AL DIA» → «Control de maleza»).
4. **Fin del día**: Registros › Enviar CSV → revisión editable → menú de compartir (WhatsApp) o descarga.

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

`herramientas/generar_datos_iniciales.py` arma `datos-iniciales/` desde `Materiales/`
(ambas carpetas están en `.gitignore`: no se suben datos reales). En el repositorio solo va
el catálogo de `ejemplo/`.

Librerías locales: `lib/jsQR.js` (Apache-2.0) y `lib/qrcode.js` (qrcode-generator, MIT).
