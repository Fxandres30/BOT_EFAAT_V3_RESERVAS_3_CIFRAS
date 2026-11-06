-- ==========================================================================
-- 048 — HISTORIAL DEL ORQUESTADOR DE CIERRE (F3, 06/11/2026). PREPARADA, NO
-- APLICADA. Ejecutar a mano en el SQL Editor de Supabase solo con
-- autorización.
--
-- Una fila por operación del orquestador central sobre un sorteo en un grupo:
-- cierres de cualquier modalidad (hora, pagados, recuperado, cerrar,
-- desactivar, cancelar, eliminar, sustituciones, normalización), reaperturas
-- y cambios del permiso de reservas. Sin esta tabla el backend sigue igual y
-- deja el mismo registro en el log (bot/funciones/eventos/lifecycle/
-- cerrarEvento.js::registrarHistorialEvento).
--
-- Igual que reservas_auditoria (032): solo el backend escribe
-- (service_role); solo inserción (UPDATE/DELETE/TRUNCATE rechazados para
-- cualquier rol); fecha del servidor; el panel solo lee lo de su cliente.
-- No guarda datos personales: ids, modalidad, actor, motivo y resultado.
-- ==========================================================================

begin;

create table if not exists public.eventos_bot_historial (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,
    evento_id uuid,
    identidad_evento_real text,
    grupo_id text,
    modalidad text not null check (modalidad in (
        'hora', 'pagados', 'recuperado', 'cerrar', 'desactivar', 'cancelar', 'eliminar',
        'sustitucion_anuncio', 'sustitucion_precio', 'sustitucion_reinicio', 'sustitucion_reabrir',
        'normalizacion', 'reapertura', 'permiso_reservas'
    )),
    -- «sistema», «deteccion», «panel» o el email/id del operador (del token).
    actor text not null check (char_length(actor) between 1 and 200),
    motivo text check (motivo is null or char_length(motivo) <= 300),
    resultado text not null check (resultado in ('ok', 'ya_terminada', 'rechazado', 'error')),
    detalle jsonb not null default '{}'::jsonb,
    creado_en timestamptz not null default now()
);

create index if not exists eventos_bot_historial_por_evento on public.eventos_bot_historial (usuario_id, evento_id, creado_en desc);
create index if not exists eventos_bot_historial_por_identidad on public.eventos_bot_historial (usuario_id, identidad_evento_real, creado_en desc);

-- Excepción ÚNICA: el borrado en cascada al eliminar la cuenta (auth.users,
-- on delete cascade). Lo ejecuta la clave foránea desde su propio trigger,
-- así que llega anidado (pg_trigger_depth() > 1); un DELETE directo de
-- cualquier rol llega con profundidad 1 y se rechaza. Sin esta excepción,
-- borrar una cuenta con historial fallaría.
create or replace function public.eventos_bot_historial_inmutable()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
    if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
        return old;
    end if;
    raise exception 'eventos_bot_historial es de solo inserción (% no permitido)', tg_op using errcode = '42501';
end;
$$;

create or replace function public.eventos_bot_historial_fecha()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
    new.creado_en := now();
    return new;
end;
$$;

drop trigger if exists eventos_bot_historial_sin_cambios on public.eventos_bot_historial;
create trigger eventos_bot_historial_sin_cambios before update or delete on public.eventos_bot_historial
    for each row execute function public.eventos_bot_historial_inmutable();

drop trigger if exists eventos_bot_historial_sin_truncate on public.eventos_bot_historial;
create trigger eventos_bot_historial_sin_truncate before truncate on public.eventos_bot_historial
    for each statement execute function public.eventos_bot_historial_inmutable();

drop trigger if exists eventos_bot_historial_fecha on public.eventos_bot_historial;
create trigger eventos_bot_historial_fecha before insert on public.eventos_bot_historial
    for each row execute function public.eventos_bot_historial_fecha();

alter table public.eventos_bot_historial enable row level security;

revoke all on table public.eventos_bot_historial from public, anon, authenticated;
grant select on table public.eventos_bot_historial to authenticated;
grant select, insert on table public.eventos_bot_historial to service_role;
revoke update, delete, truncate on table public.eventos_bot_historial from service_role;

drop policy if exists "clientes leen su propio historial de eventos" on public.eventos_bot_historial;
create policy "clientes leen su propio historial de eventos" on public.eventos_bot_historial
    for select to authenticated using ((select auth.uid()) = usuario_id);

commit;

-- Verificación (solo lectura):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'eventos_bot_historial' order by 1, 2;
--   Esperado: authenticated -> SELECT; service_role -> INSERT, SELECT; anon -> nada.
--
-- Reversión (pierde el historial):
--   begin; drop table if exists public.eventos_bot_historial; commit;
