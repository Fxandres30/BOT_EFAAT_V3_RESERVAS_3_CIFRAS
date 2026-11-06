# Pruebas de EFAAT: cómo se ejecutan y línea base

Última actualización: 06/11/2026 (F1-C), sobre `main` en `97975555`. Índice de toda la documentación: [../README.md](../README.md).

## Cómo ejecutarlas

```bash
npm test                      # raíz: backend + frontend
npm test --prefix backend     # solo backend
npm test --prefix frontend    # solo frontend
node scripts/pruebas/ejecutar.js backend caracterizacion   # filtrar por ruta
node scripts/pruebas/ejecutar.js backend --lista           # ver qué se ejecutaría
node scripts/pruebas/ejecutar.js backend --entorno         # incluir las que necesitan entorno real local
```

El ejecutor es [`scripts/pruebas/ejecutar.js`](../../scripts/pruebas/ejecutar.js). Pone tres barreras que no dependen de que cada prueba se proteja sola:

1. **Entorno aislado.** Cada archivo corre en su propio proceso con `EFAAT_PRUEBAS=1`, que hace que `lib/supabase.js` bloquee el cliente real. Todas las variables sensibles se sustituyen por valores de prueba *antes* de que dotenv lea `backend/.env`: Supabase y el panel apuntan a `127.0.0.1:9`, la clave de Gemini queda vacía, la inactividad en simulación y las expulsiones desactivadas.
2. **Red bloqueada.** [`bloqueoRed.js`](../../scripts/pruebas/bloqueoRed.js) se precarga en cada proceso con `NODE_OPTIONS`. Cualquier conexión o resolución DNS fuera de la propia máquina falla, se marca `[BLOQUEO RED]` y **la prueba cuenta como fallida** aunque sus aserciones pasen.
3. **Fuera por defecto.** Las E2E (`backend/tests/e2e`) y las pruebas que necesitan un entorno real local no se ejecutan sin `--entorno`.

`npm test` termina con código 0 solo si no hay fallos **inesperados**.

## Línea base

| Fecha | Archivos | ✅ | ❌ inesperados | ⚠️ conocidos | ⏭️ requieren entorno |
|---|---|---|---|---|---|
| 06/11 (F0, script en el scratchpad) | 188 | 185 | 2 | 1 | — |
| 06/11 (F1-A, `npm test`, 131 s) | 192 (incluye las 5 de caracterización) | 191 | **0** | 1 | 2 |
| 06/11 (F1-B, `npm test`, 138 s) | 197 (+5 de F1-B: `tiempoColombia` ×2, `contarNumeros`, `reservas/liberacion`, `estadosProgramacion`) | 196 | **0** | 1 | 2 |
| 06/11 (F1-C, `npm test`, 140 s) | 198 (+1: `inactividad/fechaCompraDeFila`) | 197 | **0** | 1 | 2 |
| 06/11 (F2, `npm test`, 135 s) | 199 (+1: `caracterizacion/criteriosEstadoSorteo`) | 198 | **0** | 1 | 2 |
| 06/11 (cierre de F2, `npm test`, 137 s) | 199 | 198 | **0** | 1 | 3 (+1: `caracterizacion/estadoSorteosSqlReal`, pasa 4/4 con `--entorno` y PGlite) |
| 06/11 (F3, `npm test`, 175 s) | 201 (+2: `caracterizacion/modalidadesCierre` C6, `caracterizacion/orquestadorCierre`) | 200 | **0** | 1 | 3 |
| 06/11 (endurecimiento F3, `npm test`, 111 s) | 203 (+2: `caracterizacion/cierreGrupoProtegido`, `caracterizacion/revisionFinalF3`) | 202 | **0** | 1 | 3 (las 2 de PGlite pasan con `--entorno`) |
| 06/11 (F4-C, `npm test`, 115 s) | 205 (+2: `caracterizacion/activacionEntradas` C7 con 25 huellas, `caracterizacion/concurrenciaActivacion` C8 con 7 casos) | 204 | **0** | 1 | 3 |
| 06/11 (F4-D, `npm test` ×5, 109-117 s) | 206 (+1: `sorteos/activarEventoNucleo`) | 205 | **0** en 4 de 5 ejecuciones; **1 sin identificar en 1** (no se repitió en 4 ejecuciones completas ni en 20 repeticiones con carga de C7, C8 y el núcleo) | 1 | 3 |
| 06/11 (F4-E, `npm test` ×6, salidas completas guardadas) | 207 (+1: `deteccion/deteccionNucleo`) | 206 | **0** en 3 de 6; 1 en las otras 3: dos veces `sorteosProgramados` (aborto de libuv al salir, R17, ya existía antes de F4) y una vez `cierreGrupoProtegido` caso 1 (corregido en la prueba, R18; 18/18 después) | 1 | 3 |
| 06/11 (F4-F, `npm test` ×4, salidas completas guardadas) | 208 (+1: `caracterizacion/reclamosF4F`, 20 casos) | 206 | **1** en las dos últimas: `calendarioMaestro` (depende de la hora del día, R21; pasa 24/24 con el reloj a las 08:00 de Colombia). Las dos primeras tenían además `recuperacionCaidas` 4: regresión de F4-F (K3), **corregida** | 1 | 3 |
| 06/11 (F4-F.1, `npm test` ×2, salidas completas guardadas) | 209 (+1: `caracterizacion/publicacionCompartida`, 7 casos) | 208 | **0** en las dos (R21 resuelto) | 1 | 3 |
| 06/11 (F4-G, `npm test` ×2, salidas completas guardadas) | 210 (+1: `caracterizacion/recuperacionF4G`, 12 casos) | 209 | **0** en las dos | 1 | 3 |

### Expectativas cambiadas a propósito en el cierre de F2

- `reservas/reaccionesReserva`, `reservas/reservaCifras` y seis de `consultas/` (`compatibilidadMisReservas`, `consultasEstadoNumeros`, `consultasPago`, `intencionesMisNumeros`, `misReservasComoMisNumeros`, `unificacionConsultasEstado`): su fixture de «sorteo en curso» no tenía `activo`. Con la regla 4 una fila sin `activo` cuenta como cerrada, así que se añadió `activo: true` al fixture. **Ninguna aserción cambió.**
- `frontend/tests/eventos/estadoEvento.test.mjs`: «activo ausente = en curso» pasa a «activo ausente = cerrado» (regla 4), comparado con el backend.
- Cargadores de `.ts` con resolución de imports relativos (sin cambiar aserciones): `eventos/centroEventos`, `eventos/estadoEvento`, `seguridad/aislamientoPanel`, `sorteos/administrarSorteos` (panel) y `eventos/agruparEventosPanel` (backend).

### Fuentes únicas creadas en F1-B (cada una con su prueba)

| Qué | Fuente | Espejo que no puede importarla (comprobado por prueba) |
|---|---|---|
| Fecha y hora de Colombia | `backend/shared/tiempo/colombia.js` | `frontend/lib/tiempo/colombia.ts` |
| Conteo de reservados/pagados | `backend/sorteos/repo.js` (`contarNumerosTabla`, `contarNumerosIdentidad`) | — |
| Campos y UPDATE de liberación | `backend/bot/funciones/reservas/liberacion.js` | SQL de la 030 y `frontend/services/tablas/reiniciarTabla.ts` |
| Contexto de auditoría de una fila | `backend/bot/funciones/reservas/auditoriaReservas.js` (`contextoAuditoriaFila`) | — |
| Conjuntos de estados de una programación | `backend/sorteos/estadosProgramacion.js` | `frontend/services/tablas/impactoReinicio.ts` |

Si una ejecución completa muestra fallos con `process out of memory` o «El archivo de paginación es demasiado pequeño» (códigos 134, 3221226505, 2147483651), la causa es que **la máquina se quedó sin memoria**, no un fallo de las pruebas. Pasó una vez el 06/11 durante un reinicio de sesión: los 7 archivos afectados pasaron al repetirlos. Vuelve a ejecutar con la máquina descargada antes de investigar.

### Fallos conocidos (se ejecutan y se informan aparte)

| Prueba | Motivo | Qué haría que pase |
|---|---|---|
| `backend/tests/sorteos/independenciaPorPrecio.test.js` | Describe la «cuadrícula por precio» (opción B), que todavía no existe: hoy $3.000 y $10.000 comparten la tabla física. | Implementar la opción B (decisión de negocio pendiente). |

### Requieren entorno (solo con `--entorno`)

| Prueba | Qué necesita |
|---|---|
| `backend/tests/sorteos/capturaRealSorteo.test.js` | Chromium y el panel real en `FRONTEND_URL` |
| `backend/tests/seguridad/cuadriculaClienteSqlReal.test.js` | PGlite (`PGLITE_MODULE`) |
| `backend/tests/caracterizacion/estadoSorteosSqlReal.test.js` | PGlite (`PGLITE_MODULE`): valida la consulta de diagnóstico de F2 contra `estadosGestion.js` |

### Desfases resueltos en F1-A

- `frontend/tests/seguridad/cuadriculaVacia.test.mjs`. Esperaba `true`, pero desde `7c9667ec` (24/10, «Reinicio manual de Tablas») `reiniciarTabla` devuelve a propósito el resultado que muestra `ReinicioTablaModal` (`{ accion, filas, noTocadas, anticipadasEliminadas }`). El comportamiento que la prueba protege no cambió: el backend crea la cuadrícula y el navegador solo registra la actividad. **Se corrigió la prueba; el código no se tocó.**

## Pruebas de caracterización (`backend/tests/caracterizacion/`)

Fijan el comportamiento **actual**, sea el deseado o no, para que cada fase de consolidación demuestre que no lo cambió sin querer. Si una fase lo cambia a propósito, la expectativa se actualiza en el mismo cambio y se explica el motivo.

| Prueba | Qué fija | Riesgo que deja escrito |
|---|---|---|
| C1 `tresModalidades` | Detección, instantáneo y programado dejan la misma fila de `eventos_bot` (27 columnas, mismos datos estructurales), una apertura y un ciclo. El panel publica la imagen antes de la apertura; la detección no publica imagen. | — |
| C2 `detectorYPublicador` | Detector y «Publicar ahora» sobre el mismo sorteo y grupo, en los órdenes simultáneo, detector primero y panel primero: 1 fila, 1 anuncio, 1 apertura, 1 ciclo. | No hay índice único `(usuario_id, grupo_id, identidad_evento_real)`: con latencia real podría crearse una segunda fila. |
| C3 `estadoEvento` | Tabla de interpretación de `motivoGestion`, `cierreSilencioso`, `sinDeuda` y `finDelEvento` (13 casos). | Una fila puede tener `activo=true` y estar «cerrada» a la vez. |
| C4 `cierreUnico` | Scheduler y publicador a la vez o en orden invertido: un solo aviso de cierre (el del sorteo si existe; si no, el del grupo). | — |
| C5 `camposLiberacion` | El UPDATE real de la liberación manual frente a la de vencimiento. **Cambiada a propósito en F1-B:** los dos envían el mismo UPDATE (19 campos), dejan la fila idéntica y escriben la misma auditoría en `reservas_auditoria`. | Resuelto en F1-B (en F1-A el vencimiento no limpiaba `telefono_bot` ni `ip_reserva` y no dejaba auditoría). |

Arnés: `_arnesEventos.js` (mismo escenario que `tests/automation/motorEventosUnico.test.js`, con el reloj fijado al 22/10/2026 08:01 hora de Colombia) y `_prueba.js`.

## Scripts manuales protegidos (`backend/_*.js`)

Los scripts que tocan datos reales llevan en su primera línea ejecutable la guarda [`backend/scripts/guardaProduccion.js`](../../backend/scripts/guardaProduccion.js). Para ejecutarlos hacen falta **dos** confirmaciones explícitas: el argumento `--confirmar-produccion` y la variable `EFAAT_CONFIRMAR_PRODUCCION=SI`. Nunca corren con `EFAAT_PRUEBAS=1`. La guarda no cambia lo que hace cada script; solo impide que arranque por accidente.

| Script | Tipo | Efecto |
|---|---|---|
| `_test_inicio_dia_real.js` | escritura | Inserta y borra `grupos_autorizados`, `automation_configs` y `automation_actions` reales |
| `_test_fase7_dinamismo.js` | escritura | Crea y borra plantillas y configuración de selección reales |
| `_test_fase_produccion_real_scheduler.js` | escritura | Inserta y borra grupos, configuraciones, ciclos y eventos reales; abre Chromium |
| `_test_fase2_variables_globales_e2e.js` | escritura | Crea y borra plantillas y variables globales reales |
| `_test_fase8_sesiones.js` | escritura | Manipula el gestor de sesiones contra la tabla real `sesiones` |
| `_reconstruccion_usuarios.js` | escritura | **Borra todas** las filas de `usuarios` y las reimporta |
| `_corregir_2_plantillas_parentesis.js` | escritura | UPDATE de 2 plantillas reales |
| `_migrar_plantillas_seguras.js` | escritura | Con `--apply`, UPDATE de 66 plantillas reales |
| `_escaner_identidades.js` | lectura | Supabase real al cargar; grupos de la sesión activa |
| `_comparar_scanner_identidades.js` | lectura | Ídem |
| `_diagnostico_telefonos_lid.js` | lectura | Ídem |
| `_investigar_completar_lid.js` | credenciales | Lee los archivos de sesión de WhatsApp (`backend/auth`) |

Los tres escáneres **no abren** una sesión de WhatsApp por sí mismos: piden el socket activo del proceso (`manager.getActiveSocket()`), que en un proceso aparte es `null`. Pero sí se conectan a Supabase real al cargar.
