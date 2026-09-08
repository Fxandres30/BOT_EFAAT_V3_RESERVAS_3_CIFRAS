# EFAAT — Automation Engine — Fase 4A: Message Pool + OPEN_MESSAGE

Estado: **entregada, 158/158 pruebas en verde. No se marca cerrada hasta aprobación explícita.**

---

## Arquitectura

```
backend/automation/
├── engine.js                 (MODIFICADO: + enviarMensajeApertura())
├── eventRules.js              (sin cambios)
├── executionGuard.js          (sin cambios — REUTILIZADO, no duplicado)
├── messageSelector.js         (NUEVO — algoritmo aleatorio + anti-repetición)
├── variableResolver.js        (NUEVO — resuelve {variables}, puro)
└── repo/
    ├── eventSessions.js       (sin cambios)
    ├── automationConfig.js    (sin cambios)
    └── messages.js            (NUEVO — persistencia del pool + registro de uso)

backend/supabase_migrations/
└── 007_automation_messages.sql  (NUEVA — automation_messages, automation_message_uses)

backend/tests/mensajes/
├── entornoFake.js
└── mensajesAutomation.test.js   (17 casos)

backend/bot/funciones/eventos/detectarEvento.js  (MODIFICADO: 2 bloques pequeños)
```

`006_automation_engine.sql` no se tocó. Se verificó (lectura, no auditoría general) que sus 4 tablas ya existen en el Supabase real del proyecto.

## Migración 007

`automation_messages` (el pool: `usuario_id` NULL=global / con valor=propio, `nombre_interno`, `texto`, `tipo`, `categoria`, `activo`, `orden`, timestamps) y `automation_message_uses` (registro de uso: `message_id`, `event_session_id`, `usuario_id`, `grupo_id`, `tipo`, `categoria`, `usado_en`). RLS en ambas: `automation_messages` permite SELECT de mensajes globales + propios, pero INSERT/UPDATE/DELETE solo de los propios (`auth.uid() = usuario_id` — nunca se puede crear/editar un mensaje global desde el cliente); `automation_message_uses` sigue el patrón de log de solo lectura+inserción ya usado en `reservas_actividad`/`automation_actions`.

## Modelo Message Pool

`id, usuario_id (nullable=global), nombre_interno, texto, tipo, categoria, activo, orden, creado_en, actualizado_en`. Nunca guarda `valor`/`premios`/`hora`/etc. del sorteo — solo la plantilla de texto.

## Algoritmo aleatorio (`messageSelector.js`)

1. `obtenerMensajesActivos()` — junta globales + propios del usuario, activos, del tipo (+categoría) pedido.
2. Si hay más de un candidato, se excluye el último usado (`obtenerUltimoMensajeUsado`) — **salvo que eso deje 0 candidatos**, en cuyo caso se conserva el único disponible ("cuando sea posible").
3. `Math.floor(Math.random() * candidatos.length)` sobre el array ya filtrado — nunca el primero, nunca depende del orden de Supabase.

## Anti-repetición

`automation_message_uses` guarda cada uso real (tras un envío exitoso, no antes) — `messageSelector` la consulta para excluir el último. Verificado con 60 iteraciones (test 3, al menos 2 mensajes distintos aparecen) y de forma determinística cuando solo hay 2 candidatos (test 4).

## Variables

`variableResolver.resolverVariables(texto, datos)` — puro, sin Supabase. Si una variable del texto no está en `datos`, **no se envía** (`completo:false`), la plantilla nunca se reemplaza por un valor inventado. `engine.js` construye `datos` solo con campos reales ya presentes en el evento (`nombre_evento`, `valor`, `hora_cierre`, `reservados`, `libres`→`disponibles`, `premios[0].premio`→`premio`) — nunca inventa nada.

## OPEN_MESSAGE — integración

`engine.enviarMensajeApertura(evento, eventSession, sock)`, llamada desde `detectarEvento.js` **solo** dentro del bloque que ya confirma `grupoAbierto === true` (después de `abrirGrupo()` existente), de forma no bloqueante (mismo patrón fire-and-forget que ya usa el escáner de identidades). Selecciona → resuelve variables → si están completas, `executionGuard.ejecutarUnaVez({ claveIdempotencia: "<eventSessionId>:OPEN_MESSAGE", ... })` (EXISTENTE, sin cambios) → dentro del callback protegido: `sendMessage()` de `services/baileys/send.js` (EXISTENTE, sin duplicar) y solo si eso tuvo éxito, `registrarUso()`. Nunca lanza hacia `detectarEvento.js`.

## Tests

17 nuevos (`tests/mensajes/mensajesAutomation.test.js`) cubriendo los 13 puntos pedidos + variantes (global/propio/ajeno, "cuando sea posible", sin mensajes disponibles). Se corrigió además una aserción desactualizada en `tests/automation/eventSessions.test.js` (asumía que `engine.js` nunca mencionaría Baileys — ya no es cierto desde esta fase; se dividió en dos pruebas: una para los módulos puros que sí deben seguir sin Baileys, y una nueva confirmando que `engine.js` reutiliza `send.js` sin abrir/cerrar grupos ni requerir `bot/`).

**Resultado total: 158/158** (89 preexistentes + 36 Fase 2B + 15 Fase 3 + 17 Fase 4A + 1 test extra de corrección).

No se avanzó a Fase 4B (Scheduler, recordatorios, actualizaciones, cierre, stickers, comandos manuales, UI — todo pendiente).
