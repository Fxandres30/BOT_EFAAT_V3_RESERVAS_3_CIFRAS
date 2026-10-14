-- ==========================================================================
-- PARTE C (NO APLICADA, NO ES UNA MIGRACIÓN) — tablas heredadas que la
-- clave anon (pública, va en el JavaScript del panel) lee SIN sesión.
--
-- HALLAZGO (2026-10-14, solo lectura: HEAD + count, sin descargar filas).
-- Además de las 5 tablas de las Partes A y B, anon lee estas, con datos
-- personales (teléfonos, nombres, correos, IP, mensajes):
--
--   administradores 141 · bloqueados_legado 15 · boletos 10000 (email,
--   teléfono) · clientes_contador 1494 · export_numeros 1000 ·
--   extra_2_cifras 100 · grupo_miembros 166 (phone, lid) ·
--   integrantes_antiguos 67 · messages 4677 (teléfono + texto) ·
--   nuevos_miembros 4 · numeros_gratis 10000 · numeros_tres_cifras 1000
--   (ip) · pedidos 34 (correo, comprobante) · prohibidos 1 ·
--   registro_usuarios 275 (IP, ubicación, dispositivo) ·
--   reservas_2_cifras_1000/5000 100+100 · reservas_dos_cifras_test 100 ·
--   semanales20k 100 · usuarios_grupo_test 1
--   (+ reservas_2_cifras_2000/3000/4000/10000, hoy vacías)
--
-- NINGÚN archivo de este repositorio (bot ni panel) usa estas tablas. El bot
-- (service_role) ni siquiera tiene permiso sobre la mayoría (403).
--
-- ⚠️ RIESGO: pueden usarlas aplicaciones FUERA de este repositorio con la
-- clave anon (la web antigua de boletos/pedidos, BANN, otra herramienta).
-- Quitar el acceso las rompería. Hay indicios de un escritor externo en las
-- tablas de reservas (ver docs/activacion/reservas_otro_sorteo.md). Antes de
-- aplicar, confirma que no hay ninguna aplicación viva que las use, o mira
-- en Supabase → Logs → API las peticiones con rol anon a estas tablas en los
-- últimos días.
--
-- NO incluidas (sin datos personales, parecen de otra aplicación —
-- trading/sorteos web): estrategias, operaciones, strategy_stats, sorteos.
-- Decide aparte.
--
-- Solo quita privilegios a anon. No borra, no cambia datos, no toca
-- authenticated ni service_role. Las tablas que no existan se omiten.
-- ==========================================================================

-- ANTES (solo lectura) — guarda el resultado: es la vuelta atrás exacta.
--   select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee = 'anon'
--     and table_name in ('administradores','bloqueados_legado','boletos','clientes_contador',
--       'export_numeros','extra_2_cifras','grupo_miembros','integrantes_antiguos','messages',
--       'nuevos_miembros','numeros_gratis','numeros_tres_cifras','pedidos','prohibidos',
--       'registro_usuarios','reservas_2_cifras_1000','reservas_2_cifras_2000',
--       'reservas_2_cifras_3000','reservas_2_cifras_4000','reservas_2_cifras_5000',
--       'reservas_2_cifras_10000','reservas_dos_cifras_test','semanales20k','usuarios_grupo_test')
--   group by 1 order by 1;

-- --------------------------------------------------------------- C1 ---
begin;

do $$
declare
    t text;
begin
    foreach t in array array[
        'administradores', 'bloqueados_legado', 'boletos', 'clientes_contador',
        'export_numeros', 'extra_2_cifras', 'grupo_miembros', 'integrantes_antiguos',
        'messages', 'nuevos_miembros', 'numeros_gratis', 'numeros_tres_cifras',
        'pedidos', 'prohibidos', 'registro_usuarios',
        'reservas_2_cifras_1000', 'reservas_2_cifras_2000', 'reservas_2_cifras_3000',
        'reservas_2_cifras_4000', 'reservas_2_cifras_5000', 'reservas_2_cifras_10000',
        'reservas_dos_cifras_test', 'semanales20k', 'usuarios_grupo_test'
    ] loop
        if to_regclass(format('public.%I', t)) is null then
            raise notice 'Tabla % no existe: se omite.', t;
            continue;
        end if;
        execute format('revoke all on table public.%I from anon', t);
    end loop;
end $$;

commit;

-- --------------------------------------------------------------- C2 ---
-- (Opcional) Funciones RPC heredadas que anon puede invocar y que escriben
-- en tablas de clientes. Ningún código del repositorio las llama. Mismo
-- riesgo que C1 si una aplicación externa las usa.
begin;

do $$
declare
    f regprocedure;
begin
    for f in
        select p.oid::regprocedure
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('sumar_entregados_tres_cifras', 'asignar_numeros_gratis',
                            'asignar_boletos_seguro', 'incrementar_veces_preguntada')
    loop
        execute format('revoke execute on function %s from public, anon', f);
        raise notice 'C2: % ya no es ejecutable por anon', f;
    end loop;
end $$;

commit;

-- ==========================================================================
-- DESPUÉS: con la clave anon y sin sesión, cada tabla de C1 responde
-- 401/403 (GET /rest/v1/<tabla>?select=id&limit=1). El bot y el panel no
-- cambian (no las usan).
--
-- VUELTA ATRÁS:
--   C1: por cada fila guardada en ANTES:
--         grant <privilegios> on table public."<tabla>" to anon;
--       (el valor por defecto de Supabase es: grant all on table ... to anon;)
--   C2: grant execute on function <firma> to anon;  -- firma de los NOTICE
-- ==========================================================================
