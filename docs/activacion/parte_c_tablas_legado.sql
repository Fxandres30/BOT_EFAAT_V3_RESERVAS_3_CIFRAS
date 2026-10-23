-- ==========================================================================
-- PARTE C (NO APLICADA, NO ES UNA MIGRACIÓN) — tablas heredadas que la
-- clave anon (pública, va en el JavaScript del panel) lee SIN sesión.
--
-- HALLAZGO (2026-10-14, solo lectura: HEAD + count, sin descargar filas).
-- Además de las 5 tablas de las Partes A y B, anon lee estas, con datos
-- personales (teléfonos, nombres, correos, IP, mensajes):
--
--   administradores 141 · bloqueados_legado 15 · boletos 10000 (email,
--   teléfono) · clientes_contador 1494 · export_numeros 1000 ·
--   extra_2_cifras 100 · grupo_miembros 166 (phone, lid) ·
--   integrantes_antiguos 67 · messages 4677 (teléfono + texto) ·
--   nuevos_miembros 4 · numeros_gratis 10000 · numeros_tres_cifras 1000
--   (ip) · pedidos 34 (correo, comprobante) · prohibidos 1 ·
--   registro_usuarios 275 (IP, ubicación, dispositivo) ·
--   reservas_2_cifras_1000/5000 100+100 · reservas_dos_cifras_test 100 ·
--   semanales20k 100 · usuarios_grupo_test 1
--   (+ reservas_2_cifras_2000/3000/4000/10000, hoy vacías)
--
-- NINGÚN archivo de este repositorio (bot ni panel) usa estas tablas. El bot
-- (service_role) ni siquiera tiene permiso sobre la mayoría (403).
--
-- ⚠️ RIESGO: pueden usarlas aplicaciones FUERA de este repositorio con la
-- clave anon (la web antigua de boletos/pedidos, BANN, otra herramienta).
-- Quitar el acceso las rompería. Hay indicios de un escritor externo en las
-- tablas de reservas (ver docs/activacion/reservas_otro_sorteo.md). Antes de
-- aplicar, confirma que no hay ninguna aplicación viva que las use, o mira
-- en Supabase → Logs → API las peticiones con rol anon a estas tablas en los
-- últimos días.
--
-- NO incluidas (sin datos personales, parecen de otra aplicación —
-- trading/sorteos web): estrategias, operaciones, strategy_stats, sorteos.
-- Decide aparte.
--
-- Revisión de la auditoría integral (2026-10-22, §2f): antes solo quitaba
-- privilegios a anon. Eso no bastaba:
--   - si PUBLIC tiene permisos, anon los HEREDA y seguía leyendo;
--   - authenticated (CUALQUIER cliente con cuenta, también una prueba
--     gratuita) seguía leyendo los datos personales heredados de la cuenta
--     principal. Ni el panel ni el bot usan estas tablas con ese rol.
-- Ahora: RLS activada sin políticas y sin permisos para anon, authenticated
-- ni PUBLIC (tabla, columnas y secuencias). service_role no cambia. Guarda
-- la ACL previa en efaat_admin.cambios_seguridad. No borra ni cambia datos.
-- Las tablas que no existan se omiten. Comprobación final dentro de la
-- transacción.
-- ==========================================================================

-- ANTES (solo lectura) — guarda el resultado: es la vuelta atrás exacta.
--   select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee = 'anon'
--     and table_name in ('administradores','bloqueados_legado','boletos','clientes_contador',
--       'export_numeros','extra_2_cifras','grupo_miembros','integrantes_antiguos','messages',
--       'nuevos_miembros','numeros_gratis','numeros_tres_cifras','pedidos','prohibidos',
--       'registro_usuarios','reservas_2_cifras_1000','reservas_2_cifras_2000',
--       'reservas_2_cifras_3000','reservas_2_cifras_4000','reservas_2_cifras_5000',
--       'reservas_2_cifras_10000','reservas_dos_cifras_test','semanales20k','usuarios_grupo_test')
--   group by 1 order by 1;

-- --------------------------------------------------------------- C1 ---
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
    t text;
    col record;
    s record;
begin
    foreach t in array array[
        'administradores', 'bloqueados_legado', 'boletos', 'clientes_contador',
        'export_numeros', 'extra_2_cifras', 'grupo_miembros', 'integrantes_antiguos',
        'messages', 'nuevos_miembros', 'numeros_gratis', 'numeros_tres_cifras',
        'pedidos', 'prohibidos', 'registro_usuarios',
        'reservas_2_cifras_1000', 'reservas_2_cifras_2000', 'reservas_2_cifras_3000',
        'reservas_2_cifras_4000', 'reservas_2_cifras_5000', 'reservas_2_cifras_10000',
        'reservas_dos_cifras_test', 'semanales20k', 'usuarios_grupo_test'
    ] loop
        if to_regclass(format('public.%I', t)) is null then
            raise notice 'Tabla % no existe: se omite.', t;
            continue;
        end if;
        if (select relforcerowsecurity from pg_class where oid = to_regclass(format('public.%I', t))) then
            raise exception 'C1 abortada: % tiene RLS forzada (revisar a mano)', t;
        end if;
        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        values ('parte_c', t, 'estado_previo', jsonb_build_object(
            'rls', (select relrowsecurity from pg_class where oid = to_regclass(format('public.%I', t))),
            'acl', coalesce((select relacl::text from pg_class where oid = to_regclass(format('public.%I', t))), '(por defecto)')));
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from anon, authenticated, public', t);
        for col in
            select distinct a.attname,
                   case x.grantee when 0 then 'public' else quote_ident(pg_get_userbyid(x.grantee)) end as grantee
            from pg_attribute a cross join lateral aclexplode(a.attacl) x
            where a.attrelid = to_regclass(format('public.%I', t)) and a.attacl is not null
              and (x.grantee = 0 or x.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
        loop
            execute format('revoke all (%I) on table public.%I from %s', col.attname, t, col.grantee);
        end loop;
        for s in
            select distinct d.objid::regclass::text as secuencia
            from pg_depend d join pg_class sc on sc.oid = d.objid and sc.relkind = 'S'
            where d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
              and d.refobjid = to_regclass(format('public.%I', t)) and d.deptype in ('a', 'i')
        loop
            execute format('revoke all on sequence %s from anon, authenticated, public', s.secuencia);
        end loop;
        if has_table_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
           or has_table_privilege('authenticated', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
           or has_any_column_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE')
           or has_any_column_privilege('authenticated', format('public.%I', t), 'SELECT, INSERT, UPDATE') then
            raise exception 'C1 abortada: % sigue accesible desde el navegador (¿hereda de otro rol?)', t;
        end if;
    end loop;
end $$;

commit;

-- --------------------------------------------------------------- C2 ---
-- (Opcional; la Parte G ya las cierra si son SECURITY DEFINER) Funciones RPC
-- heredadas que el navegador puede invocar y que escriben en tablas de
-- clientes. Ningún código del repositorio las llama. Mismo riesgo que C1 si
-- una aplicación externa las usa.
begin;

do $$
declare
    f regprocedure;
begin
    for f in
        select p.oid::regprocedure
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('sumar_entregados_tres_cifras', 'asignar_numeros_gratis',
                            'asignar_boletos_seguro', 'incrementar_veces_preguntada')
    loop
        execute format('revoke execute on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
        raise notice 'C2: % solo service_role', f;
    end loop;
end $$;

commit;

-- ==========================================================================
-- DESPUÉS: con la clave anon y sin sesión, y con la sesión de un cliente,
-- cada tabla de C1 responde 401/403 (GET /rest/v1/<tabla>?select=id&limit=1).
-- El bot y el panel no cambian (no las usan).
--
-- VUELTA ATRÁS: solo para una tabla concreta que una aplicación legítima
-- necesite, identificada en Logs → API, y nunca a anon ni a PUBLIC: crear
-- antes una política que limite lo que ve y conceder lo mínimo al rol de esa
-- aplicación. La ACL previa está en:
--   select objeto, detalle from efaat_admin.cambios_seguridad where paso = 'parte_c';
-- (Antes la vuelta atrás era "grant all ... to anon": reabría los datos.)
-- ==========================================================================
