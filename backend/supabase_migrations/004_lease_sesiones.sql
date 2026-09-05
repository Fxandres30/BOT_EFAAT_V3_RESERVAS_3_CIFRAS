-- Fase de LEASE DISTRIBUIDO LOCAL <-> VPS para una misma sesión de WhatsApp.
--
-- Problema que resuelve: LOCAL y VPS pueden ejecutar el mismo backend
-- apuntando a la MISMA fila de public.sesiones (misma sesión de WhatsApp).
-- Sin coordinación, ambos procesos podrían llamar a createSocket()/
-- makeWASocket() para el mismo sessionId al mismo tiempo, autenticando dos
-- sockets reales con la misma identidad -> WhatsApp responde con
-- conflict/replaced (440) y ambos procesos entran en un bucle de
-- reconexión (ver Fase de corrección del bucle 440, ya implementada en
-- backend/services/baileys/desconectado.js).
--
-- Esta tabla + funciones NO reemplazan esa corrección: la complementan.
-- Capas, de arriba hacia abajo:
--   LOCAL/VPS -> LEASE DISTRIBUIDO (esta migración, coordina PROCESOS)
--             -> LOCK INTRA-PROCESO (services/baileys/socket.js, ya
--                existente, coordina llamadas concurrentes DENTRO de un
--                mismo proceso)
--             -> makeWASocket()
--
-- Solo el backend (vía SUPABASE_SERVICE_ROLE_KEY, que ignora RLS) llama a
-- estas funciones — por eso la tabla queda con RLS habilitado y SIN
-- policies (deniega todo acceso a anon/authenticated; el service role
-- sigue teniendo acceso total, como a cualquier tabla).
--
-- Ejecutar manualmente en el SQL Editor de Supabase (no hay CLI/psql
-- configurado en este proyecto — mismo procedimiento que las migraciones
-- 001-003 de esta misma carpeta).

create table if not exists public.sesiones_lease (

    session_id uuid primary key references public.sesiones(id) on delete cascade,

    -- Identifica de forma única la INSTANCIA/PROCESO propietario, no solo
    -- "LOCAL"/"VPS" (dos procesos podrían compartir esa etiqueta). Ver
    -- backend/services/baileys/lease.js: OWNER_ID combina ubicación +
    -- hostname + pid + un uuid generado una vez por proceso.
    owner_id text not null,

    lease_until timestamptz not null,

    heartbeat_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

alter table public.sesiones_lease enable row level security;

-- Sin policies a propósito: ningún rol anon/authenticated debe leer ni
-- escribir esta tabla directamente. Solo el backend (service role) la usa,
-- exclusivamente a través de las 3 funciones de abajo.

-- ==========================================================================
-- ACQUIRE — operación atómica. Un solo UPSERT condicional (INSERT ... ON
-- CONFLICT ... DO UPDATE ... WHERE) en vez de "SELECT -> comprobar ->
-- UPDATE": el WHERE de la cláusula DO UPDATE se evalúa bajo el lock de fila
-- que Postgres ya toma para resolver el conflicto de la unique key
-- (session_id), así que dos llamadas concurrentes para el MISMO
-- session_id se serializan sin ninguna ventana de carrera posible entre
-- "leer" y "escribir" — exactamente lo que pedía evitar esta fase.
--
-- Semántica:
--   - no existe lease para session_id            -> se adquiere (INSERT).
--   - existe y owner_id coincide                 -> se renueva (mismo dueño).
--   - existe, es de OTRO owner y sigue vigente    -> se rechaza (adquirido=false).
--   - existe, es de OTRO owner pero ya expiró     -> se puede robar (adquirido=true).
--
-- Devuelve SIEMPRE el estado actual de la fila (aunque no se haya
-- adquirido), para que el llamador pueda loguear quién es el dueño actual.
--
-- CORRECCIÓN (validación real post-aplicación de esta migración): la
-- función original declaraba "returns table (session_id uuid, ...)", lo
-- que crea implícitamente una variable PL/pgSQL llamada `session_id`
-- visible en todo el cuerpo de la función. La cláusula
-- `on conflict (session_id)` NO admite alias de tabla (no se puede escribir
-- `on conflict (l.session_id)`), así que ese `session_id` sin calificar
-- quedaba ambiguo entre la variable de salida y la columna real de
-- sesiones_lease -> Postgres devolvía el error 42702 "column reference
-- session_id is ambiguous" en TODA llamada real.
--
-- Fix: se renombra ÚNICAMENTE la columna de salida `session_id` a
-- `out_session_id` (nombre inequívoco, no colisiona con ninguna columna
-- real de la tabla). Con eso ya no existe ninguna variable PL/pgSQL
-- llamada `session_id` en el cuerpo de la función, así que
-- `on conflict (session_id)` vuelve a resolver sin ambigüedad a la columna
-- de la tabla. `owner_id` y `lease_until` (los dos campos que sí consume
-- el contrato Node, ver services/baileys/lease.js) NO cambian de nombre —
-- nunca aparecían sin calificar en una posición de expresión ambigua
-- (solo en listas de columnas de INSERT/SET, o ya calificados con `l.`),
-- así que no tenían el problema y no hacía falta tocarlos. No se usa
-- `#variable_conflict use_column` (solución global): la ambigüedad se
-- resuelve de forma explícita y localizada a esta función.
--
-- Como cambia el tipo de retorno (la lista de columnas de RETURNS TABLE),
-- Postgres no permite un simple CREATE OR REPLACE FUNCTION sobre la
-- definición anterior — hace falta el DROP FUNCTION previo.
-- ==========================================================================
drop function if exists public.lease_sesiones_acquire(uuid, text, integer);

create or replace function public.lease_sesiones_acquire(
    p_session_id uuid,
    p_owner_id text,
    p_ttl_seconds integer
)
returns table (
    out_session_id uuid,
    owner_id text,
    lease_until timestamptz,
    heartbeat_at timestamptz,
    adquirido boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := now();
    v_lease_until timestamptz := v_now + make_interval(secs => greatest(p_ttl_seconds, 1));
    v_filas integer;
begin

    insert into public.sesiones_lease as l
        (session_id, owner_id, lease_until, heartbeat_at, updated_at)
    values
        (p_session_id, p_owner_id, v_lease_until, v_now, v_now)
    on conflict (session_id) do update
        set owner_id     = excluded.owner_id,
            lease_until  = excluded.lease_until,
            heartbeat_at = excluded.heartbeat_at,
            updated_at   = excluded.updated_at
        where l.owner_id = excluded.owner_id   -- mismo dueño: renovar
           or l.lease_until <= v_now;          -- expirado: se puede robar

    get diagnostics v_filas = row_count;

    return query
    select l.session_id as out_session_id, l.owner_id, l.lease_until, l.heartbeat_at, (v_filas > 0) as adquirido
    from public.sesiones_lease l
    where l.session_id = p_session_id;

end;
$$;

-- ==========================================================================
-- HEARTBEAT — renueva SOLO si owner_id coincide Y el lease todavía no
-- expiró. Si ya expiró (aunque nadie lo haya robado todavía), NO se
-- renueva: el TTL es la garantía de seguridad del lease, así que un
-- heartbeat tardío debe tratarse igual que una pérdida de ownership
-- (el llamador debe detener el socket/BOT y, si quiere seguir, volver a
-- pasar por ACQUIRE). Esto evita que dos procesos terminen creyéndose
-- dueños si el heartbeat llega justo al filo del TTL.
-- ==========================================================================
create or replace function public.lease_sesiones_heartbeat(
    p_session_id uuid,
    p_owner_id text,
    p_ttl_seconds integer
)
returns table (
    session_id uuid,
    owner_id text,
    lease_until timestamptz,
    renovado boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := now();
    v_lease_until timestamptz := v_now + make_interval(secs => greatest(p_ttl_seconds, 1));
    v_filas integer;
begin

    update public.sesiones_lease l
        set lease_until  = v_lease_until,
            heartbeat_at = v_now,
            updated_at   = v_now
        where l.session_id = p_session_id
          and l.owner_id = p_owner_id
          and l.lease_until > v_now;

    get diagnostics v_filas = row_count;

    return query
    select l.session_id, l.owner_id, l.lease_until, (v_filas > 0) as renovado
    from public.sesiones_lease l
    where l.session_id = p_session_id;

end;
$$;

-- ==========================================================================
-- RELEASE — solo borra la fila si owner_id coincide con el dueño actual.
-- Nunca puede liberar el lease de otro owner (el WHERE lo garantiza de
-- forma atómica: si no coincide, DELETE afecta 0 filas).
-- ==========================================================================
create or replace function public.lease_sesiones_release(
    p_session_id uuid,
    p_owner_id text
)
returns table (
    liberado boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_filas integer;
begin

    delete from public.sesiones_lease
    where session_id = p_session_id
      and owner_id = p_owner_id;

    get diagnostics v_filas = row_count;

    return query select (v_filas > 0) as liberado;

end;
$$;
