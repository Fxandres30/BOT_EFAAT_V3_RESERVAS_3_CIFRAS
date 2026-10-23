-- ==========================================================================
-- PARTE A (NO APLICADA, NO ES UNA MIGRACIÓN) — RLS «solo lo propio» en las 4
-- tablas que usa el panel: reservas_dos_cifras, 5k_15k_reservas_2_cifras,
-- eventos_bot y sesiones. Revisada el 2026-10-22 (auditoría integral, §2f).
--
-- HALLAZGO REAL (producción, 2026-10-22): con la clave pública anon y SIN
-- sesión se leen las 100 + 100 filas de reservas (comprador, teléfono, lid),
-- los 4 sorteos y las 4 sesiones. La 027 abortó porque reservas_dos_cifras
-- no tiene RLS. El diagnóstico del catálogo mostró además políticas públicas
-- antiguas en las reservas que dejan pasar a anon.
--
-- QUIÉN USA ESTAS TABLAS (verificado en el código, 2026-10-22):
--   - BOT y backend: service_role (salta la RLS) -> no les afecta. Pagar,
--     liberar, reservar a mano y crear la cuadrícula van por el backend
--     (/api/tablas/numero, /api/tablas/preparar).
--   - PANEL (rol authenticated, siempre filtrando por su usuario_id):
--       reservas_*    select (+ tiempo real) y update (reiniciarTabla sobre
--                     SUS filas). Ya NO inserta (prepararCuadricula va por el
--                     backend) ni borra.
--       eventos_bot   select (+ tiempo real)
--       sesiones      select (+ tiempo real), insert (createSession) y
--                     update (renombrar; la Parte D lo limita a "nombre").
--                     El borrado va por el backend.
--   - /conectar/<id> (sin sesión): usa la RPC qr_sesion_publica (031), no
--     la tabla. La 031 tiene que estar aplicada y el panel desplegado ANTES.
--
-- PERMISOS MÍNIMOS (cambio de la auditoría integral): ya no se crean las
-- políticas "panel crea su tabla" (insert en reservas) ni "panel borra sus
-- sesiones" (delete): el panel no las usa. Si existen de una versión
-- anterior de esta Parte A, se eliminan. TRUNCATE (que la RLS NO filtra),
-- REFERENCES y TRIGGER se retiran a authenticated.
--
-- QUÉ HACE (una transacción; si una guardia falla, no cambia nada):
--   0   Registro protegido efaat_admin (bloque común; aborta si la API lo
--       expusiera).
--   G1  Las 4 tablas existen, usuario_id es uuid, sin RLS forzada y
--       service_role salta la RLS. Ninguna vista legible desde el navegador
--       lee estas tablas saltándose la RLS (vista sin security_invoker o
--       vista materializada).
--   G2  Reservas y sorteos: ninguna fila sin dueño ni de una cuenta que ya
--       no existe (aborta; no se asignan por suposición). Sesiones sin dueño
--       válido (la huérfana): NO bloquean ni se borran; se registran en
--       efaat_admin.cambios_seguridad. El panel ya filtraba por su
--       usuario_id, así que nunca las veía; el bot sigue viéndolas.
--       (Antes G2 también abortaba por la sesión huérfana y exigía borrarla.)
--   G3  Políticas existentes que no son de esta Parte A:
--         - solo para service_role: se conservan;
--         - RESTRICTIVAS: ABORTA (no se adivina qué restringen);
--         - ABIERTAS (using/with check vacío o "true", cualquier rol) o solo
--           para anon: se eliminan; su definición queda en
--           efaat_admin.cambios_seguridad. En Postgres las permisivas se
--           suman con OR y anularían el aislamiento;
--         - «propietario» (usuario_id = auth.uid()) para una operación que el
--           panel hace en esa tabla: se conservan (equivalen a las nuestras);
--         - cualquier otra (otra condición, u operación que el panel no
--           hace): ABORTA y la nombra.
--   1   Guarda en efaat_admin.cambios_seguridad la ACL exacta de cada tabla
--       y los permisos efectivos de anon, authenticated y service_role.
--   2   Activa RLS y crea las políticas «solo lo propio» (authenticated).
--   3   Quita TODO a anon y a PUBLIC (anon hereda de PUBLIC), también los
--       permisos por columna y los de las secuencias; quita TRUNCATE,
--       REFERENCES y TRIGGER a authenticated.
--   4   Si authenticated o service_role perdieron algún permiso que tenían
--       (porque les venía de PUBLIC), se les concede de forma explícita.
--       Nunca se concede nada que no tuvieran antes.
--   5   Comprobación final: RLS activa, ninguna política no reconocida,
--       anon sin nada, authenticated sin TRUNCATE, service_role con todo.
--
-- REVERSIÓN: docs/activacion/reversion_parte_a.sql (nunca abre nada a anon
-- y, si hay más de una cuenta, tampoco deja a los clientes leer lo ajeno).
--
-- PRUEBAS (Postgres real en memoria y Postgres 17):
--   backend/tests/sorteos/propuestaRls.test.js,
--   backend/tests/seguridad/aislamientoClientesRls.test.js,
--   backend/tests/seguridad/aislamientoMulticliente.test.js y
--   backend/tests/seguridad/auditoriaIntegral.test.js.
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
-- idéntica a la de la 035).
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

-- Lo que el panel hace en cada tabla (además de esto, nada).
create temporary table a_tablas (tabla text primary key, ops text[] not null) on commit drop;
insert into a_tablas values
    ('reservas_dos_cifras',      '{SELECT,UPDATE}'),
    ('5k_15k_reservas_2_cifras', '{SELECT,UPDATE}'),
    ('eventos_bot',              '{SELECT}'),
    ('sesiones',                 '{SELECT,INSERT,UPDATE}');

create temporary table a_propias (politica text primary key) on commit drop;
insert into a_propias values
    ('panel lee sus reservas'), ('panel modifica sus reservas'),
    ('panel lee sus eventos'),
    ('panel lee sus sesiones'), ('panel crea sus sesiones'), ('panel modifica sus sesiones'),
    -- de versiones anteriores de esta Parte A: se eliminan si existen
    ('panel crea su tabla'), ('panel borra sus sesiones');

-- Política existente -> qué hacer con ella.
create temporary view a_politicas as
select p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check,
       case
           when p.roles = array['service_role']::name[] then 'conservar'
           when p.permissive <> 'PERMISSIVE' then 'abortar'
           when pg_temp.efaat_clase_politica(p.cmd, p.qual, p.with_check, false) = 'abierta' then 'eliminar'
           when p.roles <@ array['anon']::name[] then 'eliminar'
           when pg_temp.efaat_clase_politica(p.cmd, p.qual, p.with_check, false) = 'propietario'
                and (p.cmd = any (t.ops)) then 'conservar'
           else 'abortar'
       end as decision
from pg_policies p
join a_tablas t on t.tabla = p.tablename
where p.schemaname = 'public'
  and p.policyname not in (select politica from a_propias);

-- ---------------------------------------------------------- guardias ---
do $$
declare
    t text;
    n bigint;
    huerfanas text := '';
    ajenas text;
    vistas text;
begin

    -- G1
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop
        if to_regclass(format('public.%I', t)) is null then
            raise exception 'Parte A abortada: no existe la tabla %', t;
        end if;
        if not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = t and column_name = 'usuario_id' and udt_name = 'uuid') then
            raise exception 'Parte A abortada: %.usuario_id no es uuid', t;
        end if;
        if (select relforcerowsecurity from pg_class where oid = to_regclass(format('public.%I', t))) then
            raise exception 'Parte A abortada: % tiene RLS FORZADA (las funciones SECURITY DEFINER dejarían de ver filas)', t;
        end if;
    end loop;

    if not coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false) then
        raise exception 'Parte A abortada: service_role no salta la RLS (el bot dejaría de ver filas)';
    end if;

    -- Una vista corre con los permisos de su dueño: saltaría la RLS.
    select string_agg(distinct v.oid::regclass::text, ', ') into vistas
    from pg_depend d
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class v on v.oid = rw.ev_class
    where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
      and d.refobjid in (select to_regclass(format('public.%I', tabla)) from a_tablas)
      and v.oid not in (select to_regclass(format('public.%I', tabla)) from a_tablas)
      and v.relkind in ('v', 'm')
      and (has_table_privilege('anon', v.oid, 'SELECT') or has_table_privilege('authenticated', v.oid, 'SELECT'))
      and not (v.relkind = 'v' and coalesce(v.reloptions::text[] && array['security_invoker=true', 'security_invoker=on', 'security_invoker=1'], false));
    if vistas is not null then
        raise exception 'Parte A abortada: vistas legibles desde el navegador que saltan la RLS: %', vistas;
    end if;

    -- G2 (sesiones aparte: ver más abajo)
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot'] loop
        execute format('select count(*) from public.%I where usuario_id is null', t) into n;
        if n > 0 then
            huerfanas := huerfanas || format(' %s: %s sin dueño;', t, n);
        end if;
        if to_regclass('auth.users') is not null then
            execute format('select count(*) from public.%I x where x.usuario_id is not null
                            and not exists (select 1 from auth.users u where u.id = x.usuario_id)', t) into n;
            if n > 0 then
                huerfanas := huerfanas || format(' %s: %s de cuentas inexistentes;', t, n);
            end if;
        end if;
    end loop;

    if huerfanas <> '' then
        raise exception 'Parte A abortada: reservas o sorteos sin un dueño existente:%  No se asignan por suposición: revisar a mano.', huerfanas;
    end if;

    -- G3
    select string_agg(format('%s."%s" (%s, %s, roles %s, using %s, check %s)', tablename, policyname, cmd, permissive,
                             array_to_string(roles, ','), coalesce(qual, '-'), coalesce(with_check, '-')), '; ')
      into ajenas
    from a_politicas where decision = 'abortar';

    if ajenas is not null then
        raise exception 'Parte A abortada: políticas no previstas (ni abiertas, ni de propietario para lo que hace el panel): %', ajenas;
    end if;

end $$;

-- --------------------------------------------- 1. respaldo para revertir ---
insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
select 'parte_a', c.relname, 'estado_previo',
       jsonb_build_object(
           'rls', c.relrowsecurity,
           'acl', coalesce(c.relacl::text, '(por defecto)'),
           'acl_columnas', (select jsonb_object_agg(a.attname, a.attacl::text) from pg_attribute a
                            where a.attrelid = c.oid and a.attnum > 0 and a.attacl is not null),
           'politicas', (select coalesce(jsonb_agg(jsonb_build_object('politica', p.policyname, 'permisiva', p.permissive,
                                 'roles', p.roles, 'cmd', p.cmd, 'using', p.qual, 'check', p.with_check)), '[]'::jsonb)
                         from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
           'efectivos', (select jsonb_object_agg(r.rol, jsonb_build_object(
                                'SELECT', has_table_privilege(r.rol, c.oid, 'SELECT'),
                                'INSERT', has_table_privilege(r.rol, c.oid, 'INSERT'),
                                'UPDATE', has_table_privilege(r.rol, c.oid, 'UPDATE'),
                                'DELETE', has_table_privilege(r.rol, c.oid, 'DELETE'),
                                'TRUNCATE', has_table_privilege(r.rol, c.oid, 'TRUNCATE')))
                         from (values ('anon'), ('authenticated'), ('service_role')) r(rol)))
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in (select tabla from a_tablas);

-- Sesiones sin un dueño existente (p. ej. la de la cuenta 8b31d700… borrada
-- de auth.users): NO bloquean ni se tocan. El panel siempre filtra por su
-- usuario_id, así que ya hoy nadie las ve en el panel; tras la RLS tampoco.
-- El bot (service_role) las sigue viendo igual. Se registran para decidir
-- aparte (limpieza_sesion_huerfana.sql es OPCIONAL y archiva antes de borrar).
do $$
begin
    if to_regclass('auth.users') is null then
        return;
    end if;
    execute $q$
        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        select 'parte_a', 'sesiones', 'sesiones_sin_dueno_conservadas', jsonb_build_object(
            'sin_dueno', count(*) filter (where s.usuario_id is null),
            'cuenta_inexistente', count(*) filter (where s.usuario_id is not null and not exists (select 1 from auth.users u where u.id = s.usuario_id)),
            'activas_o_principales', count(*) filter (where (s.usuario_id is null or not exists (select 1 from auth.users u where u.id = s.usuario_id))
                                                             and (to_jsonb(s)->>'activa' = 'true' or to_jsonb(s)->>'principal' = 'true')),
            'ids', coalesce(jsonb_agg(s.id::text) filter (where s.usuario_id is null or not exists (select 1 from auth.users u where u.id = s.usuario_id)), '[]'::jsonb))
        from public.sesiones s
        having count(*) filter (where s.usuario_id is null or not exists (select 1 from auth.users u where u.id = s.usuario_id)) > 0
    $q$;
end $$;

-- ------------------------------ G3 (ejecución): abiertas y versiones viejas ---
do $$
declare
    p record;
begin
    for p in select * from a_politicas where decision = 'eliminar' loop
        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        values ('parte_a', p.tablename, 'politica_abierta_eliminada',
                jsonb_build_object('politica', p.policyname, 'permisiva', p.permissive, 'roles', p.roles,
                                   'cmd', p.cmd, 'using', p.qual, 'check', p.with_check));
        raise notice 'Parte A: se elimina la política abierta %.%', p.tablename, p.policyname;
        execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    end loop;
end $$;

-- ---------------------------------------------- 2. RLS + políticas propias ---
do $$
declare
    t text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop

        execute format('alter table public.%I enable row level security', t);

        execute format('drop policy if exists "panel lee sus reservas" on public.%I', t);
        execute format('drop policy if exists "panel crea su tabla" on public.%I', t);
        execute format('drop policy if exists "panel modifica sus reservas" on public.%I', t);

        execute format('create policy "panel lee sus reservas" on public.%I for select to authenticated using (usuario_id = auth.uid())', t);
        execute format('create policy "panel modifica sus reservas" on public.%I for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', t);

    end loop;
end $$;

-- El panel solo lee; las escrituras las hace el bot (service_role).
alter table public.eventos_bot enable row level security;
drop policy if exists "panel lee sus eventos" on public.eventos_bot;
create policy "panel lee sus eventos" on public.eventos_bot for select to authenticated using (usuario_id = auth.uid());

alter table public.sesiones enable row level security;
drop policy if exists "panel lee sus sesiones" on public.sesiones;
drop policy if exists "panel crea sus sesiones" on public.sesiones;
drop policy if exists "panel modifica sus sesiones" on public.sesiones;
drop policy if exists "panel borra sus sesiones" on public.sesiones;
create policy "panel lee sus sesiones" on public.sesiones for select to authenticated using (usuario_id = auth.uid());
create policy "panel crea sus sesiones" on public.sesiones for insert to authenticated with check (usuario_id = auth.uid());
create policy "panel modifica sus sesiones" on public.sesiones for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ------------------------- 3 y 4. anon y PUBLIC fuera; panel y bot intactos ---
do $$
declare
    t text;
    priv text;
    rol text;
    antes jsonb;
    col record;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop

        select detalle->'efectivos' into antes
        from efaat_admin.cambios_seguridad
        where paso = 'parte_a' and objeto = t and accion = 'estado_previo'
        order by id desc limit 1;

        -- Si desde la aplicación anterior de esta Parte A se ejecutó
        -- reversion_parte_a.sql (que retira authenticated con varias
        -- cuentas), se devuelve lo que esa reversión quitó, y nada más (no lo
        -- que quitó la Parte D: UPDATE solo de "nombre" en sesiones).
        select antes || jsonb_build_object('authenticated',
                   coalesce(antes->'authenticated', '{}'::jsonb) || coalesce(r.detalle->'efectivos'->'authenticated', '{}'::jsonb))
          into antes
        from (select 1) x
        left join lateral (
            select c.detalle from efaat_admin.cambios_seguridad c
            where c.paso = 'reversion_parte_a' and c.objeto = t and c.accion = 'estado_previo'
              and c.detalle->>'modo' = 'panel_sin_acceso_directo'
              and c.id > coalesce((select max(p.id) from efaat_admin.cambios_seguridad p
                                   where p.paso = 'parte_a' and p.objeto = t and p.accion = 'estado_previo'
                                     and p.id < (select max(q.id) from efaat_admin.cambios_seguridad q
                                                 where q.paso = 'parte_a' and q.objeto = t and q.accion = 'estado_previo')), 0)
            order by c.id desc limit 1) r on true;

        execute format('revoke all on table public.%I from anon, public', t);

        -- TRUNCATE no pasa por la RLS: un cliente podría vaciar la tabla de
        -- todos. REFERENCES y TRIGGER tampoco los usa el panel.
        execute format('revoke truncate, references, trigger on table public.%I from authenticated', t);

        -- Permisos por columna que pudieran quedar a anon o a PUBLIC.
        for col in
            select distinct a.attname,
                   case x.grantee when 0 then 'public' else quote_ident(pg_get_userbyid(x.grantee)) end as grantee
            from pg_attribute a
            cross join lateral aclexplode(a.attacl) x
            where a.attrelid = to_regclass(format('public.%I', t)) and a.attacl is not null
              and (x.grantee = 0 or x.grantee = (select oid from pg_roles where rolname = 'anon'))
        loop
            execute format('revoke all (%I) on table public.%I from %s', col.attname, t, col.grantee);
        end loop;

        foreach rol in array array['authenticated', 'service_role'] loop
            foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
                if coalesce((antes->rol->>priv)::boolean, false)
                   and not has_table_privilege(rol, format('public.%I', t), priv) then
                    execute format('grant %s on table public.%I to %I', priv, t, rol);
                    insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
                    values ('parte_a', t, 'permiso_explicito', jsonb_build_object('rol', rol, 'privilegio', priv,
                            'motivo', 'venía de PUBLIC'));
                end if;
            end loop;
        end loop;

    end loop;
end $$;

-- Secuencias de las 4 tablas (cualquier columna): anon y PUBLIC fuera. El
-- panel ya no inserta reservas; sesiones usa uuid. authenticated y
-- service_role conservan lo que tenían.
do $$
declare
    s record;
begin
    for s in
        select distinct d.objid::regclass::text as secuencia
        from pg_depend d
        join pg_class sc on sc.oid = d.objid and sc.relkind = 'S'
        where d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
          and d.refobjid in (select to_regclass(format('public.%I', tabla)) from a_tablas)
          and d.deptype in ('a', 'i')
    loop
        execute format('revoke all on sequence %s from anon, public', s.secuencia);
    end loop;
end $$;

-- ---------------------------------------------------- 5. comprobación ---
do $$
declare
    t text;
    malas text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop
        if not (select relrowsecurity from pg_class where oid = to_regclass(format('public.%I', t))) then
            raise exception 'Parte A abortada: % sigue sin RLS', t;
        end if;
        if has_table_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           or has_any_column_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE, REFERENCES') then
            raise exception 'Parte A abortada: anon conserva acceso a % (¿hereda de otro rol?)', t;
        end if;
        if has_table_privilege('authenticated', format('public.%I', t), 'TRUNCATE') then
            raise exception 'Parte A abortada: authenticated conserva TRUNCATE sobre % (¿hereda de otro rol?)', t;
        end if;
        if not (has_table_privilege('service_role', format('public.%I', t), 'SELECT')
                and has_table_privilege('service_role', format('public.%I', t), 'INSERT')
                and has_table_privilege('service_role', format('public.%I', t), 'UPDATE')
                and has_table_privilege('service_role', format('public.%I', t), 'DELETE')) then
            raise exception 'Parte A abortada: service_role no tiene todos los permisos sobre % (el bot fallaría)', t;
        end if;
    end loop;

    -- Solo quedan políticas reconocidas: las nuestras, las de service_role y
    -- las de propietario conservadas.
    select string_agg(format('%s."%s"', tablename, policyname), ', ') into malas
    from a_politicas where decision <> 'conservar';
    if malas is not null then
        raise exception 'Parte A abortada: quedan políticas no reconocidas: %', malas;
    end if;

    if exists (select 1 from pg_class s where s.relkind = 'S'
               and s.oid in (select d.objid from pg_depend d
                             where d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
                               and d.refobjid in (select to_regclass(format('public.%I', tabla)) from a_tablas))
               -- (CASE: el orden de evaluación de las condiciones no está
               -- garantizado y has_sequence_privilege falla con otra relación)
               and case when s.relkind = 'S' then has_sequence_privilege('anon', s.oid, 'USAGE, SELECT, UPDATE') else false end) then
        raise exception 'Parte A abortada: anon conserva permisos en una secuencia de las 4 tablas';
    end if;
end $$;

commit;

-- ==========================================================================
-- DESPUÉS (solo lectura): V1–V6 de validacion_parte_a_solo_lectura.sql y el
--   bloque "parte_a" de validacion_final_aislamiento_solo_lectura.sql.
--   Con la clave anon y sin sesión: 0 filas o permiso denegado. /conectar/<id>
--   sin sesión sigue mostrando el QR. Panel con sesión: Tablas, Eventos y
--   Sesiones igual que antes.
--   Lo eliminado y lo concedido: select * from efaat_admin.cambios_seguridad
--   where paso = 'parte_a' order by id;
--
-- REVERSIÓN: docs/activacion/reversion_parte_a.sql. NO usar un simple
-- "disable row level security": con permisos para authenticated, cualquier
-- cliente con cuenta (prueba gratuita incluida) volvería a leer las
-- reservas, sorteos y sesiones de todos. NO se devuelven permisos a anon ni a
-- PUBLIC y NO se recrean las políticas abiertas: eran la fuga.
-- ==========================================================================
