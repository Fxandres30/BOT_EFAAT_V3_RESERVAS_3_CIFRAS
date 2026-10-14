-- ==========================================================================
-- PARTE B (NO APLICADA, NO ES UNA MIGRACIÓN) — compradores_semanales.
-- Dos bloques independientes, cada uno en su propia transacción:
--
--   B1  Pagos de clientes solo LID: el pago se guarda; el cliente sin
--       teléfono no se suma a compradores_semanales. No se inventa ningún
--       teléfono. NO toca la función heredada.
--   B2  Cerrar la lectura: hoy anon (sin sesión) lee las 1929 filas (nombre +
--       WhatsApp) y cualquier usuario del panel también. Requiere la Parte A
--       aplicada antes.
--
-- Probado en Postgres real en memoria:
--   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
--       node backend/tests/sorteos/parteBCompradores.test.js
--
-- Hechos verificados (2026-10-14, solo lectura):
--   - compradores_semanales: id integer, nombre text NOT NULL, whatsapp text
--     NOT NULL, contadores por día, total_semanal, entregados_3cifras.
--   - El trigger heredado corre con el rol de quien paga (security invoker):
--     en 2026-09 falló con "permission denied" para service_role (ver 016).
--   - Ningún código de este repositorio lee ni escribe la tabla.
-- ==========================================================================

-- ==========================================================================
-- ANTES (solo lectura, en el SQL Editor). Guarda el resultado completo: es
-- la vuelta atrás exacta de B2.
--
--   -- 1) triggers de las tablas de reservas y su función
--   select c.relname as tabla, t.tgname as trigger, p.oid::regprocedure as funcion,
--          pg_get_userbyid(p.proowner) as dueno, p.prosecdef as security_definer,
--          p.proconfig as config, pg_get_triggerdef(t.oid) as definicion_trigger
--   from pg_trigger t
--   join pg_class c on c.oid = t.tgrelid
--   join pg_proc p on p.oid = t.tgfoid
--   where c.relnamespace = 'public'::regnamespace
--     and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'compradores_semanales')
--     and not t.tgisinternal;
--
--   -- 2) cuerpo de toda función que mencione la tabla
--   select p.oid::regprocedure, pg_get_functiondef(p.oid)
--   from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%compradores_semanales%';
--
--   -- 3) privilegios actuales sobre la tabla
--   select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'compradores_semanales'
--   group by 1;
--
-- Si la consulta 1 muestra que el trigger es BEFORE y modifica NEW, o la 2
-- muestra que la función escribe whatsapp con UPDATE (no INSERT), avísame
-- antes de aplicar: B1 está pensado para un INSERT/UPSERT.
-- ==========================================================================


-- ==========================================================================
-- B1 — omitir (no insertar) filas sin whatsapp. Una sola transacción.
--
-- Cómo funciona: un trigger BEFORE INSERT en compradores_semanales que
-- devuelve NULL cuando whatsapp es NULL. Postgres entonces no inserta esa
-- fila (también con INSERT ... ON CONFLICT) y no lanza error, así que el
-- UPDATE a 'pagado' de la reserva se completa. Las filas con teléfono siguen
-- exactamente igual. whatsapp = '' (vacío) no se toca: hoy ya se inserta.
-- ==========================================================================

begin;

create or replace function public.compradores_semanales_omitir_sin_whatsapp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin

    if new.whatsapp is null then
        -- Sin datos personales en el log.
        raise warning 'compradores_semanales: compra omitida, comprador sin telefono (solo LID)';
        return null;
    end if;

    return new;

end;
$$;

revoke all on function public.compradores_semanales_omitir_sin_whatsapp() from public, anon, authenticated;

drop trigger if exists omitir_sin_whatsapp on public.compradores_semanales;

create trigger omitir_sin_whatsapp
    before insert on public.compradores_semanales
    for each row execute function public.compradores_semanales_omitir_sin_whatsapp();

commit;

-- DESPUÉS (B1):
--   select tgname, tgenabled from pg_trigger
--   where tgrelid = 'public.compradores_semanales'::regclass and not tgisinternal;
--   -> omitir_sin_whatsapp | O
--   Prueba real: el siguiente pago por sticker de un cliente solo LID debe
--   quedar 'pagado' (log "[PAGO-STICKER]" sin "Pago NO guardado").
--
-- VUELTA ATRÁS (B1):
--   begin;
--   drop trigger if exists omitir_sin_whatsapp on public.compradores_semanales;
--   drop function if exists public.compradores_semanales_omitir_sin_whatsapp();
--   commit;


-- ==========================================================================
-- B2 — cerrar compradores_semanales a anon y authenticated. Una sola
-- transacción. APLICAR SOLO DESPUÉS DE LA PARTE A (con la Parte A, anon ya
-- no puede marcar pagos, así que el trigger nunca corre como anon).
--
-- Problema: el trigger heredado corre con el rol de quien paga. Si el panel
-- (authenticated) paga y se le quita el permiso, el pago FALLA. Por eso,
-- antes de quitar permisos, la función heredada pasa a SECURITY DEFINER
-- (corre con los permisos de su dueño). No se cambia su código.
--
-- Guardias (si alguna falla, se revierte todo y no cambia nada):
--   - debe existir EXACTAMENTE UNA función de trigger de las tablas de
--     reservas que mencione compradores_semanales;
--   - su dueño debe poder leer/insertar/actualizar compradores_semanales.
-- ==========================================================================

begin;

do $$
declare
    n integer;
    f regprocedure;
    dueno name;
begin

    select count(distinct p.oid) into n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
      and not t.tgisinternal
      and p.prosrc ilike '%compradores_semanales%';

    if n <> 1 then
        raise exception 'B2 abortado: se esperaba 1 función de trigger que escriba en compradores_semanales y hay %. Revisar a mano.', n;
    end if;

    select distinct p.oid::regprocedure, pg_get_userbyid(p.proowner)
      into f, dueno
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
      and not t.tgisinternal
      and p.prosrc ilike '%compradores_semanales%';

    -- Con varios privilegios en una sola llamada, has_table_privilege da
    -- true si tiene CUALQUIERA: se comprueban uno por uno.
    if not (has_table_privilege(dueno, 'public.compradores_semanales', 'SELECT')
            and has_table_privilege(dueno, 'public.compradores_semanales', 'INSERT')
            and has_table_privilege(dueno, 'public.compradores_semanales', 'UPDATE')) then
        raise exception 'B2 abortado: el dueño (%) de % no tiene permisos sobre compradores_semanales.', dueno, f;
    end if;

    raise notice 'B2: % (dueño %) pasa a SECURITY DEFINER', f, dueno;

    execute format('alter function %s security definer', f);
    execute format('alter function %s set search_path = public, extensions, pg_temp', f);

end $$;

revoke all on table public.compradores_semanales from anon, authenticated;

do $$
declare
    seq text;
begin
    seq := pg_get_serial_sequence('public.compradores_semanales', 'id');
    if seq is not null then
        execute format('revoke all on sequence %s from anon, authenticated', seq);
    end if;
end $$;

commit;

-- DESPUÉS (B2):
--   - Con la clave anon y sin sesión: GET /rest/v1/compradores_semanales -> 401/403.
--   - Con la sesión del panel: marcar un número como pagado desde Tablas
--     (un número de prueba) debe funcionar igual que antes.
--   - Pago por sticker (bot, service_role): igual que antes.
--   - select p.oid::regprocedure, p.prosecdef, p.proconfig from pg_proc p
--     where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%compradores_semanales%';
--     -> la función del trigger con prosecdef = true.
--
-- VUELTA ATRÁS (B2) — sustituir <funcion> por el valor de la consulta 1
-- de ANTES (columna "funcion") y los GRANT por los de la consulta 3:
--   begin;
--   alter function <funcion> security invoker;
--   alter function <funcion> reset search_path;
--   grant all on table public.compradores_semanales to anon, authenticated;  -- o lo guardado
--   -- y, si existe la secuencia: grant all on sequence <secuencia> to anon, authenticated;
--   commit;
-- ==========================================================================
