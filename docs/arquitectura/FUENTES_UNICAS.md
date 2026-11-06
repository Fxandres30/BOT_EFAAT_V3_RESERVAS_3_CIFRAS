# Catálogo de fuentes únicas y servicios centrales

Inventario F1-C, 06/11/2026. «Fuente única» significa que la regla vive en un solo sitio y los demás la importan. Cuando el panel o el SQL no pueden importarla, hay un **espejo** y una prueba que comprueba que coinciden.

## Fuentes únicas (con prueba)

| Regla | Fuente | Espejos | Prueba | Desde |
|---|---|---|---|---|
| Fecha y hora de Colombia (día, hora, formato que se guarda, instante desde fecha+hora) | `backend/shared/tiempo/colombia.js` | `frontend/lib/tiempo/colombia.ts` | `backend/tests/utils/tiempoColombia.test.js`, `frontend/tests/utils/tiempoColombia.test.mjs` | F1-B |
| Fecha de compra para inactividad | `bot/funciones/inactividad/inactividadRepo.js::fechaCompraDeFila` (usa `instanteColombia`) | — | `backend/tests/inactividad/fechaCompraDeFila.test.js` | F1-C (corrección) |
| Conteo de reservados y pagados | `sorteos/repo.js::contarNumerosTabla`, `contarNumerosIdentidad` | — | `backend/tests/sorteos/contarNumeros.test.js` | F1-B |
| Qué es liberar un número (19 campos + UPDATE del cliente) | `bot/funciones/reservas/liberacion.js` | SQL de la 030 (`reiniciar_tabla_cliente`), `frontend/services/tablas/reiniciarTabla.ts` | `backend/tests/reservas/liberacion.test.js`, C5 | F1-B |
| Contexto de auditoría de una fila | `bot/funciones/reservas/auditoriaReservas.js::contextoAuditoriaFila` | — | C5 | F1-B |
| Registro de auditoría inmutable | `auditoriaReservas.js::registrarAuditoria` (tabla `reservas_auditoria`, 032) | — | varias de `tests/reservas` | 22/10 |
| Conjuntos de estados de una programación | `sorteos/estadosProgramacion.js` | `frontend/services/tablas/impactoReinicio.ts` | `backend/tests/sorteos/estadosProgramacion.test.js` | F1-B |
| Estado de un sorteo en su grupo (canónico `vigente`/`estadoEnGrupo`, `contradicciones`, criterios B y C con nombre) y motivos de gestión. Reglas F2: sin reservas nuevas ni recordatorios si no está vigente; `activo NULL` = cerrado; panel = backend | `shared/eventos/estadosGestion.js` | `frontend/components/eventos/estadoEvento.ts` (`motivoGestion`, `eliminado`, `enCursoPorActivo`, el mismo que el backend) y la consulta `activacion/estado_sorteos_contradicciones_solo_lectura.sql` | C3, `caracterizacion/criteriosEstadoSorteo.test.js`, `caracterizacion/estadoSorteosSqlReal.test.js` (con `--entorno`) | F2 (motivos: antes de F1). Ver [ESTADO_SORTEOS.md](ESTADO_SORTEOS.md) |
| Un sorteo activo por precio (reemplazo) | `shared/eventos/unSorteoPorPrecio.js` | — | `tests/deteccion/unSorteoPorPrecioAnuncio` | 01/11 |
| Escritura de la fila de evento | `bot/funciones/eventos/guardarEvento.js` | — | C1, C2 | antes de F1 |
| **Cierre y reapertura de un sorteo** (12 modalidades: perfiles, escritura condicionada en la base, WhatsApp antes y después con reintentos, normalización, reapertura con ciclo nuevo, historial) | `bot/funciones/eventos/lifecycle/cerrarEvento.js` (orquestador: `terminarFila`, `escribirFin`, `reabrirFila`, `normalizarCierre`, `reintentarCierresWhatsapp`, `registrarHistorialEvento`) | Respaldo único para bases sin la 023/039/CHECK. Historial: tabla `eventos_bot_historial` (048, sin aplicar) o log | C6 `modalidadesCierre`, `orquestadorCierre`, `cierreGrupoProtegido`, `revisionFinalF3` | F3. Ver [F3_CIERRE_REAPERTURA.md](F3_CIERRE_REAPERTURA.md) |
| **Activación de un sorteo en un grupo** (perfiles por entrada; un sorteo por precio, guardar con deshacer, sustitución en el grupo, apertura con registro, anuncio y ciclo) | `bot/funciones/eventos/lifecycle/activarEvento.js` (orquestador) + `lifecycle/activacion/*` (pasos); entradas `detectarEvento.js` (WhatsApp) y `sorteos/activacionPanel.js` (panel) | — | C7 `activacionEntradas`, `deteccion/deteccionNucleo`, `activarEventoNucleo` | F4-D/F4-E |
| **Cierre del grupo de WhatsApp** (una llamada por grupo y cierre, entre procesos; reintentos; liberado al reabrir) | `cerrarEvento.cerrarGrupoProtegido` sobre `executionGuard` (`automation_actions`, clave `CIERRE_GRUPO:<grupo>:<fila>`) | — | `cierreGrupoProtegido` | endurecimiento F3 |
| **Permiso de reservas** (`segun_estado` / `permitidas` / `desactivadas`, independiente del estado; un grupo nuevo del sorteo lo hereda en `guardarEvento`) | `shared/eventos/estadosGestion.js::puedeReservar` + `eventos_bot.reservas_modo` (047, sin aplicar) | Panel: `services/sorteos/apiSorteos.ts::ModoReservas` | `orquestadorCierre` 5a-5e | F3-E |
| **Vigencia de los avisos de cierre** (una vez por cierre, también tras reabrir) | `automation/prioridadComunicaciones.js` (`ciclosDelEvento`, `sufijoAvisoCierre`, `avisoCierreYaEnviado`) | — | C4, C6, `orquestadorCierre` 4 | F3-D |
| Motor central tras abrir un evento | `automation/motorEventos.js` | — | `tests/automation/motorEventosUnico` | 03/11 |
| **«La programación del sorteo»** y la **publicación compartida** (propietaria / adoptante por grupo) | `sorteos/publicacionCompartida.js` (`elegirProgramacion`, `gruposAdoptados`); relación en el reclamo `PUBLICAR_SORTEO` | — | `caracterizacion/publicacionCompartida`, `reclamosF4F` K3 | F4-F.1 (antes, tres copias del criterio) |
| **Reglas de recuperación** (umbrales, estado de un envío por su registro, política de lo incierto, reclamo propio de un destino) | `automation/recuperacion.js`; usos: `sorteos/recuperacionPublicacion.js`, `motorEventos.recuperarCiclos`, reclamos C2/K3/K4, `administracion` | — | `caracterizacion/recuperacionF4G` | F4-G |
| **Reclamos persistentes de concurrencia** (C2 activación, K3 publicación por grupo, K4 creación por `solicitud_id`) | `automation/reclamos.js` sobre `executionGuard`; usos: `lifecycle/activacion/reclamoActivacion.js`, `sorteos/publicacionPorGrupo.js`, `sorteos/creacionIdempotente.js` | — | `caracterizacion/reclamosF4F`, C8 | F4-F |
| Idempotencia de envíos y acciones (opción `retomar` para reintentar tras error o proceso muerto) | `automation/executionGuard.js` (`automation_actions`) | — | `tests/automation`, `cierreGrupoProtegido` 9 | antes de F1 (`retomar`: F3) |
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
