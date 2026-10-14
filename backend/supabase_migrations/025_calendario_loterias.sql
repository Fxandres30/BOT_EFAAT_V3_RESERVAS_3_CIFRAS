-- Calendario de loterías: catálogo por cliente (tenant) que reutilizan
-- todos sus sorteos creados desde el panel. Un sorteo guarda el id de la
-- lotería elegida y una COPIA del nombre: editar el catálogo después no
-- altera sorteos ya programados.
--
-- Horarios: el catálogo inicial se crea SIN horas ni días (el backend lo
-- siembra la primera vez que el cliente abre el calendario); el
-- administrador los completa desde el panel. Nada se inventa.
--
--   dias           días ISO en que se juega (1 = lunes … 7 = domingo).
--                  Vacío = sin configurar.
--   hora           hora habitual (America/Bogota).
--   horas_por_dia  excepciones por día: {"7": "20:30"} = domingo a otra hora.
--   regla_festivo  sin_regla | no_se_juega | hora_habitual | hora_especial
--   hora_festivo   hora para regla_festivo = 'hora_especial'.
--
-- Solo CREA una tabla nueva. No toca datos existentes. Idempotente.
-- Ejecutar manualmente en el SQL Editor de Supabase.

create table if not exists public.loterias_catalogo (

    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users(id) on delete cascade,

    nombre text not null check (char_length(nombre) between 1 and 60),
    modalidad text not null default '' check (char_length(modalidad) <= 30),
    categoria text not null default 'chance' check (categoria in ('chance', 'tradicional')),

    dias smallint[] not null default '{}' check (dias <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
    hora time,
    horas_por_dia jsonb not null default '{}'::jsonb,

    regla_festivo text not null default 'sin_regla'
        check (regla_festivo in ('sin_regla', 'no_se_juega', 'hora_habitual', 'hora_especial')),
    hora_festivo time,

    notas text check (char_length(notas) <= 500),
    activo boolean not null default true,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    unique (usuario_id, nombre, modalidad)

);

create index if not exists loterias_catalogo_por_usuario
    on public.loterias_catalogo (usuario_id, categoria, nombre);

alter table public.loterias_catalogo enable row level security;

drop policy if exists "propietario lee" on public.loterias_catalogo;
drop policy if exists "propietario crea" on public.loterias_catalogo;
drop policy if exists "propietario modifica" on public.loterias_catalogo;
drop policy if exists "propietario borra" on public.loterias_catalogo;

create policy "propietario lee" on public.loterias_catalogo for select to authenticated using (usuario_id = auth.uid());
create policy "propietario crea" on public.loterias_catalogo for insert to authenticated with check (usuario_id = auth.uid());
create policy "propietario modifica" on public.loterias_catalogo for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy "propietario borra" on public.loterias_catalogo for delete to authenticated using (usuario_id = auth.uid());

revoke all on table public.loterias_catalogo from anon;
grant select, insert, update, delete on table public.loterias_catalogo to authenticated, service_role;

-- Verificación (solo lectura):
--   select count(*) from public.loterias_catalogo;
--   select policyname, cmd from pg_policies where tablename = 'loterias_catalogo';
--
-- Reversión (borra el catálogo; los sorteos conservan su copia del nombre):
--   drop table if exists public.loterias_catalogo;
