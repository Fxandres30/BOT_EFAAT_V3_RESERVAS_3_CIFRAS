# EFAAT — Automation Engine — Roadmap

Complementa [`EFAAT_AUTOMATION_MASTER_SPEC.md`](./EFAAT_AUTOMATION_MASTER_SPEC.md). Este documento se actualiza según avanza el desarrollo — cada fase se marca al cerrarse, con fecha y qué quedó realmente implementado (para que nunca quede desactualizado respecto al código real).

Convención de estado: `⬜ pendiente` · `🟨 en curso` · `✅ cerrada`.

---

## Fase 0 — Auditoría
**Estado: ✅ cerrada.**
Entregado como mensaje de auditoría en la conversación (arquitectura, flujo, multiusuario, riesgos, modelo de datos propuesto). No generó archivos en el repo.

## Fase 1 — Documentación y modelo (esta fase)
**Estado: ✅ cerrada.**
Entregables: este archivo y `EFAAT_AUTOMATION_MASTER_SPEC.md`. Cero cambios de código de producción.

---

## Fase 2 — Cimientos del Automation Engine (sin activar automatización real todavía)
**Estado: 🟨 en curso.** Fase 2A (verificación) cerrada — ver `EFAAT_AUTOMATION_PHASE_2A_FINDINGS.md`. Fase 2B (construcción) entregada — ver `EFAAT_AUTOMATION_PHASE_2B_IMPLEMENTATION.md`. **No se marca ✅ hasta confirmar aprobación explícita y, si aplica, resolver los pendientes ahí documentados** (verificación de RLS en Supabase para las tablas núcleo).

Objetivo: dejar la infraestructura creada y probada de forma aislada, sin que ningún grupo real reciba todavía una acción automática.

1. Migración SQL nueva (`006_automation_engine.sql`, a mano en el editor de Supabase, mismo procedimiento que 001–005):
   - `event_sessions`, `automation_actions`, `automation_configs`, `grupos_autorizados` (esquema de §6, §8, §18 del spec).
   - RLS `auth.uid() = usuario_id` en las 4, mismo patrón que `plantillas_mensaje`.
2. `backend/automation/` — `engine.js`, `eventRules.js`, `executionGuard.js`, `repo/eventSessions.js`, `repo/automationConfig.js`. Sin conectar todavía a `eventHandler.js`.
3. Pruebas aisladas (mismo estilo que `backend/tests/sesiones/`: fakes de Supabase, sin red real) cubriendo:
   - cálculo de `identidad_ciclo` y detección de ciclo nuevo vs repetido;
   - `ExecutionGuard.ejecutarUnaVez` (incluyendo la carrera: dos llamadas concurrentes con la misma clave → solo una ejecuta);
   - `EventRules.evaluarApertura` con las 6 condiciones del §13, cada una probada en aislamiento.
4. **Sin tocar `eventHandler.js` todavía.** El engine se prueba invocándolo directamente desde los tests, no desde el flujo real.

Criterio de salida: suite de pruebas en verde, `docs/EFAAT_AUTOMATION_MASTER_SPEC.md` §6/§8/§13 verificado contra el código real de esta fase (si algo cambió de diseño al implementar, se actualiza el spec antes de cerrar la fase).

---

## Fase 3 — Conexión al flujo real (autorización de apertura solamente)
**Estado: 🟨 en curso — entregada, pendiente de aprobación final.** Ver `EFAAT_AUTOMATION_PHASE_3_IMPLEMENTATION.md`.

**Corrección respecto al plan original de esta sección** (Fase 2A, verificación de código real, cambió el punto de conexión previsto en Fase 1): el enganche real no quedó en `eventHandler.js` sino **dentro de `detectarEvento.js`**, entre `guardarEvento()` y `abrirGrupo()` — es el único punto donde existe, ya resuelto, el evento completo (`eventoGuardado`) ANTES de que el mecanismo de apertura existente se ejecute. Conectar en `eventHandler.js` (que recibe el evento DESPUÉS de que `detectarEvento()` ya abrió) nunca hubiera podido evitar la apertura prematura — ver §5 de `EFAAT_AUTOMATION_PHASE_2A_FINDINGS.md`.

1. Único archivo de producción modificado: `bot/funciones/eventos/detectarEvento.js` — se inserta una consulta a `automation/engine.js` entre `guardarEvento()` y `abrirGrupo()`; si el Automation Engine no autoriza, `abrirGrupo()` nunca se llama. `extraerEvento()`, `guardarEvento()`, `consultarEvento()`, `abrirGrupo()`, `cerrarGrupo()`, `workerEventos()`, el dispatcher y el middleware quedaron intactos.
2. Alcance deliberadamente mínimo, tal como se ejecutó: **solo la decisión de autorizar o no la apertura** (grupo autorizado + configuración activa + día/horario permitidos + evento válido + ciclo no duplicado) + creación del `event_session`. **`OPEN_MESSAGE`/`OPEN_STICKER` NO se implementaron en esta fase** (quedan en Fase 4, más abajo — se corrige aquí el plan original de Fase 1, que los había previsto para esta fase).
3. Sin configuración para un grupo → Automation rechaza siempre (`configuracion_inactiva`) → comportamiento IDÉNTICO al actual para cualquier grupo todavía no configurado. Esto ya funciona como el "feature flag" que preveía el plan original — no hizo falta ninguna bandera adicional, es una consecuencia directa de cómo ya estaba diseñado `evaluarApertura()` desde Fase 2B.
4. Fallback de seguridad agregado durante la implementación (no estaba en el plan original, necesario en la práctica): si el propio Automation Engine lanza una excepción (p. ej. porque la migración 006 todavía no se aplicó en Supabase), `detectarEvento.js` **conserva el comportamiento actual y abre igual**, dejando un log de error claro — nunca deja de abrir un grupo por una falla de infraestructura de Automation. Ver `EFAAT_AUTOMATION_PHASE_3_IMPLEMENTATION.md` para el razonamiento completo.

Criterio de salida (cumplido): 12 pruebas de integración en verde (`backend/tests/deteccion/deteccionAutomation.test.js`) demostrando autorización, rechazo por cada motivo, no-duplicación ante ciclo repetido/concurrencia/reinicio, y que `abrirGrupo()` sigue siendo el único mecanismo real de apertura. Pendiente de aplicar `006_automation_engine.sql` en Supabase antes de que esta lógica tenga efecto real (hoy cae siempre en el fallback de "abrir igual", ver punto 4).

---

## Fase 4 — Mensajes/stickers de apertura, recordatorios y cierre
**Estado: 🟨 en curso.** Fase 4A (Message Pool + selector aleatorio + variables + OPEN_MESSAGE) entregada — ver `EFAAT_AUTOMATION_PHASE_4A_IMPLEMENTATION.md`. Pendiente: OPEN_STICKER, CLOSE_MESSAGE/CLOSE_STICKER, Scheduler, recordatorios.

1. `Scheduler` completo (§9), `ReminderRules` (§10).
1b. `OPEN_MESSAGE`/`OPEN_STICKER` (movidos aquí desde el plan original de Fase 3, ver corrección en esa sección): ExecutionGuard.ejecutarUnaVez() envolviendo el envío real (`services/baileys/send.js`, sin duplicar) justo después de que `engine.onEventoDetectado()` cree el `event_session`, usando `automation_configs.mensaje_apertura`/`stickers.apertura`.
2. Enganche de `CLOSE_MESSAGE`/`CLOSE_STICKER` reaccionando a `eventos_bot.activo=false` (§14).
3. Verificar recuperación tras reinicio con un caso real: reiniciar el backend con un Event Session `abierto` y un recordatorio vencido durante la caída → debe enviarse una sola vez al volver.

## Fase 5 — Mensaje de inicio del día y permisos

1. `automation_configs.mensaje_inicio_dia` + horarios por día de semana (§15, §16 del spec de Fase 0).
2. `grupos_autorizados` ya está conectado de verdad a `EventRules` paso 1 desde Fase 3 (no quedó detrás de ningún feature flag adicional — sin fila en `grupos_autorizados`, `evaluarApertura()` ya rechaza por diseño). Esta fase es sobre construir la UI de gestión, no sobre la conexión en sí.
3. UI de panel: página de configuración de automatización por grupo (días, horarios, mensajes, stickers, recordatorios activos, umbral+cooldown de actualización) — "mis automatizaciones", ya multiusuario porque `automation_configs` nace con `usuario_id`.

## Fase 6 — Actualización por movimiento (reglas e idempotencia, sin la acción de reenvío)

1. `UpdateRules` completo (§11), contador `actualizaciones_enviadas`, cooldown.
2. Reconocimiento de `"actualizar"/"actualiza la tabla"/"tabla"` con autorización — conectado, pero su acción final (reenviar la tabla) queda **bloqueada explícitamente** con un TODO documentado hasta que exista Compartir (Fase 6 del roadmap original de Fase 0, fuera de esta rama de trabajo).

## Fase 7 — Cierre y recuperación (endurecimiento)

1. Barrido de `event_sessions` `expirado` (higiene, §7).
2. Métricas/alertas simples sobre `automation_actions.resultado='error'`.
3. Pruebas de caos controladas: matar el proceso en medio de una apertura, en medio de un recordatorio, con dos instancias (LOCAL/VPS) compitiendo por la misma sesión — confirmar que `ExecutionGuard` sostiene la idempotencia en todos los casos.

## Fase 8 — Auditoría y observabilidad

1. Vista de panel sobre `automation_actions` + `event_sessions` ("actividad de automatización"), mismo espíritu que `ActividadReciente.tsx` ya existente para reservas.
2. Alcance: quién (usuario/bot), qué (tipo_accion), cuándo, dónde (grupo), resultado.

## Fase 9 — Pruebas completas

Igual que el plan original de Fase 0: un usuario, varios usuarios, varios grupos, varios eventos, reinicio, duplicación, permisos, horarios, detección real, actualización, cierre — pero ahora con la matriz de decisiones de `EFAAT_AUTOMATION_MASTER_SPEC.md` §19 como checklist explícito de casos a verificar uno por uno.

---

## Fuera de este roadmap (pertenecen a otras líneas de trabajo, no a Automation Engine)

Rediseño de tablas de reservas, botón Compartir real, generación de imagen/texto, pagos, IA de detección, QR/reconexión. Cada una necesitaría su propio roadmap cuando se aborde.
