-- ==========================================================================
-- 034 — compradores_semanales CON DUEÑO (cliente de EFAAT) Y CONTADORES
-- SEPARADOS POR CLIENTE
--
-- PREPARADA EL 2026-10-22. NO APLICADA. Requiere autorización expresa.
-- Revisada en la auditoría integral (2026-10-22, §2f).
--
-- Contexto (producción 2026-10-22): un trigger heredado de las tablas de
-- reservas (función actualizar_compradores_semanales) escribe en
-- compradores_semanales al marcar un pago. La tabla no tiene columna de
-- cliente (id, nombre, whatsapp, lunes..domingo, total_semanal,
-- entregados_3cifras), anon lee sus 1930 filas y ningún código del
-- repositorio la lee ni la escribe. Los contadores se agrupan SOLO por
-- teléfono: si el mismo comprador paga a dos clientes, la función heredada
-- suma en la misma fila.
--
-- Qué hace SIN reescribir el código heredado (no se desactiva ningún
-- trigger ni se cambia la lógica de los contadores):
--   1. Columna usuario_id (uuid, nullable) + índice.
--   2. Cliente del pago: un trigger BEFORE de fila en las 2 tablas de
--      reservas guarda en una variable de la transacción el usuario_id de la
--      fila modificada (si una misma sentencia toca filas de varios clientes,
--      queda "mixto" y no se atribuye). Un trigger AFTER de sentencia la
--      limpia. Los triggers AFTER de fila (el heredado) se ejecutan antes que
--      los de sentencia: ven el cliente correcto.
--   3. En compradores_semanales (trigger BEFORE de fila):
--        - INSERT: la fila nueva recibe el cliente del pago;
--        - UPDATE de una fila de OTRO cliente: se OMITE (la fila ajena no
--          cambia). Así, cuando la función heredada busca por teléfono, solo
--          suma en la fila del cliente que cobra; si ese cliente aún no tenía
--          fila, la función heredada no la encuentra y crea una nueva (que el
--          punto anterior marca con su dueño). El mismo comprador queda, por
--          tanto, con una fila independiente por cliente;
--        - UPDATE de una fila histórica SIN dueño: solo si el pago es del
--          ÚNICO cliente que tenía actividad al aplicar la 034 (evidencia
--          registrada: la cuenta principal, que generó ese histórico). Para
--          cualquier otro cliente se omite y se le crea su fila: nadie cambia
--          los contadores históricos de otro. Si la evidencia no muestra un
--          único cliente, nadie los actualiza. No se asigna dueño por
--          suposición; hacerlo es el paso explícito y verificable
--          docs/activacion/asignacion_compradores_historicos.sql.
--      Sin cliente identificado (pago "mixto" o actualización que no viene de
--      una reserva) todo pasa como hoy.
--   4. RLS activada y sin políticas: nadie la lee desde el navegador (el
--      panel no la usa). El bot/backend (service_role) y la función heredada
--      (SECURITY DEFINER tras la Parte B2) no se ven afectados.
--   5. Registra la evidencia (id máximo de las filas existentes y clientes
--      con sorteos o reservas no libres) que usan 3 y la asignación.
--
-- LÍMITE CONOCIDO (sin el código real no se puede garantizar más): la
-- separación depende de que la función heredada busque por teléfono y, si no
-- encuentra fila, inserte. Si en cambio usara INSERT ... ON CONFLICT
-- (whatsapp), necesitaría UNIQUE(whatsapp) y la guardia de abajo ABORTA; si
-- eligiera una fila por id, una compra de un cliente sin fila propia no
-- sumaría en ninguna (nunca en la de otro cliente). El código lo enseña el
-- bloque B_funcion_heredada del diagnóstico.
--
-- REQUISITOS (guardias; si una falla, no cambia nada):
--   - Parte B2 aplicada: TODA función de trigger de las reservas que mencione
--     compradores_semanales es SECURITY DEFINER, su cuerpo (md5) es el que
--     revisó la B2 y su dueño puede escribir aunque la tabla tenga RLS (es su
--     dueño o salta la RLS).
--   - Ninguna unicidad de compradores_semanales sin usuario_id (impediría la
--     fila independiente de cada cliente y el pago fallaría).
--   - Ningún otro trigger BEFORE de las reservas se ejecuta antes del marcador.
--   - Las 2 tablas de reservas tienen usuario_id uuid.
-- Pruebas: backend/tests/seguridad/aislamientoMulticliente.test.js y
-- backend/tests/seguridad/auditoriaIntegral.test.js
-- ==========================================================================

begin;

set local lock_timeout = '5s';

-- >>> efaat_admin (bloque común: idéntico en todas las piezas) >>>
-- Registro de lo que cada pieza elimina o concede (respaldo para revertir).
-- Esquema fuera de la API: PostgREST solo publica "public". Nadie salvo el
-- dueño (postgres) lo usa: ni anon, ni authenticated, ni service_role.
create schema if not exists efaat_admin;
revoke all on schema efaat_admin from public, anon, authenticated, service_role;
create table if not exists efaat_admin.cambios_seguridad (
    id bigserial primary key,
    paso text not null,
    objeto text not null,
    accion text not null,
    detalle jsonb,
    en timestamptz not null default now()
);
alter table efaat_admin.cambios_seguridad enable row level security;
revoke all on table efaat_admin.cambios_seguridad from public, anon, authenticated, service_role;
do $$
declare
    seq text := pg_get_serial_sequence('efaat_admin.cambios_seguridad', 'id');
    r text;
begin
    if (select nspowner from pg_namespace where nspname = 'efaat_admin') <> (select oid from pg_roles where rolname = current_user) then
        raise exception 'efaat_admin pertenece a otro rol: revisarlo antes de seguir';
    end if;
    if seq is not null then
        execute format('revoke all on sequence %s from public, anon, authenticated, service_role', seq);
    end if;
    if exists (select 1 from pg_roles x cross join lateral unnest(coalesce(x.rolconfig, '{}'::text[])) c
               where x.rolname = 'authenticator' and c ilike 'pgrst.db_schemas=%efaat_admin%') then
        raise exception 'efaat_admin está expuesto por la API (pgrst.db_schemas): quitarlo antes de seguir';
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
        if has_schema_privilege(r, 'efaat_admin', 'USAGE')
           or has_table_privilege(r, 'efaat_admin.cambios_seguridad', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
            raise exception 'efaat_admin.cambios_seguridad accesible para %', r;
        end if;
    end loop;
end $$;
-- <<< efaat_admin <<<

do $$
declare
    n integer;
    invoker text;
    sin_permiso text;
    cambiadas text;
    unicas text;
    antes_marcador text;
    t text;
begin
    if to_regclass('public.compradores_semanales') is null then
        raise exception '034 abortada: no existe compradores_semanales';
    end if;

    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop
        if not exists (select 1 from pg_attribute where attrelid = to_regclass(format('public.%I', t))
                       and attname = 'usuario_id' and atttypid = 'uuid'::regtype and not attisdropped) then
            raise exception '034 abortada: %.usuario_id no es uuid', t;
        end if;
    end loop;

    select count(distinct p.oid),
           string_agg(distinct p.oid::regprocedure::text, ', ') filter (where not p.prosecdef),
           string_agg(distinct p.oid::regprocedure::text, ', ') filter (
               where (select r.oid from pg_roles r where r.oid = p.proowner)
                     <> (select relowner from pg_class where oid = 'public.compradores_semanales'::regclass)
                 and not coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.oid = p.proowner), false)),
           string_agg(distinct p.oid::regprocedure::text, ', ') filter (
               where not exists (select 1 from efaat_admin.cambios_seguridad cs
                                 where cs.paso = 'parte_b2' and cs.objeto = p.oid::regprocedure::text
                                   and cs.detalle->>'md5_cuerpo' = md5(p.prosrc)))
      into n, invoker, sin_permiso, cambiadas
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_proc p on p.oid = tg.tgfoid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
      and not tg.tgisinternal
      and p.prosrc ilike '%compradores_semanales%';

    if n = 0 then
        raise exception '034 abortada: no hay trigger de reservas que escriba en compradores_semanales (revisar a mano)';
    end if;
    if invoker is not null then
        raise exception '034 abortada: % no es SECURITY DEFINER. Aplica antes la Parte B2.', invoker;
    end if;
    if sin_permiso is not null then
        raise exception '034 abortada: el dueño de % no es el de compradores_semanales ni salta la RLS (los pagos fallarían)', sin_permiso;
    end if;
    if cambiadas is not null then
        raise exception '034 abortada: el cuerpo de % no es el que revisó la Parte B2 (o la B2 no consta)', cambiadas;
    end if;

    if (select relforcerowsecurity from pg_class where oid = 'public.compradores_semanales'::regclass) then
        raise exception '034 abortada: compradores_semanales tiene RLS forzada';
    end if;

    select string_agg(pg_get_indexdef(x.indexrelid), '; ') into unicas
    from pg_index x
    where x.indrelid = 'public.compradores_semanales'::regclass and x.indisunique and not x.indisprimary
      and not exists (select 1 from pg_attribute a where a.attrelid = x.indrelid and a.attname = 'usuario_id'
                      and a.attnum = any (x.indkey::smallint[]));
    if unicas is not null then
        raise exception '034 abortada: compradores_semanales tiene unicidades sin usuario_id (%): revisar el código heredado antes', unicas;
    end if;

    select string_agg(format('%s.%s', tg.tgrelid::regclass, tg.tgname), ', ') into antes_marcador
    from pg_trigger tg
    where tg.tgrelid in ('public.reservas_dos_cifras'::regclass, 'public."5k_15k_reservas_2_cifras"'::regclass)
      and not tg.tgisinternal
      and (tg.tgtype & 2) = 2            -- BEFORE
      and (tg.tgtype & 1) = 1            -- FOR EACH ROW
      and tg.tgname <> '000_efaat_cliente_pago'
      and tg.tgname::text collate "C" < '000_efaat_cliente_pago';
    if antes_marcador is not null then
        raise exception '034 abortada: triggers que se ejecutarían antes del marcador de cliente: %', antes_marcador;
    end if;
end $$;

-- 1. Columna de cliente
alter table public.compradores_semanales add column if not exists usuario_id uuid;
create index if not exists compradores_semanales_usuario_idx on public.compradores_semanales (usuario_id);

-- 2. Cliente del pago en curso (variable local de la transacción)
create or replace function public.efaat_cliente_pago_marcar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    actual text := nullif(current_setting('efaat.cliente_pago', true), '');
begin
    if new.usuario_id is not null then
        if actual is null then
            perform set_config('efaat.cliente_pago', new.usuario_id::text, true);
        elsif actual <> new.usuario_id::text then
            perform set_config('efaat.cliente_pago', 'mixto', true);
        end if;
    end if;
    return new;
end;
$$;

create or replace function public.efaat_cliente_pago_limpiar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    perform set_config('efaat.cliente_pago', '', true);
    return null;
end;
$$;

-- 3a. Evidencia de quién tenía actividad al aplicar la 034 (solo la primera
-- vez: una reejecución no la sustituye). La usa 3b y la asignación explícita
-- (docs/activacion/asignacion_compradores_historicos.sql).
insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
select '034', 'compradores_semanales', 'historico_sin_dueno', jsonb_build_object(
    'id_maximo', (select max(id) from public.compradores_semanales),
    'filas_sin_dueno', (select count(*) from public.compradores_semanales where usuario_id is null),
    'duenos_con_actividad', (
        select coalesce(jsonb_agg(distinct u order by u), '[]'::jsonb) from (
            select usuario_id::text u from public.reservas_dos_cifras where estado is distinct from 'libre' and usuario_id is not null
            union select usuario_id::text from public."5k_15k_reservas_2_cifras" where estado is distinct from 'libre' and usuario_id is not null
            union select usuario_id::text from public.eventos_bot where usuario_id is not null
        ) d))
where not exists (select 1 from efaat_admin.cambios_seguridad where paso = '034' and accion = 'historico_sin_dueno');

-- 3b. Dueño en compradores_semanales; filas ajenas e históricas intactas.
-- Las filas históricas (sin dueño) solo las puede actualizar el ÚNICO cliente
-- con actividad según la evidencia de 3a (la cuenta principal, que es quien
-- las generó). Para cualquier otro cliente se omiten y la función heredada
-- le crea su propia fila. Si la evidencia no muestra exactamente un cliente,
-- nadie las actualiza (quedan congeladas, no se borran ni se asignan).
do $do$
declare
    ev jsonb;
    v_hist text;
begin
    select detalle into ev from efaat_admin.cambios_seguridad
    where paso = '034' and accion = 'historico_sin_dueno' order by id limit 1;
    v_hist := case when jsonb_array_length(ev->'duenos_con_actividad') = 1 then ev->'duenos_con_actividad'->>0 end;

    execute format($f$
create or replace function public.efaat_compradores_semanales_cliente()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
    cliente text := nullif(current_setting('efaat.cliente_pago', true), '');
    -- Único cliente con actividad al aplicar la 034 (NULL si no había uno solo).
    historico text := %L;
begin
    if cliente = 'mixto' then
        cliente := null;
    end if;

    if tg_op = 'INSERT' then
        if new.usuario_id is null and cliente is not null then
            new.usuario_id := cliente::uuid;
        end if;
        return new;
    end if;

    -- UPDATE sin cliente identificado (no viene de un pago): como hoy.
    if cliente is null then
        return new;
    end if;

    -- Fila de otro cliente: no se toca. La función heredada sumará en la
    -- fila propia del cliente que cobra (o la creará).
    if old.usuario_id is not null and old.usuario_id::text <> cliente then
        return null;
    end if;

    -- Fila histórica sin dueño: solo para el cliente que la generó.
    if old.usuario_id is null and historico is distinct from cliente then
        return null;
    end if;

    -- El dueño de una fila no cambia nunca por un pago.
    if new.usuario_id is distinct from old.usuario_id then
        new.usuario_id := old.usuario_id;
    end if;

    return new;
end;
$fn$
$f$, v_hist);

    insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
    values ('034', 'efaat_compradores_semanales_cliente', 'historico_actualizable_por',
            jsonb_build_object('usuario_id', v_hist));
end $do$;

revoke all on function public.efaat_cliente_pago_marcar() from public, anon, authenticated;
revoke all on function public.efaat_cliente_pago_limpiar() from public, anon, authenticated;
revoke all on function public.efaat_compradores_semanales_cliente() from public, anon, authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop
        -- Los nombres empiezan por dígitos para ejecutarse ANTES que cualquier
        -- otro trigger BEFORE de la tabla (orden por nombre; comprobado arriba).
        execute format('drop trigger if exists "000_efaat_cliente_pago" on public.%I', t);
        execute format('create trigger "000_efaat_cliente_pago" before insert or update on public.%I
                        for each row execute function public.efaat_cliente_pago_marcar()', t);
        execute format('drop trigger if exists "zzz_efaat_cliente_pago_fin" on public.%I', t);
        execute format('create trigger "zzz_efaat_cliente_pago_fin" after insert or update on public.%I
                        for each statement execute function public.efaat_cliente_pago_limpiar()', t);
    end loop;
end $$;

drop trigger if exists "000_efaat_cliente" on public.compradores_semanales;
create trigger "000_efaat_cliente" before insert or update on public.compradores_semanales
    for each row execute function public.efaat_compradores_semanales_cliente();

-- 4. Cerrada al navegador
alter table public.compradores_semanales enable row level security;
revoke all on table public.compradores_semanales from anon, authenticated, public;


do $$
begin
    if has_table_privilege('anon', 'public.compradores_semanales', 'SELECT, INSERT, UPDATE, DELETE')
       or has_table_privilege('authenticated', 'public.compradores_semanales', 'SELECT, INSERT, UPDATE, DELETE') then
        raise exception '034 abortada: anon o authenticated conservan acceso a compradores_semanales';
    end if;
end $$;

commit;

-- ==========================================================================
-- Verificación:
--   - Pago de prueba desde el panel y por sticker: queda 'pagado' como antes.
--   - select usuario_id is not null as con_dueno, count(*) from public.compradores_semanales group by 1;
--     -> las filas creadas después de la 034 tienen dueño.
--   - Con la clave anon: GET /rest/v1/compradores_semanales -> 401/403.
--   - Un mismo teléfono que compra a dos clientes queda en dos filas.
--
-- REVERSIÓN (no toca las filas ni la función heredada; vuelve a los
-- contadores compartidos por teléfono, sin abrir nada al navegador):
--   begin;
--   drop trigger if exists "000_efaat_cliente_pago" on public.reservas_dos_cifras;
--   drop trigger if exists "000_efaat_cliente_pago" on public."5k_15k_reservas_2_cifras";
--   drop trigger if exists "zzz_efaat_cliente_pago_fin" on public.reservas_dos_cifras;
--   drop trigger if exists "zzz_efaat_cliente_pago_fin" on public."5k_15k_reservas_2_cifras";
--   drop trigger if exists "000_efaat_cliente" on public.compradores_semanales;
--   drop function if exists public.efaat_cliente_pago_marcar();
--   drop function if exists public.efaat_cliente_pago_limpiar();
--   drop function if exists public.efaat_compradores_semanales_cliente();
--   -- La RLS (sin políticas) y la columna usuario_id se CONSERVAN: el dueño
--   -- y service_role no se ven afectados y la tabla sigue cerrada. NO se
--   -- devuelven permisos a anon ni a authenticated.
--   commit;
-- ==========================================================================
