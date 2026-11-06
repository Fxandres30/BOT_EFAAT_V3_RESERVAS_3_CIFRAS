-- ==========================================================================
-- verificar_032_solo_lectura.sql — ¿está aplicada COMPLETA la migración
-- 032_auditoria_reservas.sql? (preparado en F1-C, 06/11/2026; NO ejecutado)
--
-- SOLO LECTURA: únicamente SELECT sobre catálogos. No crea, no modifica, no
-- borra. Ejecutar a mano en el SQL Editor de Supabase cuando se autorice.
--
-- Por qué hace falta: el 23/10 se vio que la tabla no existía; el 30/10 una
-- comprobación por REST la dio por presente. REST solo prueba que la tabla
-- existe, no que tenga los triggers de inmutabilidad, la RLS ni los
-- permisos. Cada fila de abajo debe salir con ok = true.
-- ==========================================================================

with comprobaciones as (

    select 'tabla reservas_auditoria' as comprobacion,
           to_regclass('public.reservas_auditoria') is not null as ok,
           coalesce(to_regclass('public.reservas_auditoria')::text, 'no existe') as detalle

    union all
    select 'RLS activada',
           coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.reservas_auditoria')), false),
           null

    union all
    select 'trigger ' || t.nombre,
           exists (select 1 from pg_trigger g
                    where g.tgrelid = to_regclass('public.reservas_auditoria') and g.tgname = t.nombre and not g.tgisinternal),
           null
    from (values ('reservas_auditoria_sin_cambios'), ('reservas_auditoria_sin_truncate'), ('reservas_auditoria_fecha')) as t(nombre)

    union all
    select 'política de lectura propia',
           exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reservas_auditoria'
                    and policyname = 'clientes leen su propia auditoria' and cmd = 'SELECT'),
           null

    union all
    select 'sin políticas de escritura',
           not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reservas_auditoria' and cmd <> 'SELECT'),
           null

    union all
    select 'anon sin ningún permiso',
           not exists (select 1 from information_schema.role_table_grants
                        where table_schema = 'public' and table_name = 'reservas_auditoria' and grantee = 'anon'),
           null

    union all
    select 'authenticated solo SELECT',
           coalesce((select array_agg(privilege_type order by privilege_type) = array['SELECT']::varchar[]
                       from information_schema.role_table_grants
                      where table_schema = 'public' and table_name = 'reservas_auditoria' and grantee = 'authenticated'), false),
           null

    union all
    select 'service_role INSERT y SELECT (sin UPDATE/DELETE)',
           coalesce((select array_agg(privilege_type order by privilege_type) = array['INSERT', 'SELECT']::varchar[]
                       from information_schema.role_table_grants
                      where table_schema = 'public' and table_name = 'reservas_auditoria' and grantee = 'service_role'
                        and privilege_type in ('INSERT', 'SELECT', 'UPDATE', 'DELETE')), false),
           null

)
select * from comprobaciones;

-- Opcional, también de solo lectura: ¿se está escribiendo? (filas por origen
-- y acción en los últimos 7 días). Solo si la primera fila salió ok = true.
-- select origen, accion, resultado, count(*), max(creado_en)
--   from public.reservas_auditoria
--  where creado_en > now() - interval '7 days'
--  group by 1, 2, 3 order by 1, 2, 3;
