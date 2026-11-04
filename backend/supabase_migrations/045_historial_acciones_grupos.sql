-- ==========================================================================
-- 045 — Historial de sorteos: acciones de GRUPOS (04/11/2026).
--
-- PREPARADA EL 2026-11-04. NO APLICADA. Ejecutar manualmente en el SQL Editor
-- de Supabase, DESPUÉS de la 038 (y solo si se aplica la 038).
--
-- Por qué: la 038 limita sorteos_programados_historial.accion a cancelar,
-- eliminar, archivar, restaurar y reintentar. El backend ahora registra
-- también:
--   cambiar_grupos           «Cambiar grupos» / «Editar»: grupos agregados y
--                            quitados (sorteos/gruposSorteo.js).
--   publicar_grupos_nuevos   «Publicar en los grupos nuevos» y su resultado.
--   vincular_detectado       un sorteo detectado en WhatsApp pasa a
--                            gestionarse desde el panel.
-- Sin esta migración esas filas no entran (la restricción las rechaza) y el
-- backend las escribe en el log del proceso (📝 [SORTEOS HISTORIAL]); la
-- operación nunca falla por eso.
--
-- Solo cambia la restricción CHECK: no toca ninguna fila. Idempotente. Si la
-- tabla no existe (038 sin aplicar), no hace nada.
-- ==========================================================================

do $$
begin
    if to_regclass('public.sorteos_programados_historial') is null then
        raise notice '045: sorteos_programados_historial no existe (aplica antes la 038). No se hizo nada.';
        return;
    end if;

    alter table public.sorteos_programados_historial
        drop constraint if exists sorteos_programados_historial_accion_check;

    alter table public.sorteos_programados_historial
        add constraint sorteos_programados_historial_accion_check
        check (accion in (
            'cancelar', 'eliminar', 'archivar', 'restaurar', 'reintentar',
            'cambiar_grupos', 'publicar_grupos_nuevos', 'vincular_detectado'
        ));
end $$;

-- Verificación (solo lectura):
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'sorteos_programados_historial_accion_check';
--
-- Reversión (vuelve a la restricción de la 038; falla si ya hay filas con
-- las acciones nuevas: bórralas o déjalas antes de revertir):
--   alter table public.sorteos_programados_historial drop constraint if exists sorteos_programados_historial_accion_check;
--   alter table public.sorteos_programados_historial add constraint sorteos_programados_historial_accion_check
--     check (accion in ('cancelar', 'eliminar', 'archivar', 'restaurar', 'reintentar'));
