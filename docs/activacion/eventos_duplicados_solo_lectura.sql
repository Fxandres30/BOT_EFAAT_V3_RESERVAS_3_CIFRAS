-- ==========================================================================
-- eventos_duplicados_solo_lectura.sql (F4-F, 06/11/2026)
-- NO EJECUTADO contra ninguna base real. Requisito de la migración 049.
--
-- SOLO LECTURA: SELECT dentro de una transacción de solo lectura que termina
-- en ROLLBACK. No crea, no modifica, no borra. Sin datos personales: ids,
-- estados, fechas y contadores.
--
-- Devuelve dos resultados:
--   1) resumen: cuántos sorteos tienen más de una fila ACTIVA en el mismo
--      grupo (lo que la 049 rechazaría) y cuántas filas hay de más;
--   2) casos: una fila por cada fila duplicada, para decidir cuál se conserva
--      (normalmente la más antigua, que tiene el ciclo y las reservas) — la
--      reparación NO se hace desde aquí.
-- ==========================================================================

begin;
set transaction read only;

-- 1) RESUMEN
with dup as (
    select usuario_id, grupo_id, identidad_evento_real, count(*) as filas
    from public.eventos_bot
    where activo is true and identidad_evento_real is not null
    group by 1, 2, 3
    having count(*) > 1
)
select count(*) as sorteos_duplicados, coalesce(sum(filas - 1), 0) as filas_de_mas, count(distinct usuario_id) as clientes
from dup;

-- 2) CASOS
with dup as (
    select usuario_id, grupo_id, identidad_evento_real
    from public.eventos_bot
    where activo is true and identidad_evento_real is not null
    group by 1, 2, 3
    having count(*) > 1
)
select
    e.usuario_id, e.grupo_id, e.identidad_evento_real, e.id as evento_id,
    row_number() over (partition by e.usuario_id, e.grupo_id, e.identidad_evento_real order by e.creado_en, e.id) as orden,
    e.estado, e.abierto, e.creado_en, e.actualizado_en,
    e.reservados, e.pagados,
    (select count(*) from public.event_sessions s where s.evento_id = e.id) as ciclos
from public.eventos_bot e
join dup d using (usuario_id, grupo_id, identidad_evento_real)
where e.activo is true
order by e.usuario_id, e.grupo_id, e.identidad_evento_real, orden;

rollback;
