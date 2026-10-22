# Reserva manual asistida (Tablas → número)

Estado: implementado en local, sin commit. Migración 032 preparada y **sin aplicar**.

## Auditoría del flujo anterior (22/10/2026)

| Pieza | Dónde | Hallazgo |
|---|---|---|
| Reserva del bot | `bot/handlers/eventHandler.js` → `detectarReserva.js` → `reservarNumeros.js` | UPDATE condicionado a `estado='libre'` sobre la cuadrícula del cliente (`filtroCliente.js`). Es la única protección real contra reservas dobles. |
| Identidad del comprador | `obtenerUsuarioGlobal.js` (`usuarios`, global) + `contactos_tenant` (018) | El directorio de un cliente es `contactos_tenant`; `usuarios` no tiene cliente. |
| Grupo de un contacto | No hay tabla de pertenencia aplicada (`inactividad_miembros`, 022, solo en algunos entornos) | Se deduce de sus reservas en la cuadrícula del cliente y de sus mensajes en grupos del cliente (`mensajes_grupos_sorteos`). |
| Sorteo con varios grupos | `eventos_bot`: una fila por grupo, unidas por `identidad_evento_real` | El "contexto" de una reserva es la fila de `eventos_bot` del grupo elegido. |
| Acciones del panel | `frontend/services/tablas/{marcarPagado,liberarNumero,bloquearNumero,marcarEnProceso}.ts` | Escribían directo desde el navegador (anon + RLS), sin reglas del bot, y el `realizado_por` lo ponía el navegador. |
| Auditoría | `reservas_actividad` (002) | Tiene política INSERT para el usuario del panel: el navegador puede inventar operador e historial. No guarda origen, estados, motivo ni resultado. |

### Causas de los fallos

1. **No existía ninguna forma de reservar desde el panel.** La ventana de un número libre solo ofrecía «Poner en proceso» y «Bloquear».
2. **«Método de pago / Observaciones: No disponible todavía en el backend»** era un texto fijo en `NumeroDetalleModal.tsx`. Ninguna tabla tiene esas columnas (las tablas físicas de reservas tampoco).
3. Una retención `en_proceso` vencida se ve «Disponible» en la cuadrícula, pero en la base sigue `en_proceso`: ni el bot ni el panel pueden reservarla hasta liberarla.
4. Pagar/liberar desde el navegador lanzaba la excepción sin mostrarla (Reservas recientes).

## Qué se hizo

- `backend/services/reservaManual.js`: buscar contactos, contexto del número, reservar, pagar, liberar/desbloquear. Reserva con `reservarNumeros` (`origen: "manual"`), mismas validaciones que el bot (cifras, sorteo del precio activo y abierto, grupo autorizado, contacto del directorio). Nunca envía WhatsApp.
- `backend/routes/tablas.js`: `GET /tablas/contactos/buscar`, `GET /tablas/:precio/numeros/:numero`, `POST …/reservar|pagar|liberar`. Cliente y operador salen del token.
- `reservarNumeros.js`: parámetros `origen`, `operador`, `auditoria`; registra en `reservas_auditoria` también las reservas del bot (`origen: 'bot'`).
- `032_auditoria_reservas.sql`: tabla de auditoría inmutable (solo inserción, fecha del servidor, el navegador solo lee la suya).
- Panel: ventana del número con buscador de contactos, formulario de reserva, registrar pago (método/observaciones), liberar/anular/desbloquear con confirmación e historial. Se eliminaron los 4 servicios que escribían desde el navegador.

## Decisiones

- **Pago = confirmación del propietario.** Las tablas no tienen estado intermedio «pago por verificar»; el propietario es quien valida. Registrar el pago en el panel deja el número `pagado` (igual que el sticker del administrador).
- **Contacto nuevo**: solo si el teléfono no existe en la plataforma (o ya es de este cliente, y entonces se reutiliza). Si existe y pertenece solo a otra cuenta se rechaza: vincularlo expondría el nombre que esa cuenta conoce. Esto revela un bit (el teléfono existe en la plataforma).
- **Anular un número pagado** sigue permitido (regla previa), con confirmación y motivo obligatorio.
- **Bloquear / poner en proceso** ya no están en el panel.

## Activación (pendiente de autorización)

1. Desplegar backend y panel (`reservas_auditoria` ausente no rompe nada: se omite la auditoría y avisa una vez).
2. Aplicar `032_auditoria_reservas.sql` en el SQL Editor y ejecutar la consulta de verificación del final.
3. Probar en real: reservar un número libre con un contacto existente, registrar el pago, liberarlo; revisar el historial.

Pruebas (simulación, Supabase en memoria): `node backend/tests/reservas/reservaManual.test.js`.
