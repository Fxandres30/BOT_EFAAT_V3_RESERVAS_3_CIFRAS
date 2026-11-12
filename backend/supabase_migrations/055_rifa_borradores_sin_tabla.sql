-- ==========================================================================
-- 055 — ASIGNA SU RIFA A LOS DOS BORRADORES CREADOS SIN tabla_id
--
-- PREPARADA EL 2026-11-12. NO aplicada. Solo datos; independiente de la 054
-- (con la 054 aplicada, su trigger vuelve a validar cada fila al escribirla).
--
-- Contexto (auditoría del 12/11, solo lectura): los únicos sorteos
-- programados sin rifa son dos BORRADORES del mismo cliente (2491cbd0…),
-- ambos «Antioqueñita Día» de $2.000, creados por el módulo de sorteos
-- antes de que conociera el motor de rifas:
--   8af55145-b968-475d-9371-e41f003f78e9  (1 grupo)
--   dadea765-d576-401a-a2de-9fb82e0894c7  (3 grupos)
-- Correspondencia INEQUÍVOCA verificada: el cliente tiene UNA sola rifa de
-- $2.000 activa y sin archivar (12887e61-229c-4ff8-9ffd-adb521866c0c,
-- «Tabla $2.000») y los 4 grupos distintos de esos borradores están
-- vinculados a ella (grupos_rifa, activo). Ningún evento tiene tabla_id NULL.
--
-- Esta pieza NO supone nada: vuelve a comprobar todo lo anterior dentro de
-- la transacción y, si algo cambió (otra rifa de $2.000, un grupo sin
-- vínculo, el borrador ya tiene rifa, cambió de estado o de precio), ABORTA
-- sin tocar nada. Toca solo esas dos filas y solo la columna tabla_id.
--
-- Alternativa administrativa (sin SQL): editar cada borrador en el panel y
-- elegir su tabla, o cancelarlo y crear uno nuevo.
--
-- Corrección 12/11 (tarde): la primera versión exigía que existieran LOS DOS
-- borradores y abortaba con «los borradores ya no están como en la auditoría
-- (1 de 2 coinciden)» porque dadea765 se eliminó desde el panel. Ahora
-- trabaja solo con los que siguen existiendo (hoy: 8af55145).
-- ==========================================================================

begin;

do $$
declare
    v_usuario   uuid := '2491cbd0-5fb5-4cef-a06d-6092e69d40c4';
    v_rifa      uuid := '12887e61-229c-4ff8-9ffd-adb521866c0c';
    v_borradores uuid[] := array['8af55145-b968-475d-9371-e41f003f78e9', 'dadea765-d576-401a-a2de-9fb82e0894c7']::uuid[];
    v_presentes uuid[];
    v_n         integer;
begin
    -- 1. Una sola rifa de $2.000 del cliente, activa y sin archivar: la esperada.
    select count(*) into v_n from public.tablas_rifas
     where usuario_id = v_usuario and precio = 2000 and activa is true and archivada_en is null;
    if v_n <> 1 or not exists (select 1 from public.tablas_rifas
                                where id = v_rifa and usuario_id = v_usuario and precio = 2000
                                  and activa is true and archivada_en is null) then
        raise exception '055 abortada: el cliente ya no tiene exactamente UNA rifa de $2.000 activa (la %). Decide la rifa en el panel.', v_rifa;
    end if;

    -- 2. Borradores que SIGUEN existiendo (12/11 tarde: dadea765 ya fue
    -- eliminado desde el panel; la versión anterior exigía los dos y abortaba
    -- con «1 de 2 coinciden»). Un borrador eliminado no se recrea; cada uno
    -- de los que existen debe seguir exactamente como se auditó.
    select coalesce(array_agg(id), '{}') into v_presentes from public.sorteos_programados
     where id = any (v_borradores);
    if cardinality(v_presentes) = 0 then
        raise notice '055: ninguno de los dos borradores existe ya; no hay nada que asignar.';
        return;
    end if;

    select count(*) into v_n from public.sorteos_programados
     where id = any (v_presentes) and usuario_id = v_usuario and tabla_id is null
       and estado = 'borrador' and (config ->> 'valor')::numeric = 2000;
    if v_n <> cardinality(v_presentes) then
        raise exception '055 abortada: de % borrador(es) existente(s), solo % sigue(n) como en la auditoría (borrador, sin rifa, $2.000). No se toca nada.',
            cardinality(v_presentes), v_n;
    end if;

    -- 3. Todos sus grupos (no cancelados) están vinculados a esa rifa.
    select count(*) into v_n
      from public.sorteos_programados_grupos g
     where g.sorteo_id = any (v_presentes) and g.usuario_id = v_usuario and g.estado <> 'cancelado'
       and not exists (select 1 from public.grupos_rifa r
                        where r.usuario_id = v_usuario and r.grupo_id = g.grupo_id
                          and r.tabla_id = v_rifa and r.activo is true);
    if v_n > 0 then
        raise exception '055 abortada: % grupo(s) de los borradores no están vinculados a la rifa %. Decide en el panel.', v_n, v_rifa;
    end if;

    update public.sorteos_programados
       set tabla_id = v_rifa
     where id = any (v_presentes) and usuario_id = v_usuario and tabla_id is null and estado = 'borrador';
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_presentes) then
        raise exception '055 abortada: se esperaban % fila(s) y se tocarían %', cardinality(v_presentes), v_n;
    end if;
    raise notice '055: rifa % asignada a % borrador(es).', v_rifa, v_n;
end $$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select id, estado, tabla_id, config->>'valor' from public.sorteos_programados
--    where id in ('8af55145-b968-475d-9371-e41f003f78e9', 'dadea765-d576-401a-a2de-9fb82e0894c7');
--   select count(*) from public.sorteos_programados where tabla_id is null;   -- 0
-- REVERTIR (solo si hace falta):
--   update public.sorteos_programados set tabla_id = null
--    where id in ('8af55145-b968-475d-9371-e41f003f78e9', 'dadea765-d576-401a-a2de-9fb82e0894c7') and estado = 'borrador';
--   (con la 054 aplicada su trigger lo impide a propósito: un sorteo no pierde su rifa.)
