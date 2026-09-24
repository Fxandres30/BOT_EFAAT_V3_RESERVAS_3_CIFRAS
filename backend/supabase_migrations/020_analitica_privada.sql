-- ==========================================================================
-- 020 — ANALÍTICA PRIVADA (visitas al panel EFAAT)
--
-- Sistema de analítica 100% separado del panel: tres tablas NUEVAS y
-- aisladas. No se toca ninguna tabla existente (usuarios, sesiones —
-- sesiones de WhatsApp, no confundir con visitor_sessions —, eventos_bot,
-- reservas, etc.) y no hay ninguna operación destructiva.
--
--   navegador (frontend/instrumentation-client.ts)
--     -> Next /api/e (añade user-agent + cabeceras de IP)
--     -> backend POST /analitica/recolectar (service role existente)
--     -> public.analitica_registrar_evento(...)   <- ÚNICO punto de escritura
--
-- ACCESO: igual que sesiones_lease (004) y pagos_* (005): RLS habilitado y
-- SIN policies + REVOKE explícito a anon/authenticated. Ni la anon key del
-- navegador ni un usuario logueado del panel pueden leer/escribir estas
-- tablas ni ejecutar estas funciones vía PostgREST. Solo el backend
-- (SUPABASE_SERVICE_ROLE_KEY) las usa, y el panel privado solo las lee a
-- través de endpoints del backend que verifican la sesión de Supabase Auth
-- del usuario y que su id esté en public.analitica_admins.
--
-- ESCRITURAS: el heartbeat del navegador NO inserta filas — solo actualiza
-- last_activity_at, y como máximo una vez cada p_heartbeat_min_segundos
-- por sesión (throttle en la propia función). visitor_events solo recibe
-- eventos con significado: new_visitor, session_start, page_view, resume,
-- idle, exit.
--
-- RETENCIÓN DE IP: analitica_anonimizar_ips(30) reduce la IP a su red
-- (/24 IPv4, /48 IPv6) pasados 30 días. La llama el backend periódicamente
-- (backend/analitica/retencion.js) y, si pg_cron está habilitado en el
-- proyecto, también queda programada aquí (bloque final, opcional).
--
-- Ejecutar manualmente en el SQL Editor de Supabase (mismo procedimiento
-- que 001-019). Idempotente: se puede volver a ejecutar sin romper nada.
-- ==========================================================================

-- ==========================================================================
-- visitors — un visitante anónimo por navegador (visitor_id aleatorio
-- generado en el cliente y guardado en localStorage; no identifica a
-- ninguna persona).
-- ==========================================================================
create table if not exists public.visitors (

    visitor_id uuid primary key,

    first_seen_at timestamptz not null default now(),

    last_seen_at timestamptz not null default now(),

    total_sessions integer not null default 0,

    device_type text not null default 'unknown'
        check (device_type in ('mobile', 'tablet', 'desktop', 'unknown')),

    operating_system text,

    browser text,

    screen_width integer check (screen_width between 1 and 20000),

    screen_height integer check (screen_height between 1 and 20000)

);

create index if not exists visitors_last_seen_idx
    on public.visitors (last_seen_at desc);

create index if not exists visitors_first_seen_idx
    on public.visitors (first_seen_at desc);

-- ==========================================================================
-- visitor_sessions — una sesión = actividad continua con menos de 30 min
-- de inactividad. El dispositivo se guarda también aquí (foto de la
-- sesión) para que el historial no dependa de un join ni cambie si el
-- visitante cambia de navegador.
-- ==========================================================================
create table if not exists public.visitor_sessions (

    session_id uuid primary key,

    visitor_id uuid not null
        references public.visitors (visitor_id) on delete cascade,

    started_at timestamptz not null default now(),

    last_activity_at timestamptz not null default now(),

    -- Se rellena con el evento exit/idle, o al detectar la expiración.
    -- Se limpia si la sesión se reanuda dentro de los 30 min.
    ended_at timestamptz,

    end_reason text check (end_reason in ('exit', 'idle', 'timeout')),

    -- Si la sesión expiró y otra pestaña ya abrió su sucesora, las demás
    -- pestañas se unen a esa sucesora en vez de abrir una sesión duplicada.
    continued_as uuid,

    landing_page text not null,

    current_page text not null,

    page_views integer not null default 0,

    referrer text,

    user_agent text,

    -- IP de conexión tal como la ve el servidor (última entrada de
    -- X-Forwarded-For). Nunca desde el cuerpo JSON enviado por el navegador.
    ip inet,

    ip_anonymized_at timestamptz,

    -- Reservadas para cabeceras de geolocalización de un CDN de confianza.
    -- Hoy quedan en null: la infraestructura actual (VPS) no las provee.
    country text,

    city text,

    device_type text not null default 'unknown'
        check (device_type in ('mobile', 'tablet', 'desktop', 'unknown')),

    operating_system text,

    browser text

);

create index if not exists visitor_sessions_last_activity_idx
    on public.visitor_sessions (last_activity_at desc);

create index if not exists visitor_sessions_started_idx
    on public.visitor_sessions (started_at desc);

create index if not exists visitor_sessions_visitor_idx
    on public.visitor_sessions (visitor_id, last_activity_at desc);

-- Índice parcial para la retención: solo las filas con IP aún completa.
create index if not exists visitor_sessions_ip_pendiente_idx
    on public.visitor_sessions (started_at)
    where ip is not null and ip_anonymized_at is null;

-- ==========================================================================
-- visitor_events — solo eventos con significado (nunca heartbeats).
-- ==========================================================================
create table if not exists public.visitor_events (

    id bigint generated always as identity primary key,

    session_id uuid not null
        references public.visitor_sessions (session_id) on delete cascade,

    visitor_id uuid not null
        references public.visitors (visitor_id) on delete cascade,

    event_type text not null
        check (event_type in (
            'new_visitor', 'session_start', 'page_view', 'resume', 'idle', 'exit'
        )),

    page text,

    created_at timestamptz not null default now()

);

create index if not exists visitor_events_session_idx
    on public.visitor_events (session_id, created_at);

create index if not exists visitor_events_created_idx
    on public.visitor_events (created_at desc);

-- ==========================================================================
-- analitica_admins — quién puede ver el panel privado. La identidad la da
-- Supabase Auth (el mismo login del panel); esta tabla solo dice qué
-- usuarios de auth.users están autorizados. Hace falta porque el registro
-- público de Supabase Auth está abierto: estar registrado NO basta.
--
-- Se siembra con el usuario administrador actual del proyecto. Para
-- añadir/quitar acceso: insert/delete en esta tabla desde el SQL Editor.
-- ==========================================================================
create table if not exists public.analitica_admins (

    user_id uuid primary key references auth.users (id) on delete cascade,

    creado_en timestamptz not null default now()

);

insert into public.analitica_admins (user_id)
select id from auth.users where id = '2491cbd0-5fb5-4cef-a06d-6092e69d40c4'
on conflict (user_id) do nothing;

-- ==========================================================================
-- RLS + permisos: cero acceso para anon/authenticated.
-- ==========================================================================
alter table public.visitors enable row level security;
alter table public.visitor_sessions enable row level security;
alter table public.visitor_events enable row level security;
alter table public.analitica_admins enable row level security;

-- Sin policies a propósito (mismo criterio que 004/005). Además se revocan
-- los privilegios que Supabase concede por defecto a anon/authenticated en
-- tablas nuevas del schema public — doble barrera: aunque alguien crease
-- una policy por error, sin GRANT la tabla sigue inaccesible.
revoke all on table public.visitors from anon, authenticated;
revoke all on table public.visitor_sessions from anon, authenticated;
revoke all on table public.visitor_events from anon, authenticated;
revoke all on sequence public.visitor_events_id_seq from anon, authenticated;
revoke all on table public.analitica_admins from anon, authenticated;

grant select on table public.analitica_admins to service_role;
grant select, insert, update, delete on table public.visitors to service_role;
grant select, insert, update, delete on table public.visitor_sessions to service_role;
grant select, insert, update, delete on table public.visitor_events to service_role;
grant usage, select on sequence public.visitor_events_id_seq to service_role;

-- ==========================================================================
-- analitica_registrar_evento — ÚNICO punto de escritura, atómico.
--
-- p_tipo (lo único que el navegador puede pedir):
--   page_view  -> carga inicial o cambio de ruta SPA
--   heartbeat  -> "sigo activo" (NO inserta evento; throttled)
--   idle       -> sin interacción durante un rato
--   exit       -> pagehide (cierre/recarga) de la última pestaña
--
-- new_visitor / session_start / resume los decide ESTA función, nunca el
-- cliente. La sesión la decide el servidor: si la sesión pedida lleva más
-- de p_timeout_segundos sin actividad, se cierra y se abre una nueva con
-- un id generado aquí (el cliente adopta el session_id devuelto).
--
-- Concurrencia (varias pestañas): la fila de la sesión se bloquea con
-- SELECT ... FOR UPDATE; la creación usa INSERT ... ON CONFLICT DO NOTHING,
-- así dos pestañas que estrenan la misma sesión a la vez no la duplican.
-- ==========================================================================
create or replace function public.analitica_registrar_evento(
    p_tipo text,
    p_visitor_id uuid,
    p_session_id uuid,
    p_pagina text,
    p_referrer text default null,
    p_user_agent text default null,
    p_ip inet default null,
    p_device_type text default 'unknown',
    p_operating_system text default null,
    p_browser text default null,
    p_screen_width integer default null,
    p_screen_height integer default null,
    p_country text default null,
    p_city text default null,
    p_timeout_segundos integer default 1800,
    p_heartbeat_min_segundos integer default 30,
    p_dedupe_page_view_segundos integer default 3
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_ahora timestamptz := clock_timestamp();
    v_timeout interval := make_interval(secs => p_timeout_segundos);
    v_sesion public.visitor_sessions%rowtype;
    v_sucesora public.visitor_sessions%rowtype;
    v_existe boolean := false;
    v_sesion_id uuid := p_session_id;
    v_rotada boolean := false;
    v_visitante_nuevo boolean := false;
    v_insertada boolean := false;
    v_device text := coalesce(p_device_type, 'unknown');
begin

    if p_tipo is null or p_tipo not in ('page_view', 'heartbeat', 'idle', 'exit') then
        raise exception 'analitica: tipo de evento inválido' using errcode = '22023';
    end if;

    if p_visitor_id is null or p_session_id is null or p_pagina is null then
        raise exception 'analitica: faltan identificadores' using errcode = '22023';
    end if;

    if v_device not in ('mobile', 'tablet', 'desktop', 'unknown') then
        v_device := 'unknown';
    end if;

    -- ------------------------------------------------------------------
    -- 1) Sesión pedida por el cliente (bloqueada para esta transacción).
    -- ------------------------------------------------------------------
    select * into v_sesion
      from public.visitor_sessions
     where session_id = v_sesion_id
       for update;

    v_existe := found;

    if v_existe and v_sesion.visitor_id <> p_visitor_id then
        -- Un navegador no puede escribir en la sesión de otro visitante.
        return jsonb_build_object('ok', false, 'motivo', 'sesion_ajena');
    end if;

    -- ------------------------------------------------------------------
    -- 2) Expiración (30 min sin actividad): cerrar y rotar.
    -- ------------------------------------------------------------------
    if v_existe and v_sesion.last_activity_at < v_ahora - v_timeout then

        if v_sesion.ended_at is null then
            update public.visitor_sessions
               set ended_at = last_activity_at,
                   end_reason = 'timeout'
             where session_id = v_sesion.session_id;
        end if;

        if p_tipo in ('idle', 'exit') then
            -- Un idle/exit tardío de una sesión ya caducada no abre nada.
            return jsonb_build_object(
                'ok', true, 'accion', 'ignorado_sesion_expirada',
                'session_id', v_sesion.session_id
            );
        end if;

        -- ¿Otra pestaña ya abrió la sucesora? -> unirse a ella.
        if v_sesion.continued_as is not null then

            select * into v_sucesora
              from public.visitor_sessions
             where session_id = v_sesion.continued_as
               for update;

            if found and v_sucesora.last_activity_at >= v_ahora - v_timeout then
                v_sesion := v_sucesora;
                v_sesion_id := v_sucesora.session_id;
                v_rotada := true;
            else
                v_existe := false;
            end if;

        else
            v_existe := false;
        end if;

        if not v_existe then
            v_sesion_id := gen_random_uuid();
            v_rotada := true;
            update public.visitor_sessions
               set continued_as = v_sesion_id
             where session_id = p_session_id;
        end if;

    end if;

    -- ------------------------------------------------------------------
    -- 3) Sesión inexistente -> crearla (idle/exit nunca crean sesiones).
    -- ------------------------------------------------------------------
    if not v_existe then

        if p_tipo in ('idle', 'exit') then
            return jsonb_build_object('ok', true, 'accion', 'ignorado_sin_sesion');
        end if;

        insert into public.visitors as v (
            visitor_id, first_seen_at, last_seen_at, total_sessions,
            device_type, operating_system, browser, screen_width, screen_height
        )
        values (
            p_visitor_id, v_ahora, v_ahora, 0,
            v_device, p_operating_system, p_browser, p_screen_width, p_screen_height
        )
        on conflict (visitor_id) do update
           set last_seen_at = greatest(v.last_seen_at, excluded.last_seen_at),
               device_type = case when excluded.device_type = 'unknown'
                                  then v.device_type else excluded.device_type end,
               operating_system = coalesce(excluded.operating_system, v.operating_system),
               browser = coalesce(excluded.browser, v.browser),
               screen_width = coalesce(excluded.screen_width, v.screen_width),
               screen_height = coalesce(excluded.screen_height, v.screen_height)
        returning (xmax = 0) into v_visitante_nuevo;

        insert into public.visitor_sessions (
            session_id, visitor_id, started_at, last_activity_at,
            landing_page, current_page, page_views, referrer, user_agent, ip,
            country, city, device_type, operating_system, browser
        )
        values (
            v_sesion_id, p_visitor_id, v_ahora, v_ahora,
            p_pagina, p_pagina, case when p_tipo = 'page_view' then 1 else 0 end,
            p_referrer, p_user_agent, p_ip,
            p_country, p_city, v_device, p_operating_system, p_browser
        )
        on conflict (session_id) do nothing;

        v_insertada := found;

        if v_insertada then

            update public.visitors
               set total_sessions = total_sessions + 1
             where visitor_id = p_visitor_id;

            if v_visitante_nuevo then
                insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
                values (v_sesion_id, p_visitor_id, 'new_visitor', p_pagina, v_ahora);
            end if;

            insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
            values (v_sesion_id, p_visitor_id, 'session_start', p_pagina, v_ahora);

            if p_tipo = 'page_view' then
                insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
                values (v_sesion_id, p_visitor_id, 'page_view', p_pagina, v_ahora);
            end if;

            return jsonb_build_object(
                'ok', true,
                'accion', 'sesion_creada',
                'session_id', v_sesion_id,
                'nueva_sesion', true,
                'nuevo_visitante', v_visitante_nuevo,
                'rotada', v_rotada
            );

        end if;

        -- Otra pestaña la creó en paralelo: seguir como sesión existente.
        select * into v_sesion
          from public.visitor_sessions
         where session_id = v_sesion_id
           for update;

        if v_sesion.visitor_id <> p_visitor_id then
            return jsonb_build_object('ok', false, 'motivo', 'sesion_ajena');
        end if;

    end if;

    -- ------------------------------------------------------------------
    -- 4) Sesión existente y vigente.
    -- ------------------------------------------------------------------
    if p_tipo = 'page_view' then

        -- Deduplicación: la misma página registrada hace < N segundos
        -- (doble disparo del router, React StrictMode, etc.).
        if v_sesion.current_page = p_pagina and exists (
            select 1
              from public.visitor_events
             where session_id = v_sesion_id
               and event_type = 'page_view'
               and page = p_pagina
               and created_at > v_ahora - make_interval(secs => p_dedupe_page_view_segundos)
        ) then
            return jsonb_build_object(
                'ok', true, 'accion', 'duplicado', 'session_id', v_sesion_id,
                'rotada', v_rotada
            );
        end if;

        if v_sesion.end_reason = 'idle' then
            insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
            values (v_sesion_id, p_visitor_id, 'resume', p_pagina, v_ahora);
        end if;

        insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
        values (v_sesion_id, p_visitor_id, 'page_view', p_pagina, v_ahora);

        update public.visitor_sessions
           set current_page = p_pagina,
               page_views = page_views + 1,
               last_activity_at = v_ahora,
               ended_at = null,
               end_reason = null
         where session_id = v_sesion_id;

        update public.visitors
           set last_seen_at = v_ahora
         where visitor_id = p_visitor_id;

        return jsonb_build_object(
            'ok', true, 'accion', 'page_view', 'session_id', v_sesion_id,
            'rotada', v_rotada
        );

    end if;

    if p_tipo = 'heartbeat' then

        -- Throttle: sesión abierta y actualizada hace poco -> sin escritura.
        if v_sesion.ended_at is null
           and v_sesion.last_activity_at > v_ahora - make_interval(secs => p_heartbeat_min_segundos) then
            return jsonb_build_object(
                'ok', true, 'accion', 'throttled', 'session_id', v_sesion_id,
                'rotada', v_rotada
            );
        end if;

        if v_sesion.end_reason = 'idle' then
            insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
            values (v_sesion_id, p_visitor_id, 'resume', p_pagina, v_ahora);
        end if;

        update public.visitor_sessions
           set last_activity_at = v_ahora,
               current_page = p_pagina,
               ended_at = null,
               end_reason = null
         where session_id = v_sesion_id;

        update public.visitors
           set last_seen_at = v_ahora
         where visitor_id = p_visitor_id;

        return jsonb_build_object(
            'ok', true, 'accion', 'heartbeat', 'session_id', v_sesion_id,
            'rotada', v_rotada
        );

    end if;

    if p_tipo = 'idle' then

        if v_sesion.ended_at is not null then
            return jsonb_build_object('ok', true, 'accion', 'duplicado', 'session_id', v_sesion_id);
        end if;

        insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
        values (v_sesion_id, p_visitor_id, 'idle', p_pagina, v_ahora);

        -- last_activity_at NO se toca: estar inactivo no es actividad.
        update public.visitor_sessions
           set ended_at = v_ahora,
               end_reason = 'idle'
         where session_id = v_sesion_id;

        return jsonb_build_object('ok', true, 'accion', 'idle', 'session_id', v_sesion_id);

    end if;

    -- p_tipo = 'exit'
    if v_sesion.end_reason = 'exit' then
        return jsonb_build_object('ok', true, 'accion', 'duplicado', 'session_id', v_sesion_id);
    end if;

    insert into public.visitor_events (session_id, visitor_id, event_type, page, created_at)
    values (v_sesion_id, p_visitor_id, 'exit', p_pagina, v_ahora);

    update public.visitor_sessions
       set ended_at = v_ahora,
           end_reason = 'exit',
           last_activity_at = greatest(last_activity_at, v_ahora)
     where session_id = v_sesion_id;

    update public.visitors
       set last_seen_at = v_ahora
     where visitor_id = p_visitor_id;

    return jsonb_build_object('ok', true, 'accion', 'exit', 'session_id', v_sesion_id);

end;
$$;

-- ==========================================================================
-- analitica_anonimizar_ips — retención: IP completa solo durante p_dias.
-- Después se reduce a su red (/24 IPv4, /48 IPv6): deja de identificar un
-- equipo concreto pero conserva una idea aproximada de la procedencia.
-- Idempotente (solo toca filas con ip_anonymized_at null).
-- ==========================================================================
create or replace function public.analitica_anonimizar_ips(p_dias integer default 30)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_filas integer;
begin

    update public.visitor_sessions
       set ip = case when family(ip) = 4
                     then set_masklen(network(set_masklen(ip, 24)), 32)
                     else set_masklen(network(set_masklen(ip, 48)), 128)
                end,
           ip_anonymized_at = now()
     where ip is not null
       and ip_anonymized_at is null
       and started_at < now() - make_interval(days => p_dias);

    get diagnostics v_filas = row_count;

    return v_filas;

end;
$$;

-- ==========================================================================
-- LECTURAS del panel privado (solo las llama el backend autorizado).
-- ==========================================================================

-- Resumen de un rango [p_desde, p_hasta).
create or replace function public.analitica_resumen(
    p_desde timestamptz,
    p_hasta timestamptz,
    p_activos_segundos integer default 150
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with rango as (
        select *
          from public.visitor_sessions
         where started_at < p_hasta
           and last_activity_at >= p_desde
    ),
    por_visitante as (
        -- Dispositivo más reciente de cada visitante dentro del rango.
        select distinct on (visitor_id) visitor_id, device_type
          from rango
         order by visitor_id, last_activity_at desc
    )
    select jsonb_build_object(
        'visitantes_unicos', (select count(distinct visitor_id) from rango),
        'visitantes_nuevos', (select count(*) from public.visitors
                               where first_seen_at >= p_desde and first_seen_at < p_hasta),
        'sesiones', (select count(*) from public.visitor_sessions
                      where started_at >= p_desde and started_at < p_hasta),
        'paginas_vistas', (select count(*) from public.visitor_events
                            where event_type = 'page_view'
                              and created_at >= p_desde and created_at < p_hasta),
        'activos_ahora', (select count(*) from public.visitor_sessions
                           where ended_at is null
                             and last_activity_at > now() - make_interval(secs => p_activos_segundos)),
        'dispositivos', jsonb_build_object(
            'mobile',  (select count(*) from por_visitante where device_type = 'mobile'),
            'tablet',  (select count(*) from por_visitante where device_type = 'tablet'),
            'desktop', (select count(*) from por_visitante where device_type = 'desktop'),
            'unknown', (select count(*) from por_visitante where device_type = 'unknown')
        ),
        'primera_visita', (select min(first_seen_at) from public.visitors),
        'ultima_visita', (select max(last_activity_at) from public.visitor_sessions)
    );
$$;

-- Sesiones activas ahora (abiertas y con actividad reciente).
create or replace function public.analitica_activos(p_activos_segundos integer default 150)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select coalesce(jsonb_agg(fila order by (fila ->> 'last_activity_at') desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
                   'session_id', s.session_id,
                   'visitor_id', s.visitor_id,
                   'started_at', s.started_at,
                   'last_activity_at', s.last_activity_at,
                   'current_page', s.current_page,
                   'page_views', s.page_views,
                   'device_type', s.device_type,
                   'operating_system', s.operating_system,
                   'browser', s.browser,
                   'ip', host(s.ip),
                   'country', s.country,
                   'city', s.city
               ) as fila
          from public.visitor_sessions s
         where s.ended_at is null
           and s.last_activity_at > now() - make_interval(secs => p_activos_segundos)
         order by s.last_activity_at desc
         limit 200
      ) t;
$$;

-- Historial paginado de sesiones con actividad en [p_desde, p_hasta).
create or replace function public.analitica_historial(
    p_desde timestamptz,
    p_hasta timestamptz,
    p_limite integer default 50,
    p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with rango as (
        select *
          from public.visitor_sessions
         where started_at < p_hasta
           and last_activity_at >= p_desde
    )
    select jsonb_build_object(
        'total', (select count(*) from rango),
        'filas', coalesce((
            select jsonb_agg(fila order by orden desc)
              from (
                select s.started_at as orden,
                       jsonb_build_object(
                           'session_id', s.session_id,
                           'visitor_id', s.visitor_id,
                           'started_at', s.started_at,
                           'last_activity_at', s.last_activity_at,
                           'ended_at', s.ended_at,
                           'end_reason', s.end_reason,
                           'landing_page', s.landing_page,
                           'current_page', s.current_page,
                           'page_views', s.page_views,
                           'referrer', s.referrer,
                           'device_type', s.device_type,
                           'operating_system', s.operating_system,
                           'browser', s.browser,
                           'ip', host(s.ip),
                           'ip_anonimizada', s.ip_anonymized_at is not null,
                           'country', s.country,
                           'city', s.city
                       ) as fila
                  from rango s
                 order by s.started_at desc
                 limit least(greatest(p_limite, 1), 200)
                offset greatest(p_offset, 0)
              ) t
        ), '[]'::jsonb)
    );
$$;

-- Detalle de una sesión: datos + visitante + todos sus eventos.
create or replace function public.analitica_sesion_detalle(p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select case when s.session_id is null then null else jsonb_build_object(
        'sesion', jsonb_build_object(
            'session_id', s.session_id,
            'visitor_id', s.visitor_id,
            'started_at', s.started_at,
            'last_activity_at', s.last_activity_at,
            'ended_at', s.ended_at,
            'end_reason', s.end_reason,
            'continued_as', s.continued_as,
            'landing_page', s.landing_page,
            'current_page', s.current_page,
            'page_views', s.page_views,
            'referrer', s.referrer,
            'user_agent', s.user_agent,
            'ip', host(s.ip),
            'ip_anonimizada', s.ip_anonymized_at is not null,
            'country', s.country,
            'city', s.city,
            'device_type', s.device_type,
            'operating_system', s.operating_system,
            'browser', s.browser
        ),
        'visitante', (
            select jsonb_build_object(
                'visitor_id', v.visitor_id,
                'first_seen_at', v.first_seen_at,
                'last_seen_at', v.last_seen_at,
                'total_sessions', v.total_sessions,
                'screen_width', v.screen_width,
                'screen_height', v.screen_height
            )
              from public.visitors v
             where v.visitor_id = s.visitor_id
        ),
        'eventos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'event_type', e.event_type,
                       'page', e.page,
                       'created_at', e.created_at
                   ) order by e.created_at, e.id)
              from public.visitor_events e
             where e.session_id = s.session_id
        ), '[]'::jsonb)
    ) end
      from (select 1) uno
      left join public.visitor_sessions s on s.session_id = p_session_id;
$$;

-- ==========================================================================
-- Permisos de las funciones: Postgres concede EXECUTE a PUBLIC por defecto
-- y PostgREST expone las funciones de public como /rpc/... — se revoca
-- todo y solo service_role puede ejecutarlas.
-- ==========================================================================
revoke all on function public.analitica_registrar_evento(
    text, uuid, uuid, text, text, text, inet, text, text, text,
    integer, integer, text, text, integer, integer, integer
) from public, anon, authenticated;

revoke all on function public.analitica_anonimizar_ips(integer) from public, anon, authenticated;
revoke all on function public.analitica_resumen(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.analitica_activos(integer) from public, anon, authenticated;
revoke all on function public.analitica_historial(timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.analitica_sesion_detalle(uuid) from public, anon, authenticated;

grant execute on function public.analitica_registrar_evento(
    text, uuid, uuid, text, text, text, inet, text, text, text,
    integer, integer, text, text, integer, integer, integer
) to service_role;

grant execute on function public.analitica_anonimizar_ips(integer) to service_role;
grant execute on function public.analitica_resumen(timestamptz, timestamptz, integer) to service_role;
grant execute on function public.analitica_activos(integer) to service_role;
grant execute on function public.analitica_historial(timestamptz, timestamptz, integer, integer) to service_role;
grant execute on function public.analitica_sesion_detalle(uuid) to service_role;

-- ==========================================================================
-- OPCIONAL — retención programada dentro de la base con pg_cron.
-- Solo actúa si la extensión pg_cron ya está habilitada en el proyecto
-- (Dashboard -> Database -> Extensions). Si no lo está, no hace nada y la
-- retención la sigue aplicando el backend (backend/analitica/retencion.js).
-- ==========================================================================
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'analitica_anonimizar_ips_diario',
            '15 8 * * *',
            'select public.analitica_anonimizar_ips(30);'
        );
    end if;
end;
$$;
