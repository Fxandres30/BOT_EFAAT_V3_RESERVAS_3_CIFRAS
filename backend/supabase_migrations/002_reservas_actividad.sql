-- Fase de rediseño del panel de Reservas/Tablas — registro de auditoría.
--
-- El estado actual de una fila de reserva (libre/reservado/pagado, etc.)
-- se pisa en cada UPDATE, así que no alcanza para mostrar un historial
-- ("reservado", "pagado", "liberado", "bloqueado" con fecha/hora). Esta
-- tabla es un log de solo-inserción de esos eventos, alimentado por las
-- acciones del panel (marcar pagado, liberar, bloquear, reiniciar) y,
-- de forma aditiva, por el bot al reservar.
--
-- No reemplaza ninguna tabla de reservas/eventos existente ni cambia su
-- comportamiento. Ejecutar manualmente en el SQL Editor de Supabase (no
-- hay CLI/migraciones configuradas en este proyecto).

create table if not exists public.reservas_actividad (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    -- tabla física afectada: "reservas_dos_cifras" | "5k_15k_reservas_2_cifras"
    tabla text not null,

    -- null cuando el evento aplica a varios números o a la tabla completa
    -- (por ejemplo "tabla_reiniciada")
    numero text,

    evento_id uuid,

    tipo text not null check (tipo in (
        'reservado',
        'pagado',
        'liberado',
        'bloqueado',
        'cancelado',
        'grupo_creado',
        'grupo_modificado',
        'tabla_reiniciada'
    )),

    -- contexto libre del evento: comprador, contacto, precio, cantidad de
    -- filas afectadas, motivo, etc.
    detalle jsonb not null default '{}'::jsonb,

    -- quién ejecutó la acción: "bot" o el id/email del usuario del panel
    realizado_por text,

    creado_en timestamptz not null default now()

);

create index if not exists reservas_actividad_por_usuario
    on public.reservas_actividad (usuario_id, creado_en desc);

create index if not exists reservas_actividad_por_tabla
    on public.reservas_actividad (usuario_id, tabla, creado_en desc);

alter table public.reservas_actividad enable row level security;

create policy "usuarios ven su propia actividad"
    on public.reservas_actividad for select
    using (auth.uid() = usuario_id);

create policy "usuarios registran su propia actividad"
    on public.reservas_actividad for insert
    with check (auth.uid() = usuario_id);
