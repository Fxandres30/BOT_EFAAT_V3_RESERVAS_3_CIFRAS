-- ==========================================================================
-- SOLO LECTURA — reservas que NO se pueden atribuir de forma inequívoca a un
-- cliente (sin usuario_global_id). Documenta lo que el sticker de pago NO
-- toca (decisión 31/10/2026: no se modifican reservas antiguas sin
-- identificador inequívoco; se pagan a mano desde el panel).
--
-- PREPARADO EL 2026-10-31. NO EJECUTADO. Ejecutar en el SQL Editor de
-- Supabase solo cuando se autorice. Dos pasos, ambos READ ONLY:
--   PASO 1 genera el texto de la consulta para TODAS las tablas de números
--          del sistema (las tablas son dinámicas, una por precio).
--   PASO 2 = copiar el texto devuelto por el paso 1 y ejecutarlo.
--
-- Clasificación de cada reserva (reservado / pagado):
--   1_identificada      usuario_global_id: consultas Y sticker la reconocen.
--   2_solo_lid          sin id, con LID: las consultas («qué debo») la
--                       reconocen por el LID del cliente; el sticker NO.
--   3_solo_telefono     sin id ni LID, con teléfono/contacto: las consultas
--                       la reconocen por teléfono; el sticker NO.
--   4_sin_identificador nadie puede atribuirla (solo el panel).
-- telefono_compartido: filas sin id cuyo teléfono figura en MÁS de un
--   usuario: ni siquiera la regla de respaldo es inequívoca.
-- ==========================================================================

-- PASO 1 -------------------------------------------------------------------
begin read only;

with tablas as (
    select distinct t.tabla
    from (
        select tabla from public.eventos_bot where tabla is not null
        union
        select tabla_fisica from public.tablas_cliente where tabla_fisica is not null
    ) t
    -- Solo tablas que existen y tienen todas las columnas que se leen.
    where (select count(*) from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = t.tabla
             and c.column_name in ('usuario_global_id', 'lid', 'telefono', 'contacto', 'estado', 'usuario_id')) = 6
)
select string_agg(format($q$
select %1$L as tabla, r.usuario_id as cliente, r.estado,
       case when r.usuario_global_id is not null then '1_identificada'
            when coalesce(r.lid, '') <> '' then '2_solo_lid'
            when coalesce(r.telefono, r.contacto, '') <> '' then '3_solo_telefono'
            else '4_sin_identificador' end as identificacion,
       count(*) as filas,
       count(*) filter (where r.usuario_global_id is null and coalesce(r.lid, '') = ''
                          and (select count(*) from public.usuarios u
                               where u.telefono in (r.telefono, r.contacto)) > 1) as telefono_compartido
from public.%1$I r
where r.estado in ('reservado', 'pagado')
group by 1, 2, 3, 4$q$, tabla), E'\nunion all\n' order by tabla)
       || E'\norder by tabla, cliente, estado, identificacion;' as consulta_paso_2
from tablas;

rollback;

-- PASO 2 -------------------------------------------------------------------
-- begin read only;
-- <pegar aquí el texto de consulta_paso_2>
-- rollback;
