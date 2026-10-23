-- Grupos de destino del botón «Compartir» de cada tabla (Tablas → Compartir).
--
-- Por qué hace falta: el panel ahora deja elegir a qué grupos se publica la
-- imagen de la tabla y recuerda esa elección para los siguientes clics. No
-- había dónde guardarla: grupos_autorizados es la lista de grupos PERMITIDOS
-- del cliente (no una selección) y la configuración de los sorteos es por
-- sorteo, no por tabla.
--
-- Una fila por cliente (usuario_id) y tabla (precio). `grupos` son JIDs de
-- grupo; el backend solo envía a los que SIGUEN en grupos_autorizados
-- activos de ese mismo cliente (si alguno ya no está, pide elegir de nuevo).
--
-- Tabla NUEVA: no modifica ninguna existente. Idempotente.
--
-- Acceso: solo el backend (service role). RLS activada SIN políticas: anon
-- y authenticated no pueden leer ni escribir (el panel pasa siempre por la
-- API, que toma el usuario del token).
--
-- El backend funciona SIN esta migración: la selección no se guarda y el
-- panel la pide en cada envío (nunca envía a grupos no elegidos).
--
-- Ejecutar manualmente en el SQL Editor de Supabase.

create table if not exists public.destinos_compartir_tabla (
    usuario_id uuid not null references auth.users(id) on delete cascade,
    precio integer not null check (precio > 0),
    grupos text[] not null default '{}',
    confirmado_en timestamptz,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    primary key (usuario_id, precio)
);

alter table public.destinos_compartir_tabla enable row level security;
revoke all on public.destinos_compartir_tabla from anon, authenticated;

-- Verificación:
--   select * from public.destinos_compartir_tabla limit 5;
--   select relrowsecurity from pg_class where relname = 'destinos_compartir_tabla';
--
-- Reversión (se pierden las selecciones guardadas; el panel las vuelve a pedir):
--   drop table if exists public.destinos_compartir_tabla;
