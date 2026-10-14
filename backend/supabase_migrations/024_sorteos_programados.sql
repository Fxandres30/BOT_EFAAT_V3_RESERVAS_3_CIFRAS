-- Sorteos creados y programados desde el panel (multiusuario).
--
-- POR QUÉ: hoy un sorteo solo nace cuando el bot detecta un anuncio en un
-- grupo (guardarEvento.js). Para crearlo desde el panel, programar su
-- publicación, reutilizar plantillas y elegir cuentas de pago hacen falta
-- estas tablas; ninguna existe (verificado en la auditoría).
--
-- REUTILIZA lo existente en vez de duplicarlo:
--   - eventos_bot sigue siendo LA fila del sorteo en cada grupo: al publicar,
--     el backend la crea con guardarEvento.js, así reservas, pagos, cierre
--     automático y contadores funcionan exactamente igual que con un sorteo
--     detectado.
--   - grupos_autorizados (006) decide qué grupos puede usar cada cliente.
--   - automation_actions (006) da la idempotencia de cada envío (clave única).
--
-- AISLAMIENTO: todas las tablas llevan usuario_id (tenant). RLS habilitado
-- con políticas "solo filas propias" para el rol authenticated; el backend
-- además filtra por el usuario del token en cada consulta.
--
-- Solo CREA tablas nuevas. No modifica ni borra datos existentes.
-- Idempotente. Ejecutar manualmente en el SQL Editor de Supabase.

-- ==========================================================================
-- 1) Cuentas de pago del cliente (se copian al sorteo al programarlo, así que
--    editarlas después no altera sorteos ya programados ni su historial).
-- ==========================================================================
create table if not exists public.cuentas_pago (

    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,

    nombre text not null check (char_length(nombre) between 1 and 80),
    tipo text not null default 'otro' check (tipo in ('nequi', 'daviplata', 'bancolombia', 'llave', 'otro')),
    titular text check (char_length(titular) <= 120),
    numero text not null check (char_length(numero) between 1 and 60),
    instrucciones text check (char_length(instrucciones) <= 500),

    activa boolean not null default true,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()

);

create index if not exists cuentas_pago_por_usuario on public.cuentas_pago (usuario_id, activa);

-- ==========================================================================
-- 2) Plantillas de sorteo reutilizables. `config` guarda los mismos campos
--    que un sorteo (lotería, hora, valor, premios, mensajes, recordatorios,
--    reservas, cuentas). Un sorteo COPIA la plantilla: cambiarla después no
--    altera sorteos existentes.
-- ==========================================================================
create table if not exists public.plantillas_sorteo (

    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,

    nombre text not null check (char_length(nombre) between 1 and 80),
    config jsonb not null default '{}'::jsonb,
    activa boolean not null default true,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    unique (usuario_id, nombre)

);

-- ==========================================================================
-- 3) Sorteos programados.
--    estado: borrador -> (confirmar) programado -> publicando ->
--            publicado | publicado_parcial | fallido ; cancelado.
--    version: sube en cada edición; una confirmación solo vale para la
--    versión que el administrador vio en la vista previa.
-- ==========================================================================
create table if not exists public.sorteos_programados (

    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,

    estado text not null default 'borrador'
        check (estado in ('borrador', 'programado', 'publicando', 'publicado', 'publicado_parcial', 'fallido', 'cancelado')),
    version integer not null default 1,

    -- Copia completa y validada de la configuración (ver backend/sorteos/validar.js).
    config jsonb not null,
    -- Copia de las cuentas de pago elegidas en el momento de programar.
    cuentas_snapshot jsonb not null default '[]'::jsonb,

    plantilla_id uuid references public.plantillas_sorteo(id) on delete set null,

    tabla text not null,
    cifras integer not null check (cifras in (2, 3)),
    cantidad_numeros integer not null check (cantidad_numeros > 0),

    publicar_en timestamptz not null,
    identidad_evento_real text,

    confirmado_en timestamptz,
    confirmado_version integer,
    cancelado_en timestamptz,
    ultimo_error text,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()

);

create index if not exists sorteos_programados_por_usuario
    on public.sorteos_programados (usuario_id, estado, publicar_en);

-- Lo que el worker busca cada ciclo: programados cuya hora ya llegó.
create index if not exists sorteos_programados_pendientes
    on public.sorteos_programados (publicar_en)
    where estado in ('programado', 'publicando');

-- ==========================================================================
-- 4) Publicación por grupo: resultado independiente de cada grupo.
-- ==========================================================================
create table if not exists public.sorteos_programados_grupos (

    id uuid primary key default gen_random_uuid(),
    sorteo_id uuid not null references public.sorteos_programados(id) on delete cascade,
    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,
    grupo_nombre text,

    estado text not null default 'pendiente'
        check (estado in ('pendiente', 'publicando', 'publicado', 'fallido', 'requiere_revision', 'cancelado')),
    intentos integer not null default 0,
    -- Sube solo cuando el ADMINISTRADOR pide reintentar un grupo en revisión;
    -- forma parte de la clave idempotente del anuncio (automation_actions),
    -- así un reintento automático nunca reenvía un anuncio ya intentado.
    reintentos_manuales integer not null default 0,
    ultimo_error text,

    evento_bot_id uuid,
    version_publicada integer,
    publicado_en timestamptz,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    unique (sorteo_id, grupo_id)

);

create index if not exists sorteos_programados_grupos_por_evento
    on public.sorteos_programados_grupos (evento_bot_id)
    where evento_bot_id is not null;

create index if not exists sorteos_programados_grupos_por_usuario
    on public.sorteos_programados_grupos (usuario_id, grupo_id);

-- ==========================================================================
-- 5) RLS: cada cliente solo ve y modifica lo suyo. El backend usa
--    service_role (ignora RLS) y SIEMPRE filtra por el usuario del token.
-- ==========================================================================
alter table public.cuentas_pago enable row level security;
alter table public.plantillas_sorteo enable row level security;
alter table public.sorteos_programados enable row level security;
alter table public.sorteos_programados_grupos enable row level security;

do $$
declare
    t text;
begin

    foreach t in array array['cuentas_pago', 'plantillas_sorteo', 'sorteos_programados', 'sorteos_programados_grupos'] loop

        execute format('drop policy if exists "propietario lee" on public.%I', t);
        execute format('drop policy if exists "propietario crea" on public.%I', t);
        execute format('drop policy if exists "propietario modifica" on public.%I', t);
        execute format('drop policy if exists "propietario borra" on public.%I', t);

        execute format('create policy "propietario lee" on public.%I for select to authenticated using (usuario_id = auth.uid())', t);
        execute format('create policy "propietario crea" on public.%I for insert to authenticated with check (usuario_id = auth.uid())', t);
        execute format('create policy "propietario modifica" on public.%I for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', t);
        execute format('create policy "propietario borra" on public.%I for delete to authenticated using (usuario_id = auth.uid())', t);

        execute format('revoke all on table public.%I from anon', t);
        execute format('grant select, insert, update, delete on table public.%I to authenticated, service_role', t);

    end loop;

end $$;

-- ==========================================================================
-- Verificación (solo lectura):
--   select tablename, rowsecurity from pg_tables
--   where tablename in ('cuentas_pago','plantillas_sorteo','sorteos_programados','sorteos_programados_grupos');
--   select tablename, policyname, cmd from pg_policies
--   where tablename in ('cuentas_pago','plantillas_sorteo','sorteos_programados','sorteos_programados_grupos')
--   order by 1, 2;
--
-- Reversión (borra los sorteos programados, plantillas y cuentas creados
-- desde el panel; NO toca eventos_bot ni reservas):
--   drop table if exists public.sorteos_programados_grupos, public.sorteos_programados,
--     public.plantillas_sorteo, public.cuentas_pago;
-- ==========================================================================
