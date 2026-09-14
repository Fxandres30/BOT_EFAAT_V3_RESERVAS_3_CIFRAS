-- Corrección del error real en producción durante el pago por sticker:
--
--   [PAGO-STICKER] Error marcando pagado:
--   permission denied for table compradores_semanales
--
-- CAUSA RAÍZ (investigada sin ejecutar SQL a ciegas, solo con lectura vía
-- PostgREST -- ver informe de esta fase):
--
--  1. Confirmado con un SELECT directo usando el cliente service-role real:
--     error 42501 "permission denied for table compradores_semanales" --
--     es un problema de GRANT de PostgreSQL, NO de RLS (RLS produce un
--     mensaje distinto: "new row violates row-level security policy").
--     El rol service_role no tiene ningún privilegio sobre esta tabla, ni
--     siquiera SELECT.
--
--  2. compradores_semanales existe y su esquema (obtenido vía el OpenAPI
--     que expone PostgREST, sin necesitar acceso SQL) es:
--       id, nombre, whatsapp, lunes..domingo, total_semanal,
--       entregados_3cifras
--     -- un contador de compras por día de la semana, indexado por
--     "whatsapp" (teléfono crudo), SIN usuario_global_id, SIN evento_id,
--     SIN identidad_evento_real, SIN usuario_id (tenant). No tiene relación
--     con el modelo de identidad/eventos actual.
--
--  3. PostgREST expone además 4 funciones RPC relacionadas, ninguna
--     invocada desde NINGÚN archivo del repositorio actual (backend NI
--     frontend, verificado por búsqueda exhaustiva):
--       sumar_entregados_tres_cifras, asignar_boletos_seguro,
--       asignar_numeros_gratis, incrementar_veces_preguntada
--     El nombre "sumar_entregados_tres_cifras" coincide exactamente con la
--     columna "entregados_3cifras" de compradores_semanales.
--
--  4. El flujo actual de pago (marcarReservasPagadasPorAdmin.js) hace
--     ÚNICAMENTE un UPDATE sobre la tabla dinámica de reservas
--     (reservas_dos_cifras / "5k_15k_reservas_2_cifras"), cambiando
--     estado='reservado' -> 'pagado'. Ningún código de este repositorio
--     menciona compradores_semanales. La reserva (libre -> reservado) SÍ
--     funciona hoy en producción (verificado en la fase anterior) -- el
--     error solo aparece en la transición a 'pagado'. Esto es coherente
--     con un TRIGGER de Postgres en la tabla de reservas, condicionado a
--     estado='pagado', que llama a una función (muy probablemente
--     sumar_entregados_tres_cifras) que escribe en compradores_semanales.
--
-- CONCLUSIÓN: todo apunta a un subsistema de una versión anterior del bot
-- (un programa de "compradores de la semana" / "boletos gratis") que quedó
-- huérfano de código de aplicación pero SIGUE conectado a nivel de base de
-- datos al flujo real de pago mediante un trigger. No se puede confirmar el
-- nombre exacto del trigger sin ejecutar SQL de introspección directamente
-- en Supabase (fuera del alcance de este backend -- ver PASO 0 abajo).
--
-- DECISIÓN TOMADA PARA ESTA CORRECCIÓN (la más segura y menos invasiva):
-- restaurar el permiso que falta, SIN tocar ni adivinar el nombre de
-- ningún trigger o función. Esto es 100% reversible (un GRANT nunca borra
-- ni cambia datos) y elimina el "permission denied" reportado sin decidir
-- por cuenta propia si compradores_semanales debe seguir existiendo -- esa
-- es una decisión de negocio aparte, no de esta corrección puntual.
--
-- Ejecutar manualmente en el SQL Editor de Supabase, como todas las
-- anteriores.

-- ==========================================================================
-- PASO 0 (OPCIONAL, SOLO LECTURA) -- si quieres confirmar el trigger exacto
-- antes de decidir si además quieres eliminarlo más adelante, ejecuta esto
-- primero y revisa el resultado (no cambia nada):
--
--   select t.tgname as trigger, c.relname as tabla, p.proname as funcion,
--          pg_get_functiondef(p.oid) as definicion
--   from pg_trigger t
--   join pg_class c on c.oid = t.tgrelid
--   join pg_proc p on p.oid = t.tgfoid
--   where c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
--     and not t.tgisinternal;
-- ==========================================================================

-- ==========================================================================
-- PASO 1 -- restaurar el permiso que falta (corrección real de esta fase).
-- No borra nada, no cambia datos, no toca ningún trigger.
-- ==========================================================================

grant select, insert, update, delete on public.compradores_semanales to service_role;

-- Si la tabla usa una columna identity/serial para "id", esto restaura
-- también el permiso de la secuencia asociada (necesario para poder
-- insertar filas nuevas) sin necesidad de adivinar su nombre exacto.
do $$
declare
    seq text;
begin
    seq := pg_get_serial_sequence('public.compradores_semanales', 'id');
    if seq is not null then
        execute format('grant usage, select on sequence %s to service_role', seq);
    end if;
end $$;
