-- Estado del cierre de CADA grupo de un sorteo (una fila de eventos_bot por
-- grupo). Permite saber, por grupo, si el cierre de WhatsApp está pendiente,
-- se completó, falla (y por qué) o necesita revisión manual, y espaciar los
-- reintentos de un grupo donde el bot no tiene permisos sin bloquear a los
-- demás grupos del mismo sorteo.
--
-- SOLO AÑADE columnas nullable / con default a public.eventos_bot. No borra,
-- no renombra, no cambia tipos ni datos existentes. Idempotente.
--
-- El backend funciona igual SIN esta migración: cerrarEvento.js detecta la
-- columna inexistente (42703) y guarda exactamente lo de siempre
-- (activo/abierto/estado). Con ella, además, registra el detalle.
--
-- Ejecutar manualmente en el SQL Editor de Supabase.

alter table public.eventos_bot add column if not exists cierre_estado text;
alter table public.eventos_bot add column if not exists cierre_motivo text;
alter table public.eventos_bot add column if not exists cierre_intentos integer not null default 0;
alter table public.eventos_bot add column if not exists cierre_ultimo_error text;
alter table public.eventos_bot add column if not exists cierre_ultimo_intento_en timestamptz;
alter table public.eventos_bot add column if not exists cerrado_en timestamptz;

-- Valores válidos (null = nunca se intentó cerrar). NOT VALID: no revalida
-- filas existentes (todas tienen null), solo las escrituras nuevas.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'eventos_bot_cierre_estado_valido'
    ) then
        alter table public.eventos_bot
            add constraint eventos_bot_cierre_estado_valido
            check (cierre_estado is null or cierre_estado in ('fallido', 'requiere_revision', 'cerrado'))
            not valid;
    end if;
end $$;

-- Grupos que necesitan atención (consulta del panel / revisión manual).
create index if not exists eventos_bot_cierre_pendiente
    on public.eventos_bot (usuario_id, cierre_estado)
    where activo = true and cierre_estado in ('fallido', 'requiere_revision');

-- Verificación (solo lectura):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'eventos_bot' and (column_name like 'cierre%' or column_name = 'cerrado_en');
--
-- Grupos con cierre fallido:
--   select id, grupo_nombre, cierre_estado, cierre_intentos, cierre_ultimo_error, cierre_ultimo_intento_en
--   from public.eventos_bot where activo and cierre_estado in ('fallido', 'requiere_revision');
--
-- Reversión (pierde solo el detalle de cierres):
--   drop index if exists eventos_bot_cierre_pendiente;
--   alter table public.eventos_bot drop constraint if exists eventos_bot_cierre_estado_valido;
--   alter table public.eventos_bot drop column if exists cierre_estado, drop column if exists cierre_motivo,
--     drop column if exists cierre_intentos, drop column if exists cierre_ultimo_error,
--     drop column if exists cierre_ultimo_intento_en, drop column if exists cerrado_en;
