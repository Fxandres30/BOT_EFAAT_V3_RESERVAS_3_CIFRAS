-- ==========================================================================
-- 029 — RLS DE CHATS POR CLIENTE (mensajes_grupos_sorteos)
--
-- PREPARADA EL 2026-10-21. NO APLICADA. Requiere autorización expresa.
-- Es el paso 4 de la Parte E (docs/activacion/parte_e_mensajes_por_cliente.sql)
-- convertido en migración con guardias.
--
-- Hoy cualquier usuario del panel (y la clave anon) lee conversaciones,
-- nombres, teléfonos y LID de los grupos de TODOS los clientes. Con esta
-- migración cada cliente solo lee los mensajes que recibió SU bot
-- (cliente_usuario_id = auth.uid()); el panel no escribe en esta tabla y el
-- bot usa service_role (no le afecta).
--
-- REQUISITOS (las guardias abortan si faltan):
--   1. Migración 028 aplicada (columna cliente_usuario_id).
--   2. El bot nuevo ya escribe cliente_usuario_id: 0 filas sin cliente en la
--      última hora (si en la última hora no hubo ningún mensaje, también
--      aborta: no hay prueba de que el bot nuevo esté funcionando).
--   3. Ninguna política previa no prevista sobre la tabla.
--
-- EFECTO EN DATOS HISTÓRICOS: las filas con cliente_usuario_id NULL (todas
-- las anteriores a la 028) dejan de verse en el panel para todos. El bot no
-- se ve afectado. Si se quiere conservarlas visibles para su cliente, aplicar
-- ANTES el relleno verificable por grupo
-- (docs/activacion/relleno_cliente_mensajes.sql) — decisión del dueño.
--
-- Una transacción: si una guardia falla, no se aplica nada.
-- ==========================================================================

begin;

do $$
declare
    ajenas text;
    recientes integer;
    sin_cliente integer;
begin

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'mensajes_grupos_sorteos' and column_name = 'cliente_usuario_id'
    ) then
        raise exception '029 abortada: falta la migración 028 (columna cliente_usuario_id).';
    end if;

    select count(*), count(*) filter (where cliente_usuario_id is null)
      into recientes, sin_cliente
    from public.mensajes_grupos_sorteos
    where creado_en > now() - interval '1 hour';

    if recientes = 0 then
        raise exception '029 abortada: ningún mensaje en la última hora; no hay prueba de que el bot nuevo escriba cliente_usuario_id.';
    end if;

    if sin_cliente > 0 then
        raise exception '029 abortada: % de % mensajes de la última hora sin cliente_usuario_id (¿bot anterior todavía activo?).', sin_cliente, recientes;
    end if;

    select string_agg(format('"%s" (%s, roles %s)', policyname, cmd, array_to_string(roles, ',')), '; ')
      into ajenas
    from pg_policies
    where schemaname = 'public' and tablename = 'mensajes_grupos_sorteos'
      and policyname <> 'panel lee los chats de su bot';

    if ajenas is not null then
        raise exception '029 abortada: hay políticas RLS no previstas: %', ajenas;
    end if;

end $$;

alter table public.mensajes_grupos_sorteos enable row level security;

drop policy if exists "panel lee los chats de su bot" on public.mensajes_grupos_sorteos;

create policy "panel lee los chats de su bot" on public.mensajes_grupos_sorteos
    for select to authenticated using (cliente_usuario_id = auth.uid());

-- anon hereda de PUBLIC: se quitan los dos (auditoría integral, 2026-10-22).
-- Si la lectura del panel (authenticated) venía de PUBLIC, se concede explícita.
create temporary table m029_antes on commit drop as
select has_table_privilege('authenticated', 'public.mensajes_grupos_sorteos', 'SELECT') as auth_lee,
       has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'SELECT') as srv_lee,
       has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'INSERT') as srv_crea,
       has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'UPDATE') as srv_modifica,
       has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'DELETE') as srv_borra;
revoke all on table public.mensajes_grupos_sorteos from anon, public;
do $$
declare
    a record;
begin
    select * into a from m029_antes;
    if a.auth_lee and not has_table_privilege('authenticated', 'public.mensajes_grupos_sorteos', 'SELECT') then
        grant select on table public.mensajes_grupos_sorteos to authenticated;
    end if;
    if a.srv_lee and not has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'SELECT') then
        grant select on table public.mensajes_grupos_sorteos to service_role;
    end if;
    if a.srv_crea and not has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'INSERT') then
        grant insert on table public.mensajes_grupos_sorteos to service_role;
    end if;
    if a.srv_modifica and not has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'UPDATE') then
        grant update on table public.mensajes_grupos_sorteos to service_role;
    end if;
    if a.srv_borra and not has_table_privilege('service_role', 'public.mensajes_grupos_sorteos', 'DELETE') then
        grant delete on table public.mensajes_grupos_sorteos to service_role;
    end if;
end $$;
revoke insert, update, delete, truncate, references, trigger on table public.mensajes_grupos_sorteos from authenticated;

do $$
begin
    if has_table_privilege('anon', 'public.mensajes_grupos_sorteos', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
       or has_any_column_privilege('anon', 'public.mensajes_grupos_sorteos', 'SELECT, INSERT, UPDATE') then
        raise exception '029 abortada: anon conserva acceso a mensajes_grupos_sorteos (¿hereda de otro rol?)';
    end if;
    if has_table_privilege('authenticated', 'public.mensajes_grupos_sorteos', 'INSERT, UPDATE, DELETE, TRUNCATE') then
        raise exception '029 abortada: authenticated conserva escritura en mensajes_grupos_sorteos (¿hereda de otro rol?)';
    end if;
end $$;

commit;

-- ==========================================================================
-- Verificación (solo lectura):
--   select relrowsecurity from pg_class where oid = 'public.mensajes_grupos_sorteos'::regclass;  -- true
--   select policyname, cmd, roles, qual from pg_policies where tablename = 'mensajes_grupos_sorteos';
--
-- Reversión (guardar ANTES los privilegios: select grantee, privilege_type
-- from information_schema.role_table_grants where table_name = 'mensajes_grupos_sorteos'):
--   begin;
--   alter table public.mensajes_grupos_sorteos disable row level security;
--   drop policy if exists "panel lee los chats de su bot" on public.mensajes_grupos_sorteos;
--   -- + volver a conceder los privilegios guardados.
--   commit;
-- ==========================================================================
