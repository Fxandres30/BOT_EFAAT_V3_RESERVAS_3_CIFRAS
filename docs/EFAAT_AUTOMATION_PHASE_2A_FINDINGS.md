# EFAAT — Automation Engine — Fase 2A: Verificación del punto de integración

Estado: **verificación de código real. Ningún archivo de producción fue modificado. No se creó ninguna tabla, migración, ni `backend/automation/`.**

Complementa [`EFAAT_AUTOMATION_MASTER_SPEC.md`](./EFAAT_AUTOMATION_MASTER_SPEC.md) y [`EFAAT_AUTOMATION_ROADMAP.md`](./EFAAT_AUTOMATION_ROADMAP.md) — no los reemplaza. Se referencian con línea exacta todos los hallazgos.

---

## 1. Comportamiento real actual (resumen ejecutivo)

`detectarEvento()` hace, en una sola cadena secuencial `await`, TODO esto antes de devolver algo a `eventHandler.js`:

```
extraerEvento(texto)                       ← regex, sin cambios
  → obtenerConfiguracion(valor)            ← mapa estático valor→tabla
    → consultarEvento(grupoId)             ← ¿existe fila previa para este grupo?
      → guardarEvento(...)                 ← INSERT o UPDATE en eventos_bot (produce eventoGuardado)
        → abrirGrupo(...)                  ← groupSettingUpdate REAL, YA ejecutado aquí
          → return eventoGuardado          ← esto es lo que eventHandler.js recibe como ctx.evento
```

**Dato central de esta fase**: cuando `eventHandler.js` recibe `ctx.evento`, la apertura real de WhatsApp **ya ocurrió** (con éxito o con fallo registrado). El Automation Engine, enganchado después de esta línea, siempre actúa **después del hecho**, nunca antes. Ver §7.

---

## 2. Punto exacto de integración

Confirmado, sin cambios respecto a Fase 1: [`backend/bot/handlers/eventHandler.js:45`](../backend/bot/handlers/eventHandler.js#L45)

```js
ctx.evento = await detectarEvento(ctx);
```

Es el único lugar de todo el código donde existe, ya resuelto, un evento real (o `null`). No existe ningún otro punto anterior o posterior más apropiado.

---

## 3. Estructura real de `ctx.evento`

`ctx.evento` es exactamente el `return` de `detectarEvento(ctx)`: `null`, o la fila de `eventos_bot` tal como la devuelve Supabase (`eventoGuardado`, construida en [`guardarEvento.js`](../backend/bot/funciones/eventos/guardarEvento.js)).

Campos confirmados (verificados en `guardarEvento.js:42-72` y `136-154`, no en un esquema SQL — la tabla `eventos_bot` no tiene migración en este repo, ver §14):

| campo | origen | nota |
|---|---|---|
| `id` | Supabase (uuid) | **se reutiliza entre sorteos distintos del mismo grupo** — ver §5 |
| `usuario_id` | `sock.context.usuarioId` (dueño de la sesión WhatsApp) | NO es "quien compartió la tabla" — no existe ese actor todavía |
| `session_id` | `sock.context.sessionId` | uuid de `sesiones.id` |
| `telefono_bot` | `sock.context.telefono` | |
| `grupo_id` | parámetro `grupoId` (`message.key.remoteJid`) | |
| `grupo_nombre`, `participantes`, `descripcion_grupo` | `groupMetadata()` (Baileys, vía cola) | pueden ser `null` si falla la metadata |
| `nombre_evento` | `evento.nombre` (de `extraerEvento`) | |
| `hora_fin` | `evento.hora` (de `extraerEvento`) | **esta es la "hora del sorteo"** — no existe un campo llamado `hora_sorteo` |
| `hora_cierre` | `evento.horaCierre` (calculado por `calcularCierre()` dentro de `extraerEvento`) | |
| `fecha_evento` | `new Date().toISOString().split("T")[0]` calculado en `guardarEvento`, NO viene de `extraerEvento` | es la fecha de HOY en el momento de guardar, no una fecha extraída del texto |
| `valor` | `evento.valor` | |
| `premios` | `evento.premios` (array) | |
| `tabla`, `cifras`, `cantidad_numeros` | `obtenerConfiguracion(valor)` | |
| `estado` | siempre `"abierto"` al guardar | string libre, no enum verificado en BD |
| `activo`, `abierto` | booleanos | `abierto` puede mutarse a `false` en memoria dentro de `detectarEvento()` si `abrirGrupo()` falla (línea 174), sin volver a leer de BD |
| `reservados`, `pagados`, `pendientes`, `libres` | solo en el INSERT inicial (no se recalculan en el UPDATE — eso lo hace `actualizarEvento()` aparte) | |
| `creado_en` / `actualizado_en` | timestamps | |

**No existe** ningún campo con el id del mensaje de WhatsApp que originó el evento — ver §8.

---

## 4. Respuestas directas a las 14 preguntas

**1. ¿`detectarEvento(ctx)` llama directamente a `abrirGrupo()`?** Sí.

**2. ¿En qué línea exacta?** [`detectarEvento.js:143`](../backend/bot/funciones/eventos/detectarEvento.js#L143): `const grupoAbierto = await abrirGrupo({ sock, grupoId });`.

**3. ¿Bajo qué condiciones se ejecuta?** Ninguna condición de negocio — se ejecuta **siempre** que `guardarEvento()` haya devuelto una fila (línea 130: `if (!eventoGuardado) { return null; }`, si pasa esa guarda, se llama a `abrirGrupo()` sin más chequeos). No hay verificación de día, horario, ni de si el grupo está "autorizado" — esas nociones no existen todavía en este archivo. Confirmado, sin sorpresas respecto a lo ya documentado en Fase 1 §13.

**4. ¿Qué devuelve exactamente `detectarEvento(ctx)`?** `null` (texto vacío, no es evento, no hay configuración para ese valor, o error) o el objeto `eventoGuardado` (§3).

**5. ¿Qué estructura exacta tiene `ctx.evento`?** Ver tabla de §3.

**6. Campos de identidad** — ver tabla §3: `grupo_id`, `nombre_evento`, `valor`, `hora_fin` (hora del sorteo), `hora_cierre`, `fecha_evento`, `premios`. Todos existen con esos nombres exactos.

**7. ¿Cuál representa realmente la identidad del evento?** Ninguno por sí solo — `eventos_bot.id` NO sirve (se reutiliza, §5). La combinación `grupo_id + nombre_evento + hora_fin + valor + fecha_evento` es la única combinación disponible que distingue un sorteo real de otro. Esto coincide exactamente con la propuesta de `identidad_ciclo` de Fase 1 — **confirmada, sin cambios de nombres de campo** (ver §7 de este documento más abajo, "identidad de evento recomendada").

**8. ¿Existe un identificador del mensaje original disponible en `ctx`?** Sí: `ctx.message.key.id` (confirmado por su uso como `traceId` en [`dispatcher.js:30`](../backend/bot/handlers/dispatcher.js#L30) y por el comentario de tipos en [`obtenerUsuario.js:6-25`](../backend/bot/middleware/obtenerUsuario.js#L6-L25), que documenta la superficie real de `message.key` en esta versión de Baileys). **Pero nunca se persiste** en `eventos_bot` — solo vive en memoria durante ese despacho de mensaje. No es útil como clave de idempotencia entre reinicios (se pierde), pero SÍ es útil como clave de idempotencia dentro de un mismo request para acciones que ocurren en el mismo tick de mensaje (p. ej. `UPDATE_MANUAL`, que reacciona en el momento a un mensaje "actualizar" — ver Master Spec §11).

**9. ¿Existe alguna forma de saber si dos detecciones corresponden al mismo mensaje/evento?** No de forma directa/nativa. La única forma disponible es comparar el contenido resultante (§7 — `identidad_ciclo`), no un id persistido del mensaje.

**10. Confirmar cómo `guardarEvento()` actualiza `eventos_bot` cuando ya existe evento para el grupo.** Confirmado en [`guardarEvento.js:92-116`](../backend/bot/funciones/eventos/guardarEvento.js#L92-L116): si `eventoAnterior` (resultado de `consultarEvento(grupoId)`) existe, hace `UPDATE ... WHERE id = eventoAnterior.id` — sobrescribe TODOS los campos de `datos` (nombre, hora, valor, premios, tabla, estado, activo, abierto, etc.) sobre la misma fila.

**11. ¿`eventos_bot` reutiliza el mismo ID entre sorteos diferentes?** **Sí, confirmado.** [`consultarEvento.js:3-9`](../backend/bot/funciones/eventos/consultarEvento.js#L3-L9) busca por `grupo_id` únicamente (`.eq("grupo_id", grupoId).maybeSingle()`), **sin filtrar por `activo`**. Esto significa: un evento de ayer, ya cerrado (`activo:false`), sigue siendo devuelto como `eventoAnterior` si llega un mensaje de un sorteo NUEVO hoy en el mismo grupo → `guardarEvento()` hace `UPDATE` sobre esa misma fila cerrada, reabriéndola con los datos del sorteo nuevo, **mismo `id`**. `eventos_bot` es "el evento actual de este grupo", no una tabla de historial.

**12. ¿Cómo relaciona `reservas_actividad` las reservas con evento/evento_id?** [`reservarNumeros.js:70-71` y `126`](../backend/bot/funciones/reservas/reservarNumeros.js#L70-L71): tanto la fila de la tabla física (`evento_id: evento.id`) como el registro en `reservas_actividad` (`evento_id: evento.id`) usan directamente `evento.id` — el mismo id reutilizable de §11. **Consecuencia importante para Fase 2B** (ver §11 de este documento, "propuesta corregida de idempotencia"): contar "reservas nuevas de este ciclo" filtrando solo por `evento_id` en `reservas_actividad` mezclaría reservas de un sorteo anterior si comparten el mismo `evento.id`. Hay que acotar también por tiempo (`creado_en >= event_sessions.abierto_en`).

**13. Estructura real de sesiones — ¿cómo se obtiene `usuario_id`/`session_id`?** Confirmado en [`services/baileys/socket.js:69-76` y `128-136`](../backend/services/baileys/socket.js#L69-L76): al crear el socket se hace `SELECT * FROM sesiones WHERE id = sessionId`, y se arma `sock.context = { sessionId: session.id, usuarioId: session.usuario_id, telefono: session.telefono, nombreSesion: session.nombre, estado: session.estado }`. `guardarEvento()` lee `sock.context.usuarioId`/`sock.context.sessionId` directamente (línea 44-46) — es decir, `eventos_bot.usuario_id` = el dueño de la fila `sesiones` usada por ese socket, no un concepto separado.

**14. RLS real de las tablas relevantes.** **No verificable desde el repositorio para las tablas núcleo** (`eventos_bot`, `sesiones`, `grupos`, `reservas_dos_cifras`, `5k_15k_reservas_2_cifras`, `usuarios`) — ninguna tiene un archivo de migración en `backend/supabase_migrations/` (confirmado: `grep` sobre las 5 migraciones solo encuentra coincidencias en comentarios de `002` y `005` que las MENCIONAN, ninguna las crea). **No lo invento.** Sí están confirmadas por migración (con policies `auth.uid() = usuario_id`): `plantillas_mensaje`, `configuracion_seleccion_mensajes`, `reservas_actividad`, `pagos_dispositivos`/`pagos_movimientos` (estas dos sin policies, solo service role), `sesiones_lease` (sin policies, solo service role). Esto ya estaba señalado como riesgo en Fase 0 §O.2 — sigue sin resolverse, requiere verificación directa en el dashboard de Supabase antes de Fase 2B.

---

## 5. Punto crítico sobre la apertura — resuelto

El diagrama de la consigna (`detectarEvento() → abrirGrupo() → ctx.evento → Automation Engine`) es **correcto en el orden**, y la verificación de código lo confirma con precisión de línea (§1, §4.2-3). La implicación arquitectónica es:

> **El Automation Engine, enganchado en `eventHandler.js:45`, siempre recibe el evento DESPUÉS de que WhatsApp ya fue tocado (o el intento falló).** No hay ninguna forma de interceptar o condicionar la apertura real desde ese punto sin modificar `detectarEvento()` o `abrirGrupo()` — ambos prohibidos en esta fase.

### Alternativas evaluadas (solo análisis — nada se implementa)

**A) Mantener la apertura actual tal cual; Automation Engine controla solo lo posterior.**
Es lo que ya proponía el Master Spec §13, y esta verificación lo confirma como la única alternativa que cumple **estrictamente** todas las restricciones de esta fase (cero cambios a `detectarEvento`/`abrirGrupo`). Costo aceptado explícitamente: la regla de negocio "HORARIO + GRUPO AUTORIZADO + EVENTO VÁLIDO = ABRIR GRUPO" se cumple para las **acciones de automatización** (mensaje/sticker/Event Session), pero **no** para el toggle real de WhatsApp — ese sigue abriendo con cualquier evento detectado, como hoy. Esto no es una contradicción nueva: ya estaba señalado en el Master Spec §13 como "discrepancia consciente a resolver explícitamente en Fase 2" — esta verificación la confirma y la deja más precisa, no la corrige.

**B) Mecanismo externo futuro para condicionar la apertura sin duplicar `detectarEvento()`/`abrirGrupo()`.**
Analizadas tres variantes, ninguna implementable dentro de las reglas de esta fase (todas requieren tocar código protegido o son parches):
- **B1** — pasar un predicado/callback opcional a `detectarEvento()` (con default = comportamiento actual sin cambios) para que decida si llama a `abrirGrupo()`. Técnicamente limpio, pero **modifica la firma y el cuerpo de `detectarEvento()`** — requiere aprobación explícita en una fase futura, no aplicable ahora.
- **B2** — modificar `abrirGrupo()` para que acepte una verificación de autorización. Mismo problema: `abrirGrupo()` está en la lista de "no tocar".
- **B3 (compensatoria, no invasiva, reutiliza `cerrarGrupo()` existente)** — si `EventRules` (ejecutado en `eventHandler.js`, después del hecho) determina que el evento NO debía abrir (fuera de horario / grupo no autorizado), el Automation Engine llama inmediatamente a `cerrarGrupo()` (función YA existente y aprobada para reutilizar) como acción correctiva. **No modifica ni duplica nada protegido** — solo reutiliza una función ya aprobada, desde el hook ya aprobado. Costo: el grupo pasa brevemente por abierto→cerrado (parpadeo visible para los miembros del grupo), y sigue siendo un patrón "abre igual, se corrige después", no una verdadera prevención.

**C) Aceptar la limitación como decisión de producto, documentarla, y revisar `detectarEvento()`/`abrirGrupo()` en una fase posterior separada (si el negocio lo requiere) con su propia aprobación explícita.**
Es la recomendación de este documento para Fase 2B: implementar **A** como base (ya estaba aprobada), dejar **B3** documentado como mitigación disponible pero NO activada por defecto (se activaría por configuración explícita, entendiendo el costo de parpadeo), y **no tocar `detectarEvento()`/`abrirGrupo()`** salvo pedido explícito y aprobado aparte.

---

## 6. Identidad de evento recomendada — confirmada

```
identidad_ciclo = hash(
    evento.grupo_id,        ← existe, confirmado (§3)
    evento.nombre_evento,   ← existe, confirmado (§3)
    evento.hora_fin,        ← existe, confirmado (§3) — ES la "hora del sorteo"
    evento.valor,           ← existe, confirmado (§3)
    evento.fecha_evento     ← existe, confirmado (§3) — cuidado: es la fecha de HOY al guardar, no una fecha extraída del texto (§3)
)
```

**Sin cambios respecto al Master Spec.** Los 5 campos existen exactamente con esos nombres en la fila real devuelta por `detectarEvento()`. Único matiz a documentar (no es un error, es una precisión): `fecha_evento` se calcula en `guardarEvento()` como la fecha del servidor en el momento de guardar (zona horaria del proceso Node, sin ajuste explícito a `America/Bogota` — a diferencia de `reservarNumeros.js`, que sí usa `toLocaleDateString("sv-SE", {timeZone: "America/Bogota"})`), no se extrae del texto del mensaje. Para el cálculo de `identidad_ciclo` esto es indiferente (se usa el valor tal cual está guardado), pero conviene tenerlo presente si en el futuro se compara `fecha_evento` con fechas calculadas en otra zona horaria.

---

## 7. Riesgos encontrados (nuevos o refinados en esta fase)

1. **(Confirmado, no nuevo)** Apertura real de WhatsApp ocurre siempre antes de que el Automation Engine pueda opinar — ver §5.
2. **(Nuevo, refina Master Spec §11)** Contar "reservas nuevas del ciclo actual" usando solo `reservas_actividad.evento_id` es incorrecto si el mismo `evento.id` fue reutilizado por un sorteo anterior — debe acotarse también por tiempo. Ver §9.
3. **(Nuevo, refina Master Spec §8)** La estrategia `INSERT ... UNIQUE(clave_idempotencia)` protege el INICIO de una acción, no su FINALIZACIÓN. Si el proceso muere entre el INSERT y la confirmación real del envío por WhatsApp, la clave queda "ocupada" para siempre y el sistema nunca sabrá si el mensaje salió o no. Ver §10.
4. **(Confirmado, no nuevo)** RLS no verificable en las tablas núcleo — Fase 0 §O.2, sigue abierto.
5. **(Nuevo, menor)** `ctx.evento.abierto` puede quedar en `false` **solo en memoria** (línea 174 de `detectarEvento.js`) sin que se haya podido persistir ese mismo valor en Supabase (si `marcarAperturaFallida` agota sus 3 reintentos). El Automation Engine, si llegara a leer `ctx.evento.abierto` directamente de `ctx` en vez de releer de Supabase, podría ver un valor que no coincide con lo persistido. Recomendación: el Automation Engine debe usar `ctx.evento` solo para datos de identidad/negocio (nombre, hora, valor), y siempre releer el estado operativo (`activo`/`abierto`) de Supabase al decidir, nunca confiar en el objeto en memoria para eso.

---

## 8. Propuesta de integración — sin cambios de fondo respecto a Fase 1

Confirmada la Alternativa A (§5) como base. El único cambio de una línea propuesto para Fase 3 sigue siendo el mismo de Master Spec §4, ahora con la garantía adicional (§7.5) de que el Automation Engine debe releer `activo`/`abierto` de Supabase, no confiar en el objeto en memoria que le llega en `ctx.evento`.

---

## 9. Propuesta corregida de Event Session

Sin cambios de columnas respecto al Master Spec §6.3 — todas verificadas como viables. Dos ajustes:

1. **`evento_id` es informativo, nunca clave de unicidad ni de conteo.** Documentar explícitamente en el propio comentario de la migración futura: "no usar `evento_id` solo para agregaciones históricas — se reutiliza entre sorteos (ver PHASE_2A_FINDINGS §4.11)".
2. **`datos_evento_snapshot` (jsonb) sube de "recomendado" a "obligatorio".** Es la única copia estable de los datos de ESTE ciclo específico una vez que `eventos_bot` se sobrescriba con el siguiente sorteo del mismo grupo — sin este snapshot, cualquier acción tardía (p. ej. un recordatorio que dispara justo cuando ya empezó a detectarse el evento del día siguiente) leería datos equivocados si releyera `eventos_bot` en caliente.
3. Se añade `UNIQUE(grupo_id, identidad_ciclo)` (en vez de únicamente `UNIQUE(identidad_ciclo)`) — protección barata adicional, `grupo_id` ya es parte del hash pero conviene que la propia restricción de base de datos lo deje explícito y legible.

Ningún otro campo cambia. No se crea la tabla en esta fase.

---

## 10. Propuesta corregida de idempotencia (ExecutionGuard)

### El problema exacto

```
INSERT automation_actions (clave, resultado=?)   ← si esto se confirma...
    ↓
enviar por WhatsApp (sendMessage)                 ← ...y el proceso muere AQUÍ...
    ↓
UPDATE automation_actions SET resultado='ok'      ← ...esto nunca corre.
```

Con el diseño original de Fase 1 (INSERT único = "ya ejecutada"), la fila queda existiendo para siempre con un estado ambiguo: no sabemos si el mensaje salió o no, y como la clave ya "existe", el sistema **nunca reintentará**, aunque el mensaje real nunca haya llegado a WhatsApp. Es el escenario exacto que la consigna pidió analizar.

### Corrección: estado explícito de dos fases, no solo presencia/ausencia

```
automation_actions.estado: 'en_progreso' | 'ok' | 'error'
```

1. `INSERT` con `estado='en_progreso'` (protegido por el mismo `UNIQUE(clave_idempotencia)` de antes — sigue siendo la barrera contra ejecuciones concurrentes/duplicadas).
2. Si el INSERT falla por unicidad (23505):
   - si la fila existente tiene `estado='ok'` → ya se ejecutó de verdad, no hacer nada (comportamiento original, correcto).
   - si la fila existente tiene `estado='error'` → se puede reintentar explícitamente (decisión del llamador, no automática).
   - si la fila existente tiene `estado='en_progreso'` → **caso del crash**: ver barrido de recuperación abajo.
3. Si el INSERT tiene éxito, se ejecuta la acción real. Al terminar: `UPDATE ... SET estado='ok'` (éxito) o `estado='error', detalle=...` (fallo controlado, con excepción capturada).

### Barrido de recuperación (nuevo, no existía en Fase 1)

El Scheduler (Master Spec §9), en cada tick, revisa filas `en_progreso` con más de N minutos de antigüedad (recomendado: 5 minutos — tiempo generoso frente a lo que tarda un envío normal de WhatsApp, que hoy además ya incluye una espera artificial de hasta 7s en `sendMessage`, ver `services/baileys/send.js:39-59`) y decide, **según el tipo de acción**, una de dos políticas configurables (ninguna implementada todavía, solo documentada):

- **Política segura (por defecto, recomendada)**: no reintenta automáticamente. Marca la fila como `estado='error', detalle={motivo:'timeout_en_progreso'}` y la deja para revisión — evita a toda costa un reenvío duplicado no controlado.
- **Política de reintento acotado (opcional, por tipo de acción, para acciones de bajo costo si se duplican — p. ej. recordatorios informativos, no acciones estructurales como abrir/cerrar)**: reintenta **una sola vez** tras el timeout, y si vuelve a fallar o a quedar `en_progreso`, pasa a la política segura. Nunca reintenta en bucle.

Ninguna de las dos políticas se implementa en esta fase — se documenta la necesidad y el mecanismo para que Fase 2B lo construya con esta base ya decidida.

---

## 11. Qué debe hacerse en Fase 2B

1. Migración `006_automation_engine.sql`: `event_sessions` (§9, con las 2 correcciones), `automation_actions` (con `estado` de 3 valores, §10), `automation_configs`, `grupos_autorizados`.
2. `backend/automation/executionGuard.js` implementando el flujo de dos fases (§10) + el barrido de recuperación con la política segura por defecto.
3. `backend/automation/eventRules.js` calculando `identidad_ciclo` exactamente con los 5 campos de §6, y releyendo `activo`/`abierto` de Supabase (nunca de `ctx.evento` en memoria, §7.5) antes de decidir.
4. `UpdateRules` (cuando se construya, Fase 6 del roadmap) debe filtrar `reservas_actividad` por `evento_id = X AND creado_en >= event_sessions.abierto_en`, nunca solo por `evento_id` (§4.12, §7.2).
5. Verificar directamente en el dashboard de Supabase el estado real de RLS de `eventos_bot`, `sesiones`, `grupos`, `reservas_dos_cifras`, `5k_15k_reservas_2_cifras`, `usuarios` antes de escribir cualquier policy nueva sobre `event_sessions`/`automation_actions`/`automation_configs`/`grupos_autorizados` que dependa de asunciones sobre esas tablas.
6. Todo lo demás de `EFAAT_AUTOMATION_ROADMAP.md` Fase 2 sigue vigente sin cambios.

## 12. Qué NO debe tocarse nunca (confirmado, sin excepciones en esta fase)

`detectarEvento()`, `extraerEvento()`, los extractores, los regex, `guardarEvento()`, el dispatcher, el middleware, `abrirGrupo()`, `cerrarGrupo()`, `workerEventos()`, el sistema de sesiones/reconexión de WhatsApp. Ninguno de estos archivos fue leído con intención de modificar — solo se leyeron para verificar comportamiento, y ninguno fue editado.

---

## 13. Contradicciones con la documentación anterior

**Ninguna contradicción grave.** Los campos de `identidad_ciclo` propuestos en Fase 1 existen exactamente como se habían asumido. Los dos hallazgos de esta fase (§9, §10) son **endurecimientos** de partes que el propio Master Spec ya dejaba abiertas explícitamente ("Event Session — revisar si el modelo... necesita ajustes", "riesgo real... queda fuera de alcance afinar esta distinción más" para RLS) — no reemplazan ninguna decisión ya tomada, la precisan antes de construir código real. No se modificó `EFAAT_AUTOMATION_MASTER_SPEC.md` ni `EFAAT_AUTOMATION_ROADMAP.md`.
