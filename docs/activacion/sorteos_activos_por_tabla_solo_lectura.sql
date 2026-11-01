-- ==========================================================================
-- SOLO LECTURA — tablas físicas con MÁS DE UN sorteo activo a la vez, por
-- cliente. Requisito de la migración 043 (eventos_bot_un_sorteo_activo_por_tabla):
-- debe devolver 0 filas antes de aplicarla.
--
-- PREPARADO EL 2026-10-31. Transacción READ ONLY con ROLLBACK: no modifica
-- nada. «Activo» = misma regla que la 043 y que estadosGestion.finDelEvento.
-- ==========================================================================

begin read only;

-- 1) Conflictos: cada fila es una tabla de un cliente con varios sorteos activos.
with activos as (
    select e.*
    from public.eventos_bot e
    where e.activo is true
      and e.tabla is not null and e.usuario_id is not null and e.identidad_evento_real is not null
      and coalesce(e.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
      and coalesce(e.cierre_estado, '') <> 'cerrado'
      and coalesce(e.cierre_motivo, '') not like 'panel:%'
      and coalesce(e.cierre_motivo, '') not like 'sustituido%'
)
select a.usuario_id,
       a.tabla,
       count(distinct a.identidad_evento_real)                                        as sorteos_activos,
       array_agg(distinct a.nombre_evento || ' ' || coalesce(a.fecha_evento::text, '') || ' ' || coalesce(a.hora_fin::text, '')) as sorteos,
       array_agg(distinct a.grupo_id)                                                 as grupos,
       min(a.creado_en)                                                               as desde
from activos a
group by a.usuario_id, a.tabla
having count(distinct a.identidad_evento_real) > 1
order by a.usuario_id, a.tabla;

-- 2) Detalle de esos conflictos, fila por fila (qué decidir en cada grupo).
with activos as (
    select e.*
    from public.eventos_bot e
    where e.activo is true
      and e.tabla is not null and e.usuario_id is not null and e.identidad_evento_real is not null
      and coalesce(e.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
      and coalesce(e.cierre_estado, '') <> 'cerrado'
      and coalesce(e.cierre_motivo, '') not like 'panel:%'
      and coalesce(e.cierre_motivo, '') not like 'sustituido%'
),
conflictivas as (
    select usuario_id, tabla from activos group by usuario_id, tabla
    having count(distinct identidad_evento_real) > 1
)
select a.usuario_id, a.tabla, a.identidad_evento_real, a.id as evento_id, a.grupo_id, a.grupo_nombre,
       a.nombre_evento, a.fecha_evento, a.hora_fin, a.hora_cierre, a.estado, a.creado_en
from activos a
join conflictivas c using (usuario_id, tabla)
order by a.usuario_id, a.tabla, a.creado_en;

-- 3) Filas activas que la 043 NO puede proteger (sin identidad, tabla o cliente).
select count(*) filter (where identidad_evento_real is null) as activas_sin_identidad,
       count(*) filter (where tabla is null)                 as activas_sin_tabla,
       count(*) filter (where usuario_id is null)            as activas_sin_cliente
from public.eventos_bot
where activo is true and coalesce(estado, '') <> 'cerrado';

-- 4) ¿Está btree_gist disponible y la restricción ya creada?
select (select count(*) from pg_available_extensions where name = 'btree_gist') as btree_gist_disponible,
       (select extversion from pg_extension where extname = 'btree_gist')     as btree_gist_instalada,
       exists (select 1 from pg_constraint where conname = 'eventos_bot_un_sorteo_activo_por_tabla') as restriccion_043;

rollback;
