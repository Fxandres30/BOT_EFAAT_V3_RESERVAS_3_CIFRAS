-- Corrección arquitectónica — sticker de pago en DOS niveles:
--   Nivel 1 (predeterminado): usuario_id, grupo_id = NULL.
--   Nivel 2 (específico):     usuario_id, grupo_id = JID real del grupo.
--
-- La migración 011 (ya ejecutada en Supabase — verificado con una consulta
-- real, no asumido) creó configuracion_stickers_pago con grupo_id NOT NULL
-- y unique(usuario_id, grupo_id). Eso no alcanza para el predeterminado
-- (grupo_id NULL). Esta migración AJUSTA la tabla existente — NUNCA hace
-- DROP TABLE ni borra filas (la fila real que ya existía se conserva; su
-- grupo_id corrupto ya se reparó en 012_reparar_grupo_id_percent_encoded.sql,
-- que debe ejecutarse ANTES que esta).
--
-- Ejecutar manualmente en el SQL Editor de Supabase, después de 012.

-- ==========================================================================
-- 1) grupo_id pasa a ser NULLABLE. NULL representa el sticker
--    predeterminado del tenant.
-- ==========================================================================

alter table public.configuracion_stickers_pago
    alter column grupo_id drop not null;

-- ==========================================================================
-- 2) La restricción unique(usuario_id, grupo_id) de 011 NO sirve para el
--    caso NULL: en Postgres, dos filas con el mismo usuario_id y
--    grupo_id=NULL NO violan un unique(a,b) normal (NULL nunca es igual a
--    NULL), así que permitiría varios "predeterminados" para el mismo
--    tenant. Se reemplaza por DOS índices únicos PARCIALES:
--
--      a) como máximo UN predeterminado (grupo_id IS NULL) por usuario_id.
--      b) como máximo UN específico por (usuario_id, grupo_id) cuando
--         grupo_id NO es NULL — mismo comportamiento que la unique
--         original de 011, expresado como índice parcial para poder
--         convivir con (a).
--
--    IMPORTANTE (documentado para quien mantenga este código): PostgREST/
--    supabase-js NO puede apuntar un upsert(onConflict:"usuario_id,grupo_id")
--    a un índice PARCIAL — Postgres solo infiere el conflicto desde
--    ON CONFLICT (columnas) contra una unique/índice NO parcial en esas
--    columnas exactas. Por eso backend/bot/funciones/pagos/
--    configuracionStickerPago.js y frontend/services/automatizacion/
--    stickerPago.ts YA NO usan upsert() para esta tabla: usan
--    "insertar optimista -> capturar 23505 -> UPDATE" (el mismo patrón que
--    ya usa bot/funciones/usuarios/obtenerUsuarioGlobal.js para "usuarios"
--    y backend/pagos/pagosController.js para pagos_movimientos) — estos
--    índices son los que hacen esa captura de 23505 posible y atómica.
-- ==========================================================================

alter table public.configuracion_stickers_pago
    drop constraint if exists configuracion_stickers_pago_usuario_id_grupo_id_key;

create unique index if not exists configuracion_stickers_pago_predeterminado_unico
    on public.configuracion_stickers_pago (usuario_id)
    where grupo_id is null;

create unique index if not exists configuracion_stickers_pago_especifico_unico
    on public.configuracion_stickers_pago (usuario_id, grupo_id)
    where grupo_id is not null;

-- El índice configuracion_stickers_pago_por_usuario (011) sigue sirviendo
-- tal cual para ambos niveles — no se toca.

-- Las policies de RLS de 011 (auth.uid() = usuario_id, sin distinguir
-- columnas) siguen aplicando sin cambios a ambos niveles.
