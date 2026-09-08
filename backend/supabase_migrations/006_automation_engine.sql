-- Fase 2B — Automation Engine: cimientos persistentes.
--
-- Crea 4 tablas NUEVAS y aisladas: automation_configs, grupos_autorizados,
-- event_sessions, automation_actions (en este orden — event_sessions
-- referencia automation_configs, y automation_actions referencia
-- event_sessions, así que deben crearse en ese orden dentro del mismo
-- script). NO modifica ninguna tabla existente (usuarios, sesiones,
-- eventos_bot, grupos, reservas_dos_cifras, 5k_15k_reservas_2_cifras,
-- reservas_actividad, plantillas_mensaje, configuracion_seleccion_mensajes,
-- pagos_dispositivos, pagos_movimientos, sesiones_lease). Ninguna
-- función/lógica de negocio del bot se ve afectada por esta migración —
-- nada la referencia todavía (ver
-- docs/EFAAT_AUTOMATION_PHASE_2B_IMPLEMENTATION.md).
--
-- Ejecutar manualmente en el SQL Editor de Supabase (mismo procedimiento
-- que 001-005 — no hay CLI/psql configurado en este proyecto).
--
-- ==========================================================================
-- DECISIONES DE ESQUEMA — leer antes de aplicar
-- ==========================================================================
--
-- Ver docs/EFAAT_AUTOMATION_PHASE_2A_FINDINGS.md §4.14 y §9: las tablas
-- núcleo (eventos_bot, sesiones, grupos, usuarios, reservas_dos_cifras,
-- 5k_15k_reservas_2_cifras) NO tienen migración en este repositorio, así
-- que su esquema real (tipos exactos, RLS) no puede confirmarse por
-- inspección de código. Regla aplicada aquí, sin excepciones: NO se declara
-- ninguna FK hacia una tabla cuyo esquema no está confirmado por una
-- migración de este repo.
--
--   - eventos_bot.id  -> event_sessions.evento_id: se declara `uuid` (todas
--     las demás tablas de este proyecto con id generado usan
--     `uuid default gen_random_uuid()`, y eventos_bot.id se usa en el
--     código siempre como valor opaco pasado a `.eq("id", ...)` — nunca se
--     ve el tipo real). Columna SIN `references`: si eventos_bot.id
--     resultara no ser uuid, esta columna debe ajustarse antes de usarse
--     en producción. Es informativa (ver comentario en la tabla), nunca la
--     clave de unicidad del ciclo.
--
--   - grupos.jid / eventos_bot.grupo_id -> *.grupo_id en las 4 tablas
--     nuevas: se declaran `text` (JID de WhatsApp, ej. "123...@g.us" —
--     confirmado en código: bot/funciones/eventos/detectarEvento.js usa
--     `grupo?.remoteJid || ctx.chat.remoteJid` como grupo_id, y
--     bot/funciones/grupos/sincronizarGrupo.js busca `grupos` por
--     `.eq("jid", grupoId)`). SIN `references public.grupos(...)`: la PK
--     real de `grupos` no está confirmada en el repo, y aunque lo estuviera,
--     `grupos.jid` no es necesariamente su PK. No se inventa la FK.
--
--   - sesiones.id -> event_sessions.session_id: SÍ se declara
--     `references public.sesiones(id)`. A diferencia de las anteriores,
--     esta FK YA está en uso y aprobada en la migración 004
--     (sesiones_lease.session_id uuid references public.sesiones(id)) — no
--     es una suposición nueva de esta migración, es una convención ya
--     validada en producción.
--
--   - auth.users.id -> *.usuario_id: SÍ se declara `references
--     auth.users(id)`. Es el esquema propio de Supabase Auth, no una tabla
--     de este proyecto sin migración — mismo patrón que 001, 002 y 005.
--
-- RLS: se habilita en las 4 tablas nuevas con policies `auth.uid() =
-- usuario_id`, calcadas de plantillas_mensaje/reservas_actividad (001/002).
-- Esto NO depende de ninguna suposición sobre eventos_bot/sesiones/grupos —
-- usuario_id en las 4 tablas nuevas es siempre una columna propia con FK
-- directa a auth.users. Sigue sin poder confirmarse desde este repo si
-- eventos_bot/sesiones/grupos/reservas_* tienen RLS — eso no cambia con
-- esta migración y debe verificarse directamente en el dashboard de
-- Supabase antes de exponer estas tablas nuevas a un frontend con la clave
-- anónima (ver PHASE_2A_FINDINGS §4.14, riesgo aún abierto).
--
-- ==========================================================================


-- ==========================================================================
-- automation_configs — comportamiento OPERATIVO por (usuario, grupo).
--
-- MUY IMPORTANTE (Master Spec, regla fundamental — repetida aquí a
-- propósito): esta tabla NUNCA almacena valor, premios, hora del sorteo,
-- hora de cierre, cifras, cantidad de números ni nombre del sorteo. Esos
-- datos SIEMPRE vienen de eventos_bot (vía la detección existente,
-- intacta). Cualquier columna futura que describa el SORTEO en vez del
-- COMPORTAMIENTO de la automatización está fuera de las reglas de este
-- proyecto — no agregarla aquí.
--
-- Todo el contenido variable (días/horarios, mensajes, stickers,
-- recordatorios) se guarda en columnas jsonb deliberadamente abiertas, para
-- poder crecer (nuevos tipos de recordatorio, nuevos eventos de sticker)
-- sin migrar el esquema cada vez — la validación de forma vive en código
-- (eventRules.js / futuras fases), no en constraints de Postgres.
--
-- Se crea ANTES que event_sessions porque event_sessions la referencia.
-- ==========================================================================
create table if not exists public.automation_configs (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,

    -- Interruptor maestro: sin esto en true, EventRules.evaluarApertura()
    -- rechaza siempre, sin importar el resto de la configuración (Roadmap
    -- Fase 3 — feature flag por grupo).
    activo boolean not null default false,

    -- {"lunes": {"activo": true, "desde": "08:00", "hasta": "20:00"}, ...}
    -- claves: lunes/martes/miercoles/jueves/viernes/sabado/domingo.
    -- "desde"/"hasta" son el horario PERMITIDO para operar ese día — nunca
    -- la hora del sorteo (esa es siempre evento.hora_fin/hora_cierre).
    dias_permitidos jsonb not null default '{}'::jsonb,

    -- {"activo": false, "texto": null}
    mensaje_inicio_dia jsonb not null default '{}'::jsonb,

    -- {"activo": false, "texto": null}
    mensaje_apertura jsonb not null default '{}'::jsonb,

    -- {"activo": false, "texto": null}
    mensaje_cierre jsonb not null default '{}'::jsonb,

    -- {"apertura": {"activo": false, "media_id": null},
    --  "actualizacion": {...}, "cierre": {...}, "recta_final": {...}, ...}
    stickers jsonb not null default '{}'::jsonb,

    -- {"2h": {"activo": false, "texto": null}, "1h": {...}, "30m": {...},
    --  "15m": {...}, "10m": {...}, "5m": {...}} — los offsets se calculan
    -- SIEMPRE sobre eventos_bot.hora_cierre, nunca sobre una hora guardada
    -- aquí (Master Spec §10).
    recordatorios jsonb not null default '{}'::jsonb,

    umbral_reservas integer not null default 10,
    cooldown_minutos integer not null default 20,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    -- Como máximo una configuración por usuario+grupo.
    unique (usuario_id, grupo_id)

);

create index if not exists automation_configs_por_usuario
    on public.automation_configs (usuario_id);

alter table public.automation_configs enable row level security;

create policy "usuarios ven su propia automation_configs"
    on public.automation_configs for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean su propia automation_configs"
    on public.automation_configs for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan su propia automation_configs"
    on public.automation_configs for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan su propia automation_configs"
    on public.automation_configs for delete
    using (auth.uid() = usuario_id);


-- ==========================================================================
-- grupos_autorizados — qué grupos puede operar automáticamente cada usuario.
--
-- Independiente de automation_configs a propósito (sin FK entre ambas): un
-- grupo puede estar autorizado sin tener todavía configuración de
-- automatización armada, y viceversa nunca debería pasar en la práctica
-- pero el modelo no lo impide por diseño simple. Ambas se cruzan por
-- (usuario_id, grupo_id) en código, no por una FK compuesta. No se
-- modifica ni se referencia la tabla "grupos" existente (su esquema no está
-- confirmado en este repo — ver cabecera).
-- ==========================================================================
create table if not exists public.grupos_autorizados (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,

    activo boolean not null default true,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    unique (usuario_id, grupo_id)

);

create index if not exists grupos_autorizados_por_usuario
    on public.grupos_autorizados (usuario_id);

alter table public.grupos_autorizados enable row level security;

create policy "usuarios ven sus propios grupos_autorizados"
    on public.grupos_autorizados for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean sus propios grupos_autorizados"
    on public.grupos_autorizados for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan sus propios grupos_autorizados"
    on public.grupos_autorizados for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan sus propios grupos_autorizados"
    on public.grupos_autorizados for delete
    using (auth.uid() = usuario_id);


-- ==========================================================================
-- event_sessions — ciclo operativo real de un evento detectado.
--
-- eventos_bot.id NO es identidad de ciclo (confirmado en Fase 2A: la misma
-- fila de eventos_bot se reutiliza —UPDATE, no INSERT— entre sorteos
-- distintos del mismo grupo). La identidad real del ciclo es
-- `identidad_ciclo`: un hash determinístico de
-- (grupo_id, nombre_evento, hora_fin, valor, fecha_evento), calculado en
-- código por automation/eventRules.js:crearIdentidadCiclo() — nunca en SQL.
-- ==========================================================================
create table if not exists public.event_sessions (

    id uuid primary key default gen_random_uuid(),

    -- Referencia informativa a eventos_bot.id — NUNCA la clave de identidad
    -- ni de unicidad (ver cabecera). Puede quedar apuntando a una fila de
    -- eventos_bot que después fue sobrescrita por un sorteo posterior del
    -- mismo grupo; para saber qué datos tenía ESTE ciclo, usar siempre
    -- datos_evento_snapshot, nunca releer eventos_bot en caliente.
    evento_id uuid,

    -- sha256 hex de grupo_id|nombre_evento|hora_fin|valor|fecha_evento,
    -- calculado por automation/eventRules.js. Ver UNIQUE más abajo.
    identidad_ciclo text not null,

    -- JID de WhatsApp del grupo (texto, no FK — ver cabecera).
    grupo_id text not null,

    -- Sesión de WhatsApp (Baileys) que detectó el evento. FK ya validada en
    -- la migración 004 (sesiones_lease) — ver cabecera. Nullable: si la
    -- sesión se elimina más adelante, el histórico de la automatización no
    -- debe perderse.
    session_id uuid references public.sesiones(id) on delete set null,

    -- Dueño real (RLS). Viene de sesiones.usuario_id en el momento de la
    -- detección (mismo criterio que eventos_bot.usuario_id, ver
    -- guardarEvento.js:44 y PHASE_2A_FINDINGS §4.13).
    usuario_id uuid not null references auth.users(id) on delete cascade,

    -- Configuración de automatización vigente al abrir este ciclo. Nullable
    -- + on delete set null: borrar una configuración no debe destruir el
    -- histórico de sesiones que ya se ejecutaron con ella.
    automation_config_id uuid references public.automation_configs(id) on delete set null,

    estado text not null default 'pendiente'
        check (estado in ('pendiente', 'abierto', 'cerrando', 'cerrado', 'expirado')),

    abierto_en timestamptz,
    cerrado_en timestamptz,

    -- OBLIGATORIA (sin default): copia de nombre/hora/valor/premios/tabla
    -- de ESTE ciclo específico en el momento de crearlo. Es la única fuente
    -- estable una vez que eventos_bot se sobrescriba con el siguiente
    -- sorteo del mismo grupo. Nunca se usa como sustituto del estado
    -- operativo EN VIVO (activo/abierto) — eso se sigue leyendo de
    -- eventos_bot, nunca de aquí (ver PHASE_2A_FINDINGS §7.5 y Master Spec §11).
    datos_evento_snapshot jsonb not null,

    -- Contador de actualizaciones por movimiento ya enviadas en este ciclo
    -- (Master Spec §11 — UpdateRules). Se incrementa en código antes de
    -- generar la clave de idempotencia UPDATE_THRESHOLD.
    actualizaciones_enviadas integer not null default 0,

    -- Última vez que se envió una actualización por movimiento (real o
    -- manual) — base del cooldown de UpdateRules.
    ultima_actualizacion_en timestamptz,

    -- Cuántas veces el barrido de recuperación (Scheduler, fase futura) tuvo
    -- que revisar este ciclo por quedar abandonado (p. ej. tras un reinicio
    -- con el proceso caído a mitad de una transición de estado). Solo
    -- informativo/auditoría en esta fase — no dispara ningún reintento
    -- automático todavía (ver docs/EFAAT_AUTOMATION_PHASE_2A_FINDINGS.md §10).
    intentos_recuperacion integer not null default 0,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    -- Protección real: un mismo grupo nunca puede tener dos ciclos con la
    -- MISMA identidad. Resuelta por el UNIQUE de Postgres (bajo lock de
    -- fila), no por un "select -> comprobar -> insert" desde Node — mismo
    -- principio que ya usa 004 (lease_sesiones_acquire) y 005
    -- (pagos_movimientos_unico_no_duplicado).
    unique (grupo_id, identidad_ciclo)

);

create index if not exists event_sessions_por_usuario
    on public.event_sessions (usuario_id, creado_en desc);

create index if not exists event_sessions_por_grupo_estado
    on public.event_sessions (grupo_id, estado);

create index if not exists event_sessions_pendientes
    on public.event_sessions (estado)
    where estado in ('pendiente', 'abierto', 'cerrando');

alter table public.event_sessions enable row level security;

create policy "usuarios ven sus propios event_sessions"
    on public.event_sessions for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean sus propios event_sessions"
    on public.event_sessions for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan sus propios event_sessions"
    on public.event_sessions for update
    using (auth.uid() = usuario_id);


-- ==========================================================================
-- automation_actions — idempotencia + auditoría de cada acción automática.
--
-- Diseño de DOS FASES (no solo presencia/ausencia de fila — ver
-- PHASE_2A_FINDINGS §10, "crash entre INSERT y acción real"):
--   1. INSERT con estado='en_progreso'   (protegido por UNIQUE, abajo)
--   2. UPDATE a 'ok' o 'error' cuando la acción real termina
--
-- Si el proceso muere entre 1 y 2, la fila queda 'en_progreso' — NO se
-- reintenta automáticamente en esta fase (política segura por defecto,
-- Master Spec §8 corregido). automation/executionGuard.js:
-- obtenerAccionesEstancadas() solo las LISTA, no actúa sobre ellas todavía.
--
-- Se crea DESPUÉS de event_sessions porque la referencia.
-- ==========================================================================
create table if not exists public.automation_actions (

    id uuid primary key default gen_random_uuid(),

    -- Nullable: DAILY_START_MESSAGE (Master Spec §15) no pertenece a ningún
    -- Event Session, solo a un grupo+fecha.
    event_session_id uuid references public.event_sessions(id) on delete cascade,

    grupo_id text not null,

    -- No estaba en la lista mínima original del Master Spec §8 — se agrega
    -- aquí porque el resto de tablas de este proyecto con RLS por usuario
    -- (plantillas_mensaje, reservas_actividad, pagos_*, y las otras 3 tablas
    -- de esta misma migración) SIEMPRE tienen su propia columna usuario_id;
    -- sin ella no hay forma de escribir una policy `auth.uid()=usuario_id`
    -- para automation_actions. Documentado tal como pedía la consigna.
    usuario_id uuid not null references auth.users(id) on delete cascade,

    -- Texto libre (no enum de Postgres): OPEN_MESSAGE, OPEN_STICKER,
    -- REMINDER_2H..._5M, UPDATE_THRESHOLD, UPDATE_MANUAL, CLOSE_MESSAGE,
    -- CLOSE_STICKER, DAILY_START_MESSAGE (Master Spec §8). Se deja como
    -- texto, no como check constraint cerrado, para no tener que migrar el
    -- esquema cada vez que se agregue un tipo de acción nuevo.
    tipo_accion text not null,

    -- Construida en código según Master Spec §8 (p. ej.
    -- "<event_session_id>:OPEN_MESSAGE", "<grupo_id>:DAILY_START_MESSAGE:<fecha>").
    clave_idempotencia text not null,

    estado text not null default 'en_progreso'
        check (estado in ('en_progreso', 'ok', 'error')),

    -- Cuándo se intentó (INSERT). No confundir con cuándo terminó.
    ejecutado_en timestamptz not null default now(),

    -- Cuándo se resolvió a 'ok'/'error'. Null mientras sigue en_progreso —
    -- es lo que el barrido de recuperación usa para medir antigüedad real
    -- de un intento sin resolver (obtenerAccionesEstancadas()).
    finalizado_en timestamptz,

    -- Resultado/estructura de error de la acción real, para auditoría.
    detalle jsonb not null default '{}'::jsonb,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    unique (clave_idempotencia)

);

create index if not exists automation_actions_por_session
    on public.automation_actions (event_session_id);

create index if not exists automation_actions_por_usuario
    on public.automation_actions (usuario_id, creado_en desc);

-- Soporta directamente obtenerAccionesEstancadas() (estado='en_progreso'
-- AND ejecutado_en < umbral).
create index if not exists automation_actions_en_progreso
    on public.automation_actions (estado, ejecutado_en)
    where estado = 'en_progreso';

alter table public.automation_actions enable row level security;

create policy "usuarios ven sus propias automation_actions"
    on public.automation_actions for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean sus propias automation_actions"
    on public.automation_actions for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan sus propias automation_actions"
    on public.automation_actions for update
    using (auth.uid() = usuario_id);
