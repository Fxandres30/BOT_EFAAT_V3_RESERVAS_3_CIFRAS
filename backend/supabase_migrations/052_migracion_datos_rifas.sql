-- ==========================================================================
-- 052 — MIGRACIÓN DE DATOS AL MOTOR ÚNICO DE RIFAS (una sola vez)
--
-- PREPARADA EL 2026-11-12. NO APLICADA. Se ejecuta SOLO en la ventana de
-- cambio de motor (sin sorteos vigentes, sin programados a punto de
-- publicarse), justo antes de pasar MOTOR_RIFAS=nuevo en el VPS y en Vercel.
-- Requiere 032, 050 y 051. Prueba: backend/tests/rifas/migracionDatosSql.test.js
--
-- QUÉ HACE (todo en UNA transacción; si cualquier comprobación falla, no
-- queda nada):
--   1. Una rifa INDEPENDIENTE por cada fila de tablas_cliente (cliente +
--      precio), con sus propios números 0..cantidad-1, todos libres.
--      Nombre: "Tabla $1.500". Inactiva si la fila estaba inactiva.
--   2. Vínculos explícitos: cada grupo autorizado ACTIVO del cliente queda
--      vinculado a todas sus rifas activas (sin predeterminada). Con eso el
--      bot resuelve la rifa por el precio del sorteo SOLO entre las rifas
--      vinculadas (decisión D1); si no queda exactamente una, se detiene.
--   3. Números ocupados de las cuadrículas antiguas -> HISTORIAL (decisión
--      del 12/11): cada uno se archiva en numeros_rifa_archivo (ciclo 1) de
--      la rifa del precio de SU sorteo (evento_id -> eventos_bot.valor), con
--      la fila antigua COMPLETA dentro (comprador, teléfono, LID, LIB, fechas,
--      ip, todo), y una fila 'migrar' en reservas_auditoria. Esa rifa pasa al
--      ciclo 2 y empieza libre. Si un ocupado no se puede atribuir a una sola
--      rifa, la migración se DETIENE (no se asigna nada por suposición).
--   4. eventos_bot.tabla_id y sorteos_programados.tabla_id donde (cliente,
--      tabla física, precio) apunta a una sola rifa. reservas_actividad y
--      reservas_archivo antiguos no guardan el precio: quedan con tabla_id
--      NULL (historia, sin atribuir por suposición).
--   5. Verificación: archivados = ocupados antiguos; rifas nuevas completas
--      y libres; tablas antiguas IDÉNTICAS (huella md5 antes/después).
--
-- NO modifica, borra ni vacía las cuadrículas antiguas, tablas_cliente,
-- grupos, sesiones ni usuarios.
-- ==========================================================================

begin;

-- ------------------------------------------------------------- guardias ---
do $$
declare
    v_lista text;
begin
    if to_regclass('public.rifas_migracion_mapa') is null then
        raise exception '052: faltan la 050/051';
    end if;
    if exists (select 1 from public.rifas_migracion_mapa) or exists (select 1 from public.tablas_rifas) then
        raise exception '052: ya hay rifas en el motor nuevo; la migración no se repite';
    end if;
    if to_regclass('public.reservas_dos_cifras') is null or to_regclass('public."5k_15k_reservas_2_cifras"') is null then
        raise exception '052: no existen las dos cuadrículas antiguas esperadas';
    end if;

    -- Ventana: ningún sorteo vigente (criterio canónico del código).
    select string_agg(e.usuario_id || ' ' || coalesce(e.valor, '?') || ' ' || coalesce(e.grupo_nombre, ''), '; ')
      into v_lista
      from public.eventos_bot e
     where e.activo is true
       and coalesce(e.estado, '') not in ('desactivado', 'cancelado', 'eliminado', 'cerrado')
       and coalesce(e.cierre_estado, '') <> 'cerrado'
       and regexp_replace(coalesce(e.cierre_motivo, ''), '^normalizado: ', '')
           !~ '^(panel:(desactivado|cancelado|eliminado)([[:space:]:]|$)|sustituido)';
    if v_lista is not null then
        raise exception '052: hay sorteos vigentes (%); ejecutar en la ventana sin sorteos', v_lista;
    end if;

    select string_agg(s.id::text || ' ' || s.estado || ' ' || s.publicar_en, '; ')
      into v_lista
      from public.sorteos_programados s
     where s.estado = 'publicando'
        or (s.estado = 'programado' and s.publicar_en <= now() + interval '30 minutes');
    if v_lista is not null then
        raise exception '052: hay programados publicándose o a menos de 30 min (%); esperar', v_lista;
    end if;

    -- Las actualizaciones de tabla_id no deben disparar efectos (avisos,
    -- webhooks...). Si existe algún trigger AFTER UPDATE en estas tablas, se
    -- detiene para revisarlo (ver R0, sección 03).
    select string_agg(tg.tgrelid::regclass || '.' || tg.tgname, ', ')
      into v_lista
      from pg_trigger tg
     where tg.tgrelid in ('public.eventos_bot'::regclass, 'public.sorteos_programados'::regclass)
       and not tg.tgisinternal and tg.tgenabled <> 'D'
       and (tg.tgtype & 16) <> 0 and (tg.tgtype & 2) = 0 and (tg.tgtype & 64) = 0;
    if v_lista is not null then
        raise exception '052: triggers AFTER UPDATE en sorteos (%): revisarlos antes de migrar', v_lista;
    end if;

    -- Ocupados sin dueño o con número no numérico: no se adivina nada.
    if exists (select 1 from public.reservas_dos_cifras where estado <> 'libre' and (usuario_id is null or numero !~ '^[0-9]+$'))
       or exists (select 1 from public."5k_15k_reservas_2_cifras" where estado <> 'libre' and (usuario_id is null or numero !~ '^[0-9]+$')) then
        raise exception '052: hay números ocupados sin dueño o con formato no numérico';
    end if;

    -- Huella de las tablas antiguas, para comprobar al final que no cambiaron.
    perform set_config('efaat.huella_legado', (
        select md5(coalesce((select string_agg(t::text, '|' order by t.id) from public.reservas_dos_cifras t), '')
                || coalesce((select string_agg(t::text, '|' order by t.id) from public."5k_15k_reservas_2_cifras" t), '')
                || coalesce((select string_agg(t::text, '|' order by t.usuario_id, t.precio) from public.tablas_cliente t), ''))), true);
end $$;

-- --------------------------------------------- 1. una rifa por cliente+precio ---
do $$
declare
    r record;
    v jsonb;
begin
    for r in
        select usuario_id, precio, tabla_fisica, cifras, cantidad, coalesce(activa, true) as activa
          from public.tablas_cliente
         order by usuario_id, precio
    loop
        v := public.rifa_crear(
                r.usuario_id,
                'Tabla $' || replace(to_char(r.precio, 'FM999,999,999'), ',', '.'),
                r.precio, r.cifras, r.cantidad, '{}'::jsonb, null,
                '{"origen": "migracion", "motivo": "052: rifa creada desde tablas_cliente"}'::jsonb);
        if not coalesce((v ->> 'ok')::boolean, false) then
            raise exception '052: no se pudo crear la rifa % del cliente %: %', r.precio, r.usuario_id, v;
        end if;
        insert into public.rifas_migracion_mapa (usuario_id, precio, tabla_legado, tabla_id)
        values (r.usuario_id, r.precio, r.tabla_fisica, (v ->> 'tabla_id')::uuid);
        if not r.activa then
            update public.tablas_rifas set activa = false where id = (v ->> 'tabla_id')::uuid;
        end if;
    end loop;
end $$;

-- ------------------------------------------ 2. vínculos grupo -> rifas ---
do $$
declare
    g record;
    m record;
    v jsonb;
begin
    for g in
        select distinct usuario_id, grupo_id
          from public.grupos_autorizados
         where coalesce(activo, true) and nullif(btrim(grupo_id), '') is not null
    loop
        for m in
            select t.id from public.rifas_migracion_mapa mp
              join public.tablas_rifas t on t.id = mp.tabla_id
             where mp.usuario_id = g.usuario_id and t.activa
        loop
            v := public.rifa_vincular_grupo(g.usuario_id, g.grupo_id, m.id, false,
                     '{"origen": "migracion", "motivo": "052: grupo autorizado"}'::jsonb);
            if not coalesce((v ->> 'ok')::boolean, false) then
                raise exception '052: no se pudo vincular el grupo % a la rifa %: %', g.grupo_id, m.id, v;
            end if;
        end loop;
    end loop;
end $$;

-- ------------------------- 3. ocupados antiguos -> historial (ciclo 1) ---
do $$
declare
    f       record;
    v_valor text;
    v_tabla uuid;
    v_rifa  public.tablas_rifas;
begin
    for f in
        select 'reservas_dos_cifras'::text as tabla, to_jsonb(t) as fila
          from public.reservas_dos_cifras t where t.estado <> 'libre'
        union all
        select '5k_15k_reservas_2_cifras', to_jsonb(t)
          from public."5k_15k_reservas_2_cifras" t where t.estado <> 'libre'
    loop
        -- Precio del sorteo al que pertenece el número (evento del MISMO cliente).
        select nullif(regexp_replace(coalesce(e.valor, ''), '[^0-9]', '', 'g'), '')
          into v_valor
          from public.eventos_bot e
         where e.id::text = f.fila ->> 'evento_id'
           and e.usuario_id::text = f.fila ->> 'usuario_id';

        select mp.tabla_id into v_tabla
          from public.rifas_migracion_mapa mp
         where mp.usuario_id::text = f.fila ->> 'usuario_id'
           and mp.tabla_legado = f.tabla
           and mp.precio::text = v_valor;

        if v_tabla is null then
            raise exception '052: el número % de % (cliente %, evento %, precio %) no se puede atribuir a una sola rifa; no se migra nada',
                f.fila ->> 'numero', f.tabla, f.fila ->> 'usuario_id', coalesce(f.fila ->> 'evento_id', 'sin evento'), coalesce(v_valor, '?');
        end if;

        select * into v_rifa from public.tablas_rifas where id = v_tabla;

        insert into public.numeros_rifa_archivo (tabla_id, usuario_id, ciclo, numero, estado, fila, motivo)
        values (v_rifa.id, v_rifa.usuario_id, 1, (f.fila ->> 'numero')::integer, f.fila ->> 'estado',
                jsonb_build_object('tabla_legado', f.tabla, 'legado', f.fila),
                '052: historial del sorteo anterior a la migración');

        insert into public.reservas_auditoria (
            usuario_id, origen, accion, tabla, tabla_id, ciclo, precio, numero,
            evento_id, identidad_evento_real, grupo_id, grupo_nombre,
            contacto_id, contacto_nombre, contacto_telefono,
            estado_anterior, estado_nuevo, motivo, resultado)
        values (
            v_rifa.usuario_id, 'migracion', 'migrar', 'numeros_rifa', v_rifa.id, 1, v_rifa.precio, f.fila ->> 'numero',
            nullif(f.fila ->> 'evento_id', '')::uuid, f.fila ->> 'identidad_evento_real', f.fila ->> 'grupo_id', f.fila ->> 'grupo_nombre',
            nullif(f.fila ->> 'usuario_global_id', '')::uuid, coalesce(f.fila ->> 'comprador', f.fila ->> 'nombre'), f.fila ->> 'telefono',
            f.fila ->> 'estado', 'archivado', '052: desde ' || f.tabla || ' (historial del ciclo 1)', 'ok');

        update public.rifas_migracion_mapa set archivados = archivados + 1 where tabla_id = v_rifa.id;
    end loop;

    -- La rifa con historial empieza su ciclo 2, libre.
    update public.tablas_rifas t set ciclo = 2
      from public.rifas_migracion_mapa mp
     where mp.tabla_id = t.id and mp.archivados > 0;
end $$;

-- ------------------------------------------------- 4. sorteos -> tabla_id ---
update public.eventos_bot e
   set tabla_id = mp.tabla_id
  from public.rifas_migracion_mapa mp
 where mp.usuario_id = e.usuario_id
   and mp.tabla_legado = e.tabla
   and mp.precio::text = nullif(regexp_replace(coalesce(e.valor, ''), '[^0-9]', '', 'g'), '');

update public.sorteos_programados s
   set tabla_id = mp.tabla_id
  from public.rifas_migracion_mapa mp
 where mp.usuario_id = s.usuario_id
   and mp.tabla_legado = s.tabla
   and mp.precio::text = nullif(regexp_replace(coalesce(s.config ->> 'valor', s.config ->> 'precio', ''), '[^0-9]', '', 'g'), '');

-- --------------------------------------------------------- 5. verificación ---
do $$
declare
    v_ocupados  bigint;
    v_archivo   bigint;
    v_esperados bigint;
    v_numeros   bigint;
begin
    select (select count(*) from public.reservas_dos_cifras where estado <> 'libre')
         + (select count(*) from public."5k_15k_reservas_2_cifras" where estado <> 'libre')
      into v_ocupados;
    select count(*) into v_archivo from public.numeros_rifa_archivo where motivo like '052:%';
    if v_archivo <> v_ocupados then
        raise exception '052: archivados % <> ocupados antiguos %', v_archivo, v_ocupados;
    end if;
    if (select count(*) from public.reservas_auditoria where accion = 'migrar') <> v_ocupados then
        raise exception '052: auditoría de migración incompleta';
    end if;

    select coalesce(sum(cantidad), 0) into v_esperados from public.tablas_cliente;
    select count(*) into v_numeros from public.numeros_rifa;
    if v_numeros <> v_esperados then
        raise exception '052: números creados % <> esperados %', v_numeros, v_esperados;
    end if;
    if exists (select 1 from public.numeros_rifa where estado <> 'libre') then
        raise exception '052: alguna rifa nueva no empieza libre';
    end if;
    if (select count(*) from public.tablas_rifas) <> (select count(*) from public.tablas_cliente) then
        raise exception '052: rifas creadas <> filas de tablas_cliente';
    end if;

    if current_setting('efaat.huella_legado', true) is distinct from (
        select md5(coalesce((select string_agg(t::text, '|' order by t.id) from public.reservas_dos_cifras t), '')
                || coalesce((select string_agg(t::text, '|' order by t.id) from public."5k_15k_reservas_2_cifras" t), '')
                || coalesce((select string_agg(t::text, '|' order by t.usuario_id, t.precio) from public.tablas_cliente t), ''))) then
        raise exception '052: las tablas antiguas cambiaron durante la migración; se deshace todo';
    end if;
end $$;

commit;

-- ----------------------------------------------------------------- informe ---
select mp.usuario_id, mp.precio, mp.tabla_legado, t.id as tabla_id, t.nombre, t.activa, t.ciclo,
       mp.archivados,
       (select count(*) from public.numeros_rifa n where n.tabla_id = t.id) as numeros,
       (select count(*) from public.grupos_rifa g where g.tabla_id = t.id and g.activo) as grupos_vinculados,
       (select count(*) from public.eventos_bot e where e.tabla_id = t.id) as eventos_vinculados,
       (select count(*) from public.sorteos_programados s where s.tabla_id = t.id) as programados_vinculados
  from public.rifas_migracion_mapa mp
  join public.tablas_rifas t on t.id = mp.tabla_id
 order by mp.usuario_id, mp.precio;
