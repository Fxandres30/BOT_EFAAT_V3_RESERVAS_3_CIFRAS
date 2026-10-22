-- ==========================================================================
-- PARTE D (NO APLICADA, NO ES UNA MIGRACIÓN) — el panel solo puede crear y
-- renombrar sus sesiones; nunca cambiar el dueño ni el estado de operación.
--
-- Requiere la PARTE A ya aplicada (propuesta_rls_tablas_antiguas.sql). La
-- Parte A limita las filas (cada cliente solo ve/toca las suyas), pero deja
-- al rol authenticated actualizar CUALQUIER columna de su fila y borrarla.
-- Hallazgo (auditoría 2026-10-21): desde el navegador un cliente puede
--   - marcarse activa=true / principal=true / preferida=true sin pasar por
--     el backend (que es quien decide qué sesión procesa y hace el lease);
--   - poner estado/qr/telefono falsos en su fila;
--   - borrar su fila directamente, dejando el socket y la carpeta auth/<id>
--     vivos en el bot (el panel YA elimina por /api/sessions/eliminar).
--
-- QUÉ NECESITA EL PANEL (verificado en frontend/, 2026-10-21):
--   insert  services/sessions/createSession.ts
--           {usuario_id, nombre:"Nueva sesión", estado:"desconectado", principal:false}
--   update  services/sessions/updateSession.ts  -> SOLO {nombre}
--   select  getSession / getSessions / tiempo real (no cambia)
--   delete  NINGUNO directo (va por el backend con service_role)
-- El bot y el backend usan service_role: no les afecta nada de esto.
--
-- ORDEN DE DESPLIEGUE: primero el panel con updateSession restringido (ya en
-- el repo), después esta parte. Un panel antiguo que mande otras columnas
-- en un update recibiría "permission denied" (el renombrado no se rompe:
-- renameSession ya solo envía nombre).
--
-- ANTES (solo lectura) — guardar los permisos actuales para volver atrás:
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='sesiones' and grantee='authenticated';
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name='sesiones' and grantee='authenticated';
-- ==========================================================================

begin;

-- Guardia: sin la Parte A, las columnas restringidas no bastan (las filas
-- de otros clientes seguirían visibles).
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'sesiones' and policyname = 'panel modifica sus sesiones'
    ) or not (select relrowsecurity from pg_class where oid = 'public.sesiones'::regclass) then
        raise exception 'Parte D abortada: aplica antes la Parte A (RLS de sesiones).';
    end if;
end $$;

-- Guardia: authenticated hereda lo que tenga PUBLIC. Si PUBLIC puede
-- escribir en sesiones (tabla o columna), restringir a authenticated no
-- sirve de nada: se aborta y hay que revisarlo a mano.
-- (Revisión Fase 2, 2026-10-21.)
do $$
declare
    publicos text;
begin
    select string_agg(distinct p, ', ') into publicos
    from (
        select a.privilege_type as p
        from pg_class c cross join lateral aclexplode(c.relacl) a
        where c.oid = 'public.sesiones'::regclass and a.grantee = 0
          and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
        union all
        select a.privilege_type || ' (' || att.attname || ')'
        from pg_attribute att cross join lateral aclexplode(att.attacl) a
        where att.attrelid = 'public.sesiones'::regclass and a.grantee = 0
          and a.privilege_type in ('INSERT', 'UPDATE')
    ) x;

    if publicos is not null then
        raise exception 'Parte D abortada: PUBLIC tiene permisos de escritura en sesiones: %', publicos;
    end if;
end $$;

-- UPDATE: solo la columna nombre.
revoke update on table public.sesiones from authenticated;
grant update (nombre) on table public.sesiones to authenticated;

-- DELETE: nunca desde el navegador (el backend desconecta y limpia).
revoke delete on table public.sesiones from authenticated;

-- INSERT: solo las columnas que manda createSession; id, fechas y demás
-- toman su valor por defecto.
revoke insert on table public.sesiones from authenticated;
grant insert (usuario_id, nombre, estado, principal) on table public.sesiones to authenticated;

-- Y aunque las mande, una sesión creada desde el panel nace siempre
-- desconectada, no activa, no principal, no preferida. jsonb_populate_record
-- ignora las claves que no sean columnas, así que vale aunque alguna de
-- estas columnas no exista. Solo actúa con el rol del panel: el bot
-- (service_role) inserta como siempre.
-- qr y telefono NO se fuerzan (revisión Fase 2): el permiso por columna ya
-- impide enviarlos, y ponerlos a NULL rompería el alta si en producción
-- alguna de las dos fuera NOT NULL con valor por defecto.
create or replace function public.sesiones_alta_desde_panel()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if current_user = 'authenticated' then
        new := jsonb_populate_record(new, jsonb_build_object(
            'activa', false,
            'principal', false,
            'preferida', false,
            'estado', 'desconectado'
        ));
    end if;
    return new;
end $$;

drop trigger if exists sesiones_alta_desde_panel on public.sesiones;
create trigger sesiones_alta_desde_panel
    before insert on public.sesiones
    for each row execute function public.sesiones_alta_desde_panel();

commit;

-- ==========================================================================
-- DESPUÉS (con la sesión de un cliente de prueba, no con datos reales):
--   - Sesiones > "Nueva sesión" crea la tarjeta desconectada.
--   - Renombrar funciona.
--   - Conectar / activar / desconectar / eliminar siguen funcionando (van
--     por el backend).
--
-- VUELTA ATRÁS (una transacción; restaurar los permisos EXACTOS guardados
-- antes; el valor por defecto de Supabase es ALL):
--   begin;
--   drop trigger if exists sesiones_alta_desde_panel on public.sesiones;
--   drop function if exists public.sesiones_alta_desde_panel();
--   revoke update (nombre), insert (usuario_id, nombre, estado, principal) on table public.sesiones from authenticated;
--   grant insert, update, delete on table public.sesiones to authenticated;
--   commit;
-- ==========================================================================
