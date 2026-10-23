-- ==========================================================================
-- ASIGNACIÓN EXPLÍCITA DE LAS FILAS HISTÓRICAS DE compradores_semanales
-- (NO APLICADA, OPCIONAL, DECISIÓN DEL DUEÑO). Preparada el 2026-10-22.
--
-- Tras la 034, las ~1930 filas anteriores siguen SIN dueño y la función
-- heredada las sigue actualizando por teléfono para cualquier cliente (igual
-- que hoy). Esto las asigna a la cuenta principal SOLO si la evidencia
-- registrada al aplicar la 034 lo respalda. No se adivina nada:
--   1. La 034 guardó (efaat_admin.cambios_seguridad, 'historico_sin_dueno')
--      el id máximo de las filas que existían y la lista de cuentas con
--      sorteos o reservas no libres en ese momento.
--   2. Esa lista tiene EXACTAMENTE una cuenta y es <UUID_PRINCIPAL>, que
--      existe en auth.users. (Si había dos o más, o ninguna, ABORTA: hace
--      falta otra decisión.)
--   3. Solo se asignan las filas con id <= ese máximo y usuario_id NULL: las
--      creadas después (p. ej. pagos "mixtos") no se tocan.
--   4. Los ids asignados quedan registrados: la reversión los devuelve a
--      NULL exactamente.
-- No cambia contadores, nombres ni teléfonos.
--
-- Sustituir <UUID_PRINCIPAL> por el id de la cuenta principal.
-- ==========================================================================

begin;

set local lock_timeout = '5s';

do $$
declare
    v_principal text := '<UUID_PRINCIPAL>';
    ev jsonb;
    v_ids integer[];
begin
    if v_principal !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Asignación abortada: sustituye <UUID_PRINCIPAL>';
    end if;
    if not exists (select 1 from auth.users where id = v_principal::uuid) then
        raise exception 'Asignación abortada: la cuenta % no existe', v_principal;
    end if;

    select detalle into ev from efaat_admin.cambios_seguridad
    where paso = '034' and accion = 'historico_sin_dueno' order by id limit 1;
    if ev is null then
        raise exception 'Asignación abortada: la 034 no está aplicada (no hay evidencia registrada)';
    end if;
    if exists (select 1 from efaat_admin.cambios_seguridad where paso = 'asignacion_compradores' and accion = 'asignadas') then
        raise exception 'Asignación abortada: ya se aplicó antes';
    end if;
    if jsonb_array_length(ev->'duenos_con_actividad') <> 1 or ev->'duenos_con_actividad'->>0 <> v_principal then
        raise exception 'Asignación abortada: la evidencia no respalda a % como único dueño (cuentas con actividad: %)',
            v_principal, ev->'duenos_con_actividad';
    end if;

    perform 1 from public.compradores_semanales where id <= (ev->>'id_maximo')::integer and usuario_id is null for update;

    -- Sin cliente en curso: el trigger de la 034 no interviene.
    perform set_config('efaat.cliente_pago', '', true);

    with a as (
        update public.compradores_semanales set usuario_id = v_principal::uuid
        where id <= (ev->>'id_maximo')::integer and usuario_id is null
        returning id
    )
    select array_agg(id order by id) into v_ids from a;

    insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
    values ('asignacion_compradores', 'compradores_semanales', 'asignadas',
            jsonb_build_object('usuario_id', v_principal, 'filas', coalesce(array_length(v_ids, 1), 0), 'ids', to_jsonb(v_ids)));
    raise notice 'Asignadas % filas históricas a la cuenta principal', coalesce(array_length(v_ids, 1), 0);
end $$;

commit;

-- REVERSIÓN (devuelve a NULL exactamente las filas asignadas):
--   begin;
--   update public.compradores_semanales c set usuario_id = null
--   from efaat_admin.cambios_seguridad cs, jsonb_array_elements_text(cs.detalle->'ids') i
--   where cs.paso = 'asignacion_compradores' and cs.accion = 'asignadas' and c.id = i::integer;
--   delete from efaat_admin.cambios_seguridad where paso = 'asignacion_compradores' and accion = 'asignadas';
--   commit;
-- ==========================================================================
