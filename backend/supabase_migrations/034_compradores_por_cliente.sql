-- ==========================================================================
-- 034 — compradores_semanales CON DUEÑO (cliente de EFAAT)
--
-- PREPARADA EL 2026-10-22. NO APLICADA. Requiere autorización expresa.
--
-- Contexto (producción 2026-10-22): un trigger heredado de las tablas de
-- reservas (función actualizar_compradores_semanales) escribe en
-- compradores_semanales al marcar un pago. La tabla no tiene columna de
-- cliente (id, nombre, whatsapp, lunes..domingo, total_semanal,
-- entregados_3cifras), anon lee sus 1930 filas y ningún código del
-- repositorio la lee ni la escribe.
--
-- Qué hace SIN cambiar el código heredado (no se desactiva ningún trigger
-- ni se toca la lógica de contadores):
--   1. Columna usuario_id (uuid, nullable) + índice.
--   2. Marca el cliente del pago: un trigger BEFORE de fila en las 2 tablas
--      de reservas guarda en una variable de la transacción el usuario_id de
--      la fila modificada (si una misma sentencia toca filas de varios
--      clientes, queda "mixto" y no se atribuye). Un trigger AFTER de
--      sentencia la limpia. Los triggers AFTER de fila (el heredado) se
--      ejecutan antes que los de sentencia: ven el cliente correcto.
--   3. Cada fila NUEVA de compradores_semanales recibe ese usuario_id.
--      Si la función heredada ACTUALIZA la fila de un comprador que ya era
--      de otro cliente, se deja pasar (igual que hoy) y se emite un WARNING
--      sin datos personales: los contadores por teléfono siguen siendo
--      compartidos hasta reescribir la función heredada (su código no está
--      en el repositorio; ver ACTIVACION.md §2e).
--   4. RLS activada y sin políticas: nadie la lee desde el navegador (el
--      panel no la usa). El bot/backend (service_role) y la función heredada
--      (SECURITY DEFINER tras la Parte B2) no se ven afectados.
--   Las 1930 filas históricas quedan con usuario_id NULL: no se asignan por
--   suposición.
--
-- REQUISITOS (guardias):
--   - Parte B2 aplicada: TODA función de trigger de las reservas que mencione
--     compradores_semanales es SECURITY DEFINER. Si no, con RLS el pago desde
--     el panel podría fallar.
--   - Las 2 tablas de reservas tienen usuario_id uuid.
-- Prueba: backend/tests/seguridad/aislamientoMulticliente.test.js
-- ==========================================================================

begin;

set local lock_timeout = '5s';

do $$
declare
    n integer;
    invoker text;
begin
    if to_regclass('public.compradores_semanales') is null then
        raise exception '034 abortada: no existe compradores_semanales';
    end if;

    select count(distinct p.oid),
           string_agg(distinct p.oid::regprocedure::text, ', ') filter (where not p.prosecdef)
      into n, invoker
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

-- 3. Dueño en compradores_semanales
create or replace function public.efaat_compradores_semanales_cliente()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    cliente text := nullif(current_setting('efaat.cliente_pago', true), '');
begin
    if cliente = 'mixto' then
        cliente := null;
    end if;

    if tg_op = 'INSERT' then
        if new.usuario_id is null and cliente is not null then
            new.usuario_id := cliente::uuid;
        end if;
    elsif old.usuario_id is not null and cliente is not null and old.usuario_id::text <> cliente then
        -- Sin datos personales: solo el id interno de la fila.
        raise warning 'compradores_semanales: la fila % (de otro cliente) se actualiza por un pago de otro cliente', old.id;
    elsif old.usuario_id is null and new.usuario_id is null and cliente is not null then
        -- Fila histórica sin dueño: se mantiene sin dueño (no se asigna por suposición).
        null;
    end if;

    return new;
end;
$$;

revoke all on function public.efaat_cliente_pago_marcar() from public, anon, authenticated;
revoke all on function public.efaat_cliente_pago_limpiar() from public, anon, authenticated;
revoke all on function public.efaat_compradores_semanales_cliente() from public, anon, authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop
        -- Los nombres empiezan por dígitos para ejecutarse ANTES que cualquier
        -- otro trigger BEFORE de la tabla (orden alfabético).
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
revoke all on table public.compradores_semanales from anon, authenticated;

commit;

-- ==========================================================================
-- Verificación:
--   - Pago de prueba desde el panel y por sticker: queda 'pagado' como antes.
--   - select usuario_id is not null as con_dueno, count(*) from public.compradores_semanales group by 1;
--     -> las filas creadas después de la 034 tienen dueño.
--   - Con la clave anon: GET /rest/v1/compradores_semanales -> 401/403.
--
-- REVERSIÓN (no toca las filas ni la función heredada):
--   begin;
--   drop trigger if exists "000_efaat_cliente_pago" on public.reservas_dos_cifras;
--   drop trigger if exists "000_efaat_cliente_pago" on public."5k_15k_reservas_2_cifras";
--   drop trigger if exists "zzz_efaat_cliente_pago_fin" on public.reservas_dos_cifras;
--   drop trigger if exists "zzz_efaat_cliente_pago_fin" on public."5k_15k_reservas_2_cifras";
--   drop trigger if exists "000_efaat_cliente" on public.compradores_semanales;
--   drop function if exists public.efaat_cliente_pago_marcar();
--   drop function if exists public.efaat_cliente_pago_limpiar();
--   drop function if exists public.efaat_compradores_semanales_cliente();
--   alter table public.compradores_semanales disable row level security;
--   -- La columna usuario_id se conserva (no estorba). NO se devuelven
--   -- permisos a anon.
--   commit;
-- ==========================================================================
