# EFAAT — Automation Engine — Fase 2B: cimientos persistentes

Estado: **infraestructura aislada, completamente inerte respecto al bot real.** Ningún archivo existente fue modificado. Nada de esto está conectado al flujo real de WhatsApp.

Complementa `EFAAT_AUTOMATION_MASTER_SPEC.md`, `EFAAT_AUTOMATION_ROADMAP.md` y `EFAAT_AUTOMATION_PHASE_2A_FINDINGS.md` — no los reemplaza.

---

## 0. Corrección aplicada tras la auditoría técnica

La auditoría técnica de Fase 2B encontró un gap real (sección "E. ENGINE" de esa auditoría): `eventSessionsRepo.crear()` no distinguía una colisión `23505` de la `UNIQUE(grupo_id, identidad_ciclo)` de cualquier otro error de Supabase — una carrera real entre dos ejecuciones concurrentes de `engine.onEventoDetectado()` para el mismo ciclo terminaba en una excepción genérica no controlada en vez de un resultado ordenado.

**Corregido, quirúrgicamente, sin tocar el esquema ni `ExecutionGuard`:**

- `backend/automation/repo/eventSessions.js` — `crear()` ahora captura el `23505` de esa UNIQUE específica (reutilizando `esViolacionUnicidad()` ya exportada por `executionGuard.js`, sin duplicarla, y distinguiendo la constraint por el texto real que produce Postgres) y lanza un `CicloDuplicadoError` tipado (`err.esCicloDuplicado === true`) en vez de dejar pasar el error crudo de Supabase. Cualquier otro error (23505 de otra constraint, o cualquier otro código) se sigue relanzando tal cual, sin ocultarlo.
- `backend/automation/engine.js` — un `try/catch` mínimo alrededor de la única llamada a `crear()`, que traduce `CicloDuplicadoError` al **mismo contrato que ya devolvía `evaluarApertura()`** para un duplicado detectado por el chequeo previo: `{ creoEventSession: false, motivo: "ciclo_duplicado", identidadCiclo }`. No se inventó ninguna API nueva.
- `backend/tests/automation/fakeSupabaseAutomation.js` — el error simulado de unicidad para `event_sessions` ahora reproduce el formato real de Postgres (nombre de constraint autogenerado `event_sessions_grupo_id_identidad_ciclo_key` + `details`), y se agregó un hook `_forzarErrorInsert()` (consumido una sola vez) para poder simular un error de Supabase **distinto** de esa unicidad en un test puntual.
- `backend/tests/automation/eventSessions.test.js` — 4 tests nuevos (22-25, detalle en sección 7).

`006_automation_engine.sql` y `executionGuard.js` **no se tocaron** — la protección primaria contra la concurrencia sigue siendo, sin cambios, el `UNIQUE(grupo_id, identidad_ciclo)` real de Postgres.

---

## 1. Archivos creados

```
backend/
├── automation/
│   ├── engine.js                 (orquestador — NO conectado a eventHandler.js)
│   ├── eventRules.js             (funciones puras: identidad + evaluarApertura)
│   ├── executionGuard.js         (idempotencia real, 2 fases)
│   └── repo/
│       ├── eventSessions.js      (persistencia de event_sessions)
│       └── automationConfig.js   (lectura de automation_configs + grupos_autorizados)
│
├── supabase_migrations/
│   └── 006_automation_engine.sql (4 tablas nuevas, sin ejecutar todavía en Supabase)
│
└── tests/automation/
    ├── fakeSupabaseAutomation.js (fake genérico, 4 tablas, réplica de las 2 UNIQUE reales;
    │                              +error realista de event_sessions y hook _forzarErrorInsert)
    ├── entornoFake.js            (inyección por require.cache, mismo patrón que tests/sesiones/)
    ├── identidadCiclo.test.js    (casos 1-3)
    ├── eventRules.test.js        (casos 11-17)
    ├── executionGuard.test.js    (casos 4-10 + 1 extra)
    └── eventSessions.test.js     (casos 18-21 + 1 extra + 22-25, corrección de concurrencia)

docs/
├── EFAAT_AUTOMATION_ROADMAP.md               (editado: Fase 2 marcada 🟨 en curso)
└── EFAAT_AUTOMATION_PHASE_2B_IMPLEMENTATION.md (este archivo)
```

Ningún archivo existente fue editado. `git status --short` (sección 9) lo confirma: todo aparece como `??` (nuevo/no rastreado), nada como `M`.

---

## 2. Tablas creadas (en `006_automation_engine.sql`, sin ejecutar aún)

`automation_configs` → `grupos_autorizados` → `event_sessions` → `automation_actions` (ese orden exacto, porque `event_sessions` referencia `automation_configs`, y `automation_actions` referencia `event_sessions`). Detalle de columnas en el propio SQL, con comentario por decisión.

---

## 3. Decisiones SQL — resumen

1. **Ninguna FK hacia una tabla sin migración en este repo.** `event_sessions.evento_id` (→ `eventos_bot.id`) y `*.grupo_id` (→ `grupos`/JID) se declaran sin `references`, con el tipo más razonable (`uuid` y `text` respectivamente) documentado como asunción, no como hecho confirmado. Regla aplicada tal como pedía la consigna §15/§1.4.
2. **`session_id` SÍ tiene FK a `sesiones(id)`** — no es una suposición nueva, la migración 004 (`sesiones_lease`) ya la usa en producción.
3. **`usuario_id` SÍ tiene FK a `auth.users(id)`** en las 4 tablas — es el esquema propio de Supabase Auth (no una tabla del proyecto sin migrar), mismo patrón que 001/002/005.
4. **`automation_actions.usuario_id` se agregó** aunque no estaba en la lista mínima del Master Spec §8 — sin ella no había forma de escribir la policy RLS `auth.uid()=usuario_id` que usa el resto del proyecto. Documentado en el propio SQL.
5. **`grupos_autorizados` no tiene FK hacia `automation_configs`** — se cruzan por `(usuario_id, grupo_id)` en código, decisión simple documentada en el SQL para no acoplar ambas tablas innecesariamente.
6. **Constraints `check` para `estado`** (en vez de tablas de catálogo aparte) en `event_sessions` y `automation_actions` — consistente con el estilo del resto del proyecto (`pagos_movimientos.estado`, `reservas_actividad.tipo`, ambas con `check` textual).
7. **`tipo_accion` es texto libre, sin `check`** — a propósito, para no tener que migrar el esquema cada vez que se agregue un tipo de acción nuevo (recordatorios, stickers, etc. en fases futuras).
8. Todas las columnas jsonb de `automation_configs` (`dias_permitidos`, mensajes, `stickers`, `recordatorios`) se dejan **deliberadamente sin forma fija en SQL** — la validación de forma es responsabilidad del código (`eventRules.js` y las fases futuras que las consuman), para poder crecer sin migrar.

---

## 4. Identidad de ciclo

`automation/eventRules.js:crearIdentidadCiclo(evento)` — sha256 hex de `grupo_id|nombre_evento|hora_fin|valor|fecha_evento`, exactamente los 5 campos confirmados en Fase 2A, en ese orden, sin tocar Supabase ni generar nada aleatorio.

Verificada con 8 pruebas (`identidadCiclo.test.js`), incluyendo el caso central de Fase 2A: **`evento.id` (fila de `eventos_bot`, reutilizable entre sorteos) no participa en el hash** — cambiarlo solo no cambia la identidad; cambiar `fecha_evento` manteniendo el mismo `evento.id` sí la cambia.

---

## 5. ExecutionGuard — estrategia de crash

Implementado el diseño de dos fases corregido en Fase 2A (`PHASE_2A_FINDINGS.md §10`):

```
INSERT automation_actions (estado='en_progreso')   ← protegido por UNIQUE(clave_idempotencia)
    ↓ (si el INSERT choca con la UNIQUE: ya existe, en cualquier estado -> no se ejecuta)
ejecutar() — el callback real, provisto por el llamador
    ↓
UPDATE estado='ok' (éxito) | estado='error' (excepción capturada)
```

**Si el proceso muere entre el INSERT y el UPDATE**, la fila queda `en_progreso` para siempre — `obtenerAccionesEstancadas({minutosAntiguedad})` la LISTA (consulta `estado='en_progreso' AND ejecutado_en < ahora - N minutos`), pero **no la toca**. Ninguna función de esta fase reintenta automáticamente — es la política segura por defecto que pedía la consigna §5. Verificado explícitamente en el test 9 (`executionGuard.test.js`): una fila `en_progreso` sembrada manualmente (simulando el crash) impide una segunda ejecución del callback.

La protección primaria es siempre el `UNIQUE(clave_idempotencia)` de Postgres — `ejecutarUnaVez()` nunca hace "select → comprobar → insert"; hace `insert` directo y reacciona al código `23505` si choca. Confirmado por el test 6 (dos llamadas concurrentes vía `Promise.all`, solo una ejecuta el callback).

---

## 6. Repositorios

`repo/eventSessions.js`: `buscarPorIdentidadCiclo`, `crear`, `obtenerActivaPorGrupo`, `marcarAbierto`, `marcarCerrando`, `marcarCerrado`, `marcarExpirado`, `actualizar`, `obtenerPendientes`, `obtenerAbiertas` — todas persistencia pura, cero reglas de negocio.

`repo/automationConfig.js`: `obtenerConfiguracion(usuarioId, grupoId)`, `estaGrupoAutorizado(usuarioId, grupoId)` — únicamente lectura, tal como pedía la consigna §8 ("por ahora SOLO lectura"). El soporte de `grupos_autorizados` vive en este mismo archivo (no se creó un tercer archivo de repositorio, respetando el árbol de archivos exacto que dio la consigna) — documentado en la cabecera del propio módulo.

`engine.js`: `onEventoDetectado(evento, opciones)` — calcula identidad, resuelve autorización/config/duplicado, llama a `eventRules.evaluarApertura`, y si es válido **crea el `event_session` y nada más**. No ejecuta ninguna acción de WhatsApp (eso es Fase 4+). Confirmado por el test "extra" de `eventSessions.test.js`, que lee el código fuente de los 5 archivos de `automation/` y verifica por texto que ninguno menciona `baileys`, `sendMessage`, `groupSettingUpdate` ni requiere nada de `bot/`.

---

## 7. Tests — resultados

Los 21 casos numerados en la consigna original, más extras, más los 4 casos de la corrección de concurrencia (22-25, sección 0), los 4 archivos ejecutados individualmente (no hay `npm test` configurado en `backend/package.json` — sigue siendo el stub `"Error: no test specified"`, igual que antes de esta fase; se ejecuta cada archivo con `node`, mismo procedimiento que el resto de `backend/tests/`):

```
node backend/tests/automation/identidadCiclo.test.js     -> TOTAL: 8   PASA: 8   FALLA: 0
node backend/tests/automation/eventRules.test.js         -> TOTAL: 11  PASA: 11  FALLA: 0
node backend/tests/automation/executionGuard.test.js     -> TOTAL: 8   PASA: 8   FALLA: 0
node backend/tests/automation/eventSessions.test.js      -> TOTAL: 9   PASA: 9   FALLA: 0
```

**36/36 en verde** (los 4 nuevos son los casos 22-25 de la corrección — sección 0). Además, se re-ejecutó toda la suite preexistente del proyecto para confirmar que nada se rompió:

```
tests/sesiones/socketLockReconexion.test.js   -> 14/14
tests/sesiones/leaseDistribuido.test.js       -> 15/15
tests/pagos/pagosP1.test.js                   -> 14/14
tests/identidad/identidad.test.js             -> 21/21
tests/identidad/escanerIdentidades.test.js    -> 16/16
tests/identidad/escanerIdentidadesLifecycle.test.js -> 9/9
```

**89/89 preexistentes siguen en verde.** Ningún test real de Supabase, WhatsApp o Baileys — todo con fakes por `require.cache`, mismo patrón que `backend/tests/sesiones/`.

---

## 8. Decisiones de RLS

Confirmado imposible verificar desde el repo el estado real de RLS en `eventos_bot`, `sesiones`, `grupos`, `usuarios`, `reservas_dos_cifras`, `5k_15k_reservas_2_cifras` (Fase 2A §4.14, sigue igual). Las 4 tablas NUEVAS de esta fase sí tienen RLS completo y verificable en el propio `006_automation_engine.sql` (`auth.uid() = usuario_id`), porque `usuario_id` en las 4 es una columna propia con FK directa a `auth.users` — no depende de ninguna suposición sobre las tablas núcleo.

**No se ejecutó la migración en Supabase todavía** (ni se podía: esta fase es solo código+tests locales). Antes de ejecutarla en producción: verificar directamente en el dashboard de Supabase el estado de RLS de las tablas núcleo, tal como quedó pendiente desde Fase 0/2A.

---

## 9. `git status` / `git diff --check`

```
$ git status --short
?? backend/automation/
?? backend/supabase_migrations/006_automation_engine.sql
?? backend/tests/automation/
?? docs/

$ git diff --check
(sin salida)
```

Todo aparece como `??` (nuevo, sin rastrear) — **cero archivos existentes con `M`**. Confirmado explícitamente con `grep -rl "automation" bot/ server.js index.js` → sin resultados: nada dentro de `bot/`, `server.js` ni `index.js` menciona ni requiere el nuevo código.

---

## 10. Confirmación explícita (criterio §17 de la consigna)

- `detectarEvento()` — sin cambios (no se editó `bot/funciones/eventos/detectarEvento.js`).
- `extraerEvento()` — sin cambios.
- `guardarEvento()` — sin cambios.
- `consultarEvento()` — sin cambios.
- `abrirGrupo()` / `cerrarGrupo()` — sin cambios.
- `workerEventos()` / `evaluarEvento()` / `verificarHoraCierre()` / `verificarTodosPagados()` / `procesarEvento()` — sin cambios.
- `reservarNumeros()` — sin cambios.
- `dispatcher` / middleware — sin cambios.
- `eventHandler.js` — sin cambios (no se agregó todavía la línea de enganche propuesta en el Master Spec §4; queda para Fase 3, con aprobación explícita).
- `bot/index.js` — sin cambios (no se agregó todavía el arranque del Scheduler; tampoco existe Scheduler en esta fase, ver §12).
- Sistema de sesiones/reconexión de WhatsApp — sin cambios.
- Ningún mensaje fue enviado a ningún grupo real (no existe código de envío en `automation/` — verificado por test automatizado, §6).
- Ningún grupo fue abierto ni cerrado por este código (no existe ninguna llamada a `groupSettingUpdate`/`abrirGrupo`/`cerrarGrupo` en `automation/` — verificado por test automatizado, §6).
- No se instaló ninguna dependencia nueva (`automation/` solo usa `crypto`, nativo de Node, y el mismo `../lib/supabase` que ya usa todo el backend).

---

## 11. Qué quedó pendiente (explícito, no se resolvió en esta fase)

1. **Ejecutar `006_automation_engine.sql` en el dashboard de Supabase** — no se hizo, requiere aprobación aparte antes de aplicarla a la base real.
2. **Verificar RLS real de las tablas núcleo** — sigue pendiente desde Fase 0.
3. **Scheduler** — explícitamente NO construido en esta fase (consigna §13). Sin `setInterval`, sin conexión a `bot/index.js`.
4. **Acciones de WhatsApp** (`abrirEvento.js`, `cerrarEvento.js`, `enviarSticker.js`) — explícitamente NO construidas (consigna §14). La infraestructura de reglas/persistencia ya está preparada para que, cuando se construyan, pasen por `ExecutionGuard.ejecutarUnaVez()` sin cambios.
5. **Conexión real** — `eventHandler.js` y `bot/index.js` siguen sin la línea de enganche del Master Spec §4/§9. Es trabajo de Fase 3, con su propia aprobación.
6. **La política de reintento configurable para acciones de bajo riesgo** (PHASE_2A_FINDINGS §10, "política de reintento acotado") no se implementó — solo la política segura (nunca reintentar) tiene código real (`obtenerAccionesEstancadas` solo lista).

---

## 12. No se marca Fase 2 como cerrada

Tal como pedía la consigna: **Fase 2 queda en 🟨 en curso** en `EFAAT_AUTOMATION_ROADMAP.md` — no se marca ✅ hasta aprobación explícita del usuario sobre este documento, y hasta que se resuelva (o se decida conscientemente posponer) la verificación de RLS de §8/§11.2.

**No se avanzó a Fase 3.** No se conectó `eventHandler.js`. No se conectó `bot/index.js`. No se hizo automatización real.
