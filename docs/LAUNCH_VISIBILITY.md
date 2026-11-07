# Visibilidad en el lanzamiento comercial

Qué ve un cliente nuevo en el panel durante la primera fase comercial de EFAAT 360, y qué está oculto temporalmente. Detalle técnico de cada funcionalidad oculta: [FEATURE_VISIBILITY_REGISTER.md](FEATURE_VISIBILITY_REGISTER.md).

Regla: **se oculta, no se elimina**. Toda funcionalidad oculta conserva su código, rutas, servicios, endpoints y datos.

Clases usadas en este documento:
- **Visible**: aparece en la interfaz y se puede usar.
- **Oculta**: no aparece en ninguna pantalla ni enlace.
- **Pendiente**: le falta desarrollo antes de poder mostrarse.
- **Acceso administrativo**: la página existe y abre escribiendo su dirección, pero nada la enlaza. No es un permiso.

## Visibles durante el lanzamiento

Menú lateral:

| Sección | Opción | Ruta |
|---|---|---|
| Operación | Sesiones | `/sesiones` |
| Operación | Reservas | `/tablas` |
| Comunicación | Mensajes | `/mensajes` |
| Comunicación | Variables globales | `/variables-globales` |
| Comunicación | Contactos (incluye bloquear/desbloquear en el perfil) | `/contactos` |
| Sorteos | Eventos: Activos, Programados y **Finalizados recientes** | `/eventos` |
| Sorteos | Programados | `/sorteos` |
| Sorteos | Publicar ahora | `/sorteo-instantaneo` |
| Sorteos | Calendario de loterías | `/loterias` |
| Control | Automatización | `/automatizacion` |

Pie del menú: Mi cuenta, Aprende a usar EFAAT (sin las guías de las funcionalidades ocultas), Cerrar sesión.

«Finalizados recientes» (Eventos) sustituye, mientras Resultados esté oculta, el único acceso que esa sección tenía a una acción real: **Administrar sorteo** (reabrir o eliminar finalizados dentro de la ventana de 30 días del backend).

## Ocultas temporalmente

| Funcionalidad | Clase | Dónde estaba | Motivo | Qué queda accesible |
|---|---|---|---|---|
| Resultados | Oculta + pendiente | Eventos → sección «Resultados» | No guarda número ganador; «Ver resultado» siempre deshabilitado | Administración de finalizados en «Finalizados recientes» |
| Lector de pagos | Oculta + pendiente; acceso administrativo | Menú → Control; Aprende; catálogo de activadores | Sin terminar: panel informativo, vinculación de marcador, backend solo ingesta (P1) | `/lector-pagos` por dirección; endpoints `/pagos/*` |
| Bloqueados | Oculta; acceso administrativo | Menú → Control; Aprende; enlace del catálogo de activadores | Simplificar el menú; expulsión real con pendientes de activación | `/bloqueados` por dirección; bloquear/desbloquear en Contactos |

## Pendientes (para poder reactivar)

- **Resultados**: estructura para el número ganador (requiere migración autorizada) y registro del resultado.
- **Lector de pagos**: vinculación real del teléfono, vista de movimientos, asociación con reservas, verificación del APK.
- **Bloqueados**: confirmar el modo de expulsión en el servidor y probar la expulsión real.

## Decisiones

- 07/11/2026: la administración de sorteos finalizados no depende de Resultados. Se muestra aparte, como lista compacta y sin datos de resultado, solo mientras Resultados esté oculta (sin duplicar).
- 07/11/2026: los enlaces a páginas ocultas se controlan con `rutaVisible` (misma fuente única), no con condiciones sueltas.
- 07/11/2026: la entrada del catálogo «Expulsión de bloqueados» se mantiene porque describe un comportamiento activo en los grupos; ahora remite a Contactos.
- Fuera de alcance (no tocado): la landing pública sigue anunciando la lista de bloqueados y la expulsión automática. Ver riesgos en el registro.

## Procedimiento de reactivación

1. Revisar la ficha de la funcionalidad en FEATURE_VISIBILITY_REGISTER.md (qué falta, pruebas y textos estáticos que hay que restaurar).
2. En `frontend/lib/visibilidad/funcionalidades.ts`, poner su `visible` en `true`. Menú, Aprende y catálogo vuelven a enlazarla solos.
3. Restaurar los textos estáticos indicados en la ficha (artículo «Qué es EFAAT…» para Lector de pagos y Bloqueados).
4. Ajustar `frontend/tests/visibilidad/visibilidad.test.mjs` y ejecutar `npm test --prefix frontend` y `npm run build --prefix frontend`.
5. Actualizar este documento (tablas, decisiones e historial) y la ficha del registro.
6. Desplegar el panel, con autorización.

## Historial de cambios

Nuevas candidatas a ocultamiento (sin autorizar): [LAUNCH_READINESS_AUDIT.md](LAUNCH_READINESS_AUDIT.md) §8.

| Fecha | Cambio | Estado |
|---|---|---|
| 07/11/2026 | Fase 1: control central `lib/visibilidad/funcionalidades.ts`. Se ocultan Resultados (Eventos), Lector de pagos y Bloqueados (menú). | En `ab7da28d` (commit y push del usuario, 07/11 13:09) |
| 07/11/2026 | Fase 2: «Finalizados recientes» recupera «Administrar sorteo» de los finalizados; `rutaVisible` oculta las guías de Aprende y los enlaces del catálogo de activadores a páginas ocultas; la expulsión de bloqueados remite a Contactos. | En `ab7da28d` (commit y push del usuario, 07/11 13:09) |
