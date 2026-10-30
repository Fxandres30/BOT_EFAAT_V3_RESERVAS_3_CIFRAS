-- ==========================================================================
-- 040 — Expulsión real de los bloqueados de TODOS los grupos del cliente.
--
-- PREPARADA EL 2026-10-30. NO APLICADA. Ejecutar manualmente en el SQL
-- Editor de Supabase cuando se autorice. Requiere 019 (bloqueados y
-- bloqueo_intentos) y 006 (grupos_autorizados).
--
-- Antes de esta migración, bloquear desde el panel solo guardaba la fila de
-- "bloqueados": nadie expulsaba a quien ya estaba dentro de los grupos (la
-- expulsión existía solo al REINGRESAR). Ahora cada bloqueo crea una tarea
-- persistente por grupo autorizado del cliente (bloqueo_expulsiones), que el
-- backend procesa en segundo plano (bot/funciones/bloqueo/procesarExpulsion.js)
-- y verifica con la lista real de participantes antes de marcarla como
-- "expulsado".
--
-- Solo crea objetos nuevos y amplía restricciones: no modifica ni borra
-- datos existentes. Idempotente.
--
-- El backend funciona SIN esta migración: el bloqueo se sigue registrando y
-- el panel muestra «Bloqueo registrado — falta activar la expulsión» (el
-- código detecta 42P01/42703). Sin ella NO se expulsa a nadie, tampoco al
-- reingresar.
--
-- Comprobación previa recomendada (solo lectura):
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.bloqueo_intentos'::regclass and contype = 'c';
--
-- Debe aparecer bloqueo_intentos_resultado_check (nombre que Postgres da a
-- la restricción en línea de la 019). Si tiene otro nombre, cambiar el
-- "drop constraint" del punto 3 antes de ejecutar.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) bloqueo_expulsiones — una fila por (bloqueo, grupo). Estado actual de la
--    expulsión en ese grupo; el historial de cada intento va en
--    bloqueo_intentos.
-- --------------------------------------------------------------------------
create table if not exists public.bloqueo_expulsiones (

    id uuid primary key default gen_random_uuid(),

    bloqueado_id uuid not null references public.bloqueados(id) on delete cascade,
    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,
    grupo_nombre text,

    -- Qué la originó por última vez: bloqueo desde el panel, reingreso del
    -- bloqueado a un grupo o reintento manual.
    origen text not null default 'bloqueo'
        check (origen in ('bloqueo', 'reingreso', 'reintento')),

    estado text not null default 'pendiente' check (estado in (
        'pendiente',           -- en cola (o reintento programado)
        'en_curso',            -- una instancia la tomó (lease vigente)
        'expulsado',           -- WhatsApp respondió 200 Y la relectura confirmó que ya no está
        'ya_no_estaba',        -- verificado: no está en el grupo
        'simulado',            -- modo simulación: se habría expulsado (no se envió nada)
        'sin_verificar',       -- WhatsApp aceptó pero la relectura no lo confirmó
        'sin_permisos',        -- la cuenta conectada no es administradora (o WhatsApp respondió 401/403)
        'sesion_desconectada', -- sin WhatsApp conectado para este cliente
        'error_whatsapp',      -- otro error o status de WhatsApp
        'identidad_ambigua',   -- no se pudo identificar con certeza al participante: no se expulsa
        'no_expulsable',       -- es administrador o propietario del grupo
        'cancelado'            -- desbloqueado o grupo desautorizado antes de terminar
    )),

    -- Modo con el que se ejecutó el último intento.
    modo text check (modo in ('simulacion', 'real')),

    -- Participante EXACTO (id de groupMetadata) sobre el que se actuó.
    participante_jid text,
    criterio_identidad text,   -- 'lid_jid' | 'telefono'
    session_id text,           -- sesión de WhatsApp del último intento

    intentos integer not null default 0,
    ultimo_status text,        -- status por participante devuelto por WhatsApp ('200', '403', ...) o 'enviando'
    ultimo_error text,

    -- null = sin reintento automático (estado final o reintentos agotados).
    proximo_intento_en timestamptz default now(),

    -- Lease: una sola instancia procesa la tarea a la vez; si muere, otra la
    -- retoma cuando vence.
    lease_hasta timestamptz,
    lease_por text,

    solicitada_en timestamptz not null default now(),
    ultimo_intento_en timestamptz,
    verificada_en timestamptz,
    actualizado_en timestamptz not null default now(),

    -- Nunca dos tareas para el mismo bloqueo y grupo.
    constraint bloqueo_expulsiones_unica unique (bloqueado_id, grupo_id)

);

create index if not exists bloqueo_expulsiones_por_cliente
    on public.bloqueo_expulsiones (usuario_id, estado, proximo_intento_en);

create index if not exists bloqueo_expulsiones_por_bloqueo
    on public.bloqueo_expulsiones (bloqueado_id);

-- Solo el backend (service role) la usa; el panel siempre pasa por
-- GET /bloqueados/:id/expulsiones. Sin policies a propósito (mismo criterio
-- que bloqueo_intentos en la 019).
alter table public.bloqueo_expulsiones enable row level security;
revoke all on table public.bloqueo_expulsiones from anon, authenticated;

-- --------------------------------------------------------------------------
-- 2) bloqueados — resultado del bloqueo NATIVO de WhatsApp (updateBlockStatus).
--    Distinto del bloqueo registrado (activo) y de la expulsión.
-- --------------------------------------------------------------------------
alter table public.bloqueados add column if not exists bloqueo_nativo_estado text;
alter table public.bloqueados add column if not exists bloqueo_nativo_error text;
alter table public.bloqueados add column if not exists bloqueo_nativo_en timestamptz;

alter table public.bloqueados drop constraint if exists bloqueados_bloqueo_nativo_estado;
alter table public.bloqueados add constraint bloqueados_bloqueo_nativo_estado
    check (bloqueo_nativo_estado is null or bloqueo_nativo_estado in ('aplicado', 'fallido', 'sin_sesion', 'no_disponible', 'retirado'));

-- --------------------------------------------------------------------------
-- 3) bloqueo_intentos — un registro por cada intento real o simulado, con
--    los nuevos resultados y el vínculo a la tarea.
-- --------------------------------------------------------------------------
alter table public.bloqueo_intentos add column if not exists expulsion_id uuid
    references public.bloqueo_expulsiones(id) on delete set null;
alter table public.bloqueo_intentos add column if not exists origen text;
alter table public.bloqueo_intentos add column if not exists modo text;
alter table public.bloqueo_intentos add column if not exists status_whatsapp text;
alter table public.bloqueo_intentos add column if not exists session_id text;

alter table public.bloqueo_intentos drop constraint if exists bloqueo_intentos_resultado_check;
alter table public.bloqueo_intentos add constraint bloqueo_intentos_resultado_check check (resultado in (
    'expulsado', 'error',
    'ya_no_estaba', 'simulado', 'sin_verificar', 'sin_permisos', 'sesion_desconectada',
    'error_whatsapp', 'identidad_ambigua', 'no_expulsable', 'cancelado'
));

create index if not exists bloqueo_intentos_por_expulsion
    on public.bloqueo_intentos (expulsion_id, creado_en desc);

-- --------------------------------------------------------------------------
-- Verificación posterior (solo lectura):
--
--   select count(*) from public.bloqueo_expulsiones;            -- 0 al aplicar
--   select column_name from information_schema.columns
--    where table_name = 'bloqueados' and column_name like 'bloqueo_nativo%';
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'bloqueo_intentos_resultado_check';
--
-- Reversión (solo si no se ha usado; borra las tareas):
--
--   drop table if exists public.bloqueo_expulsiones cascade;
--   alter table public.bloqueados drop constraint if exists bloqueados_bloqueo_nativo_estado;
--   alter table public.bloqueados drop column if exists bloqueo_nativo_estado,
--       drop column if exists bloqueo_nativo_error, drop column if exists bloqueo_nativo_en;
--   alter table public.bloqueo_intentos drop column if exists expulsion_id,
--       drop column if exists origen, drop column if exists modo,
--       drop column if exists status_whatsapp, drop column if exists session_id;
--   -- y restaurar: check (resultado in ('expulsado', 'error')) — solo si no hay filas con otros valores.
-- --------------------------------------------------------------------------
