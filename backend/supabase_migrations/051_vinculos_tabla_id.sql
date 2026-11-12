-- ==========================================================================
-- 051 — VÍNCULOS tabla_id EN SORTEOS E HISTORIAL (motor único de rifas)
--
-- PREPARADA EL 2026-11-12. NO APLICADA. Requiere autorización expresa.
-- Orden: 032 -> 050 -> 051 -> 052 (052 = migración de datos, en la ventana
-- de cambio). Diseño: docs/rifas/MOTOR_RIFAS.md
--
-- QUÉ HACE (solo añade; no mueve ni borra datos):
--   1. Columna tabla_id (uuid, NULL) en eventos_bot, sorteos_programados,
--      reservas_actividad y reservas_archivo, con FK COMPUESTA
--      (tabla_id, usuario_id) -> tablas_rifas(id, usuario_id) ON DELETE
--      RESTRICT: un sorteo o una fila de historial nunca puede apuntar a la
--      rifa de otro cliente, y una rifa con historial no se puede borrar.
--      Las filas actuales quedan con tabla_id NULL (la 052 rellena las que
--      se pueden atribuir sin ambigüedad).
--   2. Índices por tabla_id.
--   3. rifas_migracion_mapa: registro de la 052 (cliente + precio + tabla
--      física antigua -> tabla_id). Solo lo usa la migración; nadie lo lee
--      desde la API.
--
-- Comprobado contra producción (12/11, solo lectura): las cuatro tablas
-- existen y su usuario_id es uuid. Si alguna no existe, se omite con aviso.
-- ==========================================================================

begin;

do $$
begin
    if to_regclass('public.tablas_rifas') is null then
        raise exception '051: falta la 050 (tablas_rifas)';
    end if;
    if to_regclass('public.rifas_migracion_mapa') is not null then
        raise exception '051: ya aplicada (existe rifas_migracion_mapa)';
    end if;
end $$;

do $$
declare
    t text;
    v_tipo text;
begin
    foreach t in array array['eventos_bot', 'sorteos_programados', 'reservas_actividad', 'reservas_archivo'] loop
        if to_regclass('public.' || t) is null then
            raise notice '051: % no existe; se omite', t;
            continue;
        end if;
        select format_type(a.atttypid, a.atttypmod) into v_tipo
          from pg_attribute a
         where a.attrelid = ('public.' || t)::regclass and a.attname = 'usuario_id' and not a.attisdropped;
        if v_tipo is distinct from 'uuid' then
            raise exception '051: %.usuario_id es % (se esperaba uuid); no se aplica nada', t, coalesce(v_tipo, 'inexistente');
        end if;
        if exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass
                    and attname = 'tabla_id' and not attisdropped) then
            raise exception '051: %.tabla_id ya existe; no se aplica nada', t;
        end if;

        execute format('alter table public.%I add column tabla_id uuid', t);
        execute format('alter table public.%I add constraint %I foreign key (tabla_id, usuario_id)
                            references public.tablas_rifas (id, usuario_id) on delete restrict',
                       t, t || '_rifa_fk');
        execute format('create index %I on public.%I (tabla_id) where tabla_id is not null', t || '_por_rifa', t);
    end loop;
end $$;

create table public.rifas_migracion_mapa (
    usuario_id      uuid not null,
    precio          integer not null,
    tabla_legado    text not null,
    tabla_id        uuid not null unique,
    archivados      integer not null default 0,
    migrado_en      timestamptz not null default now(),
    primary key (usuario_id, precio, tabla_legado),
    constraint rifas_migracion_mapa_rifa_fk foreign key (tabla_id, usuario_id)
        references public.tablas_rifas (id, usuario_id) on delete restrict
);

alter table public.rifas_migracion_mapa enable row level security;
revoke all on table public.rifas_migracion_mapa from public, anon, authenticated, service_role;
grant select on table public.rifas_migracion_mapa to service_role;

commit;

-- ------------------------------------------------- verificación (lectura) ---
-- select conrelid::regclass, conname from pg_constraint where conname like '%\_rifa\_fk';
--   Esperado: eventos_bot, sorteos_programados, reservas_actividad, reservas_archivo,
--             rifas_migracion_mapa (+ las de la 050).
