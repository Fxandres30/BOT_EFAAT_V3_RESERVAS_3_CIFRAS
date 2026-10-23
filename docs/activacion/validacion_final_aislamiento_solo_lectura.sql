-- ==========================================================================
-- VALIDACIÓN FINAL DEL AISLAMIENTO — SOLO LECTURA (2026-10-22, §2f)
--
-- Una sola consulta. Pegar ENTERA en Supabase → SQL Editor y pulsar Run.
-- Ejecutarla ANTES de cada paso de la sección 2f de ACTIVACION.md y DESPUÉS
-- de cada uno: devuelve una fila por bloque con "semaforo" (OK / BLOQUEO /
-- PENDIENTE) y el detalle en JSON.
--
-- Solo lee catálogos y CONTEOS. No devuelve compradores, contactos,
-- teléfonos, correos, QR ni grupos. Las definiciones de funciones son
-- código, no datos de clientes. La transacción es READ ONLY.
--
-- Reglas del semáforo (lo que no se puede verificar es BLOQUEO, nunca OK):
--   precondiciones   sorteos activos (activo = true), reservas/sorteos sin
--                    dueño (las sesiones sin dueño solo se informan), RLS
--                    forzada, service_role sin bypassrls, vistas que saltan
--                    la RLS, efaat_admin expuesto.
--   B_funcion_heredada  la función del trigger de pago: firma, dueño,
--                    md5_cuerpo (es el valor que pide la B2), código y
--                    unicidades de compradores_semanales.
--   politicas        cada política de las tablas de la Parte A y de la 035
--                    con la decisión que tomaría la migración: "abortar"
--                    = BLOQUEO.
--   exposicion       cada tabla/vista de public legible o escribible desde
--                    el navegador, con su clase. Una relación DESCONOCIDA
--                    expuesta = BLOQUEO.
--   funciones        SECURITY DEFINER ejecutables desde el navegador. Antes
--                    de la Parte G es PENDIENTE; después, cualquiera salvo
--                    qr_sesion_publica (versión 031) = BLOQUEO.
--   pasos            qué piezas constan aplicadas (por sus objetos). Que un
--                    objeto exista no prueba que sea la versión local: ver
--                    cada bloque.
--
-- Esta consulta NO lee efaat_admin (aún no existe antes del primer paso y
-- Postgres analiza la consulta entera). Cuando exista, aparte:
--   set transaction read only;
--   select paso, accion, count(*), max(en) from efaat_admin.cambios_seguridad group by 1, 2 order by 4;
--   select detalle->>'md5_cuerpo' from efaat_admin.cambios_seguridad where paso = 'parte_b2';
-- ==========================================================================
set transaction read only;

with
t_a(tabla, ops) as (values
    ('reservas_dos_cifras', '{SELECT,UPDATE}'::text[]), ('5k_15k_reservas_2_cifras', '{SELECT,UPDATE}'::text[]),
    ('eventos_bot', '{SELECT}'::text[]), ('sesiones', '{SELECT,INSERT,UPDATE}'::text[])),
t_cliente(tabla, globales) as (values
    ('automation_actions', false), ('automation_configs', false), ('automation_messages', true),
    ('configuracion_mensajes', false), ('configuracion_seleccion_mensajes', false), ('configuracion_stickers_pago', false),
    ('contactos_tenant', false), ('event_sessions', false), ('grupos_autorizados', false), ('plantillas_mensaje', false),
    ('reservas_actividad', false), ('tabla_configuracion_visual', false), ('tabla_disenos', false), ('tablas_cliente', false),
    ('variables_globales', false), ('automation_message_uses', false), ('bloqueados', false), ('bloqueo_intentos', false),
    ('cuentas_pago', false), ('inactividad_ejecuciones', false), ('inactividad_evaluaciones', false),
    ('inactividad_miembros', false), ('loterias_catalogo', false), ('loterias_catalogo_ofrecidas', false),
    ('loterias_calendario_inicializado', false), ('pagos_dispositivos', false), ('pagos_movimientos', false),
    ('plantillas_sorteo', false), ('reservas_archivo', false), ('reservas_auditoria', false),
    ('sorteos_programados', false), ('sorteos_programados_grupos', false)),
t_clase(tabla, clase) as (
    select tabla, 'parte_a' from t_a
    union all select tabla, 'cliente_035' from t_cliente
    union all select x, 'backend_035' from unnest(array['usuarios', 'grupos', 'sesiones_lease']) x
    union all select x, 'legado_parte_c' from unnest(array[
        'administradores', 'bloqueados_legado', 'boletos', 'clientes_contador', 'export_numeros', 'extra_2_cifras',
        'grupo_miembros', 'integrantes_antiguos', 'messages', 'nuevos_miembros', 'numeros_gratis', 'numeros_tres_cifras',
        'pedidos', 'prohibidos', 'registro_usuarios', 'reservas_2_cifras_1000', 'reservas_2_cifras_2000',
        'reservas_2_cifras_3000', 'reservas_2_cifras_4000', 'reservas_2_cifras_5000', 'reservas_2_cifras_10000',
        'reservas_dos_cifras_test', 'semanales20k', 'usuarios_grupo_test']) x
    union all select 'mensajes_grupos_sorteos', 'chats_029'
    union all select 'compradores_semanales', 'compradores_034'
    union all select 'loterias_catalogo_global', 'catalogo_global_026'
    union all select x, 'analitica_020' from unnest(array['analitica_admins', 'visitors', 'visitor_sessions', 'visitor_events']) x
),
-- Políticas con su clase (misma regla que la Parte A y la 035).
pol as (
    select p.*, coalesce(tc.globales, false) as globales, ta.ops as ops_a,
           case when ta.tabla is not null then 'parte_a' else 'cliente_035' end as pieza,
           case when p.cmd = 'INSERT' then null
                else regexp_replace(replace(lower(coalesce(p.qual, '')), '( select auth.uid() as uid)', 'auth.uid()'), '[\s()]', '', 'g') end as u,
           case when p.cmd in ('SELECT', 'DELETE') then null
                when p.cmd = 'INSERT' then regexp_replace(replace(lower(coalesce(p.with_check, '')), '( select auth.uid() as uid)', 'auth.uid()'), '[\s()]', '', 'g')
                else regexp_replace(replace(lower(coalesce(p.with_check, p.qual, '')), '( select auth.uid() as uid)', 'auth.uid()'), '[\s()]', '', 'g') end as c
    from pg_policies p
    left join t_a ta on ta.tabla = p.tablename
    left join t_cliente tc on tc.tabla = p.tablename
    where p.schemaname = 'public' and (ta.tabla is not null or tc.tabla is not null)
),
pol_clase as (
    select pol.*,
           (select case when bool_or(k = 'abierta') then 'abierta' when bool_and(k = 'propietario') then 'propietario' else 'otra' end
            from (select case
                             when x in ('', 'true') then 'abierta'
                             when x in ('usuario_id=auth.uid', 'auth.uid=usuario_id') then 'propietario'
                             when pol.globales and pol.cmd = 'SELECT'
                                  and x in ('usuario_idisnullorusuario_id=auth.uid', 'usuario_idisnullorauth.uid=usuario_id',
                                            'usuario_id=auth.uidorusuario_idisnull', 'auth.uid=usuario_idorusuario_idisnull')
                                  then 'propietario'
                             else 'otra' end as k
                  from (values (pol.u), (pol.c)) v(x) where x is not null) z) as clase
    from pol
),
pol_decision as (
    select tablename, policyname, cmd, permissive, roles, qual, with_check, pieza, clase,
           case
               when policyname in ('panel lee sus reservas', 'panel modifica sus reservas', 'panel lee sus eventos',
                                   'panel lee sus sesiones', 'panel crea sus sesiones', 'panel modifica sus sesiones')
                    and pieza = 'parte_a' then 'propia_parte_a'
               when policyname in ('panel crea su tabla', 'panel borra sus sesiones') and pieza = 'parte_a' then 'eliminar (versión anterior)'
               when roles = array['service_role']::name[] then 'conservar'
               when permissive <> 'PERMISSIVE' then 'abortar'
               when clase = 'abierta' then 'eliminar'
               when roles <@ array['anon']::name[] then 'eliminar'
               when clase = 'propietario' and (pieza = 'cliente_035' or cmd = any (ops_a)) then 'conservar'
               else 'abortar'
           end as decision
    from pol_clase
),
rel as (
    select c.oid, c.relname, c.relkind, c.relrowsecurity as rls, c.relforcerowsecurity as forzada,
           coalesce(k.clase, case when c.relkind in ('v', 'm') then 'vista_desconocida' else 'desconocida' end) as clase,
           has_table_privilege('anon', c.oid, 'SELECT') or has_any_column_privilege('anon', c.oid, 'SELECT') as anon_lee,
           has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE') or has_any_column_privilege('anon', c.oid, 'INSERT, UPDATE') as anon_escribe,
           has_table_privilege('authenticated', c.oid, 'SELECT') or has_any_column_privilege('authenticated', c.oid, 'SELECT') as auth_lee,
           has_table_privilege('authenticated', c.oid, 'TRUNCATE') as auth_truncate,
           c.relkind = 'v' and coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on', 'security_invoker=1'], false) as vista_invoker,
           (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
    from pg_class c
    left join t_clase k on k.tabla = c.relname
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
),
fn_heredada as (
    select distinct p.oid
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
    where c.relnamespace = 'public'::regnamespace and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
      and not tg.tgisinternal and p.prosrc ilike '%compradores_semanales%'
),
definer as (
    select p.oid, p.oid::regprocedure::text as firma, p.proname,
           exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') as de_extension,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ejecuta,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ejecuta
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
),
qr as (
    select count(*) = 1
           and bool_and(pg_get_function_identity_arguments(p.oid) = 'p_id text' and p.prorettype = 'jsonb'::regtype and p.prosecdef
                        and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) x where x like 'search_path=%')
                        and regexp_replace(lower(p.prosrc), '\s+', '', 'g') =
                            'selectjsonb_build_object(''qr'',s.qr,''estado'',s.estado,''qr_expira_en'',s.qr_expira_en)frompublic.sesionesswheres.id::text=p_idlimit1') as es_031,
           count(*) as versiones
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'qr_sesion_publica'
),
reg as (
    select to_regclass('efaat_admin.cambios_seguridad') is not null as hay
),
precond as (
    select
        -- El bot y el worker solo atienden activo = true (.eq("activo", true)):
        -- esos bloquean la ventana. activo NULL es inerte para el bot (solo la
        -- 030 lo trata como activo, para proteger sus reservas al reiniciar).
        (select count(*) filter (where activo is true) from public.eventos_bot) as sorteos_activos,
        (select count(*) filter (where activo is null) from public.eventos_bot) as sorteos_activo_nulo,
        (select jsonb_object_agg(tabla, n) from (
            select 'reservas_dos_cifras' tabla, count(*) filter (where usuario_id is null or not exists (select 1 from auth.users u where u.id = x.usuario_id)) n from public.reservas_dos_cifras x
            union all select '5k_15k_reservas_2_cifras', count(*) filter (where usuario_id is null or not exists (select 1 from auth.users u where u.id = x.usuario_id)) from public."5k_15k_reservas_2_cifras" x
            union all select 'eventos_bot', count(*) filter (where usuario_id is null or not exists (select 1 from auth.users u where u.id = x.usuario_id)) from public.eventos_bot x
            union all select 'sesiones', count(*) filter (where usuario_id is null or not exists (select 1 from auth.users u where u.id = x.usuario_id)) from public.sesiones x
        ) h) as filas_sin_dueno_o_huerfanas,
        (select coalesce(jsonb_agg(relname), '[]'::jsonb) from rel where clase = 'parte_a' and forzada) as rls_forzada,
        coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false) as service_role_bypassrls,
        (select coalesce(jsonb_agg(distinct v.oid::regclass::text), '[]'::jsonb)
         from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
         where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
           and d.refobjid in (select oid from rel where clase in ('parte_a', 'cliente_035', 'chats_029', 'compradores_034'))
           and v.oid <> d.refobjid and v.relkind in ('v', 'm')
           and (has_table_privilege('anon', v.oid, 'SELECT') or has_table_privilege('authenticated', v.oid, 'SELECT'))
           and not (v.relkind = 'v' and coalesce(v.reloptions::text[] && array['security_invoker=true', 'security_invoker=on', 'security_invoker=1'], false))) as vistas_que_saltan_rls,
        exists (select 1 from pg_roles x cross join lateral unnest(coalesce(x.rolconfig, '{}'::text[])) c
                where x.rolname = 'authenticator' and c ilike 'pgrst.db_schemas=%efaat_admin%') as efaat_admin_en_api,
        (select coalesce(jsonb_agg(c), '[]'::jsonb) from pg_roles x cross join lateral unnest(coalesce(x.rolconfig, '{}'::text[])) c
         where x.rolname = 'authenticator' and c ilike 'pgrst.%') as config_api_visible,
        (select coalesce(jsonb_agg(jsonb_build_object('tabla', x.indrelid::regclass::text, 'indice', pg_get_indexdef(x.indexrelid))), '[]'::jsonb)
         from pg_index x
         where x.indrelid in (select oid from rel where relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras'))
           and x.indisunique and not x.indisprimary
           and not exists (select 1 from pg_attribute a where a.attrelid = x.indrelid and a.attname = 'usuario_id'
                           and a.attnum = any (x.indkey::smallint[]))) as unicidades_sin_usuario
)

select 'precondiciones' as bloque,
       case when sorteos_activos = 0
                 and not exists (select 1 from jsonb_each_text(filas_sin_dueno_o_huerfanas) e
                                 where e.key <> 'sesiones' and e.value::bigint > 0)
                 and rls_forzada = '[]'::jsonb and service_role_bypassrls
                 and vistas_que_saltan_rls = '[]'::jsonb and not efaat_admin_en_api
            then 'OK' else 'BLOQUEO' end as semaforo,
       jsonb_build_object(
           'sorteos_activos', sorteos_activos,
           'sorteos_activo_nulo (no bloquean; ver sorteos_pendientes_solo_lectura.sql)', sorteos_activo_nulo,
           'filas_sin_dueno_o_huerfanas', filas_sin_dueno_o_huerfanas,
           'nota_sesiones', 'Las sesiones sin dueño válido (la huérfana) NO bloquean: la Parte A las conserva y registra; el panel nunca las veía.',
           'rls_forzada', rls_forzada,
           'service_role_bypassrls', service_role_bypassrls,
           'vistas_que_saltan_rls', vistas_que_saltan_rls,
           'efaat_admin_en_api', efaat_admin_en_api,
           'config_api_visible', config_api_visible,
           'nota_api', 'Si config_api_visible está vacío, confirmar a mano en Dashboard → API → Exposed schemas que efaat_admin NO aparece.',
           'unicidades_sin_usuario (033 pendiente si no está vacío)', unicidades_sin_usuario) as resultado
from precond

union all
select 'B_funcion_heredada',
       case when (select count(*) from fn_heredada) = 1 then 'PENDIENTE' else 'BLOQUEO' end,
       jsonb_build_object(
           'nota', 'PENDIENTE = la B2 exige md5_cuerpo = cceca089f72b33a12832eaf6c9f438c5 (el leído el 22/10); si difiere, la B2 aborta. BLOQUEO = 0 o más de 1 función: revisar a mano.',
           'funciones', (select coalesce(jsonb_agg(jsonb_build_object(
                'firma', p.oid::regprocedure::text, 'dueno', pg_get_userbyid(p.proowner),
                'dueno_es_dueno_de_la_tabla', p.proowner = (select relowner from pg_class where oid = to_regclass('public.compradores_semanales')),
                'dueno_salta_rls', (select rolbypassrls or rolsuper from pg_roles where oid = p.proowner),
                'security_definer', p.prosecdef, 'config', p.proconfig, 'md5_cuerpo', md5(p.prosrc),
                'usa_on_conflict', p.prosrc ~* 'on\s+conflict',
                'codigo', pg_get_functiondef(p.oid))), '[]'::jsonb)
                from pg_proc p where p.oid in (select oid from fn_heredada)),
           'triggers', (select coalesce(jsonb_agg(jsonb_build_object('tabla', tg.tgrelid::regclass::text, 'trigger', tg.tgname,
                                                                     'definicion', pg_get_triggerdef(tg.oid)) order by 1), '[]'::jsonb)
                        from pg_trigger tg where not tg.tgisinternal
                          and tg.tgrelid in (select oid from rel where relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'compradores_semanales'))),
           'unicidades_compradores', (select coalesce(jsonb_agg(pg_get_indexdef(x.indexrelid)), '[]'::jsonb)
                                      from pg_index x where x.indrelid = to_regclass('public.compradores_semanales') and x.indisunique))

union all
select 'politicas',
       case when exists (select 1 from pol_decision where decision = 'abortar') then 'BLOQUEO' else 'OK' end,
       coalesce((select jsonb_agg(jsonb_build_object('tabla', tablename, 'politica', policyname, 'cmd', cmd, 'permisiva', permissive,
                                                     'roles', roles, 'using', qual, 'check', with_check, 'clase', clase,
                                                     'pieza', pieza, 'decision', decision) order by decision, tablename, policyname)
                 from pol_decision), '[]'::jsonb)

union all
select 'exposicion',
       case when exists (select 1 from rel where clase in ('desconocida', 'vista_desconocida')
                         and (anon_lee or anon_escribe or (auth_lee and not rls and not vista_invoker)))
            then 'BLOQUEO'
            when exists (select 1 from rel where anon_lee or anon_escribe or auth_truncate
                         or (auth_lee and not rls and clase not in ('catalogo_global_026')))
            then 'PENDIENTE'
            else 'OK' end,
       jsonb_build_object(
           'nota', 'BLOQUEO = relación no clasificada expuesta (decidir antes). PENDIENTE = falta aplicar la pieza de su clase.',
           'expuestas', (select coalesce(jsonb_agg(jsonb_build_object('relacion', relname, 'tipo', relkind, 'clase', clase, 'rls', rls,
                                                                      'anon_lee', anon_lee, 'anon_escribe', anon_escribe,
                                                                      'auth_lee', auth_lee, 'auth_truncate', auth_truncate,
                                                                      'vista_invoker', vista_invoker, 'politicas', politicas)
                                                   order by clase, relname), '[]'::jsonb)
                         from rel where anon_lee or anon_escribe or auth_truncate or (auth_lee and not rls)),
           'cliente_035_sin_usuario_id', (select coalesce(jsonb_agg(r.relname), '[]'::jsonb) from rel r
                                          where r.clase = 'cliente_035' and r.relkind in ('r', 'p')
                                            and not exists (select 1 from pg_attribute a where a.attrelid = r.oid and a.attname = 'usuario_id'
                                                            and a.atttypid = 'uuid'::regtype and not a.attisdropped)))

union all
select 'funciones',
       case when exists (select 1 from definer where de_extension and (anon_ejecuta or auth_ejecuta)) then 'BLOQUEO'
            when not (select es_031 from qr) then 'BLOQUEO'
            when exists (select 1 from definer where proname <> 'qr_sesion_publica' and (anon_ejecuta or auth_ejecuta))
                 then 'PENDIENTE'
            else 'OK' end,
       jsonb_build_object(
           'nota', 'PENDIENTE antes de la Parte G. DESPUÉS de la Parte G, cualquier función de la lista es BLOQUEO.',
           'qr_sesion_publica_es_031', (select es_031 from qr), 'qr_versiones', (select versiones from qr),
           'abiertas_al_navegador', (select coalesce(jsonb_agg(jsonb_build_object('firma', firma, 'anon', anon_ejecuta, 'authenticated', auth_ejecuta,
                                                                                  'de_extension', de_extension) order by firma), '[]'::jsonb)
                                     from definer where anon_ejecuta or auth_ejecuta))

union all
select 'pasos', 'INFO',
       jsonb_build_object(
           '031', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'qr_sesion_publica'),
           'parte_a', (select count(*) = 4 from rel where clase = 'parte_a' and rls)
                      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sesiones' and policyname = 'panel lee sus sesiones'),
           '033', (select unicidades_sin_usuario = '[]'::jsonb from precond),
           '027', to_regclass('public.tablas_cliente') is not null,
           'b1', exists (select 1 from pg_trigger where tgname = 'omitir_sin_whatsapp' and tgrelid = to_regclass('public.compradores_semanales')),
           'b2', (select bool_and(prosecdef) from pg_proc where oid in (select oid from fn_heredada)),
           '034', exists (select 1 from pg_trigger where tgname = '000_efaat_cliente' and tgrelid = to_regclass('public.compradores_semanales')),
           '028', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mensajes_grupos_sorteos' and column_name = 'cliente_usuario_id'),
           '029', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mensajes_grupos_sorteos' and policyname = 'panel lee los chats de su bot'),
           '030_version_con_lock_share', exists (select 1 from pg_proc where proname = 'reiniciar_tabla_cliente' and pronamespace = 'public'::regnamespace and prosrc ~* 'lock_timeout'),
           'efaat_admin_protegido', (select case when hay then not (has_schema_privilege('anon', 'efaat_admin', 'USAGE')
                                                                 or has_schema_privilege('authenticated', 'efaat_admin', 'USAGE')) end from reg));
