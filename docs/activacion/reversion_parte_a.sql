-- ==========================================================================
-- REVERSIÓN DE LA PARTE A (NO APLICADA). Preparada el 2026-10-22.
--
-- Solo si, tras la Parte A, el panel deja de funcionar y no se puede
-- corregir de otro modo. Antes, descartar las causas que NO se arreglan
-- revirtiendo:
--   - el bot falla: casi seguro su clave no es service_role
--     (node backend/scripts/verificarRolSupabase.js). La RLS no le afecta;
--   - /conectar sin QR: falta la 031 o el panel nuevo (usa qr_sesion_publica).
--
-- Por qué no basta un "disable row level security": authenticated conserva
-- SELECT/UPDATE en las 4 tablas, así que cualquier cliente con cuenta
-- (también una prueba gratuita) leería y cambiaría las reservas, sorteos y
-- sesiones de TODOS. Esta reversión:
--   - nunca concede nada a anon ni a PUBLIC ni recrea políticas abiertas;
--   - si en auth.users hay MÁS DE UNA cuenta, además de quitar la RLS retira
--     a authenticated el acceso directo a las 4 tablas: el panel deja de
--     ver Tablas/Eventos/Sesiones (falla cerrado) pero nadie ve lo ajeno. El
--     bot (service_role) sigue funcionando igual;
--   - si solo existe una cuenta, conserva los permisos de authenticated (no
--     hay a quién exponer nada);
--   - guarda lo que hace en efaat_admin.cambios_seguridad.
-- Para volver a la Parte A después: reejecutar propuesta_rls_tablas_antiguas.sql
-- (vuelve a conceder a authenticated lo que tenía, según su estado previo).
-- ==========================================================================

begin;

set local lock_timeout = '5s';

do $$
declare
    t text;
    cuentas bigint;
    modo text;
begin
    if to_regclass('efaat_admin.cambios_seguridad') is null
       or not exists (select 1 from efaat_admin.cambios_seguridad where paso = 'parte_a' and accion = 'estado_previo') then
        raise exception 'Reversión abortada: no consta la Parte A aplicada (falta su estado previo)';
    end if;

    select count(*) into cuentas from auth.users;
    modo := case when cuentas > 1 then 'panel_sin_acceso_directo' else 'una_sola_cuenta' end;

    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop
        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        values ('reversion_parte_a', t, 'estado_previo', jsonb_build_object(
            'modo', modo, 'cuentas', cuentas,
            'acl', coalesce((select relacl::text from pg_class where oid = to_regclass(format('public.%I', t))), '(por defecto)'),
            -- Lo que pierde authenticated: la Parte A lo devuelve si se reaplica.
            'efectivos', jsonb_build_object('authenticated', jsonb_build_object(
                'SELECT', has_table_privilege('authenticated', format('public.%I', t), 'SELECT'),
                'INSERT', has_table_privilege('authenticated', format('public.%I', t), 'INSERT'),
                'UPDATE', has_table_privilege('authenticated', format('public.%I', t), 'UPDATE'),
                'DELETE', has_table_privilege('authenticated', format('public.%I', t), 'DELETE')))));

        if modo = 'panel_sin_acceso_directo' then
            execute format('revoke all on table public.%I from authenticated', t);
        end if;
        execute format('alter table public.%I disable row level security', t);
    end loop;

    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones'] loop
        if has_table_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE') then
            raise exception 'Reversión abortada: anon tendría acceso a %', t;
        end if;
        if modo = 'panel_sin_acceso_directo'
           and has_table_privilege('authenticated', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE') then
            raise exception 'Reversión abortada: authenticated conserva acceso a % sin RLS (¿hereda de otro rol?)', t;
        end if;
    end loop;

    raise notice 'Reversión de la Parte A aplicada en modo %', modo;
end $$;

commit;

-- DESPUÉS: con la clave anon, permiso denegado en las 4 tablas. Con una
-- cuenta de cliente: permiso denegado (modo panel_sin_acceso_directo) o solo
-- sus filas visibles en el panel por su filtro (modo una_sola_cuenta).
-- ==========================================================================
