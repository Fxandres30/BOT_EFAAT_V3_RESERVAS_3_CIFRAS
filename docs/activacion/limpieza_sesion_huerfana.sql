-- ==========================================================================
-- LIMPIEZA DE LA SESIÓN HUÉRFANA (NO APLICADA). Preparada el 2026-10-22.
--
-- Hallazgo (producción 2026-10-22, lectura por la API): 1 fila de sesiones
-- cuyo usuario_id (empieza por 8b31d700) ya NO existe en auth.users. Está
-- desconectada, no activa y no principal. Ningún sorteo ni reserva es suyo.
-- Bloquea la Parte A (guardia G2): tras la RLS nadie podría verla ni
-- borrarla desde el panel, y el bot la seguiría restaurando al arrancar.
--
-- Qué hace (una transacción; aborta si algo no coincide):
--   1. Comprueba que hay EXACTAMENTE 1 sesión de una cuenta inexistente, que
--      está desconectada, no activa ni principal, y que ningún sorteo,
--      reserva o programación la usa.
--   2. Copia la fila completa a efaat_admin.sesiones_archivadas (incluido el
--      QR caducado y el teléfono: quedan fuera de la API, solo para revertir).
--   3. La borra. sesiones_lease se borra en cascada (004); event_sessions
--      queda con session_id NULL (006, on delete set null).
--
-- DESPUÉS, en el VPS (🔐, aparte): pm2 logs no debe mostrar intentos de
-- restaurar esa sesión. La carpeta backend/auth/<id> de esa sesión se puede
-- archivar (no borrar) cuando se confirme.
--
-- Sustituir <ID_SESION> por el id completo (sale de la consulta de abajo).
-- Consulta previa (solo lectura):
--   select s.id, s.estado, s.activa, s.principal
--   from public.sesiones s
--   where s.usuario_id is not null and not exists (select 1 from auth.users u where u.id = s.usuario_id);
-- ==========================================================================

begin;

create schema if not exists efaat_admin;
revoke all on schema efaat_admin from public, anon, authenticated;
create table if not exists efaat_admin.sesiones_archivadas (
    archivada_en timestamptz not null default now(),
    motivo text not null,
    fila jsonb not null
);
revoke all on table efaat_admin.sesiones_archivadas from public, anon, authenticated;

do $$
declare
    v_id text := '<ID_SESION>';
    n integer;
    s record;
begin
    select count(*) into n from public.sesiones x
    where x.usuario_id is not null and not exists (select 1 from auth.users u where u.id = x.usuario_id);
    if n <> 1 then
        raise exception 'Limpieza abortada: se esperaba 1 sesión huérfana y hay %', n;
    end if;

    select * into s from public.sesiones x
    where x.id::text = v_id
      and x.usuario_id is not null and not exists (select 1 from auth.users u where u.id = x.usuario_id);
    if not found then
        raise exception 'Limpieza abortada: % no es la sesión huérfana', v_id;
    end if;

    if s.activa is true or s.principal is true or s.estado = 'conectado' then
        raise exception 'Limpieza abortada: la sesión está activa, principal o conectada';
    end if;

    if exists (select 1 from public.eventos_bot e where e.usuario_id = s.usuario_id)
       or exists (select 1 from public.reservas_dos_cifras r where r.usuario_id = s.usuario_id)
       or exists (select 1 from public."5k_15k_reservas_2_cifras" r where r.usuario_id = s.usuario_id) then
        raise exception 'Limpieza abortada: hay sorteos o reservas de esa cuenta';
    end if;

    insert into efaat_admin.sesiones_archivadas (motivo, fila)
    values ('cuenta eliminada de auth.users', to_jsonb(s));

    delete from public.sesiones x where x.id = s.id;
    raise notice 'Sesión huérfana archivada y eliminada';
end $$;

commit;

-- REVERSIÓN (restaura la fila tal cual; la cuenta seguirá sin existir):
--   insert into public.sesiones
--   select (jsonb_populate_record(null::public.sesiones, fila)).*
--   from efaat_admin.sesiones_archivadas where motivo = 'cuenta eliminada de auth.users';
-- ==========================================================================
