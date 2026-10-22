-- ==========================================================================
-- RELLENO OPCIONAL — cliente de los mensajes HISTÓRICOS (mensajes_grupos_sorteos)
--
-- DECISIÓN DEL DUEÑO. NO APLICADO. Solo tras la migración 028 y ANTES de la
-- 029 (si no, los chats anteriores dejan de verse en el panel).
--
-- Regla (no se inventa ningún dueño): a un mensaje histórico sin cliente se
-- le asigna el cliente que operó SU grupo según eventos_bot, y solo si en
-- ese grupo hubo sorteos de UN ÚNICO cliente. Grupos sin sorteos o con
-- sorteos de más de un cliente: el mensaje queda sin cliente (invisible en
-- el panel tras la 029; el bot no se ve afectado).
-- ==========================================================================


-- Duplicados históricos: la 021 dejó 550 pares (grupo_id, mensaje_id) con
-- más de una fila. El índice único de la 028 es por (cliente, grupo,
-- mensaje): se rellena SOLO la fila más antigua de cada par; las copias
-- quedan sin cliente. Nunca se rellena una fila que chocaría con otra que
-- ese cliente ya tenga.

-- R1. VISTA PREVIA (solo lectura): cuántas filas se rellenarían y cuántas
-- quedarían sin cliente.
set transaction read only;
with duenos as (
    select grupo_id, min(usuario_id::text)::uuid as cliente
    from public.eventos_bot
    where usuario_id is not null
    group by grupo_id
    having count(distinct usuario_id) = 1
),
candidatas as (
    select distinct on (m.grupo_id, m.mensaje_id) m.id, d.cliente
    from public.mensajes_grupos_sorteos m
    join duenos d on d.grupo_id = m.grupo_id
    where m.cliente_usuario_id is null
      and not exists (
          select 1 from public.mensajes_grupos_sorteos x
          where x.cliente_usuario_id = d.cliente and x.grupo_id = m.grupo_id and x.mensaje_id = m.mensaje_id
      )
    order by m.grupo_id, m.mensaje_id, m.id
)
select
    (select count(*) from candidatas) as se_rellenarian,
    (select count(*) from public.mensajes_grupos_sorteos where cliente_usuario_id is null) - (select count(*) from candidatas) as quedarian_sin_cliente;


-- R2. RELLENO (escritura; ejecutar solo con autorización y tras revisar R1).
-- Toca SOLO filas con cliente_usuario_id NULL; nunca cambia uno existente.
-- begin;
-- with duenos as (
--     select grupo_id, min(usuario_id::text)::uuid as cliente
--     from public.eventos_bot
--     where usuario_id is not null
--     group by grupo_id
--     having count(distinct usuario_id) = 1
-- ),
-- candidatas as (
--     select distinct on (m.grupo_id, m.mensaje_id) m.id, d.cliente
--     from public.mensajes_grupos_sorteos m
--     join duenos d on d.grupo_id = m.grupo_id
--     where m.cliente_usuario_id is null
--       and not exists (
--           select 1 from public.mensajes_grupos_sorteos x
--           where x.cliente_usuario_id = d.cliente and x.grupo_id = m.grupo_id and x.mensaje_id = m.mensaje_id
--       )
--     order by m.grupo_id, m.mensaje_id, m.id
-- )
-- update public.mensajes_grupos_sorteos m
-- set cliente_usuario_id = c.cliente
-- from candidatas c
-- where m.id = c.id;
-- commit;
--
-- Vuelta atrás: no hay forma de distinguir después las filas rellenadas de
-- las escritas por el bot salvo por fecha. Guardar ANTES los ids afectados:
--   create table public._relleno_cliente_mensajes_ids as
--   select m.id from public.mensajes_grupos_sorteos m where m.cliente_usuario_id is null;
-- ==========================================================================
