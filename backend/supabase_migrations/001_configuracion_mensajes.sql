-- Fase 5.4 — Plantillas de presentación de mensajes de EFAAT.
-- CONFIRMADO: esta migración TODAVÍA NO se ha ejecutado en Supabase
-- (relation "public.plantillas_mensaje" does not exist, verificado con la
-- service role key). Por eso se modifica directamente en vez de crear una
-- migración incremental — no hay ninguna fila real que perder.
--
-- Cambio de modelo respecto a la Fase 5.3: ya NO existe "una plantilla
-- activa por tipo". Ahora cada plantilla puede estar habilitada o no
-- (independiente de las demás), y por separado se guarda el MODO en que
-- el BOT las usa (fijo / aleatorio / rotación) en una tabla propia.
--
-- Esta tabla es SOLO de presentación: nunca controla disponibilidad,
-- reservas, números, estados ni pagos. El BOT sigue calculando el
-- resultado real; la selección de plantilla solo dice CÓMO se presenta.
--
-- No toca ninguna tabla de reservas/eventos/pagos/sesiones existente.
-- Ejecutar manualmente en el SQL Editor de Supabase (no hay CLI/psql
-- configurado en este proyecto).

drop table if exists public.configuracion_mensajes;

create table if not exists public.plantillas_mensaje (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    -- uno de los 10 tipos que el BOT ya produce hoy (reserva_completa,
    -- reserva_parcial, numero_ocupado, todos_ocupados, mis_numeros,
    -- mis_reservas, cantidad_reservas, numero_especifico, disponibilidad,
    -- info_evento) o uno de los tipos futuros preparados pero inactivos
    -- (mensaje_no_entendido, numero_invalido, evento_no_disponible,
    -- solicitud_ambigua, otro_determinista). Ver
    -- frontend/services/mensajes/tiposMensaje.ts y
    -- backend/bot/ai/plantillaMensaje.js -> calcularTipoPresentacion.
    tipo_respuesta text not null,

    nombre text not null,

    estilo text not null default 'natural',

    contenido text not null default '',

    -- toggles "mostrar_*" y "emojis". Ejemplo:
    -- {"mostrar_nombre":true,"mostrar_evento":true,"emojis":true}
    variables jsonb not null default '{}'::jsonb,

    -- Reemplaza el "activa" de la Fase 5.3: ya NO es exclusivo, pueden
    -- estar habilitadas varias plantillas del mismo tipo a la vez.
    habilitada boolean not null default true,

    orden integer not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()

);

-- Ya NO existe el índice único que forzaba "una sola activa por tipo"
-- (Fase 5.3). Ahora puede haber cualquier cantidad de filas habilitadas
-- por (usuario_id, tipo_respuesta).
create index if not exists plantillas_por_tipo
    on public.plantillas_mensaje (usuario_id, tipo_respuesta, orden);

create index if not exists plantillas_habilitadas
    on public.plantillas_mensaje (usuario_id, tipo_respuesta)
    where habilitada;

alter table public.plantillas_mensaje enable row level security;

create policy "usuarios ven sus propias plantillas"
    on public.plantillas_mensaje for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean sus propias plantillas"
    on public.plantillas_mensaje for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan sus propias plantillas"
    on public.plantillas_mensaje for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan sus propias plantillas"
    on public.plantillas_mensaje for delete
    using (auth.uid() = usuario_id);


-- ============================================================
-- Modo de selección por tipo de respuesta (Fase 5.4).
-- Una fila por (usuario_id, tipo_respuesta) — no duplica datos de
-- plantillas_mensaje, solo guarda CÓMO elegir entre las habilitadas.
-- ============================================================

create table if not exists public.configuracion_seleccion_mensajes (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    tipo_respuesta text not null,

    modo_seleccion text not null default 'aleatorio'
        check (modo_seleccion in ('aleatorio', 'rotacion', 'fijo')),

    -- Solo se usa cuando modo_seleccion = 'fijo'. Si la plantilla
    -- referenciada se elimina, esto vuelve a null automáticamente
    -- (el backend cae al comportamiento de fallback en ese caso).
    plantilla_fija_id uuid references public.plantillas_mensaje(id) on delete set null,

    -- Estado persistido para el modo 'rotacion' (qué índice sigue,
    -- dentro de las plantillas habilitadas de ese tipo). Vive en la
    -- misma fila para no duplicar una tabla completa solo por un
    -- contador.
    rotacion_indice integer not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (usuario_id, tipo_respuesta)

);

alter table public.configuracion_seleccion_mensajes enable row level security;

create policy "usuarios ven su propia configuracion de seleccion"
    on public.configuracion_seleccion_mensajes for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean su propia configuracion de seleccion"
    on public.configuracion_seleccion_mensajes for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan su propia configuracion de seleccion"
    on public.configuracion_seleccion_mensajes for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan su propia configuracion de seleccion"
    on public.configuracion_seleccion_mensajes for delete
    using (auth.uid() = usuario_id);
