-- ==========================================================================
-- VERIFICACIÓN de la migración 022_control_inactividad_miembros.sql
-- ==========================================================================
-- TODAS las consultas son de SOLO LECTURA. Pegar en el SQL Editor de
-- Supabase DESPUÉS de aplicar la 022. El bloque va dentro de una transacción
-- READ ONLY: si por error contuviera una escritura, Postgres la rechazaría.
--
-- Cada consulta indica el RESULTADO ESPERADO. Cualquier diferencia = parar y
-- no desplegar el backend hasta revisarlo.
--
-- No devuelven teléfonos ni JIDs: solo estructura, conteos y fechas.
-- (Probado contra Postgres real en memoria: backend/tests/inactividad/
-- migracion022.test.js, prueba "verificación".)
-- ==========================================================================

begin transaction read only;

-- V1. Tablas creadas y RLS activo.
-- ESPERADO: 3 filas, rls = true en las 3.
select c.relname as tabla, c.relrowsecurity as rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'inactividad\_%'
order by 1;

-- V2. Sin políticas RLS (solo el backend con service_role accede).
-- ESPERADO: 0 filas.
select schemaname, tablename, policyname
from pg_policies
where tablename like 'inactividad\_%';

-- V3. Privilegios por rol.
-- ESPERADO: service_role con AL MENOS DELETE, INSERT, SELECT, UPDATE en las
-- 3 tablas (Supabase puede añadir REFERENCES, TRIGGER, TRUNCATE por sus
-- privilegios por defecto); NINGUNA fila para anon ni authenticated.
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'inactividad\_%'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name
order by grantee, table_name;

-- V4. Índices.
-- ESPERADO: incluye inactividad_ejecuciones_una_en_curso como
-- "CREATE UNIQUE INDEX ... WHERE (estado = 'en_curso'::text)".
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename like 'inactividad\_%'
order by tablename, indexname;

-- V5. Triggers de compra confirmada.
-- ESPERADO: 4 filas (INSERT y UPDATE) para reservas_dos_cifras y
-- 5k_15k_reservas_2_cifras, timing AFTER.
select event_object_table as tabla, trigger_name, event_manipulation, action_timing
from information_schema.triggers
where trigger_name = 'inactividad_compra_confirmada'
order by 1, 3;

-- V6. Función del trigger: SECURITY DEFINER y search_path fijo.
-- ESPERADO: security_definer = true, config = {"search_path=public, pg_temp"}.
select p.proname, p.prosecdef as security_definer, p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'inactividad_registrar_compra';

-- V7. Nadie del navegador puede ejecutar la función directamente.
-- ESPERADO: anon = false, authenticated = false.
select has_function_privilege('anon', 'public.inactividad_registrar_compra()', 'execute') as anon,
       has_function_privilege('authenticated', 'public.inactividad_registrar_compra()', 'execute') as authenticated;

-- V8. Otros triggers de las tablas de reservas (para confirmar que los
-- previos, p. ej. el de compradores_semanales, siguen ahí sin cambios).
-- ESPERADO: los mismos que había antes + inactividad_compra_confirmada.
select event_object_table as tabla, trigger_name, event_manipulation
from information_schema.triggers
where event_object_table in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1, 2, 3;

-- V9. Backfill: resumen por origen (solo conteos y fechas).
-- ESPERADO justo después de aplicar: solo 'migracion_022'.
select ultima_compra_origen, count(*) as miembros,
       min(ultima_compra_en) as compra_mas_antigua, max(ultima_compra_en) as compra_mas_reciente
from public.inactividad_miembros
group by 1
order by 1;

-- V10. Cuadre del backfill contra las tablas de reservas: combinaciones
-- (tenant, grupo, miembro) con al menos una fila 'pagado' fechada, con
-- usuario y tenant existentes.
-- ESPERADO: importables = importados (en cada tabla y en total, tolerando
-- que la misma combinación aparezca en ambas tablas).
with fuente as (
    select usuario_id, grupo_id, usuario_global_id from public.reservas_dos_cifras
    where estado = 'pagado' and fecha_pago is not null and grupo_id is not null and usuario_global_id is not null
    union
    select usuario_id, grupo_id, usuario_global_id from public."5k_15k_reservas_2_cifras"
    where estado = 'pagado' and fecha_pago is not null and grupo_id is not null and usuario_global_id is not null
), importables as (
    select f.* from fuente f
    join public.usuarios u on u.id = f.usuario_global_id
    join auth.users a on a.id = f.usuario_id
)
select (select count(*) from importables) as importables,
       (select count(*) from importables i
          join public.inactividad_miembros m
            on m.usuario_id = i.usuario_id and m.grupo_id = i.grupo_id and m.usuario_global_id = i.usuario_global_id) as importados,
       (select count(*) from fuente) - (select count(*) from importables) as huerfanas_no_importables;

-- V11. Aún no ha corrido ninguna ejecución.
-- ESPERADO justo después de aplicar: 0 filas.
select estado, modo, count(*) from public.inactividad_ejecuciones group by 1, 2;

rollback;
