-- FASE P1 — MÓDULO DE PAGOS: ingesta cruda de movimientos capturados por
-- una futura app Android (lectura de notificaciones bancarias con permiso
-- explícito del usuario) + registro de dispositivos autorizados.
--
-- P1 NO verifica pagos, NO asocia usuarios automáticamente, NO toca
-- reservas/eventos. Es solo:
--
--   ANDROID -> POST /pagos/movimientos -> BACKEND EFAAT -> SUPABASE
--
-- No se toca ninguna tabla existente (usuarios, sesiones, eventos_bot,
-- tablas dinámicas de reservas, mensajes_grupos_sorteos, grupos,
-- plantillas_mensaje, sesiones_lease). Dos tablas nuevas, aisladas.
--
-- Solo el backend (vía SUPABASE_SERVICE_ROLE_KEY) accede a estas tablas
-- por ahora — no existe todavía ninguna página de panel para Pagos (P2).
-- Por eso, igual que sesiones_lease (004), quedan con RLS habilitado y
-- SIN policies: cero acceso para anon/authenticated, acceso total para
-- el service role. Cuando exista el panel de Pagos (P2) se añadirán
-- policies `auth.uid() = usuario_id` como las de plantillas_mensaje.
--
-- Ejecutar manualmente en el SQL Editor de Supabase (no hay CLI/psql
-- configurado en este proyecto — mismo procedimiento que 001-004).

-- ==========================================================================
-- pagos_dispositivos — dispositivos Android autorizados por tenant.
--
-- La credencial NUNCA se guarda en texto plano: `credencial_hash` guarda
-- "<salt_hex>:<hash_hex>" producido con scrypt (backend/pagos/credenciales.js,
-- sin dependencias nuevas — usa el módulo `crypto` nativo de Node). El
-- secreto en texto plano solo existe en el momento de crear el dispositivo
-- (backend/pagos/crearDispositivo.js) y se muestra UNA vez; no hay forma
-- de recuperarlo después, solo de revocar (activo=false) y crear uno nuevo.
-- ==========================================================================
create table if not exists public.pagos_dispositivos (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    nombre text not null,

    -- "<salt_hex>:<hash_hex>" (scrypt). Nunca el secreto en texto plano.
    credencial_hash text not null,

    activo boolean not null default true,

    ultimo_movimiento_en timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()

);

create index if not exists pagos_dispositivos_por_usuario
    on public.pagos_dispositivos (usuario_id);

alter table public.pagos_dispositivos enable row level security;

-- Sin policies a propósito (ver cabecera): solo el backend (service role).


-- ==========================================================================
-- pagos_movimientos — ingesta CRUDA de cada notificación capturada.
--
-- Estados de P1 (deliberadamente mínimos):
--   'pendiente'  -> movimiento nuevo, todavía nada lo ha revisado.
--   'duplicado'  -> el backend detectó que ya existía un movimiento con el
--                   mismo hash para el mismo tenant; esta fila NO es
--                   independiente, queda enlazada vía duplicado_de_id al
--                   movimiento original. Nunca se descarta en silencio:
--                   queda registrada para auditoría, pero no cuenta como
--                   un movimiento nuevo.
--
-- Deliberadamente NO se agregan todavía 'asociado'/'verificado'/'rechazado'
-- (fases P2/P3/P4) — se agregarán ampliando el check constraint más
-- adelante, sin migrar datos existentes (los valores actuales siguen
-- siendo válidos bajo un check ampliado).
--
-- DEDUPLICACIÓN (ver backend/pagos/hashDuplicado.js para el detalle y sus
-- limitaciones documentadas): hash_duplicado es determinista a partir de
-- (usuario_id, proveedor, valor, fecha_hora_movimiento redondeada al
-- minuto, referencia, remitente_cuenta). El índice único parcial de abajo
-- es lo que garantiza, de forma ATÓMICA en Postgres (no con un
-- "select -> comprobar -> insert" desde Node), que nunca existan dos filas
-- 'pendiente' independientes para el mismo movimiento real del mismo
-- tenant: si dos inserciones concurrentes compiten por el mismo
-- (usuario_id, hash_duplicado), Postgres deja pasar una sola con
-- estado <> 'duplicado' y la otra recibe 23505 (unique_violation) — el
-- backend atrapa ese código exactamente como ya hace
-- bot/funciones/usuarios/obtenerUsuarioGlobal.js con la colisión de
-- usuarios, y reintenta el INSERT de esa segunda fila con
-- estado='duplicado', que SÍ puede coexistir (el índice la excluye).
-- ==========================================================================
create table if not exists public.pagos_movimientos (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    dispositivo_id uuid not null references public.pagos_dispositivos(id) on delete restrict,

    proveedor text not null,

    valor numeric(14,2) not null,

    moneda text not null default 'COP',

    fecha_hora_movimiento timestamptz not null,

    remitente_nombre text,

    remitente_cuenta text,

    referencia text,

    -- Texto crudo exacto de la notificación, tal cual lo capturó Android.
    -- Nunca se recorta ni se normaliza — es la fuente de verdad para
    -- cualquier revisión manual futura (P2) si el resto de campos
    -- extraídos resultan incompletos o mal parseados.
    texto_original text not null,

    -- Cuándo llegó al backend (puede diferir de fecha_hora_movimiento,
    -- que es cuándo el banco/proveedor dice que ocurrió el movimiento).
    recibido_en timestamptz not null default now(),

    estado text not null default 'pendiente'
        check (estado in ('pendiente', 'duplicado')),

    hash_duplicado text not null,

    -- Solo se llena cuando estado='duplicado'. Apunta al movimiento
    -- original (no-duplicado) con el mismo hash para el mismo tenant.
    duplicado_de_id uuid references public.pagos_movimientos(id) on delete set null,

    created_at timestamptz not null default now()

);

-- Garantía atómica central de P1: como máximo UN movimiento no-duplicado
-- por (usuario_id, hash_duplicado). Las filas 'duplicado' quedan excluidas
-- a propósito, así pueden acumularse sin límite para auditoría sin violar
-- la unicidad.
create unique index if not exists pagos_movimientos_unico_no_duplicado
    on public.pagos_movimientos (usuario_id, hash_duplicado)
    where estado <> 'duplicado';

create index if not exists pagos_movimientos_por_usuario
    on public.pagos_movimientos (usuario_id, created_at desc);

create index if not exists pagos_movimientos_por_dispositivo
    on public.pagos_movimientos (dispositivo_id, created_at desc);

alter table public.pagos_movimientos enable row level security;

-- Sin policies a propósito (ver cabecera): solo el backend (service role).
