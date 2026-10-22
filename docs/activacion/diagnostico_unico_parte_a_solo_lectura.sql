-- ==========================================================================
-- DIAGNÓSTICO ÚNICO PARA LA PARTE A — SOLO LECTURA (2026-10-22)
--
-- Una sola consulta. Pegar ENTERA en Supabase → SQL Editor y pulsar Run una
-- vez. Devuelve una fila por bloque (columna "resultado" en JSON). Copiar el
-- resultado completo (botón de exportar/copiar) y pasárselo a Claude.
--
-- Solo lee catálogos (pg_class, pg_policies, pg_trigger, pg_proc…) y
-- CONTEOS. No devuelve compradores, contactos, teléfonos, correos, QR ni
-- grupos. Las definiciones de funciones son código, no datos de clientes.
-- La transacción es READ ONLY: cualquier escritura fallaría.
--
-- Cubre: R1–R12 y R15 de diagnostico_reservas_parte_a_solo_lectura.sql,
-- P0 de validacion_parte_a_solo_lectura.sql, y D1, D2, D3, D6, D8, D10,
-- D16, D17, D19, D22, D23 y D24a de diagnostico_rls_solo_lectura.sql.
-- Los datos (R0, R13, D12–D15, D18, D20b, D21) ya se leyeron por la API.
-- ==========================================================================
set transaction read only;

with
t4(nombre) as (values ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras'), ('eventos_bot'), ('sesiones')),
t2(nombre) as (values ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')),
c4 as (select cl.* from pg_class cl join t4 on cl.relname = t4.nombre where cl.relnamespace = 'public'::regnamespace),
c2 as (select c4.* from c4 join t2 on c4.relname = t2.nombre),
-- funciones de trigger de las 4 tablas + funciones que mencionan reservas o
-- compradores_semanales + las 4 RPC heredadas + lease + 030/031
fn as (
    select distinct p.oid
    from pg_proc p
    where (p.pronamespace = 'public'::regnamespace
           and (p.prosrc ~* '(reservas_dos_cifras|5k_15k_reservas_2_cifras|compradores_semanales)'
                or p.proname in ('sumar_entregados_tres_cifras', 'asignar_boletos_seguro', 'asignar_numeros_gratis',
                                 'incrementar_veces_preguntada', 'lease_sesiones_acquire', 'lease_sesiones_heartbeat',
                                 'lease_sesiones_release', 'reiniciar_tabla_cliente', 'qr_sesion_publica')))
       or p.oid in (select tg.tgfoid from pg_trigger tg join c4 on c4.oid = tg.tgrelid where not tg.tgisinternal)
)

-- R1 / D1: estado de RLS
select 'R1_D1_estado_tablas' as bloque, jsonb_agg(jsonb_build_object(
    'tabla', c4.relname, 'rls', c4.relrowsecurity, 'forzado', c4.relforcerowsecurity,
    'dueno', pg_get_userbyid(c4.relowner),
    'dueno_salta_rls', (select rolbypassrls from pg_roles where oid = c4.relowner),
    'replica_identity', c4.relreplident,
    'realtime', exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime'
                        and p.schemaname = 'public' and p.tablename = c4.relname)) order by c4.relname) as resultado
from c4

-- R2 / D2: políticas actuales
union all
select 'R2_D2_politicas', coalesce(jsonb_agg(jsonb_build_object(
    'tabla', tablename, 'politica', policyname, 'permisiva', permissive, 'roles', roles,
    'cmd', cmd, 'using', qual, 'check', with_check) order by tablename, policyname), '[]'::jsonb)
from pg_policies where schemaname = 'public' and tablename in (select nombre from t4)

-- R3 / D3: ACL exacta (BASE DE LA REVERSIÓN)
union all
select 'R3_D3_acl_exacta', jsonb_agg(jsonb_build_object('tabla', tabla, 'grantee', grantee, 'privilegios', privs) order by tabla, grantee)
from (
    select c4.relname as tabla,
           case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
           string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end, ',' order by a.privilege_type) as privs
    from c4 cross join lateral aclexplode(coalesce(c4.relacl, acldefault('r', c4.relowner))) a
    group by 1, 2
) x

-- R4: permisos por columna
union all
select 'R4_permisos_columna', coalesce(jsonb_agg(jsonb_build_object('tabla', c4.relname, 'columna', a.attname,
    'grantee', case x.grantee when 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end, 'priv', x.privilege_type)), '[]'::jsonb)
from c4 join pg_attribute a on a.attrelid = c4.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
cross join lateral aclexplode(a.attacl) x

-- R5: permisos efectivos
union all
select 'R5_permisos_efectivos', jsonb_agg(jsonb_build_object('rol', r.rol, 'tabla', c4.relname,
    'S', has_table_privilege(r.rol, c4.oid, 'SELECT'), 'I', has_table_privilege(r.rol, c4.oid, 'INSERT'),
    'U', has_table_privilege(r.rol, c4.oid, 'UPDATE'), 'D', has_table_privilege(r.rol, c4.oid, 'DELETE')) order by r.rol, c4.relname)
from (values ('anon'), ('authenticated'), ('service_role')) r(rol) cross join c4

-- R6 / D6: roles
union all
select 'R6_D6_roles', jsonb_agg(jsonb_build_object('rol', r.rolname, 'bypassrls', r.rolbypassrls,
    'miembro_de', (select array_agg(g.rolname order by g.rolname) from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid)) order by r.rolname)
from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres', 'authenticator', 'supabase_admin')

-- R7: usuario_id y auth.uid()
union all
select 'R7_usuario_id', jsonb_build_object(
    'columnas', (select jsonb_agg(jsonb_build_object('tabla', table_name, 'tipo', udt_name, 'nullable', is_nullable, 'default', column_default) order by table_name)
                 from information_schema.columns where table_schema = 'public' and column_name = 'usuario_id' and table_name in (select nombre from t4)),
    'auth_uid', (select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname = 'uid' and p.pronargs = 0 limit 1))

-- R8 / D17: índices y restricciones de las 2 tablas de reservas
union all
select 'R8_D17_indices', jsonb_agg(jsonb_build_object('tabla', t.relname, 'indice', i.relname, 'unico', x.indisunique,
    'def', pg_get_indexdef(x.indexrelid)) order by t.relname, i.relname)
from pg_index x join pg_class t on t.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
where t.oid in (select oid from c2)
union all
select 'R8_D17_restricciones', coalesce(jsonb_agg(jsonb_build_object('tabla', conrelid::regclass::text, 'nombre', conname, 'tipo', contype,
    'def', pg_get_constraintdef(oid)) order by 1), '[]'::jsonb)
from pg_constraint where conrelid in (select oid from c2)

-- R9 / D8: triggers de las 4 tablas (sin el código: va en R10)
union all
select 'R9_D8_triggers', coalesce(jsonb_agg(jsonb_build_object('tabla', c4.relname, 'trigger', tg.tgname, 'habilitado', tg.tgenabled,
    'def', pg_get_triggerdef(tg.oid), 'funcion', tg.tgfoid::regprocedure::text) order by c4.relname, tg.tgname), '[]'::jsonb)
from pg_trigger tg join c4 on c4.oid = tg.tgrelid where not tg.tgisinternal

-- R10 / D10: funciones relevantes, con CÓDIGO COMPLETO y quién las ejecuta
union all
select 'R10_D10_funciones', jsonb_agg(jsonb_build_object(
    'funcion', p.oid::regprocedure::text, 'security_definer', p.prosecdef, 'dueno', pg_get_userbyid(p.proowner),
    'dueno_bypassrls', (select rolbypassrls from pg_roles where oid = p.proowner), 'config', p.proconfig,
    'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'auth_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'sr_exec', has_function_privilege('service_role', p.oid, 'EXECUTE'),
    'acl', p.proacl::text,
    'codigo', pg_get_functiondef(p.oid)) order by p.proname)
from pg_proc p where p.oid in (select oid from fn)

-- R11: vistas que dependen de las 4 tablas
union all
select 'R11_vistas', coalesce(jsonb_agg(distinct jsonb_build_object('objeto', v.oid::regclass::text, 'tipo', v.relkind,
    'dueno', pg_get_userbyid(v.relowner), 'opciones', v.reloptions,
    'anon_lee', has_table_privilege('anon', v.oid, 'SELECT'), 'auth_lee', has_table_privilege('authenticated', v.oid, 'SELECT'))), '[]'::jsonb)
from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
where d.classid = 'pg_rewrite'::regclass and d.refobjid in (select oid from c4) and v.oid not in (select oid from c4)

-- R12: claves foráneas
union all
select 'R12_fk', coalesce(jsonb_agg(jsonb_build_object('origen', conrelid::regclass::text, 'destino', confrelid::regclass::text,
    'nombre', conname, 'def', pg_get_constraintdef(oid))), '[]'::jsonb)
from pg_constraint where contype = 'f' and (conrelid in (select oid from c2) or confrelid in (select oid from c2))

-- P0 (semáforo de las 4 tablas) y R15 (semáforo de reservas)
union all
select 'P0_R15_semaforo', jsonb_build_object(
    'sin_sorteos_activos', (select count(*) filter (where activo is not false) = 0 from public.eventos_bot),
    'sin_filas_sin_dueno', (select (select count(*) from public.eventos_bot where usuario_id is null)
                                 + (select count(*) from public.sesiones where usuario_id is null)
                                 + (select count(*) from public.reservas_dos_cifras where usuario_id is null)
                                 + (select count(*) from public."5k_15k_reservas_2_cifras" where usuario_id is null) = 0),
    'duenos_inexistentes_por_tabla', (select jsonb_object_agg(tabla, n) from (
        select 'eventos_bot' tabla, count(*) n from public.eventos_bot e where e.usuario_id is not null and not exists (select 1 from auth.users u where u.id = e.usuario_id)
        union all select 'sesiones', count(*) from public.sesiones s where s.usuario_id is not null and not exists (select 1 from auth.users u where u.id = s.usuario_id)
        union all select 'reservas_dos_cifras', count(*) from public.reservas_dos_cifras r where r.usuario_id is not null and not exists (select 1 from auth.users u where u.id = r.usuario_id)
        union all select '5k_15k', count(*) from public."5k_15k_reservas_2_cifras" r where r.usuario_id is not null and not exists (select 1 from auth.users u where u.id = r.usuario_id)) z),
    'sin_politicas_ajenas', (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename in (select nombre from t4)
        and policyname not in ('panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas', 'panel lee sus eventos',
                               'panel lee sus sesiones', 'panel crea sus sesiones', 'panel modifica sus sesiones', 'panel borra sus sesiones')),
    'usuario_id_es_uuid', (select count(*) = 4 from information_schema.columns where table_schema = 'public'
        and column_name = 'usuario_id' and udt_name = 'uuid' and table_name in (select nombre from t4)),
    'sin_rls_forzado', (select count(*) = 4 and bool_and(not relforcerowsecurity) from c4),
    'public_sin_permisos', (select count(*) = 0 from c4 cross join lateral aclexplode(coalesce(c4.relacl, acldefault('r', c4.relowner))) a where a.grantee = 0),
    'sin_permisos_columna_anon_public', (select count(*) = 0 from c4 join pg_attribute a on a.attrelid = c4.oid and a.attacl is not null
        cross join lateral aclexplode(a.attacl) x where x.grantee = 0 or x.grantee = (select oid from pg_roles where rolname = 'anon')),
    'panel_tiene_permisos_reservas', (select bool_and(has_table_privilege('authenticated', c2.oid, 'SELECT')
        and has_table_privilege('authenticated', c2.oid, 'INSERT') and has_table_privilege('authenticated', c2.oid, 'UPDATE')) from c2),
    'bot_tiene_permisos', (select bool_and(has_table_privilege('service_role', c4.oid, 'SELECT, INSERT, UPDATE, DELETE')) from c4),
    'service_role_salta_rls', (select rolbypassrls from pg_roles where rolname = 'service_role'),
    'anon_y_panel_sin_bypass', (select bool_and(not rolbypassrls) from pg_roles where rolname in ('anon', 'authenticated')),
    'triggers_invoker_que_leen_reservas', (select count(*) from pg_trigger tg join c2 on c2.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
        where not tg.tgisinternal and not p.prosecdef and p.prosrc ~* '(reservas_dos_cifras|5k_15k_reservas_2_cifras)'),
    'definer_ejecutables_desde_navegador', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and p.prosrc ~* '(reservas_dos_cifras|5k_15k_reservas_2_cifras|sesiones|eventos_bot)'
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
    'vistas_anon_cerradas', (select count(*) = 0 from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
        where d.classid = 'pg_rewrite'::regclass and d.refobjid in (select oid from c4) and v.oid not in (select oid from c4)
        and has_table_privilege('anon', v.oid, 'SELECT')))

-- D16 / D19 / D22 / D24a: migraciones y partes aplicadas
union all
select 'D16_D19_D22_D24_migraciones', jsonb_build_object(
    'parte_d_funcion', exists (select 1 from pg_proc where proname = 'sesiones_alta_desde_panel' and pronamespace = 'public'::regnamespace),
    '027_tablas_cliente', to_regclass('public.tablas_cliente') is not null,
    '027_funcion', exists (select 1 from pg_proc where proname = 'inicializar_tablas_cliente' and pronamespace = 'public'::regnamespace),
    '028_columna', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mensajes_grupos_sorteos' and column_name = 'cliente_usuario_id'),
    '029_rls_chats', (select relrowsecurity from pg_class where oid = to_regclass('public.mensajes_grupos_sorteos')),
    '029_politicas_chats', (select coalesce(jsonb_agg(policyname), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename = 'mensajes_grupos_sorteos'),
    '030_archivo', to_regclass('public.reservas_archivo') is not null,
    '030_firmas', (select coalesce(jsonb_agg(oid::regprocedure::text), '[]'::jsonb) from pg_proc where proname = 'reiniciar_tabla_cliente' and pronamespace = 'public'::regnamespace),
    '030_version_con_lock_share', exists (select 1 from pg_proc where proname = 'reiniciar_tabla_cliente' and pronamespace = 'public'::regnamespace and prosrc ~* 'lock_timeout'),
    '031_funcion', exists (select 1 from pg_proc where proname = 'qr_sesion_publica' and pronamespace = 'public'::regnamespace),
    '026_ofrecidas', to_regclass('public.loterias_catalogo_ofrecidas') is not null,
    '022_tablas', to_regclass('public.inactividad_miembros') is not null)

-- D23: mapa de todas las tablas públicas
union all
select 'D23_mapa_tablas', jsonb_agg(jsonb_build_object('tabla', c.relname, 'rls', c.relrowsecurity,
    'anon_lee', has_table_privilege('anon', c.oid, 'select'), 'anon_escribe', has_table_privilege('anon', c.oid, 'insert, update, delete'),
    'auth_lee', has_table_privilege('authenticated', c.oid, 'select'),
    'politicas', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)) order by c.relrowsecurity, c.relname)
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');
