-- Fase 1 — Sticker de pago configurable desde el panel (por grupo/tenant).
--
-- Auditoría previa (ver informe en la conversación): no existe ninguna
-- tabla hoy que pueda representar "un hash de sticker autorizado, por
-- grupo/tenant, con un estado de registro pendiente que expira solo".
-- automation_configs.stickers (006_automation_engine.sql) es jsonb, pero
-- está pensada para stickers que el BOT ENVÍA (saliente, por tipo de
-- evento: apertura/actualización/cierre) — este es el caso contrario: un
-- sticker que el BOT RECIBE y usa para autorizar una acción. Mezclarlos en
-- la misma columna confundiría dos conceptos distintos, así que esta fase
-- crea una tabla nueva, dedicada, sin tocar automation_configs.
--
-- No modifica ninguna tabla existente (usuarios, eventos_bot, reservas_*,
-- reservas_actividad, automation_*, grupos_autorizados, sesiones, etc.) ni
-- cambia el sistema de reservas/eventos/pagos. No reemplaza
-- pagos_movimientos ni tiene relación con conciliación bancaria.
--
-- Ejecutar manualmente en el SQL Editor de Supabase (mismo procedimiento
-- que 001-010 — no hay CLI/psql configurado en este proyecto).
--
-- ==========================================================================
-- DECISIONES DE ESQUEMA
-- ==========================================================================
--
-- Clave (usuario_id, grupo_id): EXACTAMENTE el mismo par que ya usan
-- automation_configs y grupos_autorizados — usuario_id es el tenant (dueño
-- del bot, auth.users.id) y grupo_id es el JID de WhatsApp (texto, no FK,
-- mismo criterio documentado en 006 para grupos_autorizados: la tabla
-- "grupos" existente no tiene su esquema confirmado en este repo).
--
-- sticker_sha256: hex de fileSha256 (mismo formato que ya produce
-- backend/bot/funciones/mensajes/extraerDatosSticker.js). Nullable: una
-- fila puede existir en modo "esperando_registro" sin tener todavía ningún
-- sticker guardado.
--
-- esperando_registro / esperando_registro_expira_en: modo temporal de
-- registro solicitado desde el panel. Mismo patrón de expiración corta que
-- sesiones.qr_expira_en (backend/services/baileys/qr.js: 2 minutos) — no
-- se inventa una duración distinta. Vencido, se trata como NO ACTIVO aunque
-- la fila todavía diga esperando_registro=true (el código, no un trigger
-- de SQL, es quien decide "vigente" comparando con now() — mismo criterio
-- que el resto del proyecto, que valida vencimientos en código, no en SQL).
--
-- registrado_por: JID real del administrador que envió el sticker
-- aceptado — mismo criterio de auditoría que reservas_actividad.realizado_por
-- (nunca "bot", nunca anónimo).
--
-- Solo el backend (service role) escribe sticker_sha256/registrado_en/
-- registrado_por/esperando_registro* — el panel (RLS abajo) puede
-- LEER su propia fila siempre, y puede escribir (para activar el modo de
-- registro) sujeto a las mismas policies que automation_configs.
-- ==========================================================================

create table if not exists public.configuracion_stickers_pago (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    grupo_id text not null,

    -- Hex de fileSha256 del sticker autorizado. Null mientras no se haya
    -- registrado ninguno todavía.
    sticker_sha256 text,

    registrado_en timestamptz,

    -- JID real del administrador que confirmó el sticker (nunca "bot").
    registrado_por text,

    esperando_registro boolean not null default false,

    esperando_registro_expira_en timestamptz,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    -- Como máximo una configuración por usuario+grupo (idéntico criterio
    -- que automation_configs y grupos_autorizados).
    unique (usuario_id, grupo_id)

);

create index if not exists configuracion_stickers_pago_por_usuario
    on public.configuracion_stickers_pago (usuario_id);

alter table public.configuracion_stickers_pago enable row level security;

create policy "usuarios ven su propia configuracion de sticker de pago"
    on public.configuracion_stickers_pago for select
    using (auth.uid() = usuario_id);

create policy "usuarios crean su propia configuracion de sticker de pago"
    on public.configuracion_stickers_pago for insert
    with check (auth.uid() = usuario_id);

create policy "usuarios actualizan su propia configuracion de sticker de pago"
    on public.configuracion_stickers_pago for update
    using (auth.uid() = usuario_id);

create policy "usuarios eliminan su propia configuracion de sticker de pago"
    on public.configuracion_stickers_pago for delete
    using (auth.uid() = usuario_id);
