-- ==========================================================================
-- SORTEOS ACTIVOS O CON activo NULO — SOLO LECTURA (2026-10-22, §2f)
--
-- El diagnóstico del 22/10 mostró 4 sorteos con activo = true o NULL. Esta
-- consulta da, por cada uno, lo necesario para decidir SIN cambiar nada. No
-- devuelve grupos, compradores ni teléfonos: solo ids, conteos y horas.
--
-- Cómo leer cada fila (columna "resolucion"):
--   esperar_cierre      activo = true: el bot lo atiende. NO se toca a mano;
--                       el cierre automático lo cierra. La ventana de
--                       activación espera a que no quede ninguno.
--   inerte_para_el_bot  activo NULL: el bot y el worker NO lo atienden (solo
--                       filtran activo = true), así que NO bloquea la Parte A
--                       ni las demás piezas. La 030 sí lo trata como activo y
--                       no reiniciará su tabla mientras siga así (protege sus
--                       reservas). Dejarlo como está es seguro.
--   revisar_dueno       su usuario_id no existe en auth.users o es NULL: la
--                       Parte A ABORTA por él (no se asigna por suposición).
--                       Hace falta que el dueño diga de quién es.
-- Nada de esto cambia estados. Si el dueño decide cerrar un sorteo inerte,
-- es una decisión aparte (no preparada como script automático).
-- ==========================================================================
set transaction read only;

select e.id::text as sorteo_id,
       e.activo,
       to_jsonb(e)->>'tabla' as tabla,
       to_jsonb(e)->>'hora_cierre' as hora_cierre,
       to_jsonb(e)->>'estado' as estado,
       e.usuario_id is not null and exists (select 1 from auth.users u where u.id = e.usuario_id) as dueno_existe,
       (select count(*) from public.reservas_dos_cifras r
         where r.usuario_id = e.usuario_id and r.estado is distinct from 'libre'
           and to_jsonb(r)->>'evento_id' = e.id::text) as reservas_2c_del_sorteo,
       (select count(*) from public."5k_15k_reservas_2_cifras" r
         where r.usuario_id = e.usuario_id and r.estado is distinct from 'libre'
           and to_jsonb(r)->>'evento_id' = e.id::text) as reservas_5k_del_sorteo,
       case
           when e.usuario_id is null or not exists (select 1 from auth.users u where u.id = e.usuario_id) then 'revisar_dueno'
           when e.activo is true then 'esperar_cierre'
           else 'inerte_para_el_bot'
       end as resolucion
from public.eventos_bot e
where e.activo is not false
order by e.activo nulls last, e.id;
