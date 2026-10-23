-- ==========================================================================
-- PARTE G (NO APLICADA, NO ES UNA MIGRACIÓN) — funciones SECURITY DEFINER
-- ejecutables desde el navegador. Preparada el 2026-10-22.
--
-- Hallazgo (producción 2026-10-22): hay funciones SECURITY DEFINER del
-- esquema public que anon/authenticated pueden ejecutar por /rest/v1/rpc/.
-- Una SECURITY DEFINER corre como su dueño y SALTA la RLS: la Parte A no las
-- cierra. Las expuestas por la API eran: asignar_boletos_seguro,
-- asignar_numeros_gratis, incrementar_veces_preguntada,
-- sumar_entregados_tres_cifras (heredadas), lease_sesiones_* (004) y
-- las de 020/030/031.
--
-- QUIÉN LAS USA (verificado en el repositorio, 2026-10-22):
--   qr_sesion_publica         panel /conectar/<id> SIN sesión (anon)  -> se CONSERVA
--   lease_sesiones_*          backend (service_role)                  -> solo service_role
--   reiniciar_tabla_cliente   backend (service_role)                  -> solo service_role
--   inicializar_tablas_cliente backend (service_role)                 -> solo service_role
--   analitica_*               backend (service_role)                  -> solo service_role
--   asignar_boletos_seguro, asignar_numeros_gratis,
--   incrementar_veces_preguntada, sumar_entregados_tres_cifras
--                             NINGÚN código del repositorio           -> solo service_role
--   Función heredada del trigger de pago (tras la Parte B2 es DEFINER):
--     los triggers NO comprueban EXECUTE al dispararse -> quitarle EXECUTE
--     no afecta a los pagos (probado).
--
-- QUÉ HACE (una transacción; si una guardia falla, no cambia nada):
--   G1  Lista TODAS las SECURITY DEFINER de public ejecutables por anon,
--       authenticated o PUBLIC, salvo la lista de navegador
--       (qr_sesion_publica).
--   G2  ABORTA si alguna función NO definer ejecutable desde el navegador
--       llama a una de ellas por su nombre (se rompería al quitar EXECUTE).
--   G3  ABORTA si alguna es de una extensión (no se toca a ciegas).
--   G4  ABORTA si qr_sesion_publica no es EXACTAMENTE la de la 031 (firma
--       (p_id text), jsonb, SECURITY DEFINER con search_path fijo y el
--       mismo cuerpo): no se abre al navegador una versión desconocida.
--       También aborta si falta (sin ella /conectar se queda sin QR).
--   1   Guarda su ACL exacta en efaat_admin.cambios_seguridad.
--   2   revoke execute from public, anon, authenticated; grant execute to
--       service_role.
--   3   qr_sesion_publica: execute solo a anon, authenticated y service_role.
--
-- REQUISITOS: node backend/scripts/verificarRolSupabase.js = service_role en
-- CADA instancia del bot (si no, el lease falla y el bot no conecta). Logs →
-- API sin llamadas anon/authenticated a /rpc/ distintas de qr_sesion_publica.
-- Incluye lo de la Parte F (lease); aplicar las dos no falla.
-- Prueba: backend/tests/seguridad/aislamientoMulticliente.test.js
-- ==========================================================================

begin;

-- >>> efaat_admin (bloque común: idéntico en todas las piezas) >>>
-- Registro de lo que cada pieza elimina o concede (respaldo para revertir).
-- Esquema fuera de la API: PostgREST solo publica "public". Nadie salvo el
-- dueño (postgres) lo usa: ni anon, ni authenticated, ni service_role.
create schema if not exists efaat_admin;
revoke all on schema efaat_admin from public, anon, authenticated, service_role;
create table if not exists efaat_admin.cambios_seguridad (
    id bigserial primary key,
    paso text not null,
    objeto text not null,
    accion text not null,
    detalle jsonb,
    en timestamptz not null default now()
);
alter table efaat_admin.cambios_seguridad enable row level security;
revoke all on table efaat_admin.cambios_seguridad from public, anon, authenticated, service_role;
do $$
declare
    seq text := pg_get_serial_sequence('efaat_admin.cambios_seguridad', 'id');
    r text;
begin
    if (select nspowner from pg_namespace where nspname = 'efaat_admin') <> (select oid from pg_roles where rolname = current_user) then
        raise exception 'efaat_admin pertenece a otro rol: revisarlo antes de seguir';
    end if;
    if seq is not null then
        execute format('revoke all on sequence %s from public, anon, authenticated, service_role', seq);
    end if;
    if exists (select 1 from pg_roles x cross join lateral unnest(coalesce(x.rolconfig, '{}'::text[])) c
               where x.rolname = 'authenticator' and c ilike 'pgrst.db_schemas=%efaat_admin%') then
        raise exception 'efaat_admin está expuesto por la API (pgrst.db_schemas): quitarlo antes de seguir';
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
        if has_schema_privilege(r, 'efaat_admin', 'USAGE')
           or has_table_privilege(r, 'efaat_admin.cambios_seguridad', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
            raise exception 'efaat_admin.cambios_seguridad accesible para %', r;
        end if;
    end loop;
end $$;
-- <<< efaat_admin <<<

create temporary table g_objetivo on commit drop as
select p.oid, p.oid::regprocedure::text as firma, p.proname, p.proacl::text as acl
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind in ('f', 'p')
  and p.prosecdef
  and p.proname not in ('qr_sesion_publica')
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- Las funciones de una extensión no se tocan aquí (las gestiona la propia
-- extensión): si alguna es SECURITY DEFINER y está abierta, ABORTA para
-- decidirlo a mano en lugar de dejarla abierta en silencio.
do $$
declare
    ext text;
begin
    select string_agg(g.firma, ', ') into ext
    from g_objetivo g
    where exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = g.oid and d.deptype = 'e');
    if ext is not null then
        raise exception 'Parte G abortada: funciones SECURITY DEFINER de extensiones abiertas al navegador (revisar a mano): %', ext;
    end if;
end $$;

-- La única que queda abierta tiene que ser EXACTAMENTE la de la 031: si en
-- producción hubiera otra versión (otro cuerpo, otra firma, sin search_path
-- fijo), no se le da acceso desde el navegador.
do $$
declare
    p record;
    n integer;
begin
    select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'qr_sesion_publica';
    if n = 0 then
        raise exception 'Parte G abortada: falta qr_sesion_publica (aplicar antes la 031: /conectar se quedaría sin QR)';
    end if;
    if n > 1 then
        raise exception 'Parte G abortada: hay % versiones de qr_sesion_publica (revisar a mano)', n;
    end if;
    select * into p from pg_proc where pronamespace = 'public'::regnamespace and proname = 'qr_sesion_publica';
    if pg_get_function_identity_arguments(p.oid) <> 'p_id text'
       or p.prorettype <> 'jsonb'::regtype
       or not p.prosecdef
       or p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
       or regexp_replace(lower(p.prosrc), '\s+', '', 'g') <>
          'selectjsonb_build_object(''qr'',s.qr,''estado'',s.estado,''qr_expira_en'',s.qr_expira_en)frompublic.sesionesswheres.id::text=p_idlimit1'
    then
        raise exception 'Parte G abortada: qr_sesion_publica no es la versión de la 031 (firma, cuerpo o search_path distintos)';
    end if;
end $$;

-- G2
do $$
declare
    rotas text;
begin
    select string_agg(distinct format('%s llama a %s', q.oid::regprocedure, g.proname), '; ')
      into rotas
    from pg_proc q
    join g_objetivo g on q.prosrc ~* ('\m' || g.proname || '\s*\(')
    where q.pronamespace = 'public'::regnamespace
      and not q.prosecdef
      and q.oid <> g.oid
      and (has_function_privilege('anon', q.oid, 'EXECUTE') or has_function_privilege('authenticated', q.oid, 'EXECUTE'));

    if rotas is not null then
        raise exception 'Parte G abortada: funciones ejecutables desde el navegador dependen de las que se cierran: %', rotas;
    end if;
end $$;

-- 1 y 2
do $$
declare
    f record;
begin
    for f in select * from g_objetivo order by firma loop
        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        values ('parte_g', f.firma, 'execute_cerrado', jsonb_build_object('acl_previa', coalesce(f.acl, '(por defecto: PUBLIC)')));
        execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
        execute format('grant execute on function %s to service_role', f.firma);
        raise notice 'Parte G: % solo service_role', f.firma;
    end loop;
end $$;

-- 3. QR público: solo lo necesario.
do $$
declare
    f text;
begin
    for f in select p.oid::regprocedure::text from pg_proc p
             where p.pronamespace = 'public'::regnamespace and p.proname = 'qr_sesion_publica' loop
        insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
        select 'parte_g', f, 'execute_navegador', jsonb_build_object('acl_previa', coalesce(proacl::text, '(por defecto: PUBLIC)'))
        from pg_proc where oid = f::regprocedure;
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated, service_role', f);
    end loop;
end $$;

-- Comprobación final
do $$
declare
    abiertas text;
begin
    select string_agg(p.oid::regprocedure::text, ', ') into abiertas
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname <> 'qr_sesion_publica'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
    if abiertas is not null then
        raise exception 'Parte G abortada: siguen abiertas: %', abiertas;
    end if;
end $$;

commit;

-- ==========================================================================
-- DESPUÉS: el bot conecta (lease) y renueva; /conectar/<id> sin sesión
-- muestra el QR; un pago desde el panel y por sticker funcionan; con la
-- clave anon, POST /rest/v1/rpc/asignar_numeros_gratis -> 401/403/404.
--
-- REVERSIÓN (solo de una función concreta que alguien legítimo necesite,
-- tras identificarlo; nunca en bloque ni a anon por defecto):
--   grant execute on function public.<firma exacta> to authenticated;
-- La ACL previa de cada función está en:
--   select objeto, detalle from efaat_admin.cambios_seguridad where paso = 'parte_g';
-- ==========================================================================
