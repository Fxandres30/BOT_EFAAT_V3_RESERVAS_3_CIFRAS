# Cierre automático, deuda vigente y pagos por sticker

Preparado el 31/10/2026. Todo está en local y sin commit. No se ha desplegado nada ni ejecutado nada en producción.

## Decisiones confirmadas por el administrador

1. **Deuda:** los sorteos cerrados, cancelados, desactivados o vencidos no generan deuda vigente. Si una tabla conservada recibe un sorteo nuevo activo, todos sus números cuentan para ese sorteo. Los sorteos programados no generan deuda hasta que se publican.
2. **Cierres recuperados:** los cierres atrasados que se ejecutan tarde son silenciosos, sin aviso de cierre.
3. **Sticker sin sorteo vigente:** si el grupo no tiene un sorteo vigente, el sticker no registra ningún pago.
4. **Reservas sin identificador:** las reservas antiguas sin identificador inequívoco no se modifican. Su pago se registra a mano desde el panel.
5. **Sorteos cerrados:** se mantiene la protección contra pagos sobre sorteos cerrados.

## Cierre automático

| Situación | Qué hace el worker |
|---|---|
| Sorteo de hoy cuya hora de cierre ya pasó | Cierra el grupo en WhatsApp y marca la fila. El aviso de cierre se envía. |
| Sorteo de un día anterior que sigue activo (el proceso estuvo desconectado) | Cierra el grupo y marca la fila con `cierre_motivo` `hora (recuperado: cierre pendiente del AAAA-MM-DD)`. **Sin aviso.** |
| Lo mismo, pero el grupo ya tiene **otro sorteo vigente**, de hoy, de mañana o sin hora de cierre | Solo marca la fila (`grupo en uso por otro sorteo: no se cerró en WhatsApp`). El grupo sigue abierto para el sorteo nuevo. |
| Sorteo de mañana, aunque el cierre sea después de medianoche | No se toca. |
| Fila sin `fecha_evento` | Usa la hora de cierre de hoy. Nunca se marca como «recuperado», porque no se sabe de qué día es. |
| Fila sin `hora_cierre` o con una hora ilegible | Nunca se cierra por hora. |
| Fila ya terminada que un reintento antiguo dejó con `activo=true` (cerrada, cancelada, desactivada, eliminada o sustituida) | Se ignora: no se abre, no se cierra y no se escribe. |
| La administración cancela o desactiva, u otro proceso cierra, mientras WhatsApp responde | La escritura del cierre está condicionada a `activo=true`, así que el estado que dejó el otro proceso se conserva. |
| Varios reinicios del worker | Un solo cierre en WhatsApp. La fila no vuelve a cambiar. |
| WhatsApp no confirma el cierre | La fila sigue `activo=true` con `cierre_estado=fallido` y se reintenta en el siguiente ciclo. |

La hora es siempre la de Colombia (UTC-5 fijo), sin depender de la zona horaria del servidor. Las reservas usan la misma comprobación: un sorteo de un día ya pasado deja de aceptar reservas aunque su fila siga activa.

## Identificación del cliente en pagos y consultas

| Fila de reserva | «¿Qué debo?» / «mis números» | Sticker de pago | Panel (pagar a mano) |
|---|---|---|---|
| Con `usuario_global_id` | Solo si es el id del cliente | Solo si es el id del cliente citado | Sí |
| Sin id, con LID | Por el LID del cliente | **No** | Sí |
| Sin id ni LID, con teléfono o contacto | Por el teléfono del cliente | **No** | Sí |
| Sin ningún identificador | No | No | Sí |

- **Regla única de pertenencia:** está en `obtenerUsuarioGlobal.reservaPerteneceAUsuario`. Si la fila tiene un id, decide el id, nunca el teléfono. Una fila de otra persona con el mismo teléfono nunca es del cliente.
- **Cliente citado:** el sticker lo resuelve a partir del mensaje citado (`quoted_participant`). Nunca crea un usuario nuevo ni usa al remitente.
- **Inconsistencia conocida, aceptada por la decisión 4:** una reserva antigua sin id aparece en «¿qué debo?» del cliente, pero el sticker no la paga. Se registra a mano desde el panel.
- **Inventario:** [reservas_sin_identificador_solo_lectura.sql](reservas_sin_identificador_solo_lectura.sql) las cuenta por tabla, cliente, estado y tipo. La columna `telefono_compartido` marca los teléfonos que figuran en más de un usuario.

## Origen histórico de las reservas

Ningún pago modifica `identidad_evento_real`, `evento_id`, `grupo_id`, `grupo_nombre`, `usuario_id` ni `usuario_global_id`:

- **Sticker:** cambia `estado`, `fecha_pago` y `hora_pago`. Además completa `contacto`, `telefono`, `comprador`, `nombre` y `lid` **solo si estaban vacíos** y ninguna de las filas pagadas tiene ya otro valor.
- **Panel (uno o en lote):** cambia `estado`, `fecha_pago` y `hora_pago`.
- **Auditoría (`reservas_actividad`):** el sticker registra el `evento_id` del sorteo vigente en el que se pagó. El origen sigue en la fila.
- **Sorteos históricos:** nunca se reactivan. Los contadores solo se recalculan en las filas activas del sorteo, y una fila cerrada conserva sus totales finales.

## Antes de desplegar

1. **Inventario de cierres:** ejecutar [cierres_pendientes_primer_worker_solo_lectura.sql](cierres_pendientes_primer_worker_solo_lectura.sql). Es solo lectura y termina con `ROLLBACK`. Devuelve:
   - el detalle de cada fila que el primer ciclo cerraría, indicando si es «recuperado» y si el grupo está en uso;
   - un resumen por cliente, grupo, estado y fecha;
   - el control de las filas activas ya terminadas, que el worker ignorará.
2. **Revisión:** revisar ese resultado con el administrador. Para conservar abierto un sorteo de un día pasado, corregir su fecha desde el panel **antes** de desplegar.
3. **Cierres por pagos:** el SQL no puede prever los cierres por «todos pagados», que dependen de la tabla de números, ni sabe qué clientes tienen una sesión conectada (el worker solo corre para esos clientes).
4. **Migración 043:** la prepara otra línea de trabajo (un sorteo activo por tabla) y es compatible. El cierre solo pasa filas de `activo=true` a `false` y nunca crea filas activas.

## Pruebas

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `backend/tests/eventos/cierreRecuperado.test.js` | 21 | Cierre por fecha y hora, recuperación, grupo en uso, concurrencia, reinicios, medianoche, filas sin fecha |
| `backend/tests/pagos-sticker/pagoDespuesDelCierre.test.js` | 10 | Pago tras el cierre, origen intacto, identificación, filas antiguas |
| `backend/tests/consultas/deudaSoloSorteosVigentes.test.js` | 14 | Deuda solo de sorteos vigentes |
| `backend/tests/eventos/sqlCierresPendientes.test.js` | 9 | El SQL frente al código, en Postgres real (PGlite) |
