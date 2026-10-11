-- Control de inactividad comercial: miembros que llevan 15 días sin una
-- compra CONFIRMADA en un grupo.
--
-- POR QUÉ HACE FALTA UNA MIGRACIÓN: hoy no existe ningún registro
-- persistente de "última compra confirmada por miembro y grupo". La única
-- huella de un pago es la fila de la tabla dinámica del sorteo
-- (estado='pagado', fecha_pago, grupo_id, usuario_global_id), y esa fila se
-- pierde cuando el panel reinicia la tabla (reiniciarTabla.ts). Sin un
-- registro propio, un cliente que pagó hace 3 días parecería "sin compras"
-- tras un reinicio y podría ser expulsado por error.
--
-- Tres tablas NUEVAS + un trigger NUEVO (sección 5) en las dos tablas de
-- reservas (reservas_dos_cifras, 5k_15k_reservas_2_cifras) que registra cada
-- compra confirmada. No borra ni altera columnas, datos, precios ni triggers
-- existentes de ninguna tabla.
--
--   inactividad_miembros     estado persistente por (tenant, grupo, miembro):
--                            última compra confirmada, desde cuándo se le
--                            sigue, si sigue presente en el grupo.
--   inactividad_ejecuciones  una fila por ejecución del control (simulación o
--                            real) + candado: como máximo UNA en curso por
--                            tenant (índice único parcial) -> exclusión mutua
--                            entre procesos/instancias (PM2, LOCAL/VPS).
--   inactividad_evaluaciones bitácora: cada miembro evaluado en cada
--                            ejecución, con decisión, motivo, acción,
--                            resultado, errores e intentos.
--
-- Solo el backend (SUPABASE_SERVICE_ROLE_KEY) lee/escribe estas tablas: RLS
-- habilitado y sin policies, mismo criterio que sesiones_lease (004),
-- pagos_* (005) y bloqueo_intentos (019).
--
-- Ejecutar manualmente en el SQL Editor de Supabase (no hay CLI/psql en este
-- proyecto). Es idempotente: se puede ejecutar más de una vez.

-- ==========================================================================
-- 1) inactividad_miembros
-- ==========================================================================
create table if not exists public.inactividad_miembros (

    id uuid primary key default gen_random_uuid(),

    -- Tenant dueño del grupo/evento (mismo usuario_id de eventos_bot).
    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,

    usuario_global_id uuid not null references public.usuarios(id) on delete cascade,

    -- Última compra CONFIRMADA (reservado -> pagado por sticker de
    -- administrador o por el panel). Nunca mensajes, saludos, pedidos de
    -- tabla, reservas pendientes ni comprobantes sin confirmar.
    ultima_compra_en timestamptz,
    ultima_compra_origen text,

    -- Desde cuándo consta que está en este grupo: la fecha de la compra
    -- confirmada con la que se creó el registro, o la primera vez que el
    -- control lo vio, o su reingreso. Nadie puede cumplir 15 días sin compra antes de
    -- que conste 15 días en el grupo.
    seguimiento_desde timestamptz not null default now(),

    presente boolean not null default true,
    ultima_vez_visto_en timestamptz,

    ultima_evaluacion_en timestamptz,
    ultimo_resultado text,
    expulsado_en timestamptz,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    unique (usuario_id, grupo_id, usuario_global_id)

);

create index if not exists inactividad_miembros_por_grupo
    on public.inactividad_miembros (usuario_id, grupo_id);

alter table public.inactividad_miembros enable row level security;

-- ==========================================================================
-- 2) inactividad_ejecuciones (+ candado de exclusión mutua)
-- ==========================================================================
create table if not exists public.inactividad_ejecuciones (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    session_id text,

    modo text not null check (modo in ('simulacion', 'real')),

    estado text not null default 'en_curso'
        check (estado in ('en_curso', 'completada', 'fallida', 'abandonada')),

    iniciado_en timestamptz not null default now(),
    finalizado_en timestamptz,

    resumen jsonb not null default '{}'::jsonb,
    error text

);

-- Garantía atómica de "una sola ejecución en curso por tenant": un segundo
-- INSERT 'en_curso' recibe 23505 (unique_violation) y no corre.
create unique index if not exists inactividad_ejecuciones_una_en_curso
    on public.inactividad_ejecuciones (usuario_id)
    where estado = 'en_curso';

create index if not exists inactividad_ejecuciones_por_usuario
    on public.inactividad_ejecuciones (usuario_id, iniciado_en desc);

alter table public.inactividad_ejecuciones enable row level security;

-- ==========================================================================
-- 3) inactividad_evaluaciones (bitácora)
-- ==========================================================================
create table if not exists public.inactividad_evaluaciones (

    id uuid primary key default gen_random_uuid(),

    ejecucion_id uuid references public.inactividad_ejecuciones(id) on delete cascade,

    usuario_id uuid not null references auth.users(id) on delete cascade,

    modo text not null check (modo in ('simulacion', 'real')),

    grupo_id text not null,
    grupo_nombre text,

    -- null cuando la identidad no se pudo resolver (motivo lo explica).
    usuario_global_id uuid,
    miembro_jid text,

    ultima_compra_en timestamptz,
    referencia_en timestamptz,
    dias_sin_compra integer,
    -- Cuándo cumpliría (o cumplió) el plazo si no compra antes.
    cumple_plazo_en timestamptz,

    -- conservar | candidato | excluido | omitido | error_grupo
    decision text not null,
    motivo text not null,

    -- ninguna | expulsar | expulsar_simulado
    accion text not null default 'ninguna',

    -- simulado | pendiente | expulsado | ya_no_estaba | sin_permisos |
    -- suspendido | tiempo_agotado | error | limite_alcanzado | no_aplica
    resultado text not null default 'no_aplica',

    error text,
    intentos integer not null default 0,

    creado_en timestamptz not null default now()

);

create index if not exists inactividad_evaluaciones_por_ejecucion
    on public.inactividad_evaluaciones (ejecucion_id);

create index if not exists inactividad_evaluaciones_por_miembro
    on public.inactividad_evaluaciones (usuario_id, grupo_id, usuario_global_id, creado_en desc);

-- Retención (purgarEvaluacionesAntiguas: borra por tenant y antigüedad).
create index if not exists inactividad_evaluaciones_por_antiguedad
    on public.inactividad_evaluaciones (usuario_id, creado_en);

alter table public.inactividad_evaluaciones enable row level security;

-- ==========================================================================
-- 4) Privilegios explícitos. Las tres tablas guardan identificadores de
--    WhatsApp (miembro_jid contiene el teléfono): solo el backend.
--    (Ver 016: un privilegio ausente para service_role ya rompió pagos.)
-- ==========================================================================
revoke all on table public.inactividad_miembros     from anon, authenticated;
revoke all on table public.inactividad_ejecuciones  from anon, authenticated;
revoke all on table public.inactividad_evaluaciones from anon, authenticated;

grant select, insert, update, delete on table public.inactividad_miembros     to service_role;
grant select, insert, update, delete on table public.inactividad_ejecuciones  to service_role;
grant select, insert, update, delete on table public.inactividad_evaluaciones to service_role;

-- ==========================================================================
-- 5) Registro DURADERO de cada compra confirmada, sin importar quién la
--    confirma (sticker de administrador en el backend, o el panel, que
--    escribe directo desde el navegador con frontend/services/tablas/
--    marcarPagado.ts). Un trigger en las tablas de reservas registra la
--    compra en la MISMA transacción que pasa la fila a 'pagado', así que un
--    reinicio posterior de la tabla (reiniciarTabla.ts) o la cancelación del
--    número (liberarNumero.ts) ya no pueden borrar esa evidencia.
--
--    Seguridad para el flujo de pago:
--      - Nunca bloquea el pago: cualquier error (FK, permisos...) se atrapa
--        y solo deja un WARNING en el log de Postgres.
--      - SECURITY DEFINER con search_path fijo: funciona igual cuando el
--        UPDATE lo hace el panel (rol authenticated) o el backend
--        (service_role), sin abrir inactividad_miembros a esos roles.
--      - Solo actúa en la transición a 'pagado' (no en reservas, liberaciones
--        ni reinicios) y solo con usuario_id, grupo_id y usuario_global_id
--        presentes; sin ellos no hay a quién ni dónde atribuir la compra.
--      - Nunca retrocede la fecha (GREATEST).
--
--    No modifica columnas, datos ni triggers existentes de las tablas de
--    reservas (incluido el trigger heredado de compradores_semanales, ver
--    016): solo AÑADE uno nuevo, con nombre propio.
-- ==========================================================================
create or replace function public.inactividad_registrar_compra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin

    if new.estado = 'pagado'
       and (tg_op = 'INSERT' or old.estado is distinct from 'pagado')
       and new.usuario_id is not null
       and new.grupo_id is not null
       and new.usuario_global_id is not null
    then

        begin

            insert into public.inactividad_miembros as m
                (usuario_id, grupo_id, usuario_global_id, ultima_compra_en, ultima_compra_origen, seguimiento_desde)
            values
                (new.usuario_id, new.grupo_id, new.usuario_global_id, now(), 'trigger_pago', now())
            on conflict (usuario_id, grupo_id, usuario_global_id) do update
                set ultima_compra_en = greatest(m.ultima_compra_en, excluded.ultima_compra_en),
                    ultima_compra_origen = excluded.ultima_compra_origen,
                    actualizado_en = now();

        exception when others then

            raise warning 'inactividad_registrar_compra: compra no registrada (tabla %, numero %): % %',
                tg_table_name, new.numero, sqlstate, sqlerrm;

        end;

    end if;

    return new;

end;
$$;

revoke all on function public.inactividad_registrar_compra() from public, anon, authenticated;

do $$
declare
    t text;
begin

    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop

        if to_regclass(format('public.%I', t)) is null then

            raise notice 'Tabla % no existe: se omite su trigger.', t;
            continue;

        end if;

        execute format('drop trigger if exists inactividad_compra_confirmada on public.%I', t);

        execute format(
            'create trigger inactividad_compra_confirmada
                 after insert or update of estado on public.%I
                 for each row execute function public.inactividad_registrar_compra()',
            t
        );

        -- Backfill: compras ya confirmadas que todavía siguen visibles en la
        -- tabla (antes de que un reinicio las borre). fecha_pago (date) y
        -- hora_pago (time) están en hora de Bogotá. Sin fecha_pago no se
        -- inventa fecha: esa fila no se importa. Los JOIN evitan errores de
        -- FK con filas huérfanas (usuario o tenant inexistente).
        execute format($sql$
            insert into public.inactividad_miembros as m
                (usuario_id, grupo_id, usuario_global_id, ultima_compra_en, ultima_compra_origen, seguimiento_desde)
            select r.usuario_id, r.grupo_id, r.usuario_global_id,
                   max((r.fecha_pago + coalesce(r.hora_pago, time '00:00')) at time zone 'America/Bogota'),
                   'migracion_022',
                   max((r.fecha_pago + coalesce(r.hora_pago, time '00:00')) at time zone 'America/Bogota')
            from public.%I r
            join public.usuarios u on u.id = r.usuario_global_id
            join auth.users a on a.id = r.usuario_id
            where r.estado = 'pagado'
              and r.fecha_pago is not null
              and r.grupo_id is not null
            group by r.usuario_id, r.grupo_id, r.usuario_global_id
            on conflict (usuario_id, grupo_id, usuario_global_id) do update
                set ultima_compra_en = greatest(m.ultima_compra_en, excluded.ultima_compra_en),
                    actualizado_en = now()
        $sql$, t);

    end loop;

end $$;

-- ==========================================================================
-- Consultas útiles (solo lectura) para revisar una simulación:
--
--   -- últimas ejecuciones
--   select id, modo, estado, iniciado_en, finalizado_en, resumen
--   from public.inactividad_ejecuciones order by iniciado_en desc limit 10;
--
--   -- candidatos de la última ejecución
--   select grupo_nombre, grupo_id, miembro_jid, usuario_global_id,
--          ultima_compra_en, dias_sin_compra, motivo, accion, resultado
--   from public.inactividad_evaluaciones
--   where ejecucion_id = '<id>' and decision = 'candidato'
--   order by grupo_nombre, dias_sin_compra desc;
--
--   -- verificación tras aplicar: triggers instalados
--   select event_object_table, trigger_name, event_manipulation
--   from information_schema.triggers
--   where trigger_name = 'inactividad_compra_confirmada';
--
--   -- verificación tras aplicar: compras importadas por el backfill
--   select ultima_compra_origen, count(*) from public.inactividad_miembros
--   group by 1;
--
-- REVERSIÓN (solo si se decide retirar el control; borra su historial):
--   drop trigger if exists inactividad_compra_confirmada on public.reservas_dos_cifras;
--   drop trigger if exists inactividad_compra_confirmada on public."5k_15k_reservas_2_cifras";
--   drop function if exists public.inactividad_registrar_compra();
--   drop table if exists public.inactividad_evaluaciones, public.inactividad_ejecuciones, public.inactividad_miembros;
-- ==========================================================================
