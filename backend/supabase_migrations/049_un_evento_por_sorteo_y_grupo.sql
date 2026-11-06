-- ==========================================================================
-- 049 — UNA FILA ACTIVA POR SORTEO Y GRUPO (F4-F, 06/11/2026). PREPARADA, NO
-- APLICADA. Ejecutar a mano en el SQL Editor de Supabase solo con
-- autorización, DESPUÉS de:
--   1. ejecutar docs/activacion/eventos_duplicados_solo_lectura.sql y que su
--      resultado 1 diga 0 duplicados (si hay, resolverlos uno a uno, con
--      autorización: esta migración no toca datos);
--   2. desplegar el backend con F4-F (guardarEvento adopta la fila ganadora
--      ante el 23505 de este índice; sin ese código, el perdedor de una
--      carrera fallaría en lugar de adoptar).
--
-- Qué protege (C2): dos operaciones que crean A LA VEZ la fila del mismo
-- sorteo (identidad_evento_real) en el mismo grupo para el mismo cliente.
-- El backend ya lo evita con el reclamo persistente ACTIVAR_EVENTO
-- (automation_actions, UNIQUE de la 006: no necesita esta migración). Este
-- índice es la segunda capa, en la propia tabla: cubre lo que no pase por el
-- reclamo (una versión antigua del backend durante un despliegue, o el
-- registro de reclamos no disponible).
--
-- Solo filas ACTIVAS: el historial (filas cerradas, sustituidas, canceladas
-- o normalizadas del mismo sorteo) no choca. Una fila C3 (activo=true pero ya
-- terminada) sí cuenta como activa: el diagnóstico las lista.
--
-- No es CONCURRENTLY: el SQL Editor envuelve en una transacción y CREATE INDEX
-- CONCURRENTLY no se permite ahí. La creación bloquea las escrituras de
-- eventos_bot mientras dura (segundos con el volumen actual).
-- ==========================================================================

begin;

do $$
declare
    duplicados int;
begin
    select count(*) into duplicados
    from (
        select usuario_id, grupo_id, identidad_evento_real
        from public.eventos_bot
        where activo is true and identidad_evento_real is not null
        group by 1, 2, 3
        having count(*) > 1
    ) d;
    if duplicados > 0 then
        raise exception '049: % sorteo(s) tienen más de una fila activa en el mismo grupo. Resuélvelos antes (docs/activacion/eventos_duplicados_solo_lectura.sql). No se cambió nada.', duplicados;
    end if;
end $$;

create unique index if not exists eventos_bot_un_evento_activo_por_sorteo_y_grupo
    on public.eventos_bot (usuario_id, grupo_id, identidad_evento_real)
    where activo is true and identidad_evento_real is not null;

comment on index public.eventos_bot_un_evento_activo_por_sorteo_y_grupo is
    'Una sola fila ACTIVA por (cliente, grupo, sorteo real). Segunda capa del reclamo ACTIVAR_EVENTO (F4-F, C2).';

commit;

-- Verificación (solo lectura):
--   select indexdef from pg_indexes where indexname = 'eventos_bot_un_evento_activo_por_sorteo_y_grupo';
--
-- Reversión:
--   begin; drop index if exists public.eventos_bot_un_evento_activo_por_sorteo_y_grupo; commit;
