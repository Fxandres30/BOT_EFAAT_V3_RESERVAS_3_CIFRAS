-- ==========================================================================
-- DIAGNÓSTICO DE SOLO LECTURA — antes de autorizar las Partes A y D
-- (Fase 2, preparado el 2026-10-21; NO ejecutado por nadie todavía)
--
-- ⚠️  SOLO LECTURA. Este archivo NO aplica ninguna migración ni política.
--     Durante el diagnóstico NO ejecutes propuesta_rls_tablas_antiguas.sql,
--     parte_d_sesiones_columnas.sql ni ningún otro archivo de docs/activacion.
--
-- CÓMO USARLO (Supabase → SQL Editor):
--   - Ejecuta UN bloque cada vez: selecciona desde su "set transaction read
--     only;" hasta el final del bloque y pulsa Run. Cada bloque empieza con
--     esa línea: si por error se colara una escritura, Postgres la rechaza
--     ("cannot execute ... in a read-only transaction").
--   - Guarda el resultado de cada bloque (Download CSV o captura). Los de
--     D2, D3, D4 y D1 son la VUELTA ATRÁS exacta si luego se aplica algo.
--   - Ningún bloque muestra teléfonos, QR, nombres, contactos ni textos de
--     mensajes: solo estructura, permisos, conteos y usuario_id (UUID del
--     cliente de EFAAT, no del participante de WhatsApp).
--
-- Tablas afectadas por A/D: eventos_bot, sesiones, reservas_dos_cifras,
-- "5k_15k_reservas_2_cifras". Se incluyen como contexto (sin cambios en
-- A/D): mensajes_grupos_sorteos, compradores_semanales, sesiones_lease,
-- reservas_actividad, grupos_autorizados.
--
-- Probado localmente en Postgres en memoria (PGlite) contra una réplica del
-- esquema: backend/tests/seguridad/diagnosticoSoloLectura.test.js. Eso solo
-- prueba que las consultas son válidas y no escriben; los RESULTADOS reales
-- solo los da la base de producción.
-- ==========================================================================


-- ==========================================================================
-- D0. Sorteos activos ahora mismo (si hay alguno: NO aplicar nada hoy).
-- Esperado para una ventana segura: activos = 0.
-- ==========================================================================
set transaction read only;
select count(*) filter (where activo) as activos,
       min(hora_cierre) filter (where activo) as primer_cierre
from public.eventos_bot;


-- ==========================================================================
-- D1. ¿Existen las tablas? ¿RLS activado? ¿Forzado? ¿Dueño?
-- Esperado ANTES de A (según la auditoría del 14/10: anon lee todo):
--   las 4 tablas de A/D con existe = true y rls_activo = false.
--   Si alguna ya tiene rls_activo = true: anotarlo; la vuelta atrás de A
--   ("disable row level security") NO debe ejecutarse en esa tabla.
--   rls_forzado debería ser false (si es true, el dueño también queda
--   sujeto a RLS: revisarlo antes).
-- ==========================================================================
set transaction read only;
select t.nombre                                    as tabla,
       c.oid is not null                           as existe,
       c.relrowsecurity                            as rls_activo,
       c.relforcerowsecurity                       as rls_forzado,
       pg_get_userbyid(c.relowner)                 as dueno,
       c.reltuples::bigint                         as filas_estimadas
from (values ('eventos_bot'), ('sesiones'), ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras'),
             ('mensajes_grupos_sorteos'), ('compradores_semanales'), ('sesiones_lease'),
             ('reservas_actividad'), ('grupos_autorizados')) as t(nombre)
left join pg_class c on c.relname = t.nombre and c.relnamespace = 'public'::regnamespace
order by 1;


-- ==========================================================================
-- D2. Políticas RLS existentes.
-- Esperado ANTES de A: 0 filas en las 4 tablas de A/D (o solo políticas con
--   los nombres de la propuesta). Cualquier otra -> la Parte A ABORTA sola
--   (guardia) y hay que revisarla a mano: anotar nombre, roles, cmd, qual.
--   es_abierta = true (using true, o roles public/anon) es lo que explicaría
--   que anon lea todo aun con RLS activado.
--   ⚠️ Si aparece una política CON EL MISMO NOMBRE que las de la propuesta,
--   la Parte A la reemplaza en silencio y su vuelta atrás no la restaura:
--   guardar su qual/with_check.
-- ==========================================================================
set transaction read only;
select tablename, policyname, permissive, roles, cmd, qual, with_check,
       policyname in ('panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas',
                      'panel lee sus eventos', 'panel lee sus sesiones', 'panel crea sus sesiones',
                      'panel modifica sus sesiones', 'panel borra sus sesiones') as es_de_la_propuesta,
       (qual = 'true' or with_check = 'true' or roles && array['public', 'anon']::name[]) as es_abierta
from pg_policies
where schemaname = 'public'
  and tablename in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras',
                    'mensajes_grupos_sorteos', 'compradores_semanales', 'sesiones_lease',
                    'reservas_actividad', 'grupos_autorizados')
order by tablename, policyname;


-- ==========================================================================
-- D2b. Lo mismo que calcularía la guardia de la Parte A (sin aplicarla).
-- Esperado: politicas_ajenas = NULL. Si trae texto, la Parte A abortaría.
-- ==========================================================================
set transaction read only;
select string_agg(format('%s."%s" (%s, roles %s, using %s)', tablename, policyname, cmd,
                         array_to_string(roles, ','), coalesce(qual, '-')), '; ') as politicas_ajenas
from pg_policies
where schemaname = 'public'
  and tablename in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones')
  and policyname not in ('panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas',
                         'panel lee sus eventos', 'panel lee sus sesiones', 'panel crea sus sesiones',
                         'panel modifica sus sesiones', 'panel borra sus sesiones');


-- ==========================================================================
-- D3. Permisos POR TABLA (exactos, de la ACL). Guardar el resultado: es lo
-- que hay que restaurar en una vuelta atrás.
-- Esperado ANTES:
--   anon y authenticated: los de Supabase por defecto (normalmente
--     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE).
--   service_role: al menos SELECT, INSERT, UPDATE, DELETE en las 4 tablas
--     (el bot los usa; A/D no los tocan). La migración 016 demostró que en
--     este proyecto service_role NO siempre los tiene por defecto.
--   PUBLIC: idealmente ninguna fila. Si PUBLIC tiene INSERT/UPDATE/DELETE en
--     sesiones, la Parte D aborta (guardia).
-- ==========================================================================
set transaction read only;
select c.relname                                                         as tabla,
       case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as rol,
       string_agg(a.privilege_type, ', ' order by a.privilege_type)      as permisos
from pg_class c
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras',
                    'mensajes_grupos_sorteos', 'compradores_semanales')
  and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role', 'authenticator'))
group by 1, 2
order by 1, 2;


-- ==========================================================================
-- D4. Permisos POR COLUMNA ya existentes.
-- Esperado ANTES de D: 0 filas. Después de D: authenticated con UPDATE en
--   sesiones.nombre e INSERT en sesiones.usuario_id/nombre/estado/principal.
--   (Al revocar el permiso de tabla, Postgres revoca también los de
--   columna previos del mismo tipo: probado en local.)
-- ==========================================================================
set transaction read only;
select c.relname                                                         as tabla,
       att.attname                                                       as columna,
       case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as rol,
       string_agg(a.privilege_type, ', ' order by a.privilege_type)      as permisos
from pg_attribute att
join pg_class c on c.oid = att.attrelid
cross join lateral aclexplode(att.attacl) a
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras')
  and att.attacl is not null and not att.attisdropped
group by 1, 2, 3
order by 1, 2, 3;


-- ==========================================================================
-- D5. Permisos EFECTIVOS (incluye herencia de PUBLIC y de roles). Lo más
-- fácil de leer. Esperado ANTES: todo true para anon y authenticated.
-- Esperado DESPUÉS de A: anon todo false; authenticated igual que antes
--   (RLS limita las FILAS, no el permiso).
-- Esperado DESPUÉS de D (solo sesiones): authenticated upd_nombre = true,
--   upd_activa = upd_usuario = false, borrar = false.
-- ==========================================================================
set transaction read only;
select r.rol, t.tabla,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'SELECT') as leer,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'INSERT') as insertar,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'UPDATE') as actualizar_tabla,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'DELETE') as borrar,
       case when t.tabla = 'sesiones' then has_column_privilege(r.rol, 'public.sesiones', 'nombre', 'UPDATE') end     as upd_nombre,
       case when t.tabla = 'sesiones' then has_column_privilege(r.rol, 'public.sesiones', 'activa', 'UPDATE') end     as upd_activa,
       case when t.tabla = 'sesiones' then has_column_privilege(r.rol, 'public.sesiones', 'usuario_id', 'UPDATE') end as upd_usuario
from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
cross join (values ('eventos_bot'), ('sesiones'), ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')) as t(tabla)
order by 1, 2;


-- ==========================================================================
-- D6. Roles: ¿service_role salta RLS? ¿authenticated hereda de otro rol?
-- Esperado: service_role rolbypassrls = true. anon/authenticated sin
--   superusuario ni bypassrls. "miembro_de" vacío para anon/authenticated
--   (si heredan de un rol con permisos, la Parte D podría no bastar).
-- ==========================================================================
set transaction read only;
select r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit,
       (select string_agg(pg_get_userbyid(m.roleid), ', ') from pg_auth_members m where m.member = r.oid) as miembro_de
from pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres')
order by 1;


-- ==========================================================================
-- D7. Columnas de las 4 tablas (solo estructura, sin datos).
-- Comprobar:
--   - usuario_id existe en las 4 y es de tipo uuid (si fuera text, la
--     Parte A fallaría al crear las políticas: aborta entera, sin daño,
--     pero habría que adaptarla).
--   - sesiones tiene nombre, estado, principal, activa (la Parte D los usa;
--     preferida es opcional).
-- ==========================================================================
set transaction read only;
select table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity, is_generated
from information_schema.columns
where table_schema = 'public'
  and table_name in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by table_name, ordinal_position;


-- ==========================================================================
-- D7b. ¿El alta de sesiones seguiría funcionando con la Parte D?
-- Tras D, el panel solo puede enviar usuario_id, nombre, estado, principal.
-- Esperado: 0 filas. Cada fila es una columna obligatoria sin valor por
--   defecto que el panel ya no podría rellenar -> "Nueva sesión" fallaría.
-- ==========================================================================
set transaction read only;
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'sesiones'
  and is_nullable = 'NO' and column_default is null
  and is_identity = 'NO' and is_generated = 'NEVER'
  and column_name not in ('usuario_id', 'nombre', 'estado', 'principal');


-- ==========================================================================
-- D7c. Restricciones CHECK de sesiones (la Parte D fuerza estado =
-- 'desconectado', activa/principal/preferida = false en el alta del panel).
-- Esperado: ninguna que prohíba esos valores (el panel ya envía
--   'desconectado' y principal = false hoy).
-- ==========================================================================
set transaction read only;
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.sesiones'::regclass and contype = 'c';


-- ==========================================================================
-- D8. Triggers en las tablas afectadas (y si sus funciones son SECURITY
-- DEFINER). Esperado:
--   - En reservas: el trigger heredado de compradores_semanales (Parte B) y,
--     si se aplicó la 022, "inactividad_compra_confirmada" (SECURITY
--     DEFINER). Los SECURITY INVOKER corren con el rol de quien paga (el
--     panel = authenticated): la Parte A NO cambia sus permisos, así que un
--     pago desde el panel se comporta igual que hoy.
--   - En sesiones: ninguno llamado "sesiones_alta_desde_panel" (si existe,
--     es de una aplicación previa de D).
--   - Cualquier otro BEFORE INSERT en sesiones: revisarlo (podría pisar los
--     valores que fuerza la Parte D).
-- ==========================================================================
set transaction read only;
select c.relname                as tabla,
       t.tgname                 as trigger,
       t.tgenabled              as habilitado,      -- O = siempre, D = desactivado
       p.proname                as funcion,
       p.prosecdef              as security_definer,
       pg_get_userbyid(p.proowner) as dueno_funcion,
       pg_get_triggerdef(t.oid) as definicion
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and c.relnamespace = 'public'::regnamespace
  and c.relname in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1, 2;


-- ==========================================================================
-- D8b. Código de las funciones de esos triggers (es código, no datos).
-- Revisar: a qué tablas escriben y con qué rol. Es la consulta pendiente de
-- la Parte B (trigger heredado de compradores_semanales).
-- ==========================================================================
set transaction read only;
select distinct p.proname, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as definicion
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and c.relnamespace = 'public'::regnamespace
  and c.relname in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras');


-- ==========================================================================
-- D9. Vistas que leen estas tablas. Una vista normal se ejecuta con los
-- permisos de su DUEÑO y SALTA la RLS: si anon puede leer la vista, la
-- exposición sigue aunque se aplique la Parte A.
-- Esperado: 0 filas. Si hay alguna con anon_lee = true -> hallazgo nuevo.
-- ==========================================================================
set transaction read only;
select distinct v.view_name, v.table_name,
       has_table_privilege('anon', format('%I.%I', v.view_schema, v.view_name), 'SELECT') as anon_lee,
       has_table_privilege('authenticated', format('%I.%I', v.view_schema, v.view_name), 'SELECT') as authenticated_lee,
       coalesce((select array_to_string(vc.reloptions, ',') from pg_class vc
                 where vc.oid = format('%I.%I', v.view_schema, v.view_name)::regclass), '') as opciones
from information_schema.view_table_usage v
where v.table_schema = 'public'
  and v.table_name in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'mensajes_grupos_sorteos')
order by 1, 2;


-- ==========================================================================
-- D10. Funciones SECURITY DEFINER que mencionan estas tablas y quién puede
-- ejecutarlas (vía /rest/v1/rpc). También saltan la RLS.
-- Esperado según el repo: lease_sesiones_acquire / _heartbeat / _release
--   (migración 004) y la del trigger de 022 si se aplicó.
-- ⚠️ HALLAZGO A CONFIRMAR: la 004 no revoca EXECUTE, así que anon y
--   authenticated probablemente PUEDEN llamar las funciones de lease.
--   acquire devuelve el owner_id del lease vigente y release lo borra con
--   ese owner_id: cualquiera con un session_id podría dejar al bot sin
--   lease (bot sordo). Si anon_ejecuta o authenticated_ejecuta = true en
--   lease_*, NO lo corrigen A ni D: lo corrige parte_f_permisos_lease.sql.
-- ==========================================================================
set transaction read only;
select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_userbyid(p.proowner)                          as dueno,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_ejecuta,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_role_ejecuta
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosecdef
  and (p.prosrc ilike '%sesiones%' or p.prosrc ilike '%eventos_bot%'
       or p.prosrc ilike '%reservas_dos_cifras%' or p.prosrc ilike '%5k_15k_reservas_2_cifras%')
order by 1;


-- ==========================================================================
-- D11. Tiempo real: qué tablas emiten cambios. Con RLS activada, Realtime
-- solo entrega a cada cliente los cambios de las filas que puede leer
-- (la política SELECT de la Parte A lo permite para sus propias filas).
-- Esperado: informativo (el panel se suscribe a sesiones y a las 2 de
--   reservas).
-- ==========================================================================
set transaction read only;
select pubname, tablename
from pg_publication_tables
where schemaname = 'public'
  and tablename in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'mensajes_grupos_sorteos')
order by 1, 2;


-- ==========================================================================
-- D12. Totales y filas SIN dueño (usuario_id IS NULL).
-- Esperado: sin_dueno = 0 en las 4 tablas (auditoría 14/10: 0, 0, 0, 0).
--   Si alguna > 0: esas filas dejarían de verse en el panel tras la Parte A
--   (el bot sí las sigue viendo). NO aplicar hasta decidir a quién
--   pertenecen.
-- mensajes_grupos_sorteos: solo el total (su usuario_id es el participante,
--   no el cliente; no aplica aquí, ver Parte E).
-- ==========================================================================
set transaction read only;
select 'eventos_bot' as tabla, count(*) as total, count(*) filter (where usuario_id is null) as sin_dueno from public.eventos_bot
union all select 'sesiones', count(*), count(*) filter (where usuario_id is null) from public.sesiones
union all select 'reservas_dos_cifras', count(*), count(*) filter (where usuario_id is null) from public.reservas_dos_cifras
union all select '5k_15k_reservas_2_cifras', count(*), count(*) filter (where usuario_id is null) from public."5k_15k_reservas_2_cifras"
union all select 'mensajes_grupos_sorteos', count(*), null from public.mensajes_grupos_sorteos;


-- ==========================================================================
-- D13. Propietarios distintos por tabla (solo UUID y conteos).
-- Esperado (auditoría 14/10): 2 clientes con sesiones; uno con todos los
--   datos. usuario_existe = true en todas las filas: si es false, ese
--   usuario_id no corresponde a ninguna cuenta y NADIE podrá ver esas filas
--   desde el panel tras la Parte A.
-- ==========================================================================
set transaction read only;
with propietarios as (
    select 'eventos_bot' as tabla, usuario_id::text as usuario_id, count(*) as filas from public.eventos_bot group by 2
    union all select 'sesiones', usuario_id::text, count(*) from public.sesiones group by 2
    union all select 'reservas_dos_cifras', usuario_id::text, count(*) from public.reservas_dos_cifras group by 2
    union all select '5k_15k_reservas_2_cifras', usuario_id::text, count(*) from public."5k_15k_reservas_2_cifras" group by 2
)
select p.tabla, p.usuario_id, p.filas,
       exists (select 1 from auth.users u where u.id::text = p.usuario_id) as usuario_existe
from propietarios p
order by p.usuario_id nulls first, p.tabla;


-- ==========================================================================
-- D14. Sesiones por cliente (sin teléfono, QR ni nombre).
-- Esperado: cada cliente con a lo sumo 1 activa. Informativo: después de A/D
--   las sesiones solo cambian de activa/principal por el bot.
-- ==========================================================================
set transaction read only;
select usuario_id,
       count(*)                                   as sesiones,
       count(*) filter (where activa)             as activas,
       count(*) filter (where principal)          as principales,
       count(*) filter (where estado = 'conectado') as conectadas
from public.sesiones
group by usuario_id
order by usuario_id;


-- ==========================================================================
-- D15. Cuadrículas de reservas por cliente (sin compradores ni contactos).
-- Esperado: cada cliente con numeros_distintos = 100 y duplicados = 0
--   (auditoría 14/10). Sirve para comparar ANTES y DESPUÉS: los conteos por
--   estado no deben cambiar por aplicar A/D.
-- ==========================================================================
set transaction read only;
select tabla, usuario_id, filas, numeros_distintos, filas - numeros_distintos as duplicados,
       libres, reservados, pagados, otros
from (
    select 'reservas_dos_cifras' as tabla, usuario_id, count(*) as filas, count(distinct numero) as numeros_distintos,
           count(*) filter (where estado = 'libre') as libres, count(*) filter (where estado = 'reservado') as reservados,
           count(*) filter (where estado = 'pagado') as pagados,
           count(*) filter (where estado not in ('libre', 'reservado', 'pagado')) as otros
    from public.reservas_dos_cifras group by usuario_id
    union all
    select '5k_15k_reservas_2_cifras', usuario_id, count(*), count(distinct numero),
           count(*) filter (where estado = 'libre'), count(*) filter (where estado = 'reservado'),
           count(*) filter (where estado = 'pagado'),
           count(*) filter (where estado not in ('libre', 'reservado', 'pagado'))
    from public."5k_15k_reservas_2_cifras" group by usuario_id
) x
order by 1, 2;


-- ==========================================================================
-- D16. Objetos que crearía la Parte D (deben NO existir todavía).
-- Esperado: existe_funcion = false y existe_trigger = false.
-- ==========================================================================
set transaction read only;
select exists (select 1 from pg_proc where proname = 'sesiones_alta_desde_panel' and pronamespace = 'public'::regnamespace) as existe_funcion,
       exists (select 1 from pg_trigger where tgname = 'sesiones_alta_desde_panel' and tgrelid = 'public.sesiones'::regclass) as existe_trigger;


-- ==========================================================================
-- D17. Restricciones e índices de las 2 tablas físicas de números (antes de
-- la migración 027 y de dar de alta clientes nuevos).
-- Decide si un SEGUNDO cliente puede tener su cuadrícula (00-99) en la
-- misma tabla física:
--   - OK: la clave primaria es un id propio y no hay unicidad sobre numero,
--     o la unicidad es (usuario_id, numero).
--   - BLOQUEANTE: una restricción o índice ÚNICO solo sobre (numero), o
--     sobre columnas que no incluyen usuario_id (p. ej. numero + estado).
--     Entonces la cuadrícula de otro cliente no puede crearse (la
--     inicialización falla y no toca nada) y hace falta una migración
--     aparte, revisada con este resultado. La 027 NO la incluye.
-- ==========================================================================
set transaction read only;
select c.relname as tabla, con.conname as restriccion, con.contype as tipo,
       pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class c on c.oid = con.conrelid
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
  and con.contype in ('p', 'u', 'x', 'f')
order by 1, 2;

-- D17b. Índices (un índice UNIQUE sin restricción también cuenta).
set transaction read only;
select tablename as tabla, indexname as indice, indexdef as definicion_indice
from pg_indexes
where schemaname = 'public'
  and tablename in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1, 2;


-- ==========================================================================
-- D18. Qué cliente crea sorteos sobre cada tabla física (solo UUID y
-- conteos). Esperado (14/10): un único usuario_id por tabla, el MISMO que
-- tiene la cuadrícula en D15. Si aparece otro usuario_id, o eventos sin
-- dueño, NO habilitar clientes nuevos hasta revisarlo.
-- ==========================================================================
set transaction read only;
select tabla, usuario_id, count(*) as eventos, count(*) filter (where activo) as activos
from public.eventos_bot
group by 1, 2
order by 1, 2;


-- ==========================================================================
-- D19. ¿Está aplicada la migración 027 (configuraciones por cliente)?
-- Esperado ANTES de aplicarla: false, false.
-- ==========================================================================
set transaction read only;
select to_regclass('public.tablas_cliente') is not null as hay_tablas_cliente,
       exists (select 1 from pg_proc where proname = 'inicializar_tablas_cliente'
               and pronamespace = 'public'::regnamespace) as hay_funcion_027;


-- ==========================================================================
-- FUERA DEL SQL EDITOR — ¿alguien externo usa la clave anon contra estas
-- tablas? (Supabase → Logs → API / Logs Explorer). También es solo lectura.
-- Filtra las peticiones a:
--     /rest/v1/eventos_bot   /rest/v1/sesiones
--     /rest/v1/reservas_dos_cifras   /rest/v1/5k_15k_reservas_2_cifras
--     /rest/v1/rpc/lease_sesiones_
-- y revisa el rol (anon / authenticated / service_role) y el user agent.
-- Esperado:
--   - authenticated: el panel (navegador).
--   - service_role: el bot (Node).
--   - anon: SOLO la página /conectar/<id> (enlace "Compartir" del QR) leyendo
--     sesiones. Cualquier otra petición anon -> app externa: la Parte A la
--     cortaría (y podría ser quien devolvió pagos a "reservado" el 14/10,
--     ver reservas_otro_sorteo.md). Identificarla ANTES de autorizar A.
-- La retención de logs depende del plan (puede ser solo 1 día): revisar
-- varios días seguidos si hace falta.
-- ==========================================================================
