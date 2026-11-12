-- ==========================================================================
-- 050 — MOTOR ÚNICO DE RIFAS (tablas_rifas + numeros_rifa)
--
-- PREPARADA EL 2026-11-12. NO APLICADA. Requiere autorización expresa.
-- Diseño: docs/rifas/MOTOR_RIFAS.md
-- Pruebas: backend/tests/rifas/motorRifasSql.test.js (PGlite)
--          backend/tests/rifas/concurrenciaRifas.test.js (Postgres real local)
--
-- QUÉ ES
--   Un solo motor para TODAS las rifas de TODOS los clientes. La identidad de
--   una rifa es su UUID (tabla_id) y su dueño (usuario_id = auth.users.id,
--   el cliente del SaaS). El precio es un DATO de la rifa, nunca su
--   identidad: un cliente puede tener varias rifas del mismo precio y dos
--   clientes pueden tener cada uno su número 25 sin conflicto.
--
-- QUÉ CREA (solo objetos nuevos)
--   public.tablas_rifas            registro de rifas (dueño, nombre, precio, cifras, cantidad...)
--   public.configuracion_tabla     configuración propia de cada rifa (jsonb validado)
--   public.numeros_rifa            todos los números de todas las rifas
--   public.numeros_rifa_archivo    copia inmutable de los números al reiniciar
--   public.grupos_rifa             vínculo explícito grupo de WhatsApp -> rifa
--   public.rifas_resumen           vista con conteos (respeta RLS: security_invoker)
--   schema rifas_privado           funciones auxiliares, fuera de la API
--   public.rifa_*                  operaciones transaccionales (solo service_role)
--
-- QUÉ TOCA DE LO EXISTENTE (aditivo y reversible, ver 050_revertir...)
--   public.reservas_auditoria (032): + columnas tabla_id y ciclo, + un índice,
--     y amplía los CHECK de "accion" y "origen" (solo añade valores; todas las
--     filas existentes siguen siendo válidas).
--   Publicación supabase_realtime: + numeros_rifa y tablas_rifas (si existe).
--   NO toca las cuadrículas antiguas, tablas_cliente, eventos_bot, sorteos,
--   sesiones, grupos, usuarios ni auth. NO mueve ni borra datos.
--
-- SEGURIDAD (tres capas)
--   1. Integridad: FK COMPUESTA (tabla_id, usuario_id) -> tablas_rifas(id,
--      usuario_id). Un número no puede tener un dueño distinto al de su rifa;
--      un trigger impide cambiar después tabla_id, usuario_id o numero.
--   2. Escritura: NADIE escribe directamente. Ni anon, ni authenticated, ni
--      service_role tienen INSERT/UPDATE/DELETE sobre las tablas del motor.
--      Solo las funciones public.rifa_* (SECURITY DEFINER, search_path
--      vacío) escriben, y solo service_role (el backend) puede ejecutarlas.
--      Cada función exige p_usuario y comprueba que la rifa es suya; si no,
--      responde "rifa_no_encontrada" (igual que si no existiera: no revela
--      rifas ajenas).
--   3. Lectura: RLS. authenticated solo LEE sus propias filas
--      (usuario_id = auth.uid()). anon no lee nada.
--
-- CONCURRENCIA
--   Cada operación bloquea la rifa (FOR SHARE; reiniciar/actualizar usan FOR
--   UPDATE) y luego las filas de los números en orden ascendente (FOR
--   UPDATE). Dos reservas simultáneas del mismo número: la segunda espera,
--   relee y ya no lo ve libre. El orden fijo evita interbloqueos. Además
--   UNIQUE(tabla_id, numero) impide duplicar un número en la misma rifa.
--
-- ORDEN DE APLICACIÓN: 032 (reservas_auditoria) -> 050. La 050 aborta si
-- falta la 032 o si alguno de sus objetos ya existe (no se re-aplica a
-- medias). Todo va en una transacción: si algo falla, no queda nada.
-- ==========================================================================

begin;

-- --------------------------------------------------------------- guardias ---
do $$
begin
    if to_regclass('auth.users') is null then
        raise exception '050: no existe auth.users';
    end if;
    if to_regprocedure('auth.uid()') is null then
        raise exception '050: no existe auth.uid()';
    end if;
    if to_regclass('public.reservas_auditoria') is null then
        raise exception '050: falta public.reservas_auditoria; aplicar antes la 032';
    end if;
    if to_regclass('public.tablas_rifas') is not null
       or to_regclass('public.numeros_rifa') is not null
       or to_regclass('public.configuracion_tabla') is not null
       or to_regclass('public.numeros_rifa_archivo') is not null
       or to_regclass('public.grupos_rifa') is not null
       or to_regnamespace('rifas_privado') is not null then
        raise exception '050: ya existen objetos del motor de rifas; no se vuelve a aplicar';
    end if;
end $$;

create schema rifas_privado;
revoke all on schema rifas_privado from public;

-- ==========================================================================
-- 1. TABLAS
-- ==========================================================================

-- Registro de rifas. Una fila = una rifa independiente.
create table public.tablas_rifas (
    id              uuid primary key default gen_random_uuid(),
    usuario_id      uuid not null references auth.users (id) on delete restrict,
    nombre          text not null check (char_length(btrim(nombre)) between 1 and 80),
    -- Identificador corto opcional que el administrador elige ("A", "tarde").
    -- Sirve para indicar en WhatsApp a qué rifa va un mensaje cuando un grupo
    -- tiene varias (ver rifa_resolver). Único por cliente entre las vigentes.
    codigo          text check (codigo is null or codigo ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$'),
    precio          integer not null check (precio > 0 and precio <= 100000000),
    cifras          smallint not null check (cifras between 1 and 4),
    cantidad        integer not null check (cantidad >= 1 and cantidad <= 10000),
    activa          boolean not null default true,
    visible         boolean not null default true,
    -- Vuelta de la rifa: sube en cada reinicio. Las reservas y el archivo
    -- guardan el ciclo, así el historial distingue una vuelta de otra.
    ciclo           integer not null default 1 check (ciclo >= 1),
    archivada_en    timestamptz,
    creado_en       timestamptz not null default now(),
    actualizado_en  timestamptz not null default now(),
    constraint tablas_rifas_cantidad_cabe check (cantidad <= (10 ^ cifras)::integer),
    constraint tablas_rifas_archivada_inactiva check (archivada_en is null or activa = false),
    -- Destino de las FK compuestas: garantiza que (rifa, dueño) va junto.
    constraint tablas_rifas_id_usuario unique (id, usuario_id)
);

create unique index tablas_rifas_codigo_unico
    on public.tablas_rifas (usuario_id, lower(codigo))
    where codigo is not null and archivada_en is null;

create index tablas_rifas_por_usuario
    on public.tablas_rifas (usuario_id, activa, creado_en desc)
    where archivada_en is null;

-- Validación de la configuración de una rifa. Secciones admitidas:
--   mensajes  (objeto libre: textos/plantillas propias de la rifa)
--   reservas  { expiracion_minutos 0..10080, max_por_persona 1..10000,
--               permitir_bot bool, permitir_panel bool }
--   pagos     (objeto libre: cuentas, instrucciones, stickers)
--   sorteo    (objeto libre: lotería, fecha, premios)
--   opciones  (objeto libre)
-- Precio, cifras y cantidad NO van aquí: viven en tablas_rifas (una sola
-- fuente de verdad).
create function rifas_privado.config_valida(c jsonb)
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

create table public.configuracion_tabla (
    tabla_id        uuid primary key,
    usuario_id      uuid not null,
    config          jsonb not null default '{}'::jsonb,
    version         integer not null default 1,
    actualizado_en  timestamptz not null default now(),
    constraint configuracion_tabla_rifa_fk foreign key (tabla_id, usuario_id)
        references public.tablas_rifas (id, usuario_id) on delete cascade,
    constraint configuracion_tabla_valida check (rifas_privado.config_valida(config))
);

-- Todos los números de todas las rifas.
create table public.numeros_rifa (
    id                      uuid primary key default gen_random_uuid(),
    tabla_id                uuid not null,
    usuario_id              uuid not null,
    numero                  integer not null check (numero >= 0 and numero < 10000),
    estado                  text not null default 'libre'
                            check (estado in ('libre', 'reservado', 'en_proceso', 'pagado', 'bloqueado')),

    -- Quién lo tiene. Mismos datos que las cuadrículas antiguas.
    comprador               text check (comprador is null or char_length(comprador) <= 200),
    contacto                text check (contacto is null or char_length(contacto) <= 200),
    telefono                text check (telefono is null or char_length(telefono) <= 40),
    lid                     text check (lid is null or char_length(lid) <= 200),
    lib                     text check (lib is null or char_length(lib) <= 200),
    -- public.usuarios.id (persona de WhatsApp, compartida entre clientes).
    -- Sin FK a propósito, como en reservas_auditoria: el número no debe
    -- romperse si la identidad se fusiona o se borra.
    usuario_global_id       uuid,

    -- Contexto de la operación (historia, no identidad de la rifa).
    grupo_id                text check (grupo_id is null or char_length(grupo_id) <= 200),
    grupo_nombre            text check (grupo_nombre is null or char_length(grupo_nombre) <= 200),
    evento_id               uuid,
    identidad_evento_real   text check (identidad_evento_real is null or char_length(identidad_evento_real) <= 200),
    origen                  text check (origen is null or origen in ('bot', 'manual', 'sistema', 'migracion')),
    ciclo                   integer,

    reservado_en            timestamptz,
    pagado_en               timestamptz,
    bloqueado_hasta         timestamptz,
    temporal_por            text check (temporal_por is null or char_length(temporal_por) <= 200),
    observaciones           text check (observaciones is null or char_length(observaciones) <= 1000),

    version                 integer not null default 0,
    actualizado_en          timestamptz not null default now(),

    constraint numeros_rifa_rifa_fk foreign key (tabla_id, usuario_id)
        references public.tablas_rifas (id, usuario_id) on delete cascade,
    constraint numeros_rifa_numero_unico unique (tabla_id, numero),
    -- Un número libre no conserva datos de nadie.
    constraint numeros_rifa_libre_sin_datos check (
        estado <> 'libre' or (
            comprador is null and contacto is null and telefono is null and lid is null
            and lib is null and usuario_global_id is null and evento_id is null
            and identidad_evento_real is null and reservado_en is null and pagado_en is null)),
    constraint numeros_rifa_pagado_con_fecha check (estado <> 'pagado' or pagado_en is not null)
);

create index numeros_rifa_por_estado   on public.numeros_rifa (tabla_id, estado, numero);
create index numeros_rifa_por_usuario  on public.numeros_rifa (usuario_id, tabla_id);
create index numeros_rifa_por_telefono on public.numeros_rifa (usuario_id, telefono) where telefono is not null;
create index numeros_rifa_por_lid      on public.numeros_rifa (usuario_id, lid) where lid is not null;
create index numeros_rifa_por_persona  on public.numeros_rifa (usuario_id, usuario_global_id) where usuario_global_id is not null;
create index numeros_rifa_por_evento   on public.numeros_rifa (evento_id) where evento_id is not null;

-- Copia inmutable de los números ocupados en cada reinicio. ON DELETE
-- RESTRICT: una rifa con archivo no se puede borrar (solo archivar).
create table public.numeros_rifa_archivo (
    id              uuid primary key default gen_random_uuid(),
    tabla_id        uuid not null,
    usuario_id      uuid not null,
    ciclo           integer not null,
    numero          integer not null,
    estado          text not null,
    fila            jsonb not null,
    motivo          text not null check (char_length(motivo) <= 500),
    archivado_en    timestamptz not null default now(),
    constraint numeros_rifa_archivo_rifa_fk foreign key (tabla_id, usuario_id)
        references public.tablas_rifas (id, usuario_id) on delete restrict
);

create index numeros_rifa_archivo_por_rifa
    on public.numeros_rifa_archivo (usuario_id, tabla_id, ciclo, numero);

-- Vínculo EXPLÍCITO grupo de WhatsApp -> rifa, por cliente. El mismo grupo
-- puede tener vínculos de varios clientes (cada uno con su bot): cada uno
-- solo ve y resuelve los suyos.
create table public.grupos_rifa (
    id              uuid primary key default gen_random_uuid(),
    usuario_id      uuid not null,
    grupo_id        text not null check (char_length(grupo_id) between 1 and 200),
    tabla_id        uuid not null,
    predeterminada  boolean not null default false,
    activo          boolean not null default true,
    creado_en       timestamptz not null default now(),
    actualizado_en  timestamptz not null default now(),
    constraint grupos_rifa_rifa_fk foreign key (tabla_id, usuario_id)
        references public.tablas_rifas (id, usuario_id) on delete cascade,
    constraint grupos_rifa_unico unique (usuario_id, grupo_id, tabla_id),
    constraint grupos_rifa_predeterminada_activa check (not predeterminada or activo)
);

create unique index grupos_rifa_una_predeterminada
    on public.grupos_rifa (usuario_id, grupo_id) where activo and predeterminada;

create index grupos_rifa_por_grupo
    on public.grupos_rifa (usuario_id, grupo_id) where activo;

-- ==========================================================================
-- 2. TRIGGERS DE INTEGRIDAD
-- ==========================================================================

create function rifas_privado.numero_en_rango()
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

create trigger numeros_rifa_en_rango
    before insert on public.numeros_rifa
    for each row execute function rifas_privado.numero_en_rango();

create function rifas_privado.numero_inmutable()
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

create trigger numeros_rifa_inmutable
    before update on public.numeros_rifa
    for each row execute function rifas_privado.numero_inmutable();

create function rifas_privado.rifa_dueno_inmutable()
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

create trigger tablas_rifas_dueno_inmutable
    before update on public.tablas_rifas
    for each row execute function rifas_privado.rifa_dueno_inmutable();

create function rifas_privado.archivo_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'numeros_rifa_archivo es de solo inserción (% no permitido)', tg_op using errcode = '42501';
end;
$$;

create trigger numeros_rifa_archivo_sin_cambios
    before update or delete on public.numeros_rifa_archivo
    for each row execute function rifas_privado.archivo_inmutable();

create trigger numeros_rifa_archivo_sin_truncate
    before truncate on public.numeros_rifa_archivo
    for each statement execute function rifas_privado.archivo_inmutable();

-- ==========================================================================
-- 3. AUDITORÍA: reservas_auditoria (032) aprende tabla_id y ciclo
-- ==========================================================================

alter table public.reservas_auditoria add column tabla_id uuid;
alter table public.reservas_auditoria add column ciclo integer;

create index reservas_auditoria_por_rifa
    on public.reservas_auditoria (usuario_id, tabla_id, numero, creado_en desc)
    where tabla_id is not null;

-- Los CHECK de "accion" y "origen" se sustituyen por versiones que SOLO
-- AÑADEN valores. Se localizan por su definición (la 032 no les dio nombre).
do $$
declare
    r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.reservas_auditoria'::regclass
           and contype = 'c'
           and (pg_get_constraintdef(oid) like '%accion%' or pg_get_constraintdef(oid) like '%origen%')
    loop
        execute format('alter table public.reservas_auditoria drop constraint %I', r.conname);
    end loop;
end $$;

alter table public.reservas_auditoria add constraint reservas_auditoria_accion_check check (accion in (
    'reservar', 'pagar', 'liberar', 'desbloquear',
    'bloquear', 'crear_rifa', 'actualizar_rifa', 'reiniciar', 'archivar', 'restaurar',
    'eliminar_rifa', 'vincular_grupo', 'desvincular_grupo', 'migrar'));

alter table public.reservas_auditoria add constraint reservas_auditoria_origen_check check (origen in (
    'manual', 'bot', 'sistema', 'migracion'));

-- ==========================================================================
-- 4. FUNCIONES AUXILIARES (rifas_privado, fuera de la API)
-- ==========================================================================

-- Origen válido de la operación.
create function rifas_privado.origen(p_actor jsonb)
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

create function rifas_privado.uuid_o_error(p text, p_campo text)
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

create function rifas_privado.texto(p jsonb, p_campo text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
    select nullif(left(btrim(p ->> p_campo), p_max), '');
$$;

-- La rifa del cliente, bloqueada. NULL si no existe o es de otro cliente
-- (el llamador responde lo mismo en ambos casos).
create function rifas_privado.rifa_propia(p_usuario uuid, p_tabla uuid, p_exclusiva boolean)
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

-- Lista de números pedida: sin nulos ni repetidos, ordenada, máximo 1000.
create function rifas_privado.numeros_pedidos(p integer[])
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

-- Escribe en reservas_auditoria una fila por número.
--   p_filas: [{numero, antes, despues, resultado, codigo}]
create function rifas_privado.auditar(
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

-- ==========================================================================
-- 5. OPERACIONES (public.rifa_*) — solo service_role
--    p_usuario: dueño VALIDADO por el backend (token del panel o dueño de la
--               sesión de WhatsApp). Nunca un dato que venga del navegador o
--               del mensaje.
--    p_actor:   { origen: bot|manual|sistema|migracion, operador_id,
--                 operador_email, solicitud_id, motivo }
--    Respuesta: jsonb { ok: true, ... } o { ok: false, motivo, ... }.
-- ==========================================================================

-- ------------------------------------------------------------ crear ---
create function public.rifa_crear(
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

-- ---------------------------------------------------------- reservar ---
-- p_datos: comprador, contacto, telefono, lid, lib, usuario_global_id,
--          grupo_id, grupo_nombre, evento_id, identidad_evento_real
-- p_todo_o_nada: true = si alguno no está libre, no se reserva ninguno.
create function public.rifa_reservar(
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

-- Filtro opcional de titular (p_datos.titular = {telefono, lid, usuario_global_id}):
-- solo se tocan los números cuyo titular coincide en al menos uno de los
-- datos dados. Lo usa el bot para "pagué"/"libera mis números".
create function rifas_privado.es_del_titular(n public.numeros_rifa, t jsonb)
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

-- -------------------------------------------------------------- pagar ---
create function public.rifa_pagar(
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

-- ------------------------------------------------------------ liberar ---
-- p_opciones: { incluir_pagados: bool, incluir_bloqueados: bool }
create function public.rifa_liberar(
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

    select coalesce(jsonb_object_agg(numero::text, jsonb_build_object('estado', estado, 'titular', titular)), '{}'::jsonb)
      into v_filas
      from (select n.numero, n.estado, rifas_privado.es_del_titular(n, v_datos -> 'titular') as titular
              from public.numeros_rifa n
             where n.tabla_id = v_rifa.id and n.usuario_id = v_rifa.usuario_id and n.numero = any(v_pedidos)
             order by n.numero
               for update) b;

    v_liberables := array(select n from unnest(v_pedidos) n
                           where v_filas #>> array[n::text, 'estado'] = any(v_estados)
                             and (v_filas #>> array[n::text, 'titular'])::boolean
                           order by n);

    with u as (
        update public.numeros_rifa set
            estado = 'libre',
            comprador = null, contacto = null, telefono = null, lid = null, lib = null,
            usuario_global_id = null, grupo_id = null, grupo_nombre = null,
            evento_id = null, identidad_evento_real = null, origen = null, ciclo = null,
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

-- ----------------------------------------------------------- bloquear ---
create function public.rifa_bloquear(
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

-- ---------------------------------------------------------- reiniciar ---
-- Archiva todos los números ocupados en numeros_rifa_archivo, deja la rifa
-- entera libre y sube el ciclo. Exige p_confirmacion = 'REINICIAR'.
-- Bloquea la rifa en exclusiva: ninguna reserva puede colarse a la vez.
-- El backend debe comprobar antes que no hay un sorteo en curso que dependa
-- de estos números (eso vive en eventos_bot, fuera de esta migración).
create function public.rifa_reiniciar(
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
        evento_id = null, identidad_evento_real = null, origen = null, ciclo = null,
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

-- --------------------------------------------------------- actualizar ---
-- p_cambios admite: nombre, codigo, activa, visible, config, precio, cifras,
-- cantidad. precio/cifras/cantidad solo con TODOS los números libres (no se
-- cambia el precio ni el tamaño de una rifa con ventas).
create function public.rifa_actualizar(
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

-- ----------------------------------------------- archivar / restaurar ---
-- Archivar = "eliminar" con historial: la rifa deja de estar activa, sale de
-- los grupos y no admite operaciones; sus números y su historial se quedan.
create function public.rifa_archivar(
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

create function public.rifa_restaurar(
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

-- ---------------------------------------------------------- eliminar ---
-- Borrado REAL solo de una rifa que nunca se usó: ningún número ocupado,
-- ningún reinicio (ciclo 1, sin archivo), ninguna operación de números en la
-- auditoría y ningún sorteo/evento que la nombre (si esas tablas ya tienen
-- tabla_id). En cualquier otro caso responde "tiene_historial": hay que
-- archivarla. La auditoría de la rifa se conserva siempre.
create function public.rifa_eliminar(
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

-- --------------------------------------------- grupos: vincular/desvincular ---
create function public.rifa_vincular_grupo(
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

create function public.rifa_desvincular_grupo(
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

-- ------------------------------------------------------------ resolver ---
-- ¿A qué rifa va un mensaje de este grupo, para ESTE cliente?
-- Solo mira los vínculos explícitos del cliente (grupos_rifa) con rifas
-- activas y no archivadas. NUNCA elige por precio y NUNCA elige al azar:
--   1. con p_codigo: la rifa vinculada con ese código, o "codigo_desconocido";
--   2. un solo vínculo: esa rifa;
--   3. varios: la marcada como predeterminada del grupo;
--   4. si no: "ambigua" con la lista de candidatas, para avisar al
--      administrador. "sin_rifa" si el grupo no tiene ninguna.
create function public.rifa_resolver(
    p_usuario   uuid,
    p_grupo     text,
    p_codigo    text default null
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

-- ==========================================================================
-- 6. VISTA DE RESUMEN (respeta la RLS de quien consulta)
-- ==========================================================================
create view public.rifas_resumen
with (security_invoker = true)
as
select t.id as tabla_id, t.usuario_id, t.nombre, t.codigo, t.precio, t.cifras, t.cantidad,
       t.activa, t.visible, t.ciclo, t.archivada_en, t.creado_en,
       count(n.id) filter (where n.estado = 'libre')       as libres,
       count(n.id) filter (where n.estado = 'reservado')   as reservados,
       count(n.id) filter (where n.estado = 'en_proceso')  as en_proceso,
       count(n.id) filter (where n.estado = 'pagado')      as pagados,
       count(n.id) filter (where n.estado = 'bloqueado')   as bloqueados,
       count(n.id)                                         as total
  from public.tablas_rifas t
  left join public.numeros_rifa n on n.tabla_id = t.id and n.usuario_id = t.usuario_id
 group by t.id;

-- ==========================================================================
-- 7. PERMISOS Y RLS
--    Supabase concede por defecto TODO a anon y authenticated en las tablas
--    nuevas de public: se revoca explícitamente.
-- ==========================================================================

alter table public.tablas_rifas         enable row level security;
alter table public.configuracion_tabla  enable row level security;
alter table public.numeros_rifa         enable row level security;
alter table public.numeros_rifa_archivo enable row level security;
alter table public.grupos_rifa          enable row level security;

revoke all on table public.tablas_rifas, public.configuracion_tabla, public.numeros_rifa,
                    public.numeros_rifa_archivo, public.grupos_rifa, public.rifas_resumen
    from public, anon, authenticated, service_role;

-- Lectura: el panel (authenticated, filtrado por RLS) y el backend.
-- Escritura: NADIE directamente; solo las funciones rifa_*.
grant select on table public.tablas_rifas, public.configuracion_tabla, public.numeros_rifa,
                      public.numeros_rifa_archivo, public.grupos_rifa, public.rifas_resumen
    to authenticated, service_role;

create policy "cliente lee sus rifas" on public.tablas_rifas
    for select to authenticated using (usuario_id = (select auth.uid()));
create policy "cliente lee la configuracion de sus rifas" on public.configuracion_tabla
    for select to authenticated using (usuario_id = (select auth.uid()));
create policy "cliente lee sus numeros" on public.numeros_rifa
    for select to authenticated using (usuario_id = (select auth.uid()));
create policy "cliente lee su archivo" on public.numeros_rifa_archivo
    for select to authenticated using (usuario_id = (select auth.uid()));
create policy "cliente lee sus grupos de rifa" on public.grupos_rifa
    for select to authenticated using (usuario_id = (select auth.uid()));
-- Sin políticas INSERT/UPDATE/DELETE: además de no tener el permiso, la RLS
-- también lo negaría.

-- Funciones: nadie salvo service_role (el backend).
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

-- Realtime del panel (respeta la RLS de lectura).
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.numeros_rifa, public.tablas_rifas;
    end if;
end $$;

commit;

-- ------------------------------------------------- verificación (lectura) ---
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'numeros_rifa' order by 1, 2;
--   Esperado: authenticated -> SELECT; service_role -> SELECT; anon -> nada.
-- select p.proname, array_agg(a.grantee::regrole) from pg_proc p, aclexplode(p.proacl) a
--  where p.proname like 'rifa\_%' and a.privilege_type = 'EXECUTE' group by 1;
--   Esperado: solo postgres (dueño) y service_role.
