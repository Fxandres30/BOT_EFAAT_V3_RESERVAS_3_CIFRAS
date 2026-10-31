-- ==========================================================================
-- PARTE B (NO APLICADA, NO ES UNA MIGRACIÓN) — compradores_semanales.
--
--   B1  RETIRADA (2026-10-31): los pagos sin teléfono se corrigen con la
--       migración oficial backend/supabase_migrations/041_pagos_sin_whatsapp.sql
--       (si B1 se hubiera aplicado a mano, la 041 la retira).
--   B2  Cerrar la lectura: hoy anon (sin sesión) lee las 1929 filas (nombre +
--       WhatsApp) y cualquier usuario del panel también. Requiere la Parte A
--       aplicada antes.
--
-- Probado en Postgres real en memoria:
--   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
--       node backend/tests/sorteos/parteBCompradores.test.js
--
-- Hechos verificados (2026-10-14, solo lectura):
--   - compradores_semanales: id integer, nombre text NOT NULL, whatsapp text
--     NOT NULL, contadores por día, total_semanal, entregados_3cifras.
--   - El trigger heredado corre con el rol de quien paga (security invoker):
--     en 2026-09 falló con "permission denied" para service_role (ver 016).
--   - Ningún código de este repositorio lee ni escribe la tabla.
-- ==========================================================================

-- ==========================================================================
-- ANTES (solo lectura, en el SQL Editor). Guarda el resultado completo: es
-- la vuelta atrás exacta de B2.
--
--   -- 1) triggers de las tablas de reservas y su función
--   select c.relname as tabla, t.tgname as trigger, p.oid::regprocedure as funcion,
--          pg_get_userbyid(p.proowner) as dueno, p.prosecdef as security_definer,
--          p.proconfig as config, pg_get_triggerdef(t.oid) as definicion_trigger
--   from pg_trigger t
--   join pg_class c on c.oid = t.tgrelid
--   join pg_proc p on p.oid = t.tgfoid
--   where c.relnamespace = 'public'::regnamespace
--     and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'compradores_semanales')
--     and not t.tgisinternal;
--
--   -- 2) cuerpo de toda función que mencione la tabla
--   select p.oid::regprocedure, pg_get_functiondef(p.oid)
--   from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%compradores_semanales%';
--
--   -- 3) privilegios actuales sobre la tabla
--   select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'compradores_semanales'
--   group by 1;
--
-- Si la consulta 1 muestra que el trigger es BEFORE y modifica NEW, o la 2
-- muestra que la función escribe whatsapp con UPDATE (no INSERT), avísame
-- antes de aplicar la 041: está pensada para un INSERT/UPSERT.
-- ==========================================================================


-- ==========================================================================
-- B1 RETIRADA: ahora es la migración oficial
-- backend/supabase_migrations/041_pagos_sin_whatsapp.sql.
-- ==========================================================================



-- ==========================================================================
-- B2 — cerrar compradores_semanales al navegador. Una sola transacción.
-- APLICAR SOLO DESPUÉS DE LA PARTE A (con la Parte A, anon ya no puede
-- marcar pagos, así que el trigger nunca corre como anon).
-- Revisada en la auditoría integral (2026-10-22, §2f).
--
-- Problema: el trigger heredado corre con el rol de quien modifica la
-- reserva. Pagar y liberar ya van por el backend (service_role), pero el
-- panel todavía actualiza SUS filas al reiniciar la tabla (reiniciarTabla).
-- Si la función heredada escribe en compradores_semanales en ese caso y se le
-- quitan los permisos a authenticated, el reinicio FALLARÍA. Por eso, antes
-- de quitar permisos, la función heredada pasa a SECURITY DEFINER (corre con
-- los permisos de su dueño). NO se cambia su código.
--
-- El código real de esa función NO está en el repositorio. Para no modificar
-- a ciegas una versión distinta de la revisada:
--   md5_cuerpo = md5(prosrc), leído en producción con el diagnóstico
--   (validacion_final_aislamiento_solo_lectura.sql, bloque
--   "B_funcion_heredada") el 2026-10-22: cceca089f72b33a12832eaf6c9f438c5.
--   Ya está puesto abajo. Si el cuerpo cambió desde entonces, B2 aborta sin
--   tocar nada. B2 NO cambia el código: solo SECURITY DEFINER y search_path.
--
-- Guardias (si alguna falla, se revierte todo y no cambia nada):
--   - EXACTAMENTE UNA función de trigger de las tablas de reservas menciona
--     compradores_semanales, y su md5(prosrc) es el revisado;
--   - su dueño puede leer/insertar/actualizar compradores_semanales;
--   - su dueño es el dueño de compradores_semanales o salta la RLS (la 034
--     activa la RLS sin políticas: otro dueño dejaría de ver filas);
--   - compradores_semanales sin RLS forzada.
-- Registra el estado previo (prosecdef, proconfig, ACL) en
-- efaat_admin.cambios_seguridad: es la base de la vuelta atrás.
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

do $$
declare
    n integer;
    f regprocedure;
    dueno name;
    v_md5 text;
    -- md5(prosrc) de actualizar_compradores_semanales() en PRODUCCIÓN,
    -- leído por el dueño con el diagnóstico (2026-10-22).
    v_esperado text := 'cceca089f72b33a12832eaf6c9f438c5';
    v_tabla_dueno oid;
begin

    if to_regclass('public.compradores_semanales') is null then
        raise exception 'B2 abortado: no existe compradores_semanales';
    end if;

    select count(distinct p.oid) into n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
      and not t.tgisinternal
      and p.prosrc ilike '%compradores_semanales%';

    if n <> 1 then
        raise exception 'B2 abortado: se esperaba 1 función de trigger que escriba en compradores_semanales y hay %. Revisar a mano.', n;
    end if;

    select distinct p.oid::regprocedure, pg_get_userbyid(p.proowner), md5(p.prosrc)
      into f, dueno, v_md5
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
      and not t.tgisinternal
      and p.prosrc ilike '%compradores_semanales%';

    if v_esperado !~ '^[0-9a-f]{32}$' then
        raise exception 'B2 abortado: el md5 esperado no es válido (%)', v_esperado;
    end if;
    if v_md5 <> v_esperado then
        raise exception 'B2 abortado: el cuerpo de % no es el revisado (md5 actual %, esperado %). Revisar su código de nuevo.', f, v_md5, v_esperado;
    end if;

    -- Con varios privilegios en una sola llamada, has_table_privilege da
    -- true si tiene CUALQUIERA: se comprueban uno por uno.
    if not (has_table_privilege(dueno, 'public.compradores_semanales', 'SELECT')
            and has_table_privilege(dueno, 'public.compradores_semanales', 'INSERT')
            and has_table_privilege(dueno, 'public.compradores_semanales', 'UPDATE')) then
        raise exception 'B2 abortado: el dueño (%) de % no tiene permisos sobre compradores_semanales.', dueno, f;
    end if;

    select relowner into v_tabla_dueno from pg_class where oid = 'public.compradores_semanales'::regclass;
    if (select relforcerowsecurity from pg_class where oid = 'public.compradores_semanales'::regclass) then
        raise exception 'B2 abortado: compradores_semanales tiene RLS forzada';
    end if;
    if (select oid from pg_roles where rolname = dueno) <> v_tabla_dueno
       and not coalesce((select rolbypassrls or rolsuper from pg_roles where rolname = dueno), false) then
        raise exception 'B2 abortado: el dueño (%) de % no es el de compradores_semanales ni salta la RLS: con la 034 dejaría de ver filas.', dueno, f;
    end if;

    insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
    select 'parte_b2', f::text, 'estado_previo', jsonb_build_object(
        'md5_cuerpo', v_md5, 'dueno', dueno, 'security_definer', p.prosecdef,
        'proconfig', to_jsonb(p.proconfig), 'acl_funcion', coalesce(p.proacl::text, '(por defecto)'),
        'acl_tabla', coalesce((select relacl::text from pg_class where oid = 'public.compradores_semanales'::regclass), '(por defecto)'))
    from pg_proc p where p.oid = f;

    raise notice 'B2: % (dueño %) pasa a SECURITY DEFINER', f, dueno;

    execute format('alter function %s security definer', f);
    execute format('alter function %s set search_path = public, extensions, pg_temp', f);

end $$;

revoke all on table public.compradores_semanales from anon, authenticated, public;

do $$
declare
    seq text;
begin
    seq := pg_get_serial_sequence('public.compradores_semanales', 'id');
    if seq is not null then
        execute format('revoke all on sequence %s from anon, authenticated, public', seq);
    end if;

    if has_table_privilege('anon', 'public.compradores_semanales', 'SELECT, INSERT, UPDATE, DELETE')
       or has_table_privilege('authenticated', 'public.compradores_semanales', 'SELECT, INSERT, UPDATE, DELETE') then
        raise exception 'B2 abortado: anon o authenticated conservan acceso a compradores_semanales (¿heredan de otro rol?)';
    end if;
    if not (has_table_privilege('service_role', 'public.compradores_semanales', 'SELECT')
            and has_table_privilege('service_role', 'public.compradores_semanales', 'INSERT')
            and has_table_privilege('service_role', 'public.compradores_semanales', 'UPDATE')) then
        raise exception 'B2 abortado: service_role perdería compradores_semanales (el pago por sticker fallaría). Aplicar antes la 016.';
    end if;
end $$;

commit;

-- DESPUÉS (B2):
--   - Con la clave anon y sin sesión: GET /rest/v1/compradores_semanales -> 401/403.
--   - Reiniciar una tabla de prueba desde el panel y pagar un número de
--     prueba (backend) funcionan igual que antes.
--   - Pago por sticker (bot, service_role): igual que antes.
--   - select objeto, detalle from efaat_admin.cambios_seguridad where paso = 'parte_b2';
--
-- VUELTA ATRÁS (B2), sin volver a abrir la tabla:
--   - Si el pago o el reinicio fallan por la ruta de búsqueda, restaurar la
--     configuración guardada (proconfig del estado_previo; si era nula):
--       alter function <funcion> reset search_path;
--   - NO volver a SECURITY INVOKER mientras la tabla esté cerrada (el panel
--     no podría escribir y el reinicio fallaría) y NUNCA conceder la tabla a
--     anon o a PUBLIC. Si de verdad hiciera falta volver a invoker, antes la
--     034 (RLS) y después, como mucho:
--       grant select, insert, update on public.compradores_semanales to authenticated;
--     sabiendo que con RLS sin políticas el panel no verá filas.
-- ==========================================================================
