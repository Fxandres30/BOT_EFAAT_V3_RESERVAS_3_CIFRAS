-- ==========================================================================
-- 054 (REVERTIR) — quita lo que añadió la 054. No toca filas.
--
-- reiniciar_tabla_cliente se CONSERVA con la corrección `where true`: la
-- versión original de la 030 no funciona en Supabase (pg-safeupdate) y
-- volver a ella solo reintroduciría el error 21000.
-- ==========================================================================

begin;

drop trigger if exists sorteos_programados_con_rifa on public.sorteos_programados;
drop function if exists rifas_privado.sorteo_programado_con_rifa();
drop function if exists public.rifa_reiniciar_sorteo(uuid, uuid, text, uuid, boolean, boolean, jsonb);
drop function if exists public.rifa_cambiar_identidad(uuid, uuid, text, text, text, jsonb);

commit;
