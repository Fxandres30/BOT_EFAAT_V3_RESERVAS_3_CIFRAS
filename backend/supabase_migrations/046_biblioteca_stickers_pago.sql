-- ==========================================================================
-- 046 — Biblioteca de stickers de pago (solo el nivel PREDETERMINADO).
--
-- Qué añade:
--   1) Tabla public.stickers_pago_biblioteca: cada sticker que un
--      administrador registra como predeterminado queda guardado aquí (con
--      su imagen) y los anteriores NO se borran.
--   2) Bucket PRIVADO de Storage "stickers-pago", una carpeta por cliente
--      (<usuario_id>/<sha256>.<ext>).
--   3) Carga inicial: el sticker predeterminado que ya existe en
--      configuracion_stickers_pago entra a la biblioteca (sin imagen: de él
--      solo se conoce la huella).
--
-- Qué NO cambia:
--   - configuracion_stickers_pago sigue siendo la ÚNICA fuente que usa la
--     confirmación de pagos (resolverStickerPago / confirmarPagoPorSticker.js
--     no se tocan). La biblioteca es solo consulta y administración: un
--     sticker de la biblioteca que no sea el predeterminado NO confirma pagos.
--   - Los stickers específicos por grupo (grupo_id NOT NULL) no se tocan.
--
-- Aislamiento entre clientes:
--   - RLS: cada usuario solo ve y elimina sus propias filas. El panel NO
--     puede insertar ni actualizar (lo hace solo el backend con service role
--     al capturar el sticker real de WhatsApp).
--   - CHECK: imagen_ruta debe empezar por "<usuario_id>/".
--   - Storage: solo lectura/borrado dentro de la carpeta propia.
--   - anon sin ningún permiso.
--
-- Idempotente. Ejecutar manualmente en el SQL Editor de Supabase. NO
-- aplicada todavía (05/11/2026).
-- ==========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1) Tabla
-- --------------------------------------------------------------------------

create table if not exists public.stickers_pago_biblioteca (

    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null references auth.users(id) on delete cascade,

    -- Hex en minúsculas de fileSha256 (mismo formato que
    -- configuracion_stickers_pago.sticker_sha256).
    sticker_sha256 text not null,

    mimetype text,

    es_animado boolean not null default false,

    -- Ruta dentro del bucket "stickers-pago". NULL = sin vista previa
    -- (p. ej. el predeterminado anterior a esta migración, o una descarga
    -- que falló).
    imagen_ruta text,

    registrado_en timestamptz not null default now(),

    -- JID del administrador que envió el sticker (nunca "bot").
    registrado_por text,

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),

    constraint stickers_pago_biblioteca_unico unique (usuario_id, sticker_sha256),

    constraint stickers_pago_biblioteca_hash_valido
        check (sticker_sha256 ~ '^[0-9a-f]+$'),

    constraint stickers_pago_biblioteca_ruta_propia
        check (imagen_ruta is null or imagen_ruta like usuario_id::text || '/%')

);

create index if not exists stickers_pago_biblioteca_por_usuario
    on public.stickers_pago_biblioteca (usuario_id, registrado_en desc);

alter table public.stickers_pago_biblioteca enable row level security;

revoke all on table public.stickers_pago_biblioteca from anon;
revoke all on table public.stickers_pago_biblioteca from authenticated;
grant select, delete on table public.stickers_pago_biblioteca to authenticated;

drop policy if exists "stickers_pago_biblioteca: dueño lee" on public.stickers_pago_biblioteca;
create policy "stickers_pago_biblioteca: dueño lee"
    on public.stickers_pago_biblioteca for select
    to authenticated
    using (auth.uid() = usuario_id);

drop policy if exists "stickers_pago_biblioteca: dueño elimina" on public.stickers_pago_biblioteca;
create policy "stickers_pago_biblioteca: dueño elimina"
    on public.stickers_pago_biblioteca for delete
    to authenticated
    using (auth.uid() = usuario_id);

-- --------------------------------------------------------------------------
-- 2) Bucket privado de Storage
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('stickers-pago', 'stickers-pago', false, 2097152)
on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit;

drop policy if exists "stickers-pago: dueño lee" on storage.objects;
create policy "stickers-pago: dueño lee"
    on storage.objects for select
    to authenticated
    using (
        bucket_id = 'stickers-pago'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "stickers-pago: dueño elimina" on storage.objects;
create policy "stickers-pago: dueño elimina"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'stickers-pago'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Sin policy de INSERT/UPDATE: solo el backend (service role) sube imágenes.

-- --------------------------------------------------------------------------
-- 3) Carga inicial: no perder el predeterminado existente
-- --------------------------------------------------------------------------

insert into public.stickers_pago_biblioteca
    (usuario_id, sticker_sha256, registrado_en, registrado_por)
select
    c.usuario_id,
    lower(trim(c.sticker_sha256)),
    coalesce(c.registrado_en, c.actualizado_en, now()),
    c.registrado_por
from public.configuracion_stickers_pago c
where c.grupo_id is null
  and c.sticker_sha256 is not null
  and lower(trim(c.sticker_sha256)) ~ '^[0-9a-f]+$'
on conflict (usuario_id, sticker_sha256) do nothing;

-- --------------------------------------------------------------------------
-- 4) Realtime (para que la galería se actualice sola al registrar)
-- --------------------------------------------------------------------------

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = 'stickers_pago_biblioteca'
       ) then
        alter publication supabase_realtime add table public.stickers_pago_biblioteca;
    end if;
end $$;

commit;

-- --------------------------------------------------------------------------
-- Verificación (solo lectura) después de aplicar:
--
--   select count(*) from public.stickers_pago_biblioteca;
--   select count(*) from public.configuracion_stickers_pago
--    where grupo_id is null and sticker_sha256 is not null;   -- deben coincidir
--   select id, public, file_size_limit from storage.buckets where id = 'stickers-pago';
--   select polname from pg_policy where polrelid = 'storage.objects'::regclass
--    and polname like 'stickers-pago:%';
--
-- Reversión (solo si hiciera falta; borra la biblioteca, NO el predeterminado):
--
--   drop table if exists public.stickers_pago_biblioteca;
--   drop policy if exists "stickers-pago: dueño lee" on storage.objects;
--   drop policy if exists "stickers-pago: dueño elimina" on storage.objects;
--   -- el bucket se vacía y borra desde el panel de Storage.
-- --------------------------------------------------------------------------
