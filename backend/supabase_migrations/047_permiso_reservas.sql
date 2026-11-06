-- ==========================================================================
-- 047 — PERMISO DE RESERVAS POR SORTEO (F3-E, 06/11/2026). PREPARADA, NO
-- APLICADA. Ejecutar a mano en el SQL Editor de Supabase solo con
-- autorización.
--
-- Separa el ESTADO del sorteo (abierto/cerrado, lo deciden sus modalidades
-- de cierre) del PERMISO para reservar (lo decide el administrador):
--
--   segun_estado (o NULL, predeterminado)  acepta mientras el sorteo está
--                                          vigente y antes de su hora de
--                                          cierre (lo de siempre)
--   permitidas                             acepta aunque el sorteo esté
--                                          cerrado (decisión del administrador)
--   desactivadas                           rechaza aunque esté abierto
--
-- Pertenece a eventos_bot (el sorteo en cada grupo); el panel lo escribe en
-- TODAS las filas del sorteo (misma identidad). Ninguna automatización lo
-- cambia: ni el cierre, ni la reapertura, ni el reinicio, ni el publicador.
-- Los sorteos cancelados, eliminados o sustituidos NUNCA aceptan reservas
-- nuevas, sea cual sea el permiso (lo aplica el backend:
-- shared/eventos/estadosGestion.puedeReservar).
--
-- Sin esta migración el backend funciona igual que hoy (todo es
-- «segun_estado») y el panel avisa de que falta al intentar cambiarlo.
-- No modifica ninguna fila: NULL = segun_estado.
-- ==========================================================================

begin;

alter table public.eventos_bot
    add column if not exists reservas_modo text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'eventos_bot_reservas_modo_valido') then
        alter table public.eventos_bot
            add constraint eventos_bot_reservas_modo_valido
            check (reservas_modo is null or reservas_modo in ('segun_estado', 'permitidas', 'desactivadas'));
    end if;
end $$;

comment on column public.eventos_bot.reservas_modo is
    'Permiso de reservas decidido por el administrador (segun_estado|permitidas|desactivadas; NULL = segun_estado). Independiente del estado del sorteo. F3-E.';

commit;

-- Verificación (solo lectura):
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'eventos_bot' and column_name = 'reservas_modo';
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'eventos_bot_reservas_modo_valido';
--   select reservas_modo, count(*) from public.eventos_bot group by 1;   -- esperado: solo NULL
--
-- Reversión (pierde los permisos configurados):
--   begin;
--   alter table public.eventos_bot drop constraint if exists eventos_bot_reservas_modo_valido;
--   alter table public.eventos_bot drop column if exists reservas_modo;
--   commit;
