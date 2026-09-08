# EFAAT — Automation Engine — Master Spec (Fase 1)

Estado: **documentación de arquitectura. Ningún código de producción fue modificado para producir este documento.**

Este documento fija las reglas y la arquitectura del nuevo Automation Engine de EFAAT. Se apoya, sin modificarlo, en el sistema de detección de eventos ya existente y aprobado.

---

## 1. Objetivo

Agregar una capa de automatización operativa (horarios, mensajes de inicio de día, apertura, stickers, recordatorios, actualizaciones por movimiento, cierre) **alrededor** del bot que ya existe, sin:

- crear un segundo detector de eventos;
- crear una segunda forma de abrir/cerrar grupos;
- crear una segunda forma de enviar mensajes;
- decidir qué sorteo se juega, ni inventar sus datos;
- depender solo de memoria RAM.

---

## 2. Principios (no negociables)

1. **El detector existente es la única fuente de verdad del sorteo.** `detectarEvento()` → `extraerEvento()` → `guardarEvento()` no se tocan, no se duplican, no se reemplazan.
2. **La automatización solo define comportamiento operativo**, nunca datos del sorteo. Ningún campo de `automation_configs` puede llamarse `valor`, `premios`, `hora_sorteo`, `hora_cierre`, `cifras`, etc. — esos SIEMPRE se leen de `evento` (`eventos_bot`), nunca de la configuración.
3. **El horario autoriza, no ejecuta.** Un horario permitido nunca abre un grupo por sí solo — solo determina si, EN CASO de que el detector confirme un evento real, la automatización tiene permiso de actuar.
4. **Reutilización obligatoria.** Toda acción física sobre WhatsApp (abrir/cerrar grupo, enviar mensaje, enviar sticker) pasa por las funciones/colas que ya existen. El Automation Engine nunca llama a `sock.groupSettingUpdate`/`sock.sendMessage` directamente si ya existe un envoltorio.
5. **Persistencia real.** Todo estado que determina si una acción ya se ejecutó vive en Supabase, no en memoria de proceso. Un reinicio del backend nunca debe producir un reenvío ni una doble apertura.
6. **Idempotencia por diseño.** Cada acción automática tiene una clave única verificable antes de ejecutarse.

---

## 3. Qué se inspeccionó para este documento

Backend: `bot/handlers/{dispatcher,eventHandler,messageHandler,commandHandler}.js`, `bot/middleware/obtenerContexto.js`, `bot/funciones/eventos/{detectarEvento,extraerEvento,guardarEvento,consultarEvento,configEvento}.js`, `bot/funciones/eventos/grupos/{abrirGrupo,cerrarGrupo}.js`, `bot/funciones/eventos/lifecycle/{iniciarWorkerEventos,evaluarEvento,verificarHoraCierre,verificarTodosPagados,cerrarEvento,procesarEvento}.js`, `bot/funciones/eventos/workers/workerEventos.js`, `bot/funciones/reservas/{reservarNumeros,actualizarEvento}.js`, `bot/funciones/grupos/sincronizarGrupo.js`, `bot/index.js`, `services/baileys/{send,groupQueue,manager,socket}.js`, `lib/supabase.js`, y las migraciones `001`–`005` en `backend/supabase_migrations/`. Ningún archivo fue editado.

---

## 4. Arquitectura: dónde se conecta el Automation Engine

```
backend/
├── bot/                    ← INTACTO. Detección, reservas, IA de respuestas.
├── services/baileys/       ← INTACTO. Sesión, groupQueue, send.
└── automation/             ← NUEVO. Automation Engine completo, vive aparte.
    ├── engine.js                (AutomationEngine — orquestador)
    ├── eventRules.js            (¿este evento debe abrir? — puro, sin efectos)
    ├── scheduler.js             (día/hora, inicio del día, recordatorios)
    ├── updateRules.js           (umbral de reservas + cooldown)
    ├── executionGuard.js        (idempotencia — lee/escribe automation_actions)
    ├── actions/
    │   ├── abrirEvento.js       (usa abrirGrupo() existente + mensaje + sticker)
    │   ├── cerrarEvento.js      (usa cerrarEvento() existente + mensaje + sticker)
    │   └── enviarSticker.js     (nuevo — no existía envío de stickers)
    └── repo/
        ├── eventSessions.js     (CRUD de la tabla nueva event_sessions)
        └── automationConfig.js  (lectura de automation_configs)
```

**Un único punto de entrada real, y es un archivo que hoy NO está en la lista de "no tocar":**

`backend/bot/handlers/eventHandler.js`, línea 45:

```js
ctx.evento = await detectarEvento(ctx);
```

Este es el momento exacto — y el ÚNICO — en que el sistema sabe "se detectó/confirmó un evento real, con sus datos ya extraídos y ya guardados en `eventos_bot`". `detectarEvento()` internamente ya llama a `extraerEvento()` y `guardarEvento()` (sin cambios) y ya deja el grupo abierto vía `abrirGrupo()` (comportamiento actual, que sigue existiendo tal cual — ver sección 15).

La única modificación que se PROPONE (no se aplica en esta fase) es agregar, justo después de esa línea, una llamada de una sola línea:

```js
if (ctx.evento) {
    automationEngine.onEventoDetectado(ctx.evento, ctx).catch(err => {
        console.error("❌ [AUTOMATION] error procesando evento detectado:", err?.message);
    });
}
```

No bloqueante (`.catch`, no `await` obligatorio salvo que se decida lo contrario en Fase 2), para que un fallo del Automation Engine **nunca** rompa el flujo de detección/reserva que ya funciona. Esta es la única línea nueva prevista en código existente en toda esta especificación — todo lo demás vive en `backend/automation/`.

`detectarEvento()`, `extraerEvento()`, los extractores, `guardarEvento()`, los regex, el dispatcher, el middleware y la reconexión de sesiones **no se tocan** en ningún punto de este diseño.

---

## 5. Flujo completo

```
messages.upsert (Baileys, sin cambios)
    ↓
dispatcher (sin cambios)
    ↓
middleware / obtenerContexto (sin cambios)
    ↓
eventHandler.js
    ↓
detectarEvento(ctx)  ←── SIN CAMBIOS
    │   internamente: extraerEvento() → configEvento → guardarEvento() → abrirGrupo() [comportamiento actual]
    ↓
ctx.evento (fila de eventos_bot, ya guardada)
    ↓
[NUEVO — 1 línea] automationEngine.onEventoDetectado(ctx.evento, ctx)
    │
    ├── ExecutionGuard: ¿ya existe un Event Session para este ciclo real del evento?
    │
    ├── NO existe → EventRules.evaluarApertura(evento, config)
    │   ├── grupo autorizado (grupos_autorizados)         │
    │   ├── día permitido (automation_configs)            │  si TODO pasa:
    │   ├── horario permitido (automation_configs)        │  crear Event Session (estado=abierto)
    │   ├── evento válido (evento.nombre/hora/valor)       │  ExecutionGuard.ejecutarUnaVez(OPEN_MESSAGE)
    │   └── no duplicado / grupo no abierto ya para este   │  ExecutionGuard.ejecutarUnaVez(OPEN_STICKER)
    │       mismo ciclo                                    │  (abrirGrupo() YA se ejecutó dentro de
    │                                                       │   detectarEvento() — no se repite aquí)
    │
    └── SÍ existe (mismo ciclo, ya procesado) → no-op (idempotente)
    ↓
[cada 30s, en paralelo, sin relación de llamada directa]
workerEventos() (sin cambios) → sigue reconciliando apertura y decidiendo cierre por hora/pagados
    ↓
Scheduler (NUEVO, mismo patrón de setInterval por sesión que iniciarWorkerEventos)
    ├── recordatorios: para cada Event Session abierto, ¿ya pasó cierre-2h/1h/30m/...? → enviar + marcar
    ├── actualizaciones por movimiento: ¿nuevas reservas ≥ umbral Y pasó el cooldown? → reutilizar Compartir (fuera de alcance, ver §20)
    └── inicio del día: ¿es la hora configurada de HOY para este grupo? → enviar mensaje informativo (no toca evento)
    ↓
Cuando procesarEvento()/cerrarEvento() (sin cambios) cierran el evento en eventos_bot:
    ↓
[NUEVO] AutomationEngine detecta (por polling del propio Scheduler, ver §9) que el Event Session
    correspondiente debe pasar a estado=cerrado → ExecutionGuard.ejecutarUnaVez(CLOSE_MESSAGE)
```

**Importante**: el cierre real (la decisión de CUÁNDO cerrar) sigue siendo 100% de `evaluarEvento`/`verificarHoraCierre`/`cerrarEvento`, sin cambios. El Automation Engine no decide cuándo cerrar — solo reacciona a que `eventos_bot.activo` pasó a `false` para disparar el mensaje/sticker de cierre. Ver §14.

---

## 6. Event Session

Representa **un ciclo operativo real** de un evento detectado — no es lo mismo que una fila de `eventos_bot`.

### 6.1 Por qué no alcanza con `eventos_bot.id`

Se verificó en `guardarEvento()` ([guardarEvento.js:92-116](../backend/bot/funciones/eventos/guardarEvento.js#L92-L116)) que cuando ya existe una fila para ese `grupo_id` (`consultarEvento()` no filtra por `activo` — [consultarEvento.js:3-21](../backend/bot/funciones/eventos/consultarEvento.js#L3-L21)), el evento se **actualiza (UPDATE) sobre la MISMA fila**, incluso si el sorteo anterior ya se había cerrado. Es decir: **un mismo `eventos_bot.id` puede representar, a lo largo del tiempo, varios sorteos reales distintos del mismo grupo** (el de ayer y el de hoy). Esto es correcto para el bot actual (no necesita historial), pero significa que **`evento.id` por sí solo NO sirve como clave de idempotencia** para el Automation Engine — una acción `OPEN_MESSAGE` ejecutada para el sorteo de ayer no debe bloquear el `OPEN_MESSAGE` del sorteo de hoy, aunque ambos compartan el mismo `evento.id`.

### 6.2 Identidad de ciclo

Cada vez que el Automation Engine recibe `ctx.evento`, calcula una **identidad de ciclo** determinística (sin tocar `guardarEvento`, calculada aparte, solo lectura):

```
identidad_ciclo = hash(evento.grupo_id, evento.nombre_evento, evento.hora_fin, evento.valor, evento.fecha_evento)
```

Si ya existe un `event_sessions` con esa `identidad_ciclo` → es el MISMO ciclo (re-detección del mismo mensaje, o una actualización menor) → no se abre uno nuevo. Si no existe (o el anterior para ese `grupo_id` está `cerrado`/`expirado` y los datos cambiaron) → es un ciclo NUEVO → se crea un Event Session nuevo.

### 6.3 Esquema propuesto — `event_sessions` (nueva tabla)

| columna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `evento_id` | uuid | FK `eventos_bot.id` — referencia informativa, no la clave de unicidad |
| `identidad_ciclo` | text | única por `grupo_id` mientras el ciclo esté vivo (ver 6.2) |
| `grupo_id` | text | |
| `session_id` | uuid | FK `sesiones.id` (sesión de WhatsApp que detectó el evento) |
| `usuario_id` | uuid | dueño (de la sesión / del grupo autorizado) |
| `automation_config_id` | uuid | FK a la configuración aplicada en el momento de abrir |
| `estado` | text | `pendiente` \| `abierto` \| `cerrando` \| `cerrado` \| `expirado` |
| `abierto_en` | timestamptz | null hasta que se confirma apertura |
| `cerrado_en` | timestamptz | null hasta el cierre |
| `datos_evento_snapshot` | jsonb | copia de nombre/hora/valor/premios en el momento de abrir — auditoría, nunca fuente de verdad en caliente (la fuente de verdad en caliente sigue siendo `eventos_bot`) |
| `creado_en` / `actualizado_en` | timestamptz | |

RLS: `auth.uid() = usuario_id`, mismo patrón que `plantillas_mensaje`/`reservas_actividad`.

---

## 7. Ciclo de vida del Event Session

```
(no existe)
    │  detectarEvento() confirma evento + EventRules.evaluarApertura() = OK
    ▼
pendiente ──── ExecutionGuard.ejecutarUnaVez(OPEN_MESSAGE, OPEN_STICKER) ────▶ abierto
    │                                                                            │
    │ EventRules.evaluarApertura() = rechazado (fuera de horario/grupo no       │ Scheduler: recordatorios
    │ autorizado/etc.) → nunca pasa a "abierto", queda como intento fallido      │ (REMINDER_2H...5M)
    │ registrado en automation_actions (ver §8), NO bloquea reservas/consultas  │ Scheduler: actualizaciones
    │ normales del bot (esas siguen funcionando igual, vía eventos_bot)         │ (UPDATE_THRESHOLD/MANUAL)
    ▼                                                                            │
(sin Event Session — el bot sigue operando el evento normalmente,               │
 solo que sin la capa de automatización encima)                                 │
                                                                                  │
                                    eventos_bot.activo pasa a false              │
                                    (cerrarEvento() ya ejecutado, sin cambios)   │
                                                                                  ▼
                                                                              cerrando
                                                                                  │ ExecutionGuard.ejecutarUnaVez(CLOSE_MESSAGE)
                                                                                  ▼
                                                                              cerrado
```

`expirado`: un Event Session que quedó en `pendiente` u `abierto` por más de N horas sin que `eventos_bot` correspondiente exista o siga activo (p. ej. tras un borrado manual del evento, o una migración de datos) — barrido de higiene, no bloqueante, ejecutado por el mismo Scheduler.

---

## 8. Idempotencia

Tabla nueva `automation_actions` (append-only, nunca se actualiza ni se borra):

| columna | tipo |
|---|---|
| `id` | uuid PK |
| `event_session_id` | uuid, null para `DAILY_START_MESSAGE` (no pertenece a un evento) |
| `grupo_id` | text |
| `tipo_accion` | text (enum lógico, ver lista abajo) |
| `clave_idempotencia` | text, **UNIQUE** |
| `ejecutado_en` | timestamptz |
| `resultado` | text: `ok` \| `error` |
| `detalle` | jsonb |

**Cómo se construye `clave_idempotencia`** (determinística, calculable ANTES de ejecutar, nunca un contador en memoria):

| tipo_accion | clave_idempotencia |
|---|---|
| `OPEN_MESSAGE` | `event_session_id:OPEN_MESSAGE` |
| `OPEN_STICKER` | `event_session_id:OPEN_STICKER` |
| `REMINDER_2H` / `_1H` / `_30M` / `_15M` / `_10M` / `_5M` | `event_session_id:REMINDER_2H` (una por tipo, no se repite) |
| `UPDATE_THRESHOLD` | `event_session_id:UPDATE_THRESHOLD:<contador_de_actualizaciones>` — el contador vive en `event_sessions` (columna `actualizaciones_enviadas`), se incrementa atómicamente antes de generar la clave |
| `UPDATE_MANUAL` | `event_session_id:UPDATE_MANUAL:<message_id_de_whatsapp_que_lo_pidió>` — reutiliza el id de mensaje de Baileys, ya único |
| `CLOSE_MESSAGE` | `event_session_id:CLOSE_MESSAGE` |
| `CLOSE_STICKER` | `event_session_id:CLOSE_STICKER` |
| `DAILY_START_MESSAGE` | `grupo_id:DAILY_START_MESSAGE:<fecha_YYYY-MM-DD>` |

**Contrato de `ExecutionGuard.ejecutarUnaVez(clave, fn)`**:
1. `INSERT` en `automation_actions` con esa `clave_idempotencia` (constraint UNIQUE la protege).
2. Si el INSERT falla por violación de unicidad (23505) → la acción YA se ejecutó (o está en curso) → no se ejecuta `fn`, se devuelve `{yaEjecutada: true}`.
3. Si el INSERT tiene éxito → se ejecuta `fn()` (la acción real: enviar mensaje/sticker/abrir/cerrar). Si `fn()` falla, se actualiza esa misma fila con `resultado='error'` (no se borra: un reintento posterior debe decidir explícitamente si reintenta, no reintentar solo porque la fila "no existe").

Este patrón es el mismo principio atómico ya usado en `lease_sesiones_acquire` (INSERT con UNIQUE resuelto por Postgres bajo lock de fila, no "select→comprobar→insert" desde Node) y en `pagos_movimientos_unico_no_duplicado` (índice único parcial) — se reutiliza la misma estrategia que el proyecto ya valida en producción, no se inventa una nueva.

---

## 9. Scheduler

**No se crea un segundo `setInterval` genérico.** Se sigue el mismo patrón que `iniciarWorkerEventos.js` ([iniciarWorkerEventos.js:13-62](../backend/bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js#L13-L62)): un `setInterval` por `sessionId`, con un `Set` que evita que dos ticks del mismo timer se solapen si uno tarda más de lo esperado.

`automation/scheduler.js` se inicia desde el MISMO lugar donde hoy se inicia `iniciarWorkerEventos(socket)` — dentro de `conectar()` en [bot/index.js](../backend/bot/index.js) (esto SÍ es una línea nueva a agregar en Fase 2, junto a la de `iniciarWorkerEventos(socket)` que ya está ahí; `bot/index.js` no está en la lista de archivos prohibidos de tocar). Se detiene desde el mismo `detenerBot()`, junto a `detenerWorkerEventos()`.

Cada tick (recomendado: cada 60s, configurable) del Scheduler, por sesión activa:
1. Lee `event_sessions` en estado `abierto` de esa sesión → evalúa `ReminderRules` (¿algún recordatorio configurado y activo cuya hora ya pasó y no está en `automation_actions`?) y detecta si el `eventos_bot` correspondiente ya está `activo=false` (cierre) para transicionar a `cerrando`/`cerrado`.
2. Lee `automation_configs` con mensaje de inicio de día activo para HOY (día de la semana + horario) → si no existe `automation_actions` con `DAILY_START_MESSAGE:<hoy>` para ese grupo, lo envía.
3. Evalúa `UpdateRules` (ver §11) sobre los Event Sessions abiertos.

No reemplaza ni compite con `workerEventos()` (que sigue corriendo su propio `setInterval` de 30s sin cambios): son dos workers independientes, cada uno responsable de su propia capa (bot=negocio, scheduler=automatización).

---

## 10. Recordatorios

- La CONFIGURACIÓN (`automation_configs`) decide **qué** recordatorios están activos (2h/1h/30m/15m/10m/5m) y el texto de cada uno.
- El EVENTO decide **cuándo**: los offsets siempre se calculan sobre `evento.hora_cierre` (el mismo campo que ya calcula `calcularCierre()` dentro de `extraerEvento()` — sin tocar esa función, solo se lee su resultado ya guardado en `eventos_bot.hora_cierre`).
- Nunca se le pide al usuario que escriba la hora del sorteo en la configuración — la configuración de recordatorios solo tiene una lista de "offsets activos" (ej. `["2h","1h","30m"]`), no horas absolutas.
- Idempotencia: una clave por tipo de recordatorio por Event Session (§8) — si el Scheduler corre cada 60s y detecta que ya pasó `cierre-30m`, intenta `REMINDER_30M` una vez; en el siguiente tick, `ExecutionGuard` ya la encuentra ejecutada y no repite.

---

## 11. Actualizaciones por movimiento

Regla configurable en `automation_configs`: `{ umbral_reservas: 10, cooldown_minutos: 20 }`.

`UpdateRules.evaluarActualizacion(eventSession)`:
1. Cuenta reservas nuevas desde la última actualización enviada (usa `reservas_actividad`, tipo `reservado`, filtrado por `evento_id` y `creado_en > event_sessions.ultima_actualizacion_en` — tabla y campo YA existentes, sin duplicar el registro de actividad).
2. Si `nuevas >= umbral_reservas` Y `ahora - event_sessions.ultima_actualizacion_en >= cooldown_minutos` → dispara `UPDATE_THRESHOLD` (clave con contador, §8), actualiza `event_sessions.ultima_actualizacion_en = ahora`.
3. Si entran 30 reservas de golpe, esto dispara **una sola** actualización (se compara contra el cooldown, no contra cada reserva individual) — cumple el requisito de "no enviar 3 tablas inmediatas".

**Actualización manual** (`"actualizar"`, `"actualiza la tabla"`, `"tabla"`): se reconoce en el flujo de mensajes existente (mismo lugar donde hoy se reconocen intenciones — `detectarIntencion()` en `commandHandler`/`eventHandler`, ver [eventHandler.js:88-94](../backend/bot/handlers/eventHandler.js#L88-L94)), pero la autorización y la clave de idempotencia (`UPDATE_MANUAL:<message_id>`) las evalúa el Automation Engine, no un segundo detector. Siempre actúa sobre el Event Session **abierto** del grupo — nunca elige ni cambia de sorteo. Fuera de alcance de esta fase: la acción real de "actualizar" (reenviar tabla) depende del botón Compartir, que todavía no existe (ver §20) — en esta fase solo se documenta el enganche de idempotencia y autorización, no el envío.

---

## 12. Stickers

No existe ningún envío de stickers en el código actual (`grep sticker` sobre todo `backend/` no encuentra ningún uso de `sock.sendMessage(..., {sticker: ...})`). Es funcionalidad **nueva**, no una reutilización.

Se documenta como un helper único (`automation/actions/enviarSticker.js`) reutilizado por Opening/Update/Closing — no un `StickerRules` como módulo de reglas separado: la "regla" de si corresponde sticker es solo un booleano dentro de la configuración de cada evento (apertura/actualización/cierre/porcentaje/recta final), no justifica un motor de reglas propio. Cada envío pasa por `ExecutionGuard` igual que un mensaje.

---

## 13. Apertura

```
detectarEvento() confirma evento (SIN CAMBIOS — incluye abrirGrupo() ya integrado, tal como hoy)
    ↓
AutomationEngine.onEventoDetectado()
    ↓
EventRules.evaluarApertura(evento, gruposAutorizados, automationConfig):
    1. grupo autorizado (nuevo: tabla grupos_autorizados, fuera de alcance de tablas/reservas)
    2. día permitido HOY (automation_configs)
    3. horario permitido AHORA (automation_configs)
    4. evento válido (evento.nombre && evento.hora_fin && evento.valor — ya garantizado por extraerEvento,
       se revalida por defensividad, no se recalcula)
    5. no duplicado (identidad_ciclo, §6.2)
    6. grupo no abierto ya para ESTE mismo ciclo (event_sessions.estado != 'abierto' para esta identidad_ciclo)
    ↓ (todo OK)
crear event_sessions (estado=pendiente → abierto)
    ↓
ExecutionGuard.ejecutarUnaVez('OPEN_MESSAGE', () => sendMessage(...))   [services/baileys/send.js, SIN CAMBIOS]
ExecutionGuard.ejecutarUnaVez('OPEN_STICKER', () => enviarSticker(...)) [NUEVO]
```

**Nota importante**: `abrirGrupo()` real (el `groupSettingUpdate`) YA ocurre dentro de `detectarEvento()` hoy, independientemente de que exista o no el Automation Engine — eso no cambia. El Automation Engine no vuelve a abrir el grupo; solo decide si, ADEMÁS, corresponde iniciar el Event Session y sus acciones posteriores (mensaje/sticker). Si `EventRules` rechaza (p. ej. fuera de horario configurado), el grupo se abre igual (comportamiento actual intacto, requisito del proyecto de no romper nada existente) pero **sin** las acciones de automatización encima — esto se documenta como una discrepancia consciente a resolver explícitamente en Fase 2 (ver §18, permisos) si se decide que la automatización debe poder impedir la apertura real y no solo las acciones posteriores.

---

## 14. Cierre

El cierre NUNCA usa una hora inventada en `automation_configs`. La única fuente de la hora de cierre es `eventos_bot.hora_cierre` (ya calculada por `calcularCierre()` dentro de `extraerEvento()`), y la única decisión de "cuándo cerrar" sigue siendo `evaluarEvento()`/`verificarHoraCierre()`/`verificarTodosPagados()` ([evaluarEvento.js](../backend/bot/funciones/eventos/lifecycle/evaluarEvento.js), sin cambios), ejecutados por `workerEventos()` cada 30s (sin cambios).

El Automation Engine solo **observa** el resultado: cuando el Scheduler detecta `eventos_bot.activo = false` para un evento cuyo `event_sessions` sigue en `abierto`, dispara `CLOSE_MESSAGE`/`CLOSE_STICKER` (vía `ExecutionGuard`) y transiciona el Event Session a `cerrado`. La configuración puede definir el TEXTO del mensaje de cierre y si va sticker — nunca el momento.

---

## 15. Inicio del día

Independiente por completo del ciclo de Event Session — no crea, no toca, no lee `eventos_bot`. Su única clave de idempotencia es `grupo_id:DAILY_START_MESSAGE:<fecha>` (§8). Se evalúa en cada tick del Scheduler contra `automation_configs.mensaje_inicio_dia` (activo/inactivo, texto, día/hora por día de la semana — mismo modelo de "horario por día" que el resto de la automatización, §16).

---

## 16. Persistencia

Todo el estado que importa vive en Supabase:

- `event_sessions` — estado del ciclo operativo.
- `automation_actions` — qué se ejecutó y cuándo (idempotencia + auditoría).
- `automation_configs` — reglas por usuario/grupo (días, horarios, mensajes, umbrales).

Nada del Automation Engine depende de una variable en memoria que no pueda reconstruirse leyendo estas tablas. Los únicos objetos en memoria son los `setInterval` del Scheduler (igual que `iniciarWorkerEventos` hoy) — su ESTADO (qué falta enviar) siempre se recalcula desde Supabase en cada tick, nunca se guarda solo en RAM.

---

## 17. Recuperación después de reinicio

Idéntico patrón al que ya usa `server.js`/`bot/index.js` para las sesiones de WhatsApp:

1. Al reconectar una sesión (`activeChanged`, sin cambios), se arranca el Scheduler de esa sesión (igual que hoy se arranca `iniciarWorkerEventos`).
2. El primer tick del Scheduler relee `event_sessions` en `abierto`/`pendiente` de esa sesión directamente de Supabase — no necesita que nadie se lo notifique, no depende de haber estado corriendo antes del reinicio.
3. Cualquier acción que quedó pendiente de ejecutar (p. ej. un recordatorio cuya hora ya pasó mientras el proceso estaba caído) se evalúa y ejecuta en ese primer tick — con `ExecutionGuard` protegiendo contra que, si SÍ se había alcanzado a ejecutar justo antes de caer, se repita.
4. Un evento cuyo `event_sessions` quedó en `pendiente` (nunca llegó a `abierto`) simplemente se re-evalúa contra `EventRules` en el próximo tick — comportamiento correcto sin lógica especial de "recuperación".

---

## 18. Permisos

Nuevo, fuera de las tablas de sorteos (que quedan fuera de alcance en esta fase, §20), pero necesario para `EventRules` paso 1:

```
usuario (auth.users)
    ↓
grupos_autorizados (usuario_id, grupo_id → FK grupos, activo)
    ↓
automation_configs (usuario_id, grupo_id, ...)
```

Un `grupo_id` sin fila en `grupos_autorizados` para el `usuario_id` dueño de la sesión → `EventRules` rechaza el paso 1 y el Automation Engine no crea Event Session ni ejecuta ninguna acción (el bot sigue detectando/reservando igual, sin cambios — la automatización simplemente no se activa sobre ese grupo).

---

## 19. Matriz de decisiones

| Caso | Automation Engine hace |
|---|---|
| No existe evento (`detectarEvento` devolvió `null`) | Nada — no se llama `onEventoDetectado`. |
| Evento detectado, primera vez (identidad_ciclo nueva) | Evalúa `EventRules`; si pasa, crea Event Session `pendiente`→`abierto`, ejecuta `OPEN_MESSAGE`/`OPEN_STICKER`. |
| Evento duplicado (misma `identidad_ciclo`, ya existe Event Session) | No-op. Idempotente por diseño (§8), no reintenta ni reenvía. |
| Evento fuera de horario permitido | `EventRules` rechaza. No se crea Event Session. Se registra el intento (log/`automation_actions` con `resultado='rechazado'`, opcional) para auditoría. El bot sigue funcionando con el evento igual (reservas, consultas). |
| Evento dentro de horario permitido | Continúa la validación (grupo autorizado → duplicado → ...). |
| Grupo no autorizado | `EventRules` rechaza en el paso 1, sin evaluar el resto. |
| Grupo ya abierto (para este mismo ciclo) | Detectado por `event_sessions.estado='abierto'` con la misma `identidad_ciclo` → no-op. |
| Grupo cerrado (evento ya cerrado, llega un mensaje nuevo distinto) | Nueva `identidad_ciclo` → se evalúa como evento nuevo desde cero. |
| Sesión de WhatsApp desconectada | El Scheduler de esa sesión está detenido (mismo ciclo de vida que `iniciarWorkerEventos`/`detenerBot`) — no se ejecuta nada hasta que la sesión reconecte; al reconectar, recuperación según §17. |
| Backend reiniciado | Ver §17 — recuperación completa desde Supabase, sin reenvíos gracias a `ExecutionGuard`. |
| Recordatorio ya enviado | `ExecutionGuard` encuentra la clave en `automation_actions` → no se reenvía. |
| Nueva reserva (una) | `UpdateRules` cuenta, compara contra umbral — si no lo alcanza, no hace nada. |
| Muchas reservas en poco tiempo (ráfaga) | Se evalúa contra umbral + cooldown una sola vez por ventana — nunca dispara una actualización por cada reserva individual (§11). |
| Actualización manual (`"actualizar"`) | Se valida autorización (mismo `usuario`/grupo del Event Session activo), clave `UPDATE_MANUAL:<message_id>`, actúa siempre sobre el Event Session abierto — nunca cambia de evento. |
| Evento llegando al cierre (algún offset de recordatorio vencido) | `ReminderRules` dispara el/los recordatorios vencidos que no estén ya en `automation_actions`. |
| Evento cerrado (`eventos_bot.activo` pasó a `false`) | Scheduler transiciona el Event Session a `cerrando`→`cerrado`, ejecuta `CLOSE_MESSAGE`/`CLOSE_STICKER`. |
| Evento finalizado (Event Session ya en `cerrado`) | No-op para cualquier acción futura relacionada a esa `identidad_ciclo`. |

---

## 20. Fuera de alcance en esta fase (confirmado, no se toca ni se diseña en detalle todavía)

- Rediseño de tablas de reservas (`reservas_dos_cifras`, `5k_15k_reservas_2_cifras`) y su modelo por-usuario.
- Botón Compartir, generación de imagen, generación de texto de tabla.
- Pagos (Android, `backend/pagos/*`).
- IA de detección (no se agrega IA al detector bajo ninguna circunstancia).
- QR / reconexión de sesiones (ya resuelto en una fase anterior, no se reabre).
- La acción real detrás de "actualización por movimiento"/"actualización manual" (reenviar la tabla) queda bloqueada hasta que exista Compartir — en esta fase solo se deja preparado el enganche de reglas/idempotencia/autorización, documentado en §11.

---

## 21. Resumen de qué se reutiliza vs qué es nuevo

| Reutilizado tal cual (cero cambios) | Nuevo |
|---|---|
| `detectarEvento`, `extraerEvento`, extractores, regex | `automation/engine.js` |
| `guardarEvento`, `consultarEvento` | `automation/eventRules.js` |
| `abrirGrupo`, `cerrarEvento`/`cerrarGrupo`, `groupQueue` | `automation/scheduler.js` |
| `evaluarEvento`, `verificarHoraCierre`, `verificarTodosPagados`, `workerEventos` | `automation/updateRules.js` |
| `services/baileys/send.js` (`sendMessage`) | `automation/executionGuard.js` |
| Sesiones WhatsApp / `manager.js` / reconexión | `automation/actions/enviarSticker.js` (envío de stickers — no existía) |
| `reservas_actividad` (para contar movimiento) | Tablas: `event_sessions`, `automation_actions`, `automation_configs`, `grupos_autorizados` |
| `detectarIntencion` (para reconocer "actualizar") | Un (1) hook de una línea propuesto en `eventHandler.js` (§4) y otro en `bot/index.js` (§9) — a implementar en Fase 2, no en esta fase |
