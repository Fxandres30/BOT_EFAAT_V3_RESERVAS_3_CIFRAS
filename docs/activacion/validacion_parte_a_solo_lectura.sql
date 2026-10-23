-- ==========================================================================
-- VALIDACIÓN DE LA PARTE A — SOLO LECTURA (preparado el 2026-10-21)
--
-- Contexto: la 027 abortó con "reservas_dos_cifras no tiene RLS. Aplica y
-- valida antes la Parte A." Es la guardia funcionando: la 027 NO se vuelve a
-- ejecutar ni se toca su comprobación hasta que V3 dé "027_podria_pasar".
--
-- ⚠️  SOLO LECTURA. Ningún bloque aplica nada. La Parte A está en
--     propuesta_rls_tablas_antiguas.sql y se ejecuta APARTE, con autorización.
--
-- CÓMO USARLO (Supabase → SQL Editor), un bloque cada vez:
--   P0       ANTES de la Parte A (junto con diagnostico_rls_solo_lectura.sql).
--   V1–V6    DESPUÉS de la Parte A.
--   Los bloques V4/V5 simulan un rol dentro de una transacción de solo
--   lectura que termina en ROLLBACK: no dejan nada cambiado.
--   Sustituye <UUID_PRINCIPAL> por el usuario_id de la cuenta principal
--   (sale en D13/D15).
-- ==========================================================================


-- ==========================================================================
-- P0. Semáforo previo a la Parte A. Una sola fila.
-- Esperado: TODAS las columnas en true. Si alguna es false, NO aplicar A:
--   sin_sorteos_activos      D0: hay un sorteo en curso.
--   sin_filas_sin_dueno      D12: filas con usuario_id nulo dejarían de verse.
--   duenos_existen           D13: usuario_id que no es ninguna cuenta.
--   sin_politicas_ajenas     D2b: la Parte A abortaría sola.
--   usuario_id_es_uuid       D7: las políticas compararían uuid con otro tipo.
--   sin_rls_forzado          D1: el dueño de la tabla también quedaría sujeto.
--   public_sin_permisos      D3: si PUBLIC tiene permisos, anon los hereda y la
--                            guardia de la 027 seguirá abortando tras A.
--   service_role_salta_rls   D6: el bot dejaría de ver filas.
--   vistas_anon_cerradas     D9: una vista legible por anon salta la RLS.
-- ==========================================================================
set transaction read only;
with tablas(nombre) as (
    values ('eventos_bot'), ('sesiones'), ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')
),
duenos as (
    select usuario_id from public.eventos_bot
    union select usuario_id from public.sesiones
    union select usuario_id from public.reservas_dos_cifras
    union select usuario_id from public."5k_15k_reservas_2_cifras"
)
select
    (select count(*) filter (where activo) = 0 from public.eventos_bot)                         as sin_sorteos_activos,
    (select (select count(*) from public.eventos_bot where usuario_id is null)
          + (select count(*) from public.sesiones where usuario_id is null)
          + (select count(*) from public.reservas_dos_cifras where usuario_id is null)
          + (select count(*) from public."5k_15k_reservas_2_cifras" where usuario_id is null) = 0) as sin_filas_sin_dueno,
    (select bool_and(exists (select 1 from auth.users u where u.id = d.usuario_id))
       from duenos d where d.usuario_id is not null)                                            as duenos_existen,
    (select count(*) = 0 from pg_policies
       where schemaname = 'public'
         and tablename in (select nombre from tablas)
         and policyname not in ('panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas',
                                'panel lee sus eventos', 'panel lee sus sesiones', 'panel crea sus sesiones',
                                'panel modifica sus sesiones', 'panel borra sus sesiones'))             as sin_politicas_ajenas,
    (select count(*) = 4 from information_schema.columns
       where table_schema = 'public' and column_name = 'usuario_id' and udt_name = 'uuid'
         and table_name in (select nombre from tablas))                                         as usuario_id_es_uuid,
    (select count(*) = 4 and bool_and(not relforcerowsecurity) from pg_class
       where relnamespace = 'public'::regnamespace and relname in (select nombre from tablas))   as sin_rls_forzado,
    (select count(*) = 0 from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.relnamespace = 'public'::regnamespace and c.relname in (select nombre from tablas)
         and a.grantee = 0)                                                                     as public_sin_permisos,
    (select rolbypassrls from pg_roles where rolname = 'service_role')                          as service_role_salta_rls,
    (select coalesce(bool_and(not has_table_privilege('anon', format('%I.%I', v.view_schema, v.view_name), 'SELECT')), true)
       from information_schema.view_table_usage v
       where v.table_schema = 'public' and v.table_name in (select nombre from tablas))         as vistas_anon_cerradas;


-- ==========================================================================
-- V1. Estado de RLS y políticas tras la Parte A.
-- Esperado: 4 filas, rls_activo = true, rls_forzado = false, y en
--   politicas exactamente:
--     reservas_dos_cifras / 5k_15k: panel lee sus reservas, panel
--       modifica sus reservas                                       (2)
--     eventos_bot: panel lee sus eventos                             (1)
--     sesiones: panel crea/lee/modifica sus sesiones                 (3)
--   Todas con roles {authenticated}. Ninguna con roles public/anon.
--   (Auditoría integral 2026-10-22: la Parte A ya no crea "panel crea su
--   tabla" ni "panel borra sus sesiones". Puede haber además políticas
--   solo de service_role o de propietario conservadas: ver el bloque
--   "politicas" de validacion_final_aislamiento_solo_lectura.sql.)
-- ==========================================================================
set transaction read only;
select c.relname as tabla, c.relrowsecurity as rls_activo, c.relforcerowsecurity as rls_forzado,
       (select string_agg(format('%s [%s → %s]', p.policyname, p.cmd, array_to_string(p.roles, ',')), '; ' order by p.policyname)
          from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('eventos_bot', 'sesiones', 'reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1;


-- ==========================================================================
-- V2. Permisos efectivos tras la Parte A (mismo formato que D5).
-- Esperado:
--   anon:          false en las 4 columnas de las 4 tablas.
--   authenticated: igual que en D5 ANTES (la RLS limita filas, no permisos).
--   service_role:  true en las 4 tablas (el bot; A no lo toca).
-- ==========================================================================
set transaction read only;
select r.rol, t.tabla,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'SELECT') as leer,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'INSERT') as insertar,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'UPDATE') as actualizar,
       has_table_privilege(r.rol, format('public.%I', t.tabla), 'DELETE') as borrar
from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
cross join (values ('eventos_bot'), ('sesiones'), ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')) as t(tabla)
order by 1, 2;


-- ==========================================================================
-- V3. La guardia de la 027, evaluada SIN ejecutar la 027.
-- Reproduce sus 4 comprobaciones sobre las 2 tablas físicas.
-- Esperado: 2 filas con resultado = '027_podria_pasar'. Cualquier otro valor
--   es el motivo exacto por el que la 027 volvería a abortar.
-- ==========================================================================
set transaction read only;
select t.tabla,
       case
           when to_regclass(format('public.%I', t.tabla)) is null then 'falta_tabla'
           when not (select relrowsecurity from pg_class where oid = to_regclass(format('public.%I', t.tabla))) then 'sin_rls'
           when (select count(*) from pg_policies p
                   where p.schemaname = 'public' and p.tablename = t.tabla
                     and p.policyname in ('panel lee sus reservas', 'panel modifica sus reservas')) <> 2
               then 'faltan_politicas'
           when has_table_privilege('anon', format('public.%I', t.tabla), 'select, insert, update, delete') then 'anon_conserva_permisos'
           else '027_podria_pasar'
       end as resultado
from (values ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')) as t(tabla);


-- ==========================================================================
-- V4. Simulación anon (sin sesión). Ejecutar el bloque entero.
-- Esperado: ERROR 42501 "permission denied for table sesiones".
--   Ese error ES el resultado correcto. Si devuelve filas: A no está activa.
--   (Repetible cambiando la tabla por las otras 3.)
-- ==========================================================================
begin;
set transaction read only;
set local role anon;
select count(*) from public.sesiones;
rollback;


-- ==========================================================================
-- V5a. Simulación del panel con la cuenta principal (rol authenticated).
-- Esperado: los MISMOS conteos que D13 para <UUID_PRINCIPAL>, y
--   ajenas = 0 en las 4 tablas.
-- ==========================================================================
begin;
set transaction read only;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID_PRINCIPAL>', 'role', 'authenticated')::text, true);
select 'eventos_bot' as tabla, count(*) as visibles, count(*) filter (where usuario_id <> auth.uid()) as ajenas from public.eventos_bot
union all select 'sesiones', count(*), count(*) filter (where usuario_id <> auth.uid()) from public.sesiones
union all select 'reservas_dos_cifras', count(*), count(*) filter (where usuario_id <> auth.uid()) from public.reservas_dos_cifras
union all select '5k_15k_reservas_2_cifras', count(*), count(*) filter (where usuario_id <> auth.uid()) from public."5k_15k_reservas_2_cifras";
rollback;

-- V5b. Igual con un usuario inexistente. Esperado: visibles = 0 en las 4.
begin;
set transaction read only;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
select 'eventos_bot' as tabla, count(*) as visibles from public.eventos_bot
union all select 'sesiones', count(*) from public.sesiones
union all select 'reservas_dos_cifras', count(*) from public.reservas_dos_cifras
union all select '5k_15k_reservas_2_cifras', count(*) from public."5k_15k_reservas_2_cifras";
rollback;


-- ==========================================================================
-- V6. Datos intactos: repetir D12, D15 y D11 de diagnostico_rls_solo_lectura
-- y comparar con lo guardado ANTES. Esperado: idénticos (la Parte A no
-- modifica filas ni la publicación de Realtime). Si D15 cambia por actividad
-- normal (un pago entre medias), comprobar que filas y numeros_distintos
-- siguen iguales.
-- ==========================================================================
