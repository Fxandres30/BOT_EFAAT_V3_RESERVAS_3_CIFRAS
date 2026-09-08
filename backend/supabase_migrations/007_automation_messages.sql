-- Fase 4A — Motor de mensajes automáticos: Message Pool + registro de uso.
--
-- Crea 2 tablas NUEVAS: automation_messages (el pool) y
-- automation_message_uses (qué mensaje se usó, cuándo, para qué
-- event_session — soporta la regla "evitar repetición inmediata" y sirve
-- de auditoría). NO modifica 006_automation_engine.sql — la constraint
-- UNIQUE(clave_idempotencia) de automation_actions sigue siendo, sin
-- cambios, la protección real contra doble envío (ver §"IDEMPOTENCIA" en
-- docs/EFAAT_AUTOMATION_PHASE_4A_IMPLEMENTATION.md). Esta migración NO
-- toca ninguna tabla existente (ni las 4 de 006, ni ninguna de las
-- anteriores).
--
-- Ejecutar manualmente en el SQL Editor de Supabase (mismo procedimiento
-- que 001-006).
--
-- ==========================================================================
-- DECISIONES DE ESQUEMA
-- ==========================================================================
--
-- GLOBAL vs POR USUARIO (consigna Fase 4A, "CONFIGURACIÓN"): un mensaje
-- GLOBAL se representa con usuario_id = NULL; un mensaje PROPIO de un
-- usuario tiene usuario_id = su id. El pool de selección (ver
-- automation/repo/messages.js) siempre junta ambos: los globales +
-- los propios del usuario que detectó el evento — nunca los de otro
-- usuario.
--
-- Las FKs hacia auth.users(id) y hacia public.event_sessions(id) SÍ se
-- declaran (a diferencia de las tablas núcleo pre-006, sin migración en
-- este repo): auth.users es el esquema propio de Supabase y
-- event_sessions ya existe, confirmada por la propia migración 006 que
-- este entorno ya tiene aplicada.
--
-- `tipo` y `categoria` se dejan como texto libre, sin CHECK — mismo
-- criterio ya usado en automation_actions.tipo_accion (006): permite
-- agregar tipos/categorías nuevas sin migrar el esquema, tal como pide
-- esta fase explícitamente para las categorías.
--
-- ==========================================================================


-- ==========================================================================
-- automation_messages — el Message Pool.
--
-- NUNCA contiene datos específicos de un sorteo (valor, premios, hora,
-- etc.) — esos siempre vienen del evento real detectado. Lo que guarda
-- aquí es la PLANTILLA (puede incluir variables entre llaves, ej.
-- "{nombre_evento}"), resueltas en código por
-- automation/variableResolver.js — nunca en SQL.
-- ==========================================================================
create table if not exists public.automation_messages (

    id uuid primary key default gen_random_uuid(),

    -- NULL = mensaje GLOBAL (visible para cualquier usuario). Un usuario
    -- autenticado normal NUNCA puede insertar/editar una fila con
    -- usuario_id NULL (ver policies más abajo) — el pool global lo
    -- administra el backend (service role) o un futuro rol
    -- administrador, fuera de esta fase.
    usuario_id uuid references auth.users(id) on delete cascade,

    -- Identificador legible para administración (nunca se envía tal
    -- cual — es interno).
    nombre_interno text not null,

    -- Puede contener variables "{nombre_evento}", "{valor}",
    -- "{hora_cierre}", "{premio}", "{reservados}", "{disponibles}" —
    -- resueltas en código, nunca inventadas si faltan (ver
    -- variableResolver.js).
    texto text not null,

    -- OPEN_MESSAGE | REMINDER_MESSAGE | UPDATE_MESSAGE | CLOSE_MESSAGE,
    -- texto libre (ver nota de cabecera).
    tipo text not null,

    -- eleccion | escasez | humor | competencia | tiempo | curiosidad |
    -- accion | urgencia | familiar | ... — texto libre, ampliable sin
    -- tocar esta migración ni el motor.
    categoria text,

    activo boolean not null default true,

    -- NO usado por el selector aleatorio actual (que deliberadamente NO
    -- depende del orden — ver messageSelector.js). Se deja preparado por
    -- si una fase futura necesita ponderar/priorizar mensajes.
    orden integer not null default 0,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()

);

create index if not exists automation_messages_por_usuario
    on public.automation_messages (usuario_id);

-- Soporta directamente la consulta real del pool (tipo + activo,
-- opcionalmente categoria) para ambas mitades (propios y globales).
create index if not exists automation_messages_por_tipo_activo
    on public.automation_messages (tipo, activo)
    where activo;

alter table public.automation_messages enable row level security;

-- SELECT: un usuario ve los mensajes GLOBALES (usuario_id is null) y los
-- SUYOS — nunca los de otro usuario.
create policy "usuarios ven mensajes globales y propios"
    on public.automation_messages for select
    using (usuario_id is null or auth.uid() = usuario_id);

-- INSERT/UPDATE/DELETE: solo sobre sus PROPIOS mensajes. auth.uid() nunca
-- es NULL para un usuario autenticado, así que esto excluye por
-- construcción crear/editar/borrar mensajes globales desde el cliente —
-- el pool global es responsabilidad del backend (service role, que
-- ignora RLS) o de administración futura, no de esta fase.
create policy "usuarios crean sus propios mensajes"
    on public.automation_messages for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan sus propios mensajes"
    on public.automation_messages for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan sus propios mensajes"
    on public.automation_messages for delete
    using (auth.uid() = usuario_id);


-- ==========================================================================
-- automation_message_uses — registro de qué mensaje se usó, cuándo, para
-- qué event_session, con qué tipo/categoría.
--
-- Es la base de "evitar repetición inmediata" (se consulta el último uso
-- por usuario+grupo+tipo antes de elegir, ver messageSelector.js) y de
-- auditoría — NO es el mecanismo de idempotencia del envío (eso sigue
-- siendo, sin cambios, automation_actions.clave_idempotencia de 006; ver
-- cabecera de este archivo). Log de solo inserción — mismo espíritu que
-- reservas_actividad (002): sin policies de update/delete.
-- ==========================================================================
create table if not exists public.automation_message_uses (

    id uuid primary key default gen_random_uuid(),

    -- Nullable + on delete set null: si el mensaje se borra después, el
    -- historial de uso no debe perderse.
    message_id uuid references public.automation_messages(id) on delete set null,

    -- Nullable a propósito: un futuro DAILY_START_MESSAGE (fuera de esta
    -- fase) no pertenece a ningún event_session, igual que ya define
    -- automation_actions en 006.
    event_session_id uuid references public.event_sessions(id) on delete cascade,

    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,

    -- Copia denormalizada de automation_messages.tipo/categoria en el
    -- momento del uso — sobrevive aunque el mensaje se borre o cambie de
    -- categoría después, y evita un join solo para decidir el próximo
    -- mensaje a excluir.
    tipo text not null,
    categoria text,

    usado_en timestamptz not null default now()

);

-- Soporta directamente "último mensaje usado para (usuario, grupo, tipo)".
create index if not exists automation_message_uses_ultimo
    on public.automation_message_uses (usuario_id, grupo_id, tipo, usado_en desc);

create index if not exists automation_message_uses_por_session
    on public.automation_message_uses (event_session_id);

alter table public.automation_message_uses enable row level security;

create policy "usuarios ven sus propios usos de mensajes"
    on public.automation_message_uses for select
    using (auth.uid() = usuario_id);

create policy "usuarios registran sus propios usos de mensajes"
    on public.automation_message_uses for insert
    with check (auth.uid() = usuario_id);
