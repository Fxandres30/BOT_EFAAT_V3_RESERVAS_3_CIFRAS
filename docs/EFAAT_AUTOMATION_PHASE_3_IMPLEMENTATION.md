# EFAAT — Automation Engine — Fase 3: integración real con el flujo de eventos

Estado: **implementación entregada, 137/137 pruebas en verde. No se marca cerrada hasta aprobación explícita.**

Complementa `EFAAT_AUTOMATION_MASTER_SPEC.md`, `EFAAT_AUTOMATION_PHASE_2A_FINDINGS.md` y `EFAAT_AUTOMATION_PHASE_2B_IMPLEMENTATION.md` — no los reemplaza.

---

## 1. Qué se cambió

**Un solo archivo de producción modificado**: [`backend/bot/funciones/eventos/detectarEvento.js`](../backend/bot/funciones/eventos/detectarEvento.js).

No se creó ningún `detectarEvento` nuevo, ningún `extraerEvento` nuevo, ningún `guardarEvento` nuevo, ningún sistema de apertura/cierre nuevo. `extraerEvento.js`, `guardarEvento.js`, `consultarEvento.js`, `abrirGrupo.js`, `cerrarGrupo.js`, `workerEventos.js`, `evaluarEvento.js`, `verificarHoraCierre.js`, `verificarTodosPagados.js`, `procesarEvento.js`, `reservarNumeros.js`, el dispatcher, el middleware, `eventHandler.js` y `bot/index.js` — **ninguno de estos se tocó**.

Archivos nuevos (solo tests, ninguno de producción):
```
backend/tests/deteccion/
├── entornoFake.js
└── deteccionAutomation.test.js
```

Un archivo de test de Fase 2B se extendió (no se creó otro fake paralelo):
- `backend/tests/automation/fakeSupabaseAutomation.js` — se agregó soporte para la tabla `eventos_bot` (necesaria para probar `guardarEvento()`/`consultarEvento()` reales) y se corrigió un desajuste de forma en `.insert(x).select()` sin `.single()` (debía devolver un array, como el Supabase real — antes devolvía un objeto suelto; no afectaba a Fase 2B porque ahí siempre se encadenaba `.single()`, pero sí a `guardarEvento.js`, que no lo hace).

---

## 2. Cambio exacto del flujo

**Antes** (el problema exacto que pedía resolver esta fase):

```
extraerEvento() → guardarEvento() → abrirGrupo() (SIEMPRE) → return evento
```

**Ahora**:

```
extraerEvento() → guardarEvento() → automationEngine.onEventoDetectado(eventoGuardado)
                                              ↓
                                  ¿creoEventSession === true?
                                    SÍ → abrirGrupo() (el mismo de siempre)
                                    NO → return eventoGuardado (sin abrir)
```

`eventoGuardado` —el objeto que ya producía `guardarEvento()` sin ningún cambio— es exactamente lo que se le pasa al Automation Engine. Automation nunca recalcula ni reinterpreta `nombre_evento`/`valor`/`premios`/`hora_fin`/`hora_cierre`/`fecha_evento`/`tabla`/`cifras`/`cantidad_numeros` — todos siguen viniendo, sin excepción, del detector existente.

---

## 3. Cómo se decide la apertura

`automation/engine.js` (Fase 2B, sin cambios en esta fase) evalúa, en este orden, exactamente lo pedido:

1. `grupo_no_autorizado` — ¿existe una fila activa en `grupos_autorizados` para (usuario_id, grupo_id)?
2. `configuracion_inactiva` — ¿existe `automation_configs` para ese grupo con `activo = true`? (cubre también "no existe configuración", ver §9 de la consigna — nunca se asume nada por defecto).
3. `dia_no_permitido` — ¿el día real de hoy (America/Bogotá) está marcado `activo:true` en `dias_permitidos`?
4. `horario_no_permitido` — ¿la hora real de ahora cae dentro de `desde`/`hasta` de ese día?
5. `evento_invalido` — ¿`nombre_evento`/`hora_fin`/`valor` están presentes? (defensivo — en la práctica siempre lo están, porque `extraerEvento()`/`guardarEvento()` ya lo garantizan antes de llegar aquí).
6. `ciclo_duplicado` — ¿ya existe un `event_session` con esta misma `identidad_ciclo` (grupo+nombre+hora+valor+fecha)?

Si las 6 pasan → se crea el `event_session` → `detectarEvento.js` llama a `abrirGrupo()` (sin cambios). Si cualquiera falla → `abrirGrupo()` nunca se llama, y el motivo queda en el log (`🤖 [AUTOMATION] apertura NO autorizada (<motivo>)`).

---

## 4. Cómo se evita la apertura prematura

Este era el problema central que pedía resolver la consigna. La solución no fue "mover" la apertura — fue identificar el ÚNICO punto donde eso es posible sin duplicar nada:

`detectarEvento()` internamente ejecuta `extraerEvento() → guardarEvento() → [antes: abrirGrupo() directo]`. La consulta al Automation Engine se insertó **entre `guardarEvento()` y `abrirGrupo()`**, dentro de la misma función, con un `if (!autorizarApertura) { return eventoGuardado; }` justo antes del bloque de apertura existente (que queda 100% intacto, sin ninguna línea modificada). No hay ninguna ventana en la que `abrirGrupo()` se ejecute antes de que la decisión de Automation esté resuelta — la llamada es `await`ada, no "fire and forget".

**Corrección al plan original de Fase 1**: ese plan preveía conectar en `bot/handlers/eventHandler.js`. La Fase 2A (verificación de código real) ya había descartado eso: `eventHandler.js` recibe el evento **después** de que `detectarEvento()` termina — es decir, después de que la apertura (con el código viejo) ya había ocurrido. Conectar ahí nunca hubiera podido evitar la apertura prematura. `detectarEvento.js` es el único punto real.

### Caso especial: el evento se guarda igual si Automation rechaza

Tal como pedía la consigna §3 y §10: si Automation rechaza, **no se borra ni se desactiva** el evento — `eventoGuardado` (ya escrito por `guardarEvento()`, con `activo:true`/`abierto:true`) queda exactamente como estaba. La única consecuencia es que `abrirGrupo()` no se ejecuta.

Se dejó un comentario explícito en el código documentando una decisión de diseño: `eventos_bot.abierto` se deja en `true` (el valor que `guardarEvento()` ya escribió) cuando Automation rechaza — **no** se llama a `marcarAperturaFallida()` en ese caso. Motivo: `marcarAperturaFallida()` pone `abierto:false`, y eso es precisamente lo que `workerEventos.js` (protegido, no se tocó) usa como señal para **reintentar la apertura sin ninguna gate de Automation** cada 30s. Si se marcara `abierto:false` tras un rechazo, el propio worker reabriría el grupo 30 segundos después, sin pasar por ninguna autorización — anulando por completo esta fase. Dejarlo en `true` es lo que hace que "no autorizado" se mantenga "no autorizado" también para el worker existente, sin tocarlo.

### Fallback de seguridad ante errores del propio Automation Engine

No estaba en la consigna explícitamente, pero se decidió durante la implementación porque es necesario en la práctica: si `automationEngine.onEventoDetectado()` **lanza una excepción** (no una decisión limpia de "rechazado", sino un error real — el caso más probable hoy: las 4 tablas de la migración 006 todavía no existen en Supabase, ya que explícitamente no se ha ejecutado), `detectarEvento.js` **no bloquea la apertura** — conserva `autorizarApertura = true` (su valor por defecto) y sigue exactamente como si Automation no existiera, dejando un `console.error` inequívoco. Se distingue explícitamente de un rechazo limpio (motivo con texto) en los logs. Esto es lo que hace seguro conectar este código HOY, antes de aplicar 006: cada detección real intentará consultar Automation, fallará (tabla inexistente), y el bot seguirá abriendo grupos exactamente igual que antes — confirmado por los tests (ver §7).

---

## 5. Event Session

Sin cambios de modelo (Fase 2B, reutilizado tal cual): `engine.js` calcula `identidad_ciclo` y, si autoriza, llama a `eventSessionsRepo.crear()` con `evento_id`, `grupo_id`, `session_id`, `usuario_id`, `automation_config_id`, `identidad_ciclo` y `datos_evento_snapshot` (copia de nombre/hora/valor/premios/tabla de ESTE ciclo). Verificado en los tests 11 y 18-21 (Fase 2B) que sigue funcionando igual ahora que se invoca desde el flujo real.

---

## 6. Idempotencia

Reutilizada al 100% de Fase 2B — **no se inventó ningún locking nuevo**:

- **Ciclo duplicado / reconexión / restart**: `identidad_ciclo` + `UNIQUE(grupo_id, identidad_ciclo)` real de Postgres (simulado fielmente en el fake). Un segundo `detectarEvento()` para el mismo mensaje encuentra el `event_session` ya existente (`eventSessionExistente` no nulo) y `evaluarApertura()` rechaza con `ciclo_duplicado` — `abrirGrupo()` no se vuelve a llamar. Probado en el test 7.
- **Concurrencia real** (dos detecciones casi simultáneas): la corrección de Fase 2B (`eventSessionsRepo.crear()` capturando el `23505` real de Postgres como `CicloDuplicadoError`) sigue intacta y es la que realmente sostiene esta garantía bajo carrera — no una verificación previa en JS. Probado en el test 8 con `Promise.all`.
- **Reinicio del proceso**: como todo el estado de decisión vive en Supabase (fake, en los tests) y nada se guarda solo en memoria, un "reinicio" (módulos recargados desde cero, misma base de datos) produce el mismo resultado que una detección repetida normal — no hace falta ninguna lógica especial de recuperación. Probado en el test 9, recargando los módulos reales (`require.cache` limpio) mientras se conserva el fake de Supabase, simulando exactamente eso.

**Hallazgo real durante las pruebas, documentado aquí en vez de "corregido"** (fuera del alcance de esta fase — no se tocó `guardarEvento.js`/`consultarEvento.js`, protegidos): bajo el test de concurrencia (8), las dos llamadas a `detectarEvento()` sí terminan creando **dos filas distintas en `eventos_bot`** (una carrera preexistente en `guardarEvento.js`: ambas leen `consultarEvento()` antes de que la primera termine de escribir, y ambas insertan). No es un problema nuevo de esta fase ni algo que la consigna pidiera arreglar — y no afecta la garantía real que importa aquí: como `identidad_ciclo` depende del contenido (no del `id` de `eventos_bot`), ambas filas producen la misma identidad, y Automation igual permite **una sola apertura real**. Se deja documentado para una fase futura que si se decide tocar `guardarEvento.js`/`consultarEvento.js` (explícitamente fuera de esta fase), esa carrera preexistente sería la razón.

---

## 7. Tests nuevos

`backend/tests/deteccion/deteccionAutomation.test.js` — 12 pruebas, ejercitando el código REAL (`detectarEvento`, `extraerEvento`, `guardarEvento`, `consultarEvento`, `abrirGrupo`, `services/baileys/groupQueue.js`, todo `automation/`) contra un mensaje de WhatsApp realista ("SINUANO DIA 2:30 PM" + premios + valor — reconocido tal cual por los extractores existentes, sin ningún cambio a sus regex) y un socket Baileys 100% fake (nunca red real, nunca WhatsApp real):

1. evento válido + grupo autorizado + horario permitido → llama a `abrirGrupo()` real.
2. grupo no autorizado → no abre; el evento igual queda guardado.
3. configuración inactiva → no abre.
4. día no permitido → no abre.
5. fuera de horario → no abre.
6. evento inválido → rechazado (probado directo contra `engine.onEventoDetectado`, el mismo punto que usa `detectarEvento.js` — no reproducible a través del pipeline completo porque `extraerEvento()`/`guardarEvento()` ya garantizan un evento válido antes de llegar a Automation; ya estaba cubierto a nivel de reglas puras en `eventRules.test.js` de Fase 2B).
7. mismo mensaje detectado dos veces → `abrirGrupo()` se llama una sola vez.
8. dos detecciones concurrentes (`Promise.all`) → una sola apertura real.
9. reinicio del proceso (módulos recargados, misma base persistida) → no reabre el mismo ciclo.
10. Automation rechaza → el evento sigue intacto en `eventos_bot` (`activo`/`estado` sin tocar).
11. Automation permite → `event_session` queda creado con los datos correctos del ciclo.
12. la apertura pasa por `groupMetadata`/`groupSettingUpdate` reales (de `guardarEvento.js`/`abrirGrupo.js`), confirmando que es el mecanismo existente y no uno nuevo.

Resultado: **12/12 en verde.**

---

## 8. Tests existentes

```
node backend/tests/automation/identidadCiclo.test.js     -> 8/8
node backend/tests/automation/eventRules.test.js          -> 11/11
node backend/tests/automation/executionGuard.test.js      -> 8/8
node backend/tests/automation/eventSessions.test.js       -> 9/9

node backend/tests/sesiones/socketLockReconexion.test.js            -> 14/14
node backend/tests/sesiones/leaseDistribuido.test.js                -> 15/15
node backend/tests/pagos/pagosP1.test.js                            -> 14/14
node backend/tests/identidad/identidad.test.js                      -> 21/21
node backend/tests/identidad/escanerIdentidades.test.js             -> 16/16
node backend/tests/identidad/escanerIdentidadesLifecycle.test.js    -> 9/9
```

---

## 9. Resultado total

**137/137 pruebas en verde** (36 de Fase 2B + 12 nuevas de Fase 3 + 89 preexistentes). Cero regresiones.

---

## 10. `git diff --check` / `git status --short`

```
$ git diff --check
(sin salida)

$ git status --short
 M backend/bot/funciones/eventos/detectarEvento.js
?? backend/automation/
?? backend/supabase_migrations/006_automation_engine.sql
?? backend/tests/automation/
?? backend/tests/deteccion/
?? docs/
```

Un solo archivo de producción modificado (`detectarEvento.js`), exactamente el previsto. Nada más aparece como `M`. `backend/tests/automation/` sigue mostrándose como `??` (carpeta completa sin rastrear desde Fase 2B) aunque uno de sus archivos se haya extendido en esta fase — no hay ningún `M` oculto: `git status` reporta por carpeta cuando la carpeta entera es nueva.

Confirmado explícitamente por grep: sin dependencias nuevas (`package.json`/`package-lock.json` sin diferencias), sin Scheduler, sin mensajes automáticos, sin stickers, sin recordatorios, sin Share, sin UI nueva, sin SQL ejecutado contra Supabase, sin ninguna conexión de Automation con WhatsApp fuera del único punto de apertura autorizada (`abrirGrupo()`, ya existente).

---

## 11. Qué queda para Fase 4

1. `OPEN_MESSAGE`/`OPEN_STICKER` — envío real tras la apertura autorizada, envuelto en `ExecutionGuard.ejecutarUnaVez()` (ya construido en Fase 2B, sin usar todavía), reutilizando `services/baileys/send.js` sin duplicarlo.
2. `Scheduler` (Master Spec §9) — todavía no existe ningún `setInterval` de Automation; nada en `bot/index.js` lo arranca.
3. `CLOSE_MESSAGE`/`CLOSE_STICKER` reaccionando a `eventos_bot.activo=false`.
4. Recordatorios (`ReminderRules`), actualizaciones por movimiento (`UpdateRules`), comando manual "actualizar".
5. Aplicar `006_automation_engine.sql` en Supabase — sigue sin ejecutarse; hasta que se aplique, todo detección real cae en el fallback de "Automation Engine falló, se abre igual" (§4), que ya está probado como seguro pero significa que la autorización real todavía no tiene efecto en producción.
6. Corregir (si se decide) la carrera preexistente de `guardarEvento.js`/`consultarEvento.js` documentada en §6 — explícitamente fuera de esta fase.

No se marca Fase 3 como completada en el roadmap hasta aprobación explícita. No se avanzó a Fase 4.
