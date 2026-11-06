-- ==========================================================================
-- estado_cierres_f3_solo_lectura.sql (endurecimiento F3, 06/11/2026)
-- NO EJECUTADO contra ninguna base real. Procedimiento:
-- docs/activacion/PROCEDIMIENTO_DIAGNOSTICO_ESTADOS.md, sección 7.
--
-- SOLO LECTURA: SELECT sobre eventos_bot, automation_actions y el catálogo
-- de Postgres, dentro de una transacción de solo lectura que termina en
-- ROLLBACK. No crea nada, no modifica, no borra. Sin datos personales: solo
-- ids, estados, contadores y fechas.
--
-- Funciona con o sin las migraciones 023 (cierre_*), 047 (reservas_modo) y
-- 048 (eventos_bot_historial): las columnas opcionales se leen con
-- to_jsonb(fila) ->> 'columna' (NULL si no existe) y la tabla del historial
-- solo se consulta en el catálogo.
--
-- Devuelve cinco resultados:
--   1) migraciones de F3 presentes
--   2) cierres pendientes o fallidos (resumen)
--   3) registro de cierres de grupo (automation_actions, CIERRE_GRUPO)
--   4) sorteos con el permiso de reservas distinto entre sus grupos
--   5) casos a revisar (una fila por caso)
-- ==========================================================================

begin;
set transaction read only;

-- 1) MIGRACIONES DE F3 PRESENTES
select
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'eventos_bot' and column_name = 'reservas_modo')      as migracion_047_reservas_modo,
    to_regclass('public.eventos_bot_historial') is not null                                                         as migracion_048_historial,
    (select n_live_tup from pg_stat_user_tables where schemaname = 'public' and relname = 'eventos_bot_historial') as historial_filas_aprox,
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'eventos_bot' and column_name = 'cierre_ultimo_error')  as migracion_023_cierre;

-- 2) CIERRES PENDIENTES O FALLIDOS
with e as (
    select ev.id, ev.usuario_id, ev.activo, ev.abierto, to_jsonb(ev) as j
    from public.eventos_bot ev
)
select
    count(*) filter (where activo = false and abierto = true
                       and j ->> 'cierre_motivo' like 'panel:cerrado%'
                       and j ->> 'cierre_ultimo_error' is not null)                                  as manual_whatsapp_pendiente,
    count(*) filter (where activo = false and abierto = true
                       and j ->> 'cierre_motivo' like 'panel:cerrado%'
                       and j ->> 'cierre_ultimo_error' is not null
                       and coalesce((j ->> 'cierre_intentos')::int, 0) >= 10)                         as manual_whatsapp_abandonado,
    count(*) filter (where activo = true and j ->> 'cierre_estado' = 'fallido')                       as automatico_fallido,
    count(*) filter (where activo = true and j ->> 'cierre_estado' = 'requiere_revision')             as automatico_requiere_revision,
    count(*) filter (where j ->> 'cierre_motivo' like 'normalizado: %')                                as normalizadas
from e;

-- 3) REGISTRO DE CIERRES DE GRUPO (protección entre procesos)
select
    estado,
    count(*)                                                                         as acciones,
    count(*) filter (where estado = 'en_progreso' and ejecutado_en < now() - interval '5 minutes') as en_progreso_vencidas,
    count(*) filter (where clave_idempotencia like '%:retirada:%')                    as retiradas_por_reapertura,
    max(coalesce((detalle ->> 'intentos')::int, 1))                                  as max_intentos,
    min(creado_en)                                                                   as primera,
    max(actualizado_en)                                                              as ultima
from public.automation_actions
where tipo_accion = 'CIERRE_GRUPO'
group by estado
order by estado;

-- 4) PERMISO DE RESERVAS DISTINTO ENTRE LOS GRUPOS DE UN MISMO SORTEO
select
    ev.usuario_id,
    ev.identidad_evento_real,
    count(*)                                                                         as filas,
    array_agg(distinct coalesce(to_jsonb(ev) ->> 'reservas_modo', 'segun_estado'))  as modos
from public.eventos_bot ev
where ev.identidad_evento_real is not null
group by ev.usuario_id, ev.identidad_evento_real
having count(distinct coalesce(to_jsonb(ev) ->> 'reservas_modo', 'segun_estado')) > 1
order by ev.usuario_id;

-- 5) CASOS A REVISAR
with e as (
    select ev.id, ev.usuario_id, ev.grupo_id, ev.identidad_evento_real, ev.activo, ev.abierto, ev.estado, ev.actualizado_en, to_jsonb(ev) as j
    from public.eventos_bot ev
)
select
    case
        when activo = true and j ->> 'cierre_estado' = 'requiere_revision' then 'automatico_requiere_revision'
        when activo = true and j ->> 'cierre_estado' = 'fallido' then 'automatico_fallido'
        when coalesce((j ->> 'cierre_intentos')::int, 0) >= 10 then 'manual_whatsapp_abandonado'
        else 'manual_whatsapp_pendiente'
    end                                                  as caso,
    usuario_id, id as evento_id, grupo_id, identidad_evento_real,
    activo, abierto, estado,
    j ->> 'cierre_estado'                                as cierre_estado,
    left(j ->> 'cierre_motivo', 80)                      as cierre_motivo,
    (j ->> 'cierre_intentos')::int                       as cierre_intentos,
    left(j ->> 'cierre_ultimo_error', 120)               as cierre_ultimo_error,
    j ->> 'cierre_ultimo_intento_en'                     as cierre_ultimo_intento_en,
    actualizado_en
from e
where (activo = true and j ->> 'cierre_estado' in ('fallido', 'requiere_revision'))
   or (activo = false and abierto = true and j ->> 'cierre_motivo' like 'panel:cerrado%' and j ->> 'cierre_ultimo_error' is not null)
order by caso, usuario_id, actualizado_en desc nulls last;

rollback;
