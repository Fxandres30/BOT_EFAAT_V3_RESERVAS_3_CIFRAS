-- ==========================================================================
-- 054 — SORTEOS PROGRAMADOS SOBRE EL MOTOR ÚNICO DE RIFAS (tabla_id)
--
-- PREPARADA EL 2026-11-12. Requiere 030, 050 (o 053) y 051. NO aplicada.
--
-- Por qué (auditoría del 12/11): la vista previa, la imagen y el reinicio de
-- los sorteos programados seguían leyendo la cuadrícula física antigua
-- (reservas_dos_cifras, compartida por $1.000/$1.500/$2.000 y filtrada solo
-- por usuario_id), mientras Reservas lee numeros_rifa por tabla_id. Un
-- sorteo de $2.000 mostraba los 72 números de un sorteo cerrado de $1.000.
-- Además reiniciar_tabla_cliente (030) NUNCA funcionó en Supabase: tiene un
-- UPDATE sin WHERE que pg-safeupdate (cargado por PostgREST) rechaza con
-- 21000 «UPDATE requires a WHERE clause» (reservas_archivo = 0 filas).
--
-- Qué hace (solo funciones y un trigger; NO toca ninguna fila):
--   1. reiniciar_tabla_cliente: la misma función de la 030 con `where true`
--      en el UPDATE de su tabla temporal. Solo la usa el motor antiguo
--      (MOTOR_RIFAS=legado, vuelta atrás de emergencia).
--   2. rifa_reiniciar_sorteo: reinicio SEGURO de UNA rifa para publicar un
--      sorteo (revisión sin escribir + aplicación con huella). Protege
--      sorteos activos de ESA rifa, pagos en proceso, reservas anticipadas
--      de programados sin publicar, reservas sin sorteo atribuible y números
--      de otro ciclo; conserva los bloqueos manuales salvo autorización.
--      Todo o nada; nada se borra (numeros_rifa_archivo). Nunca toca otra rifa.
--   3. Trigger en sorteos_programados: un sorteo nuevo o que pasa a
--      programarse/publicarse DEBE tener una rifa (tabla_id) del mismo
--      cliente, no archivada y del mismo precio que su config.valor. Las
--      filas antiguas sin rifa se pueden seguir leyendo, cancelando y
--      archivando, nunca programar ni publicar.
--
-- Sin UPDATE/DELETE sin WHERE (pg-safeupdate): lo comprueba
-- backend/tests/rifas/sinUpdateSinWhere.test.js sobre todas las migraciones.
--
-- Vuelta atrás: 054_revertir_sorteos_por_rifa.sql.
-- ==========================================================================

begin;

do $$
begin
    if to_regclass('public.tablas_rifas') is null or to_regclass('public.numeros_rifa') is null
       or to_regclass('public.numeros_rifa_archivo') is null then
        raise exception '054 abortada: falta la 050 (motor de rifas)';
    end if;
    if not exists (select 1 from pg_attribute where attrelid = 'public.sorteos_programados'::regclass
                    and attname = 'tabla_id' and not attisdropped)
       or not exists (select 1 from pg_attribute where attrelid = 'public.eventos_bot'::regclass
                    and attname = 'tabla_id' and not attisdropped) then
        raise exception '054 abortada: falta la 051 (tabla_id en eventos_bot y sorteos_programados)';
    end if;
    if to_regprocedure('public.reiniciar_tabla_cliente(uuid, text, text, uuid, boolean, boolean)') is null then
        raise exception '054 abortada: falta la 030 (reiniciar_tabla_cliente)';
    end if;
    if to_regprocedure('rifas_privado.rifa_propia(uuid, uuid, boolean)') is null
       or to_regprocedure('rifas_privado.auditar(public.tablas_rifas, text, jsonb, jsonb, jsonb)') is null then
        raise exception '054 abortada: faltan funciones privadas de la 050';
    end if;
end $$;

-- --------------------------------------------------------------------------
-- 1. reiniciar_tabla_cliente (030) sin UPDATE sin WHERE. Idéntica a la 030
--    salvo `where true` en la línea marcada.
-- --------------------------------------------------------------------------
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

    perform set_config('lock_timeout', '5s', true);

    execute format('select 1 from public.%I where usuario_id = $1 for update', p_tabla) using p_usuario;

    lock table public.eventos_bot in share mode;

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
    end
    where true;  -- 054: pg-safeupdate rechaza un UPDATE sin WHERE (21000)

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

-- --------------------------------------------------------------------------
-- 2. rifa_reiniciar_sorteo — reinicio seguro de UNA rifa al publicar.
--
-- p_aplicar = false: solo revisa (no escribe nada) y devuelve la huella.
-- p_aplicar = true : aplica SOLO si la huella sigue igual (nadie reservó,
--                    pagó ni liberó nada desde la revisión).
--
-- Concurrencia: la rifa se toma FOR UPDATE (rifa_reservar/pagar/liberar/
-- bloquear la toman FOR SHARE): ninguna operación de números de ESTA rifa
-- corre a la vez. eventos_bot en modo SHARE mientras se decide qué sorteo
-- está activo (como la 030). La huella incluye la versión de cada número.
--
-- Clases (todo o nada: con un solo «protegido_*» no se toca nada):
--   libre                  libre
--   liberable              reservado/pagado de un sorteo terminado (o de
--                          una identidad sin sorteo activo); bloqueado si
--                          p_liberar_bloqueados
--   conservado             bloqueado a mano (no se libera sin autorización)
--   protegido_activo       reservado/pagado de un sorteo ACTIVO de esta rifa
--                          (o activo sin rifa registrada: conservador)
--   protegido_anticipada   reservado/pagado de un sorteo programado de esta
--                          rifa que todavía no se publicó
--   protegido_en_proceso   pago en proceso
--   protegido_sin_sorteo   reservado/pagado sin identidad ni evento terminado
--   protegido_otro_ciclo   número marcado con un ciclo distinto del actual
-- --------------------------------------------------------------------------
create or replace function public.rifa_reiniciar_sorteo(
    p_usuario            uuid,
    p_tabla              uuid,
    p_huella             text,
    p_sorteo             uuid,
    p_aplicar            boolean,
    p_liberar_bloqueados boolean default false,
    p_actor              jsonb default '{"origen": "sistema"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa              public.tablas_rifas;
    v_activas           text[];
    v_eventos_activos   text[];
    v_eventos_cerrados  text[];
    v_anticipadas       text[];
    v_huella            text;
    v_resumen           jsonb;
    v_protegidos        integer;
    v_liberables        integer;
    v_archivados        integer;
    v_liberar           integer[];
    v_motivo            text;
begin
    perform rifas_privado.origen(p_actor);

    if p_usuario is null or p_tabla is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;

    perform pg_catalog.set_config('lock_timeout', '5s', true);

    -- 1. La rifa, en exclusiva (serializa con reservas/pagos de ESTA rifa).
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, true);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_archivada');
    end if;

    -- 2. Sus números, bloqueados hasta el final de la transacción.
    perform 1 from public.numeros_rifa n
     where n.tabla_id = v_rifa.id and n.usuario_id = v_rifa.usuario_id
       for update;

    -- 3. Nadie crea, reactiva ni cierra un sorteo mientras se decide.
    lock table public.eventos_bot in share mode;

    -- Sorteos de ESTA rifa del cliente (o sin rifa registrada: conservador).
    select coalesce(array_agg(distinct e.identidad_evento_real) filter (where e.activo is not false and e.identidad_evento_real is not null), '{}'),
           coalesce(array_agg(e.id::text) filter (where e.activo is not false), '{}'),
           coalesce(array_agg(e.id::text) filter (where e.activo is false and e.tabla_id = v_rifa.id), '{}')
      into v_activas, v_eventos_activos, v_eventos_cerrados
      from public.eventos_bot e
     where e.usuario_id = v_rifa.usuario_id
       and (e.tabla_id = v_rifa.id or e.tabla_id is null);

    -- Programados de ESTA rifa que todavía no se publicaron (sin ningún
    -- evento con su identidad): sus reservas son anticipadas.
    select coalesce(array_agg(distinct s.identidad_evento_real), '{}')
      into v_anticipadas
      from public.sorteos_programados s
     where s.usuario_id = v_rifa.usuario_id
       and s.tabla_id = v_rifa.id
       and s.estado in ('borrador', 'programado', 'publicando', 'fallido')
       and s.identidad_evento_real is not null
       and not exists (select 1 from public.eventos_bot e
                        where e.usuario_id = v_rifa.usuario_id
                          and e.identidad_evento_real = s.identidad_evento_real);

    drop table if exists pg_temp.rifa_reinicio_filas;

    create temp table rifa_reinicio_filas on commit drop as
    select n.numero,
           n.estado,
           n.identidad_evento_real as identidad,
           n.nombre_evento,
           n.version,
           case
               when n.estado = 'libre' then 'libre'
               when n.estado = 'en_proceso' then 'protegido_en_proceso'
               when n.estado = 'bloqueado' and coalesce(p_liberar_bloqueados, false) then 'liberable'
               when n.estado = 'bloqueado' then 'conservado'
               when n.estado in ('reservado', 'pagado') and n.ciclo is not null and n.ciclo <> v_rifa.ciclo then 'protegido_otro_ciclo'
               when n.estado in ('reservado', 'pagado') and n.identidad_evento_real = any (v_anticipadas) then 'protegido_anticipada'
               when n.estado in ('reservado', 'pagado') and n.identidad_evento_real = any (v_activas) then 'protegido_activo'
               when n.estado in ('reservado', 'pagado') and n.identidad_evento_real is null
                    and n.evento_id is not null and n.evento_id::text = any (v_eventos_activos) then 'protegido_activo'
               when n.estado in ('reservado', 'pagado') and n.identidad_evento_real is not null then 'liberable'
               when n.estado in ('reservado', 'pagado') and n.evento_id is not null
                    and n.evento_id::text = any (v_eventos_cerrados) then 'liberable'
               when n.estado in ('reservado', 'pagado') then 'protegido_sin_sorteo'
               else 'protegido_desconocido'
           end as clase
      from public.numeros_rifa n
     where n.tabla_id = v_rifa.id and n.usuario_id = v_rifa.usuario_id;

    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
               f.numero::text || '|' || f.estado || '|' || coalesce(f.identidad, '') || '|' || f.version::text,
               ',' order by f.numero), ''))
      into v_huella
      from pg_temp.rifa_reinicio_filas f;

    select count(*) filter (where f.clase like 'protegido%'),
           count(*) filter (where f.clase = 'liberable')
      into v_protegidos, v_liberables
      from pg_temp.rifa_reinicio_filas f;

    select jsonb_build_object(
        'tabla_id', v_rifa.id,
        'ciclo', v_rifa.ciclo,
        'liberables', v_liberables,
        'conservados', (select count(*) from pg_temp.rifa_reinicio_filas f where f.clase = 'conservado'),
        'protegidos', v_protegidos,
        'por_clase', coalesce((select jsonb_object_agg(x.clase, x.n)
                                 from (select f.clase, count(*) as n from pg_temp.rifa_reinicio_filas f group by f.clase) x), '{}'::jsonb),
        'por_sorteo', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'identidad', g.identidad, 'nombre_evento', g.nombre_evento, 'clase', g.clase,
                       'reservados', g.reservados, 'pagados', g.pagados, 'otros', g.otros)
                   order by g.nombre_evento nulls last, g.clase)
              from (select f.identidad, max(f.nombre_evento) as nombre_evento, f.clase,
                           count(*) filter (where f.estado = 'reservado') as reservados,
                           count(*) filter (where f.estado = 'pagado') as pagados,
                           count(*) filter (where f.estado not in ('reservado', 'pagado')) as otros
                      from pg_temp.rifa_reinicio_filas f
                     where f.clase <> 'libre'
                     group by f.identidad, f.clase) g), '[]'::jsonb)
    ) into v_resumen;

    if v_protegidos > 0 then
        return jsonb_build_object('ok', false, 'motivo', 'protegido', 'aplicado', false, 'huella', v_huella) || v_resumen;
    end if;

    if not coalesce(p_aplicar, false) then
        return jsonb_build_object('ok', true, 'aplicado', false, 'huella', v_huella) || v_resumen;
    end if;

    if p_huella is distinct from v_huella then
        return jsonb_build_object('ok', false, 'motivo', 'tabla_cambio', 'aplicado', false, 'huella', v_huella) || v_resumen;
    end if;

    if v_liberables = 0 then
        return jsonb_build_object('ok', true, 'aplicado', true, 'archivados', 0, 'huella', v_huella) || v_resumen;
    end if;

    select coalesce(array_agg(f.numero order by f.numero), '{}')
      into v_liberar
      from pg_temp.rifa_reinicio_filas f
     where f.clase = 'liberable';

    v_motivo := left(coalesce(rifas_privado.texto(p_actor, 'motivo', 400),
                              'reinicio al publicar sorteo ' || coalesce(p_sorteo::text, 'sin sorteo')), 500);

    insert into public.numeros_rifa_archivo (tabla_id, usuario_id, ciclo, numero, estado, fila, motivo)
    select n.tabla_id, n.usuario_id, v_rifa.ciclo, n.numero, n.estado, to_jsonb(n), v_motivo
      from public.numeros_rifa n
     where n.tabla_id = v_rifa.id and n.usuario_id = v_rifa.usuario_id
       and n.numero = any (v_liberar);
    get diagnostics v_archivados = row_count;

    update public.numeros_rifa set
        estado = 'libre',
        comprador = null, contacto = null, telefono = null, lid = null, lib = null,
        usuario_global_id = null, grupo_id = null, grupo_nombre = null,
        evento_id = null, identidad_evento_real = null, nombre_evento = null, telefono_bot = null,
        origen = null, ciclo = null,
        reservado_en = null, pagado_en = null, bloqueado_hasta = null,
        temporal_por = null, observaciones = null
     where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id
       and numero = any (v_liberar);

    perform rifas_privado.auditar(v_rifa, 'reiniciar',
        jsonb_build_array(jsonb_build_object('numero', null, 'antes', 'ciclo ' || v_rifa.ciclo,
                                             'despues', 'ciclo ' || (v_rifa.ciclo + 1), 'resultado', 'ok',
                                             'codigo', v_archivados::text || ' archivados (sorteo)')),
        jsonb_build_object('observaciones', v_motivo), p_actor);

    update public.tablas_rifas set ciclo = ciclo + 1
     where id = v_rifa.id and usuario_id = v_rifa.usuario_id;

    return jsonb_build_object('ok', true, 'aplicado', true, 'archivados', v_archivados,
                              'ciclo_anterior', v_rifa.ciclo, 'huella', v_huella)
           || (v_resumen || jsonb_build_object('ciclo', v_rifa.ciclo + 1));
end;
$$;

revoke all on function public.rifa_reiniciar_sorteo(uuid, uuid, text, uuid, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.rifa_reiniciar_sorteo(uuid, uuid, text, uuid, boolean, boolean, jsonb) to service_role;

-- --------------------------------------------------------------------------
-- 2b. rifa_cambiar_identidad — «Corregir» un sorteo activo (lotería, fecha,
-- hora) cambia su identidad: sus reservas y pagos EN SU RIFA pasan a la
-- identidad nueva (antes se escribía en la cuadrícula antigua y la rifa se
-- quedaba con la identidad vieja: un reinicio los habría tratado como de un
-- sorteo terminado). Solo números no libres de ESA rifa con la identidad
-- anterior. Auditado como 'actualizar_rifa'.
-- --------------------------------------------------------------------------
create or replace function public.rifa_cambiar_identidad(
    p_usuario       uuid,
    p_tabla         uuid,
    p_anterior      text,
    p_nueva         text,
    p_nombre_evento text default null,
    p_actor         jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa  public.tablas_rifas;
    v_n     integer;
begin
    perform rifas_privado.origen(p_actor);
    if nullif(btrim(coalesce(p_anterior, '')), '') is null or nullif(btrim(coalesce(p_nueva, '')), '') is null
       or char_length(p_nueva) > 200 then
        return jsonb_build_object('ok', false, 'motivo', 'identidad_invalida');
    end if;
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, false);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;

    update public.numeros_rifa set
        identidad_evento_real = p_nueva,
        nombre_evento = coalesce(left(nullif(btrim(coalesce(p_nombre_evento, '')), ''), 200), nombre_evento)
     where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id
       and identidad_evento_real = p_anterior and estado <> 'libre';
    get diagnostics v_n = row_count;

    if v_n > 0 then
        perform rifas_privado.auditar(v_rifa, 'actualizar_rifa',
            jsonb_build_array(jsonb_build_object('numero', null, 'antes', 'identidad ' || left(p_anterior, 40),
                                                 'despues', 'identidad ' || left(p_nueva, 40), 'resultado', 'ok',
                                                 'codigo', v_n::text || ' numeros')),
            jsonb_build_object('identidad_evento_real', p_nueva), p_actor);
    end if;

    return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id, 'cambiados', v_n);
end;
$$;

revoke all on function public.rifa_cambiar_identidad(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rifa_cambiar_identidad(uuid, uuid, text, text, text, jsonb) to service_role;

-- --------------------------------------------------------------------------
-- 3. Ningún sorteo programado sin rifa válida.
--
-- INSERT: siempre. UPDATE: cuando la fila queda (o sigue) en un estado que
-- se va a publicar (borrador editado, programado, publicando) y cambia su
-- rifa, su precio o su estado. Las filas antiguas sin rifa se pueden
-- cancelar o archivar, nunca programar ni publicar. La FK compuesta de la
-- 051 ya garantiza que la rifa es del MISMO cliente.
-- --------------------------------------------------------------------------
create or replace function rifas_privado.sorteo_programado_con_rifa()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_rifa  public.tablas_rifas;
    v_valor text := new.config ->> 'valor';
begin
    if tg_op = 'UPDATE' then
        if old.tabla_id is not null and new.tabla_id is null then
            raise exception 'un sorteo programado no puede perder su rifa (tabla_id)' using errcode = '23502';
        end if;
        if new.estado not in ('borrador', 'programado', 'publicando') then
            return new;
        end if;
        if new.tabla_id is not distinct from old.tabla_id
           and new.estado is not distinct from old.estado
           and (new.config ->> 'valor') is not distinct from (old.config ->> 'valor') then
            return new;
        end if;
    end if;

    if new.tabla_id is null then
        raise exception 'el sorteo programado necesita una rifa (tabla_id)' using errcode = '23502';
    end if;

    select * into v_rifa from public.tablas_rifas r
     where r.id = new.tabla_id and r.usuario_id = new.usuario_id;
    if v_rifa.id is null then
        raise exception 'la rifa % no existe para este cliente', new.tabla_id using errcode = '23503';
    end if;
    if v_rifa.archivada_en is not null then
        raise exception 'la rifa % está archivada', new.tabla_id using errcode = '23514';
    end if;
    if v_valor is null or v_valor !~ '^[0-9]+(\.0+)?$' or v_valor::numeric <> v_rifa.precio then
        raise exception 'el precio del sorteo (%) no es el de su rifa (%)', coalesce(v_valor, 'sin precio'), v_rifa.precio
            using errcode = '23514';
    end if;
    return new;
end;
$$;

revoke all on function rifas_privado.sorteo_programado_con_rifa() from public, anon, authenticated;

drop trigger if exists sorteos_programados_con_rifa on public.sorteos_programados;
create trigger sorteos_programados_con_rifa
    before insert or update on public.sorteos_programados
    for each row execute function rifas_privado.sorteo_programado_con_rifa();

commit;

-- ==========================================================================
-- VERIFICACIÓN (solo lectura, después de aplicar):
--   select pg_get_functiondef('public.reiniciar_tabla_cliente(uuid, text, text, uuid, boolean, boolean)'::regprocedure) like '%where true;%';  -- true
--   select has_function_privilege('authenticated', 'public.rifa_reiniciar_sorteo(uuid, uuid, text, uuid, boolean, boolean, jsonb)', 'execute');  -- false
--   select tgname from pg_trigger where tgrelid = 'public.sorteos_programados'::regclass and tgname = 'sorteos_programados_con_rifa';
--   -- Revisión (no escribe nada) de una rifa:
--   select public.rifa_reiniciar_sorteo('<usuario>'::uuid, '<tabla_id>'::uuid, null, null, false);
-- ==========================================================================
