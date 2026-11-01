-- ==========================================================================
-- 043 — UN SORTEO ACTIVO POR PRECIO Y CLIENTE (protección atómica en la base).
--
-- PREPARADA EL 2026-11-01 (sustituye la versión «por tabla» del 31/10, que
-- nunca se aplicó). NO APLICADA. Ejecutar manualmente en el SQL Editor de
-- Supabase solo cuando se autorice Y después de desplegar el backend que la
-- entiende (ver docs/activacion/UN_SORTEO_ACTIVO_POR_PRECIO.md).
--
-- Regla (decisión del 01/11): un cliente (usuario_id) no puede tener a la vez
-- dos sorteos ACTIVOS distintos (identidad_evento_real distinta) del MISMO
-- PRECIO (valor). Sorteos de precios distintos pueden estar activos a la vez
-- aunque compartan tabla física ($3.000 y $10.000 usan 5k_15k). Un mismo
-- sorteo en varios grupos son varias filas con la MISMA identidad: se permite.
--
-- Precio normalizado: solo los dígitos de valor (igual que el código:
-- shared/eventos/unSorteoPorPrecio.precioDe), así «3000» y 3000 coinciden.
--
-- Restricción de exclusión, no índice único: un índice único sobre
-- (usuario_id, valor) impediría el mismo sorteo en dos grupos. Postgres la
-- comprueba en cada INSERT/UPDATE, también entre dos procesos a la vez
-- (publicador y detector): el segundo recibe 23P01 y no escribe.
-- DEFERRABLE INITIALLY IMMEDIATE: se comprueba al final de cada sentencia, así
-- corregir la identidad de un sorteo en todos sus grupos con UN update no
-- choca consigo mismo.
--
-- «Activo» = la misma regla que shared/eventos/estadosGestion.finDelEvento:
-- activo = true, estado no cerrado/desactivado/cancelado/eliminado,
-- cierre_estado distinto de 'cerrado', cierre_motivo sin «panel:…» ni
-- «sustituido…». Filas sin precio, sin cliente o sin identidad (históricas)
-- quedan fuera de la regla.
--
-- No modifica ni borra ninguna fila. Si ya hay precios con dos sorteos
-- activos, SE DETIENE sin cambiar nada y dice cuántos: resolverlos antes con
-- docs/activacion/sorteos_activos_por_precio_solo_lectura.sql.
--
-- No toca RLS, políticas ni permisos. Requiere la extensión btree_gist
-- (disponible en Supabase) para usar = y <> en un índice GiST.
--
-- Reversión: alter table public.eventos_bot drop constraint if exists
--            eventos_bot_un_sorteo_activo_por_precio;
-- ==========================================================================

begin;

create extension if not exists btree_gist with schema extensions;

-- Columnas necesarias (015 identidad, 023 cierre_*). Sin ellas, se detiene.
do $$
declare
    faltan text;
begin
    select string_agg(c, ', ') into faltan
    from unnest(array['usuario_id', 'valor', 'identidad_evento_real', 'activo', 'estado', 'cierre_estado', 'cierre_motivo']) as c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'eventos_bot' and column_name = c);
    if faltan is not null then
        raise exception '043: a eventos_bot le faltan columnas (%). Aplica antes 015 y 023. No se cambió nada.', faltan;
    end if;
end $$;

-- Datos actuales: ningún precio puede tener ya dos sorteos activos.
do $$
declare
    conflictos int;
begin
    select count(*) into conflictos
    from (
        select e.usuario_id, nullif(regexp_replace(e.valor::text, '[^0-9]', '', 'g'), '')::numeric as precio
        from public.eventos_bot e
        where e.activo is true
          and e.valor is not null and e.usuario_id is not null and e.identidad_evento_real is not null
          and coalesce(e.estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
          and coalesce(e.cierre_estado, '') <> 'cerrado'
          and coalesce(e.cierre_motivo, '') not like 'panel:%'
          and coalesce(e.cierre_motivo, '') not like 'sustituido%'
        group by 1, 2
        having count(distinct e.identidad_evento_real) > 1
    ) x;
    if conflictos > 0 then
        raise exception '043: % precio(s) ya tienen más de un sorteo activo. Resuélvelos antes (docs/activacion/sorteos_activos_por_precio_solo_lectura.sql). No se cambió nada.', conflictos;
    end if;
end $$;

alter table public.eventos_bot drop constraint if exists eventos_bot_un_sorteo_activo_por_precio;

alter table public.eventos_bot
    add constraint eventos_bot_un_sorteo_activo_por_precio
    exclude using gist (
        usuario_id with =,
        (nullif(regexp_replace(valor::text, '[^0-9]', '', 'g'), '')::numeric) with =,
        identidad_evento_real with <>
    )
    where (
        activo is true
        and valor is not null and usuario_id is not null and identidad_evento_real is not null
        and coalesce(estado, '') not in ('cerrado', 'desactivado', 'cancelado', 'eliminado')
        and coalesce(cierre_estado, '') <> 'cerrado'
        and coalesce(cierre_motivo, '') not like 'panel:%'
        and coalesce(cierre_motivo, '') not like 'sustituido%'
    )
    deferrable initially immediate;

commit;

-- Verificación (solo lectura):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'eventos_bot_un_sorteo_activo_por_precio';
