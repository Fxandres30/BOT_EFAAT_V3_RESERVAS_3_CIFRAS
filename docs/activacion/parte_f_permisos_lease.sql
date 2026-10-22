-- ==========================================================================
-- PARTE F (NO APLICADA, NO ES UNA MIGRACIÓN) — solo el bot puede usar las
-- funciones de lease de la migración 004.
--
-- HALLAZGO (revisión 2026-10-21, reproducido en Postgres local, sin
-- confirmar en producción): la 004 crea tres funciones SECURITY DEFINER y
-- nunca revoca EXECUTE. En Postgres una función nueva es ejecutable por
-- PUBLIC, y Supabase además la concede a anon y authenticated por defecto.
-- Con eso, cualquiera con la clave pública y un session_id puede, vía
-- /rest/v1/rpc:
--   1. lease_sesiones_acquire(id, 'x', 1)  -> le devuelve el owner_id del
--      lease vigente (aunque no lo adquiera);
--   2. lease_sesiones_release(id, <owner>) -> borra el lease del bot;
--   3. lease_sesiones_acquire(id, 'otro', 86400) -> se queda el lease.
-- El heartbeat del bot falla, el bot cierra el socket y no puede volver a
-- adquirirlo: bot sordo. La RLS de sesiones_lease no protege nada aquí,
-- porque las funciones son SECURITY DEFINER (corren como su dueño).
--
-- QUIÉN LAS USA DE VERDAD (verificado en el código, 2026-10-21):
--   - solo backend/services/baileys/lease.js (acquire, heartbeat, release),
--     llamado por services/baileys/manager.js y desconectado.js;
--   - con el cliente de backend/lib/supabase.js, creado con
--     SUPABASE_SERVICE_ROLE_KEY -> PostgREST ejecuta como service_role;
--   - lo mismo en LOCAL y en el VPS (mismo código).
--   - El panel, las rutas de servidor del panel y cualquier otro código NO
--     llaman estas funciones. saludSesionesController y
--     sessionsAdminController leen la TABLA sesiones_lease (service_role),
--     no las funciones: esta parte no les afecta.
--
-- ⚠️ CONDICIÓN PREVIA en CADA instancia del bot (VPS y LOCAL): que su clave
-- sea realmente de service_role. Sin mostrar la clave:
--       node backend/scripts/verificarRolSupabase.js
-- Debe decir "rol declarado: service_role". Si una instancia usara la
-- clave anon, HOY funciona (las funciones están abiertas) y tras esta parte
-- el bot de esa instancia no podría adquirir el lease ni conectar WhatsApp.
--
-- QUÉ HACE: en las 3 firmas exactas de la 004 —
--   lease_sesiones_acquire(uuid, text, integer)
--   lease_sesiones_heartbeat(uuid, text, integer)
--   lease_sesiones_release(uuid, text)
-- revoca todo a PUBLIC, anon y authenticated y concede EXECUTE a
-- service_role. No toca ninguna otra función, ni la tabla, ni los permisos
-- por defecto del esquema.
--
-- QUÉ NO HACE (y por qué):
--   - No cambia ALTER DEFAULT PRIVILEGES: afectaría a todas las funciones
--     futuras de otros módulos. Consecuencia: si alguien vuelve a ejecutar la
--     004 (hace DROP + CREATE de acquire), acquire vuelve a quedar abierta.
--     Tras cualquier re-ejecución de la 004, repetir esta Parte F.
--     (CREATE OR REPLACE conserva los permisos; DROP + CREATE no.)
--   - No modifica el cuerpo de las funciones: acquire seguirá devolviendo el
--     owner_id actual a quien la llame, pero ya solo la llama el bot.
--
-- Independiente de las Partes A, B, C, D y E: se puede aplicar antes o
-- después, en su propia ventana. Prueba local (Postgres en memoria, NO
-- valida la base real): backend/tests/seguridad/parteFLease.test.js.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- ANTES (solo lectura) — ejecutar y GUARDAR el resultado: es la vuelta
-- atrás exacta. Muestra TODAS las variantes con ese nombre en CUALQUIER
-- esquema, con su ACL completa y el permiso efectivo de cada rol.
--
--   set transaction read only;
--   select n.nspname as esquema, p.proname, pg_get_function_identity_arguments(p.oid) as argumentos,
--          pg_get_userbyid(p.proowner) as dueno, p.prosecdef as security_definer,
--          coalesce(p.proacl::text, '(por defecto: PUBLIC ejecuta)') as acl,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_ejecuta,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_ejecuta,
--          has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_role_ejecuta
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname like 'lease\_sesiones\_%'
--   order by 1, 2, 3;
--
-- Esperado: exactamente 3 filas en el esquema public (las 3 firmas de
-- arriba), security_definer = true y, si el hallazgo se confirma,
-- anon_ejecuta = authenticated_ejecuta = true. Si aparece cualquier otra
-- variante (otros argumentos u otro esquema expuesto por la API), esta
-- parte ABORTA sola: revisarla a mano antes.
--
-- Permisos por defecto del esquema (informativo; esta parte no los cambia):
--   set transaction read only;
--   select pg_get_userbyid(d.defaclrole) as para_objetos_de, d.defaclobjtype as tipo, d.defaclacl::text as acl
--   from pg_default_acl d
--   where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'f';
-- --------------------------------------------------------------------------

begin;

-- Guardia 1: las 3 funciones existen con su firma exacta, y no hay NINGUNA
-- otra variante con ese prefijo en public (una sobrecarga quedaría abierta).
do $$
declare
    faltan text;
    extra  text;
begin
    select string_agg(f, ', ') into faltan
    from unnest(array[
        'public.lease_sesiones_acquire(uuid, text, integer)',
        'public.lease_sesiones_heartbeat(uuid, text, integer)',
        'public.lease_sesiones_release(uuid, text)'
    ]) as f
    where to_regprocedure(f) is null;

    if faltan is not null then
        raise exception 'Parte F abortada: no existen estas funciones con esa firma: %', faltan;
    end if;

    select string_agg(format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ', ') into extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname like 'lease\_sesiones\_%'
      and n.nspname not in ('pg_catalog', 'information_schema')
      and p.oid not in (
          'public.lease_sesiones_acquire(uuid, text, integer)'::regprocedure,
          'public.lease_sesiones_heartbeat(uuid, text, integer)'::regprocedure,
          'public.lease_sesiones_release(uuid, text)'::regprocedure
      );

    if extra is not null then
        raise exception 'Parte F abortada: hay variantes no previstas (revisarlas y decidir sus permisos): %', extra;
    end if;

    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        raise exception 'Parte F abortada: no existe el rol service_role.';
    end if;
end $$;

-- Cierre: nadie salvo el dueño y service_role.
revoke all on function public.lease_sesiones_acquire(uuid, text, integer)   from public, anon, authenticated;
revoke all on function public.lease_sesiones_heartbeat(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.lease_sesiones_release(uuid, text)            from public, anon, authenticated;

grant execute on function public.lease_sesiones_acquire(uuid, text, integer)   to service_role;
grant execute on function public.lease_sesiones_heartbeat(uuid, text, integer) to service_role;
grant execute on function public.lease_sesiones_release(uuid, text)            to service_role;

-- Validación dentro de la misma transacción: permiso EFECTIVO (incluye la
-- herencia de PUBLIC y de cualquier rol del que anon/authenticated sean
-- miembros). Si algo no cuadra, se aborta y no queda nada aplicado.
do $$
declare
    f regprocedure;
    malos text := '';
begin
    foreach f in array array[
        'public.lease_sesiones_acquire(uuid, text, integer)'::regprocedure,
        'public.lease_sesiones_heartbeat(uuid, text, integer)'::regprocedure,
        'public.lease_sesiones_release(uuid, text)'::regprocedure
    ] loop
        if has_function_privilege('anon', f, 'EXECUTE') then malos := malos || f::text || ' (anon) '; end if;
        if has_function_privilege('authenticated', f, 'EXECUTE') then malos := malos || f::text || ' (authenticated) '; end if;
        if not has_function_privilege('service_role', f, 'EXECUTE') then malos := malos || f::text || ' (service_role SIN permiso) '; end if;
    end loop;

    if malos <> '' then
        raise exception 'Parte F abortada en la validación: %', malos;
    end if;
end $$;

-- Aviso (no aborta): la tabla debe seguir con RLS y sin políticas, para que
-- tampoco se pueda leer/escribir directamente.
do $$
begin
    if not (select relrowsecurity from pg_class where oid = 'public.sesiones_lease'::regclass) then
        raise warning 'sesiones_lease tiene RLS DESACTIVADO: anon podría leerla/escribirla directamente. Revisar aparte.';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sesiones_lease') then
        raise warning 'sesiones_lease tiene políticas RLS: revisar que ninguna abra acceso a anon/authenticated.';
    end if;
end $$;

commit;

-- ==========================================================================
-- DESPUÉS (solo lectura):
--   1. Repetir la consulta ANTES: anon_ejecuta = authenticated_ejecuta =
--      false y service_role_ejecuta = true en las 3. acl sin "=X/" (PUBLIC)
--      ni anon/authenticated.
--   2. En los logs del bot (VPS): siguen apareciendo "💓 [LEASE] heartbeat"
--      cada ~7 s y NO aparece "❌ [LEASE] error en heartbeat ... permission
--      denied". En /sesiones la tarjeta sigue «Saludable».
--   3. Prueba anónima (opcional, desde una terminal; usa solo la clave
--      PÚBLICA del panel y un UUID inventado, nunca uno real):
--        curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/lease_sesiones_acquire" \
--          -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
--          -d '{"p_session_id":"00000000-0000-4000-8000-000000000000","p_owner_id":"prueba","p_ttl_seconds":1}'
--      Esperado: error de permiso (42501 / "permission denied for function").
--
-- VUELTA ATRÁS (una transacción). Restaura el estado por defecto de
-- Supabase (PUBLIC, anon, authenticated y service_role con EXECUTE). Si la
-- consulta ANTES mostró otra ACL, restaurar EXACTAMENTE esa en su lugar.
--   begin;
--   grant execute on function public.lease_sesiones_acquire(uuid, text, integer)   to public, anon, authenticated, service_role;
--   grant execute on function public.lease_sesiones_heartbeat(uuid, text, integer) to public, anon, authenticated, service_role;
--   grant execute on function public.lease_sesiones_release(uuid, text)            to public, anon, authenticated, service_role;
--   commit;
-- La vuelta atrás vuelve a abrir el hallazgo: solo si el bot dejó de
-- adquirir el lease por esta parte.
-- ==========================================================================
