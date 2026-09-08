-- Fase 5 — Publicación inicial de tabla (INITIAL_TABLE).
--
-- Migración MÍNIMA: agrega UNA columna jsonb nueva a automation_configs
-- (tabla EXISTENTE, 006) — es la única pieza de esta fase que no tenía un
-- lugar limpio. Ninguna columna existente sirve: "activo" es el
-- interruptor maestro global, "dias_permitidos" es la restricción
-- histórica de Apertura (además, desde que el panel frontend dejó de
-- exponer día/horario de apertura, esa columna ya no representa una
-- restricción real — siempre se guarda "abierto" los 7 días, ver
-- frontend/services/automatizacion/automationConfigs.ts:
-- diasPermitidosSiempreAbierto()), y mensaje_apertura/mensaje_cierre/
-- mensaje_actualizacion/recordatorios ya tienen su propio significado
-- documentado (activo + categoria del Message Pool). "Publicación inicial
-- de tabla" necesita su PROPIO día/hora, específico de esta acción — no
-- reutilizar una columna cuyo significado ya es otro.
--
-- IMPORTANTE (regla fundamental del proyecto, repetida a propósito):
-- automation_configs NUNCA almacena datos del sorteo (nombre, valor,
-- premios, hora de cierre, tabla real de reservas, cifras). Esta columna
-- solo decide CUÁNDO intentar publicar — la tabla real (evento.tabla) y
-- sus números siempre se leen en el momento de publicar, vía
-- automation/repo/tablaEvento.js (solo lectura), nunca guardados aquí.
--
-- No es tabla nueva -> no aplica "toda tabla nueva necesita su propia
-- RLS": automation_configs ya tiene RLS habilitada y sus policies
-- (auth.uid() = usuario_id) desde 006 — cubren automáticamente cualquier
-- columna nueva de esa misma fila, sin cambios. No modifica 006, 007 ni
-- 008 (solo agrega una columna, con IF NOT EXISTS — reintentable sin
-- efecto si ya se aplicó).
--
-- Ejecutar manualmente en el SQL Editor de Supabase (mismo procedimiento
-- que 001-008 — no hay CLI/psql configurado en este proyecto).

alter table public.automation_configs
    add column if not exists publicacion_inicial_tabla jsonb not null default '{}'::jsonb;

-- Forma esperada por el código (automation/eventRules.js:
-- evaluarPublicacionInicialTabla / automation/scheduler.js):
-- {
--   "activo": boolean,
--   "hora": "HH:mm",
--   "dias_permitidos": {"lunes": boolean, "martes": boolean, "miercoles":
--     boolean, "jueves": boolean, "viernes": boolean, "sabado": boolean,
--     "domingo": boolean}
-- }
comment on column public.automation_configs.publicacion_inicial_tabla is
    'Fase 5: {"activo": boolean, "hora": "HH:mm", "dias_permitidos": {"lunes": boolean, ...}} para INITIAL_TABLE. Los datos reales (números disponibles/ocupados) siempre salen de la tabla de reservas real del evento (evento.tabla), nunca de esta columna.';
