-- Relación tenant <-> contacto para el panel "Contactos" (diagnóstico de
-- arquitectura, 2026-09: "Contactos muestra ~147 en vez de ~2.800").
--
-- PROBLEMA QUE RESUELVE:
--
--   "usuarios" es la identidad GLOBAL de una persona (lid/telefono/nombre)
--   — deliberadamente SIN columna de tenant, porque el mismo LID/teléfono
--   puede ser cliente de más de un tenant (más de un bot/negocio en esta
--   plataforma). El Identity Scanner (escanerIdentidadesLifecycle.js)
--   descubre TODOS los participantes de TODOS los grupos de una sesión
--   (~2.800 en producción) y los escribe en "usuarios" vía
--   obtenerUsuarioGlobal() — pero hasta ahora no quedaba registrado en
--   ningún lado "este usuarios.id fue descubierto por el tenant X". El
--   panel de Contactos, al no tener esa relación, solo podía acotar el
--   directorio por tenant usando fuentes que YA tienen usuario_id (las
--   tablas dinámicas de reservas, reservas_actividad) — de ahí que solo
--   aparecieran los ~147 que habían reservado o escrito recientemente.
--
-- ESTA TABLA:
--
--   - NO agrega usuario_id a "usuarios" (seguiría rompiendo la garantía de
--     identidad global si un mismo LID/teléfono fuera cliente de dos
--     tenants).
--   - Es la relación real tenant <-> identidad global: cuántos tenants
--     conocen a esta persona, y desde cuándo/hasta cuándo por tenant.
--   - Se escribe desde un ÚNICO punto centralizado
--     (obtenerUsuarioGlobal.js::registrarContactoTenant), invocado siempre
--     que el llamador conoce el tenant real (sock.context.usuarioId /
--     ctx.session.usuarioId) — nunca inventado, nunca derivado de otra
--     tabla.
--
-- Mismo criterio de las migraciones anteriores: ejecutar manualmente en el
-- SQL Editor de Supabase. No se ejecuta desde este repositorio.

create table if not exists public.contactos_tenant (

    usuario_id uuid not null references auth.users(id) on delete cascade,

    usuario_global_id uuid not null references public.usuarios(id) on delete cascade,

    -- Primera vez que ESTE tenant vio a este contacto. Se fija una sola vez
    -- (DEFAULT en el INSERT) y nunca se vuelve a tocar — ver
    -- registrarContactoTenant(), que actualiza SOLO ultimo_visto_en cuando
    -- la relación ya existe.
    primer_visto_en timestamptz not null default now(),

    -- Última vez que ESTE tenant tuvo actividad real de este contacto
    -- (mensaje, escaneo de grupo que lo volvió a encontrar, reserva, pago).
    -- Es el campo que ordena "Contactos recientes".
    ultimo_visto_en timestamptz not null default now(),

    -- Diagnóstico, no de negocio: cómo se descubrió la relación la primera
    -- vez ('escaneo_grupo' | 'mensaje'). Nunca se sobrescribe después del
    -- INSERT inicial. Nullable a propósito — ningún código depende de que
    -- tenga valor.
    origen text,

    primary key (usuario_id, usuario_global_id)

);

create index if not exists contactos_tenant_por_tenant
    on public.contactos_tenant (usuario_id, ultimo_visto_en desc);

alter table public.contactos_tenant enable row level security;

-- Sin policies a propósito — mismo criterio que sesiones_lease (004) y
-- configuracion_stickers_pago (011): solo el backend, vía
-- SUPABASE_SERVICE_ROLE_KEY (que ignora RLS), lee y escribe esta tabla. El
-- panel nunca la consulta directo desde el navegador — siempre pasa por
-- GET /contactos del backend (ver routes/contactos.js).
