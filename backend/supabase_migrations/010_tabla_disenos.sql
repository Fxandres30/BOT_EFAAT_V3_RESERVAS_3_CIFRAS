-- Fase Tablas — Diseños visuales independientes por tabla.
--
-- Auditoría previa (ver informe en la conversación): no existía ninguna
-- tabla, columna, servicio ni localStorage equivalente para esto. Crea 2
-- tablas NUEVAS. No modifica ninguna tabla existente (eventos_bot,
-- reservas_dos_cifras, 5k_15k_reservas_2_cifras, reservas_actividad,
-- automation_*, plantillas_mensaje, etc.) ni cambia el sistema de
-- reservas/eventos/pagos.
--
-- Ejecutar manualmente en el SQL Editor de Supabase (mismo procedimiento
-- que 001-009).
--
-- ==========================================================================
-- DECISIONES DE ESQUEMA
-- ==========================================================================
--
-- SOLO PRESENTACIÓN: "config" (jsonb) nunca incluye nombre del sorteo,
-- premio ni valor — esos siguen viniendo exclusivamente de eventos_bot
-- (ver frontend/services/tablas/obtenerEventoActivo.ts). El diseño solo
-- controla colores, tipografía/tamaño de número y geometría del grid.
--
-- NO se incluyen "ocultar números ocupados" ni "mostrar ganador": ninguna
-- de las dos existe como regla de negocio real hoy (no hay concepto de
-- "ganador" en el sistema, y la cuadrícula siempre muestra todos los
-- números) — no se inventan aquí.
--
-- PRESETS (Clásico/Oscuro/Elegante/WhatsApp): no se seedean como filas —
-- viven como catálogo estático en el frontend (mismo criterio que ya usa
-- este proyecto para no seedear por SQL; ver plantillasBase.ts). Aplicar
-- un preset copia su configuración a la tabla_configuracion_visual del
-- usuario; "Guardar como diseño" es lo que crea una fila real aquí.
--
-- tabla_disenos = BIBLIOTECA reutilizable (siempre del usuario dueño,
-- nunca global/compartida en esta fase — no hay concepto de "diseño de
-- sistema" persistido, ver arriba).
--
-- tabla_configuracion_visual = ASIGNACIÓN ACTIVA por (usuario, precio),
-- con su propia copia de "config": aplicar un diseño de la biblioteca
-- COPIA su configuración aquí (diseno_origen_id queda solo como
-- referencia informativa de "de dónde vino"). Editar la tabla $1.000
-- nunca reescribe tabla_disenos ni ninguna otra fila de
-- tabla_configuracion_visual — así $1.500 nunca cambia por accidente.
--
-- "precio" es entero libre (no FK ni CHECK): la fuente de verdad de qué
-- precios son válidos sigue siendo
-- frontend/lib/tablasConfig.ts / backend/bot/funciones/eventos/configEvento.js,
-- no esta tabla.
--
-- ==========================================================================


-- ==========================================================================
-- tabla_disenos — biblioteca de diseños guardados por el usuario.
-- ==========================================================================
create table if not exists public.tabla_disenos (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    nombre text not null,

    -- Shape: { theme:{pageBg,tableBg,text,border,accent},
    --          cells:{available,reserved,pagado}:{bg,border,text},
    --          numbers:{size,weight},
    --          grid:{radius,spacing,borderWidth} }
    config jsonb not null,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()

);

create index if not exists tabla_disenos_por_usuario
    on public.tabla_disenos (usuario_id);

alter table public.tabla_disenos enable row level security;

create policy "usuarios ven sus propios disenos"
    on public.tabla_disenos for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean sus propios disenos"
    on public.tabla_disenos for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan sus propios disenos"
    on public.tabla_disenos for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan sus propios disenos"
    on public.tabla_disenos for delete
    using (auth.uid() = usuario_id);


-- ==========================================================================
-- tabla_configuracion_visual — diseño ACTIVO de cada tabla (usuario +
-- precio), independiente entre tablas aunque compartan origen.
-- ==========================================================================
create table if not exists public.tabla_configuracion_visual (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    precio integer not null,

    -- Referencia informativa: de qué diseño de la biblioteca vino esta
    -- configuración (para mostrar "basado en X" en la UI). NUNCA se lee
    -- para resolver el diseño real — "config" ya es la copia completa e
    -- independiente que se usa para pintar la tabla.
    diseno_origen_id uuid references public.tabla_disenos(id) on delete set null,

    -- Mismo shape que tabla_disenos.config.
    config jsonb not null,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    unique (usuario_id, precio)

);

alter table public.tabla_configuracion_visual enable row level security;

create policy "usuarios ven su propia configuracion visual"
    on public.tabla_configuracion_visual for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean su propia configuracion visual"
    on public.tabla_configuracion_visual for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan su propia configuracion visual"
    on public.tabla_configuracion_visual for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan su propia configuracion visual"
    on public.tabla_configuracion_visual for delete
    using (auth.uid() = usuario_id);
