# Correo del cierre · servicio de Google (5 minutos)

El teléfono no manda correos por sí mismo: le entrega el cierre **ya autorizado** a este
servicio, que corre en la cuenta de Google de la empresa y lo manda con Gmail. Los
destinatarios se configuran aquí; el teléfono no puede cambiarlos.

## Publicarlo

1. Con la **cuenta de AGRAP (agritravecedo@gmail.com)** —la misma que usa el módulo Correo de
   AGRAP, para que el correo salga del mismo remitente— abra <https://script.google.com> ›
   **Nuevo proyecto**.
   Póngale nombre: `Agrap Scan · Correo`.
2. Borre lo que trae y pegue todo el contenido de `Codigo.gs`. Guarde (⌘S).
3. ⚙ **Configuración del proyecto** › **Propiedades del script** › agregue:
   - `CLAVE` → clave de los teléfonos, inventada (mínimo 12 caracteres)
   - `CLAVE_ADMIN` → clave de la oficina, **otra distinta** (mínimo 12). Nunca va a los teléfonos.
   Los contactos, la firma y el nombre NO se ponen aquí: los manda la Oficina.
4. **Implementar › Nueva implementación** › tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - **Implementar** › autorice los permisos de Gmail que pide Google (es su cuenta).
5. Copie la **URL de la aplicación web** (termina en `/exec`).

## Conectarlo

1. En `oficina.html` › **📧 Correo del cierre**: pegue la URL, las dos claves, el nombre del
   remitente (`Agrap`) y la hora de cierre.
2. **Contactos**: agregue uno por uno, o **Importar contactos (CSV de AGRAP)** con
   `datos-iniciales/contactos_agrap.csv` (los 25 de AGRAP; entran desactivados). Active solo
   los que deben recibir el cierre y escoja **Para** o **Copia**. Escriba la **firma**.
3. **Guardar y sincronizar** (el servicio queda con los contactos) › **Mandar correo de prueba**.
4. **Enviar catálogo a las fincas**: llegan la URL, la clave de teléfonos y los NOMBRES de los
   contactos (sin sus correos ni la clave de oficina).

## Cómo sale un cierre

- A la hora de cierre el teléfono avisa: *«Cierre del día listo para autorizar»*.
- El encargado abre **Registros** o **Jornada** › **Revisar y autorizar envío**, mira el
  correo tal como va a llegar y lo autoriza con su **PIN**.
- Si no hay señal queda en cola y sale solo cuando vuelve. Cada envío (bueno o fallido)
  queda en la hoja de cálculo «Agrap Scan · Bitácora de correo» que crea el servicio en su
  Drive; la Oficina la ve en **Bitácora › Ver envíos de todas las fincas**.

Límites de Google: 100 correos al día con Gmail normal (1.500 con Google Workspace) y
adjuntos hasta 20 MB por correo. El servicio además frena a 30 correos por hora.

Si cambia `Codigo.gs`, publique con **Implementar › Administrar implementaciones › Editar ›
Nueva versión** para que la URL siga siendo la misma.
