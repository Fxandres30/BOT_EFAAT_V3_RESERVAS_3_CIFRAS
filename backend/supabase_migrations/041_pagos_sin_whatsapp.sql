-- ==========================================================================
-- 041 — PAGOS SIN WHATSAPP: el pago se guarda aunque el comprador no tenga
-- teléfono; solo se omite su copia a compradores_semanales.
--
-- PREPARADA EL 2026-10-31. NO APLICADA. Requiere autorización expresa.
-- Sustituye al bloque B1 de docs/activacion/parte_b_compradores_semanales.sql
-- (ese bloque ya no existe; si B1 se hubiera aplicado a mano, esta migración
-- lo retira y deja una sola protección).
--
-- PROBLEMA (producción, diagnosticado el 2026-10-14 y el 2026-10-22):
--   1. Las tablas de reservas (reservas_dos_cifras y
--      5k_15k_reservas_2_cifras) tienen un trigger heredado AFTER UPDATE de
--      fila que ejecuta public.actualizar_compradores_semanales() (security
--      invoker; md5(prosrc) en producción = cceca089f72b33a12832eaf6c9f438c5).
--   2. Cuando estado pasa a 'pagado', esa función copia el comprador a
--      public.compradores_semanales usando el teléfono de la reserva como
--      whatsapp.
--   3. compradores_semanales.whatsapp es text NOT NULL. Si la reserva no
--      tiene teléfono (cliente solo LID, sin JID, sin contacto o con datos
--      incompletos), Postgres lanza 23502 (not_null_violation) y REVIERTE el
--      UPDATE entero: el pago no se guarda y el número sigue 'reservado'.
--      El backend lo informa como «pago_sin_telefono» (reservaManual.js,
--      marcarReservasPagadasPorAdmin.js); el código de la aplicación no exige
--      ningún dato de contacto para pagar.
--
-- POR QUÉ NO SE REESCRIBE actualizar_compradores_semanales():
--   su código NO está en el repositorio (solo su md5). Reescribirla a ciegas
--   podría cambiar los contadores de quienes sí tienen teléfono, y además
--   rompería las guardias de la Parte B2 y de la 034, que exigen ese md5
--   exacto. La corrección se pone en el único punto que falla y que sí
--   conocemos: la escritura en compradores_semanales.
--
-- QUÉ HACE (una transacción; si una guardia falla no cambia nada):
--   - Función public.efaat_compradores_omitir_sin_whatsapp() y trigger
--     BEFORE INSERT OR UPDATE de fila en compradores_semanales:
--       INSERT con whatsapp NO válido  -> la fila no se inserta (return null),
--                                         sin error: también con
--                                         INSERT ... ON CONFLICT.
--       UPDATE que dejaría whatsapp NULL -> esa fila no se modifica.
--       Todo lo demás                  -> exactamente igual que hoy.
--     whatsapp válido = sin '@' (no es un JID ni un LID) y con 7 a 15 dígitos
--     (mismo criterio que normalizarTelefono del backend). NULL, vacío,
--     espacios, «x@lid» o «x@s.whatsapp.net» no son válidos.
--   - Retira el trigger/función de B1 si se aplicaron a mano.
--   - No toca las tablas de reservas, la función heredada, sus permisos, la
--     columna NOT NULL ni ningún dato existente. No inventa teléfonos.
--
-- RESULTADO ESPERADO:
--   - Pago (sticker o panel, uno o en lote) de una reserva sin teléfono:
--     queda 'pagado' con su fecha/hora de pago; no suma en
--     compradores_semanales (no hay con qué identificar al comprador).
--   - Pago con teléfono válido: igual que hoy (suma en su fila o la crea).
--   - Pagos parciales y completos: por número, como siempre.
--
-- COMPATIBILIDAD:
--   - Parte B2: solo cuenta funciones de trigger de las tablas de RESERVAS;
--     esta va en compradores_semanales: no cambia su conteo ni el md5.
--   - 034: su trigger "000_efaat_cliente" (BEFORE INSERT OR UPDATE en
--     compradores_semanales) y este son independientes; si cualquiera de los
--     dos omite la fila, no se escribe. Sus guardias miran solo las tablas
--     de reservas.
--   - Idempotente: se puede ejecutar varias veces.
--
-- PRUEBAS (Postgres real en memoria, no toca ninguna base remota):
--   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
--       node backend/tests/seguridad/migracion041.test.js
--
-- DESPUÉS (solo lectura):
--   select tgname, tgenabled from pg_trigger
--   where tgrelid = 'public.compradores_semanales'::regclass and not tgisinternal;
--   -> efaat_omitir_sin_whatsapp | O   (y ya no omitir_sin_whatsapp)
--   Prueba real: el siguiente pago de un cliente solo LID queda 'pagado'
--   (log sin «Pago NO guardado» / sin «pago_sin_telefono»).
--
-- VUELTA ATRÁS (vuelve el error 23502 para pagos sin teléfono):
--   begin;
--   drop trigger if exists efaat_omitir_sin_whatsapp on public.compradores_semanales;
--   drop function if exists public.efaat_compradores_omitir_sin_whatsapp();
--   commit;
-- ==========================================================================

begin;

set local lock_timeout = '5s';

do $$
begin

    if to_regclass('public.compradores_semanales') is null then
        raise exception '041 abortada: no existe public.compradores_semanales (revisar a mano)';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'compradores_semanales' and column_name = 'whatsapp'
    ) then
        raise exception '041 abortada: compradores_semanales no tiene la columna whatsapp (revisar a mano)';
    end if;

end $$;

create or replace function public.efaat_compradores_omitir_sin_whatsapp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin

    if tg_op = 'INSERT' then

        if new.whatsapp is null
           or position('@' in new.whatsapp) > 0
           or regexp_replace(new.whatsapp, '\D', '', 'g') !~ '^\d{7,15}$' then
            -- Sin datos personales en el log.
            raise warning 'compradores_semanales: compra omitida, comprador sin WhatsApp válido';
            return null;
        end if;

        return new;

    end if;

    -- UPDATE: nunca dejar whatsapp NULL (abortaría el pago entero).
    if new.whatsapp is null then
        raise warning 'compradores_semanales: actualización omitida, dejaría whatsapp vacío';
        return null;
    end if;

    return new;

end;
$$;

revoke all on function public.efaat_compradores_omitir_sin_whatsapp() from public, anon, authenticated;

-- B1 aplicado a mano (bloque retirado de parte_b_compradores_semanales.sql).
drop trigger if exists omitir_sin_whatsapp on public.compradores_semanales;
drop function if exists public.compradores_semanales_omitir_sin_whatsapp();

drop trigger if exists efaat_omitir_sin_whatsapp on public.compradores_semanales;
create trigger efaat_omitir_sin_whatsapp
    before insert or update on public.compradores_semanales
    for each row execute function public.efaat_compradores_omitir_sin_whatsapp();

do $$
begin
    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.compradores_semanales'::regclass
          and tgname = 'efaat_omitir_sin_whatsapp' and tgenabled = 'O'
    ) then
        raise exception '041 abortada: el trigger efaat_omitir_sin_whatsapp no quedó activo';
    end if;
end $$;

commit;
