-- ==========================================================================
-- REVISIÓN de la simulación del control de inactividad y del PAGO DE PRUEBA.
-- ==========================================================================
-- Todo es SOLO LECTURA (transacción READ ONLY). Pegar por bloques en el SQL
-- Editor de Supabase. Los valores entre < > se sustituyen a mano.
--
-- AVISO: R4-R7 y P* devuelven identificadores de WhatsApp (miembro_jid
-- contiene el teléfono). No compartir capturas de esos resultados.
-- ==========================================================================

begin transaction read only;

-- ------------------------------------------------------------------------
-- R1. Últimas ejecuciones (¿corrió?, ¿en qué modo?, ¿terminó bien?)
-- ESPERADO: modo = 'simulacion', estado = 'completada'.
-- ------------------------------------------------------------------------
select id, modo, estado, iniciado_en, finalizado_en, error,
       resumen->>'evaluados'              as evaluados,
       resumen->>'candidatos'             as candidatos,
       resumen->>'excluidos'              as excluidos,
       resumen->>'omitidos'               as omitidos,
       resumen->>'expulsados'             as expulsados,
       resumen->>'comprasSincronizadas'   as compras_sincronizadas,
       resumen->>'expulsionesSuspendidas' as expulsiones_suspendidas
from public.inactividad_ejecuciones
order by iniciado_en desc
limit 5;

-- ------------------------------------------------------------------------
-- R2. CONTROL DE SEGURIDAD: nada expulsado.
-- ESPERADO: las tres cifras en 0. Si alguna NO es 0 -> poner
-- INACTIVIDAD_MODO=desactivado y reiniciar de inmediato.
-- ------------------------------------------------------------------------
select
    (select count(*) from public.inactividad_ejecuciones  where modo = 'real')                 as ejecuciones_reales,
    (select count(*) from public.inactividad_evaluaciones where resultado = 'expulsado'
                                                             or accion = 'expulsar')             as evaluaciones_con_expulsion,
    (select count(*) from public.inactividad_miembros     where expulsado_en is not null)        as miembros_expulsados;

-- ------------------------------------------------------------------------
-- R3. Resumen de la ÚLTIMA ejecución por decisión y motivo.
-- ------------------------------------------------------------------------
with ultima as (
    select id from public.inactividad_ejecuciones order by iniciado_en desc limit 1
)
select e.decision, e.motivo, e.accion, e.resultado, count(*) as miembros
from public.inactividad_evaluaciones e
join ultima u on u.id = e.ejecucion_id
group by 1, 2, 3, 4
order by 1, 5 desc;

-- ------------------------------------------------------------------------
-- R4. CANDIDATOS (quiénes serían expulsados) de la última ejecución.
-- Validar a mano 3-5 de ellos con R9.
-- ------------------------------------------------------------------------
with ultima as (
    select id from public.inactividad_ejecuciones order by iniciado_en desc limit 1
)
select e.grupo_nombre, e.grupo_id, e.miembro_jid, e.usuario_global_id,
       e.ultima_compra_en, e.referencia_en, e.dias_sin_compra, e.motivo, e.accion, e.resultado
from public.inactividad_evaluaciones e
join ultima u on u.id = e.ejecucion_id
where e.decision = 'candidato'
order by e.grupo_nombre, e.dias_sin_compra desc;

-- ------------------------------------------------------------------------
-- R5. EXCLUIDOS (nunca se expulsan): dueño, admins, bot, protegidos.
-- Comprobar que están TODOS los administradores reales de cada grupo y el
-- número del bot.
-- ------------------------------------------------------------------------
with ultima as (
    select id from public.inactividad_ejecuciones order by iniciado_en desc limit 1
)
select e.grupo_nombre, e.motivo, e.miembro_jid
from public.inactividad_evaluaciones e
join ultima u on u.id = e.ejecucion_id
where e.decision = 'excluido'
order by e.grupo_nombre, e.motivo;

-- ------------------------------------------------------------------------
-- R6. OMITIDOS por identidad (no se pueden evaluar con seguridad).
-- identidad_incompleta = solo LID o solo teléfono, sin vínculo en usuarios.
-- Primero el conteo por grupo; luego el detalle.
-- ------------------------------------------------------------------------
with ultima as (
    select id from public.inactividad_ejecuciones order by iniciado_en desc limit 1
)
select e.grupo_nombre, e.motivo, count(*) as miembros
from public.inactividad_evaluaciones e
join ultima u on u.id = e.ejecucion_id
where e.decision = 'omitido'
group by 1, 2
order by 1, 3 desc;

with ultima as (
    select id from public.inactividad_ejecuciones order by iniciado_en desc limit 1
)
select e.grupo_nombre, e.motivo, e.miembro_jid, e.usuario_global_id
from public.inactividad_evaluaciones e
join ultima u on u.id = e.ejecucion_id
where e.decision = 'omitido'
  and e.motivo in ('identidad_incompleta', 'identidad_ambigua', 'identidad_no_registrada', 'datos_insuficientes')
order by e.grupo_nombre, e.motivo;

-- ------------------------------------------------------------------------
-- R7. Grupos con error (metadata no disponible, sin participantes...).
-- ESPERADO: 0 filas.
-- ------------------------------------------------------------------------
with ultima as (
    select id from public.inactividad_ejecuciones order by iniciado_en desc limit 1
)
select e.grupo_nombre, e.grupo_id, e.motivo, e.error
from public.inactividad_evaluaciones e
join ultima u on u.id = e.ejecucion_id
where e.decision = 'error_grupo';

-- ------------------------------------------------------------------------
-- R8. Próximos a cumplir el plazo (si no compran antes).
-- ------------------------------------------------------------------------
with ultima as (
    select id from public.inactividad_ejecuciones order by iniciado_en desc limit 1
)
select e.grupo_nombre, e.miembro_jid, e.ultima_compra_en, e.dias_sin_compra, e.cumple_plazo_en, e.motivo
from public.inactividad_evaluaciones e
join ultima u on u.id = e.ejecucion_id
where e.decision = 'conservar' and e.cumple_plazo_en is not null
order by e.cumple_plazo_en
limit 50;

-- ------------------------------------------------------------------------
-- R9. Validar UN candidato a mano: su registro en cada grupo y sus filas
-- pagadas que aún existan en las tablas de reservas.
-- ------------------------------------------------------------------------
select grupo_id, ultima_compra_en, ultima_compra_origen, seguimiento_desde, presente, ultimo_resultado
from public.inactividad_miembros
where usuario_global_id = '<USUARIO_GLOBAL_ID>';

select 'reservas_dos_cifras' as tabla, numero, estado, grupo_id, fecha_pago, hora_pago
from public.reservas_dos_cifras where usuario_global_id = '<USUARIO_GLOBAL_ID>' and estado = 'pagado'
union all
select '5k_15k_reservas_2_cifras', numero, estado, grupo_id, fecha_pago, hora_pago
from public."5k_15k_reservas_2_cifras" where usuario_global_id = '<USUARIO_GLOBAL_ID>' and estado = 'pagado';

-- ------------------------------------------------------------------------
-- P1. PAGO DE PRUEBA — identificar al cliente de prueba.
-- En "usuarios" el teléfono se guarda SIN el 57 (p. ej. 3001234567).
-- ------------------------------------------------------------------------
select id as usuario_global_id, lid, telefono, nombre
from public.usuarios
where telefono = '<TELEFONO_SIN_57>';

-- ------------------------------------------------------------------------
-- P2. PAGO DE PRUEBA — ANTES de confirmar el pago: anotar el resultado.
-- ------------------------------------------------------------------------
select grupo_id, ultima_compra_en, ultima_compra_origen, actualizado_en
from public.inactividad_miembros
where usuario_global_id = '<USUARIO_GLOBAL_ID>'
order by grupo_id;

-- ------------------------------------------------------------------------
-- P3. PAGO DE PRUEBA — DESPUÉS de confirmarlo (panel o sticker).
-- ESPERADO: en el grupo donde se hizo la reserva, ultima_compra_en = hora
-- del pago (segundos de diferencia) y ultima_compra_origen =
-- 'trigger_pago' (o 'sticker_admin' si el backend escribió después con una
-- hora más reciente). Los demás grupos, sin cambios respecto a P2.
-- ------------------------------------------------------------------------
select grupo_id, ultima_compra_en, ultima_compra_origen, actualizado_en,
       now() - ultima_compra_en as hace
from public.inactividad_miembros
where usuario_global_id = '<USUARIO_GLOBAL_ID>'
order by grupo_id;

-- La fila de la reserva quedó pagada (confirma que el pago no se bloqueó).
select 'reservas_dos_cifras' as tabla, numero, estado, grupo_id, fecha_pago, hora_pago
from public.reservas_dos_cifras where usuario_global_id = '<USUARIO_GLOBAL_ID>' and numero = '<NUMERO>'
union all
select '5k_15k_reservas_2_cifras', numero, estado, grupo_id, fecha_pago, hora_pago
from public."5k_15k_reservas_2_cifras" where usuario_global_id = '<USUARIO_GLOBAL_ID>' and numero = '<NUMERO>';

rollback;
