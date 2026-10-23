-- ==========================================================================
-- LIMPIEZA DE LA SESIÓN HUÉRFANA (NO APLICADA). Preparada el 2026-10-22,
-- revisada en la auditoría integral (§2f).
--
-- Hallazgo (producción 2026-10-22, lectura por la API): 1 fila de sesiones
-- cuyo usuario_id (empieza por 8b31d700) ya NO existe en auth.users. Está
-- desconectada, no activa y no principal. Ningún sorteo ni reserva es suyo.
-- Bloquea la Parte A (guardia G2): tras la RLS nadie podría verla ni
-- borrarla desde el panel, y el bot la seguiría restaurando al arrancar.
--
-- ¿Es segura? Solo si TODAS estas comprobaciones pasan (si una falla, aborta
-- y no cambia nada):
--   1. Hay EXACTAMENTE 1 sesión de una cuenta inexistente y es <ID_SESION>.
--   2. Está desconectada, no activa, no principal y no preferida (la fila se
--      bloquea FOR UPDATE: el bot no puede cambiarla mientras tanto).
--   3. Ninguna fila de NINGUNA tabla la referencia, salvo su lease:
--        - claves foráneas hacia sesiones (se buscan en el catálogo, no se
--          suponen): event_sessions (006, on delete set null) y cualquier
--          otra; si alguna tiene filas, ABORTA (un "set null" o un "cascade"
--          cambiaría datos sin que nadie lo vea);
--        - columnas session_id / sesion_id / sesion de cualquier tabla de
--          public sin clave foránea (p. ej. inactividad_* de la 022);
--        - sorteos o reservas de esa cuenta.
--   4. Las filas de otras tablas de esa cuenta inexistente se CUENTAN y se
--      registran (no se tocan): no bloquean, porque nadie las ve hoy ni las
--      verá después.
-- Qué hace entonces:
--   - copia la sesión y su lease a efaat_admin.sesiones_archivadas (con QR
--     caducado y teléfono: quedan fuera de la API, solo para revertir);
--   - borra el lease y la sesión, y lo registra en cambios_seguridad.
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

set local lock_timeout = '5s';

-- >>> efaat_admin (bloque común: idéntico en todas las piezas) >>>
-- Registro de lo que cada pieza elimina o concede (respaldo para revertir).
-- Esquema fuera de la API: PostgREST solo publica "public". Nadie salvo el
-- dueño (postgres) lo usa: ni anon, ni authenticated, ni service_role.
create schema if not exists efaat_admin;
revoke all on schema efaat_admin from public, anon, authenticated, service_role;
create table if not exists efaat_admin.cambios_seguridad (
    id bigserial primary key,
    paso text not null,
    objeto text not null,
    accion text not null,
    detalle jsonb,
    en timestamptz not null default now()
);
alter table efaat_admin.cambios_seguridad enable row level security;
revoke all on table efaat_admin.cambios_seguridad from public, anon, authenticated, service_role;
do $$
declare
    seq text := pg_get_serial_sequence('efaat_admin.cambios_seguridad', 'id');
    r text;
begin
    if (select nspowner from pg_namespace where nspname = 'efaat_admin') <> (select oid from pg_roles where rolname = current_user) then
        raise exception 'efaat_admin pertenece a otro rol: revisarlo antes de seguir';
    end if;
    if seq is not null then
        execute format('revoke all on sequence %s from public, anon, authenticated, service_role', seq);
    end if;
    if exists (select 1 from pg_roles x cross join lateral unnest(coalesce(x.rolconfig, '{}'::text[])) c
               where x.rolname = 'authenticator' and c ilike 'pgrst.db_schemas=%efaat_admin%') then
        raise exception 'efaat_admin está expuesto por la API (pgrst.db_schemas): quitarlo antes de seguir';
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
        if has_schema_privilege(r, 'efaat_admin', 'USAGE')
           or has_table_privilege(r, 'efaat_admin.cambios_seguridad', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
            raise exception 'efaat_admin.cambios_seguridad accesible para %', r;
        end if;
    end loop;
end $$;
-- <<< efaat_admin <<<

create table if not exists efaat_admin.sesiones_archivadas (
    archivada_en timestamptz not null default now(),
    motivo text not null,
    fila jsonb not null
);
alter table efaat_admin.sesiones_archivadas add column if not exists sesion_id text;
alter table efaat_admin.sesiones_archivadas add column if not exists lease jsonb;
alter table efaat_admin.sesiones_archivadas enable row level security;
revoke all on table efaat_admin.sesiones_archivadas from public, anon, authenticated, service_role;

do $$
declare
    v_id text := '<ID_SESION>';
    n bigint;
    s record;
    v_lease jsonb;
    ref record;
    refs text := '';
    otras jsonb := '{}'::jsonb;
begin
    select count(*) into n from public.sesiones x
    where x.usuario_id is not null and not exists (select 1 from auth.users u where u.id = x.usuario_id);
    if n <> 1 then
        raise exception 'Limpieza abortada: se esperaba 1 sesión huérfana y hay %', n;
    end if;

    select * into s from public.sesiones x
    where x.id::text = v_id
      and x.usuario_id is not null and not exists (select 1 from auth.users u where u.id = x.usuario_id)
    for update;
    if not found then
        raise exception 'Limpieza abortada: % no es la sesión huérfana', v_id;
    end if;

    if (to_jsonb(s)->>'activa')::boolean is true or (to_jsonb(s)->>'principal')::boolean is true
       or (to_jsonb(s)->>'preferida')::boolean is true or to_jsonb(s)->>'estado' is distinct from 'desconectado' then
        raise exception 'Limpieza abortada: la sesión no está desconectada, o está activa, principal o preferida';
    end if;

    if exists (select 1 from public.eventos_bot e where e.usuario_id = s.usuario_id)
       or exists (select 1 from public.reservas_dos_cifras r where r.usuario_id = s.usuario_id)
       or exists (select 1 from public."5k_15k_reservas_2_cifras" r where r.usuario_id = s.usuario_id) then
        raise exception 'Limpieza abortada: hay sorteos o reservas de esa cuenta';
    end if;

    -- Claves foráneas hacia sesiones (todas, del catálogo), salvo el lease.
    for ref in
        select c.conrelid::regclass::text as tabla, a.attname as columna, c.confdeltype as al_borrar
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confrelid = 'public.sesiones'::regclass and array_length(c.conkey, 1) = 1
          and c.conrelid <> coalesce(to_regclass('public.sesiones_lease')::oid, 0::oid)
    loop
        execute format('select count(*) from %s where %I::text = $1', ref.tabla, ref.columna) into n using v_id;
        if n > 0 then
            refs := refs || format(' %s.%s: %s (al borrar: %s);', ref.tabla, ref.columna, n, ref.al_borrar);
        end if;
    end loop;
    if exists (select 1 from pg_constraint c where c.contype = 'f' and c.confrelid = 'public.sesiones'::regclass
               and array_length(c.conkey, 1) > 1) then
        refs := refs || ' clave foránea compuesta hacia sesiones (revisar a mano);';
    end if;

    -- Columnas de sesión sin clave foránea.
    for ref in
        select cl.oid::regclass::text as tabla, a.attname as columna
        from pg_attribute a
        join pg_class cl on cl.oid = a.attrelid
        where cl.relnamespace = 'public'::regnamespace and cl.relkind in ('r', 'p')
          and a.attnum > 0 and not a.attisdropped
          and a.attname in ('session_id', 'sesion_id', 'sesion')
          and cl.oid <> coalesce(to_regclass('public.sesiones_lease')::oid, 0::oid)
          and not exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = cl.oid
                          and c.confrelid = 'public.sesiones'::regclass and a.attnum = any (c.conkey))
    loop
        execute format('select count(*) from %s where %I::text = $1', ref.tabla, ref.columna) into n using v_id;
        if n > 0 then
            refs := refs || format(' %s.%s: %s;', ref.tabla, ref.columna, n);
        end if;
    end loop;

    if refs <> '' then
        raise exception 'Limpieza abortada: la sesión sigue referenciada:%', refs;
    end if;

    -- Otras filas de la cuenta inexistente (solo se registran).
    for ref in
        select cl.oid::regclass::text as tabla
        from pg_attribute a join pg_class cl on cl.oid = a.attrelid
        where cl.relnamespace = 'public'::regnamespace and cl.relkind in ('r', 'p')
          and a.attname = 'usuario_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped
          and cl.relname <> 'sesiones'
    loop
        execute format('select count(*) from %s where usuario_id = $1', ref.tabla) into n using s.usuario_id;
        if n > 0 then
            otras := otras || jsonb_build_object(ref.tabla, n);
        end if;
    end loop;

    if to_regclass('public.sesiones_lease') is not null then
        execute 'select jsonb_agg(to_jsonb(l)) from public.sesiones_lease l where l.session_id::text = $1' into v_lease using v_id;
        execute 'delete from public.sesiones_lease where session_id::text = $1' using v_id;
    end if;

    insert into efaat_admin.sesiones_archivadas (motivo, fila, sesion_id, lease)
    values ('cuenta eliminada de auth.users', to_jsonb(s), v_id, v_lease);

    delete from public.sesiones x where x.id = s.id;
    get diagnostics n = row_count;
    if n <> 1 then
        raise exception 'Limpieza abortada: se esperaba borrar 1 sesión y se borraron %', n;
    end if;

    insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
    values ('limpieza_sesion_huerfana', 'sesiones', 'sesion_archivada_y_borrada',
            jsonb_build_object('sesion_id', v_id, 'lease_archivado', v_lease is not null,
                               'otras_filas_de_la_cuenta', otras));
    raise notice 'Sesión huérfana archivada y eliminada. Otras filas de esa cuenta (sin tocar): %', otras;
end $$;

commit;

-- REVERSIÓN (restaura la sesión y su lease tal cual; la cuenta seguirá sin
-- existir y la Parte A volverá a abortar por ella):
--   begin;
--   insert into public.sesiones
--   select (jsonb_populate_record(null::public.sesiones, fila)).*
--   from efaat_admin.sesiones_archivadas where sesion_id = '<ID_SESION>';
--   insert into public.sesiones_lease
--   select (jsonb_populate_record(null::public.sesiones_lease, l)).*
--   from efaat_admin.sesiones_archivadas a, jsonb_array_elements(a.lease) l
--   where a.sesion_id = '<ID_SESION>' and a.lease is not null;
--   commit;
-- ==========================================================================
