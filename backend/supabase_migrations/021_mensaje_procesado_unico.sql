-- ==========================================================================
-- 021 — UN MENSAJE DE GRUPO SE PROCESA UNA SOLA VEZ (mensajes_grupos_sorteos)
--
-- Contexto: al reconectar / reiniciar / cambiar de sesión, WhatsApp vuelve
-- a entregar mensajes ya procesados. El bot usa la fila de
-- mensajes_grupos_sorteos (que guardarMensajeGrupo inserta ANTES de
-- cualquier acción de negocio) como marca persistente de "ya procesado"
-- (bot/funciones/mensajes/compuertaIngreso.js). Identidad del mensaje:
-- (grupo_id, mensaje_id) = (key.remoteJid, key.id).
--
-- Auditoría de solo lectura (2026-09-30): 45.813 filas, 550 filas
-- repetidas en 520 pares (grupo_id, mensaje_id) — el mismo mensaje
-- registrado dos veces (entregas duplicadas a ~1 s, reintentos con un
-- timestamp unos segundos distinto y reingresos tras reconexión, mediana
-- 129 min). Esas filas históricas NO se tocan aquí: nada se borra.
--
-- Qué hace (idempotente, no destructivo):
--   1. Índice normal (grupo_id, mensaje_id): la consulta "¿ya existe?" que
--      hace el bot antes de procesar cada mensaje de grupo no recorre la
--      tabla completa.
--   2. Índice ÚNICO PARCIAL sobre las filas NUEVAS (id mayor que el máximo
--      actual): desde que se aplica, una segunda inserción del mismo
--      mensaje falla con 23505 y el bot la trata como "ya reclamado" — el
--      reclamo es atómico incluso entre dos procesos (LOCAL y VPS). Parcial
--      para no exigir limpiar antes los duplicados históricos.
--
-- Si más adelante se decide depurar los duplicados históricos, este índice
-- parcial puede reemplazarse por uno único completo — decisión aparte.
--
-- Consulta de inspección (solo lectura) de los duplicados existentes:
--   select grupo_id, mensaje_id, count(*), min(creado_en), max(creado_en)
--   from public.mensajes_grupos_sorteos
--   group by grupo_id, mensaje_id
--   having count(*) > 1
--   order by count(*) desc;
-- ==========================================================================

create index if not exists mensajes_grupos_sorteos_grupo_mensaje_idx
    on public.mensajes_grupos_sorteos (grupo_id, mensaje_id);

do $$
declare
    corte bigint;
begin

    if exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'mensajes_grupos_sorteos_grupo_mensaje_unico_nuevos'
    ) then
        raise notice 'El índice único parcial ya existe — nada que hacer.';
        return;
    end if;

    select coalesce(max(id), 0) into corte from public.mensajes_grupos_sorteos;

    execute format(
        'create unique index mensajes_grupos_sorteos_grupo_mensaje_unico_nuevos
             on public.mensajes_grupos_sorteos (grupo_id, mensaje_id)
             where id > %s',
        corte
    );

    raise notice 'Índice único parcial creado para filas con id > %', corte;

end
$$;
