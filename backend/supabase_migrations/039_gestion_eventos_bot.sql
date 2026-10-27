-- ==========================================================================
-- 039 — Administración de sorteos en curso (eventos_bot): archivo lógico.
--
-- PREPARADA EL 2026-10-27. NO APLICADA. Ejecutar manualmente en el SQL
-- Editor de Supabase cuando se autorice.
--
-- eventos_bot.archivado_en: momento en que el administrador ELIMINÓ el
-- sorteo desde el panel (eliminación LÓGICA, sorteos/gestionEventos.js). La
-- fila, sus reservas, pagos e historial se conservan; solo deja de mostrarse
-- y de usarse como sorteo del grupo.
--
-- Columna NUEVA y nullable: no modifica ni borra datos existentes.
-- Idempotente. No cambia RLS ni políticas.
--
-- El backend funciona SIN esta migración: el estado del sorteo ("eliminado",
-- "desactivado", "cancelado") se guarda en eventos_bot.estado y en
-- eventos_bot.cierre_motivo (prefijo "panel:"), y archivado_en se omite.
--
-- Comprobación previa recomendada (solo lectura): que eventos_bot.estado no
-- tenga una restricción CHECK que impida los nuevos valores. Si la tiene, el
-- backend guarda estado = 'cerrado' y conserva el motivo en cierre_motivo
-- (requiere la migración 023).
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.eventos_bot'::regclass and contype = 'c';
-- ==========================================================================

alter table public.eventos_bot
    add column if not exists archivado_en timestamptz;

comment on column public.eventos_bot.archivado_en is
    'Eliminación lógica desde el panel (gestionEventos.js). La fila y sus reservas/pagos se conservan.';
