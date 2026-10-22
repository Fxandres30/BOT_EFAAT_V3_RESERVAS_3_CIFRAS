-- ==========================================================================
-- 030 — REINICIO SEGURO DE LA TABLA DE NÚMEROS (al programar un sorteo)
--
-- PREPARADA EL 2026-10-21. NO APLICADA. Requiere autorización expresa.
--
-- Hoy la única forma de dejar la tabla libre para un sorteo nuevo es
-- "Reiniciar" en Tablas, que el NAVEGADOR ejecuta como un UPDATE de todas
-- las filas del usuario: pone libre incluso números PAGADOS y de un sorteo
-- todavía activo, y no guarda copia de nada.
--
-- Esta migración añade:
--   1. reservas_archivo: copia completa (jsonb) de cada fila que se libera,
--      con su cliente, tabla, número, estado, sorteo y motivo. Nada se borra:
--      los pagos confirmados quedan archivados, nunca se pierden.
--   2. reiniciar_tabla_cliente(usuario, tabla, huella, sorteo, aplicar,
--      liberar_bloqueados): UNA transacción, con las filas del cliente
--      bloqueadas (FOR UPDATE) y el estado de los sorteos releído en ella:
--        - PROTEGIDOS (bloquean todo el reinicio, no se toca nada):
--            reservado/pagado de un sorteo ACTIVO del cliente en esa tabla
--            (por identidad o por evento);
--            reservado/pagado que no se puede atribuir con seguridad a un
--            sorteo TERMINADO (sin identidad y sin evento cerrado conocido);
--            en_proceso (pago en proceso); cualquier estado desconocido.
--        - LIBERABLES: reservado/pagado de sorteos terminados -> se archivan
--          (copia completa: comprador, contacto, fechas de reserva y de pago)
--          y quedan libres. Los pagos confirmados siguen en reservas_archivo.
--        - BLOQUEADOS a mano: se CONSERVAN (ni se liberan ni impiden el
--          reinicio), salvo liberar_bloqueados = true, elegido expresamente.
--      Con aplicar = false solo devuelve el resumen y la huella (vista
--      previa). Con aplicar = true exige la MISMA huella que vio el usuario:
--      si la tabla cambió entretanto, no hace nada (tabla_cambio).
--   Solo filas del cliente indicado (usuario_id); solo las 2 tablas físicas.
--   La ejecuta únicamente el backend (service_role) con el usuario del token.
--
-- Idempotente. Una transacción. Ejecutar manualmente en el SQL Editor.
-- ==========================================================================

begin;

-- Guardia (revisión 2026-10-21): las 2 tablas físicas no están en las
-- migraciones del repo (son heredadas). La función lee y limpia estas
-- columnas; si falta alguna (p. ej. la 015 sin aplicar), se aborta aquí, en
-- vez de fallar después en cada reinicio.
do $$
declare
    t text;
    faltan text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop
        if to_regclass(format('public.%I', t)) is null then
            raise exception '030 abortada: no existe la tabla física %', t;
        end if;
        select string_agg(c, ', ') into faltan
        from unnest(array['numero', 'estado', 'usuario_id', 'identidad_evento_real', 'evento_id', 'nombre_evento',
                          'comprador', 'contacto', 'contacto_lower', 'lib', 'grupo_id', 'grupo_nombre', 'telefono_bot',
                          'fecha_reserva', 'hora_reserva', 'fecha_pago', 'hora_pago', 'temporal_por', 'bloqueado_hasta',
                          'ip_reserva', 'usuario_global_id', 'nombre', 'telefono']) as c
        where not exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = t and column_name = c);
        if faltan is not null then
            raise exception '030 abortada: a % le faltan columnas: %', t, faltan;
        end if;
    end loop;
    select string_agg(c, ', ') into faltan
    from unnest(array['id', 'usuario_id', 'tabla', 'activo', 'identidad_evento_real']) as c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'eventos_bot' and column_name = c);
    if faltan is not null then
        raise exception '030 abortada: a eventos_bot le faltan columnas (o no existe): %', faltan;
    end if;
end $$;

create table if not exists public.reservas_archivo (

    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,
    tabla text not null check (tabla in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')),
    numero text not null,
    estado text not null,
    identidad_evento_real text,
    evento_id text,
    nombre_evento text,
    -- Copia completa de la fila tal como estaba (comprador, contacto, pago…).
    fila jsonb not null,
    motivo text not null default 'reinicio_programacion',
    sorteo_programado_id uuid,
    archivado_en timestamptz not null default now()

);

create index if not exists reservas_archivo_por_usuario
    on public.reservas_archivo (usuario_id, archivado_en desc);

alter table public.reservas_archivo enable row level security;

drop policy if exists "propietario lee su archivo" on public.reservas_archivo;
create policy "propietario lee su archivo" on public.reservas_archivo
    for select to authenticated using (usuario_id = auth.uid());

revoke all on table public.reservas_archivo from anon;
revoke insert, update, delete on table public.reservas_archivo from authenticated;
grant select on table public.reservas_archivo to authenticated;
grant all on table public.reservas_archivo to service_role;

-- Firma anterior (nunca aplicada en producción; por si quedó de una prueba).
drop function if exists public.reiniciar_tabla_cliente(uuid, text, text, uuid, boolean);

create or replace function public.reiniciar_tabla_cliente(
    p_usuario uuid,
    p_tabla text,
    p_huella text,
    p_sorteo uuid,
    p_aplicar boolean,
    p_liberar_bloqueados boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_activas text[];
    v_eventos_activos text[];
    v_eventos_cerrados text[];
    v_huella text;
    v_resumen jsonb;
    v_protegidos integer;
    v_liberables integer;
    v_archivados integer;
begin

    if p_usuario is null then
        raise exception 'reiniciar_tabla_cliente: usuario requerido' using errcode = '22023';
    end if;

    if p_tabla not in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras') then
        raise exception 'reiniciar_tabla_cliente: tabla no permitida' using errcode = '22023';
    end if;

    -- Orden de bloqueo (revisión 2026-10-21):
    --   1. Filas del cliente (FOR UPDATE), hasta el final de la transacción:
    --      nadie puede reservar ni pagar entre la comprobación y el reinicio.
    --   2. eventos_bot en modo SHARE: nadie puede crear, reactivar ni cerrar
    --      un sorteo mientras se decide qué es "activo". Solo bloquea
    --      ESCRITURAS de eventos (las lecturas siguen), durante lo que dura
    --      esta función (milisegundos). Si no se obtiene en 5 s, error y
    --      rollback completo: no se modifica nada.
    --   3. Recién entonces se leen los sorteos activos y terminados.
    -- Antes se leían los sorteos ANTES de bloquear: un sorteo activado en
    -- ese intervalo con la identidad de reservas ya existentes no cambiaba
    -- la huella y sus reservas podían clasificarse como liberables.
    perform set_config('lock_timeout', '5s', true);

    execute format('select 1 from public.%I where usuario_id = $1 for update', p_tabla) using p_usuario;

    lock table public.eventos_bot in share mode;

    -- Conservador: "activo" desconocido (null) cuenta como activo, y un
    -- sorteo activo sin tabla registrada también protege. Solo cuenta como
    -- terminado un sorteo con activo = false explícito en ESTA tabla.
    select coalesce(array_agg(distinct identidad_evento_real) filter (where activo is not false and identidad_evento_real is not null), '{}'),
           coalesce(array_agg(id::text) filter (where activo is not false), '{}'),
           coalesce(array_agg(id::text) filter (where activo is false and tabla = p_tabla), '{}')
      into v_activas, v_eventos_activos, v_eventos_cerrados
    from public.eventos_bot
    where usuario_id = p_usuario and (tabla = p_tabla or tabla is null);

    drop table if exists _filas_reinicio;

    execute format('create temp table _filas_reinicio on commit drop as
        select numero::text as numero, estado::text as estado, identidad_evento_real::text as identidad,
               evento_id::text as evento_id, nombre_evento::text as nombre_evento, to_jsonb(t) as fila
        from public.%I t where usuario_id = $1', p_tabla) using p_usuario;

    alter table _filas_reinicio add column clase text;

    update _filas_reinicio set clase = case
        when estado = 'libre' then 'libre'
        when estado in ('reservado', 'pagado') and identidad = any (v_activas) then 'protegido_activo'
        when estado in ('reservado', 'pagado') and identidad is null and evento_id = any (v_eventos_activos) then 'protegido_activo'
        when estado in ('reservado', 'pagado') and identidad is not null then 'liberable'
        when estado in ('reservado', 'pagado') and evento_id = any (v_eventos_cerrados) then 'liberable'
        when estado in ('reservado', 'pagado') then 'protegido_sin_sorteo'
        when estado = 'bloqueado' and coalesce(p_liberar_bloqueados, false) then 'liberable'
        when estado = 'bloqueado' then 'conservado'
        when estado = 'en_proceso' then 'protegido_en_proceso'
        else 'protegido_desconocido'
    end;

    select md5(coalesce(string_agg(numero || '|' || estado || '|' || coalesce(identidad, ''), ',' order by numero, estado, identidad), ''))
      into v_huella
    from _filas_reinicio;

    select count(*) filter (where clase like 'protegido%'), count(*) filter (where clase = 'liberable')
      into v_protegidos, v_liberables
    from _filas_reinicio;

    select jsonb_build_object(
        'liberables', v_liberables,
        'conservados', (select count(*) from _filas_reinicio where clase = 'conservado'),
        'protegidos', v_protegidos,
        'por_clase', coalesce((select jsonb_object_agg(clase, n) from (select clase, count(*) as n from _filas_reinicio group by clase) x), '{}'::jsonb),
        'por_sorteo', coalesce((
            select jsonb_agg(jsonb_build_object(
                'identidad', identidad, 'nombre_evento', nombre_evento, 'clase', clase,
                'reservados', reservados, 'pagados', pagados, 'otros', otros) order by nombre_evento nulls last)
            from (
                select identidad, max(nombre_evento) as nombre_evento, clase,
                       count(*) filter (where estado = 'reservado') as reservados,
                       count(*) filter (where estado = 'pagado') as pagados,
                       count(*) filter (where estado not in ('reservado', 'pagado')) as otros
                from _filas_reinicio
                where clase <> 'libre'
                group by identidad, clase
            ) g
        ), '[]'::jsonb)
    ) into v_resumen;

    if v_protegidos > 0 then
        return jsonb_build_object('ok', false, 'motivo', 'protegido', 'huella', v_huella) || v_resumen;
    end if;

    if not p_aplicar then
        return jsonb_build_object('ok', true, 'aplicado', false, 'huella', v_huella) || v_resumen;
    end if;

    if p_huella is distinct from v_huella then
        return jsonb_build_object('ok', false, 'motivo', 'tabla_cambio', 'huella', v_huella) || v_resumen;
    end if;

    insert into public.reservas_archivo (usuario_id, tabla, numero, estado, identidad_evento_real, evento_id, nombre_evento, fila, sorteo_programado_id)
    select p_usuario, p_tabla, numero, estado, identidad, evento_id, nombre_evento, fila, p_sorteo
    from _filas_reinicio
    where clase = 'liberable';

    get diagnostics v_archivados = row_count;

    execute format('update public.%I set
            estado = ''libre'', comprador = null, contacto = null, contacto_lower = null, lib = null,
            grupo_id = null, grupo_nombre = null, evento_id = null, nombre_evento = null, telefono_bot = null,
            fecha_reserva = null, hora_reserva = null, fecha_pago = null, hora_pago = null,
            temporal_por = null, bloqueado_hasta = null, ip_reserva = null,
            usuario_global_id = null, nombre = null, telefono = null
        where usuario_id = $1 and numero::text = any ($2)', p_tabla)
    using p_usuario, (select coalesce(array_agg(numero), '{}') from _filas_reinicio where clase = 'liberable');

    return jsonb_build_object('ok', true, 'aplicado', true, 'archivados', v_archivados, 'huella', v_huella) || v_resumen;

end;
$$;

revoke all on function public.reiniciar_tabla_cliente(uuid, text, text, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.reiniciar_tabla_cliente(uuid, text, text, uuid, boolean, boolean) to service_role;

commit;

-- ==========================================================================
-- Verificación (solo lectura):
--   select count(*) from public.reservas_archivo;
--   select has_function_privilege('authenticated', 'public.reiniciar_tabla_cliente(uuid, text, text, uuid, boolean, boolean)', 'execute');  -- false
--
-- Recuperación de un reinicio aplicado por error (PLANTILLA, no se ejecuta
-- sola). Devuelve a su estado archivado SOLO los números de ese cliente,
-- tabla e instante que sigan libres; si alguno ya se volvió a reservar, no
-- lo toca. Revisar primero con el SELECT y después ejecutar el UPDATE en
-- una transacción:
--   select numero, estado, fila->>'comprador' from public.reservas_archivo
--   where usuario_id = '<UUID>' and tabla = '<TABLA>' and archivado_en = '<INSTANTE>';
--   begin;
--   update public."<TABLA>" t
--   set (estado, comprador, contacto, contacto_lower, nombre, telefono, lib, grupo_id, grupo_nombre,
--        evento_id, nombre_evento, fecha_reserva, hora_reserva, fecha_pago, hora_pago, temporal_por,
--        bloqueado_hasta, usuario_global_id, telefono_bot, ip_reserva, identidad_evento_real)
--     = (r.estado, r.comprador, r.contacto, r.contacto_lower, r.nombre, r.telefono, r.lib, r.grupo_id, r.grupo_nombre,
--        r.evento_id, r.nombre_evento, r.fecha_reserva, r.hora_reserva, r.fecha_pago, r.hora_pago, r.temporal_por,
--        r.bloqueado_hasta, r.usuario_global_id, r.telefono_bot, r.ip_reserva, r.identidad_evento_real)
--   from public.reservas_archivo a
--   cross join lateral jsonb_populate_record(null::public."<TABLA>", a.fila) r
--   where a.usuario_id = '<UUID>' and a.tabla = '<TABLA>' and a.archivado_en = '<INSTANTE>'
--     and t.usuario_id = a.usuario_id and t.numero = a.numero and t.estado = 'libre';
--   -- comprobar el número de filas actualizadas con el SELECT anterior; commit; o rollback;
--
-- Reversión (las filas ya archivadas se conservan si no se borra la tabla):
--   begin;
--   drop function if exists public.reiniciar_tabla_cliente(uuid, text, text, uuid, boolean, boolean);
--   -- drop table public.reservas_archivo;  -- SOLO si se acepta perder el archivo
--   commit;
-- ==========================================================================
