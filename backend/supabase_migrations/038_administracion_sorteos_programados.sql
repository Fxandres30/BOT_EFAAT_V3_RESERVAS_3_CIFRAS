-- ==========================================================================
-- 038 — Administración de sorteos programados: archivo e historial.
--
-- PREPARADA EL 2026-10-24. NO APLICADA. Ejecutar manualmente en el SQL
-- Editor de Supabase cuando se autorice.
--
-- 1) sorteos_programados.archivado_en: «Archivar» oculta del listado una
--    programación terminada, cancelada o que no llegó a publicarse, SIN
--    borrar nada (ni la programación, ni sus grupos, ni eventos, ni
--    reservas). «Restaurar» la vuelve a mostrar.
-- 2) sorteos_programados_historial: lo que hizo el administrador
--    (cancelar, eliminar, archivar, restaurar, reintentar) con el resultado
--    REAL. Sin clave foránea a sorteos_programados a propósito: el registro
--    de una programación eliminada se conserva.
--
-- Columna y tabla NUEVAS: no modifica datos existentes. Idempotente.
--
-- Acceso al historial: solo el backend (service role). RLS activada SIN
-- políticas: anon y authenticated no leen ni escriben (el panel pasa por
-- la API, que toma el usuario del token).
--
-- El backend funciona SIN esta migración: «Archivar» responde que la
-- función no está disponible todavía, y el historial se escribe en el log
-- del proceso (📝 [SORTEOS HISTORIAL]) en lugar de la tabla.
-- ==========================================================================

alter table public.sorteos_programados
    add column if not exists archivado_en timestamptz;

create table if not exists public.sorteos_programados_historial (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,
    sorteo_id uuid not null,
    accion text not null check (accion in ('cancelar', 'eliminar', 'archivar', 'restaurar', 'reintentar')),
    resultado text not null check (char_length(resultado) between 1 and 40),
    detalle jsonb not null default '{}'::jsonb,
    creado_en timestamptz not null default now()
);

create index if not exists sorteos_programados_historial_por_sorteo
    on public.sorteos_programados_historial (usuario_id, sorteo_id, creado_en);

alter table public.sorteos_programados_historial enable row level security;
revoke all on public.sorteos_programados_historial from anon, authenticated;

-- Verificación (solo lectura):
--   select column_name from information_schema.columns
--    where table_name = 'sorteos_programados' and column_name = 'archivado_en';
--   select relrowsecurity from pg_class where relname = 'sorteos_programados_historial';
--   select accion, resultado, creado_en from public.sorteos_programados_historial
--    order by creado_en desc limit 20;
--
-- Reversión (se pierde el historial; las archivadas vuelven a mostrarse):
--   drop table if exists public.sorteos_programados_historial;
--   alter table public.sorteos_programados drop column if exists archivado_en;
