-- ==========================================================================
-- estado_sorteos_contradicciones_solo_lectura.sql (F2, 06/11/2026)
-- NO EJECUTADO contra ninguna base real. Procedimiento:
-- docs/arquitectura/ESTADO_SORTEOS.md, sección «Diagnóstico».
--
-- SOLO LECTURA: tres SELECT sobre eventos_bot, event_sessions y
-- sorteos_programados_grupos dentro de una transacción de solo lectura que
-- termina en ROLLBACK. No crea nada (ni vistas temporales), no modifica, no
-- borra. No devuelve compradores, teléfonos, nombres de grupo ni textos de
-- mensajes: solo ids, estados, horas y contadores.
--
-- Reproduce EXACTAMENTE backend/shared/eventos/estadosGestion.js (validado
-- en local, en memoria, contra esas funciones: ver ESTADO_SORTEOS.md):
--   motivo       = motivoGestion (sin el prefijo «normalizado: » de F3; estado de gestión, o «panel:<x>» con
--                  x = primera palabra tras «panel:», o «sustituido…»)
--   fin          = finDelEvento
--   vigente      = criterio canónico (activo = true y sin fin)
--   b_abierto    = criterio B (activo distinto de false y estado distinto de
--                  'cerrado'): sorteosActivos, administracion y, hasta F2,
--                  las reservas del bot
--   c_en_curso   = criterio C (activo = true): Eventos en backend y panel
-- La misma definición (WITH … f2_estado) encabeza cada consulta.
--
-- Cómo ejecutar (cuando se autorice): SQL Editor de Supabase, pegar TODO el
-- archivo y ejecutar. Devuelve tres resultados: 1) resumen global,
-- 2) resumen por cliente, 3) casos a revisar.
-- ==========================================================================

begin;
set transaction read only;

-- 1) RESUMEN GLOBAL: cuántas filas afecta cada criterio y cada regla F2.
with base as (
    select
        e.id,
        e.usuario_id,
        to_jsonb(e)->>'tabla'                       as tabla,
        to_jsonb(e)->>'valor'                       as valor,
        to_jsonb(e)->>'fecha_evento'                as fecha_evento,
        to_jsonb(e)->>'hora_cierre'                 as hora_cierre,
        e.activo,
        to_jsonb(e)->>'estado'                      as estado,
        to_jsonb(e)->>'cierre_estado'               as cierre_estado,
        regexp_replace(coalesce(to_jsonb(e)->>'cierre_motivo', ''), '^normalizado: ', '') as cierre_motivo,
        nullif(to_jsonb(e)->>'reservados', '')::numeric as reservados,
        nullif(to_jsonb(e)->>'pagados', '')::numeric    as pagados,
        to_jsonb(e)->>'creado_en'                   as creado_en,
        to_jsonb(e)->>'actualizado_en'              as actualizado_en
    from public.eventos_bot e
),
motivo as (
    select b.*,
        case
            when b.estado in ('desactivado', 'cancelado', 'eliminado') then b.estado
            when b.cierre_motivo like 'panel:%'
                 and substring(b.cierre_motivo from '^panel:([^[:space:]:]*)') in ('desactivado', 'cancelado', 'eliminado')
                then substring(b.cierre_motivo from '^panel:([^[:space:]:]*)')
            when b.cierre_motivo like 'sustituido%' then 'sustituido'
        end as motivo
    from base b
),
fin as (
    select m.*,
        coalesce(m.motivo,
            case when m.activo is false or m.estado = 'cerrado' or m.cierre_estado = 'cerrado' then 'cerrado' end) as fin
    from motivo m
),
f2_estado as (
    select f.*,
        (f.activo is true and f.fin is null)                                       as vigente,
        (f.activo is distinct from false and f.estado is distinct from 'cerrado')  as b_abierto,
        (f.activo is true)                                                         as c_en_curso,
        case
            when f.activo is null then 'activo_sin_valor'
            when f.activo is true and f.fin is not null then 'activo_terminado'
        end                                                                        as contradiccion
    from fin f
)
select
    count(*)                                                    as filas,
    count(*) filter (where vigente)                             as vigentes_canonico,
    count(*) filter (where c_en_curso)                          as en_curso_criterio_c,
    count(*) filter (where b_abierto)                           as abiertas_criterio_b,
    count(*) filter (where contradiccion = 'activo_terminado')  as activo_true_ya_cerrado,
    count(*) filter (where contradiccion = 'activo_sin_valor')  as activo_null,
    -- Regla 1: dejan de aceptar reservas NUEVAS del bot (antes B, ahora canónico).
    count(*) filter (where b_abierto and not vigente)           as regla1_dejan_de_aceptar_reservas,
    -- Regla 2: dejan de recibir recordatorios (activo distinto de false y no vigentes).
    count(*) filter (where activo is not false and not vigente) as regla2_sin_recordatorios,
    -- Reglas 3 y 4 (Eventos del panel): antes «En curso», ahora «Cerrado».
    count(*) filter (where activo is null)                      as regla4_panel_pasa_a_cerrado,
    -- Pendientes de F3: se siguen mostrando «En curso» en Eventos.
    count(*) filter (where contradiccion = 'activo_terminado')  as pendiente_f3_en_curso_en_eventos
from f2_estado;

-- 2) RESUMEN POR CLIENTE (usuario_id): dónde están los casos.
with base as (
    select
        e.id,
        e.usuario_id,
        to_jsonb(e)->>'tabla'                       as tabla,
        to_jsonb(e)->>'valor'                       as valor,
        to_jsonb(e)->>'fecha_evento'                as fecha_evento,
        to_jsonb(e)->>'hora_cierre'                 as hora_cierre,
        e.activo,
        to_jsonb(e)->>'estado'                      as estado,
        to_jsonb(e)->>'cierre_estado'               as cierre_estado,
        regexp_replace(coalesce(to_jsonb(e)->>'cierre_motivo', ''), '^normalizado: ', '') as cierre_motivo,
        nullif(to_jsonb(e)->>'reservados', '')::numeric as reservados,
        nullif(to_jsonb(e)->>'pagados', '')::numeric    as pagados,
        to_jsonb(e)->>'creado_en'                   as creado_en,
        to_jsonb(e)->>'actualizado_en'              as actualizado_en
    from public.eventos_bot e
),
motivo as (
    select b.*,
        case
            when b.estado in ('desactivado', 'cancelado', 'eliminado') then b.estado
            when b.cierre_motivo like 'panel:%'
                 and substring(b.cierre_motivo from '^panel:([^[:space:]:]*)') in ('desactivado', 'cancelado', 'eliminado')
                then substring(b.cierre_motivo from '^panel:([^[:space:]:]*)')
            when b.cierre_motivo like 'sustituido%' then 'sustituido'
        end as motivo
    from base b
),
fin as (
    select m.*,
        coalesce(m.motivo,
            case when m.activo is false or m.estado = 'cerrado' or m.cierre_estado = 'cerrado' then 'cerrado' end) as fin
    from motivo m
),
f2_estado as (
    select f.*,
        (f.activo is true and f.fin is null)                                       as vigente,
        (f.activo is distinct from false and f.estado is distinct from 'cerrado')  as b_abierto,
        (f.activo is true)                                                         as c_en_curso,
        case
            when f.activo is null then 'activo_sin_valor'
            when f.activo is true and f.fin is not null then 'activo_terminado'
        end                                                                        as contradiccion
    from fin f
)
select usuario_id,
    count(*) filter (where contradiccion = 'activo_terminado') as activo_true_ya_cerrado,
    count(*) filter (where contradiccion = 'activo_sin_valor') as activo_null,
    count(*) filter (where contradiccion is not null and coalesce(reservados, 0) + coalesce(pagados, 0) > 0) as con_numeros_tomados,
    count(*) as filas
from f2_estado
group by usuario_id
having count(*) filter (where contradiccion is not null) > 0
order by 2 desc, 3 desc;

-- 3) CASOS A REVISAR: una fila por caso, sin datos personales.
with base as (
    select
        e.id,
        e.usuario_id,
        to_jsonb(e)->>'tabla'                       as tabla,
        to_jsonb(e)->>'valor'                       as valor,
        to_jsonb(e)->>'fecha_evento'                as fecha_evento,
        to_jsonb(e)->>'hora_cierre'                 as hora_cierre,
        e.activo,
        to_jsonb(e)->>'estado'                      as estado,
        to_jsonb(e)->>'cierre_estado'               as cierre_estado,
        regexp_replace(coalesce(to_jsonb(e)->>'cierre_motivo', ''), '^normalizado: ', '') as cierre_motivo,
        nullif(to_jsonb(e)->>'reservados', '')::numeric as reservados,
        nullif(to_jsonb(e)->>'pagados', '')::numeric    as pagados,
        to_jsonb(e)->>'creado_en'                   as creado_en,
        to_jsonb(e)->>'actualizado_en'              as actualizado_en
    from public.eventos_bot e
),
motivo as (
    select b.*,
        case
            when b.estado in ('desactivado', 'cancelado', 'eliminado') then b.estado
            when b.cierre_motivo like 'panel:%'
                 and substring(b.cierre_motivo from '^panel:([^[:space:]:]*)') in ('desactivado', 'cancelado', 'eliminado')
                then substring(b.cierre_motivo from '^panel:([^[:space:]:]*)')
            when b.cierre_motivo like 'sustituido%' then 'sustituido'
        end as motivo
    from base b
),
fin as (
    select m.*,
        coalesce(m.motivo,
            case when m.activo is false or m.estado = 'cerrado' or m.cierre_estado = 'cerrado' then 'cerrado' end) as fin
    from motivo m
),
f2_estado as (
    select f.*,
        (f.activo is true and f.fin is null)                                       as vigente,
        (f.activo is distinct from false and f.estado is distinct from 'cerrado')  as b_abierto,
        (f.activo is true)                                                         as c_en_curso,
        case
            when f.activo is null then 'activo_sin_valor'
            when f.activo is true and f.fin is not null then 'activo_terminado'
        end                                                                        as contradiccion
    from fin f
)
select
    s.id                as evento_id,
    s.usuario_id,
    s.contradiccion,
    s.activo, s.estado, s.cierre_estado, s.motivo, s.fin,
    s.vigente, s.b_abierto, s.c_en_curso,
    s.tabla, s.valor, s.fecha_evento, s.hora_cierre,
    s.reservados, s.pagados,
    (select count(*) from public.event_sessions es
      where es.evento_id = s.id and es.estado in ('pendiente', 'abierto', 'cerrando')) as ciclos_en_curso,
    (select count(*) from public.sorteos_programados_grupos pg
      where pg.evento_bot_id = s.id)                                                  as grupos_programados,
    s.creado_en, s.actualizado_en
from f2_estado s
where s.contradiccion is not null
order by s.contradiccion, s.usuario_id, s.creado_en desc nulls last;

rollback;
