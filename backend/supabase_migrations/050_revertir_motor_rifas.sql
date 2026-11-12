-- ==========================================================================
-- 050_revertir — deshace la 050 (motor único de rifas).
--
-- PREPARADA EL 2026-11-12. NO APLICADA. Solo con autorización expresa.
--
-- NO destruye información: ABORTA (sin cambiar nada) si el motor ya tiene
-- datos — alguna rifa, número, archivo o vínculo de grupo — o si
-- reservas_auditoria ya tiene filas escritas por el motor (tabla_id o
-- acciones nuevas). En ese caso la vuelta atrás es apagar el motor en el
-- backend (interruptor MOTOR_RIFAS), no borrar tablas.
--
-- Si está vacío: quita funciones, vista, tablas y el esquema rifas_privado,
-- devuelve los CHECK de reservas_auditoria a los de la 032 y quita sus
-- columnas tabla_id/ciclo. No toca nada más.
-- ==========================================================================

begin;

do $$
begin
    if to_regclass('public.tablas_rifas') is null then
        raise exception '050_revertir: la 050 no está aplicada';
    end if;
    if exists (select 1 from public.tablas_rifas)
       or exists (select 1 from public.numeros_rifa)
       or exists (select 1 from public.numeros_rifa_archivo)
       or exists (select 1 from public.grupos_rifa) then
        raise exception '050_revertir: el motor tiene datos; no se revierte (apagar con MOTOR_RIFAS)';
    end if;
    if exists (select 1 from public.reservas_auditoria
                where tabla_id is not null or ciclo is not null
                   or accion not in ('reservar', 'pagar', 'liberar', 'desbloquear')
                   or origen not in ('manual', 'bot')) then
        raise exception '050_revertir: reservas_auditoria ya tiene filas del motor; no se revierte';
    end if;
end $$;

do $$
begin
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'numeros_rifa') then
        alter publication supabase_realtime drop table public.numeros_rifa;
    end if;
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tablas_rifas') then
        alter publication supabase_realtime drop table public.tablas_rifas;
    end if;
end $$;

drop view public.rifas_resumen;

drop function public.rifa_crear(uuid, text, integer, integer, integer, jsonb, text, jsonb);
drop function public.rifa_reservar(uuid, uuid, integer[], jsonb, jsonb, boolean);
drop function public.rifa_pagar(uuid, uuid, integer[], jsonb, jsonb);
drop function public.rifa_liberar(uuid, uuid, integer[], jsonb, jsonb, jsonb);
drop function public.rifa_bloquear(uuid, uuid, integer[], jsonb, timestamptz);
drop function public.rifa_reiniciar(uuid, uuid, text, jsonb);
drop function public.rifa_actualizar(uuid, uuid, jsonb, jsonb);
drop function public.rifa_archivar(uuid, uuid, jsonb);
drop function public.rifa_restaurar(uuid, uuid, jsonb);
drop function public.rifa_eliminar(uuid, uuid, jsonb);
drop function public.rifa_vincular_grupo(uuid, text, uuid, boolean, jsonb);
drop function public.rifa_desvincular_grupo(uuid, text, uuid, jsonb);
drop function public.rifa_resolver(uuid, text, text, integer);

-- Primero las funciones auxiliares: algunas reciben filas de las tablas del
-- motor (dependen de ellas). CASCADE solo alcanza objetos de la 050: sus
-- triggers y el CHECK de configuracion_tabla.
drop schema rifas_privado cascade;

drop table public.grupos_rifa;
drop table public.numeros_rifa_archivo;
drop table public.numeros_rifa;
drop table public.configuracion_tabla;
drop table public.tablas_rifas;


drop index if exists public.reservas_auditoria_por_rifa;
alter table public.reservas_auditoria drop constraint reservas_auditoria_accion_check;
alter table public.reservas_auditoria drop constraint reservas_auditoria_origen_check;
alter table public.reservas_auditoria add constraint reservas_auditoria_accion_check
    check (accion in ('reservar', 'pagar', 'liberar', 'desbloquear'));
alter table public.reservas_auditoria add constraint reservas_auditoria_origen_check
    check (origen in ('manual', 'bot'));
alter table public.reservas_auditoria drop column tabla_id;
alter table public.reservas_auditoria drop column ciclo;

commit;
