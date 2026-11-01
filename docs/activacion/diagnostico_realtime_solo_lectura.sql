-- ==========================================================================
-- DIAGNÓSTICO DE SOLO LECTURA — publicación Realtime de las tablas que usa
-- la pantalla de Tablas (/tablas/:precio).
--
-- PREPARADO EL 2026-10-31. NO MODIFICA NADA: se ejecuta dentro de una
-- transacción READ ONLY que termina en ROLLBACK. Pegar entero en el SQL
-- Editor de Supabase y ejecutar. Cada bloque devuelve una tabla; anotar
-- los resultados en el informe de activación.
--
-- Qué usa el panel (frontend/hooks/useTablaPrecio.ts):
--   · SUSCRIPCIÓN Realtime (postgres_changes, filtro usuario_id=eq.<uid>):
--       - la cuadrícula del precio: reservas_dos_cifras, 5k_15k_reservas_2_cifras
--       - eventos_bot
--       - reservas_actividad (solo INSERT)
--   · LECTURA incremental (sin suscripción): reservas_auditoria (032). Si
--     está en la publicación se podría suscribir en el futuro; si no, el
--     panel sigue leyéndola por ventana de tiempo (gte), como hoy.
--
-- Cómo interpretar:
--   1. existe = false              -> la tabla no está en la base (p. ej. la
--                                     032 sin aplicar): el panel lo tolera.
--   2. en_realtime = false         -> esa tabla NO emite cambios: el panel no
--                                     se entera en vivo (solo al releer).
--   3. replica_identity            -> 'default' = UPDATE/DELETE solo traen la
--                                     clave en el registro anterior; 'full' =
--                                     traen la fila completa. Con 'default'
--                                     un DELETE no lleva usuario_id, así que
--                                     el filtro por usuario no lo puede
--                                     aplicar (el panel ignora DELETE ajenos).
--   4. rls / politicas_select      -> Realtime entrega a cada suscriptor solo
--                                     las filas que su SELECT permite: sin
--                                     política SELECT para authenticated no
--                                     llega NINGÚN evento al navegador.
-- ==========================================================================

begin read only;

-- 1) Publicación supabase_realtime: existe y qué operaciones publica.
select p.pubname,
       p.puballtables  as todas_las_tablas,
       p.pubinsert     as publica_insert,
       p.pubupdate     as publica_update,
       p.pubdelete     as publica_delete,
       p.pubtruncate   as publica_truncate
from pg_publication p
where p.pubname = 'supabase_realtime';

-- 2) Por tabla: existe, está en la publicación, replica identity y RLS.
with objetivo(tabla, uso) as (
    values ('reservas_auditoria',        'lectura incremental (032)'),
           ('reservas_actividad',        'suscripción INSERT'),
           ('eventos_bot',               'suscripción *'),
           ('reservas_dos_cifras',       'suscripción * (cuadrícula)'),
           ('5k_15k_reservas_2_cifras',  'suscripción * (cuadrícula)')
)
select o.tabla,
       o.uso,
       (c.oid is not null)                                         as existe,
       exists (select 1 from pg_publication_tables pt
               where pt.pubname = 'supabase_realtime'
                 and pt.schemaname = 'public' and pt.tablename = o.tabla) as en_realtime,
       case c.relreplident when 'd' then 'default' when 'f' then 'full'
                           when 'i' then 'index' when 'n' then 'nothing' end as replica_identity,
       c.relrowsecurity                                            as rls,
       c.relforcerowsecurity                                       as rls_forzada
from objetivo o
left join pg_class c on c.relname = o.tabla and c.relnamespace = 'public'::regnamespace
order by o.tabla;

-- 3) Columnas publicadas (si la publicación filtra columnas, Postgres 15+).
--    Vacío = la tabla no está publicada. columnas_publicadas debe incluir
--    usuario_id, numero, estado y las demás que lee el panel (sin lista de
--    columnas en la publicación, aparecen todas).
select pt.tablename, pt.attnames as columnas_publicadas, pt.rowfilter as filtro_de_filas
from pg_publication_tables pt
where pt.pubname = 'supabase_realtime'
  and pt.schemaname = 'public'
  and pt.tablename in ('reservas_auditoria', 'reservas_actividad', 'eventos_bot',
                       'reservas_dos_cifras', '5k_15k_reservas_2_cifras')
order by 1;

-- 4) Políticas SELECT que verá Realtime para el rol authenticated.
select pol.tablename, pol.policyname, pol.roles, pol.cmd, pol.qual as condicion
from pg_policies pol
where pol.schemaname = 'public'
  and pol.tablename in ('reservas_auditoria', 'reservas_actividad', 'eventos_bot',
                        'reservas_dos_cifras', '5k_15k_reservas_2_cifras')
  and pol.cmd in ('SELECT', 'ALL')
order by 1, 2;

-- 5) Permisos de tabla (sin GRANT SELECT para authenticated tampoco hay eventos).
select o.tabla,
       case when to_regclass(format('public.%I', o.tabla)) is null then null
            else has_table_privilege('authenticated', format('public.%I', o.tabla), 'select') end as authenticated_select,
       case when to_regclass(format('public.%I', o.tabla)) is null then null
            else has_table_privilege('anon', format('public.%I', o.tabla), 'select') end          as anon_select
from (values ('reservas_auditoria'), ('reservas_actividad'), ('eventos_bot'),
             ('reservas_dos_cifras'), ('5k_15k_reservas_2_cifras')) as o(tabla)
order by 1;

rollback;

-- ==========================================================================
-- Qué NO hace este archivo (requiere autorización aparte):
--   alter publication supabase_realtime add table public.reservas_auditoria;
--   alter table public.<tabla> replica identity full;
-- Ambos cambian la base de producción. Ver docs/activacion/VERIFICAR_REALTIME.md.
-- ==========================================================================
