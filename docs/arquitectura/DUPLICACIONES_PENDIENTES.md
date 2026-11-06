# Duplicaciones pendientes

Inventario F1-C, 06/11/2026. Parte de la auditoría 360 del 06/11 y se volvió a comprobar contra el código actual. Nada de esto se ha cambiado. La columna «Fase» es la propuesta del plan F0–F10 y **cada fase requiere autorización**.

| Id | Qué está duplicado | Dónde (verificado hoy) | Riesgo | Fase |
|---|---|---|---|---|
| D1 | Dos orquestadores que crean o abren un evento | `bot/funciones/eventos/detectarEvento.js::detectarEvento` y `sorteos/publicador.js::publicarEnGrupo` (los dos escriben con `guardarEvento` y pasan por `motorEventos`) | Con latencia real pueden crear dos filas para el mismo sorteo y grupo: no hay índice único (C2) | F2 / F4 |
| D2 (detalle en [F3_CIERRE_REAPERTURA.md](F3_CIERRE_REAPERTURA.md) §2: 4 escrituras de cierre, 2 de ellas sin condición; cierre por pagos duplicado con una cadena sin uso; dos políticas de WhatsApp; avisos con claves permanentes que no sirven tras reabrir) | Cuatro formas de cerrar o sustituir un evento | `detectarEvento.js::sustituirEnGrupo`, `shared/eventos/unSorteoPorPrecio.js::reemplazarAnteriores`, `lifecycle/cerrarEvento.js::cerrarFilaDeEvento`, `sorteos/gestionEventos.js` | Una fila puede quedar `activo=true` y «cerrada» a la vez (C3) | F2 / F3 |
| D3 | Estado de `eventos_bot` repartido en 5 columnas | `activo`, `abierto`, `estado`, `cierre_estado`, `cierre_motivo` (con prefijos `panel:`, `sustituido`, `recuperado:`); no hay CHECK sobre `estado` | **F2 cerrado:** una sola fuente (`estadosGestion.js` y su espejo del panel). El criterio D del panel desapareció (panel = backend). Las reservas por WhatsApp, los recordatorios y las consultas del cliente usan el canónico. Siguen con nombre propio B (`sorteosActivos`, `administracion`) y C (Eventos) solo en las pantallas de administración, a la espera de F3 (acciones cerrar/reabrir) y del diagnóstico; las zonas protegidas siguen con sus expresiones. Ver [ESTADO_SORTEOS.md](ESTADO_SORTEOS.md) §5-6 | F3 (acciones) / F4 (CHECK, `NOT NULL` en `activo`) |
| D4 | Resolución de variables de mensajes | `automation/variableResolver.js` y `shared/variables/resolverVariables.js` (más resolvedores en `bot/ai`), y un espejo en el panel | El mismo texto puede salir distinto en la vista previa y en WhatsApp | F5 |
| D5 | Dos motores de recordatorios | `automation/scheduler.js` y `sorteos/publicador.js::procesarPublicados`, coordinados por `prioridadComunicaciones` | Hoy hay coordinación (C4); cualquier cambio tiene que tocar los dos | F6 |
| D6 | Puppeteer sigue en 4 puntos, en contra de la regla del generador único | `services/compartirTabla.js` (`capturarImagenTabla`), `routes/tablas.js` L162 y L492, `sorteos/servicio.js::probarImagen`, `diagnostico/capturaDroplet.js` | La captura falla en el Droplet (13/16 programados fallidos el 30/10) | F7 |
| D7 | Lectores de `grupos_autorizados` | `automation/repo/automationConfig.js`, `bot/funciones/bloqueo/expulsionesRepo.js`, `bot/funciones/grupos/politicaGrupos.js`, `services/destinosCompartir.js`, `services/reservaManual.js`, `sorteos/repo.js` | Un grupo puede contar como autorizado en un flujo y no en otro | F8 |
| D8 | Dos selectores de plantillas | `bot/ai/seleccionarPlantilla.js` y la selección de `automation/messageSelector.js` | Reglas de elección distintas | F5 |
| D9 | El navegador escribe directamente en 13 tablas | `automation_configs`, `automation_messages`, `configuracion_mensajes`, `configuracion_seleccion_mensajes`, `configuracion_stickers_pago`, `grupos_autorizados`, `plantillas_mensaje`, `reservas_actividad`, `sesiones`, `stickers_pago_biblioteca`, `tabla_configuracion_visual`, `tabla_disenos`, `variables_globales` (desde `frontend/services/*`), además de la cuadrícula en `reiniciarTabla.ts` | Las reglas viven en el navegador y en RLS, no en el backend; `reservas_actividad` se puede falsificar desde el navegador (por eso existe la 032) | F8 / F9 |
| D10 | Contadores tras liberar | `reservaManual.sincronizarContadores` (todos los activos de la tabla) frente a `publicador.liberarVencidas` (`actualizarEvento(activos[0])`) | Mismo resultado hoy; dos caminos que mantener | F2 |
| D11 | Espejos panel/backend que no pueden compartir código | hora de Colombia, estados de programación y campos de liberación | Cubiertos por pruebas de sincronía; aun así son dos archivos | aceptado (prueba obligatoria) |
| D12 | Formatos de fecha de presentación en el panel | `HistorialNumero.tsx`, `HistorialNumeros.tsx`, `ReservaManualForm.tsx`, `cuenta.ts`, `PanelAnalitica.tsx`, `disponibilidad.js` (backend) | Formatos distintos a propósito; solo la zona horaria podría venir de la fuente única | F10 (opcional) |
| D13 | Arnés de pruebas copiado | cargadores `cargarTs` en varias pruebas `.mjs` del panel; escenario de `motorEventosUnico` copiado en `caracterizacion/_arnesEventos.js` | Solo afecta a las pruebas | F1-C o posterior (pendiente de decisión) |

## Resueltas en F3 (06/11/2026)

D2 de este documento y D1, D2, D5, D6, D8 y D9 (en parte) de [F3_CIERRE_REAPERTURA.md](F3_CIERRE_REAPERTURA.md):

- Las 4 escrituras de cierre son ahora una sola (`escribirFin`, siempre condicionada) con un solo respaldo para bases antiguas.
- Las sustituciones (anuncio, precio, reinicio, reabrir) pasan por el orquestador conservando su algoritmo.
- El cierre manual reintenta WhatsApp con la misma espera que el automático.
- La reapertura restaura el ciclo y el siguiente cierre se anuncia una vez.
- Endurecimiento: el deshacer de una sustitución (`revertirReemplazo`) pasa por el orquestador (`deshacerSustitucion`); el cierre del grupo de WhatsApp, por un único registro (`cerrarGrupoProtegido`).

**Siguen pendientes:**

- **D3:** cierre por pagos duplicado en la cadena A4 sin uso; no se elimina en F3.
- **D7:** dos emisores de aviso; están coordinados, se tratan en F6/F7.
- **D9:** cálculo duplicado del estado final de la programación.
- **D10:** la regla de «activo» copiada en SQL (043).
- **D11:** criterios B y C en las pantallas de administración (regla 5, a decidir).

## Resueltas en F4-G (06/11/2026)

- Umbral del destino atascado (10 min) copiado en `publicador` y `administracion`, y umbrales de los reclamos repartidos por módulo: ahora todos en `automation/recuperacion.UMBRALES`.
- Comprobación del registro de un envío (OPEN en el motor y anuncio en el publicador): ahora `estadoDelEnvio` y `reenviable`.
- Registro de una apertura confirmada (activación y worker, este sin condición `activo`): ahora `aperturaGrupo.registrarAperturaConfirmada`.

## Resueltas en F4-F.1 (06/11/2026)

- «La programación del sorteo» estaba repetida en tres sitios (`gruposSorteo.programacionDeIdentidad`, `sorteosActivos.sorteoProgramadoDe`, `prioridadComunicaciones.sorteoDelEvento`). Ahora hay un solo criterio: `sorteos/publicacionCompartida.elegirProgramacion`.

## Resueltas en F1-B

Hora de Colombia (13 copias en el backend y 5 en el panel), `contarNumeros` (2), lista de liberación (2, C5), contexto de auditoría (2), `ESTADOS_SIN_PUBLICAR` ambiguo (dos significados), `ESTADOS_EDITABLES` (3) y `fechaCompraDeFila`, que no usaba la fuente única de hora. Ver [FUENTES_UNICAS.md](FUENTES_UNICAS.md).
