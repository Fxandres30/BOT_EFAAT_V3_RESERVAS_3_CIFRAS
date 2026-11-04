-- Calendario de loterías: FRECUENCIA del sorteo (semanal | mensual).
--
-- Requiere la 025 (loterias_catalogo). La 026 es opcional: si existe
-- loterias_catalogo_global también recibe la columna.
--
-- Por qué: el listado del administrador incluye el «Extra de Colombia»,
-- que es MENSUAL (sábado 11:00 PM; el listado no dice qué sábado del mes).
-- Sin esta columna el backend ya funciona: deduce la frecuencia de la
-- configuración inicial (catalogoBase.js), pero el cliente no puede cambiarla.
--
-- Datos: solo añade la columna con valor por defecto 'semanal' y marca como
-- 'mensual' las filas «Extra de Colombia / Mensual» (en el global y en los
-- calendarios de los clientes): ningún cliente pudo elegir otra frecuencia
-- antes de existir la columna. En el catálogo global (no en los clientes)
-- corrige los nombres «La Caribeña» y «El Samán de la Suerte» sin cambiar
-- su clave. No toca horarios, reservas, pagos ni sorteos.
-- Idempotente. Ejecutar manualmente en el SQL Editor de Supabase.

alter table public.loterias_catalogo
    add column if not exists frecuencia text not null default 'semanal';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'loterias_catalogo_frecuencia_valida') then
        alter table public.loterias_catalogo
            add constraint loterias_catalogo_frecuencia_valida check (frecuencia in ('semanal', 'mensual'));
    end if;
end $$;

update public.loterias_catalogo
set frecuencia = 'mensual', actualizado_en = now()
where lower(nombre) = 'extra de colombia' and lower(modalidad) = 'mensual' and frecuencia <> 'mensual';

do $$
begin
    if to_regclass('public.loterias_catalogo_global') is not null then
        alter table public.loterias_catalogo_global
            add column if not exists frecuencia text not null default 'semanal';
        if not exists (select 1 from pg_constraint where conname = 'loterias_catalogo_global_frecuencia_valida') then
            alter table public.loterias_catalogo_global
                add constraint loterias_catalogo_global_frecuencia_valida check (frecuencia in ('semanal', 'mensual'));
        end if;
        update public.loterias_catalogo_global
        set frecuencia = 'mensual', actualizado_en = now()
        where clave = 'extra de colombia|mensual' and frecuencia <> 'mensual';

        -- Nombres exactos del listado («La Caribeña», «El Samán de la
        -- Suerte»). Solo el CATÁLOGO GLOBAL; la clave no cambia, así que las
        -- copias ya hechas (origen_global_id) y las marcas de «ofrecida»
        -- siguen enlazadas. Los calendarios de los clientes NO se renombran.
        update public.loterias_catalogo_global set nombre = 'La Caribeña', actualizado_en = now()
        where clave in ('caribeña|día', 'caribeña|noche') and nombre = 'Caribeña';
        update public.loterias_catalogo_global set nombre = 'El Samán de la Suerte', actualizado_en = now()
        where clave = 'samán de la suerte|' and nombre = 'Samán de la Suerte';
    end if;
end $$;

-- Que la API (PostgREST) vea la columna nueva sin esperar.
notify pgrst, 'reload schema';

-- Verificación (solo lectura):
--   select frecuencia, count(*) from public.loterias_catalogo group by 1;
--   select nombre, modalidad, frecuencia from public.loterias_catalogo where frecuencia = 'mensual';
--
-- Reversión:
--   alter table public.loterias_catalogo drop constraint if exists loterias_catalogo_frecuencia_valida;
--   alter table public.loterias_catalogo drop column if exists frecuencia;
--   alter table if exists public.loterias_catalogo_global drop constraint if exists loterias_catalogo_global_frecuencia_valida;
--   alter table if exists public.loterias_catalogo_global drop column if exists frecuencia;
--   update public.loterias_catalogo_global set nombre = 'Caribeña' where clave in ('caribeña|día', 'caribeña|noche');
--   update public.loterias_catalogo_global set nombre = 'Samán de la Suerte' where clave = 'samán de la suerte|';
--   (el backend funciona con o sin la columna: sin ella deduce la frecuencia)
