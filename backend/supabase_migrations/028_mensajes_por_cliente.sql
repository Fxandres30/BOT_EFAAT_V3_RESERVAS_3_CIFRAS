-- ==========================================================================
-- 028 — MENSAJES DE GRUPO POR CLIENTE (multiusuario)
--
-- PREPARADA EL 2026-10-21. NO APLICADA. Requiere autorización expresa.
--
-- Problema: mensajes_grupos_sorteos no tiene columna de cliente
-- (usuario_id es el PARTICIPANTE de WhatsApp que escribió, no el cliente de
-- EFAAT) y la deduplicación de la 021 es ÚNICA por (grupo_id, mensaje_id).
-- Con varios clientes conectados a la vez, si dos están en el mismo grupo,
-- cada uno recibe el mismo mensaje con el mismo id: el segundo chocaba con
-- el índice (23505) y se descartaba como duplicado — su bot nunca lo
-- procesaba.
--
-- Qué hace (idempotente, no destructivo, una transacción):
--   1. Columna cliente_usuario_id (uuid, nullable): el cliente dueño de la
--      SESIÓN que recibió el mensaje. La escribe el bot
--      (guardarMensajeGrupo.js, desde sock.context.usuarioId). Es la misma
--      columna del paso 1 de la Parte E (docs/activacion): aplicar las dos
--      no falla.
--   2. Índice para el panel de chats por cliente.
--   3. Índice ÚNICO PARCIAL (cliente_usuario_id, grupo_id, mensaje_id)
--      donde cliente_usuario_id no es nulo: el reclamo atómico ahora es por
--      cliente (dentro de un cliente se sigue procesando una sola vez).
--   4. Se retira el índice único de la 021 (grupo_id, mensaje_id). El índice
--      normal de la 021 (no único) se conserva para las búsquedas.
--
-- Filas históricas: quedan con cliente_usuario_id NULL. NO se rellenan aquí
-- (no se inventa el dueño). El bot sigue tratando esas filas como "ya
-- procesado" para cualquier cliente (compuertaIngreso.yaRegistrado), así
-- que un reenvío de un mensaje viejo no se reprocesa. Relleno opcional y
-- verificable por grupo: docs/activacion/relleno_cliente_mensajes.sql.
--
-- ORDEN (obligatorio): primero desplegar el bot que escribe
-- cliente_usuario_id (funciona con y sin esta migración); después esta
-- migración. Al revés, durante el intervalo las filas del bot anterior
-- (sin cliente) no tendrían el índice único de la 021.
--
-- Ejecutar manualmente en el SQL Editor de Supabase.
-- ==========================================================================

begin;

do $$
begin
    if to_regclass('public.mensajes_grupos_sorteos') is null then
        raise exception '028 abortada: no existe public.mensajes_grupos_sorteos';
    end if;
end $$;

alter table public.mensajes_grupos_sorteos
    add column if not exists cliente_usuario_id uuid;

create index if not exists mensajes_grupos_sorteos_cliente_grupo_idx
    on public.mensajes_grupos_sorteos (cliente_usuario_id, grupo_id, timestamp_whatsapp desc);

create unique index if not exists mensajes_grupos_sorteos_cliente_mensaje_unico
    on public.mensajes_grupos_sorteos (cliente_usuario_id, grupo_id, mensaje_id)
    where cliente_usuario_id is not null;

drop index if exists public.mensajes_grupos_sorteos_grupo_mensaje_unico_nuevos;

commit;

-- ==========================================================================
-- Verificación (solo lectura):
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'mensajes_grupos_sorteos';
--   -- Tras unos minutos con el bot nuevo: 0 filas nuevas sin cliente.
--   select count(*) from public.mensajes_grupos_sorteos
--   where cliente_usuario_id is null and creado_en > now() - interval '1 hour';
--
-- Reversión (vuelve a la deduplicación global de la 021; la columna y sus
-- datos se conservan):
--   1. drop index if exists public.mensajes_grupos_sorteos_cliente_mensaje_unico;
--   2. Volver a ejecutar 021_mensaje_procesado_unico.sql: recrea su índice
--      único parcial para las filas NUEVAS (id mayor que el máximo actual),
--      sin exigir limpiar duplicados anteriores.
--   (Con dos clientes ya activos en el mismo grupo, la deduplicación global
--   vuelve a descartar la copia del segundo cliente.)
-- ==========================================================================
