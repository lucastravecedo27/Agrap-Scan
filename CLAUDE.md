# Agrap Scan — estado para retomar (leer primero)

PWA (HTML/CSS/JS nativo, sin backend, offline con IndexedDB + service worker) para las
fincas de banano del grupo. Publicada en GitHub Pages: repo `lucastravecedo27/Agrap-Scan`.

| Página | Para quién | URL |
|---|---|---|
| `index.html` | iPhone de la finca | https://lucastravecedo27.github.io/Agrap-Scan/ |
| `oficina.html` | PC de la oficina | …/Agrap-Scan/oficina.html |
| `simulador.html` | Probar la finca en el PC sin teléfono | …/Agrap-Scan/simulador.html |
| `instalar.html` | Instalar en el iPhone | …/Agrap-Scan/instalar.html |

Documento del flujo de trabajo (editable): https://claude.ai/code/artifact/054a0e32-79d3-4fcc-b6a1-7e87a216e989

## Estado al 2026-10-03 · v2.10.0

- **Fincas piloto: Don Gaspar (B01) y La Alegría (B04, Ficus Indica, en un PORTÁTIL).** El paquete
  publicado (`datos-iniciales/bodegas|productos|destinos.csv`) lleva solo las piloto, con el ID del
  cuaderno de Materiales en `bodegas.csv`. Para sumar otra finca:
  `python3 herramientas/agregar_finca_piloto.py B03` (lee `Materiales/datos/app.db`).
- **PC: el Excel para Materiales se guarda SOLO** (`materiales.js` › `sincronizar`, File System
  Access de Chrome/Edge). Registros › «Guardar solo en la carpeta de Materiales…» escoge una vez
  `Salidas <FINCA> (Agrap Scan).xlsx` dentro de la carpeta de Drive que vigila Materiales
  (`G:\Mi unidad\Facturas Grupo Travecedo`). Cada cambio lo reescribe; antes lo relee y los
  renglones que Materiales selló («WO 493 · fecha», casados por la columna «Id Agrap Scan») quedan
  cerrados en la app. Nunca pisa un cuaderno de otra finca ni uno digitado a mano. Si el navegador
  pierde el permiso, la cabecera dice «🔗 Reconectar». Probado de punta a punta contra el código
  real de Materiales: SA 493/494 de Ficus, sellos de vuelta, sin duplicar aunque se pierdan sellos.
- **Salidas de materiales (lo que se usa):** buscar material con 3 letras → cantidad →
  «¿Quién recibe?» escaneando el CARNÉ del trabajador (la cámara se abre solo ahí) o 3 letras.
- **Jornada / RDT: APAGADOS, NO BORRADOS.** `FUNCIONES.jornada = false` en `js/config.js`.
  El usuario pidió no borrar nada y prenderlo solo cuando él lo diga.
- **Integración con la app Materiales** (Flask de la empresa): `js/materiales.js` genera
  «Salidas <FINCA>.xlsx» con el formato EXACTO del cuaderno de Materiales (hoja «Salidas» por
  títulos + hoja «Ficha (no tocar)» con el ID del cuaderno de la finca). La encargada lo guarda
  en lugar del cuaderno digitado y Materiales lo procesa **sin cambios** (bandeja, sello,
  huella, archivo plano WorldOffice). Trae los últimos 45 días; lo ya contabilizado se salta
  por huella. Probado contra `core/salidas.py` y `core/exportador_salidas.py`.
  - El ID del cuaderno va en Oficina › Bodegas (campo `cuaderno`) y viaja en el catálogo.
  - **No modificar Materiales.** `Materiales/` es la copia de la EMPRESA (zip del 3 oct 2026, sin
    PDF ni .venv; trae `datos/app.db` real). La anterior quedó en `Materiales-viejo/` (su `.venv`
    sirve para correr el código de Materiales en pruebas). Ambas fuera de git.
  - El archivo plano de WorldOffice lo saca SIEMPRE Materiales (dueño de los consecutivos):
    la app no genera planos propios para no repartir números.
- **Correo del cierre:** el teléfono arma el cierre, el encargado lo autoriza con PIN y lo manda
  un Google Apps Script (`herramientas/correo/Codigo.gs`) publicado con la cuenta de AGRAP
  (agritravecedo@gmail.com). Contactos/copia/firma desde Oficina › Correo; bitácora en una hoja
  de cálculo. **Falta que el usuario publique el servicio.**
- **Empleados:** llegan al teléfono en el catálogo (`catalogo_….json`) o por QR desde la
  pantalla de la oficina («Pasar empleados al teléfono»). Son datos personales: NUNCA al repo.
- **Seguridad:** PIN cifrado (sal+SHA-256), cambio obligatorio del 1234, bloqueo tras 5 intentos.

## Pendientes del usuario

1. La Alegría: en el portátil instalar Google Drive para escritorio con acceso a la carpeta de
   Materiales, abrir la app en Chrome/Edge, escoger LA ALEGRIA y «Guardar solo…» (ver instalar.html
   › Portátil). En la oficina: contabilizar lo pendiente del cuaderno viejo de La Alegría y sacarlo
   de `datos/salidas` (mismo ID: si quedan los dos, Materiales sigue el de Drive).
2. Fecha de corte por finca: desde ese día no se digita el cuaderno viejo (si no, se cuenta doble).
3. Publicar el servicio de correo (`herramientas/correo/LEEME.md`).
4. Cambiar el PIN 1234 en cada aparato. GitHub con verificación en dos pasos.

## Cómo se trabaja aquí

- **Publicar un cambio:** subir `VERSION` en `js/config.js` **y** en `sw.js` (si no, los
  teléfonos no se actualizan) → commit → `GIT_TERMINAL_PROMPT=0 git push` (el token está en el
  llavero de macOS). GitHub Pages tarda 1–2 min; comprobar con
  `curl -s https://lucastravecedo27.github.io/Agrap-Scan/sw.js | grep VERSION`.
- **Probar:** `python3 -m http.server 8765` y abrir http://127.0.0.1:8765/ (en localhost el
  service worker va a la red primero). Para pruebas de punta a punta se usó puppeteer-core con el
  Chrome instalado y una cámara simulada (`canvas.captureStream`) que muestra los QR.
- `.gitignore`: `Materiales/`, `materiales/` y `datos-iniciales/*` salvo los 3 CSV de B01.
  Nunca subir empleados, cédulas, contactos ni archivos de prueba.
- El usuario prefiere que se decida y se avance sin menús de preguntas; preguntar solo lo
  costoso o irreversible. Respuestas en español, cortas.

## Mapa del código (`js/`)

`app.js` arranque, lobby, modos, pestañas · `escaneo.js` pantalla Escanear (buscador de
materiales, teclado, quién recibe) · `scanner.js` cámara + jsQR en worker · `despacho.js`
despachos y líneas · `exportar.js` Registros, CSV, revisión editable, tarjeta Materiales ·
`materiales.js` Excel para Materiales · `correo.js` cierre por correo · `catalogo.js` catálogo,
paquete inicial, catálogo oficina→finca · `configuracion.js` Ajustes (finca) y Oficina ·
`bodegas.js` bodegas y PIN · `empleados.js` · `personas.js` listas aprendidas (crearLista) ·
`traspaso.js` QR oficina→teléfono · `libro.js` libro de QR · `jornada.js` `rdt.js`
`ingresos.js` `labores*.js` (apagados por la bandera) · `db.js` IndexedDB · `ui.js`.
