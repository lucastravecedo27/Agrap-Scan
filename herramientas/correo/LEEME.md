# Correo del cierre · servicio de Google (5 minutos)

El teléfono no manda correos por sí mismo: le entrega el cierre **ya autorizado** a este
servicio, que corre en la cuenta de Google de la empresa y lo manda con Gmail. Los
destinatarios se configuran aquí; el teléfono no puede cambiarlos.

## Publicarlo

1. Con la cuenta de Google de la empresa, abra <https://script.google.com> › **Nuevo proyecto**.
   Póngale nombre: `Agrap Scan · Correo`.
2. Borre lo que trae y pegue todo el contenido de `Codigo.gs`. Guarde (⌘S).
3. ⚙ **Configuración del proyecto** › **Propiedades del script** › agregue:
   - `CLAVE` → una clave larga inventada (mínimo 12 caracteres, p. ej. `agrap-dg-7Rk29xQm`)
   - `DESTINATARIOS` → `nomina@empresa.com, materiales@empresa.com` (separados por coma)
   - `NOMBRE` → `Agrap Scan` (opcional)
4. **Implementar › Nueva implementación** › tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - **Implementar** › autorice los permisos de Gmail que pide Google (es su cuenta).
5. Copie la **URL de la aplicación web** (termina en `/exec`).

## Conectarlo

1. En `oficina.html` › **📧 Correo del cierre**: pegue la URL y la misma `CLAVE`, escoja la
   hora de cierre (cuándo avisa al encargado) › **Guardar** › **Mandar correo de prueba**.
2. **Enviar catálogo a las fincas**: la configuración llega a los teléfonos con el catálogo.

## Cómo sale un cierre

- A la hora de cierre el teléfono avisa: *«Cierre del día listo para autorizar»*.
- El encargado abre **Registros** o **Jornada** › **Revisar y autorizar envío**, mira el
  correo tal como va a llegar y lo autoriza con su **PIN**.
- Si no hay señal queda en cola y sale solo cuando vuelve. Cada envío (bueno o fallido)
  queda en Ajustes › Correo › Últimos envíos.

Límites de Google: 100 correos al día con Gmail normal (1.500 con Google Workspace) y
adjuntos hasta 20 MB por correo. El servicio además frena a 30 correos por hora.

Si cambia `Codigo.gs`, publique con **Implementar › Administrar implementaciones › Editar ›
Nueva versión** para que la URL siga siendo la misma.
