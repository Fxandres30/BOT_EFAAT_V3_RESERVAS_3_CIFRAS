-- ==========================================================================
-- SOLO LECTURA — precios con MÁS DE UN sorteo activo a la vez, por cliente.
-- Requisito de la migración 043 (eventos_bot_un_sorteo_activo_por_precio):
-- la consulta 1 debe devolver 0 filas antes de aplicarla.
--
-- PREPARADO EL 2026-11-01. Transacción READ ONLY con ROLLBACK: no modifica
-- nada. «Activo» = misma regla que la 043 y que estadosGestion.finDelEvento.
-- Precio = solo los dígitos de valor (igual que el código y la 043).
-- ==========================================================================

begin read only;

-- 1) Conflictos: cada fila es un precio de un cliente con varios sorteos activos.
with activos as (
    select e.*, nullif(regexp_replace(e.valor::text, '[^0-9]', '', 'g'), '')::numeric as precio
    from public.eventos_bot e
    where e.activo is true
      and e.valor is not null and e.usuario_id is not null and e.identidad_evento_real is not null
      and coalesce(e.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
      and coalesce(e.cierre_estado, '') <> 'cerrado'
      and coalesce(e.cierre_motivo, '') not like 'panel:%'
      and coalesce(e.cierre_motivo, '') not like 'sustituido%'
)
select a.usuario_id,
       a.precio,
       count(distinct a.identidad_evento_real)                                        as sorteos_activos,
       array_agg(distinct a.nombre_evento || ' ' || coalesce(a.fecha_evento::text, '') || ' ' || coalesce(a.hora_fin::text, '')) as sorteos,
       array_agg(distinct a.grupo_id)                                                 as grupos,
       min(a.creado_en)                                                               as desde
from activos a
group by a.usuario_id, a.precio
having count(distinct a.identidad_evento_real) > 1
order by a.usuario_id, a.precio;

-- 2) Detalle de esos conflictos, fila por fila (qué decidir en cada grupo).
with activos as (
    select e.*, nullif(regexp_replace(e.valor::text, '[^0-9]', '', 'g'), '')::numeric as precio
    from public.eventos_bot e
    where e.activo is true
      and e.valor is not null and e.usuario_id is not null and e.identidad_evento_real is not null
      and coalesce(e.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
      and coalesce(e.cierre_estado, '') <> 'cerrado'
      and coalesce(e.cierre_motivo, '') not like 'panel:%'
      and coalesce(e.cierre_motivo, '') not like 'sustituido%'
),
conflictivos as (
    select usuario_id, precio from activos group by usuario_id, precio
    having count(distinct identidad_evento_real) > 1
)
select a.usuario_id, a.precio, a.tabla, a.identidad_evento_real, a.id as evento_id, a.grupo_id, a.grupo_nombre,
       a.nombre_evento, a.fecha_evento, a.hora_fin, a.hora_cierre, a.estado, a.creado_en
from activos a
join conflictivos c using (usuario_id, precio)
order by a.usuario_id, a.precio, a.creado_en;

-- 3) Precios distintos activos a la vez en la MISMA tabla física (permitido por
--    la regla; informativo: hoy comparten la cuadrícula 00-99).
with activos as (
    select e.usuario_id, e.tabla, nullif(regexp_replace(e.valor::text, '[^0-9]', '', 'g'), '')::numeric as precio
    from public.eventos_bot e
    where e.activo is true and coalesce(e.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
      and coalesce(e.cierre_estado, '') <> 'cerrado'
)
select usuario_id, tabla, array_agg(distinct precio order by precio) as precios_activos
from activos
group by usuario_id, tabla
having count(distinct precio) > 1
order by 1, 2;

-- 4) Filas activas que la 043 NO puede proteger (sin identidad, precio o cliente).
select count(*) filter (where identidad_evento_real is null) as activas_sin_identidad,
       count(*) filter (where valor is null)                 as activas_sin_precio,
       count(*) filter (where usuario_id is null)            as activas_sin_cliente
from public.eventos_bot
where activo is true and coalesce(estado, '') <> 'cerrado';

-- 5) ¿Está btree_gist disponible y la restricción ya creada?
select (select count(*) from pg_available_extensions where name = 'btree_gist') as btree_gist_disponible,
       (select extversion from pg_extension where extname = 'btree_gist')     as btree_gist_instalada,
       exists (select 1 from pg_constraint where conname = 'eventos_bot_un_sorteo_activo_por_precio') as restriccion_043;

rollback;
