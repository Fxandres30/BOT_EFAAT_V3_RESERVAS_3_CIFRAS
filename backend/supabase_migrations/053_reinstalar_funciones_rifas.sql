-- ==========================================================================
-- 053 — REINSTALA LAS FUNCIONES DEL MOTOR DE RIFAS CON SU VERSIÓN ACTUAL
--
-- PREPARADA EL 2026-11-12. Requiere la 050 aplicada.
--
-- Por qué: la 050 se aplicó en producción en un momento en que su archivo
-- seguía recibiendo correcciones (rifa_liberar con condiciones atómicas para
-- el vencimiento: p_opciones.reservado_antes_de / identidad_evento_real). No
-- hay forma de saber desde la API qué versión quedó. Esta pieza reinstala TODAS
-- las funciones de la 050 (25) con 'create or replace', copiadas
-- tal cual del archivo actual de la 050.
--
-- Qué toca: SOLO el código de las funciones. No crea, modifica ni borra tablas,
-- filas, permisos ni políticas (create or replace conserva los permisos de
-- cada función; al final se vuelven a aplicar igual que en la 050). Se puede
-- ejecutar más de una vez.
-- ==========================================================================

begin;

do $$
begin
    if to_regclass('public.tablas_rifas') is null then
        raise exception '053: falta la 050';
    end if;
end $$;

-- rifas_privado.config_valida
create or replace function rifas_privado.config_valida(c jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select jsonb_typeof(c) = 'object'
       and not exists (
            select 1 from jsonb_object_keys(c) k
            where k not in ('mensajes', 'reservas', 'pagos', 'sorteo', 'opciones'))
       and (select bool_and(jsonb_typeof(c -> k) = 'object')
              from jsonb_object_keys(c) k) is not false
       and (c #> '{reservas,expiracion_minutos}' is null
            or (jsonb_typeof(c #> '{reservas,expiracion_minutos}') = 'number'
                and (c #>> '{reservas,expiracion_minutos}')::numeric between 0 and 10080
                and (c #>> '{reservas,expiracion_minutos}')::numeric = trunc((c #>> '{reservas,expiracion_minutos}')::numeric)))
       and (c #> '{reservas,max_por_persona}' is null
            or (jsonb_typeof(c #> '{reservas,max_por_persona}') = 'number'
                and (c #>> '{reservas,max_por_persona}')::numeric between 1 and 10000
                and (c #>> '{reservas,max_por_persona}')::numeric = trunc((c #>> '{reservas,max_por_persona}')::numeric)))
       and (c #> '{reservas,permitir_bot}' is null or jsonb_typeof(c #> '{reservas,permitir_bot}') = 'boolean')
       and (c #> '{reservas,permitir_panel}' is null or jsonb_typeof(c #> '{reservas,permitir_panel}') = 'boolean')
       and pg_column_size(c) <= 65536;
$$;

-- rifas_privado.numero_en_rango
create or replace function rifas_privado.numero_en_rango()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_cantidad integer;
begin
    select cantidad into v_cantidad
      from public.tablas_rifas
     where id = new.tabla_id and usuario_id = new.usuario_id;
    if v_cantidad is null then
        raise exception 'la rifa % no existe o no pertenece a ese dueño', new.tabla_id using errcode = '23503';
    end if;
    if new.numero >= v_cantidad then
        raise exception 'numero % fuera de la rifa', new.numero using errcode = '23514';
    end if;
    return new;
end;
$$;

-- rifas_privado.numero_inmutable
create or replace function rifas_privado.numero_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.tabla_id <> old.tabla_id or new.usuario_id <> old.usuario_id or new.numero <> old.numero then
        raise exception 'no se puede mover un número a otra rifa, dueño o posición' using errcode = '42501';
    end if;
    new.version := old.version + 1;
    new.actualizado_en := now();
    return new;
end;
$$;

-- rifas_privado.rifa_dueno_inmutable
create or replace function rifas_privado.rifa_dueno_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.usuario_id <> old.usuario_id then
        raise exception 'no se puede cambiar el dueño de una rifa' using errcode = '42501';
    end if;
    new.actualizado_en := now();
    return new;
end;
$$;

-- rifas_privado.archivo_inmutable
create or replace function rifas_privado.archivo_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'numeros_rifa_archivo es de solo inserción (% no permitido)', tg_op using errcode = '42501';
end;
$$;

-- rifas_privado.origen
create or replace function rifas_privado.origen(p_actor jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    v text := coalesce(p_actor ->> 'origen', '');
begin
    if v not in ('bot', 'manual', 'sistema', 'migracion') then
        raise exception 'origen invalido: "%"', v using errcode = '22023';
    end if;
    return v;
end;
$$;

-- rifas_privado.uuid_o_error
create or replace function rifas_privado.uuid_o_error(p text, p_campo text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p is null or p = '' then
        return null;
    end if;
    if p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception '% no es un uuid valido', p_campo using errcode = '22023';
    end if;
    return p::uuid;
end;
$$;

-- rifas_privado.texto
create or replace function rifas_privado.texto(p jsonb, p_campo text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
    select nullif(left(btrim(p ->> p_campo), p_max), '');
$$;

-- rifas_privado.rifa_propia
create or replace function rifas_privado.rifa_propia(p_usuario uuid, p_tabla uuid, p_exclusiva boolean)
returns public.tablas_rifas
language plpgsql
set search_path = ''
as $$
declare
    v public.tablas_rifas;
begin
    if p_usuario is null or p_tabla is null then
        return null;
    end if;
    if p_exclusiva then
        select * into v from public.tablas_rifas
         where id = p_tabla and usuario_id = p_usuario for update;
    else
        select * into v from public.tablas_rifas
         where id = p_tabla and usuario_id = p_usuario for share;
    end if;
    return v;
end;
$$;

-- rifas_privado.numeros_pedidos
create or replace function rifas_privado.numeros_pedidos(p integer[])
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
    v integer[];
begin
    select array_agg(distinct n order by n) into v from unnest(p) n where n is not null;
    if v is null then
        return '{}'::integer[];
    end if;
    if cardinality(v) > 1000 then
        raise exception 'demasiados numeros en una operacion (%)', cardinality(v) using errcode = '22023';
    end if;
    return v;
end;
$$;

-- rifas_privado.auditar
create or replace function rifas_privado.auditar(
    p_rifa      public.tablas_rifas,
    p_accion    text,
    p_filas     jsonb,
    p_datos     jsonb,
    p_actor     jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
    insert into public.reservas_auditoria (
        usuario_id, operador_id, operador_email, origen, accion,
        tabla, tabla_id, ciclo, precio, numero,
        evento_id, identidad_evento_real, grupo_id, grupo_nombre,
        contacto_id, contacto_nombre, contacto_telefono,
        estado_anterior, estado_nuevo, motivo, observaciones, metodo_pago,
        resultado, codigo, solicitud_id)
    select
        p_rifa.usuario_id,
        rifas_privado.uuid_o_error(p_actor ->> 'operador_id', 'operador_id'),
        rifas_privado.texto(p_actor, 'operador_email', 200),
        rifas_privado.origen(p_actor),
        p_accion,
        'numeros_rifa', p_rifa.id, p_rifa.ciclo, p_rifa.precio,
        case when f.numero is null then '*' else lpad(f.numero::text, p_rifa.cifras, '0') end,
        rifas_privado.uuid_o_error(p_datos ->> 'evento_id', 'evento_id'),
        rifas_privado.texto(p_datos, 'identidad_evento_real', 200),
        rifas_privado.texto(p_datos, 'grupo_id', 200),
        rifas_privado.texto(p_datos, 'grupo_nombre', 200),
        rifas_privado.uuid_o_error(p_datos ->> 'usuario_global_id', 'usuario_global_id'),
        rifas_privado.texto(p_datos, 'comprador', 200),
        rifas_privado.texto(p_datos, 'telefono', 40),
        f.antes, f.despues,
        rifas_privado.texto(p_actor, 'motivo', 500),
        rifas_privado.texto(p_datos, 'observaciones', 1000),
        rifas_privado.texto(p_datos, 'metodo_pago', 60),
        f.resultado, f.codigo,
        rifas_privado.texto(p_actor, 'solicitud_id', 80)
    from jsonb_to_recordset(p_filas) as f(numero integer, antes text, despues text, resultado text, codigo text);
end;
$$;

-- public.rifa_crear
create or replace function public.rifa_crear(
    p_usuario   uuid,
    p_nombre    text,
    p_precio    integer,
    p_cifras    integer,
    p_cantidad  integer,
    p_config    jsonb default '{}'::jsonb,
    p_codigo    text default null,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v public.tablas_rifas;
begin
    perform rifas_privado.origen(p_actor);

    if p_usuario is null or not exists (select 1 from auth.users where id = p_usuario) then
        return jsonb_build_object('ok', false, 'motivo', 'cliente_no_encontrado');
    end if;
    if not rifas_privado.config_valida(coalesce(p_config, '{}'::jsonb)) then
        return jsonb_build_object('ok', false, 'motivo', 'config_invalida');
    end if;
    if p_codigo is not null and exists (
        select 1 from public.tablas_rifas
         where usuario_id = p_usuario and archivada_en is null and lower(codigo) = lower(p_codigo)) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_en_uso');
    end if;

    -- Los CHECK de la tabla validan nombre, precio, cifras, cantidad y código.
    insert into public.tablas_rifas (usuario_id, nombre, codigo, precio, cifras, cantidad)
    values (p_usuario, btrim(p_nombre), nullif(btrim(p_codigo), ''), p_precio, p_cifras, p_cantidad)
    returning * into v;

    insert into public.configuracion_tabla (tabla_id, usuario_id, config)
    values (v.id, v.usuario_id, coalesce(p_config, '{}'::jsonb));

    insert into public.numeros_rifa (tabla_id, usuario_id, numero)
    select v.id, v.usuario_id, n from generate_series(0, v.cantidad - 1) n;

    perform rifas_privado.auditar(v, 'crear_rifa',
        jsonb_build_array(jsonb_build_object('numero', null, 'antes', null, 'despues', 'activa', 'resultado', 'ok')),
        '{}'::jsonb, p_actor);

    return jsonb_build_object('ok', true, 'tabla_id', v.id, 'numeros', v.cantidad, 'ciclo', v.ciclo);
end;
$$;

-- public.rifa_reservar
create or replace function public.rifa_reservar(
    p_usuario       uuid,
    p_tabla         uuid,
    p_numeros       integer[],
    p_datos         jsonb default '{}'::jsonb,
    p_actor         jsonb default '{"origen": "bot"}'::jsonb,
    p_todo_o_nada   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa      public.tablas_rifas;
    v_pedidos   integer[];
    v_fuera     integer[];
    v_validos   integer[];
    v_previos   jsonb;
    v_libres    integer[];
    v_ocupados  integer[];
    v_hechos    integer[];
    v_origen    text := rifas_privado.origen(p_actor);
    v_datos     jsonb := coalesce(p_datos, '{}'::jsonb);
begin
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, false);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if not v_rifa.activa or v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_inactiva');
    end if;

    v_pedidos := rifas_privado.numeros_pedidos(p_numeros);
    if cardinality(v_pedidos) = 0 then
        return jsonb_build_object('ok', false, 'motivo', 'sin_numeros');
    end if;
    v_fuera   := array(select n from unnest(v_pedidos) n where n < 0 or n >= v_rifa.cantidad order by n);
    v_validos := array(select n from unnest(v_pedidos) n where n >= 0 and n < v_rifa.cantidad order by n);

    -- Bloqueo de las filas en orden fijo (evita interbloqueos).
    select coalesce(jsonb_object_agg(numero::text, estado), '{}'::jsonb) into v_previos
      from (select numero, estado from public.numeros_rifa
             where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and numero = any(v_validos)
             order by numero
               for update) b;

    v_libres   := array(select n from unnest(v_validos) n where v_previos ->> n::text = 'libre' order by n);
    v_ocupados := array(select n from unnest(v_validos) n where coalesce(v_previos ->> n::text, '') <> 'libre' order by n);

    if p_todo_o_nada and (cardinality(v_ocupados) > 0 or cardinality(v_fuera) > 0) then
        v_libres := '{}'::integer[];
    end if;

    with u as (
        update public.numeros_rifa set
            estado                = 'reservado',
            comprador             = rifas_privado.texto(v_datos, 'comprador', 200),
            contacto              = rifas_privado.texto(v_datos, 'contacto', 200),
            telefono              = rifas_privado.texto(v_datos, 'telefono', 40),
            lid                   = rifas_privado.texto(v_datos, 'lid', 200),
            lib                   = rifas_privado.texto(v_datos, 'lib', 200),
            usuario_global_id     = rifas_privado.uuid_o_error(v_datos ->> 'usuario_global_id', 'usuario_global_id'),
            grupo_id              = rifas_privado.texto(v_datos, 'grupo_id', 200),
            grupo_nombre          = rifas_privado.texto(v_datos, 'grupo_nombre', 200),
            evento_id             = rifas_privado.uuid_o_error(v_datos ->> 'evento_id', 'evento_id'),
            identidad_evento_real = rifas_privado.texto(v_datos, 'identidad_evento_real', 200),
            nombre_evento         = rifas_privado.texto(v_datos, 'nombre_evento', 200),
            telefono_bot          = rifas_privado.texto(v_datos, 'telefono_bot', 40),
            origen                = v_origen,
            ciclo                 = v_rifa.ciclo,
            reservado_en          = now(),
            pagado_en             = null,
            observaciones         = rifas_privado.texto(v_datos, 'observaciones', 1000)
         where tabla_id = v_rifa.id
           and usuario_id = v_rifa.usuario_id
           and numero = any(v_libres)
           and estado = 'libre'
        returning numero)
    select coalesce(array_agg(numero order by numero), '{}'::integer[]) into v_hechos from u;

    perform rifas_privado.auditar(v_rifa, 'reservar',
        coalesce((select jsonb_agg(jsonb_build_object(
                        'numero', n,
                        'antes', v_previos ->> n::text,
                        'despues', case when n = any(v_hechos) then 'reservado' else v_previos ->> n::text end,
                        'resultado', case when n = any(v_hechos) then 'ok' else 'rechazado' end,
                        'codigo', case when n = any(v_hechos) then null
                                       when n = any(v_fuera) then 'fuera_de_rango'
                                       when n = any(v_ocupados) then 'no_disponible'
                                       else 'no_reservado_todo_o_nada' end))
                    from unnest(v_pedidos) n), '[]'::jsonb),
        v_datos, p_actor);

    return jsonb_build_object(
        'ok', cardinality(v_hechos) > 0,
        'motivo', case when cardinality(v_hechos) > 0 then null else 'no_disponibles' end,
        'tabla_id', v_rifa.id,
        'reservados', to_jsonb(v_hechos),
        'no_disponibles', to_jsonb(v_ocupados),
        'fuera_de_rango', to_jsonb(v_fuera));
end;
$$;

-- rifas_privado.es_del_titular
create or replace function rifas_privado.es_del_titular(n public.numeros_rifa, t jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select t is null or jsonb_typeof(t) <> 'object' or t = '{}'::jsonb
        or (t ->> 'telefono' is not null and n.telefono = t ->> 'telefono')
        or (t ->> 'lid' is not null and (n.lid = t ->> 'lid' or n.lib = t ->> 'lid'))
        or (t ->> 'usuario_global_id' is not null and n.usuario_global_id::text = t ->> 'usuario_global_id');
$$;

-- public.rifa_pagar
create or replace function public.rifa_pagar(
    p_usuario   uuid,
    p_tabla     uuid,
    p_numeros   integer[],
    p_datos     jsonb default '{}'::jsonb,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa      public.tablas_rifas;
    v_pedidos   integer[];
    v_filas     jsonb;
    v_pagables  integer[];
    v_hechos    integer[];
    v_datos     jsonb := coalesce(p_datos, '{}'::jsonb);
begin
    perform rifas_privado.origen(p_actor);
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, false);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_archivada');
    end if;

    v_pedidos := rifas_privado.numeros_pedidos(p_numeros);
    if cardinality(v_pedidos) = 0 then
        return jsonb_build_object('ok', false, 'motivo', 'sin_numeros');
    end if;

    select coalesce(jsonb_object_agg(numero::text, jsonb_build_object('estado', estado, 'titular', titular)), '{}'::jsonb)
      into v_filas
      from (select n.numero, n.estado, rifas_privado.es_del_titular(n, v_datos -> 'titular') as titular
              from public.numeros_rifa n
             where n.tabla_id = v_rifa.id and n.usuario_id = v_rifa.usuario_id and n.numero = any(v_pedidos)
             order by n.numero
               for update) b;

    v_pagables := array(select n from unnest(v_pedidos) n
                         where v_filas #>> array[n::text, 'estado'] in ('reservado', 'en_proceso')
                           and (v_filas #>> array[n::text, 'titular'])::boolean
                         order by n);

    with u as (
        update public.numeros_rifa set
            estado = 'pagado',
            pagado_en = now(),
            observaciones = coalesce(rifas_privado.texto(v_datos, 'observaciones', 1000), observaciones)
         where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id
           and numero = any(v_pagables) and estado in ('reservado', 'en_proceso')
        returning numero)
    select coalesce(array_agg(numero order by numero), '{}'::integer[]) into v_hechos from u;

    perform rifas_privado.auditar(v_rifa, 'pagar',
        (select jsonb_agg(jsonb_build_object(
                    'numero', n,
                    'antes', v_filas #>> array[n::text, 'estado'],
                    'despues', case when n = any(v_hechos) then 'pagado' else v_filas #>> array[n::text, 'estado'] end,
                    'resultado', case when n = any(v_hechos) then 'ok' else 'rechazado' end,
                    'codigo', case when n = any(v_hechos) then null
                                   when v_filas -> n::text is null then 'fuera_de_rango'
                                   when v_filas #>> array[n::text, 'estado'] = 'pagado' then 'ya_pagado'
                                   when not (v_filas #>> array[n::text, 'titular'])::boolean then 'otro_titular'
                                   else 'no_reservado' end))
           from unnest(v_pedidos) n),
        v_datos, p_actor);

    return jsonb_build_object(
        'ok', cardinality(v_hechos) > 0,
        'motivo', case when cardinality(v_hechos) > 0 then null else 'nada_que_pagar' end,
        'tabla_id', v_rifa.id,
        'pagados', to_jsonb(v_hechos),
        'ya_pagados', to_jsonb(array(select n from unnest(v_pedidos) n
                                      where v_filas #>> array[n::text, 'estado'] = 'pagado' order by n)),
        'no_pagables', to_jsonb(array(select n from unnest(v_pedidos) n
                                       where not (n = any(v_hechos))
                                         and coalesce(v_filas #>> array[n::text, 'estado'], '') <> 'pagado' order by n)));
end;
$$;

-- public.rifa_liberar
create or replace function public.rifa_liberar(
    p_usuario   uuid,
    p_tabla     uuid,
    p_numeros   integer[],
    p_datos     jsonb default '{}'::jsonb,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb,
    p_opciones  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa      public.tablas_rifas;
    v_pedidos   integer[];
    v_filas     jsonb;
    v_estados   text[] := array['reservado', 'en_proceso'];
    v_liberables integer[];
    v_hechos    integer[];
    v_datos     jsonb := coalesce(p_datos, '{}'::jsonb);
begin
    perform rifas_privado.origen(p_actor);
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, false);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_archivada');
    end if;
    if coalesce((p_opciones ->> 'incluir_pagados')::boolean, false) then
        v_estados := array_append(v_estados, 'pagado'::text);
    end if;
    if coalesce((p_opciones ->> 'incluir_bloqueados')::boolean, false) then
        v_estados := array_append(v_estados, 'bloqueado'::text);
    end if;

    v_pedidos := rifas_privado.numeros_pedidos(p_numeros);
    if cardinality(v_pedidos) = 0 then
        return jsonb_build_object('ok', false, 'motivo', 'sin_numeros');
    end if;

    select coalesce(jsonb_object_agg(numero::text, jsonb_build_object('estado', estado, 'titular', titular, 'condicion', condicion)), '{}'::jsonb)
      into v_filas
      from (select n.numero, n.estado, rifas_privado.es_del_titular(n, v_datos -> 'titular') as titular,
                     -- Condiciones atómicas (comprobadas con la fila ya bloqueada): evitan liberar
                     -- una reserva NUEVA hecha entre la lectura del llamador y esta liberación.
                     ((p_opciones ->> 'reservado_antes_de') is null
                         or (n.reservado_en is not null and n.reservado_en <= (p_opciones ->> 'reservado_antes_de')::timestamptz))
                     and ((p_opciones ->> 'identidad_evento_real') is null
                         or n.identidad_evento_real is not distinct from (p_opciones ->> 'identidad_evento_real')) as condicion
              from public.numeros_rifa n
             where n.tabla_id = v_rifa.id and n.usuario_id = v_rifa.usuario_id and n.numero = any(v_pedidos)
             order by n.numero
               for update) b;

    v_liberables := array(select n from unnest(v_pedidos) n
                           where v_filas #>> array[n::text, 'estado'] = any(v_estados)
                             and (v_filas #>> array[n::text, 'titular'])::boolean
                             and (v_filas #>> array[n::text, 'condicion'])::boolean
                           order by n);

    with u as (
        update public.numeros_rifa set
            estado = 'libre',
            comprador = null, contacto = null, telefono = null, lid = null, lib = null,
            usuario_global_id = null, grupo_id = null, grupo_nombre = null,
            evento_id = null, identidad_evento_real = null, nombre_evento = null, telefono_bot = null,
            origen = null, ciclo = null,
            reservado_en = null, pagado_en = null, bloqueado_hasta = null,
            temporal_por = null, observaciones = null
         where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id
           and numero = any(v_liberables) and estado = any(v_estados)
        returning numero)
    select coalesce(array_agg(numero order by numero), '{}'::integer[]) into v_hechos from u;

    perform rifas_privado.auditar(v_rifa,
        case when 'bloqueado' = any(v_estados) and not ('reservado' = any(v_estados)) then 'desbloquear' else 'liberar' end,
        (select jsonb_agg(jsonb_build_object(
                    'numero', n,
                    'antes', v_filas #>> array[n::text, 'estado'],
                    'despues', case when n = any(v_hechos) then 'libre' else v_filas #>> array[n::text, 'estado'] end,
                    'resultado', case when n = any(v_hechos) then 'ok' else 'rechazado' end,
                    'codigo', case when n = any(v_hechos) then null
                                   when v_filas -> n::text is null then 'fuera_de_rango'
                                   when v_filas #>> array[n::text, 'estado'] = 'libre' then 'ya_libre'
                                   when not (v_filas #>> array[n::text, 'titular'])::boolean then 'otro_titular'
                                   when not (v_filas #>> array[n::text, 'condicion'])::boolean then 'no_cumple_condicion'
                                   else 'estado_protegido' end))
           from unnest(v_pedidos) n),
        v_datos, p_actor);

    return jsonb_build_object(
        'ok', cardinality(v_hechos) > 0,
        'motivo', case when cardinality(v_hechos) > 0 then null else 'nada_que_liberar' end,
        'tabla_id', v_rifa.id,
        'liberados', to_jsonb(v_hechos),
        'no_liberados', to_jsonb(array(select n from unnest(v_pedidos) n where not (n = any(v_hechos)) order by n)));
end;
$$;

-- public.rifa_bloquear
create or replace function public.rifa_bloquear(
    p_usuario   uuid,
    p_tabla     uuid,
    p_numeros   integer[],
    p_actor     jsonb default '{"origen": "manual"}'::jsonb,
    p_hasta     timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa      public.tablas_rifas;
    v_pedidos   integer[];
    v_previos   jsonb;
    v_hechos    integer[];
begin
    perform rifas_privado.origen(p_actor);
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, false);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_archivada');
    end if;
    v_pedidos := rifas_privado.numeros_pedidos(p_numeros);

    select coalesce(jsonb_object_agg(numero::text, estado), '{}'::jsonb) into v_previos
      from (select numero, estado from public.numeros_rifa
             where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and numero = any(v_pedidos)
             order by numero for update) b;

    with u as (
        update public.numeros_rifa set
            estado = 'bloqueado', bloqueado_hasta = p_hasta,
            observaciones = rifas_privado.texto(p_actor, 'motivo', 500),
            origen = rifas_privado.origen(p_actor), ciclo = v_rifa.ciclo
         where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id
           and numero = any(v_pedidos) and estado = 'libre'
        returning numero)
    select coalesce(array_agg(numero order by numero), '{}'::integer[]) into v_hechos from u;

    perform rifas_privado.auditar(v_rifa, 'bloquear',
        coalesce((select jsonb_agg(jsonb_build_object(
                    'numero', n, 'antes', v_previos ->> n::text,
                    'despues', case when n = any(v_hechos) then 'bloqueado' else v_previos ->> n::text end,
                    'resultado', case when n = any(v_hechos) then 'ok' else 'rechazado' end,
                    'codigo', case when n = any(v_hechos) then null
                                   when v_previos ->> n::text is null then 'fuera_de_rango'
                                   else 'no_libre' end))
           from unnest(v_pedidos) n), '[]'::jsonb),
        '{}'::jsonb, p_actor);

    return jsonb_build_object('ok', cardinality(v_hechos) > 0, 'tabla_id', v_rifa.id, 'bloqueados', to_jsonb(v_hechos));
end;
$$;

-- public.rifa_reiniciar
create or replace function public.rifa_reiniciar(
    p_usuario       uuid,
    p_tabla         uuid,
    p_confirmacion  text,
    p_actor         jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa      public.tablas_rifas;
    v_archivados integer;
    v_motivo    text := coalesce(rifas_privado.texto(p_actor, 'motivo', 500), 'reinicio');
begin
    perform rifas_privado.origen(p_actor);
    if p_confirmacion is distinct from 'REINICIAR' then
        return jsonb_build_object('ok', false, 'motivo', 'confirmacion_requerida');
    end if;
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, true);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_archivada');
    end if;

    insert into public.numeros_rifa_archivo (tabla_id, usuario_id, ciclo, numero, estado, fila, motivo)
    select n.tabla_id, n.usuario_id, v_rifa.ciclo, n.numero, n.estado, to_jsonb(n), v_motivo
      from public.numeros_rifa n
     where n.tabla_id = v_rifa.id and n.usuario_id = v_rifa.usuario_id and n.estado <> 'libre';
    get diagnostics v_archivados = row_count;

    update public.numeros_rifa set
        estado = 'libre',
        comprador = null, contacto = null, telefono = null, lid = null, lib = null,
        usuario_global_id = null, grupo_id = null, grupo_nombre = null,
        evento_id = null, identidad_evento_real = null, nombre_evento = null, telefono_bot = null,
        origen = null, ciclo = null,
        reservado_en = null, pagado_en = null, bloqueado_hasta = null,
        temporal_por = null, observaciones = null
     where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and estado <> 'libre';

    perform rifas_privado.auditar(v_rifa, 'reiniciar',
        jsonb_build_array(jsonb_build_object('numero', null, 'antes', 'ciclo ' || v_rifa.ciclo,
                                             'despues', 'ciclo ' || (v_rifa.ciclo + 1), 'resultado', 'ok',
                                             'codigo', v_archivados::text || ' archivados')),
        '{}'::jsonb, p_actor);

    update public.tablas_rifas set ciclo = ciclo + 1 where id = v_rifa.id;

    return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id, 'archivados', v_archivados,
                              'ciclo_anterior', v_rifa.ciclo, 'ciclo', v_rifa.ciclo + 1);
end;
$$;

-- public.rifa_actualizar
create or replace function public.rifa_actualizar(
    p_usuario   uuid,
    p_tabla     uuid,
    p_cambios   jsonb,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa      public.tablas_rifas;
    v_nueva     public.tablas_rifas;
    v_clave     text;
    v_ocupados  integer;
begin
    perform rifas_privado.origen(p_actor);
    if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
        return jsonb_build_object('ok', false, 'motivo', 'sin_cambios');
    end if;
    for v_clave in select jsonb_object_keys(p_cambios) loop
        if v_clave not in ('nombre', 'codigo', 'activa', 'visible', 'config', 'precio', 'cifras', 'cantidad') then
            return jsonb_build_object('ok', false, 'motivo', 'campo_no_permitido', 'campo', v_clave);
        end if;
    end loop;

    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, true);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_archivada');
    end if;

    if p_cambios ?| array['precio', 'cifras', 'cantidad'] then
        select count(*) into v_ocupados from public.numeros_rifa
         where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and estado <> 'libre';
        if v_ocupados > 0 then
            return jsonb_build_object('ok', false, 'motivo', 'rifa_con_numeros_ocupados', 'ocupados', v_ocupados);
        end if;
    end if;

    if p_cambios ? 'codigo' and nullif(btrim(p_cambios ->> 'codigo'), '') is not null and exists (
        select 1 from public.tablas_rifas
         where usuario_id = v_rifa.usuario_id and archivada_en is null and id <> v_rifa.id
           and lower(codigo) = lower(btrim(p_cambios ->> 'codigo'))) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_en_uso');
    end if;

    if p_cambios ? 'config' then
        if not rifas_privado.config_valida(p_cambios -> 'config') then
            return jsonb_build_object('ok', false, 'motivo', 'config_invalida');
        end if;
        update public.configuracion_tabla
           set config = p_cambios -> 'config', version = version + 1, actualizado_en = now()
         where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id;
    end if;

    update public.tablas_rifas set
        nombre   = case when p_cambios ? 'nombre'   then btrim(p_cambios ->> 'nombre') else nombre end,
        codigo   = case when p_cambios ? 'codigo'   then nullif(btrim(p_cambios ->> 'codigo'), '') else codigo end,
        activa   = case when p_cambios ? 'activa'   then (p_cambios ->> 'activa')::boolean else activa end,
        visible  = case when p_cambios ? 'visible'  then (p_cambios ->> 'visible')::boolean else visible end,
        precio   = case when p_cambios ? 'precio'   then (p_cambios ->> 'precio')::integer else precio end,
        cifras   = case when p_cambios ? 'cifras'   then (p_cambios ->> 'cifras')::smallint else cifras end,
        cantidad = case when p_cambios ? 'cantidad' then (p_cambios ->> 'cantidad')::integer else cantidad end
     where id = v_rifa.id
    returning * into v_nueva;

    -- Tamaño nuevo (todos libres, comprobado arriba): quitar o añadir números.
    if v_nueva.cantidad <> v_rifa.cantidad then
        delete from public.numeros_rifa
         where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and numero >= v_nueva.cantidad;
        insert into public.numeros_rifa (tabla_id, usuario_id, numero)
        select v_rifa.id, v_rifa.usuario_id, n from generate_series(v_rifa.cantidad, v_nueva.cantidad - 1) n;
    end if;

    if not v_nueva.activa then
        -- Una rifa desactivada deja de resolverse desde los grupos.
        update public.grupos_rifa set predeterminada = false
         where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and predeterminada;
    end if;

    perform rifas_privado.auditar(v_nueva, 'actualizar_rifa',
        jsonb_build_array(jsonb_build_object('numero', null,
            'antes', (to_jsonb(v_rifa) - 'actualizado_en' - 'creado_en')::text,
            'despues', (to_jsonb(v_nueva) - 'actualizado_en' - 'creado_en')::text,
            'resultado', 'ok')),
        '{}'::jsonb, p_actor);

    return jsonb_build_object('ok', true, 'tabla_id', v_nueva.id, 'rifa', to_jsonb(v_nueva));
end;
$$;

-- public.rifa_archivar
create or replace function public.rifa_archivar(
    p_usuario   uuid,
    p_tabla     uuid,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa public.tablas_rifas;
begin
    perform rifas_privado.origen(p_actor);
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, true);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id, 'ya_archivada', true);
    end if;
    update public.tablas_rifas set activa = false, archivada_en = now() where id = v_rifa.id;
    update public.grupos_rifa set activo = false, predeterminada = false, actualizado_en = now()
     where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and activo;
    perform rifas_privado.auditar(v_rifa, 'archivar',
        jsonb_build_array(jsonb_build_object('numero', null, 'antes', 'vigente', 'despues', 'archivada', 'resultado', 'ok')),
        '{}'::jsonb, p_actor);
    return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id);
end;
$$;

-- public.rifa_restaurar
create or replace function public.rifa_restaurar(
    p_usuario   uuid,
    p_tabla     uuid,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa public.tablas_rifas;
begin
    perform rifas_privado.origen(p_actor);
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, true);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is null then
        return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id, 'no_estaba_archivada', true);
    end if;
    if v_rifa.codigo is not null and exists (
        select 1 from public.tablas_rifas
         where usuario_id = v_rifa.usuario_id and archivada_en is null and lower(codigo) = lower(v_rifa.codigo)) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_en_uso');
    end if;
    -- Vuelve INACTIVA: activarla es otra decisión (rifa_actualizar).
    update public.tablas_rifas set archivada_en = null where id = v_rifa.id;
    perform rifas_privado.auditar(v_rifa, 'restaurar',
        jsonb_build_array(jsonb_build_object('numero', null, 'antes', 'archivada', 'despues', 'inactiva', 'resultado', 'ok')),
        '{}'::jsonb, p_actor);
    return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id);
end;
$$;

-- public.rifa_eliminar
create or replace function public.rifa_eliminar(
    p_usuario   uuid,
    p_tabla     uuid,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa  public.tablas_rifas;
    v_razon text;
    v_t     text;
    v_hay   boolean;
begin
    perform rifas_privado.origen(p_actor);
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, true);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;

    if exists (select 1 from public.numeros_rifa
                where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id and estado <> 'libre') then
        v_razon := 'numeros_ocupados';
    elsif v_rifa.ciclo > 1 or exists (select 1 from public.numeros_rifa_archivo
                                       where tabla_id = v_rifa.id and usuario_id = v_rifa.usuario_id) then
        v_razon := 'tiene_reinicios';
    elsif exists (select 1 from public.reservas_auditoria
                   where usuario_id = v_rifa.usuario_id and tabla_id = v_rifa.id
                     and accion in ('reservar', 'pagar', 'liberar', 'desbloquear', 'bloquear', 'migrar')
                     and resultado = 'ok') then
        v_razon := 'tiene_operaciones';
    end if;

    -- Tablas de sorteos que (tras la 051) guardan tabla_id.
    if v_razon is null then
        foreach v_t in array array['eventos_bot', 'sorteos_programados', 'reservas_actividad'] loop
            if exists (select 1 from pg_catalog.pg_attribute
                        where attrelid = to_regclass('public.' || v_t)
                          and attname = 'tabla_id' and not attisdropped) then
                execute format('select exists (select 1 from public.%I where tabla_id = $1)', v_t)
                   into v_hay using v_rifa.id;
                if v_hay then
                    v_razon := 'usada_en_' || v_t;
                    exit;
                end if;
            end if;
        end loop;
    end if;

    if v_razon is not null then
        return jsonb_build_object('ok', false, 'motivo', 'tiene_historial', 'detalle', v_razon,
                                  'sugerencia', 'archivar');
    end if;

    perform rifas_privado.auditar(v_rifa, 'eliminar_rifa',
        jsonb_build_array(jsonb_build_object('numero', null,
            'antes', (to_jsonb(v_rifa) - 'actualizado_en')::text, 'despues', 'eliminada', 'resultado', 'ok')),
        '{}'::jsonb, p_actor);

    -- Cascada: numeros_rifa, configuracion_tabla, grupos_rifa.
    delete from public.tablas_rifas where id = v_rifa.id and usuario_id = v_rifa.usuario_id;

    return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id, 'eliminada', true);
end;
$$;

-- public.rifa_vincular_grupo
create or replace function public.rifa_vincular_grupo(
    p_usuario        uuid,
    p_grupo          text,
    p_tabla          uuid,
    p_predeterminada boolean default false,
    p_actor          jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa  public.tablas_rifas;
    v_grupo text := nullif(btrim(p_grupo), '');
begin
    perform rifas_privado.origen(p_actor);
    if v_grupo is null then
        return jsonb_build_object('ok', false, 'motivo', 'sin_grupo');
    end if;
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, false);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    if v_rifa.archivada_en is not null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_archivada');
    end if;

    if p_predeterminada then
        update public.grupos_rifa set predeterminada = false, actualizado_en = now()
         where usuario_id = v_rifa.usuario_id and grupo_id = v_grupo and predeterminada and tabla_id <> v_rifa.id;
    end if;

    insert into public.grupos_rifa (usuario_id, grupo_id, tabla_id, predeterminada, activo)
    values (v_rifa.usuario_id, v_grupo, v_rifa.id, coalesce(p_predeterminada, false), true)
    on conflict (usuario_id, grupo_id, tabla_id)
    do update set activo = true, predeterminada = excluded.predeterminada, actualizado_en = now();

    perform rifas_privado.auditar(v_rifa, 'vincular_grupo',
        jsonb_build_array(jsonb_build_object('numero', null, 'antes', null,
            'despues', case when p_predeterminada then 'predeterminada' else 'vinculada' end, 'resultado', 'ok')),
        jsonb_build_object('grupo_id', v_grupo), p_actor);

    return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id, 'grupo_id', v_grupo);
end;
$$;

-- public.rifa_desvincular_grupo
create or replace function public.rifa_desvincular_grupo(
    p_usuario   uuid,
    p_grupo     text,
    p_tabla     uuid,
    p_actor     jsonb default '{"origen": "manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rifa public.tablas_rifas;
    v_n    integer;
begin
    perform rifas_privado.origen(p_actor);
    v_rifa := rifas_privado.rifa_propia(p_usuario, p_tabla, false);
    if v_rifa.id is null then
        return jsonb_build_object('ok', false, 'motivo', 'rifa_no_encontrada');
    end if;
    update public.grupos_rifa set activo = false, predeterminada = false, actualizado_en = now()
     where usuario_id = v_rifa.usuario_id and grupo_id = btrim(p_grupo) and tabla_id = v_rifa.id and activo;
    get diagnostics v_n = row_count;
    if v_n > 0 then
        perform rifas_privado.auditar(v_rifa, 'desvincular_grupo',
            jsonb_build_array(jsonb_build_object('numero', null, 'antes', 'vinculada', 'despues', 'desvinculada', 'resultado', 'ok')),
            jsonb_build_object('grupo_id', btrim(p_grupo)), p_actor);
    end if;
    return jsonb_build_object('ok', true, 'tabla_id', v_rifa.id, 'desvinculado', v_n > 0);
end;
$$;

-- public.rifa_resolver
create or replace function public.rifa_resolver(
    p_usuario   uuid,
    p_grupo     text,
    p_codigo    text default null,
    p_precio    integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_candidatas jsonb;
    v_total      integer;
    v_elegida    uuid;
begin
    if p_usuario is null or nullif(btrim(p_grupo), '') is null then
        return jsonb_build_object('ok', false, 'motivo', 'sin_grupo');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'tabla_id', t.id, 'nombre', t.nombre, 'codigo', t.codigo, 'precio', t.precio,
               'predeterminada', g.predeterminada) order by t.creado_en), '[]'::jsonb),
           count(*)
      into v_candidatas, v_total
      from public.grupos_rifa g
      join public.tablas_rifas t on t.id = g.tabla_id and t.usuario_id = g.usuario_id
     where g.usuario_id = p_usuario and g.grupo_id = btrim(p_grupo) and g.activo
       and t.activa and t.archivada_en is null;

    if v_total = 0 then
        return jsonb_build_object('ok', false, 'motivo', 'sin_rifa');
    end if;

    if p_precio is not null then
        select coalesce(jsonb_agg(c), '[]'::jsonb), count(*)
          into v_candidatas, v_total
          from jsonb_array_elements(v_candidatas) c
         where (c ->> 'precio')::integer = p_precio;
        if v_total = 0 then
            return jsonb_build_object('ok', false, 'motivo', 'sin_rifa_de_ese_precio', 'precio', p_precio);
        end if;
        if nullif(btrim(p_codigo), '') is null then
            if v_total = 1 then
                return jsonb_build_object('ok', true, 'tabla_id', v_candidatas -> 0 ->> 'tabla_id', 'por', 'precio');
            end if;
            return jsonb_build_object('ok', false, 'motivo', 'ambigua', 'precio', p_precio, 'candidatas', v_candidatas);
        end if;
    end if;

    if nullif(btrim(p_codigo), '') is not null then
        select (c ->> 'tabla_id')::uuid into v_elegida
          from jsonb_array_elements(v_candidatas) c
         where lower(c ->> 'codigo') = lower(btrim(p_codigo));
        if v_elegida is null then
            return jsonb_build_object('ok', false, 'motivo', 'codigo_desconocido', 'candidatas', v_candidatas);
        end if;
        return jsonb_build_object('ok', true, 'tabla_id', v_elegida, 'por', 'codigo');
    end if;

    if v_total = 1 then
        return jsonb_build_object('ok', true, 'tabla_id', v_candidatas -> 0 ->> 'tabla_id', 'por', 'unica');
    end if;

    select (c ->> 'tabla_id')::uuid into v_elegida
      from jsonb_array_elements(v_candidatas) c
     where (c ->> 'predeterminada')::boolean;
    if v_elegida is not null then
        return jsonb_build_object('ok', true, 'tabla_id', v_elegida, 'por', 'predeterminada');
    end if;

    return jsonb_build_object('ok', false, 'motivo', 'ambigua', 'candidatas', v_candidatas);
end;
$$;

-- Mismos permisos que la 050: nadie salvo service_role ejecuta las funciones.
do $$
declare
    f regprocedure;
begin
    for f in
        select p.oid::regprocedure from pg_proc p
         where p.pronamespace in ('public'::regnamespace, 'rifas_privado'::regnamespace)
           and (p.proname like 'rifa\_%' or p.pronamespace = 'rifas_privado'::regnamespace)
    loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
    for f in
        select p.oid::regprocedure from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname like 'rifa\_%'
    loop
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;

commit;

-- ------------------------------------------------- verificación (lectura) ---
-- select proname, md5(prosrc) from pg_proc where proname like 'rifa\_%' order by 1;
