# EFAAT — Automation Engine — Fase 4B: Scheduler real (REMINDER/UPDATE/CLOSE)

Estado: **entregada, 179/179 pruebas en verde. No se marca cerrada hasta aprobación explícita. Scheduler NO arrancado en producción todavía (feature construida y probada, sin conectar a `bot/index.js`).**

---

## 1. Arquitectura

```
backend/automation/
├── engine.js                    (MODIFICADO: enviarMensajeApertura() ahora
│                                  es un envoltorio delgado sobre la nueva
│                                  enviarMensajeProgramado(), generalizada)
├── eventRules.js                 (MODIFICADO: + minutosEntre(), puro)
├── executionGuard.js             (sin cambios — REUTILIZADO)
├── messageSelector.js            (sin cambios — REUTILIZADO)
├── variableResolver.js           (sin cambios — REUTILIZADO)
├── scheduler.js                  (NUEVO — el Scheduler)
└── repo/
    ├── eventSessions.js          (MODIFICADO: + obtenerAbiertasPorSesion())
    ├── automationConfig.js       (sin cambios — REUTILIZADO)
    ├── messages.js                (sin cambios — REUTILIZADO)
    ├── eventosBot.js              (NUEVO — SOLO LECTURA de eventos_bot)
    └── reservasActividad.js       (NUEVO — SOLO LECTURA de reservas_actividad)

backend/supabase_migrations/
└── 008_automation_schedule.sql   (NUEVA — 1 columna jsonb aditiva)

backend/tests/scheduler/
├── entornoFake.js
└── schedulerAutomation.test.js   (21 casos: los 20 pedidos + 1 refuerzo)

backend/tests/automation/fakeSupabaseAutomation.js  (MODIFICADO: + tabla
    reservas_actividad, + .gte())
```

**Ningún archivo de `bot/` se tocó en esta fase.** `scheduler.js` no se importa desde ningún archivo de producción todavía — existe, está probado, pero nada lo arranca (ver §9).

## 2. Por qué un Scheduler independiente y no reutilizar `iniciarWorkerEventos.js`

Se revisó `bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js` y `cerrarEvento.js` antes de escribir código nuevo, tal como se pidió. Conclusión: **se replica su mismo patrón (setInterval por sesión + guarda `ejecutando` anti-solapamiento), pero en un archivo propio dentro de `backend/automation/`**, sin modificar `iniciarWorkerEventos.js`, por dos razones:

1. **Dominios distintos.** `workerEventos.js` reconcilia `eventos_bot` (verifica hora de cierre, todos pagados, ejecuta `cerrarEvento()`) — decide sobre el SORTEO. `scheduler.js` decide sobre MENSAJERÍA de Automation a partir de un sorteo que otro sistema ya decidió — mezclar ambas responsabilidades en el mismo archivo/worker habría violado "única responsabilidad" pedida explícitamente.
2. `iniciarWorkerEventos.js` es infraestructura ya usada en producción por el bot real — modificarla para que también dispare Automation la habría acoplado a un sistema que todavía no está aprobado para producción, y habría sido más invasivo que el problema que resuelve (mismo criterio ya aplicado en Fase 2B para `executionGuard.js`/`repo/eventSessions.js`).

`cerrarEvento.js` tampoco se modifica: el Scheduler **reacciona** a que `eventos_bot.activo` ya quedó en `false` (lo que `cerrarEvento.js` hace, sin cambios) — nunca decide el cierre por su cuenta ni reemplaza esa cadena. Ver prueba 5b.

## 3. Acciones implementadas

| Acción | Dispara cuando | Clave de idempotencia |
|---|---|---|
| `REMINDER_<N>M` | faltan `N` minutos o menos para `hora_cierre` (real, en vivo) y `automation_configs.recordatorios["<N>"].activo === true` | `<eventSessionId>:REMINDER_<N>M` |
| `UPDATE_MESSAGE` | `mensaje_actualizacion.activo === true`, pasó el cooldown desde la última actualización, y hay `>= umbral_reservas` reservas nuevas (`reservas_actividad`, tipo `reservado`, desde la última actualización/apertura) | `<eventSessionId>:UPDATE_MESSAGE:<numeroActualizacion>` |
| `CLOSE_MESSAGE` | `eventos_bot.activo === false` (el sistema de cierre EXISTENTE ya cerró de verdad) y `mensaje_cierre.activo === true` | `<eventSessionId>:CLOSE_MESSAGE` |

`OPEN_MESSAGE` (Fase 4A) no cambió de comportamiento externo.

Los offsets de recordatorio **no están hardcodeados**: `scheduler.js` recorre todas las claves de `automation_configs.recordatorios` (cualquier número de minutos), así que agregar un recordatorio nuevo es un cambio de configuración, no de código.

## 4. Cálculo de tiempos

Siempre contra el evento **real y en vivo** (`repo/eventosBot.js`, solo lectura, nunca `datos_evento_snapshot` para lo que cambia). `eventRules.minutosEntre(horaActualHHmm, horaCierreHHmm)` (nueva función pura, misma zona horaria America/Bogota que ya usa `evaluarApertura()`) calcula la diferencia. `procesarEventSession()`/`evaluarRecordatorios()`/`evaluarActualizacion()` aceptan un `ahora` inyectable (`opciones.ahora`, mismo patrón que `engine.onEventoDetectado(evento, { ahora })`) — en producción es la hora real; en las pruebas, una fecha fija, para que ningún resultado dependa del reloj de la máquina que corre los tests.

## 5. Idempotencia y concurrencia

Sin ningún mecanismo nuevo: **cada acción pasa por `executionGuard.ejecutarUnaVez()`** (Fase 2B, sin tocar), con la clave de idempotencia de la tabla de arriba. Dos Schedulers (o dos ticks) evaluando el mismo `event_session` al mismo tiempo compiten por el mismo `INSERT` con `UNIQUE(clave_idempotencia)` real de Postgres — exactamente la misma protección que ya usa `OPEN_MESSAGE`. Probado con `Promise.all` de dos/tres `tick()` simultáneos (pruebas 8 y 14): un solo envío, una sola fila.

## 6. Message Pool integrado

`scheduler.js` **nunca** selecciona un mensaje ni resuelve variables ni envía directamente — todo pasa por `engine.enviarMensajeProgramado()` (nueva, generalizada a partir de `enviarMensajeApertura()` de Fase 4A): `messageSelector.seleccionarMensaje()` → `variableResolver.resolverVariables()` → `executionGuard.ejecutarUnaVez()` → `services/baileys/send.js` (existente) → `messagesRepo.registrarUso()`. `enviarMensajeApertura()` sigue existiendo con el mismo contrato externo, ahora como envoltorio de una línea sobre la función generalizada — ningún llamador externo (`detectarEvento.js`) cambió.

Variables reales usadas por REMINDER/UPDATE: `{nombre_evento}{valor}{hora_cierre}{reservados}{disponibles}{premio}` — las mismas que ya construye `construirVariablesDesdeEvento()` desde Fase 4A, ahora alimentada con el `evento` **en vivo** (`eventosBotRepo.obtenerPorId`), no el snapshot. Si la plantilla usa una variable que el evento real no trae, no se envía nada (prueba 10) — igual que en Fase 4A.

## 7. Migración 008 (pendiente de aplicar manualmente)

Se evaluó primero resolverlo todo con el modelo existente (006/007) y casi todo se logró sin tocar SQL: `recordatorios` y `mensaje_cierre` (ambas jsonb, ya existían en 006) cambiaron de **forma esperada por el código** — de `{activo, texto}` (Fase 2B, antes del Message Pool) a `{activo, categoria}` (el texto ahora sale siempre de `automation_messages`) — eso no requiere ninguna migración, jsonb es deliberadamente abierta para esto.

Lo único que no tenía un lugar limpio: el interruptor `{activo, categoria}` de `UPDATE_MESSAGE`. Ninguna columna existente se llamaba así ni encajaba semánticamente sin generar confusión. `008_automation_schedule.sql` agrega **una sola columna** (`automation_configs.mensaje_actualizacion jsonb not null default '{}'::jsonb`, con `IF NOT EXISTS`) — no crea ninguna tabla nueva, no modifica 006 ni 007. No necesita RLS propia: `automation_configs` ya tiene RLS de fila (`auth.uid() = usuario_id`) desde 006, que cubre automáticamente cualquier columna nueva de esa misma fila.

**No se ejecutó contra Supabase** (misma limitación técnica ya reportada en el paso de activación de 007: no hay CLI/token de gestión/conexión directa a Postgres disponible para este asistente) — hace falta que se aplique manualmente en el SQL Editor, igual que 001-007. Hasta que se aplique, `config.mensaje_actualizacion` llega `undefined` desde Supabase real y `evaluarActualizacion()` simplemente no hace nada (`if (!config.mensaje_actualizacion...) return`) — no rompe nada, UPDATE_MESSAGE solo queda inactivo hasta que se aplique la migración y se configure.

## 8. Tests — 21/21 (`backend/tests/scheduler/schedulerAutomation.test.js`)

Los 20 pedidos, más una prueba de refuerzo (5b: confirma que el Scheduler nunca decide el cierre por su cuenta comparando horas, solo reacciona a `eventos_bot.activo=false`). `ahora` siempre inyectado explícitamente — ningún resultado depende del reloj real, salvo las pruebas 17/18 (`start()`/`stop()`), que usan intervalos reales cortos (40-80ms) con esperas reales acotadas, siguiendo el mismo criterio que ya usan las pruebas de `iniciarWorkerEventos` en espíritu.

**Resultado total: 179/179** (89 preexistentes + 36 Fase 2B + 15 Fase 3 + 17 Fase 4A + 21 Fase 4B, sin restar ni redondear).

## 9. Producción — sin arrancar todavía

`scheduler.start()`/`scheduler.stop()` existen y están probados, pero **ningún archivo de producción los importa**. `bot/index.js` sigue arrancando solo `iniciarWorkerEventos()`, exactamente como antes de esta fase. Conectar el Scheduler al arranque real del backend queda fuera de esta fase — se pidió explícitamente no auto-arrancarlo todavía.

## 10. Validación

- `git status --short`: solo los archivos listados en §1 (más los cambios de frontend preexistentes, no tocados por este trabajo).
- `git diff --check`: sin conflictos ni errores de espacio en blanco (solo avisos informativos de normalización LF→CRLF de Git en Windows).
- Cero dependencias nuevas (`package.json` sin cambios).
- `006_automation_engine.sql` y `007_automation_messages.sql`: intactos.
- `bot/funciones/eventos/detectarEvento.js`, `desconectado.js`, `conectado.js`, `manager.js`: sin tocar en esta fase.
- Reservas: solo lectura nueva (`repo/reservasActividad.js`, `repo/eventosBot.js`) — ningún `insert`/`update`/`delete` agregado sobre `reservas_actividad`, `eventos_bot`, `reservas_dos_cifras` ni `5k_15k_reservas_2_cifras`.
- Scheduler no arrancado en producción (§9).
- Ningún mensaje real, ningún grupo real, ninguna sesión real de WhatsApp tocada durante las pruebas — 100% fakes/mocks.

## 11. Qué queda para Fase 4C (no iniciado)

- Aplicar `008_automation_schedule.sql` manualmente en Supabase (igual que 006/007) y confirmar por lectura, como ya se hizo con 006/007.
- Conectar `scheduler.start(sock)`/`scheduler.stop(sessionId)` al ciclo de vida real del backend (`bot/index.js`, junto a `iniciarWorkerEventos`/`detenerWorkerEventos`) — requiere aprobación explícita, es el primer archivo de `bot/` que esta fase tocaría.
- Stickers (`automation_configs.stickers`): el punto de extensión quedó preparado en `engine.enviarMensajeProgramado()` (comentario explícito, sin código), pero no implementado — se pidió así.
- UI de configuración por evento (qué categorías de recordatorio/actualización/cierre están activas) — dominio ya soportado por el esquema (`recordatorios`/`mensaje_actualizacion`/`mensaje_cierre` por `usuario_id`+`grupo_id`), falta la interfaz (Fase 5 del roadmap original).
- Verificación con un caso real de recuperación tras reinicio con un recordatorio vencido durante la caída (la prueba 16 lo cubre con fakes; falta el ensayo con Supabase real, análogo a lo pendiente ya documentado para Fase 3/4A).
- `mensaje_inicio_dia` (Fase 5 del roadmap) — fuera de esta fase.
