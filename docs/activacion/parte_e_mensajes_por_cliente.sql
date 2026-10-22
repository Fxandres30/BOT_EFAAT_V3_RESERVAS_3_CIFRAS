-- ==========================================================================
-- PARTE E — DISEÑO (NO APLICADA, NO ES UNA MIGRACIÓN, NO EJECUTAR TODAVÍA)
-- Chats por cliente: mensajes_grupos_sorteos con dueño.
--
-- ⚠️ SUSTITUIDA (2026-10-21) por las migraciones oficiales
--    backend/supabase_migrations/028_mensajes_por_cliente.sql (columna +
--    deduplicación por cliente) y 029_rls_mensajes_por_cliente.sql (RLS con
--    guardias). Usar esas; este archivo queda como registro del diseño.
--
-- HALLAZGO (auditoría 2026-10-21):
--   - mensajes_grupos_sorteos.usuario_id es el PARTICIPANTE de WhatsApp que
--     escribió (bot/funciones/mensajes/guardarMensajeGrupo.js), NO el
--     cliente de EFAAT. La tabla no tiene ninguna columna de cliente.
--   - El panel la lee directo desde el navegador
--     (services/chats/obtenerGruposConversacion.ts, obtenerMensajesGrupo.ts,
--     services/automatizacion/seguimientoProgramacion.ts) sin filtro de
--     cliente: cualquier usuario del panel ve conversaciones, nombres,
--     teléfonos y LID de los grupos de todos. Ni la Parte A ni la C la cubren.
--   - Se guardan mensajes de TODOS los grupos de la sesión que los recibe,
--     no solo de los autorizados: filtrar por grupos_autorizados ocultaría
--     conversaciones legítimas, y un mismo grupo puede tener a dos clientes.
--
-- DUEÑO CORRECTO: el cliente dueño de la SESIÓN que recibió el mensaje
-- (sesiones.usuario_id de ctx.session en bot/handlers/dispatcher.js), nunca
-- el usuario_id del participante.
--
-- PASOS (en este orden; cada uno con autorización):
--   1. Esta migración: columna nueva nullable (no rompe al bot actual, que
--      no la envía).
--   2. Bot: guardarMensajeGrupo recibe clienteUsuarioId = dueño de la
--      sesión receptora (consulta a sesiones por id, con caché) y lo guarda.
--      Despliegue en el VPS.
--   3. Relleno histórico (ver RIESGOS) y verificación de 0 filas recientes
--      sin dueño:  select count(*) from public.mensajes_grupos_sorteos
--                  where cliente_usuario_id is null and creado_en > now() - interval '1 day';
--   4. Recién entonces: el bloque RLS de abajo.
--
-- RIESGOS:
--   - Filas antiguas (≈46.000 en 2026-09) quedan con cliente_usuario_id NULL
--     y la RLS las OCULTA a todos los clientes (el bot no se ve afectado).
--     Relleno posible solo si se sabe qué sesión las recibió: hoy no hay
--     columna de sesión. Si TODAS las sesiones históricas son de un único
--     cliente, se puede rellenar con ese usuario_id (verificar antes con
--     select distinct usuario_id from public.sesiones). Si no, dejar NULL.
--   - Duplicados (migración 021): el índice único (grupo_id, mensaje_id)
--     supone UNA sesión por grupo. Si en el futuro dos clientes tienen su bot
--     en el mismo grupo, el segundo mensaje se descartaría como duplicado;
--     habrá que incluir cliente_usuario_id en la clave (ligado a la fase de
--     sesiones activas por usuario, fuera de este alcance).
--   - El panel tiene que dejar de mezclar grupos: con la RLS activa ya no
--     hace falta filtro adicional, pero conviene añadir
--     .eq("cliente_usuario_id", <usuario de la sesión>) por claridad.
-- ==========================================================================

begin;

alter table public.mensajes_grupos_sorteos
    add column if not exists cliente_usuario_id uuid;

create index if not exists mensajes_grupos_sorteos_cliente_grupo_idx
    on public.mensajes_grupos_sorteos (cliente_usuario_id, grupo_id, timestamp_whatsapp desc);

commit;

-- ---------------------------------------------- PASO 4 (más adelante) ---
-- begin;
-- do $$
-- declare ajenas text;
-- begin
--     select string_agg(format('"%s" (%s, roles %s)', policyname, cmd, array_to_string(roles, ',')), '; ')
--       into ajenas
--     from pg_policies
--     where schemaname = 'public' and tablename = 'mensajes_grupos_sorteos'
--       and policyname <> 'panel lee los chats de su bot';
--     if ajenas is not null then
--         raise exception 'Parte E abortada: hay políticas RLS no previstas: %', ajenas;
--     end if;
-- end $$;
-- alter table public.mensajes_grupos_sorteos enable row level security;
-- drop policy if exists "panel lee los chats de su bot" on public.mensajes_grupos_sorteos;
-- create policy "panel lee los chats de su bot" on public.mensajes_grupos_sorteos
--     for select to authenticated using (cliente_usuario_id = auth.uid());
-- revoke all on table public.mensajes_grupos_sorteos from anon;
-- revoke insert, update, delete on table public.mensajes_grupos_sorteos from authenticated;
-- commit;
--
-- VUELTA ATRÁS del paso 4:
--   alter table public.mensajes_grupos_sorteos disable row level security;
--   + restaurar los privilegios guardados antes (role_table_grants).
-- ==========================================================================
