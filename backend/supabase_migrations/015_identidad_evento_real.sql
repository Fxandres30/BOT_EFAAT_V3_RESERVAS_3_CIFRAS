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
--
-- CORREGIDA el 2026-09-13 (todavía no se había aplicado): se agregó la
-- salvaguarda de la sección 3 tras auditar datos reales y encontrar una
-- reserva huérfana de un ciclo antiguo que la versión anterior habría
-- etiquetado mal. NO se creó una migración nueva -- esta sigue siendo
-- 015, corregida en el mismo archivo, con un único camino de aplicación.

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
--
--    SALVAGUARDA (encontrada auditando datos reales, 2026-09-13): eventos_bot
--    reutiliza la MISMA fila (UPDATE, no INSERT) entre sorteos distintos del
--    mismo grupo con el paso del tiempo. Si una reserva quedó sin resetear
--    de un ciclo VIEJO (p. ej. "5k_15k_reservas_2_cifras".numero=23, creada
--    2026-06-20, evento_id apuntando a una fila de eventos_bot que HOY ya es
--    un sorteo distinto con OTRO precio -> tabla física "reservas_dos_cifras"),
--    su evento_id coincide por accidente con una fila de eventos_bot cuyo
--    .tabla actual YA NO ES esta tabla física. Reasignarle la identidad
--    ACTUAL de esa fila sería fusionar datos ambiguos de ciclos distintos
--    (prohibido explícitamente). Por eso cada UPDATE exige ADEMÁS que
--    eventos_bot.tabla coincida con la tabla física que se está rellenando
--    -- así una reserva huérfana de un ciclo anterior queda con
--    identidad_evento_real NULL (visible igual en disponibilidad/consultas,
--    nunca oculta -- ver los "fail-open" en el código) en vez de mal
--    etiquetada.
-- ==========================================================================

update public."5k_15k_reservas_2_cifras" r
set identidad_evento_real = e.identidad_evento_real
from public.eventos_bot e
where r.evento_id = e.id
  and e.tabla = '5k_15k_reservas_2_cifras'
  and r.identidad_evento_real is null
  and r.estado <> 'libre';

update public.reservas_dos_cifras r
set identidad_evento_real = e.identidad_evento_real
from public.eventos_bot e
where r.evento_id = e.id
  and e.tabla = 'reservas_dos_cifras'
  and r.identidad_evento_real is null
  and r.estado <> 'libre';
