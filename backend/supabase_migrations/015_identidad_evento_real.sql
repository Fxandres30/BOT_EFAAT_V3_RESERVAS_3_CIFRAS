-- Fase Identidad Real + Eventos/Tablas compartidas (2026-09-13).
--
-- PROBLEMA ENCONTRADO (auditoría, verificado contra el Supabase real del
-- proyecto): el mismo sorteo real anunciado en varios grupos de WhatsApp
-- genera una fila de eventos_bot POR GRUPO (eventos_bot ya se busca/crea por
-- grupo_id — ver bot/funciones/eventos/consultarEvento.js/guardarEvento.js,
-- sin cambios). La tabla física de reservas (reservas_dos_cifras /
-- "5k_15k_reservas_2_cifras") es compartida por RANGO DE PRECIO, global a
-- todo el sistema (bot/funciones/eventos/configEvento.js) — ninguna consulta
-- existente la aislaba por evento ni por tenant (usuario_id), solo por
-- número/estado. Verificado con datos reales: 4 eventos_bot.id distintos
-- con reservas activas AL MISMO TIEMPO en la misma tabla física de 100
-- filas -- hoy no se manifiesta como fuga entre negocios porque solo hay 1
-- tenant activo, pero la tabla no tiene ningún aislamiento estructural.
--
-- SOLUCIÓN: una columna nueva, identidad_evento_real (texto, hash sha256 de
-- usuario_id+nombre_evento+hora_fin+valor+fecha_evento — ver
-- bot/funciones/eventos/identidadEventoReal.js), que:
--   - es la MISMA para eventos_bot de distintos grupos que son el mismo
--     sorteo real (permite seguir compartiendo la tabla física entre esos
--     grupos, que ya ocurría por accidente de diseño),
--   - es DISTINTA para cualquier otro evento/tenant que use la misma tabla
--     física por coincidir en rango de precio (aísla correctamente).
--
-- NO se toca event_sessions.identidad_ciclo (esa SÍ debe seguir incluyendo
-- grupo_id -- cada grupo necesita su propio envío de recordatorios/tabla
-- inicial/cierre, eso ya es correcto). NO se fusionan filas de eventos_bot
-- ni se borra nada. NO se crea ninguna tabla nueva.
--
-- Ejecutar manualmente en el SQL Editor de Supabase, como todas las
-- anteriores, EN ESTE ORDEN (agregar columnas -> rellenar datos existentes
-- -> recién después desplegar el código que empieza a filtrar por esta
-- columna, para que ningún dato activo quede momentáneamente "invisible").

create extension if not exists pgcrypto;

-- ==========================================================================
-- 1) Columnas nuevas, nullable -- no cambia ninguna fila existente todavía.
-- ==========================================================================

alter table public.eventos_bot
    add column if not exists identidad_evento_real text;

alter table public.reservas_dos_cifras
    add column if not exists identidad_evento_real text;

alter table public."5k_15k_reservas_2_cifras"
    add column if not exists identidad_evento_real text;

-- ==========================================================================
-- 2) Backfill de eventos_bot -- mismo algoritmo exacto que
--    identidadEventoReal.js (sha256 hex de los 5 campos unidos con "|",
--    cadena vacía para NULL). Solo rellena filas que todavía no lo tienen
--    (repetible sin efecto si se corre dos veces).
-- ==========================================================================

update public.eventos_bot
set identidad_evento_real = encode(
    digest(
        coalesce(usuario_id::text, '') || '|' ||
        coalesce(nombre_evento, '') || '|' ||
        coalesce(hora_fin, '') || '|' ||
        coalesce(valor::text, '') || '|' ||
        coalesce(fecha_evento::text, ''),
        'sha256'
    ),
    'hex'
)
where identidad_evento_real is null;

-- ==========================================================================
-- 3) Backfill de las tablas físicas de reservas -- SOLO filas no-libres
--    (una reserva/pago real), enlazadas por el evento_id que reservarNumeros
--    ya escribe en cada fila desde siempre. Números libres no necesitan
--    identidad todavía: la obtienen la próxima vez que alguien los reserve
--    (reservarNumeros.js ya la escribe desde este cambio).
-- ==========================================================================

update public."5k_15k_reservas_2_cifras" r
set identidad_evento_real = e.identidad_evento_real
from public.eventos_bot e
where r.evento_id = e.id
  and r.identidad_evento_real is null
  and r.estado <> 'libre';

update public.reservas_dos_cifras r
set identidad_evento_real = e.identidad_evento_real
from public.eventos_bot e
where r.evento_id = e.id
  and r.identidad_evento_real is null
  and r.estado <> 'libre';
