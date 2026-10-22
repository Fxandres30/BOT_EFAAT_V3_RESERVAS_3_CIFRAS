-- ==========================================================================
-- DIAGNÓSTICO DE RESERVAS ANTES DE LA PARTE A — SOLO LECTURA (2026-10-22)
--
-- Motivo: la 027 abortó con "reservas_dos_cifras no tiene RLS. Aplica y
-- valida antes la Parte A." La guardia funcionó y no quedó nada aplicado.
-- Este archivo comprueba si las 2 tablas físicas de reservas
-- (reservas_dos_cifras y 5k_15k_reservas_2_cifras, que la Parte A trata
-- juntas) cumplen los requisitos de la Parte A. Complementa, sin
-- sustituirlos, diagnostico_rls_solo_lectura.sql (D0–D24) y
-- validacion_parte_a_solo_lectura.sql (P0, V1–V6).
--
-- ⚠️  SOLO LECTURA. Cada bloque abre una transacción READ ONLY y termina en
--     ROLLBACK. No crea, cambia ni borra nada. No devuelve compradores,
--     contactos ni teléfonos: solo estructura, UUID de cuenta y conteos.
--
-- CÓMO USARLO (Supabase → SQL Editor): un bloque cada vez. Guarda el
-- resultado de R3 y R4: son la única forma de revertir la Parte A dejando
-- los permisos exactamente como estaban.
-- ==========================================================================


-- ==========================================================================
-- R0. Sorteos activos. Esperado: activos = 0. Si no: no aplicar nada hoy.
-- ==========================================================================
begin;
set transaction read only;
select count(*) filter (where activo is not false) as activos,
       min(hora_cierre) filter (where activo is not false) as primer_cierre
from public.eventos_bot;
rollback;


-- ==========================================================================
-- R1. Estado de las tablas.
-- Esperado (antes de A): rls_activo = false, rls_forzado = false.
--   rls_forzado = true  -> ABORTAR: las funciones SECURITY DEFINER del dueño
--                         (027, 030, 031) dejarían de ver filas.
--   dueno_salta_rls     -> informativo (el dueño salta la RLS si no está forzada).
--   en_realtime = true  -> el panel recibe cambios; tras A, Realtime filtra
--                         por la política SELECT con el JWT del panel.
-- ==========================================================================
begin;
set transaction read only;
select c.relname                                   as tabla,
       c.relrowsecurity                            as rls_activo,
       c.relforcerowsecurity                       as rls_forzado,
       pg_get_userbyid(c.relowner)                 as dueno,
       r.rolbypassrls                              as dueno_salta_rls,
       case c.relreplident when 'd' then 'default' when 'f' then 'full'
                           when 'i' then 'index' else 'nothing' end as replica_identity,
       exists (select 1 from pg_publication_tables p
               where p.pubname = 'supabase_realtime' and p.schemaname = 'public'
                 and p.tablename = c.relname)      as en_realtime,
       c.reltuples::bigint                         as filas_aprox
from pg_class c
join pg_roles r on r.oid = c.relowner
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1;
rollback;


-- ==========================================================================
-- R2. Políticas que existen HOY en las 2 tablas.
-- Esperado: 0 filas (o solo las 3 de la Parte A si alguien la aplicó a
-- medias). Cualquier otra -> la Parte A aborta sola y la nombra; NO borrarla
-- sin decidir antes qué hace (una permisiva "using (true)" se combina con OR
-- y anularía el aislamiento).
-- ==========================================================================
begin;
set transaction read only;
select tablename, policyname, permissive, roles, cmd, qual, with_check,
       policyname in ('panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas') as es_de_parte_a
from pg_policies
where schemaname = 'public'
  and tablename in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1, 2;
rollback;


-- ==========================================================================
-- R3. ACL EXACTA por tabla (GUARDAR: base de la reversión).
-- grantee = PUBLIC significa que TODOS los roles (anon incluido) heredan ese
-- permiso: la Parte A solo revoca a anon, así que la guardia de la 027
-- seguiría abortando. Esperado: ninguna fila con grantee = PUBLIC.
-- ==========================================================================
begin;
set transaction read only;
select c.relname as tabla,
       case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       pg_get_userbyid(a.grantor) as grantor,
       string_agg(a.privilege_type || case when a.is_grantable then ' (grant option)' else '' end,
                  ', ' order by a.privilege_type) as privilegios
from pg_class c
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
group by 1, 2, 3
order by 1, 2;
rollback;


-- ==========================================================================
-- R4. Permisos POR COLUMNA (GUARDAR). REVOKE ALL ON TABLE no se ve en
-- has_table_privilege si queda un permiso de columna. Esperado: 0 filas para
-- anon y PUBLIC.
-- ==========================================================================
begin;
set transaction read only;
select c.relname as tabla, a.attname as columna,
       case x.grantee when 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
       x.privilege_type
from pg_class c
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
cross join lateral aclexplode(a.attacl) x
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1, 3, 2, 4;
rollback;


-- ==========================================================================
-- R5. Permisos EFECTIVOS (incluye herencia de PUBLIC y de otros roles).
-- Esperado ANTES de A:
--   authenticated: leer, insertar, actualizar = true (el panel los usa).
--                  Si alguno es false, el panel YA falla hoy y la Parte A no
--                  lo arregla (las políticas no conceden permisos).
--   service_role:  todo true (el bot).
--   anon:          probablemente true (es lo que A cierra).
-- ==========================================================================
begin;
set transaction read only;
select r.rol, t.tabla,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'SELECT') as leer,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'INSERT') as insertar,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'UPDATE') as actualizar,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'DELETE') as borrar,
       has_any_column_privilege(r.rol, format('public.%I', t.tabla), 'SELECT') as leer_alguna_columna
from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
cross join (values ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')) as t(tabla)
order by 1, 2;
rollback;


-- ==========================================================================
-- R6. Roles. Esperado: service_role.salta_rls = true; anon y authenticated
-- sin salta_rls y sin pertenecer a roles con permisos sobre las tablas
-- (miembro_de vacío o solo roles del sistema).
-- ==========================================================================
begin;
set transaction read only;
select r.rolname, r.rolbypassrls as salta_rls, r.rolinherit as hereda,
       (select string_agg(g.rolname, ', ' order by g.rolname)
          from pg_auth_members m join pg_roles g on g.oid = m.roleid
         where m.member = r.oid) as miembro_de
from pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres', 'authenticator')
order by 1;
rollback;


-- ==========================================================================
-- R7. Columna usuario_id y auth.uid().
-- Esperado: 2 filas con tipo = uuid. nullable = true es aceptable SOLO si
-- R13 da sin_dueno = 0 (una fila nula quedaría invisible para el panel).
-- auth_uid_existe = true y devuelve uuid.
-- ==========================================================================
begin;
set transaction read only;
select c.table_name as tabla, c.udt_name as tipo, c.is_nullable as nullable, c.column_default as por_defecto,
       (select count(*) = 1 from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname = 'uid'
           and p.pronargs = 0 and p.prorettype = 'uuid'::regtype) as auth_uid_existe
from information_schema.columns c
where c.table_schema = 'public' and c.column_name = 'usuario_id'
  and c.table_name in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1;
rollback;


-- ==========================================================================
-- R8. Restricciones e índices.
-- Esperado:
--   - Ninguna UNIQUE/PK/índice único SOLO sobre (numero): bloquearía la
--     cuadrícula de un segundo cliente (afecta a la 027, no a la Parte A).
--   - indice_empieza_por_usuario_id = true en al menos un índice: la
--     política filtra por usuario_id en cada consulta. Con ~100 filas por
--     cliente no es bloqueante; con muchos clientes, sí conviene.
-- ==========================================================================
begin;
set transaction read only;
select t.relname as tabla, i.relname as indice, x.indisunique as unico, x.indisprimary as pk,
       pg_get_indexdef(x.indexrelid) as definicion,
       (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = x.indkey[0]) = 'usuario_id'
           as indice_empieza_por_usuario_id,
       (x.indisunique and x.indnatts = 1
        and (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = x.indkey[0]) = 'numero')
           as unico_solo_numero
from pg_index x
join pg_class t on t.oid = x.indrelid
join pg_class i on i.oid = x.indexrelid
where t.relnamespace = 'public'::regnamespace
  and t.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1, 2;
rollback;


-- ==========================================================================
-- R9. Triggers de las 2 tablas y su función (lo que NO cubren las pruebas
-- locales: allí el trigger heredado es una imitación).
-- Revisar cada fila:
--   security_definer = false y la función LEE reservas_* -> tras A solo verá
--     las filas del cliente que hace la operación en el panel (rol
--     authenticated). Si suma o busca en filas de otros clientes, cambiará
--     su resultado: decidirlo ANTES de aplicar A.
--   security_definer = false y ESCRIBE en otra tabla (p. ej.
--     compradores_semanales) -> la A no cambia esa tabla; el panel ya
--     necesita hoy permiso sobre ella (ver columnas authenticated_*).
--   security_definer = true -> corre como su dueño; dueno_salta_rls indica
--     si seguirá viendo todas las filas.
--   El cuerpo completo está en "definicion" (es código, no datos).
-- ==========================================================================
begin;
set transaction read only;
select c.relname as tabla, t.tgname as trigger, t.tgenabled as habilitado,
       pg_get_triggerdef(t.oid) as cuando,
       p.oid::regprocedure as funcion,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as dueno_funcion,
       (select rolbypassrls from pg_roles where oid = p.proowner) as dueno_salta_rls,
       p.proconfig as config,
       p.prosrc ~* '(reservas_dos_cifras|5k_15k_reservas_2_cifras)' as lee_o_escribe_reservas,
       p.prosrc ~* 'compradores_semanales' as toca_compradores_semanales,
       case when to_regclass('public.compradores_semanales') is null then null
            else has_table_privilege('authenticated', 'public.compradores_semanales', 'INSERT') end as authenticated_inserta_compradores,
       case when to_regclass('public.compradores_semanales') is null then null
            else has_table_privilege('authenticated', 'public.compradores_semanales', 'UPDATE') end as authenticated_actualiza_compradores,
       pg_get_functiondef(p.oid) as definicion
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and c.relnamespace = 'public'::regnamespace
  and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1, 2;
rollback;


-- ==========================================================================
-- R10. Funciones que mencionan las 2 tablas (RPC, triggers, 030…).
-- Revisar:
--   security_definer = true y anon/authenticated_ejecuta = true -> un
--     camino que SALTA la RLS desde el navegador. La Parte A no lo cierra.
--   security_definer = true y dueno_salta_rls = false y dueño distinto del
--     de la tabla -> tras A esa función dejará de ver filas.
--   security_definer = false -> corre con el rol que la llama: tras A, si la
--     llama el panel, solo verá filas propias.
-- ==========================================================================
begin;
set transaction read only;
select p.oid::regprocedure as funcion,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as dueno,
       (select rolbypassrls from pg_roles where oid = p.proowner) as dueno_salta_rls,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_ejecuta,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_ejecuta
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind = 'f'
  and p.prosrc ~* '(reservas_dos_cifras|5k_15k_reservas_2_cifras)'
order by 1;
rollback;


-- ==========================================================================
-- R11. Objetos que DEPENDEN de las tablas (vistas, vistas materializadas).
-- Una vista sin security_invoker corre con los permisos de su dueño y salta
-- la RLS. Esperado: 0 filas, o ninguna con anon_lee = true.
-- ==========================================================================
begin;
set transaction read only;
select distinct v.oid::regclass as objeto, v.relkind as tipo,
       pg_get_userbyid(v.relowner) as dueno,
       coalesce(v.reloptions::text ~ 'security_invoker=(on|true)', false) as security_invoker,
       has_table_privilege('anon', v.oid, 'SELECT') as anon_lee,
       has_table_privilege('authenticated', v.oid, 'SELECT') as authenticated_lee
from pg_depend d
join pg_rewrite rw on rw.oid = d.objid
join pg_class v on v.oid = rw.ev_class
where d.classid = 'pg_rewrite'::regclass
  and d.refobjid in (to_regclass('public.reservas_dos_cifras'), to_regclass('public."5k_15k_reservas_2_cifras"'))
  and v.oid not in (to_regclass('public.reservas_dos_cifras'), to_regclass('public."5k_15k_reservas_2_cifras"'))
order by 1;
rollback;


-- ==========================================================================
-- R12. Claves foráneas que entran o salen de las 2 tablas (informativo: las
-- comprobaciones de FK no se filtran por RLS, pero un ON DELETE/UPDATE
-- CASCADE desde otra tabla sí escribe aquí).
-- ==========================================================================
begin;
set transaction read only;
select conrelid::regclass as tabla_origen, confrelid::regclass as tabla_destino,
       conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where contype = 'f'
  and (conrelid in (to_regclass('public.reservas_dos_cifras'), to_regclass('public."5k_15k_reservas_2_cifras"'))
    or confrelid in (to_regclass('public.reservas_dos_cifras'), to_regclass('public."5k_15k_reservas_2_cifras"')))
order by 1, 3;
rollback;


-- ==========================================================================
-- R13. Datos por cliente (sin PII). Esperado:
--   sin_dueno = 0 (si no, esas filas desaparecen del panel tras A).
--   dueno_existe = true en todas las filas.
--   filas = numeros_distintos = 100 para la cuenta principal (GUARDAR: se
--   compara después de A y después de la 027).
-- ==========================================================================
begin;
set transaction read only;
select 'reservas_dos_cifras' as tabla, usuario_id,
       exists (select 1 from auth.users u where u.id = r.usuario_id) as dueno_existe,
       count(*) as filas, count(distinct numero) as numeros_distintos,
       count(*) filter (where estado = 'libre') as libres,
       count(*) filter (where estado = 'reservado') as reservados,
       count(*) filter (where estado = 'pagado') as pagados,
       count(*) filter (where estado not in ('libre', 'reservado', 'pagado')) as otros
from public.reservas_dos_cifras r group by usuario_id
union all
select '5k_15k_reservas_2_cifras', usuario_id,
       exists (select 1 from auth.users u where u.id = r.usuario_id),
       count(*), count(distinct numero),
       count(*) filter (where estado = 'libre'),
       count(*) filter (where estado = 'reservado'),
       count(*) filter (where estado = 'pagado'),
       count(*) filter (where estado not in ('libre', 'reservado', 'pagado'))
from public."5k_15k_reservas_2_cifras" r group by usuario_id
order by 1, 2 nulls first;
rollback;


-- ==========================================================================
-- R14. Simulación del panel SIN aplicar nada: qué vería la cuenta principal
-- con las políticas de la Parte A. Evalúa en SQL la misma condición
-- (usuario_id = <UUID_PRINCIPAL>) que usarán las políticas.
-- Sustituye <UUID_PRINCIPAL>. Esperado: visibles = 100 en cada tabla,
-- invisibles = filas de otros clientes (hoy 0), sin_dueno = 0.
-- ==========================================================================
begin;
set transaction read only;
select 'reservas_dos_cifras' as tabla,
       count(*) filter (where usuario_id = '<UUID_PRINCIPAL>'::uuid) as visibles,
       count(*) filter (where usuario_id <> '<UUID_PRINCIPAL>'::uuid) as invisibles,
       count(*) filter (where usuario_id is null) as sin_dueno
from public.reservas_dos_cifras
union all
select '5k_15k_reservas_2_cifras',
       count(*) filter (where usuario_id = '<UUID_PRINCIPAL>'::uuid),
       count(*) filter (where usuario_id <> '<UUID_PRINCIPAL>'::uuid),
       count(*) filter (where usuario_id is null)
from public."5k_15k_reservas_2_cifras";
rollback;


-- ==========================================================================
-- R15. SEMÁFORO de reservas para la Parte A. Una fila; TODO debe ser true.
-- Cualquier false: no aplicar A y revisar el bloque indicado.
-- Las columnas marcadas (*) no se pueden decidir solo con SQL: revisar R9
-- y R10 a mano aunque sean true.
-- ==========================================================================
begin;
set transaction read only;
with t(nombre) as (values ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')),
c as (select cl.* from pg_class cl join t on cl.relname = t.nombre
      where cl.relnamespace = 'public'::regnamespace)
select
    (select count(*) = 2 from c)                                                         as existen_las_2,            -- R1
    (select bool_and(not relforcerowsecurity) from c)                                    as sin_rls_forzado,          -- R1
    (select count(*) = 0 from pg_policies p join t on p.tablename = t.nombre
       where p.schemaname = 'public'
         and p.policyname not in ('panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas'))
                                                                                         as sin_politicas_ajenas,     -- R2
    (select count(*) = 0 from c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where a.grantee = 0)                                                              as public_sin_permisos,      -- R3
    (select count(*) = 0 from c join pg_attribute a on a.attrelid = c.oid and a.attacl is not null
       cross join lateral aclexplode(a.attacl) x
       where x.grantee = 0 or x.grantee = (select oid from pg_roles where rolname = 'anon'))
                                                                                         as sin_permisos_columna_anon,-- R4
    (select bool_and(has_table_privilege('authenticated', c.oid, 'SELECT')
                 and has_table_privilege('authenticated', c.oid, 'INSERT')
                 and has_table_privilege('authenticated', c.oid, 'UPDATE')) from c)      as panel_tiene_permisos,     -- R5
    (select bool_and(has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')) from c)
                                                                                         as bot_tiene_permisos,       -- R5
    (select rolbypassrls from pg_roles where rolname = 'service_role')                   as service_role_salta_rls,   -- R6
    (select not rolbypassrls from pg_roles where rolname = 'authenticated')
      and (select not rolbypassrls from pg_roles where rolname = 'anon')                 as anon_y_panel_sin_bypass,  -- R6
    (select count(*) = 2 from information_schema.columns
       where table_schema = 'public' and column_name = 'usuario_id' and udt_name = 'uuid'
         and table_name in (select nombre from t))                                       as usuario_id_es_uuid,       -- R7
    exists (select 1 from pg_proc where pronamespace = 'auth'::regnamespace and proname = 'uid'
              and pronargs = 0 and prorettype = 'uuid'::regtype)                         as auth_uid_existe,          -- R7
    (select (select count(*) from public.reservas_dos_cifras where usuario_id is null)
          + (select count(*) from public."5k_15k_reservas_2_cifras" where usuario_id is null) = 0)
                                                                                         as sin_filas_sin_dueno,      -- R13
    (select coalesce(bool_and(exists (select 1 from auth.users u where u.id = d.usuario_id)), true)
       from (select usuario_id from public.reservas_dos_cifras
             union select usuario_id from public."5k_15k_reservas_2_cifras") d
      where d.usuario_id is not null)                                                    as duenos_existen,           -- R13
    (select count(*) = 0 from pg_trigger tg join c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
       where not tg.tgisinternal and not p.prosecdef
         and p.prosrc ~* '(reservas_dos_cifras|5k_15k_reservas_2_cifras)')               as triggers_invoker_no_leen_reservas, -- R9 (*)
    (select count(*) = 0 from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef
         and p.prosrc ~* '(reservas_dos_cifras|5k_15k_reservas_2_cifras)'
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('authenticated', p.oid, 'EXECUTE')))             as sin_definer_abiertas,     -- R10 (*)
    (select count(*) = 0 from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
       where d.classid = 'pg_rewrite'::regclass and d.refobjid in (select oid from c)
         and v.oid not in (select oid from c)
         and has_table_privilege('anon', v.oid, 'SELECT'))                               as vistas_anon_cerradas,     -- R11
    (select count(*) filter (where activo is not false) = 0 from public.eventos_bot)    as sin_sorteos_activos;      -- R0
rollback;

-- ==========================================================================
-- Fuera de SQL (también obligatorio antes de A, ver ACTIVACION.md §2d):
--   - En CADA instancia del bot: node backend/scripts/verificarRolSupabase.js
--     debe decir service_role. Un bot con la clave anon dejaría de ver y
--     reservar números en cuanto se aplique A.
--   - Logs → API (últimos días): ninguna petición con la clave anon a
--     reservas_dos_cifras / 5k_15k_reservas_2_cifras. Una app externa que
--     escriba con anon dejará de poder hacerlo (ver reservas_otro_sorteo.md).
-- ==========================================================================
