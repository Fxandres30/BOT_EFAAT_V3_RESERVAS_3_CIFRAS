-- ==========================================================================
-- 035 — RED DE SEGURIDAD RLS: tablas de cliente y tablas solo del backend
--
-- PREPARADA EL 2026-10-22. NO APLICADA. Requiere autorización expresa.
-- Revisada en la auditoría integral (2026-10-22, §2f).
--
-- Por qué: las migraciones del repositorio crean RLS por propietario en la
-- mayoría de tablas de cliente, pero producción no coincide con el
-- repositorio (p. ej. la 001 no está: falta configuracion_mensajes; hay
-- tablas que ya no crea ninguna migración, como
-- loterias_calendario_inicializado). Esta migración NO supone qué está
-- aplicado: revisa cada tabla en el catálogo y solo completa lo que falta.
--
-- A) TABLAS DE CLIENTE (columna usuario_id uuid). Para cada una que exista:
--    - activa RLS si estaba desactivada;
--    - clasifica cada política existente (cualquier nombre):
--        · solo service_role: se conserva;
--        · ABIERTA (condición vacía o "true") o solo para anon: se elimina y
--          su definición queda en efaat_admin.cambios_seguridad;
--        · de PROPIETARIO (usuario_id = auth.uid(); en lectura de
--          automation_messages también "usuario_id is null or …", los
--          mensajes globales): se conserva;
--        · RESTRICTIVA o con CUALQUIER OTRA condición: ABORTA y la nombra.
--          Antes se conservaba toda política "con condición": una como
--          "using (usuario_id is not null)" habría dejado a cada cliente
--          leer lo de todos;
--    - crea, solo si falta una política de propietario para esa operación,
--      la política «propietario» de lectura (siempre) y de alta/modificación/
--      borrado SOLO para las operaciones que el panel hace en esa tabla
--      (revisado en frontend/ el 2026-10-22). Nada más;
--    - quita todo a anon y PUBLIC (tabla, columnas y secuencias) y TRUNCATE/
--      REFERENCES/TRIGGER a authenticated (TRUNCATE no pasa por la RLS);
--      authenticated y service_role conservan lo demás que tenían (si les
--      venía de PUBLIC, se concede explícito).
--    Guardia: si una tabla que el panel LEE dejaba ver filas con usuario_id
--    NULL (sin RLS o con una política abierta) y no son globales por diseño,
--    ABORTA (el panel dejaría de verlas).
--
-- B) TABLAS SOLO DEL BACKEND sin propietario: usuarios (identidades), grupos
--    (metadatos por jid) y sesiones_lease (004). Solo las usa el backend con
--    service_role; el aislamiento por cliente lo dan contactos_tenant y
--    grupos_autorizados. RLS activada sin políticas y sin permisos para
--    anon/authenticated/PUBLIC.
--
-- NO TOCA: catálogos globales (loterias_catalogo_global), analítica (020),
-- tablas de la Parte A (reservas, eventos_bot, sesiones), chats (029),
-- compradores_semanales (034), tablas heredadas sin dueño (Parte C: las
-- reservas_2_cifras_* estaban antes en las dos listas y, sin usuario_id,
-- esta migración habría abortado).
-- Pruebas: backend/tests/seguridad/aislamientoMulticliente.test.js y
-- backend/tests/seguridad/auditoriaIntegral.test.js
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

-- Clasificación de condiciones de políticas (solo durante esta sesión;
-- idéntica a la de la Parte A).
create or replace function pg_temp.efaat_norm(c text) returns text
language sql immutable as $$
    select regexp_replace(replace(lower(coalesce(c, '')), '( select auth.uid() as uid)', 'auth.uid()'), '[\s()]', '', 'g')
$$;

-- 'abierta' | 'propietario' | 'otra'
create or replace function pg_temp.efaat_clase_politica(p_cmd text, p_using text, p_check text, p_globales boolean)
returns text language sql immutable as $$
    with e as (
        select case when p_cmd = 'INSERT' then null else pg_temp.efaat_norm(p_using) end as u,
               case when p_cmd in ('SELECT', 'DELETE') then null
                    when p_cmd = 'INSERT' then pg_temp.efaat_norm(p_check)
                    else pg_temp.efaat_norm(coalesce(p_check, p_using)) end as c
    ), clases as (
        select x,
               case
                   when x in ('', 'true') then 'abierta'
                   when x in ('usuario_id=auth.uid', 'auth.uid=usuario_id') then 'propietario'
                   -- Filas globales (usuario_id NULL) solo en LECTURA: en una
                   -- escritura dejarían a un cliente crear filas que ven todos.
                   when p_globales and p_cmd = 'SELECT'
                        and x in ('usuario_idisnullorusuario_id=auth.uid', 'usuario_idisnullorauth.uid=usuario_id',
                                  'usuario_id=auth.uidorusuario_idisnull', 'auth.uid=usuario_idorusuario_idisnull')
                        then 'propietario'
                   else 'otra'
               end as clase
        from e cross join lateral (values (e.u), (e.c)) v(x)
        where x is not null
    )
    select case
               when bool_or(clase = 'abierta') then 'abierta'
               when bool_and(clase = 'propietario') then 'propietario'
               else 'otra'
           end
    from clases
$$;

-- tabla | operaciones que hace el panel (además de leer) | filas globales con usuario_id NULL
create temporary table t035 (tabla text primary key, ops text[] not null, globales_nulos boolean not null default false) on commit drop;
insert into t035 values
    -- usadas por el panel
    ('automation_actions',               '{}', false),
    ('automation_configs',               '{INSERT,UPDATE}', false),
    ('automation_messages',              '{INSERT,UPDATE,DELETE}', true),
    ('configuracion_mensajes',           '{INSERT,UPDATE}', false),
    ('configuracion_seleccion_mensajes', '{INSERT,UPDATE}', false),
    ('configuracion_stickers_pago',      '{INSERT,UPDATE}', false),
    ('contactos_tenant',                 '{}', false),
    ('event_sessions',                   '{}', false),
    ('grupos_autorizados',               '{INSERT,UPDATE}', false),
    ('plantillas_mensaje',               '{INSERT,UPDATE}', false),
    ('reservas_actividad',               '{INSERT}', false),
    ('tabla_configuracion_visual',       '{INSERT,UPDATE}', false),
    ('tabla_disenos',                    '{INSERT,UPDATE,DELETE}', false),
    ('tablas_cliente',                   '{INSERT,UPDATE,DELETE}', false),
    ('variables_globales',               '{INSERT,UPDATE,DELETE}', false),
    -- solo backend (el panel no las usa): lectura propia y nada más
    ('automation_message_uses',          '{}', false),
    ('bloqueados',                       '{}', false),
    ('bloqueo_intentos',                 '{}', false),
    ('cuentas_pago',                     '{}', false),
    ('inactividad_ejecuciones',          '{}', false),
    ('inactividad_evaluaciones',         '{}', false),
    ('inactividad_miembros',             '{}', false),
    ('loterias_catalogo',                '{}', false),
    ('loterias_catalogo_ofrecidas',      '{}', false),
    ('loterias_calendario_inicializado', '{}', false),
    ('pagos_dispositivos',               '{}', false),
    ('pagos_movimientos',                '{}', false),
    ('plantillas_sorteo',                '{}', false),
    ('reservas_archivo',                 '{}', false),
    ('reservas_auditoria',               '{}', false),
    ('sorteos_programados',              '{}', false),
    ('sorteos_programados_grupos',       '{}', false);

-- tablas del panel (las de arriba con lectura desde el navegador)
create temporary table t035_panel (tabla text primary key) on commit drop;
insert into t035_panel values
    ('automation_actions'), ('automation_configs'), ('automation_messages'), ('configuracion_mensajes'),
    ('configuracion_seleccion_mensajes'), ('configuracion_stickers_pago'), ('contactos_tenant'),
    ('event_sessions'), ('grupos_autorizados'), ('plantillas_mensaje'), ('reservas_actividad'),
    ('tabla_configuracion_visual'), ('tabla_disenos'), ('tablas_cliente'), ('variables_globales');

-- Política existente -> qué hacer con ella.
create temporary view v035_politicas as
select p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check,
       case
           when p.roles = array['service_role']::name[] then 'conservar'
           when p.permissive <> 'PERMISSIVE' then 'abortar'
           when pg_temp.efaat_clase_politica(p.cmd, p.qual, p.with_check, t.globales_nulos) = 'abierta' then 'eliminar'
           when p.roles <@ array['anon']::name[] then 'eliminar'
           when pg_temp.efaat_clase_politica(p.cmd, p.qual, p.with_check, t.globales_nulos) = 'propietario' then 'conservar'
           else 'abortar'
       end as decision
from pg_policies p
join t035 t on t.tabla = p.tablename
where p.schemaname = 'public';

-- ------------------------------------------------------------ guardias ---
do $$
declare
    r record;
    rel regclass;
    n bigint;
    problemas text := '';
    ajenas text;
begin
    for r in select * from t035 order by tabla loop
        rel := to_regclass(format('public.%I', r.tabla));
        continue when rel is null;

        if not exists (select 1 from pg_attribute where attrelid = rel and attname = 'usuario_id'
                       and atttypid = 'uuid'::regtype and not attisdropped) then
            problemas := problemas || format(' %s: usuario_id no es uuid;', r.tabla);
            continue;
        end if;

        if (select relforcerowsecurity from pg_class where oid = rel) then
            problemas := problemas || format(' %s: RLS forzada;', r.tabla);
        end if;

        -- Filas sin dueño que el panel ve HOY (sin RLS o por una política
        -- abierta de lectura) y que dejaría de ver.
        if exists (select 1 from t035_panel p where p.tabla = r.tabla)
           and not r.globales_nulos
           and (not (select relrowsecurity from pg_class where oid = rel)
                or exists (select 1 from v035_politicas v where v.tablename = r.tabla and v.decision = 'eliminar'
                           and v.cmd in ('SELECT', 'ALL'))) then
            execute format('select count(*) from public.%I where usuario_id is null', r.tabla) into n;
            if n > 0 then
                problemas := problemas || format(' %s: %s filas sin dueño que el panel dejaría de ver;', r.tabla, n);
            end if;
        end if;
    end loop;

    select string_agg(format('%s."%s" (%s, %s, roles %s, using %s, check %s)', tablename, policyname, cmd, permissive,
                             array_to_string(roles, ','), coalesce(qual, '-'), coalesce(with_check, '-')), '; ')
      into ajenas
    from v035_politicas where decision = 'abortar';
    if ajenas is not null then
        problemas := problemas || format(' políticas no reconocidas (ni abiertas ni de propietario): %s;', ajenas);
    end if;

    if problemas <> '' then
        raise exception '035 abortada:%', problemas;
    end if;
end $$;

-- -------------------------------------------------- A) tablas de cliente ---
do $$
declare
    r record;
    rel regclass;
    p record;
    op text;
    priv text;
    rol text;
    antes jsonb;
    tenia_rls boolean;
    cond text;
    col record;
    s record;
begin
    for r in select * from t035 order by tabla loop

        rel := to_regclass(format('public.%I', r.tabla));
        if rel is null then
            raise notice '035: % no existe, se omite', r.tabla;
            continue;
        end if;

        execute format('lock table public.%I in share row exclusive mode', r.tabla);

        select relrowsecurity into tenia_rls from pg_class where oid = rel;

        select jsonb_object_agg(x.rol, jsonb_build_object(
                   'SELECT', has_table_privilege(x.rol, rel, 'SELECT'),
                   'INSERT', has_table_privilege(x.rol, rel, 'INSERT'),
                   'UPDATE', has_table_privilege(x.rol, rel, 'UPDATE'),
                   'DELETE', has_table_privilege(x.rol, rel, 'DELETE'),
                   'TRUNCATE', has_table_privilege(x.rol, rel, 'TRUNCATE')))
          into antes
        from (values ('anon'), ('authenticated'), ('service_role')) x(rol);

        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        values ('035', r.tabla, 'estado_previo', jsonb_build_object(
            'rls', tenia_rls,
            'acl', coalesce((select relacl::text from pg_class where oid = rel), '(por defecto)'),
            'efectivos', antes,
            'politicas', (select coalesce(jsonb_agg(jsonb_build_object('politica', policyname, 'permisiva', permissive,
                                                     'roles', roles, 'cmd', cmd, 'using', qual, 'check', with_check)), '[]'::jsonb)
                          from pg_policies where schemaname = 'public' and tablename = r.tabla)));

        for p in select * from v035_politicas where tablename = r.tabla and decision = 'eliminar' loop
            insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
            values ('035', r.tabla, 'politica_abierta_eliminada',
                    jsonb_build_object('politica', p.policyname, 'roles', p.roles, 'cmd', p.cmd, 'using', p.qual, 'check', p.with_check));
            execute format('drop policy %I on public.%I', p.policyname, r.tabla);
            raise notice '035: eliminada la política abierta %.%', r.tabla, p.policyname;
        end loop;

        if not tenia_rls then
            execute format('alter table public.%I enable row level security', r.tabla);
        end if;

        cond := case when r.globales_nulos then '(usuario_id is null or usuario_id = auth.uid())' else '(usuario_id = auth.uid())' end;

        foreach op in array array['SELECT'] || r.ops loop
            if not exists (select 1 from v035_politicas v
                           where v.tablename = r.tabla and v.decision = 'conservar'
                             and v.cmd in (op, 'ALL')
                             and v.roles && array['public', 'authenticated']::name[]) then
                execute case op
                    when 'SELECT' then format('create policy %I on public.%I for select to authenticated using %s',
                                              'efaat propietario lee', r.tabla, cond)
                    when 'INSERT' then format('create policy %I on public.%I for insert to authenticated with check (usuario_id = auth.uid())',
                                              'efaat propietario crea', r.tabla)
                    when 'UPDATE' then format('create policy %I on public.%I for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())',
                                              'efaat propietario modifica', r.tabla)
                    when 'DELETE' then format('create policy %I on public.%I for delete to authenticated using (usuario_id = auth.uid())',
                                              'efaat propietario borra', r.tabla)
                end;
                insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
                values ('035', r.tabla, 'politica_creada', jsonb_build_object('cmd', op));
            end if;
        end loop;

        execute format('revoke all on table public.%I from anon, public', r.tabla);
        execute format('revoke truncate, references, trigger on table public.%I from authenticated', r.tabla);

        for col in
            select distinct a.attname,
                   case x.grantee when 0 then 'public' else quote_ident(pg_get_userbyid(x.grantee)) end as grantee
            from pg_attribute a
            cross join lateral aclexplode(a.attacl) x
            where a.attrelid = rel and a.attacl is not null
              and (x.grantee = 0 or x.grantee = (select oid from pg_roles where rolname = 'anon'))
        loop
            execute format('revoke all (%I) on table public.%I from %s', col.attname, r.tabla, col.grantee);
        end loop;

        for s in
            select distinct d.objid::regclass::text as secuencia
            from pg_depend d join pg_class sc on sc.oid = d.objid and sc.relkind = 'S'
            where d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
              and d.refobjid = rel and d.deptype in ('a', 'i')
        loop
            execute format('revoke all on sequence %s from anon, public', s.secuencia);
        end loop;

        foreach rol in array array['authenticated', 'service_role'] loop
            foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
                if coalesce((antes->rol->>priv)::boolean, false) and not has_table_privilege(rol, rel, priv) then
                    execute format('grant %s on table public.%I to %I', priv, r.tabla, rol);
                    insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
                    values ('035', r.tabla, 'permiso_explicito', jsonb_build_object('rol', rol, 'privilegio', priv, 'motivo', 'venía de PUBLIC'));
                end if;
            end loop;
        end loop;

    end loop;
end $$;

-- --------------------------------------- B) globales, solo del backend ---
do $$
declare
    t text;
    rel regclass;
begin
    foreach t in array array['usuarios', 'grupos', 'sesiones_lease'] loop
        rel := to_regclass(format('public.%I', t));
        if rel is null then
            continue;
        end if;
        if (select relforcerowsecurity from pg_class where oid = rel) then
            raise exception '035 abortada: % tiene RLS forzada', t;
        end if;
        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        values ('035', t, 'estado_previo', jsonb_build_object(
            'rls', (select relrowsecurity from pg_class where oid = rel),
            'acl', coalesce((select relacl::text from pg_class where oid = rel), '(por defecto)'),
            'service_role_todo', has_table_privilege('service_role', rel, 'SELECT')
                                 and has_table_privilege('service_role', rel, 'INSERT')
                                 and has_table_privilege('service_role', rel, 'UPDATE')));
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from anon, authenticated, public', t);
        execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    end loop;
end $$;

-- ---------------------------------------------------- comprobación final ---
do $$
declare
    r record;
    rel regclass;
    malas text := '';
begin
    for r in select tabla from t035 union all select unnest(array['usuarios', 'grupos', 'sesiones_lease']) loop
        rel := to_regclass(format('public.%I', r.tabla));
        continue when rel is null;
        if not (select relrowsecurity from pg_class where oid = rel) then
            malas := malas || format(' %s sin RLS;', r.tabla);
        end if;
        if has_table_privilege('anon', rel, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           or has_any_column_privilege('anon', rel, 'SELECT, INSERT, UPDATE, REFERENCES') then
            malas := malas || format(' anon conserva acceso a %s;', r.tabla);
        end if;
        if has_table_privilege('authenticated', rel, 'TRUNCATE') then
            malas := malas || format(' authenticated conserva TRUNCATE en %s;', r.tabla);
        end if;
    end loop;

    select malas || coalesce(' quedan políticas no reconocidas: ' || string_agg(format('%s."%s"', tablename, policyname), ', ') || ';', '')
      into malas
    from v035_politicas where decision <> 'conservar';

    if malas <> '' then
        raise exception '035 abortada en la comprobación final:%', malas;
    end if;
end $$;

commit;

-- ==========================================================================
-- Verificación:
--   select objeto, accion, detalle from efaat_admin.cambios_seguridad where paso = '035' order by id;
--   Bloque "035" de validacion_final_aislamiento_solo_lectura.sql.
--   Panel con dos cuentas: Automatización, Mensajes, Plantillas, Variables,
--   Diseños, Stickers y Grupos autorizados iguales que antes; cada cuenta
--   solo ve lo suyo (y los mensajes globales).
--
-- REVERSIÓN (sin abrir nada a anon ni a otros clientes):
--   - Si una pantalla del panel deja de funcionar, lo más probable es que le
--     falte una política de propietario para una operación: crearla
--     ("for <op> to authenticated using (usuario_id = auth.uid()) with check
--     (usuario_id = auth.uid())"). NO desactivar la RLS si authenticated
--     tiene permisos y existe más de una cuenta: cualquier cliente leería lo
--     de todos.
--   - Las políticas creadas se llaman "efaat propietario …": drop policy.
--   - Las abiertas eliminadas NO se recrean (eran la fuga).
-- ==========================================================================
