-- ==========================================================================
-- PARTE A (NO APLICADA, NO ES UNA MIGRACIÓN) — RLS «solo lo propio» en las 4
-- tablas que usa el panel: reservas_dos_cifras, 5k_15k_reservas_2_cifras,
-- eventos_bot y sesiones. Revisada el 2026-10-22.
--
-- HALLAZGO REAL (producción, 2026-10-22): con la clave pública anon y SIN
-- sesión se leen las 100 + 100 filas de reservas (comprador, teléfono, lid),
-- los 4 sorteos y las 4 sesiones. La 027 abortó porque reservas_dos_cifras
-- no tiene RLS. El diagnóstico del catálogo mostró además políticas públicas
-- antiguas en las reservas que dejan pasar a anon.
--
-- QUIÉN USA ESTAS TABLAS (verificado en el código):
--   - BOT y backend: service_role (salta la RLS) -> no les afecta.
--   - PANEL (rol authenticated, siempre filtrando por su usuario_id):
--       reservas_*    select (+ tiempo real), insert (reiniciarTabla crea la
--                     cuadrícula), update (bloquear, en proceso, pagar,
--                     liberar, reiniciar). Nunca delete.
--       eventos_bot   select (+ tiempo real)
--       sesiones      select (+ tiempo real), insert, update; el borrado va
--                     por el backend. La Parte D lo restringe después.
--   - /conectar/<id> (sin sesión): usa la RPC qr_sesion_publica (031), no
--     la tabla. La 031 tiene que estar aplicada y el panel desplegado ANTES.
--
-- QUÉ HACE (una transacción; si una guardia falla, no cambia nada):
--   G1  Las 4 tablas existen, usuario_id es uuid, sin RLS forzada y
--       service_role salta la RLS.
--   G2  Ninguna fila sin dueño ni de una cuenta que ya no existe (con filas
--       así, nadie las vería en el panel). Hoy: la sesión huérfana bloquea;
--       ver limpieza_sesion_huerfana.sql.
--   G3  Políticas ya existentes:
--         - las de esta Parte A: se recrean;
--         - ABIERTAS (rol public/anon, o sin condición: using/with check
--           vacío o "true"): se eliminan. Su definición completa queda en
--           efaat_admin.cambios_seguridad. Son la fuga: en Postgres las
--           permisivas se suman con OR y anularían el aislamiento;
--         - solo para service_role: se conservan (no cambian nada);
--         - cualquier otra: ABORTA y la nombra (no se adivina qué hace).
--   1   Guarda en efaat_admin.cambios_seguridad la ACL exacta de cada tabla
--       y los permisos efectivos de authenticated y service_role.
--   2   Activa RLS y crea las políticas «solo lo propio» (authenticated).
--   3   Quita TODO a anon y a PUBLIC (anon hereda de PUBLIC), también los
--       permisos por columna.
--   4   Si authenticated o service_role perdieron algún permiso que tenían
--       (porque les venía de PUBLIC), se les concede de forma explícita.
--       Nunca se concede nada que no tuvieran antes.
--   5   Comprobación final: anon sin acceso; service_role con todo.
--
-- PRUEBAS (Postgres real en memoria): backend/tests/sorteos/propuestaRls.test.js,
-- backend/tests/seguridad/aislamientoClientesRls.test.js y
-- backend/tests/seguridad/aislamientoMulticliente.test.js.
-- ==========================================================================

begin;

set local lock_timeout = '5s';

-- ------------------------------------------- registro de cambios (admin) ---
-- Esquema fuera de la API (PostgREST solo publica "public"): el navegador no
-- lo ve. Sirve de respaldo exacto para la reversión.
create schema if not exists efaat_admin;
revoke all on schema efaat_admin from public, anon, authenticated;

create table if not exists efaat_admin.cambios_seguridad (
    id bigserial primary key,
    paso text not null,
    objeto text not null,
    accion text not null,
    detalle jsonb,
    en timestamptz not null default now()
);
revoke all on table efaat_admin.cambios_seguridad from public, anon, authenticated;

-- ---------------------------------------------------------- guardias ---
do $$
declare
    t text;
    n bigint;
    huerfanas text := '';
    ajenas text;
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

    -- G2
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop
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
        raise exception 'Parte A abortada: filas que nadie podría ver tras la RLS:%  Resolver antes (limpieza_sesion_huerfana.sql).', huerfanas;
    end if;

    -- G3: políticas que no son ni de esta Parte A, ni abiertas, ni solo de service_role
    select string_agg(format('%s."%s" (%s, roles %s, using %s, check %s)', tablename, policyname, cmd,
                             array_to_string(roles, ','), coalesce(qual, '-'), coalesce(with_check, '-')), '; ')
      into ajenas
    from pg_policies
    where schemaname = 'public'
      and tablename in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones')
      and policyname not in (
          'panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas',
          'panel lee sus eventos',
          'panel lee sus sesiones', 'panel crea sus sesiones', 'panel modifica sus sesiones', 'panel borra sus sesiones'
      )
      and not (roles && array['public', 'anon']::name[]
               or (coalesce(nullif(trim(qual), ''), 'true') = 'true' and coalesce(nullif(trim(with_check), ''), 'true') = 'true'))
      and roles <> array['service_role']::name[];

    if ajenas is not null then
        raise exception 'Parte A abortada: políticas no previstas (ni abiertas ni de esta propuesta): %', ajenas;
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
           'efectivos', (select jsonb_object_agg(r.rol, jsonb_build_object(
                                'SELECT', has_table_privilege(r.rol, c.oid, 'SELECT'),
                                'INSERT', has_table_privilege(r.rol, c.oid, 'INSERT'),
                                'UPDATE', has_table_privilege(r.rol, c.oid, 'UPDATE'),
                                'DELETE', has_table_privilege(r.rol, c.oid, 'DELETE')))
                         from (values ('anon'), ('authenticated'), ('service_role')) r(rol)))
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones');

-- ------------------------------------ G3 (ejecución): políticas abiertas ---
do $$
declare
    p record;
begin
    for p in
        select * from pg_policies
        where schemaname = 'public'
          and tablename in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones')
          and policyname not in (
              'panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas',
              'panel lee sus eventos',
              'panel lee sus sesiones', 'panel crea sus sesiones', 'panel modifica sus sesiones', 'panel borra sus sesiones'
          )
          and roles <> array['service_role']::name[]
    loop
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
        execute format('create policy "panel crea su tabla" on public.%I for insert to authenticated with check (usuario_id = auth.uid())', t);
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
create policy "panel borra sus sesiones" on public.sesiones for delete to authenticated using (usuario_id = auth.uid());

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

        execute format('revoke all on table public.%I from anon, public', t);

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

-- Secuencias de las 4 tablas: anon y PUBLIC fuera (el panel inserta en
-- reservas y sesiones: authenticated conserva lo que tenía).
do $$
declare
    t text;
    s text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop
        s := pg_get_serial_sequence(format('public.%I', t), 'id');
        if s is not null then
            execute format('revoke all on sequence %s from anon', s);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------- 5. comprobación ---
do $$
declare
    t text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop
        if has_table_privilege('anon', format('public.%I', t), 'SELECT')
           or has_table_privilege('anon', format('public.%I', t), 'INSERT')
           or has_table_privilege('anon', format('public.%I', t), 'UPDATE')
           or has_table_privilege('anon', format('public.%I', t), 'DELETE')
           or has_any_column_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE') then
            raise exception 'Parte A abortada: anon conserva acceso a % (¿hereda de otro rol?)', t;
        end if;
        if not (has_table_privilege('service_role', format('public.%I', t), 'SELECT')
                and has_table_privilege('service_role', format('public.%I', t), 'INSERT')
                and has_table_privilege('service_role', format('public.%I', t), 'UPDATE')
                and has_table_privilege('service_role', format('public.%I', t), 'DELETE')) then
            raise exception 'Parte A abortada: service_role no tiene todos los permisos sobre % (el bot fallaría)', t;
        end if;
    end loop;
end $$;

commit;

-- ==========================================================================
-- DESPUÉS (solo lectura): V1–V6 de validacion_parte_a_solo_lectura.sql.
--   V3 = 027_podria_pasar en las 2 tablas. Con la clave anon y sin sesión:
--   0 filas o permiso denegado. /conectar/<id> sin sesión sigue mostrando el
--   QR. Panel con sesión: Tablas, Eventos y Sesiones igual que antes.
--   Lo eliminado y lo concedido: select * from efaat_admin.cambios_seguridad
--   where paso = 'parte_a' order by id;
--
-- REVERSIÓN SEGURA (solo si el panel o el bot dejan de funcionar). Una
-- transacción. Devuelve el funcionamiento SIN volver a abrir los datos:
--   begin;
--   alter table public.reservas_dos_cifras disable row level security;
--   alter table public."5k_15k_reservas_2_cifras" disable row level security;
--   alter table public.eventos_bot disable row level security;
--   alter table public.sesiones disable row level security;
--   commit;
-- Con la RLS desactivada, authenticated y service_role conservan sus
-- permisos y todo vuelve a funcionar como antes. NO se devuelven permisos a
-- anon ni a PUBLIC y NO se recrean las políticas abiertas: eran la fuga. Si
-- una aplicación externa necesitara anon, se decide aparte con el respaldo
-- de efaat_admin.cambios_seguridad (acción 'estado_previo'), nunca con un
-- "grant all ... to anon".
-- Si la 027 ya estaba aplicada, su función deja de crear cuadrículas
-- (responde parte_a_pendiente); no se pierde nada.
-- ==========================================================================
