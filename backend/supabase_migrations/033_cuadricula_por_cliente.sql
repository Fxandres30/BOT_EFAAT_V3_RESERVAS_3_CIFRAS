-- ==========================================================================
-- 033 — UNA CUADRÍCULA POR CLIENTE EN CADA TABLA FÍSICA DE NÚMEROS
--
-- PREPARADA EL 2026-10-22. NO APLICADA. Requiere autorización expresa.
--
-- Problema (diagnóstico de producción 2026-10-22): reservas_dos_cifras y
-- 5k_15k_reservas_2_cifras tienen UNIQUE(numero). Solo puede existir UN
-- "00" en toda la tabla, así que un segundo cliente no puede tener su
-- cuadrícula 00-99: la inicialización (027 / POST /tablas/inicializar /
-- reiniciarTabla del panel) falla con 23505.
--
-- Qué hace (una transacción por tabla dentro de un único BEGIN; si una
-- guardia falla no cambia nada):
--   1. Guardias:
--        - la tabla existe y tiene usuario_id (uuid) y numero;
--        - 0 filas con usuario_id NULL (la nueva unicidad no las protegería);
--        - 0 duplicados de (usuario_id, numero) (no se podría crear la nueva);
--        - ninguna clave foránea apunta a la unicidad que se quita;
--        - la clave primaria NO es solo numero (eso necesita otro diseño).
--   2. Crea UNIQUE (usuario_id, numero) si no existe una equivalente.
--   3. Quita las restricciones o índices ÚNICOS cuyas columnas son
--      exactamente (numero). Su definición queda en
--      efaat_admin.cambios_seguridad para la reversión.
--   4. usuario_id pasa a NOT NULL (0 filas sin dueño, comprobado en 1).
--   No toca filas: no borra, no reinicia, no mueve reservas ni pagos.
--
-- Código dependiente (revisado 2026-10-22): ningún upsert/onConflict usa
-- "numero"; todas las lecturas y escrituras del bot, del backend y del panel
-- filtran por usuario_id (filtroCliente.soloDelCliente, obtenerTabla,
-- reservaManual, sorteoReal, disponibilidad, tablaEvento...). El índice nuevo
-- (usuario_id, numero) sirve además a esas consultas y a la RLS.
--
-- Orden: independiente de la Parte A, pero la 027 la necesita para crear
-- cuadrículas de clientes nuevos (su guardia lo comprueba). Va ANTES de la 027.
-- Prueba: backend/tests/seguridad/aislamientoMulticliente.test.js
-- ==========================================================================

begin;

set local lock_timeout = '5s';

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

do $$
declare
    t text;
    rel regclass;
    n bigint;
    att_usuario smallint;
    att_numero smallint;
    u record;
    fks text;
    nombre_nueva text;
begin
    foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop

        rel := to_regclass(format('public.%I', t));
        if rel is null then
            raise exception '033 abortada: no existe la tabla %', t;
        end if;

        -- Bloquea escrituras concurrentes mientras se cambia la unicidad
        -- (las lecturas siguen). Si alguien escribe, espera como máximo 5 s.
        execute format('lock table public.%I in share row exclusive mode', t);

        select attnum into att_usuario from pg_attribute
        where attrelid = rel and attname = 'usuario_id' and not attisdropped and atttypid = 'uuid'::regtype;
        select attnum into att_numero from pg_attribute
        where attrelid = rel and attname = 'numero' and not attisdropped;
        if att_usuario is null or att_numero is null then
            raise exception '033 abortada: % no tiene usuario_id (uuid) y numero', t;
        end if;

        execute format('select count(*) from public.%I where usuario_id is null', t) into n;
        if n > 0 then
            raise exception '033 abortada: % tiene % filas sin usuario_id', t, n;
        end if;

        execute format('select count(*) from (select 1 from public.%I group by usuario_id, numero having count(*) > 1) d', t) into n;
        if n > 0 then
            raise exception '033 abortada: % tiene % números repetidos dentro de un mismo cliente', t, n;
        end if;

        if exists (select 1 from pg_index x where x.indrelid = rel and x.indisprimary
                   and x.indnatts = 1 and x.indkey[0] = att_numero) then
            raise exception '033 abortada: la clave primaria de % es solo numero; necesita otro diseño', t;
        end if;

        -- Unicidades a quitar: columnas exactamente {numero}, sin expresiones
        -- ni condición parcial.
        for u in
            select x.indexrelid, i.relname as indice, con.conname, con.oid as conoid,
                   pg_get_indexdef(x.indexrelid) as def_indice,
                   case when con.oid is not null then pg_get_constraintdef(con.oid) end as def_restriccion
            from pg_index x
            join pg_class i on i.oid = x.indexrelid
            left join pg_constraint con on con.conindid = x.indexrelid and con.conrelid = rel and con.contype in ('u', 'p')
            where x.indrelid = rel and x.indisunique and not x.indisprimary
              and x.indnatts = 1 and x.indkey[0] = att_numero
              and x.indexprs is null and x.indpred is null
        loop
            select string_agg(format('%s.%s', conrelid::regclass, conname), ', ') into fks
            from pg_constraint where contype = 'f' and conindid = u.indexrelid;
            if fks is not null then
                raise exception '033 abortada: claves foráneas dependen de la unicidad % de %: %', u.indice, t, fks;
            end if;
        end loop;

        -- 2. Unicidad por cliente (si no hay ya una equivalente).
        if not exists (
            select 1 from pg_index x
            where x.indrelid = rel and x.indisunique and x.indexprs is null and x.indpred is null
              and x.indnatts = 2
              and ((x.indkey[0] = att_usuario and x.indkey[1] = att_numero)
                or (x.indkey[0] = att_numero and x.indkey[1] = att_usuario))
        ) then
            nombre_nueva := left(t || '_usuario_numero_key', 63);
            execute format('alter table public.%I add constraint %I unique (usuario_id, numero)', t, nombre_nueva);
            insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
            values ('033', t, 'unicidad_creada', jsonb_build_object('restriccion', nombre_nueva, 'def', 'UNIQUE (usuario_id, numero)'));
            raise notice '033: % ahora es única por (usuario_id, numero)', t;
        end if;

        -- 3. Quitar la unicidad global sobre numero.
        for u in
            select x.indexrelid, i.relname as indice, con.conname,
                   pg_get_indexdef(x.indexrelid) as def_indice,
                   case when con.oid is not null then pg_get_constraintdef(con.oid) end as def_restriccion
            from pg_index x
            join pg_class i on i.oid = x.indexrelid
            left join pg_constraint con on con.conindid = x.indexrelid and con.conrelid = rel and con.contype = 'u'
            where x.indrelid = rel and x.indisunique and not x.indisprimary
              and x.indnatts = 1 and x.indkey[0] = att_numero
              and x.indexprs is null and x.indpred is null
        loop
            insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
            values ('033', t, 'unicidad_numero_eliminada',
                    jsonb_build_object('restriccion', u.conname, 'indice', u.indice,
                                       'def_restriccion', u.def_restriccion, 'def_indice', u.def_indice));
            if u.conname is not null then
                execute format('alter table public.%I drop constraint %I', t, u.conname);
            else
                execute format('drop index public.%I', u.indice);
            end if;
            raise notice '033: eliminada la unicidad global % de %', coalesce(u.conname, u.indice), t;
        end loop;

        -- 4. Sin dueño no hay unicidad: con usuario_id NULL dos filas podrían
        -- repetir número. Ya se comprobó que no hay ninguna; desde aquí la base
        -- rechaza cualquier fila nueva sin dueño (el bot ya las rechaza).
        if exists (select 1 from pg_attribute where attrelid = rel and attnum = att_usuario and not attnotnull) then
            execute format('alter table public.%I alter column usuario_id set not null', t);
            insert into efaat_admin.cambios_seguridad (paso, objeto, accion, detalle)
            values ('033', t, 'usuario_id_not_null', jsonb_build_object('antes', 'nullable'));
        end if;

    end loop;
end $$;

commit;

-- ==========================================================================
-- Verificación (solo lectura):
--   select conrelid::regclass, conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid in ('public.reservas_dos_cifras'::regclass, 'public."5k_15k_reservas_2_cifras"'::regclass)
--     and contype in ('u', 'p');
--   -> UNIQUE (usuario_id, numero) en las 2; ninguna UNIQUE (numero).
--   R13/D15 idénticos a antes (la migración no toca filas).
--
-- REVERSIÓN (solo si todavía ningún otro cliente tiene cuadrícula en esa
-- tabla; si lo tiene, restaurar UNIQUE(numero) es imposible sin borrar sus
-- filas y NO se hace):
--   begin;
--   do $$
--   declare t text; n bigint;
--   begin
--       foreach t in array array['reservas_dos_cifras', '5k_15k_reservas_2_cifras'] loop
--           if exists (select 1 from efaat_admin.cambios_seguridad where paso = '033' and objeto = t) then
--               execute format('select count(*) from (select 1 from public.%I group by numero having count(*) > 1) d', t) into n;
--               if n > 0 then raise exception 'Reversión imposible: % ya tiene números de varios clientes', t; end if;
--               execute format('alter table public.%I add constraint %I unique (numero)', t, t || '_numero_key');
--               execute format('alter table public.%I drop constraint if exists %I', t, left(t || '_usuario_numero_key', 63));
--           end if;
--           if exists (select 1 from efaat_admin.cambios_seguridad where paso = '033' and objeto = t and accion = 'usuario_id_not_null') then
--               execute format('alter table public.%I alter column usuario_id drop not null', t);
--           end if;
--       end loop;
--   end $$;
--   commit;
-- ==========================================================================
