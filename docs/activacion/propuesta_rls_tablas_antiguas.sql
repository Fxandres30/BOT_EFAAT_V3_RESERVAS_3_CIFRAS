-- ==========================================================================
-- PROPUESTA (NO APLICADA, NO ES UNA MIGRACIÓN) — cerrar la lectura anónima
-- de datos de clientes en las tablas antiguas.
--
-- HALLAZGO REAL (auditoría de solo lectura, 2026-10-14): con la clave
-- pública "anon" del panel (va dentro del JavaScript del navegador) y SIN
-- iniciar sesión se pueden leer:
--   reservas_dos_cifras / 5k_15k_reservas_2_cifras  100 + 100 filas, con
--       comprador, nombre, telefono, contacto y lid de los clientes.
--   compradores_semanales                            1929 filas con nombre
--       y WhatsApp.
--   sesiones                                         3 filas (id de sesión,
--       usuario_id del cliente, teléfono del bot).
--   eventos_bot                                      4 filas (grupos,
--       teléfono del bot, sesión).
--
-- QUIÉN USA ESTAS TABLAS (verificado en el código):
--   - El BOT usa service_role: ignora RLS -> no le afecta nada de esto.
--   - El PANEL las usa con la sesión del usuario (rol authenticated) y SIEMPRE
--     filtra por usuario_id = usuario de la sesión:
--       eventos_bot   -> solo lectura (services/eventos, services/tablas)
--       reservas_*    -> lectura, realtime y escritura (services/tablas/*)
--       sesiones      -> lectura, realtime, alta, edición y baja
--   - Nadie del panel usa compradores_semanales.
--
-- PARTE A (propuesta segura): RLS "solo filas propias" para authenticated
-- en las 4 tablas que usa el panel + nada para anon. Probada en Postgres
-- real en memoria: backend/tests/sorteos/propuestaRls.test.js.
--
-- PARTE B (archivo aparte: parte_b_compradores_semanales.sql) y PARTE C
-- (parte_c_tablas_legado.sql, otras ~20 tablas heredadas que anon lee).
--
-- Antecedente de la Parte B: compradores_semanales. Un TRIGGER heredado la
-- escribe al pasar una reserva a 'pagado' (ver migración 016) y
-- probablemente se ejecuta con el rol de quien paga (el panel = authenticated).
-- Quitarle permisos o activar RLS sin conocer ese trigger podría hacer
-- FALLAR los pagos desde el panel. Antes hay que ejecutar (solo lectura):
--
--   select t.tgname, c.relname, p.proname, p.prosecdef as security_definer,
--          pg_get_functiondef(p.oid) as definicion
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
--   where c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras') and not t.tgisinternal;
--
-- ANTES DE APLICAR LA PARTE A (solo lectura) — debe devolver 0 filas en
-- cada tabla; si no, NO aplicar (habría filas que el panel dejaría de ver):
--   select 'reservas_dos_cifras' t, count(*) from public.reservas_dos_cifras where usuario_id is null
--   union all select '5k_15k', count(*) from public."5k_15k_reservas_2_cifras" where usuario_id is null
--   union all select 'eventos_bot', count(*) from public.eventos_bot where usuario_id is null
--   union all select 'sesiones', count(*) from public.sesiones where usuario_id is null;
--   (Auditoría 2026-10-14: 0, 0, 0, 0.)
--
-- Y guardar las políticas actuales para poder volver atrás:
--   select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies where tablename in ('eventos_bot','reservas_dos_cifras','5k_15k_reservas_2_cifras','sesiones');
--   select relname, relrowsecurity from pg_class
--   where relname in ('eventos_bot','reservas_dos_cifras','5k_15k_reservas_2_cifras','sesiones');
--
-- ⚠️ Si esa consulta muestra políticas PERMISIVAS ya existentes (p. ej.
-- "using (true)" o para el rol public/anon), las de abajo NO bastan: en
-- Postgres las políticas permisivas se combinan con OR. Hay que revisarlas
-- y eliminarlas (drop policy "<nombre>" on ...) dentro de esta misma
-- transacción. Que hoy anon lea todo indica RLS desactivado o una política
-- abierta de ese tipo.
-- ==========================================================================

begin;

-- -------------------------------------------- guardia: políticas ajenas ---
-- Las políticas permisivas se combinan con OR: una política abierta que ya
-- exista anularía las de abajo. Si hay CUALQUIER política distinta de las de
-- esta propuesta, se aborta la transacción entera (no se aplica nada) y se
-- muestra cuáles son, para revisarlas y añadir su DROP POLICY aquí.
do $$
declare
    ajenas text;
begin
    select string_agg(format('%s."%s" (%s, roles %s, using %s)', tablename, policyname, cmd, array_to_string(roles, ','), coalesce(qual, '-')), '; ')
      into ajenas
    from pg_policies
    where schemaname = 'public'
      and tablename in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras', 'eventos_bot', 'sesiones')
      and policyname not in (
          'panel lee sus reservas', 'panel crea su tabla', 'panel modifica sus reservas',
          'panel lee sus eventos',
          'panel lee sus sesiones', 'panel crea sus sesiones', 'panel modifica sus sesiones', 'panel borra sus sesiones'
      );

    if ajenas is not null then
        raise exception 'Parte A abortada: hay políticas RLS no previstas: %', ajenas;
    end if;
end $$;

-- ------------------------------------------------- reservas (2 tablas) ---
do $$
declare
    t text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop

        execute format('alter table public.%I enable row level security', t);

        execute format('drop policy if exists "panel lee sus reservas" on public.%I', t);
        execute format('drop policy if exists "panel crea su tabla" on public.%I', t);
        execute format('drop policy if exists "panel modifica sus reservas" on public.%I', t);

        execute format('create policy "panel lee sus reservas" on public.%I for select to authenticated using (usuario_id = auth.uid())', t);
        execute format('create policy "panel crea su tabla" on public.%I for insert to authenticated with check (usuario_id = auth.uid())', t);
        execute format('create policy "panel modifica sus reservas" on public.%I for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', t);

        execute format('revoke all on table public.%I from anon', t);

    end loop;
end $$;

-- ------------------------------------------------------- eventos_bot ---
-- El panel solo lee; las escrituras las hace el bot (service_role).
alter table public.eventos_bot enable row level security;
drop policy if exists "panel lee sus eventos" on public.eventos_bot;
create policy "panel lee sus eventos" on public.eventos_bot for select to authenticated using (usuario_id = auth.uid());
revoke all on table public.eventos_bot from anon;

-- ---------------------------------------------------------- sesiones ---
alter table public.sesiones enable row level security;
drop policy if exists "panel lee sus sesiones" on public.sesiones;
drop policy if exists "panel crea sus sesiones" on public.sesiones;
drop policy if exists "panel modifica sus sesiones" on public.sesiones;
drop policy if exists "panel borra sus sesiones" on public.sesiones;
create policy "panel lee sus sesiones" on public.sesiones for select to authenticated using (usuario_id = auth.uid());
create policy "panel crea sus sesiones" on public.sesiones for insert to authenticated with check (usuario_id = auth.uid());
create policy "panel modifica sus sesiones" on public.sesiones for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy "panel borra sus sesiones" on public.sesiones for delete to authenticated using (usuario_id = auth.uid());
revoke all on table public.sesiones from anon;

commit;

-- ==========================================================================
-- DESPUÉS (solo lectura): repetir la prueba anónima. Con la clave anon y sin
-- sesión, las 4 tablas deben responder 0 filas o permiso denegado; con la
-- sesión del cliente, el panel debe seguir mostrando Tablas, Eventos y
-- Sesiones igual que antes.
--
-- VUELTA ATRÁS (si el panel deja de mostrar datos). Una sola transacción:
--   begin;
--   alter table public.reservas_dos_cifras disable row level security;
--   alter table public."5k_15k_reservas_2_cifras" disable row level security;
--   alter table public.eventos_bot disable row level security;
--   alter table public.sesiones disable row level security;
--   -- Restaurar los privilegios de anon EXACTOS guardados antes con:
--   --   select table_name, string_agg(privilege_type, ', ' order by privilege_type)
--   --   from information_schema.role_table_grants
--   --   where table_schema = 'public' and grantee = 'anon'
--   --     and table_name in ('eventos_bot','reservas_dos_cifras','5k_15k_reservas_2_cifras','sesiones')
--   --   group by 1;
--   -- (el valor por defecto de Supabase es ALL):
--   grant all on table public.reservas_dos_cifras, public."5k_15k_reservas_2_cifras",
--                      public.eventos_bot, public.sesiones to anon;
--   commit;
-- Las políticas creadas pueden quedarse: con RLS desactivado no tienen efecto.
-- ==========================================================================
