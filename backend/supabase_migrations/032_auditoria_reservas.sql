-- ==========================================================================
-- 032_auditoria_reservas.sql — auditoría INMUTABLE de las operaciones sobre
-- números de las tablas (reserva manual desde el panel, pago, liberación y
-- desbloqueo, y las reservas automáticas del bot).
--
-- POR QUÉ UNA TABLA NUEVA (y no reservas_actividad, migración 002):
--
--   - reservas_actividad tiene una política INSERT para el usuario del panel
--     (auth.uid() = usuario_id): el NAVEGADOR puede insertar filas con el
--     "realizado_por" que quiera. No sirve como auditoría: el navegador
--     podría inventar el operador o fabricar historial.
--   - No guarda origen (manual/bot), estado anterior/nuevo, contacto, grupo,
--     motivo, observaciones, método de pago ni el resultado (rechazos y
--     errores incluidos).
--   - Las tablas físicas de reservas tampoco tienen columnas de método de
--     pago ni de observaciones: por eso la ventana del número decía «No
--     disponible todavía en el backend».
--
-- reservas_actividad se sigue escribiendo igual (alimenta «Actividad
-- reciente»); esta tabla es el registro fiable.
--
-- REGLAS:
--   - Solo el backend escribe (service_role). El navegador NO tiene INSERT,
--     UPDATE ni DELETE; solo puede LEER las filas de su propio cliente.
--   - Solo inserción: un trigger rechaza UPDATE, DELETE y TRUNCATE para
--     cualquier rol (también service_role, que se salta la RLS).
--   - creado_en lo fija la base (now()), nunca el llamador.
--   - El operador (operador_id/operador_email) sale del token validado en
--     el backend (middleware/autenticacionUsuario.js), nunca del cuerpo de
--     la petición. Para el bot es null y origen = 'bot'.
--
-- Mismo criterio que las demás migraciones: ejecutar manualmente en el SQL
-- Editor de Supabase. NO se ejecuta desde este repositorio. Sin ella, el
-- backend sigue funcionando: la auditoría se omite (best-effort) y avisa
-- una sola vez en el log.
-- ==========================================================================

begin;

create table if not exists public.reservas_auditoria (

    id uuid primary key default gen_random_uuid(),

    -- Cliente propietario (dueño de la cuadrícula / tenant).
    usuario_id uuid not null references auth.users(id) on delete cascade,

    -- Usuario autenticado del panel que ejecutó la acción (null para el bot).
    operador_id uuid,
    operador_email text,

    origen text not null check (origen in ('manual', 'bot')),

    accion text not null check (accion in ('reservar', 'pagar', 'liberar', 'desbloquear')),

    tabla text not null,
    precio integer,
    numero text not null,

    evento_id uuid,
    identidad_evento_real text,
    grupo_id text,
    grupo_nombre text,

    -- usuarios.id del comprador. Sin FK a propósito: la auditoría debe
    -- sobrevivir aunque la identidad se borre o se fusione después.
    contacto_id uuid,
    contacto_nombre text,
    contacto_telefono text,

    estado_anterior text,
    estado_nuevo text,

    motivo text check (motivo is null or char_length(motivo) <= 500),
    observaciones text check (observaciones is null or char_length(observaciones) <= 1000),
    metodo_pago text check (metodo_pago is null or char_length(metodo_pago) <= 60),

    resultado text not null check (resultado in ('ok', 'rechazado', 'error')),
    -- Motivo corto del rechazo/error (p. ej. "no_disponible", "sorteo_cerrado").
    codigo text,
    error text,

    -- Identificador de la solicitud del panel (reintentos del mismo envío).
    solicitud_id text check (solicitud_id is null or char_length(solicitud_id) <= 80),

    creado_en timestamptz not null default now()

);

create index if not exists reservas_auditoria_por_numero
    on public.reservas_auditoria (usuario_id, tabla, numero, creado_en desc);

create index if not exists reservas_auditoria_por_cliente
    on public.reservas_auditoria (usuario_id, creado_en desc);

-- ------------------------------------------------------------ inmutable ---

create or replace function public.reservas_auditoria_inmutable()
returns trigger
language plpgsql
as $$
begin
    raise exception 'reservas_auditoria es de solo inserción (% no permitido)', tg_op
        using errcode = '42501';
end;
$$;

create or replace function public.reservas_auditoria_fecha_servidor()
returns trigger
language plpgsql
as $$
begin
    new.creado_en := now();
    return new;
end;
$$;

drop trigger if exists reservas_auditoria_sin_cambios on public.reservas_auditoria;
create trigger reservas_auditoria_sin_cambios
    before update or delete on public.reservas_auditoria
    for each row execute function public.reservas_auditoria_inmutable();

drop trigger if exists reservas_auditoria_sin_truncate on public.reservas_auditoria;
create trigger reservas_auditoria_sin_truncate
    before truncate on public.reservas_auditoria
    for each statement execute function public.reservas_auditoria_inmutable();

drop trigger if exists reservas_auditoria_fecha on public.reservas_auditoria;
create trigger reservas_auditoria_fecha
    before insert on public.reservas_auditoria
    for each row execute function public.reservas_auditoria_fecha_servidor();

-- ----------------------------------------------------------- permisos ---

alter table public.reservas_auditoria enable row level security;

revoke all on table public.reservas_auditoria from public, anon, authenticated;
grant select on table public.reservas_auditoria to authenticated;
grant select, insert on table public.reservas_auditoria to service_role;
revoke update, delete, truncate on table public.reservas_auditoria from service_role;

drop policy if exists "clientes leen su propia auditoria" on public.reservas_auditoria;
create policy "clientes leen su propia auditoria"
    on public.reservas_auditoria for select
    to authenticated
    using (auth.uid() = usuario_id);

-- Sin políticas de INSERT/UPDATE/DELETE: el navegador no escribe aquí.

commit;

-- ------------------------------------------------- verificación (lectura) ---
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'reservas_auditoria' order by 1, 2;
-- Esperado: authenticated -> SELECT; service_role -> INSERT, SELECT; anon -> nada.
