-- Fase "Bloqueo automático de WhatsApp" — 🚫 BLOQUEAR CONTACTO + expulsión
-- automática de cualquier grupo administrado por el bot.
--
-- CORRECCIÓN DE ARQUITECTURA: un intento anterior de esta fase creó una
-- tabla PARALELA ("vetados"/"veto_intentos") en vez de usar la tabla
-- "bloqueados" que ya existía (migración 017). Esa migración paralela
-- NUNCA se aplicó en Supabase real (verificado por PostgREST antes de
-- escribir este archivo: "vetados"/"veto_intentos" no existen) y se
-- reemplaza por esta. Un solo concepto de negocio = una sola tabla:
-- "bloqueados" es y sigue siendo la única fuente de verdad.
--
-- Auditoría antes de tocar nada (verificado en vivo, no solo leyendo el
-- código): public.bloqueados tiene 0 filas reales -- migración 017 la creó
-- como stub y nunca se escribió ningún registro real. Es seguro
-- ampliarla/reestructurarla sin riesgo de perder datos. public.bloqueados_legado
-- (la tabla realmente antigua, anterior a 017, ver esa migración) NO se
-- toca en absoluto aquí -- fuera de alcance, sigue intacta.
--
-- Terminología única del proyecto a partir de esta fase: BLOQUEADO /
-- BLOQUEAR / DESBLOQUEAR / BLOQUEO_INTENTOS. No existe un concepto
-- separado de "veto".
--
-- Ejecutar manualmente en el SQL Editor de Supabase (no hay CLI/psql
-- configurado en este proyecto — mismo criterio que el resto de
-- supabase_migrations/*.sql).

-- ==========================================================================
-- 1) bloqueados — se AMPLÍA la tabla de la migración 017 (identificador +
--    tipo genéricos, sin lógica real) para que sea la fuente única del
--    bloqueo real: identidad completa (telefono/lid/jid/nombre) +
--    contadores de negocio (intentos_ingreso, expulsiones, último grupo,
--    último intento) embebidos en la misma fila.
-- ==========================================================================

-- 1a) Columnas nuevas.
alter table public.bloqueados add column if not exists telefono text;
alter table public.bloqueados add column if not exists lid text;
alter table public.bloqueados add column if not exists jid text;
alter table public.bloqueados add column if not exists nombre text;

alter table public.bloqueados add column if not exists actualizado_en timestamptz not null default now();

alter table public.bloqueados add column if not exists intentos_ingreso integer not null default 0;
alter table public.bloqueados add column if not exists expulsiones integer not null default 0;

alter table public.bloqueados add column if not exists ultimo_grupo_id text;
alter table public.bloqueados add column if not exists ultimo_grupo_nombre text;
alter table public.bloqueados add column if not exists ultimo_intento_en timestamptz;

-- 1b) "identificador"/"tipo" (017) quedan reemplazados por
--     telefono/lid/jid por separado -- un veto/bloqueo real puede tener
--     MÁS de un identificador a la vez (p. ej. teléfono Y lid), cosa que
--     el modelo "un identificador + un tipo" no podía representar. Se
--     eliminan (tabla en 0 filas, confirmado arriba -- no hay nada que
--     perder) en vez de dejarlos como columnas muertas.
alter table public.bloqueados drop column if exists identificador;
alter table public.bloqueados drop column if exists tipo;

-- 1c) "creado_por" (017) se renombra a "bloqueado_por" -- mismo dato
--     (quién registró la acción), nombre alineado a la terminología única
--     del proyecto (BLOQUEAR/BLOQUEADO).
alter table public.bloqueados rename column creado_por to bloqueado_por;

-- 1d) Al menos un identificador real -- un bloqueo sin telefono/lid/jid no
--     podría emparejar nunca contra un participante entrante.
alter table public.bloqueados drop constraint if exists bloqueados_algun_identificador;
alter table public.bloqueados add constraint bloqueados_algun_identificador
    check (telefono is not null or lid is not null or jid is not null);

-- 1e) Único identificador ACTIVO por tenant -- evita duplicar el mismo
--     bloqueo vigente en dos filas (bloqueadosRepo.js::crearBloqueo ya
--     reactiva la fila existente en vez de insertar, este índice es la
--     garantía real a nivel de base de datos ante una condición de carrera).
create unique index if not exists bloqueados_unico_telefono_activo
    on public.bloqueados (usuario_id, telefono) where telefono is not null and activo;

create unique index if not exists bloqueados_unico_lid_activo
    on public.bloqueados (usuario_id, lid) where lid is not null and activo;

create index if not exists bloqueados_por_jid
    on public.bloqueados (usuario_id, jid) where jid is not null;

-- El índice "bloqueados_por_usuario (usuario_id, activo)" de la migración
-- 017 sigue vigente sin cambios -- mismas columnas, sigue sirviendo.

-- RLS y policies de la migración 017 ("usuarios ven/crean/actualizan/
-- eliminan sus propios bloqueados") siguen vigentes sin cambios -- dependen
-- solo de usuario_id, que no se tocó.

-- ==========================================================================
-- 2) bloqueo_intentos — bitácora de CADA intento de ingreso de un
--    bloqueado a un grupo (uno por evento group-participants.update con
--    action="add" que coincidió con un bloqueo activo), y qué pasó. Nunca
--    se borra, ni siquiera si el bloqueo se levanta después -- es
--    historial/auditoría.
-- ==========================================================================

create table if not exists public.bloqueo_intentos (

    id uuid primary key default gen_random_uuid(),

    -- "on delete set null" (no cascade): si algún día se borra físicamente
    -- un bloqueado, el incidente sigue existiendo para auditoría.
    bloqueado_id uuid references public.bloqueados(id) on delete set null,

    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,
    grupo_nombre text,

    resultado text not null check (resultado in ('expulsado', 'error')),
    error text,

    creado_en timestamptz not null default now()

);

create index if not exists bloqueo_intentos_por_bloqueado
    on public.bloqueo_intentos (bloqueado_id, creado_en desc);

create index if not exists bloqueo_intentos_por_usuario
    on public.bloqueo_intentos (usuario_id, creado_en desc);

alter table public.bloqueo_intentos enable row level security;

-- Solo el backend (SUPABASE_SERVICE_ROLE_KEY, ignora RLS) escribe/lee esta
-- bitácora -- mismo criterio que contactos_tenant (018): el panel nunca la
-- consulta directo desde el navegador, siempre pasa por GET /bloqueados
-- (ver routes/bloqueados.js). Sin policies a propósito.
