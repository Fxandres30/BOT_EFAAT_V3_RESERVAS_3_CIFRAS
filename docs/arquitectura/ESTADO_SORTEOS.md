# Estado de un sorteo: fuente única (F2)

F2 cerrado el 06/11/2026 sobre `f9743a4d`. Local, sin commit. Prueba principal: [`backend/tests/caracterizacion/criteriosEstadoSorteo.test.js`](../../backend/tests/caracterizacion/criteriosEstadoSorteo.test.js) (28 comprobaciones).

## 1. El problema

Una fila de `eventos_bot` (un sorteo en un grupo) reparte su estado en cinco columnas: `activo`, `abierto`, `estado`, `cierre_estado` y `cierre_motivo`. Antes de F2 había cuatro criterios de «sigue en curso» escritos a mano:

| Criterio | Expresión | Fila `activo=true` ya cerrada (C3) | Fila `activo NULL` |
|---|---|---|---|
| **Canónico** | `activo === true` y `finDelEvento(fila) === null` | cerrada | cerrada |
| **B** | `activo !== false && estado !== "cerrado"` | abierta si `estado` no es «cerrado» | abierta |
| **C** | `activo === true` | en curso | cerrada |
| **D** (solo el panel, eliminado en F2) | `activo !== false` | en curso | en curso |

En las filas normales coinciden todos. Solo discrepan en:

- **`activo_terminado`:** `activo=true` con `estado`/`cierre_estado` «cerrado» o con un motivo de gestión. Lo deja un reintento antiguo (riesgo C3).
- **`activo_sin_valor`:** `activo NULL` en filas históricas.

`abierto` (si el grupo de WhatsApp quedó abierto) **no** forma parte del estado: `abierto=false` con `activo=true` es una apertura fallida que el worker reconcilia.

## 2. La fuente única

- **Backend:** [`backend/shared/eventos/estadosGestion.js`](../../backend/shared/eventos/estadosGestion.js) tiene `vigente`, `estadoEnGrupo` y `contradicciones`, los criterios B y C con nombre (`abiertoPorEstado`, `enCursoPorActivo`, `estadoEnGrupoPorActivo`) y los motivos de gestión.
- **Panel:** su espejo es [`frontend/components/eventos/estadoEvento.ts`](../../frontend/components/eventos/estadoEvento.ts), con `motivoGestion`, `eliminado` y `enCursoPorActivo`, el mismo que el backend. El criterio D desapareció.

Ningún consumidor migrado conserva una expresión propia.

## 3. Reglas de negocio aplicadas en F2

| Regla | Dónde | Qué cambia |
|---|---|---|
| 1. Un sorteo cerrado no acepta reservas **nuevas** | `bot/funciones/reservas/detectarReserva.js::sorteoAceptaReservas` (reservas por WhatsApp) | Pasa del criterio B al canónico. Dejan de aceptar números las filas C3 y las `NULL`. La hora de cierre sigue mandando. El panel muestra el mismo dato en «acepta reservas» |
| 2. Un sorteo cerrado no recibe recordatorios | `automation/scheduler.js` (paso 1b) y `sorteos/publicador.js` (recordatorios del sorteo) | Las filas C3 y `NULL` ya no reciben tabla inicial, recordatorios ni actualizaciones. **El aviso de cierre y el fin del ciclo no cambian**: siguen dependiendo de `activo === false` (F3) |
| 3. Backend y panel muestran el mismo estado | `estadoEvento.ts` (`estadoFila`, `estadoSorteo`), `agruparEventos.ts`, `GruposAsociados.tsx`, `obtenerEventos.ts` | El panel usa la función del backend: mismo estado en todas las filas que se muestran (comprobado fila a fila) y mismo filtro de eliminados |
| 4. `activo NULL` = cerrada | todo lo anterior, `modalidad.faseDe` (pestaña Activos/Finalizados) y `consultarMisNumeros.sorteoVigente` («¿qué debo?») | Una fila `NULL` ya no sale «En curso» en el panel, ni como sorteo actual del cliente, ni acepta reservas o recordatorios |
| 5. `activo=true` ya cerrado = cerrado | reservas, recordatorios, consultas del cliente y pago por sticker (este ya lo aplicaba) | **No** se aplica todavía en las pantallas de administración: ver §6 |

**Evidencia histórica de la regla 4.** Desde el 22/10, `docs/activacion/sorteos_pendientes_solo_lectura.sql` y `validacion_final_aislamiento_solo_lectura.sql` llaman a `activo NULL` «inerte para el bot»: el bot y el worker solo atienden `activo = true`. La única excepción documentada es el reinicio seguro (migración 030), que lo trata como activo **para proteger sus reservas** y no reiniciar su tabla. **Esa protección se conserva**: es SQL (F4) y protege reservas existentes, que es distinto de aceptar reservas nuevas.

## 4. Efectos revisados

| Ámbito | Efecto |
|---|---|
| Reservas nuevas (WhatsApp) | Las filas C3 y `NULL` dejan de aceptarlas |
| Reservas existentes | **Ninguno.** No se libera, cancela ni modifica ningún número. El reinicio (030) sigue protegiendo las de filas `NULL` |
| Reserva manual del panel | **Sin cambios** (conflicto, §6.2) |
| Pagos pendientes y confirmación | **Sin cambios.** El pago por sticker ya exigía sorteo vigente (sustitución idéntica). El pago manual del panel no depende del estado del sorteo. Un número reservado de una fila `NULL` se sigue pudiendo pagar desde el panel |
| «¿Qué debo?» / «mis números» | Una fila `NULL` deja de presentarse como el sorteo actual. Es la regla del 31/10: un sorteo terminado nunca es obligación actual |
| Recordatorios | Las filas C3 y `NULL` dejan de recibirlos. El aviso de cierre no cambia |
| Administración y edición | **Sin cambios** (conflicto, §6.1) |
| Cierre manual y automático | **Sin cambios** (F3) |
| Varios grupos | Cada fila (grupo) se interpreta por separado. Un sorteo está en curso si lo está en algún grupo, igual que antes |

## 5. Consumidores: clasificación completa

### 5.1 Migración idéntica (hecha)

| Consumidor | Ahora |
|---|---|
| `bot/funciones/eventos/consultarEvento.js` | `vigente` |
| `bot/funciones/eventos/lifecycle/procesarSorteo.js` (2 sitios) | `vigente` |
| `bot/funciones/eventos/workers/workerEventos.js` | `vigente` |
| `bot/funciones/pagos/confirmarPagoPorSticker.js` L242 | `!vigente` (igual también con fila nula) |
| `sorteos/sorteosActivos.js`, `sorteos/administracion.js` | `abiertoPorEstado` (criterio B con nombre) |
| `sorteos/gestionEventos.js` (estado y 8 usos) | `estadoEnGrupoPorActivo`, `enCursoPorActivo` |

### 5.2 Migración con cambio de comportamiento (hecha, por las reglas 1 a 4)

| Consumidor | Regla |
|---|---|
| `bot/funciones/reservas/detectarReserva.js::sorteoAceptaReservas` | 1, 4, 5 |
| `automation/scheduler.js` (paso 1b) | 2 |
| `sorteos/publicador.js` (rama de recordatorios; la del aviso de cierre conserva su condición exacta) | 2 |
| `bot/funciones/consultas/consultarMisNumeros.js::sorteoVigente` | 4 |
| `frontend/components/eventos/estadoEvento.ts`, `agruparEventos.ts`, `GruposAsociados.tsx` (D → C) | 3, 4 |
| `frontend/components/eventos/modalidad.ts::faseDe` | 4 |
| `frontend/services/eventos/obtenerEventos.ts` (filtro de eliminados) | 3. Difiere solo en 11 combinaciones que ningún código escribe: `estado` desactivado/cancelado con `panel:eliminado…`, o `panel:eliminados` |

### 5.3 Zona protegida (esperan una fase posterior)

| Consumidor | Criterio | Zona |
|---|---|---|
| `bot/funciones/eventos/detectarEvento.js::estadoTerminado` | B escrito a mano | creación y detección |
| `bot/funciones/eventos/guardarEvento.js`, `identidadEventoReal.js::buscarSorteoVigente` | `.eq("activo", true)` / `finDelEvento` | creación y detección |
| `sorteos/gruposSorteo.js` L136-165 y `vincular` L342 | `activo`; `!finDelEvento` (equivalente) | publicación y creación de la programación |
| `sorteos/publicador.js` L59, L963 | `activo` | motor de publicación |
| `automation/motorEventos.js` L292, L305 | `activo !== true`, `finDelEvento` | motor de publicación (apertura) |
| `sorteos/disponibilidad.js` (`revisarTabla`, `revisarGrupo`, `cierresDeIdentidades`) | `activo === false` | comprobaciones previas a publicar |
| `routes/tablas.js` L39, L124, L335 | `.eq("activo", true)` | Compartir (publicación) |
| `services/reservaManual.js::sorteoDelPrecio` | `.eq("activo", true)` | destino de la reserva manual (conflicto, §6.2) |

### 5.4 Dependen de C2, C3 o F3 (no tocar)

| Consumidor | Motivo |
|---|---|
| `shared/eventos/unSorteoPorPrecio.js` L50 | C2: reemplazo por precio y concurrencia (equivalente; sin tocar) |
| `bot/funciones/eventos/lifecycle/cerrarEvento.js` L73, L226; `evaluarEvento.js` L9 | F3: mecánica de cierre, opera sobre la columna que escribe |
| `sorteos/gestionEventos.js`, acciones cerrar/desactivar/cancelar/reabrir (L288-331) | F3: cierre manual; siguen la columna `activo` |
| `automation/scheduler.js` paso 1 (`activo === false` → `ejecutarCierre`) | F3: aviso de cierre y fin del ciclo |
| `sorteos/publicador.js`, rama del aviso de cierre | F3 |
| `bot/funciones/reservas/actualizarEvento.js` L78; `services/reservaManual.js::sincronizarContadores` L1394 | F3: los contadores deciden el cierre por «todo pagado» |
| Estado mostrado en Eventos, Sorteos programados y edición (`gestionEventos` C, `administracion` y `sorteosActivos` B) y `frontend/services/automatizacion/seguimientoProgramacion.ts` (`.eq("activo", true)`) | Regla 5 pendiente de F3 (§6.1) |

## 6. Conflictos detectados (no resueltos; requieren decisión)

### 6.1 Regla 5 en las pantallas de administración

Si Eventos mostrara «Cerrado» en una fila C3:

- el panel ofrecería «Reabrir aquí» y el backend lo rechazaría («El sorteo ya está activo»), porque `reabrir` actúa sobre filas con `activo` distinto de true;
- desaparecería «Cerrar aquí», hoy la única forma de reparar esa fila desde el panel (escribe `activo=false`).

Cambiar esas acciones es cierre manual (F3). Por la regla 3 tampoco se puede pasar solo Sorteos programados (`administracion`) o la edición (`sorteosActivos`): mostrarían «Terminado» mientras Eventos dice «En curso». Además, `sorteosActivos.obtener` alimenta Compartir y la vinculación de grupos (zonas protegidas).

**Hoy:** las tres pantallas siguen mostrando las filas C3 como antes, pero esas filas ya no aceptan reservas por WhatsApp ni reciben recordatorios. **Si el diagnóstico (§7) da 0 filas C3, el conflicto no tiene efecto práctico.**

### 6.2 Reserva manual del panel frente a la regla 1

`services/reservaManual.js` declara una regla de negocio vigente: «El estado del sorteo NO decide si se puede reservar: con sorteo activo (abierto o cerrado), programado o sin ninguno, el propietario reserva cuando quiere». Es la autoridad del administrador. Aplicarle la regla 1 cambiaría esa regla, así que **no se aplicó en código**.

> **SUSTITUIDO (06/11, revisión 2 de F3).** El responsable decidió que reservar es una **decisión del administrador**, independiente del estado del sorteo. La operación excepcional de abajo queda sustituida por el **permiso de reservas** (`permitidas` / `desactivadas` / `segun_estado`), en [F3_CIERRE_REAPERTURA.md](F3_CIERRE_REAPERTURA.md) §6. La regla 1 que F2 dejó en local equivale al permiso predeterminado `segun_estado`, así que es compatible. Se conserva el texto como historia de la decisión.

Propuesta anterior (descartada): se mantenía la regla 1 (un sorteo cerrado no acepta reservas nuevas) y, para el panel, una **operación administrativa excepcional**:

| Aspecto | Propuesta |
|---|---|
| Por defecto | La reserva manual del panel en un sorteo **no vigente** (cerrado, C3, `NULL`) o con la **hora de cierre pasada** se rechaza con el código `sorteo_cerrado` y un mensaje claro. Mismo criterio que el bot: `sorteoAceptaReservas`. Las reservas en un sorteo programado sin publicar y «sin sorteo» no cambian |
| Excepción | Petición explícita aparte, `excepcion: { motivo, confirmacion }`: un motivo de al menos 10 caracteres y la confirmación escrita `RESERVAR EN SORTEO CERRADO`. El operador sale del token, nunca del cuerpo de la petición |
| Requisito | Solo si la auditoría (032) está **disponible**: sin `reservas_auditoria` no se puede auditar y la excepción se rechaza (`auditoria_no_disponible`) |
| Auditoría | `reservas_auditoria`: `accion = reservar`, `origen = manual`, `codigo = excepcion_sorteo_cerrado`, el motivo y el estado del sorteo en ese instante. También en `reservas_actividad` («Reserva excepcional en sorteo cerrado»). Si el registro de auditoría falla, la reserva **no** se hace (auditoría antes de escribir, condición del caso excepcional) |
| Qué no cambia | Sigue siendo el mismo UPDATE condicionado a `libre` (`reservarNumeros`). No reabre el sorteo, no envía mensajes y no toca recordatorios ni el cierre |
| Panel | Diálogo propio («Este sorteo está cerrado: reservar es una excepción y queda registrada»), separado del flujo normal. Coherencia: el panel ya muestra «acepta reservas» con el mismo criterio que el backend |
| Pruebas | Rechazo por defecto (cerrado, C3, NULL, hora pasada); excepción sin motivo o sin confirmación rechazada; excepción sin la 032 rechazada; excepción válida → una reserva y una fila de auditoría; programado y «sin sorteo» sin cambios |

Archivos: `services/reservaManual.js` (destino y validación), `routes/tablas.js` (solo pasa `excepcion`), `frontend/components/tablas/ReservaManualForm.tsx` y `services/tablas/reservaManual.ts` (diálogo), pruebas en `tests/reservas` y `frontend/tests/tablas`. Cambia la regla vigente del propietario, así que **necesita autorización** antes de implementarse.

## 7. Diagnóstico (preparado, NO ejecutado)

Consulta: [`../activacion/estado_sorteos_contradicciones_solo_lectura.sql`](../activacion/estado_sorteos_contradicciones_solo_lectura.sql).

- **Solo lectura:** `begin; set transaction read only; … rollback;`. No crea nada, ni vistas temporales, porque una transacción de solo lectura no lo permite.
- **Sin datos personales:** no devuelve compradores, teléfonos, nombres de grupo ni textos.
- **Validada en local:** PGlite, en memoria y sin red. Da exactamente lo mismo que `estadosGestion.js` en 19 filas, incluidos motivos raros. La prueba [`estadoSorteosSqlReal.test.js`](../../backend/tests/caracterizacion/estadoSorteosSqlReal.test.js) lo repite con `--entorno` y `PGLITE_MODULE`.

Devuelve tres resultados:

1. **Resumen global:** filas totales, vigentes (canónico), en curso (C), abiertas (B), `activo_true_ya_cerrado`, `activo_null`, y cuántas filas afecta cada regla (`regla1_dejan_de_aceptar_reservas`, `regla2_sin_recordatorios`, `regla4_panel_pasa_a_cerrado`, `pendiente_f3_en_curso_en_eventos`).
2. **Por cliente** (`usuario_id`): casos de cada tipo y cuántos tienen números tomados (contadores `reservados`/`pagados` de la fila).
3. **Casos a revisar:** `evento_id`, `usuario_id`, tipo de contradicción, las cinco columnas de estado interpretadas (motivo, fin, vigente, B, C), tabla, valor, fecha, hora de cierre, contadores, ciclos de automatización en curso y grupos programados enlazados.

**Procedimiento para ejecutarla (cuando lo autorices):**

1. Abrir el SQL Editor del proyecto de Supabase.
2. Pegar el archivo **completo** y ejecutarlo. Termina en `ROLLBACK`.
3. Guardar los tres resultados.
4. Con ellos decidir §6.1 y §6.2. Si `activo_true_ya_cerrado = 0`, la regla 5 se puede completar en las pantallas sin efecto visible. Si es mayor que 0, la reparación de esas filas va a F3 (acciones) o F4 (datos).

## 8. Archivos de F2

- **Backend:** `shared/eventos/estadosGestion.js`, `consultarEvento.js`, `procesarSorteo.js`, `workerEventos.js`, `detectarReserva.js`, `consultarMisNumeros.js`, `confirmarPagoPorSticker.js`, `automation/scheduler.js`, `sorteos/publicador.js`, `sorteosActivos.js`, `administracion.js`, `gestionEventos.js`.
- **Panel:** `components/eventos/estadoEvento.ts`, `agruparEventos.ts`, `modalidad.ts`, `GruposAsociados/GruposAsociados.tsx`, `services/eventos/obtenerEventos.ts`.
- **Pruebas:**
  - `caracterizacion/criteriosEstadoSorteo.test.js` y `caracterizacion/estadoSorteosSqlReal.test.js` (nuevas);
  - fixtures con `activo: true` en `reservas/reaccionesReserva`, `reservas/reservaCifras` y 6 pruebas de `consultas/` (representan un sorteo en curso; sin `activo` cuentan como cerrados por la regla 4);
  - cargadores con imports relativos en 5 pruebas;
  - `scripts/pruebas/ejecutar.js` registra la prueba SQL como «requiere entorno».
