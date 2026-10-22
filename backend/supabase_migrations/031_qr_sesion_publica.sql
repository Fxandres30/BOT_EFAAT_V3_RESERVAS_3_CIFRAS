-- ==========================================================================
-- 031 — QR DE UNA SESIÓN PARA EL ENLACE «COMPARTIR» (/conectar/<id>)
--
-- PREPARADA EL 2026-10-21. NO APLICADA. Requiere autorización expresa.
--
-- La página /conectar/<id> (frontend/app/conectar/[id]/page.tsx) la abre
-- quien escanea el QR, normalmente SIN sesión en el panel. Hoy lee la fila
-- de `sesiones` con la clave anon, y la Parte A (retirar anon de sesiones)
-- la dejaría sin datos.
--
-- Esta función devuelve SOLO qr, estado y qr_expira_en de UNA sesión,
-- conociendo su id (el mismo dato que ya lleva el enlace). No lista
-- sesiones, no devuelve teléfono, nombre, usuario_id ni ningún otro campo,
-- y no escribe nada. La página la usa si existe y, si no, sigue con la
-- lectura de siempre: se puede aplicar ANTES que la Parte A sin cambiar nada.
--
-- Orden: 031 -> desplegar el panel (ya la usa) -> comprobar el enlace ->
-- Parte A. Idempotente. Una transacción. Ejecutar manualmente.
-- ==========================================================================

begin;

create or replace function public.qr_sesion_publica(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object('qr', s.qr, 'estado', s.estado, 'qr_expira_en', s.qr_expira_en)
    from public.sesiones s
    where s.id::text = p_id
    limit 1
$$;

revoke all on function public.qr_sesion_publica(text) from public;
grant execute on function public.qr_sesion_publica(text) to anon, authenticated, service_role;

commit;

-- ==========================================================================
-- Verificación (solo lectura):
--   select public.qr_sesion_publica('<id de una sesión>');      -- {qr, estado, qr_expira_en}
--   select public.qr_sesion_publica('no-existe');               -- null
--   select has_function_privilege('anon', 'public.qr_sesion_publica(text)', 'execute');  -- true
--
-- Reversión:
--   drop function if exists public.qr_sesion_publica(text);
--   (la página vuelve sola a la lectura directa; tras la Parte A, sin QR)
-- ==========================================================================
