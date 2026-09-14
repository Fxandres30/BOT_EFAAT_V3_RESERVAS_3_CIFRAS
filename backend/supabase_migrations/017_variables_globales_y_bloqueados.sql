-- Fase "Variables Globales + Bloqueados" (autorizada tras auditoría).
--
-- Dos tablas NUEVAS, completamente aisladas de reservas/eventos/pagos/
-- usuarios/grupos/sesiones. No modifica plantillas_mensaje ni
-- configuracion_seleccion_mensajes (instrucción explícita).
--
-- CORREGIDA el 2026-09-13 (la versión anterior nunca llegó a aplicarse):
-- el primer intento falló con "42703: column usuario_id does not exist"
-- al crear las policies de bloqueados, porque public.bloqueados YA EXISTÍA
-- en Supabase con una estructura completamente distinta y anterior a esta
-- fase (id integer, nombre, contacto, motivo, fecha -- SIN usuario_id,
-- verificado leyendo el esquema real vía PostgREST, sin ejecutar SQL).
-- "CREATE TABLE IF NOT EXISTS" no tocó esa tabla existente, y las policies
-- que sí necesitaban usuario_id fallaron. Como el script completo corrió
-- como UNA sola transacción, el fallo también revirtió la creación (ya
-- exitosa) de variables_globales -- por eso ninguna de las dos tablas
-- existe todavía.
--
-- No se pudo confirmar cuántas filas tiene esa tabla legada (el
-- service_role no tiene permiso de SELECT sobre ella -- otra brecha de
-- permisos, como compradores_semanales) -- se trata como si pudiera tener
-- datos reales: NUNCA se borra ni se transforma. Se RENOMBRA (conserva el
-- 100% de su contenido y su estructura, solo cambia el nombre) a
-- public.bloqueados_legado, y recién ahí se crea la tabla bloqueados NUEVA
-- con el nombre que el código de esta fase espera.
--
-- Ahora la migración completa es idempotente (segura de ejecutar más de
-- una vez): el renombrado solo ocurre si "bloqueados" existe Y carece de
-- "usuario_id" (es decir, es la legada) Y "bloqueados_legado" todavía no
-- existe; las policies se recrean con "drop policy if exists" antes de
-- cada "create policy".
--
-- Ejecutar manualmente en el SQL Editor de Supabase (no hay CLI/psql
-- configurado en este proyecto).

-- ==========================================================================
-- 0) Poner a salvo la tabla "bloqueados" LEGADA, si existe -- NUNCA se
--    borra ni se le quita ninguna columna/dato, solo se renombra.
-- ==========================================================================

do $$
begin

    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'bloqueados'
    )
    and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'bloqueados' and column_name = 'usuario_id'
    )
    and not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'bloqueados_legado'
    )
    then

        alter table public.bloqueados rename to bloqueados_legado;

        raise notice 'public.bloqueados (estructura antigua, sin usuario_id) renombrada a public.bloqueados_legado -- ningún dato se modificó ni se borró.';

    end if;

end $$;

-- ==========================================================================
-- 1) variables_globales — catálogo dinámico administrable desde el panel.
--    Convive con el catálogo estático existente (backend/shared/variables/
--    catalogoVariables.js) sin reemplazarlo — ver
--    backend/shared/variables/variablesGlobalesRepo.js.
-- ==========================================================================

create table if not exists public.variables_globales (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    -- Identificador tal como aparece entre {{ }}. Mismo alfabeto que ya
    -- exige el regex de sustitución existente (\w+): minúsculas, dígitos,
    -- guion bajo, debe empezar con letra.
    identificador text not null,

    nombre_visible text not null,

    -- "concordancia" = singular/plural según cantidad (determinístico, sin
    -- IA). "texto" = un valor fijo simple (p. ej. un número de soporte).
    tipo text not null check (tipo in ('concordancia', 'texto')),

    singular text,
    plural text,
    valor text,

    categoria text not null default 'PERSONALIZADA',
    descripcion text not null default '',
    ejemplo text not null default '',

    activa boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint variables_globales_identificador_formato
        check (identificador ~ '^[a-z][a-z0-9_]*$'),

    -- Cada tipo trae completos SOLO los campos que le corresponden — nunca
    -- una fila a medio configurar que el resolver tendría que adivinar.
    constraint variables_globales_datos_completos_segun_tipo
        check (
            (tipo = 'concordancia' and singular is not null and singular <> '' and plural is not null and plural <> '')
            or
            (tipo = 'texto' and valor is not null and valor <> '')
        ),

    unique (usuario_id, identificador)

);

create index if not exists variables_globales_por_usuario
    on public.variables_globales (usuario_id, activa);

alter table public.variables_globales enable row level security;

drop policy if exists "usuarios ven sus propias variables globales" on public.variables_globales;
create policy "usuarios ven sus propias variables globales"
    on public.variables_globales for select
    using (auth.uid() = usuario_id);

drop policy if exists "usuarios crean sus propias variables globales" on public.variables_globales;
create policy "usuarios crean sus propias variables globales"
    on public.variables_globales for insert
    with check (auth.uid() = usuario_id);

drop policy if exists "usuarios actualizan sus propias variables globales" on public.variables_globales;
create policy "usuarios actualizan sus propias variables globales"
    on public.variables_globales for update
    using (auth.uid() = usuario_id);

drop policy if exists "usuarios eliminan sus propias variables globales" on public.variables_globales;
create policy "usuarios eliminan sus propias variables globales"
    on public.variables_globales for delete
    using (auth.uid() = usuario_id);

-- ==========================================================================
-- 2) bloqueados — estructura preparada para el futuro. NO se inserta
--    ningún registro desde esta migración ni desde el código de esta
--    fase. Sin relación con WhatsApp, sin trigger, sin lógica de ejecución.
--    (Ver sección 0: si existía una tabla "bloqueados" anterior sin
--    usuario_id, ya quedó a salvo como bloqueados_legado antes de este
--    CREATE — este CREATE siempre crea la tabla NUEVA correcta.)
-- ==========================================================================

create table if not exists public.bloqueados (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    identificador text not null,

    tipo text not null check (tipo in ('telefono', 'jid', 'lid')),

    motivo text,

    creado_en timestamptz not null default now(),

    -- Texto libre (nombre/identificador de quién lo registró) — no es una
    -- FK a ningún sistema de roles/admin todavía; esta fase no lo necesita
    -- porque nunca se escribe ninguna fila real.
    creado_por text,

    activo boolean not null default true,

    unique (usuario_id, identificador)

);

create index if not exists bloqueados_por_usuario
    on public.bloqueados (usuario_id, activo);

alter table public.bloqueados enable row level security;

drop policy if exists "usuarios ven sus propios bloqueados" on public.bloqueados;
create policy "usuarios ven sus propios bloqueados"
    on public.bloqueados for select
    using (auth.uid() = usuario_id);

drop policy if exists "usuarios crean sus propios bloqueados" on public.bloqueados;
create policy "usuarios crean sus propios bloqueados"
    on public.bloqueados for insert
    with check (auth.uid() = usuario_id);

drop policy if exists "usuarios actualizan sus propios bloqueados" on public.bloqueados;
create policy "usuarios actualizan sus propios bloqueados"
    on public.bloqueados for update
    using (auth.uid() = usuario_id);

drop policy if exists "usuarios eliminan sus propios bloqueados" on public.bloqueados;
create policy "usuarios eliminan sus propios bloqueados"
    on public.bloqueados for delete
    using (auth.uid() = usuario_id);
