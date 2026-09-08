-- Fase 4B — Scheduler real (REMINDER_MESSAGE / UPDATE_MESSAGE / CLOSE_MESSAGE).
--
-- Migración deliberadamente MÍNIMA: se evaluó primero si event_sessions +
-- automation_configs + automation_actions (006) y automation_messages (007)
-- ya alcanzaban para esta fase (instrucción explícita: no crear tabla nueva
-- si el modelo existente resuelve la necesidad) — y casi todo alcanza:
--
--   - REMINDER_MESSAGE: reutiliza automation_configs.recordatorios (jsonb,
--     ya existía en 006). Solo cambia la FORMA que el código espera
--     adentro — de "{'2h': {activo, texto}}" (Fase 2B, antes de que
--     existiera el Message Pool) a "{'<minutos>': {activo, categoria}}"
--     (Fase 4B: el TEXTO ahora sale siempre de automation_messages/
--     messageSelector.js, nunca de un campo texto guardado en la config —
--     aquí solo se decide "¿está activo este recordatorio?" y "¿con qué
--     categoría del pool?"). jsonb es deliberadamente abierto para esto
--     (ver comentario original en 006_automation_engine.sql) — no hace
--     falta ninguna migración para este cambio de forma.
--   - CLOSE_MESSAGE: reutiliza automation_configs.mensaje_cierre (jsonb, ya
--     existía en 006), con la misma forma nueva "{activo, categoria}".
--   - Idempotencia/concurrencia: automation_actions (006) sin cambios.
--   - Contador de actualizaciones enviadas: event_sessions.
--     actualizaciones_enviadas / ultima_actualizacion_en (006) sin cambios,
--     ya existían para exactamente este propósito.
--
-- La ÚNICA pieza que genuinamente no tenía un lugar limpio: UPDATE_MESSAGE
-- necesita su propio interruptor "activo" + "categoria" del pool, igual
-- que mensaje_apertura/mensaje_cierre — y ninguna columna existente de
-- automation_configs se llama así ni encaja semánticamente (reutilizar
-- "recordatorios" o "mensaje_cierre" para esto habría sido más confuso que
-- agregar una columna). Por eso, y solo por eso, esta migración agrega UNA
-- columna jsonb nueva a una tabla que YA EXISTE — no crea ninguna tabla.
--
-- No es una tabla nueva, así que no aplica "toda tabla nueva necesita su
-- propia RLS": automation_configs ya tiene RLS habilitada y sus policies
-- (auth.uid() = usuario_id) desde 006 — son policies de FILA, cubren
-- automáticamente cualquier columna nueva de esa misma fila, sin cambios.
--
-- No modifica 006 ni 007 (solo agrega una columna, con IF NOT EXISTS —
-- reintentable sin efecto si ya se aplicó). Ejecutar manualmente en el SQL
-- Editor de Supabase (mismo procedimiento que 001-007 — no hay CLI/psql
-- configurado en este proyecto).

alter table public.automation_configs
    add column if not exists mensaje_actualizacion jsonb not null default '{}'::jsonb;

-- Forma esperada por el código (automation/scheduler.js):
-- {"activo": false, "categoria": null}
-- El umbral/cooldown de disparo siguen siendo umbral_reservas/
-- cooldown_minutos (columnas enteras, ya existían en 006) — esta columna
-- solo decide SI se envía algo y CON QUÉ categoría del Message Pool,
-- nunca cuándo (eso lo sigue calculando el Scheduler contra datos reales
-- de reservas_actividad/eventos_bot, nunca inventados).
comment on column public.automation_configs.mensaje_actualizacion is
    'Fase 4B: {"activo": boolean, "categoria": text|null} para UPDATE_MESSAGE. El texto real sale siempre de automation_messages (Message Pool), nunca de esta columna.';
