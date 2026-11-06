# Catálogo de fuentes únicas y servicios centrales

Inventario F1-C, 06/11/2026. «Fuente única» significa que la regla vive en un solo sitio y los demás la importan. Cuando el panel o el SQL no pueden importarla, hay un **espejo** y una prueba que comprueba que coinciden.

## Fuentes únicas (con prueba)

| Regla | Fuente | Espejos | Prueba | Desde |
|---|---|---|---|---|
| Fecha y hora de Colombia (día, hora, formato que se guarda, instante desde fecha+hora) | `backend/shared/tiempo/colombia.js` | `frontend/lib/tiempo/colombia.ts` | `backend/tests/utils/tiempoColombia.test.js`, `frontend/tests/utils/tiempoColombia.test.mjs` | F1-B |
| Fecha de compra para inactividad | `bot/funciones/inactividad/inactividadRepo.js::fechaCompraDeFila` (usa `instanteColombia`) | — | `backend/tests/inactividad/fechaCompraDeFila.test.js` | F1-B (corrección) |
| Conteo de reservados y pagados | `sorteos/repo.js::contarNumerosTabla`, `contarNumerosIdentidad` | — | `backend/tests/sorteos/contarNumeros.test.js` | F1-B |
| Qué es liberar un número (19 campos + UPDATE del cliente) | `bot/funciones/reservas/liberacion.js` | SQL de la 030 (`reiniciar_tabla_cliente`), `frontend/services/tablas/reiniciarTabla.ts` | `backend/tests/reservas/liberacion.test.js`, C5 | F1-B |
| Contexto de auditoría de una fila | `bot/funciones/reservas/auditoriaReservas.js::contextoAuditoriaFila` | — | C5 | F1-B |
| Registro de auditoría inmutable | `auditoriaReservas.js::registrarAuditoria` (tabla `reservas_auditoria`, 032) | — | varias de `tests/reservas` | 22/10 |
| Conjuntos de estados de una programación | `sorteos/estadosProgramacion.js` | `frontend/services/tablas/impactoReinicio.ts` | `backend/tests/sorteos/estadosProgramacion.test.js` | F1-B |
| Estado de gestión de una fila de `eventos_bot` | `shared/eventos/estadosGestion.js` | — | C3 | antes de F1 |
| Un sorteo activo por precio (reemplazo) | `shared/eventos/unSorteoPorPrecio.js` | — | `tests/deteccion/unSorteoPorPrecioAnuncio` | 01/11 |
| Escritura de la fila de evento | `bot/funciones/eventos/guardarEvento.js` | — | C1, C2 | antes de F1 |
| Motor central tras abrir un evento | `automation/motorEventos.js` | — | `tests/automation/motorEventosUnico` | 03/11 |
| Idempotencia de envíos | `automation/executionGuard.js` (`automation_actions`) | — | `tests/automation` | antes de F1 |
| Prioridad sorteo/grupo en recordatorios y cierre | `automation/prioridadComunicaciones.js` | — | C4 | antes de F1 |
| Identidad del sorteo real | `bot/funciones/eventos/identidadEventoReal.js` | — | `tests/identidad` | 13/09 |
| Grupos del sorteo | `sorteos/gruposSorteo.js` | — | `tests/sorteos/gruposDelSorteo` | 04/11 |
| Filtro de cliente en cuadrículas | `bot/funciones/reservas/filtroCliente.js::soloDelCliente` | — | `tests/seguridad` | antes de F1 |
| Política de grupos autorizados | `bot/funciones/grupos/politicaGrupos.js` | — | `tests/seguridad` | 21/10 |
| Estado de pago | `shared/pagos/determinarEstadoPago.js` | — | `tests/pagos` | antes de F1 |
| Catálogo y resolución de variables | `shared/variables/*` | ver D4 | `tests/variables` | antes de F1 |
| Transporte de mensajes de WhatsApp | `services/baileys/send.js` | — | — | antes de F1 |
| Imagen de la tabla | navegador: `capturarTabla` + Grid de «Compartir» (regla del generador único, 06/11) | ver D6 (Puppeteer sigue en 4 puntos) | `tests/sorteos/publicacionComoCompartir` | 06/11 |
| Protección de scripts contra producción | `backend/scripts/guardaProduccion.js` | — | — | F1-A |
| Ejecución segura de pruebas | `scripts/pruebas/ejecutar.js` + `bloqueoRed.js` | — | `npm test` | F1-A |

## Servicios centrales del backend

| Servicio | Archivo | Lo usan |
|---|---|---|
| Reserva, pago y liberación manual | `services/reservaManual.js` | `routes/tablas.js` |
| Reservar números (bot y panel) | `bot/funciones/reservas/reservarNumeros.js` | detector de reservas, `reservaManual` |
| Pago por sticker | `bot/funciones/pagos/marcarReservasPagadasPorAdmin.js` | flujo de sticker |
| Compartir tabla | `services/compartirTabla.js`, `destinosCompartir.js`, `operacionesCompartir.js` | `routes/tablas.js`, publicador |
| Sorteos programados | `sorteos/servicio.js`, `administracion.js`, `publicador.js` | `routes/sorteos.js` |
| Sorteos activos | `sorteos/sorteosActivos.js`, `gestionEventos.js` | `routes/sorteos.js` |
| Sesiones de WhatsApp | `services/baileys/manager.js`, `propiedadSesion.js`, `lease.js`, `salud.js` | todo el bot |
