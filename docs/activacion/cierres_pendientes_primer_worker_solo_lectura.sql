-- ==========================================================================
-- SOLO LECTURA — filas de eventos_bot que el PRIMER ciclo del worker cerraría
-- POR HORA al desplegar el cierre por fecha y hora completas (31/10/2026).
--
-- PREPARADO EL 2026-10-31. NO EJECUTADO. Transacción READ ONLY con ROLLBACK:
-- no modifica nada. Ejecutar en el SQL Editor de Supabase solo cuando se
-- autorice, ANTES de desplegar el backend.
--
-- Reproduce exactamente el criterio del código:
--   workerEventos.js  -> activo = true, del cliente, grupo autorizado
--                        (grupos_autorizados.activo), sin fin registrado
--                        (estadosGestion.finDelEvento).
--   verificarHoraCierre.js -> instante = fecha_evento (o HOY si no tiene) +
--                        hora_cierre en America/Bogota; vence si ya pasó.
--   procesarSorteo.js -> «recuperado» si el instante fue un día anterior
--                        (sin aviso de cierre); «grupo en uso» si en el mismo
--                        grupo hay OTRO sorteo vigente que aún no vence
--                        (solo se marca la fila, el grupo de WhatsApp no se
--                        cierra).
--
-- Limitaciones (no visibles desde eventos_bot):
--   - El worker solo corre para clientes con una sesión de WhatsApp activa.
--   - Un cierre por «todos pagados» depende de la tabla de números y no se
--     calcula aquí (columna pagados/reservados = contadores guardados, solo
--     orientativos).
--   - Filas sin hora_cierre o con una hora ilegible nunca se cierran por hora.
-- ==========================================================================

begin read only;

with params as (
    select now() as ahora,
           (now() at time zone 'America/Bogota')::date as hoy
),
filas as (
    select e.*,
           substring(e.hora_cierre::text from '^\s*((?:[01]?[0-9]|2[0-3]):[0-5][0-9])') as hora_txt,
           case when e.fecha_evento is null then null else left(e.fecha_evento::text, 10)::date end as fecha
    from public.eventos_bot e
),
vigentes as (
    -- Activas y sin fin registrado (= !finDelEvento), en un grupo autorizado.
    select f.*,
           coalesce(f.fecha, p.hoy) as fecha_cierre,
           case when f.hora_txt is null then null
                else ((coalesce(f.fecha, p.hoy) + f.hora_txt::time) at time zone 'America/Bogota')
           end as instante_cierre
    from filas f
    cross join params p
    where f.activo is true
      and f.usuario_id is not null
      and coalesce(f.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
      and coalesce(f.cierre_estado, '') <> 'cerrado'
      and coalesce(f.cierre_motivo, '') !~ '^panel:(desactivado|cancelado|eliminado)([[:space:]:]|$)'
      and coalesce(f.cierre_motivo, '') not like 'sustituido%'
      and exists (
          select 1 from public.grupos_autorizados ga
          where ga.usuario_id = f.usuario_id and ga.grupo_id = f.grupo_id and ga.activo is true
      )
),
clasificadas as (
    select v.*,
           -- Clave del sorteo lógico (sorteoReal.claveSorteo).
           coalesce(v.identidad_evento_real, 'evento:' || v.id::text) as clave_sorteo,
           (v.instante_cierre is not null and v.instante_cierre <= p.ahora) as vence
    from vigentes v
    cross join params p
),
a_cerrar as (
    select c.*,
           (c.fecha_cierre < p.hoy) as recuperado,
           exists (
               select 1 from clasificadas o
               where o.usuario_id = c.usuario_id
                 and o.grupo_id = c.grupo_id
                 and o.clave_sorteo <> c.clave_sorteo
                 and not o.vence
           ) as grupo_en_uso
    from clasificadas c
    cross join params p
    where c.vence
)
-- 1) DETALLE: cada fila que el primer ciclo cerraría.
select usuario_id                                         as cliente,
       grupo_id                                           as grupo,
       id                                                 as evento_id,
       nombre_evento,
       fecha_evento,
       hora_cierre,
       estado,
       cierre_estado,
       cierre_intentos,
       (fecha_evento is null)                             as sin_fecha,
       instante_cierre at time zone 'America/Bogota'      as cierre_hora_colombia,
       recuperado                                         as cierre_recuperado_sin_aviso,
       grupo_en_uso                                       as solo_marca_fila_grupo_sigue_abierto,
       reservados, pagados,
       creado_en
from a_cerrar
order by cliente, grupo, instante_cierre;

-- 2) RESUMEN agrupado por estado, fecha, cliente y grupo.
with params as (
    select now() as ahora, (now() at time zone 'America/Bogota')::date as hoy
),
filas as (
    select e.*,
           substring(e.hora_cierre::text from '^\s*((?:[01]?[0-9]|2[0-3]):[0-5][0-9])') as hora_txt,
           case when e.fecha_evento is null then null else left(e.fecha_evento::text, 10)::date end as fecha
    from public.eventos_bot e
),
clasificadas as (
    select f.*,
           coalesce(f.identidad_evento_real, 'evento:' || f.id::text) as clave_sorteo,
           coalesce(f.fecha, p.hoy) as fecha_cierre,
           (f.hora_txt is not null and ((coalesce(f.fecha, p.hoy) + f.hora_txt::time) at time zone 'America/Bogota') <= p.ahora) as vence
    from filas f
    cross join params p
    where f.activo is true
      and f.usuario_id is not null
      and coalesce(f.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
      and coalesce(f.cierre_estado, '') <> 'cerrado'
      and coalesce(f.cierre_motivo, '') !~ '^panel:(desactivado|cancelado|eliminado)([[:space:]:]|$)'
      and coalesce(f.cierre_motivo, '') not like 'sustituido%'
      and exists (
          select 1 from public.grupos_autorizados ga
          where ga.usuario_id = f.usuario_id and ga.grupo_id = f.grupo_id and ga.activo is true
      )
)
select c.usuario_id                                       as cliente,
       c.grupo_id                                         as grupo,
       coalesce(c.estado, '(sin estado)')                 as estado,
       coalesce(c.cierre_estado, '(sin cierre)')          as cierre_estado,
       c.fecha_cierre                                     as fecha,
       case when c.fecha_cierre < p.hoy then 'recuperado (sin aviso)' else 'cierre normal de hoy' end as tipo_cierre,
       bool_or(exists (
           select 1 from clasificadas o
           where o.usuario_id = c.usuario_id and o.grupo_id = c.grupo_id
             and o.clave_sorteo <> c.clave_sorteo and not o.vence
       ))                                                 as grupo_en_uso_por_otro_sorteo,
       count(*)                                           as filas,
       count(distinct c.clave_sorteo)                     as sorteos
from clasificadas c
cross join params p
where c.vence
group by c.usuario_id, c.grupo_id, c.estado, c.cierre_estado, c.fecha_cierre, (c.fecha_cierre < p.hoy)
order by cliente, fecha, grupo;

-- 3) CONTROL: filas activas=true que el worker IGNORARÁ por estar ya
--    terminadas (no se cierran ni se tocan; solo informativo).
select usuario_id as cliente, grupo_id as grupo, estado, cierre_estado, cierre_motivo,
       count(*) as filas, min(fecha_evento::text) as desde, max(fecha_evento::text) as hasta
from public.eventos_bot
where activo is true
  and (coalesce(estado, '') in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
       or coalesce(cierre_estado, '') = 'cerrado'
       or coalesce(cierre_motivo, '') ~ '^panel:(desactivado|cancelado|eliminado)([[:space:]:]|$)'
       or coalesce(cierre_motivo, '') like 'sustituido%')
group by usuario_id, grupo_id, estado, cierre_estado, cierre_motivo
order by cliente, grupo;

rollback;
