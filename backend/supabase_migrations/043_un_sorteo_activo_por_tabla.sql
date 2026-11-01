-- ==========================================================================
-- 043 — UNA TABLA = UN SORTEO ACTIVO (protección atómica en la base).
--
-- PREPARADA EL 2026-10-31. NO APLICADA. Ejecutar manualmente en el SQL
-- Editor de Supabase solo cuando se autorice Y después de desplegar el
-- backend que la entiende (ver docs/activacion/UN_SORTEO_ACTIVO_POR_TABLA.md).
--
-- Regla: un cliente (usuario_id) no puede tener a la vez dos sorteos
-- ACTIVOS distintos (identidad_evento_real distinta) sobre la misma tabla
-- física (tabla). Un mismo sorteo en varios grupos son varias filas con la
-- MISMA identidad: eso sí se permite.
--
-- Por qué una restricción de exclusión y no un índice único: un índice
-- único sobre (usuario_id, tabla) impediría el mismo sorteo en dos grupos.
-- EXCLUDE (usuario_id =, tabla =, identidad <>) solo rechaza la
-- combinación «mismo cliente, misma tabla, OTRO sorteo». La comprueba
-- Postgres en cada INSERT/UPDATE, también entre dos procesos a la vez
-- (publicador y detector): el segundo recibe el error 23P01 y no escribe.
--
-- «Activo» = la misma regla que shared/eventos/estadosGestion.finDelEvento:
-- activo = true, estado no cerrado/desactivado/cancelado/eliminado,
-- cierre_estado distinto de 'cerrado', cierre_motivo sin «panel:…» ni
-- «sustituido…». Filas sin tabla, sin cliente o sin identidad (históricas)
-- quedan fuera de la regla.
--
-- No modifica ni borra ninguna fila. Si ya hay tablas con dos sorteos
-- activos, la migración SE DETIENE sin cambiar nada y dice cuántas son:
-- resolverlas antes con docs/activacion/sorteos_activos_por_tabla_solo_lectura.sql.
--
-- No toca RLS, políticas ni permisos. Requiere la extensión btree_gist
-- (disponible en Supabase) para usar = y <> sobre uuid/text en un índice GiST.
--
-- Reversión: alter table public.eventos_bot drop constraint if exists
--            eventos_bot_un_sorteo_activo_por_tabla;
-- ==========================================================================

begin;

create extension if not exists btree_gist with schema extensions;

-- Columnas necesarias (015 identidad, 023 cierre_*). Sin ellas, se detiene.
do $$
declare
    faltan text;
begin
    select string_agg(c, ', ') into faltan
    from unnest(array['usuario_id', 'tabla', 'identidad_evento_real', 'activo', 'estado', 'cierre_estado', 'cierre_motivo']) as c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'eventos_bot' and column_name = c);
    if faltan is not null then
        raise exception '043: a eventos_bot le faltan columnas (%). Aplica antes 015 y 023. No se cambió nada.', faltan;
    end if;
end $$;

-- Datos actuales: ninguna tabla puede tener ya dos sorteos activos.
do $$
declare
    conflictos int;
begin
    select count(*) into conflictos
    from (
        select e.usuario_id, e.tabla
        from public.eventos_bot e
        where e.activo is true
          and e.tabla is not null and e.usuario_id is not null and e.identidad_evento_real is not null
          and coalesce(e.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
          and coalesce(e.cierre_estado, '') <> 'cerrado'
          and coalesce(e.cierre_motivo, '') not like 'panel:%'
          and coalesce(e.cierre_motivo, '') not like 'sustituido%'
        group by e.usuario_id, e.tabla
        having count(distinct e.identidad_evento_real) > 1
    ) x;
    if conflictos > 0 then
        raise exception '043: % tabla(s) ya tienen más de un sorteo activo. Resuélvelas antes (docs/activacion/sorteos_activos_por_tabla_solo_lectura.sql). No se cambió nada.', conflictos;
    end if;
end $$;

alter table public.eventos_bot drop constraint if exists eventos_bot_un_sorteo_activo_por_tabla;

alter table public.eventos_bot
    add constraint eventos_bot_un_sorteo_activo_por_tabla
    exclude using gist (
        usuario_id with =,
        tabla with =,
        identidad_evento_real with <>
    )
    where (
        activo is true
        and tabla is not null and usuario_id is not null and identidad_evento_real is not null
        and coalesce(estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
        and coalesce(cierre_estado, '') <> 'cerrado'
        and coalesce(cierre_motivo, '') not like 'panel:%'
        and coalesce(cierre_motivo, '') not like 'sustituido%'
    )
    -- Se comprueba al FINAL de cada sentencia, no fila a fila: corregir la
    -- identidad de un sorteo en todos sus grupos con UN update (como hace
    -- sorteosActivos.corregirIdentidad) no choca consigo mismo a mitad.
    deferrable initially immediate;

commit;

-- Verificación (solo lectura):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'eventos_bot_un_sorteo_activo_por_tabla';
