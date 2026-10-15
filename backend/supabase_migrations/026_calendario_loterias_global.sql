-- Calendario de loterías: CATÁLOGO GLOBAL + calendario PROPIO de cada cliente.
--
-- Requiere la 025 (loterias_catalogo, ya aplicada en producción).
--
--   loterias_catalogo_global     catálogo base de EFAAT (lo administra EFAAT;
--                                los clientes solo lo leen). Fuente: el listado
--                                del administrador «Calendario y Horarios
--                                Sorteos de Colombia» (cada entrada guarda en
--                                «notas» el texto original). Lo que el listado
--                                no especifica (p. ej. festivos de muchos
--                                chances) queda «sin_regla»: no se inventa.
--   loterias_catalogo            (025) calendario de CADA cliente: copia
--                                editable. origen_global_id = de qué entrada
--                                global salió (null = creada por el cliente).
--   loterias_catalogo_ofrecidas  qué entradas globales ya se ofrecieron a cada
--                                cliente. Sincronización segura: al abrir su
--                                calendario se le copian SOLO las entradas
--                                globales nuevas (nunca ofrecidas); lo que
--                                editó no se sobrescribe y lo que eliminó no
--                                vuelve.
--
-- Modelo de horarios: dias (1 = lunes … 7 = domingo), hora habitual,
-- horas_por_dia (otra hora para un día, p. ej. {"7": "12:00"} = domingo) y
-- regla de festivos: sin_regla | no_se_juega | hora_habitual | hora_especial
-- (+ hora_festivo).
--
-- Solo CREA tablas/columnas y carga/actualiza el catálogo base. No toca
-- reservas, pagos, sorteos ni identidades. Idempotente: ejecutarla varias
-- veces no duplica nada (on conflict). Ejecutar manualmente en el SQL Editor
-- de Supabase.

-- ==========================================================================
-- 1) Catálogo global
-- ==========================================================================
create table if not exists public.loterias_catalogo_global (

    id uuid primary key default gen_random_uuid(),

    -- Clave estable para cargas idempotentes: "nombre|modalidad" en minúsculas.
    clave text not null unique,

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
    actualizado_en timestamptz not null default now()

);

alter table public.loterias_catalogo_global enable row level security;

drop policy if exists "clientes leen el catalogo global" on public.loterias_catalogo_global;
create policy "clientes leen el catalogo global" on public.loterias_catalogo_global
    for select to authenticated using (true);

revoke all on table public.loterias_catalogo_global from anon, authenticated;
grant select on table public.loterias_catalogo_global to authenticated;
grant select, insert, update, delete on table public.loterias_catalogo_global to service_role;

-- ==========================================================================
-- 2) Calendario de cada cliente: de qué entrada global salió cada copia.
--    Restricción COMPLETA (no parcial): en Postgres los NULL no chocan, así
--    que las entradas creadas por el cliente (origen null) no se limitan, y
--    el backend puede usarla en «on conflict» para no duplicar copias.
-- ==========================================================================
alter table public.loterias_catalogo
    add column if not exists origen_global_id uuid references public.loterias_catalogo_global(id) on delete set null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'loterias_catalogo_una_copia_por_global') then
        alter table public.loterias_catalogo
            add constraint loterias_catalogo_una_copia_por_global unique (usuario_id, origen_global_id);
    end if;
end $$;

-- ==========================================================================
-- 3) Entradas globales ya ofrecidas a cada cliente (copiadas o descartadas
--    por coincidir con una suya). Solo el backend.
-- ==========================================================================
create table if not exists public.loterias_catalogo_ofrecidas (
    usuario_id uuid not null references auth.users(id) on delete cascade,
    global_id uuid not null references public.loterias_catalogo_global(id) on delete cascade,
    ofrecida_en timestamptz not null default now(),
    primary key (usuario_id, global_id)
);

alter table public.loterias_catalogo_ofrecidas enable row level security;
revoke all on table public.loterias_catalogo_ofrecidas from anon, authenticated;
grant select, insert, update, delete on table public.loterias_catalogo_ofrecidas to service_role;

-- ==========================================================================
-- 4) Carga del catálogo base (idempotente). Una nueva ejecución corrige el
--    catálogo GLOBAL; los calendarios de los clientes no se tocan.
--    (clave, nombre, modalidad, categoria, dias, hora, horas_por_dia,
--     regla_festivo, hora_festivo, notas)
-- ==========================================================================
insert into public.loterias_catalogo_global
    (clave, nombre, modalidad, categoria, dias, hora, horas_por_dia, regla_festivo, hora_festivo, notas)
values
    ('antioqueñita|día', 'Antioqueñita', 'Día', 'chance', '{1,2,3,4,5,6,7}', '10:00', '{"7":"12:00"}', 'hora_especial', '12:00', 'Listado: Lunes a Sábado 10:00 AM · Domingos y Días Feriados 12:00 PM'),
    ('antioqueñita|tarde', 'Antioqueñita', 'Tarde', 'chance', '{1,2,3,4,5,6,7}', '16:00', '{}', 'hora_habitual', null, 'Listado: Todos los días y Días Feriados 4:00 PM'),
    ('dorado|mañana', 'Dorado', 'Mañana', 'chance', '{1,2,3,4,5,6}', '10:58', '{}', 'sin_regla', null, 'Listado: Lunes a Sábado 10:58 AM'),
    ('dorado|tarde', 'Dorado', 'Tarde', 'chance', '{1,2,3,4,5,6}', '15:28', '{}', 'sin_regla', null, 'Listado: Lunes a Sábado 3:28 PM'),
    ('dorado|noche', 'Dorado', 'Noche', 'chance', '{6,7}', null, '{"6":"22:15","7":"19:25"}', 'hora_especial', '19:25', 'Listado: Sábado 10:15 PM · Domingos y Festivos 7:25 PM'),
    ('fantástica|día', 'Fantástica', 'Día', 'chance', '{1,2,3,4,5,6}', '12:57', '{}', 'sin_regla', null, 'Listado: Lunes a Sábado 12:57 PM'),
    ('fantástica|noche', 'Fantástica', 'Noche', 'chance', '{1,2,3,4,5,6}', '20:30', '{}', 'sin_regla', null, 'Listado: Lunes a Sábado 8:30 PM'),
    ('samán de la suerte|', 'Samán de la Suerte', '', 'chance', '{1,2,3,4,5,6,7}', '13:00', '{"7":"19:00"}', 'hora_especial', '19:00', 'Listado: El Samán de la Suerte: Lunes a Sábado 1:00 PM · Domingos y Días Feriados 7:00 PM'),
    ('paisita|día', 'Paisita', 'Día', 'chance', '{1,2,3,4,5,6,7}', '13:00', '{"7":"14:00"}', 'hora_especial', '14:00', 'Listado: Lunes a Sábado 1:00 PM · Domingos y Días Festivos 2:00 PM'),
    ('paisita|noche', 'Paisita', 'Noche', 'chance', '{1,2,3,4,5,6,7}', '18:00', '{"7":"20:00"}', 'hora_especial', '20:00', 'Listado: Lunes a Sábado 6:00 PM · Domingos y Días Festivos 8:00 PM'),
    ('chontico|día', 'Chontico', 'Día', 'chance', '{1,2,3,4,5,6,7}', '13:00', '{}', 'sin_regla', null, 'Listado: Todos los días 1:00 PM'),
    ('chontico|noche', 'Chontico', 'Noche', 'chance', '{1,2,3,4,5,6,7}', '19:00', '{"6":"22:00","7":"20:00"}', 'hora_especial', '20:00', 'Listado: Lunes a Viernes 7:00 PM · Sábado 10:00 PM · Domingos y Festivos 8:00 PM'),
    ('pijao de oro|', 'Pijao de Oro', '', 'chance', '{1,2,3,4,5,6,7}', '14:00', '{"6":"21:00","7":"22:00"}', 'hora_especial', '20:00', 'Listado: Lunes a Viernes 2:00 PM · Sábado 9:00 PM · Domingo 10:00 PM · Días Festivos 8:00 PM'),
    ('super astro|sol', 'Super Astro', 'Sol', 'chance', '{1,2,3,4,5,6}', '14:30', '{}', 'sin_regla', null, 'Listado: Lunes a Sábado 2:30 PM'),
    ('super astro|luna', 'Super Astro', 'Luna', 'chance', '{1,2,3,4,5,6,7}', '22:30', '{"7":"20:30"}', 'hora_especial', '20:30', 'Listado: Lunes a Sábado 10:30 PM · Domingos y Días Festivos 8:30 PM'),
    ('sinuano|día', 'Sinuano', 'Día', 'chance', '{1,2,3,4,5,6,7}', '14:30', '{"7":"13:00"}', 'hora_especial', '13:00', 'Listado: Lunes a Sábado 2:30 PM · Domingos y Días Festivos 1:00 PM'),
    ('sinuano|noche', 'Sinuano', 'Noche', 'chance', '{1,2,3,4,5,6,7}', '22:30', '{"7":"20:30"}', 'hora_especial', '20:30', 'Listado: Lunes a Sábado 10:30 PM · Domingos y Días Festivos 8:30 PM'),
    ('caribeña|día', 'Caribeña', 'Día', 'chance', '{1,2,3,4,5,6,7}', '14:30', '{}', 'sin_regla', null, 'Listado: La Caribeña Día: Todos los días 2:30 PM'),
    ('caribeña|noche', 'Caribeña', 'Noche', 'chance', '{1,2,3,4,5,6,7}', '22:30', '{"7":"20:30"}', 'hora_especial', '20:30', 'Listado: La Caribeña Noche: Lunes a Sábado 10:30 PM · Domingos y Días Festivos 8:30 PM'),
    ('motilón|tarde', 'Motilón', 'Tarde', 'chance', '{1,2,3,4,5,6,7}', '15:00', '{}', 'sin_regla', null, 'Listado: Todos los días 3:00 PM'),
    ('motilón|noche', 'Motilón', 'Noche', 'chance', '{1,2,3,4,5,6,7}', '21:00', '{}', 'sin_regla', null, 'Listado: Todos los días 9:00 PM'),
    ('cafeterito|tarde', 'Cafeterito', 'Tarde', 'chance', '{1,2,3,4,5,6}', '12:00', '{}', 'sin_regla', null, 'Listado: Lunes a Sábado 12:00 PM'),
    ('cafeterito|noche', 'Cafeterito', 'Noche', 'chance', '{1,2,3,4,5,6,7}', '22:00', '{"6":"23:00","7":"21:00"}', 'hora_especial', '21:00', 'Listado: Lunes a Viernes 10:00 PM · Sábado 11:00 PM · Domingos y Festivos 9:00 PM'),
    ('paisa lotto|', 'Paisa Lotto', '', 'chance', '{6}', '22:00', '{}', 'sin_regla', null, 'Listado: Sábado 10:00 PM'),
    ('la culona|día', 'La Culona', 'Día', 'chance', '{1,2,3,4,5,6,7}', '14:30', '{}', 'hora_habitual', null, 'Listado: Todos los días incluso los días feriados 2:30 PM'),
    ('la culona|noche', 'La Culona', 'Noche', 'chance', '{1,2,3,4,5,6,7}', '21:30', '{"7":"20:00"}', 'hora_especial', '20:00', 'Listado: Lunes a Sábado 9:30 PM · Domingos y Días Festivos 8:00 PM'),
    ('supermillonaria|', 'SuperMillonaria', '', 'chance', '{5}', '23:00', '{}', 'sin_regla', null, 'Listado: Viernes 11:00 PM'),
    ('lotería de cundinamarca|', 'Lotería de Cundinamarca', '', 'tradicional', '{1}', '22:30', '{}', 'sin_regla', null, 'Listado: Lunes 10:30 PM'),
    ('lotería de tolima|', 'Lotería de Tolima', '', 'tradicional', '{1}', '23:00', '{}', 'sin_regla', null, 'Listado: Lunes 11:00 PM'),
    ('lotería cruz roja|', 'Lotería Cruz Roja', '', 'tradicional', '{2}', '22:30', '{}', 'sin_regla', null, 'Listado: Martes 10:30 PM'),
    ('lotería de huila|', 'Lotería de Huila', '', 'tradicional', '{2}', '22:30', '{}', 'sin_regla', null, 'Listado: Martes 10:30 PM'),
    ('lotería de manizales|', 'Lotería de Manizales', '', 'tradicional', '{3}', '22:30', '{}', 'sin_regla', null, 'Listado: Miércoles 10:30 PM'),
    ('lotería del meta|', 'Lotería del Meta', '', 'tradicional', '{3}', '22:30', '{}', 'sin_regla', null, 'Listado: Miércoles 10:30 PM'),
    ('lotería del valle|', 'Lotería del Valle', '', 'tradicional', '{3}', '22:30', '{}', 'sin_regla', null, 'Listado: Miércoles 10:30 PM'),
    ('lotería quindío|', 'Lotería Quindío', '', 'tradicional', '{4}', '22:30', '{}', 'sin_regla', null, 'Listado: Jueves 10:30 PM'),
    ('lotería de bogotá|', 'Lotería de Bogotá', '', 'tradicional', '{4}', '22:30', '{}', 'sin_regla', null, 'Listado: Jueves 10:30 PM'),
    ('lotería de santander|', 'Lotería de Santander', '', 'tradicional', '{5}', '23:00', '{}', 'sin_regla', null, 'Listado: Viernes 11:00 PM'),
    ('lotería de medellín|', 'Lotería de Medellín', '', 'tradicional', '{5}', '23:00', '{}', 'sin_regla', null, 'Listado: Viernes 11:00 PM'),
    ('lotería risaralda|', 'Lotería Risaralda', '', 'tradicional', '{5}', '23:00', '{}', 'sin_regla', null, 'Listado: Viernes 11:00 PM'),
    ('lotería de boyacá|', 'Lotería de Boyacá', '', 'tradicional', '{6}', '22:40', '{}', 'sin_regla', null, 'Listado: Sábado 10:40 PM'),
    ('lotería de cauca|', 'Lotería de Cauca', '', 'tradicional', '{6}', '21:40', '{}', 'sin_regla', null, 'Listado: Sábado 9:40 PM'),
    ('extra de colombia|mensual', 'Extra de Colombia', 'Mensual', 'tradicional', '{6}', '23:00', '{}', 'sin_regla', null, 'Listado: Sábado 11:00 PM (mensual; el listado no indica qué sábado del mes)')

on conflict (clave) do update set
    nombre = excluded.nombre,
    modalidad = excluded.modalidad,
    categoria = excluded.categoria,
    dias = excluded.dias,
    hora = excluded.hora,
    horas_por_dia = excluded.horas_por_dia,
    regla_festivo = excluded.regla_festivo,
    hora_festivo = excluded.hora_festivo,
    notas = excluded.notas,
    actualizado_en = now();

-- Verificación (solo lectura):
--   select categoria, count(*) from public.loterias_catalogo_global group by 1;   -- chance 27, tradicional 15
--   select nombre, modalidad, dias, hora, horas_por_dia, regla_festivo, hora_festivo
--   from public.loterias_catalogo_global order by categoria, nombre, modalidad;
--
-- Reversión (no borra los calendarios de los clientes; solo el vínculo):
--   drop table if exists public.loterias_catalogo_ofrecidas;
--   alter table public.loterias_catalogo drop constraint if exists loterias_catalogo_una_copia_por_global;
--   alter table public.loterias_catalogo drop column if exists origen_global_id;
--   drop table if exists public.loterias_catalogo_global;
