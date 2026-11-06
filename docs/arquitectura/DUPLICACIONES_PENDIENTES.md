# Duplicaciones pendientes

Inventario F1-C, 06/11/2026. Parte de la auditoría 360 del 06/11 y se volvió a comprobar contra el código actual. Nada de esto se ha cambiado. La columna «Fase» es la propuesta del plan F0–F10 y **cada fase requiere autorización**.

| Id | Qué está duplicado | Dónde (verificado hoy) | Riesgo | Fase |
|---|---|---|---|---|
| D1 | Dos orquestadores que crean o abren un evento | `bot/funciones/eventos/detectarEvento.js::detectarEvento` y `sorteos/publicador.js::publicarEnGrupo` (los dos escriben con `guardarEvento` y pasan por `motorEventos`) | Con latencia real pueden crear dos filas para el mismo sorteo y grupo: no hay índice único (C2) | F2 / F4 |
| D2 | Cuatro formas de cerrar o sustituir un evento | `detectarEvento.js::sustituirEnGrupo`, `shared/eventos/unSorteoPorPrecio.js::reemplazarAnteriores`, `lifecycle/cerrarEvento.js::cerrarFilaDeEvento`, `sorteos/gestionEventos.js` | Una fila puede quedar `activo=true` y «cerrada» a la vez (C3) | F2 / F3 |
| D3 | Estado de `eventos_bot` repartido en 5 columnas | `activo`, `abierto`, `estado`, `cierre_estado`, `cierre_motivo` (con prefijos `panel:`, `sustituido`, `recuperado:`); no hay CHECK sobre `estado` | Interpretaciones distintas en cada lector | F3 / F4 (base de datos) |
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

## Resueltas en F1-B

Hora de Colombia (13 copias en el backend y 5 en el panel), `contarNumeros` (2), lista de liberación (2, C5), contexto de auditoría (2), `ESTADOS_SIN_PUBLICAR` ambiguo (dos significados), `ESTADOS_EDITABLES` (3) y `fechaCompraDeFila`, que no usaba la fuente única de hora. Ver [FUENTES_UNICAS.md](FUENTES_UNICAS.md).
