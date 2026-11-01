-- ==========================================================================
-- 042 — Preferencias del mensaje de publicación de sorteos, POR CUENTA.
--
-- PREPARADA EL 2026-10-31. NO APLICADA. Ejecutar manualmente en el SQL
-- Editor de Supabase cuando se autorice.
--
-- preferencias_mensaje_sorteo: una fila por cuenta (usuario_id) con el
-- estilo de mensaje que se propone al crear un sorteo nuevo. El catálogo de
-- estilos vive en el código (backend/sorteos/estilosMensaje.js); aquí solo
-- se valida la forma del identificador, para no exigir una migración cada
-- vez que se añada un estilo. Un identificador que el código ya no conozca
-- se trata como «clásico».
--
-- Lo demás NO necesita migración: el texto, el estilo, activo/inactivo, la
-- revisión y la fecha de modificación del mensaje de CADA sorteo se guardan
-- en sorteos_programados.config.mensajes (jsonb existente, ya ligado a la
-- cuenta propietaria).
--
-- Tabla NUEVA: no modifica datos existentes. Idempotente.
--
-- Acceso: solo el backend (service role). RLS activada SIN políticas: anon
-- y authenticated no leen ni escriben (el panel pasa por la API, que toma el
-- usuario del token). Mismo criterio que la 038.
--
-- El backend funciona SIN esta migración: los sorteos nuevos usan el estilo
-- clásico y «Usar por defecto» responde que la función aún no está
-- disponible. Nunca bloquea la creación de sorteos.
-- ==========================================================================

create table if not exists public.preferencias_mensaje_sorteo (
    usuario_id uuid primary key references auth.users(id) on delete cascade,
    estilo_predeterminado text not null default 'clasico'
        check (estilo_predeterminado ~ '^[a-z_]{1,40}$'),
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);

alter table public.preferencias_mensaje_sorteo enable row level security;
revoke all on public.preferencias_mensaje_sorteo from anon, authenticated;

-- Verificación (solo lectura):
--   select relrowsecurity from pg_class where relname = 'preferencias_mensaje_sorteo';
--   select count(*) from pg_policies where tablename = 'preferencias_mensaje_sorteo';  -- 0
--   select has_table_privilege('anon', 'public.preferencias_mensaje_sorteo', 'select'); -- false
--
-- Reversión (borra solo las preferencias; ningún sorteo cambia):
--   drop table if exists public.preferencias_mensaje_sorteo;
