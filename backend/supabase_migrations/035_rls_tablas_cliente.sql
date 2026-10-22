-- ==========================================================================
-- 035 — RED DE SEGURIDAD RLS: tablas de cliente y tablas solo del backend
--
-- PREPARADA EL 2026-10-22. NO APLICADA. Requiere autorización expresa.
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
--    - elimina las políticas TRIVIALMENTE ABIERTAS (condición vacía o
--      "true"); su definición queda en efaat_admin.cambios_seguridad. Las
--      políticas con condición (auth.uid(), globales con usuario_id nulo…)
--      se conservan;
--    - crea, solo si falta una política para esa operación, la política
--      «propietario» de lectura (siempre) y de alta/modificación/borrado
--      SOLO para las operaciones que el panel hace en esa tabla (revisado en
--      frontend/ el 2026-10-22). Nada más;
--    - quita todo a anon y PUBLIC; authenticated y service_role conservan
--      lo que tenían (si les venía de PUBLIC, se concede explícito).
--    Guardia: si una tabla que el panel LEE tenía la RLS desactivada y tiene
--    filas con usuario_id NULL que no son globales por diseño, ABORTA (el
--    panel dejaría de verlas).
--
-- B) TABLAS SOLO DEL BACKEND sin propietario (registro global de WhatsApp):
--    usuarios (identidades) y grupos (metadatos por jid). Solo las usa el
--    backend con service_role; el aislamiento por cliente lo dan
--    contactos_tenant y grupos_autorizados. RLS activada sin políticas y sin
--    permisos para anon/authenticated.
--
-- NO TOCA: catálogos globales (loterias_catalogo_global), analítica (020),
-- tablas de la Parte A (reservas, eventos_bot, sesiones), chats (029),
-- compradores_semanales (034), tablas heredadas sin uso (Parte C).
-- Prueba: backend/tests/seguridad/aislamientoMulticliente.test.js
-- ==========================================================================

begin;

set local lock_timeout = '5s';

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
    ('loterias_calendario_inicializado', '{}', false),
    ('pagos_dispositivos',               '{}', false),
    ('pagos_movimientos',                '{}', false),
    ('plantillas_sorteo',                '{}', false),
    ('reservas_archivo',                 '{}', false),
    ('sorteos_programados',              '{}', false),
    ('sorteos_programados_grupos',       '{}', false),
    ('reservas_2_cifras_1000',           '{}', false),
    ('reservas_2_cifras_2000',           '{}', false),
    ('reservas_2_cifras_3000',           '{}', false),
    ('reservas_2_cifras_4000',           '{}', false),
    ('reservas_2_cifras_5000',           '{}', false),
    ('reservas_2_cifras_10000',          '{}', false);

-- tablas del panel (las de arriba con lectura desde el navegador)
create temporary table t035_panel (tabla text primary key) on commit drop;
insert into t035_panel values
    ('automation_actions'), ('automation_configs'), ('automation_messages'), ('configuracion_mensajes'),
    ('configuracion_seleccion_mensajes'), ('configuracion_stickers_pago'), ('contactos_tenant'),
    ('event_sessions'), ('grupos_autorizados'), ('plantillas_mensaje'), ('reservas_actividad'),
    ('tabla_configuracion_visual'), ('tabla_disenos'), ('variables_globales');

-- ------------------------------------------------------------ guardias ---
do $$
declare
    r record;
    rel regclass;
    n bigint;
    problemas text := '';
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

        if not (select relrowsecurity from pg_class where oid = rel)
           and exists (select 1 from t035_panel p where p.tabla = r.tabla)
           and not r.globales_nulos then
            execute format('select count(*) from public.%I where usuario_id is null', r.tabla) into n;
            if n > 0 then
                problemas := problemas || format(' %s: %s filas sin dueño que el panel dejaría de ver;', r.tabla, n);
            end if;
        end if;
    end loop;

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
                   'DELETE', has_table_privilege(x.rol, rel, 'DELETE')))
          into antes
        from (values ('anon'), ('authenticated'), ('service_role')) x(rol);

        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        values ('035', r.tabla, 'estado_previo', jsonb_build_object(
            'rls', tenia_rls,
            'acl', coalesce((select relacl::text from pg_class where oid = rel), '(por defecto)'),
            'efectivos', antes,
            'politicas', (select coalesce(jsonb_agg(jsonb_build_object('politica', policyname, 'roles', roles, 'cmd', cmd,
                                                     'using', qual, 'check', with_check)), '[]'::jsonb)
                          from pg_policies where schemaname = 'public' and tablename = r.tabla)));

        -- Políticas trivialmente abiertas (sin condición), salvo solo-service_role.
        for p in
            select * from pg_policies
            where schemaname = 'public' and tablename = r.tabla
              and roles <> array['service_role']::name[]
              and case cmd
                      when 'INSERT' then coalesce(nullif(trim(with_check), ''), 'true') = 'true'
                      else coalesce(nullif(trim(qual), ''), 'true') = 'true'
                  end
        loop
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
            if not exists (select 1 from pg_policies
                           where schemaname = 'public' and tablename = r.tabla
                             and cmd in (op, 'ALL')
                             and roles && array['public', 'authenticated']::name[]) then
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

        foreach rol in array array['authenticated', 'service_role'] loop
            foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
                if coalesce((antes->rol->>priv)::boolean, false) and not has_table_privilege(rol, rel, priv) then
                    execute format('grant %s on table public.%I to %I', priv, r.tabla, rol);
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
    foreach t in array array['usuarios', 'grupos'] loop
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

commit;

-- ==========================================================================
-- Verificación:
--   select objeto, accion, detalle from efaat_admin.cambios_seguridad where paso = '035' order by id;
--   Panel con dos cuentas: Automatización, Mensajes, Plantillas, Variables,
--   Diseños, Stickers y Grupos autorizados iguales que antes; cada cuenta
--   solo ve lo suyo (y los mensajes globales).
--
-- REVERSIÓN (sin abrir nada a anon):
--   - Si una tabla deja de funcionar en el panel: desactivar la RLS SOLO de
--     esa tabla si estaba desactivada antes (estado_previo.rls = false):
--       alter table public.<tabla> disable row level security;
--   - Las políticas creadas se llaman "efaat propietario …": drop policy.
--   - Las abiertas eliminadas NO se recrean (eran la fuga).
-- ==========================================================================
