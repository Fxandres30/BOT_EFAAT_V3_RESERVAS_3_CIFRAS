-- ==========================================================================
-- 027 — Configuraciones de tablas POR CLIENTE (precio -> tabla física).
--
-- PREPARADA EL 2026-10-21. NO APLICADA. Requiere autorización expresa.
--
-- Modelo (decidido con el dueño de la cuenta principal):
--   - Las 2 tablas físicas existentes (reservas_dos_cifras y
--     5k_15k_reservas_2_cifras) siguen siendo COMPARTIDAS. Cada cliente tiene
--     en ellas su propia cuadrícula 00-99, aislada por usuario_id (código:
--     bot/funciones/reservas/filtroCliente.js; base: RLS de la Parte A).
--   - No se crean tablas físicas por cliente.
--   - tablas_cliente guarda, por cliente, qué precios ofrece y en qué tabla
--     física vive cada uno. Los valores iniciales NO están en este archivo:
--     los envía el backend desde la única fuente de verdad
--     (backend/bot/funciones/eventos/configEvento.js, 8 precios base).
--   - inicializar_tablas_cliente(usuario, configuraciones): idempotente. La
--     llama SOLO el backend (service_role) con el usuario sacado del token
--     validado, en el primer acceso del cliente al panel.
--
-- Datos existentes (cuenta principal): esta migración NO lee, mueve,
-- duplica, reasigna ni borra filas de las tablas físicas. La función solo
-- INSERTA una cuadrícula 00-99 para un cliente que no tenga NINGUNA fila en
-- esa tabla física; si tiene 100 (la cuenta principal) o una cuadrícula
-- incompleta, no la toca y lo informa.
--
-- DEPENDENCIAS (orden obligatorio):
--   1. Parte A (docs/activacion/propuesta_rls_tablas_antiguas.sql) aplicada y
--      validada. La guardia de abajo ABORTA si falta.
--   2. Migración 033 (UNIQUE(numero) -> UNIQUE(usuario_id, numero)). El
--      diagnóstico de producción (2026-10-22) confirmó UNIQUE(numero) en las
--      2 tablas. La guardia de abajo ABORTA si queda una unicidad sin
--      usuario_id. Esta migración NO cambia restricciones de las tablas.
--   3. Backend y panel pueden desplegarse antes o después: el código
--      anterior la ignora y el nuevo funciona sin ella (usa los 8 precios
--      base). Orden recomendado (auditoría 2026-10-22): desplegar ANTES de la
--      Parte A y de esta migración; ver docs/activacion/ACTIVACION.md §2d.
--
-- Idempotente. Una sola transacción: si algo falla, no queda nada aplicado.
-- Ejecutar manualmente en el SQL Editor de Supabase.
-- ==========================================================================

begin;

-- --------------------------------------------- guardia: Parte A aplicada ---
do $$
declare
    t text;
    p text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop

        if to_regclass(format('public.%I', t)) is null then
            raise exception '027 abortada: no existe la tabla física %', t;
        end if;

        if not (select relrowsecurity from pg_class where oid = to_regclass(format('public.%I', t))) then
            raise exception '027 abortada: % no tiene RLS. Aplica y valida antes la Parte A.', t;
        end if;

        -- (La Parte A revisada ya no crea "panel crea su tabla": la cuadrícula
        -- la crea esta función desde el backend, nunca el navegador.)
        foreach p in array array['panel lee sus reservas', 'panel modifica sus reservas'] loop
            if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = p) then
                raise exception '027 abortada: falta la política "%" de la Parte A en %', p, t;
            end if;
        end loop;

        if has_table_privilege('anon', format('public.%I', t), 'select, insert, update, delete') then
            raise exception '027 abortada: anon conserva permisos sobre %. Aplica y valida antes la Parte A.', t;
        end if;

        -- Una unicidad que no incluya usuario_id (p. ej. UNIQUE(numero))
        -- impide la cuadrícula de cualquier otro cliente: antes, la 033.
        if exists (
            select 1 from pg_index x
            where x.indrelid = to_regclass(format('public.%I', t))
              and x.indisunique and not x.indisprimary
              and not exists (select 1 from pg_attribute a
                              where a.attrelid = x.indrelid and a.attname = 'usuario_id'
                                and a.attnum = any (x.indkey::smallint[]))
        ) then
            raise exception '027 abortada: % tiene una unicidad sin usuario_id (UNIQUE(numero)). Aplica antes la 033.', t;
        end if;

    end loop;
end $$;

-- ------------------------------------------------------- tablas_cliente ---
create table if not exists public.tablas_cliente (

    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,

    precio integer not null check (precio > 0),
    -- Solo las 2 tablas físicas compartidas: un cliente nunca puede apuntar
    -- su configuración a otra tabla.
    tabla_fisica text not null check (tabla_fisica in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')),
    cifras smallint not null,
    cantidad integer not null,
    activa boolean not null default true,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    check ((cifras = 2 and cantidad = 100) or (cifras = 3 and cantidad = 1000)),
    unique (usuario_id, precio)

);

alter table public.tablas_cliente enable row level security;

drop policy if exists "propietario lee" on public.tablas_cliente;
drop policy if exists "propietario crea" on public.tablas_cliente;
drop policy if exists "propietario modifica" on public.tablas_cliente;
drop policy if exists "propietario borra" on public.tablas_cliente;

-- Cada cliente gestiona SOLO sus configuraciones. Borrar una configuración
-- no borra reservas, pagos ni historial: no hay clave foránea desde las
-- tablas físicas y la cuadrícula sigue intacta.
create policy "propietario lee" on public.tablas_cliente for select to authenticated using (usuario_id = auth.uid());
create policy "propietario crea" on public.tablas_cliente for insert to authenticated with check (usuario_id = auth.uid());
create policy "propietario modifica" on public.tablas_cliente for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy "propietario borra" on public.tablas_cliente for delete to authenticated using (usuario_id = auth.uid());

revoke all on table public.tablas_cliente from anon, public;
revoke truncate, references, trigger on table public.tablas_cliente from authenticated;
grant select, insert, update, delete on table public.tablas_cliente to authenticated, service_role;

-- -------------------------------------------- inicializar_tablas_cliente ---
create or replace function public.inicializar_tablas_cliente(p_usuario uuid, p_configuraciones jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_cfg jsonb;
    v_creadas integer := 0;
    v_filas integer;
    v_tabla record;
    v_cuadriculas jsonb := '[]'::jsonb;
begin

    if p_usuario is null or not exists (select 1 from auth.users where id = p_usuario) then
        raise exception 'inicializar_tablas_cliente: usuario inexistente' using errcode = '22023';
    end if;

    if jsonb_typeof(p_configuraciones) is distinct from 'array' or jsonb_array_length(p_configuraciones) = 0 then
        raise exception 'inicializar_tablas_cliente: configuraciones vacías' using errcode = '22023';
    end if;

    -- La Parte A podría haberse revertido después de aplicar esta migración:
    -- sin RLS en las tablas físicas no se crea ninguna cuadrícula nueva.
    if exists (
        select 1 from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
          and not relrowsecurity
    ) then
        return jsonb_build_object('ok', false, 'motivo', 'parte_a_pendiente');
    end if;

    -- Dos primeros accesos simultáneos del mismo cliente: uno espera al otro.
    perform pg_advisory_xact_lock(hashtextextended('tablas_cliente:' || p_usuario::text, 0));

    for v_cfg in select value from jsonb_array_elements(p_configuraciones) loop
        insert into public.tablas_cliente (usuario_id, precio, tabla_fisica, cifras, cantidad)
        values (p_usuario, (v_cfg->>'precio')::integer, v_cfg->>'tabla', (v_cfg->>'cifras')::smallint, (v_cfg->>'cantidad')::integer)
        on conflict (usuario_id, precio) do nothing;
        get diagnostics v_filas = row_count;
        v_creadas := v_creadas + v_filas;
    end loop;

    -- Una cuadrícula por tabla física usada por el cliente. Solo se crea si
    -- el cliente no tiene NINGUNA fila en esa tabla; nunca se completa,
    -- corrige ni reinicia una existente.
    for v_tabla in
        select distinct tabla_fisica, cifras, cantidad
        from public.tablas_cliente
        where usuario_id = p_usuario
        order by tabla_fisica
    loop

        execute format('select count(*) from public.%I where usuario_id = $1', v_tabla.tabla_fisica)
            into v_filas using p_usuario;

        if v_filas = 0 then

            execute format(
                'insert into public.%I (usuario_id, numero, estado) '
                'select $1, lpad(g::text, $2, ''0''), ''libre'' from generate_series(0, $3 - 1) as g',
                v_tabla.tabla_fisica
            ) using p_usuario, v_tabla.cifras::integer, v_tabla.cantidad;

            v_cuadriculas := v_cuadriculas || jsonb_build_object('tabla', v_tabla.tabla_fisica, 'estado', 'creada', 'filas', v_tabla.cantidad);

        elsif v_filas = v_tabla.cantidad then

            v_cuadriculas := v_cuadriculas || jsonb_build_object('tabla', v_tabla.tabla_fisica, 'estado', 'existente', 'filas', v_filas);

        else

            v_cuadriculas := v_cuadriculas || jsonb_build_object('tabla', v_tabla.tabla_fisica, 'estado', 'incompleta', 'filas', v_filas);

        end if;

    end loop;

    return jsonb_build_object('ok', true, 'configuraciones_creadas', v_creadas, 'cuadriculas', v_cuadriculas);

end;
$$;

-- Solo el backend. Nadie puede inicializar (ni sondear) a otro cliente
-- desde el navegador.
revoke all on function public.inicializar_tablas_cliente(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.inicializar_tablas_cliente(uuid, jsonb) to service_role;

commit;

-- ==========================================================================
-- Verificación (solo lectura):
--   select count(*), count(distinct usuario_id) from public.tablas_cliente;
--   select policyname, cmd from pg_policies where tablename = 'tablas_cliente';
--   select has_function_privilege('authenticated', 'public.inicializar_tablas_cliente(uuid, jsonb)', 'execute');  -- false
--   -- Las cuadrículas no cambian por aplicar la migración: repetir D15 y
--   -- comparar con el resultado guardado ANTES.
--
-- Reversión (no toca las tablas físicas ni las cuadrículas creadas, que
-- siguen siendo de su cliente y sin efecto sobre las demás):
--   begin;
--   drop function if exists public.inicializar_tablas_cliente(uuid, jsonb);
--   drop table if exists public.tablas_cliente;
--   commit;
-- ==========================================================================
