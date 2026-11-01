-- ==========================================================================
-- SOLO LECTURA — sorteos cuyo mensaje de publicación NO se puede publicar
-- bien con un backend ANTERIOR al sistema de 20 diseños.
--
-- PREPARADO EL 2026-10-31. Se ejecuta en una transacción READ ONLY que
-- termina en ROLLBACK: no modifica nada. Uso: paso 1 y paso 5 de
-- docs/activacion/REVERSION_BACKEND_MENSAJES.md.
--
-- Un backend anterior:
--   · NO conoce las 11 variables nuevas: las enviaría tal cual a WhatsApp
--     (p. ej. «{{fecha_titulo}}»);
--   · NO conoce publicacion_meta.activo: un mensaje DESACTIVADO se
--     publicaría CON su texto.
-- Debe devolver 0 filas antes de volver a un backend anterior.
--
-- Solo lista identificadores y metadatos; nunca el texto del mensaje.
-- ==========================================================================

begin read only;

with nuevas(variable) as (
    values ('nombre_mayusculas'), ('fecha_larga'), ('fecha_titulo'), ('dia_semana'), ('rango'),
           ('premio_mayor'), ('premios_linea'), ('premios_numerados'), ('premios_texto'),
           ('premios_guias'), ('cuentas_compacto')
),
sorteos as (
    select sp.id,
           sp.usuario_id,
           sp.estado,
           sp.config ->> 'nombre'                                   as nombre,
           sp.publicar_en,
           sp.identidad_evento_real,
           coalesce(sp.config -> 'mensajes' ->> 'publicacion', '')   as texto,
           sp.config -> 'mensajes' -> 'publicacion_meta'            as meta
    from public.sorteos_programados sp
    where sp.estado <> 'cancelado'
),
revisados as (
    select s.*,
           array(select n.variable from nuevas n
                 where s.texto ~* ('\{\{\s*' || n.variable || '\s*\}\}')
                 order by 1)                                        as variables_nuevas,
           coalesce(s.meta ->> 'activo', 'true') = 'false'         as inactivo,
           -- Aún puede publicarse automáticamente en algún grupo.
           exists (select 1 from public.sorteos_programados_grupos g
                   where g.sorteo_id = s.id
                     and g.estado in ('pendiente', 'publicando', 'fallido', 'requiere_revision')) as por_publicar,
           -- En curso: «Compartir» usaría su texto.
           exists (select 1 from public.eventos_bot e
                   where e.usuario_id = s.usuario_id
                     and e.identidad_evento_real = s.identidad_evento_real
                     and e.activo is true and e.estado is distinct from 'cerrado') as en_curso
    from sorteos s
)
select id, usuario_id, estado, nombre, publicar_en,
       meta ->> 'estilo'                         as estilo,
       variables_nuevas,
       inactivo,
       por_publicar,
       en_curso,
       case
           when cardinality(variables_nuevas) > 0 and inactivo then 'variables nuevas + mensaje inactivo'
           when cardinality(variables_nuevas) > 0             then 'variables nuevas: saldrían literales'
           else                                                    'mensaje inactivo: se publicaría con texto'
       end                                       as riesgo
from revisados
where (cardinality(variables_nuevas) > 0 or inactivo)
  and (por_publicar or en_curso or estado in ('borrador', 'programado', 'publicando', 'publicado_parcial', 'fallido'))
order by publicar_en nulls last, id;

-- Resumen por cuenta de los sorteos AÚN SIN PUBLICAR (los ya publicados que
-- siguen en curso aparecen en la lista de arriba con en_curso = true).
with nuevas(variable) as (
    values ('nombre_mayusculas'), ('fecha_larga'), ('fecha_titulo'), ('dia_semana'), ('rango'),
           ('premio_mayor'), ('premios_linea'), ('premios_numerados'), ('premios_texto'),
           ('premios_guias'), ('cuentas_compacto')
)
select sp.usuario_id,
       count(*) filter (where exists (select 1 from nuevas n
                                      where coalesce(sp.config -> 'mensajes' ->> 'publicacion', '') ~* ('\{\{\s*' || n.variable || '\s*\}\}'))) as con_variables_nuevas,
       count(*) filter (where sp.config -> 'mensajes' -> 'publicacion_meta' ->> 'activo' = 'false')                                                  as inactivos
from public.sorteos_programados sp
where sp.estado not in ('cancelado', 'publicado')
group by sp.usuario_id
having count(*) filter (where exists (select 1 from nuevas n
                                      where coalesce(sp.config -> 'mensajes' ->> 'publicacion', '') ~* ('\{\{\s*' || n.variable || '\s*\}\}'))) > 0
    or count(*) filter (where sp.config -> 'mensajes' -> 'publicacion_meta' ->> 'activo' = 'false') > 0
order by 1;

rollback;
