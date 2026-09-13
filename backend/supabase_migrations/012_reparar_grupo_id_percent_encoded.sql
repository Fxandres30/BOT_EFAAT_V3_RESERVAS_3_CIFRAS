-- Reparación de datos — grupo_id guardado percent-encoded en vez del JID
-- real. Verificado contra el Supabase real del proyecto (auditoría
-- 2026-09-12, consulta directa, no asumido) en 3 tablas:
--
--   automation_configs, grupos_autorizados, configuracion_stickers_pago
--
-- ORIGEN DEL BUG (backend/frontend NO involucrados salvo el punto exacto
-- de abajo): la página de detalle de grupo
-- (frontend/app/automatizacion/grupos/[grupoId]/page.tsx ->
-- frontend/components/automatizacion/ConfiguracionGrupo/ConfiguracionGrupo.tsx)
-- usaba el segmento de ruta [grupoId] SIN decodificar antes de:
--   - compararlo contra los grupos reales (siempre falla el match),
--   - guardarlo en automation_configs / grupos_autorizados / (después,
--     Fase 1/2) configuracion_stickers_pago.
-- El "@" de un JID real viaja como "%40" en una URL; al no decodificarlo,
-- ese texto crudo terminó persistido tal cual. Backend
-- (sessionsController.js:gruposDisponibles, sincronizarGrupo.js) SIEMPRE
-- usó el JID real (metadata.id) correctamente — el bug era exclusivo de
-- ese punto del frontend, ya corregido en el mismo cambio que trae esta
-- migración (se aplica normalizarGrupoId() al entrar por la URL, antes de
-- usar el valor para cualquier cosa).
--
-- Se encontraron 2 variantes de corrupción, según cuántas veces pasó el
-- valor por encodeURIComponent() antes de guardarse:
--   "...%40g.us"     -> codificado una vez  ("@" -> "%40")
--   "...%2540g.us"   -> codificado dos veces ("%" -> "%25", entonces
--                        "%40" -> "%2540")
--
-- REPARACIÓN:
--   configuracion_stickers_pago: 1 sola fila, corrupta, SIN duplicado
--     -> UPDATE directo, no hace falta borrar nada.
--   grupos_autorizados y automation_configs: el bug generó FILAS
--     DUPLICADAS para el mismo (usuario_id, grupo real) — una variante
--     de encoding por cada vez que el panel volvió a guardar. Reparar
--     las 3 variantes al mismo valor de una vez violaría
--     unique(usuario_id, grupo_id) (006_automation_engine.sql). Se usan
--     los ids reales encontrados en la auditoría (usuario_id
--     2491cbd0-5fb5-4cef-a06d-6092e69d40c4, único tenant afectado —
--     verificado, ambas tablas tienen solo 2-3 filas en total hoy):
--
--     grupos_autorizados: ya existe la fila correcta
--       (a3b8ecaa-7be5-4192-a82b-567f2b1350ed, activo=true, la más
--       antigua) -> se conserva intacta. Se eliminan los 2 duplicados
--       corruptos (1e069172-..., e54c7081-...), ambos activo=false, sin
--       ningún dato que la fila correcta no tenga ya.
--
--     automation_configs: NINGUNA fila tenía todavía el grupo_id
--       correcto. Se conserva la fila con configuración real
--       (9206353b-..., activo=true, la más antigua) reparando su
--       grupo_id, y se elimina el duplicado vacío/posterior
--       (f6d1c003-..., activo=false — mismo patrón que un registro con
--       la configuración por defecto, nunca editado).
--
-- Si en otro entorno existieran más filas corruptas sin duplicado (otro
-- tenant, por ejemplo), el UPDATE genérico de más abajo las repara igual
-- — la eliminación de duplicados de esta migración es específica de los
-- ids encontrados en ESTE Supabase; no borra nada fuera de esa lista.
--
-- Ejecutar manualmente en el SQL Editor de Supabase, como todas las
-- anteriores. No hace DROP de ninguna tabla ni columna.

-- ==========================================================================
-- 1) Reparación genérica (cualquier tenant): un JID real de WhatsApp NUNCA
--    contiene "%" (mismo criterio ya documentado en
--    frontend/services/automatizacion/mergeGrupos.ts) — si aparece, es
--    percent-encoding accidental. Colapsa hasta doble-encoding.
-- ==========================================================================

update public.configuracion_stickers_pago
set grupo_id = replace(replace(grupo_id, '%2540', '%40'), '%40', '@')
where grupo_id is not null
  and position('%' in grupo_id) > 0;

-- ==========================================================================
-- 2) grupos_autorizados — eliminar los 2 duplicados corruptos conocidos
--    (la fila correcta para ese mismo usuario_id+grupo ya existe).
-- ==========================================================================

delete from public.grupos_autorizados
where id in (
    '1e069172-377a-4865-a92d-cd12e84f2e9b',
    'e54c7081-c586-44a3-afab-f32cfe37acbd'
);

-- ==========================================================================
-- 3) automation_configs — eliminar el duplicado vacío conocido y reparar
--    el grupo_id de la fila con la configuración real.
-- ==========================================================================

delete from public.automation_configs
where id = 'f6d1c003-e938-48c1-aa32-2a2e0335dff9';

update public.automation_configs
set grupo_id = replace(replace(grupo_id, '%2540', '%40'), '%40', '@')
where id = '9206353b-30d0-49e8-b133-6bac1a2b02d2';
