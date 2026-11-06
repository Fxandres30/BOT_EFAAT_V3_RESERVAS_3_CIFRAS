# F3: orquestador central del cierre y la reapertura (diseño)

06/11/2026, sobre `f9743a4d` + F2 local. **Solo auditoría y diseño: no se ha implementado nada de F3.**

Revisión 2 (06/11), con dos decisiones del responsable:

1. **Se conservan todas las formas de cierre.** Se elimina la ejecución duplicada, no las modalidades. Cada una conserva su disparador, su motivo, sus condiciones, sus reglas y su origen; todas pasan por los mismos mecanismos centrales.
2. **Reservar es una decisión del administrador**, independiente del estado del sorteo (§6).

## 1. Principio

```
Disparador (propio de cada modalidad)          Orquestador central (uno solo)
-------------------------------------          ------------------------------------------------
worker: hora / todo pagado / atrasado   ─┐     1. resolver filas y alcance (grupo, sorteo, precio)
panel: cerrar, desactivar, cancelar,     │     2. validar la transición (estadosGestion)
       eliminar, reabrir, normalizar     ├──►  3. control de concurrencia (escritura condicionada)
detección: anuncio de otro sorteo        │     4. WhatsApp según la política de la modalidad + reintentos
publicación: mismo precio / reinicio    ─┘     5. escribir el fin (una sola primitiva)
                                               6. coordinar automatización (ciclo y avisos)
                                               7. sincronizar los grupos asociados
                                               8. historial
                                               9. programación asociada (publicaciones pendientes)
```

El orquestador **no decide cuándo** cerrar: eso lo decide cada modalidad. Decide **cómo** se ejecuta un cierre, siempre igual.

## 2. Modalidades que se conservan (todas)

Encontradas en la auditoría del código actual. «Perfil» es la declaración que cada modalidad entrega al orquestador. No se cambia ninguna regla comercial: cada perfil reproduce lo que hace hoy.

| Modalidad | Disparador actual | Condición propia | `estado` final | Prefijo de `cierre_motivo` (sin cambios) | Aviso de cierre | WhatsApp | Alcance | Deuda | Otros efectos |
|---|---|---|---|---|---|---|---|---|---|
| **hora** | `workerEventos` → `procesarSorteo` | `verificarHoraCierre` (fecha + hora de Colombia) | cerrado | `hora` | sí | **antes**, con reintentos | todo el sorteo (todos sus grupos) | sigue | si el grupo es de otro sorteo vigente: solo se marca |
| **pagados** | igual | `estadoDelSorteo().completo` | cerrado | `pagados` | sí | antes, con reintentos | todo el sorteo | — | — |
| **recuperado** («vencimiento» de la hora con el proceso caído) | igual | `cierreAtrasado` | cerrado | `hora (recuperado: …)` | **no** (aviso tardío) | antes; solo se marca si el grupo es de otro sorteo | todo el sorteo | sigue | — |
| **manual: cerrar** | panel, Eventos | fila en curso | cerrado | `panel:cerrado manualmente` | sí | **después** (hoy); opcional (`cerrar_grupo_whatsapp`) | grupo o todos | sigue | — |
| **manual: desactivar** | panel | fila en curso | desactivado | `panel:desactivado` | no | no | grupo o todos | sigue | detiene las publicaciones pendientes |
| **cancelación** | panel | cualquier fila no cancelada | cancelado | `panel:cancelado` | no | no | todos | **sin deuda** | detiene la programación |
| **eliminación** (lógica) | panel | cualquier fila | eliminado | `panel:eliminado` | no | no | todos | sin deuda | `archivado_en`, oculta |
| **sustitución por anuncio** | `detectarEvento` (otro sorteo en el grupo) | anuncio nuevo | cerrado | `sustituido por el anuncio de …` | no | no (el anuncio nuevo lo abre) | ese grupo | sigue | — |
| **sustitución por precio** | `detectarEvento`, `publicador` | otro sorteo activo del mismo precio | cerrado | `sustituido …` | no | no | todos los grupos del precio | sigue | **todo o nada**, con deshacer |
| **sustitución para reiniciar la tabla** | `publicador.reemplazarParaReiniciar` | reinicio elegido al programar | cerrado | `sustituido …` | no | no | precio | sigue | todo o nada, con deshacer |
| **sustitución al reabrir** | panel, reabrir con «sustituir» | conflicto de grupo o precio | cerrado | `sustituido por … (reabierto desde el panel)` | no | no | los conflictos | sigue | — |
| **normalización** (nueva, administrativa) | panel, sobre una fila C3 | `activo = true` y `finDelEvento` ya dice que terminó | **sin cambios** (ya está cerrada) | `normalizado:` delante del motivo existente | **no** | no | esa fila | igual que su fin | cierra su ciclo abierto |

**No son cierres del sorteo**, pero el orquestador los coordina o los respeta:

- **Vencimiento de reservas** (`publicador.liberarVencidas`): libera reservas no pagadas mientras el sorteo está vigente, si el sorteo lo activó. **Sigue fuera** del orquestador (es de reservas) y no cambia.
- **Fin de la programación** (`publicador.finalizarSorteo`, `administracion.cancelar` / `cerrarTrasCancelar`): es otra entidad. El orquestador solo llama al paso 9 cuando la modalidad lo pide; los dos cálculos del estado final se unifican en una función de `sorteos/repo` o `administracion` (sin cambiar su resultado).

## 3. Responsabilidades

| Pieza | Responsable de | Nunca hace |
|---|---|---|
| Disparador de cada modalidad (worker, panel, detección, publicador) | Decidir **cuándo** y **por qué**; construir la solicitud con su perfil y su origen (actor) | Escribir `eventos_bot`, cerrar WhatsApp o enviar avisos por su cuenta |
| `estadosGestion.js` (F2) | Interpretar el estado de una fila (`vigente`, `finDelEvento`, `motivoGestion`, `cierreSilencioso`, `sinDeuda`, `contradicciones`) | Escribir |
| **Orquestador** `lifecycle/orquestadorCierre.js` (evolución de `cerrarEvento.js`) | Los pasos 1-9 de §1 para **cualquier** modalidad; la reapertura (§5); la normalización | Decidir cuándo cerrar; cambiar el permiso de reservas (§6) |
| Scheduler y publicador | **Enviar** los avisos de cierre que el orquestador dejó decididos, una vez por cierre (§4.6) | Decidir el cierre |
| `motorEventos` | Abrir o reanudar el ciclo cuando el orquestador lo restaura al reabrir | — |

## 4. Cómo se ejecuta el cierre central

```
cerrar(solicitud) -> resultado
  solicitud = { modalidad, perfil, filas | identidad | grupoId, alcance, motivo, actor, parametros, ahora }
  resultado = { porFila: [{ id, escrita, yaTerminada, transicionInvalida, whatsapp, reintento }], aviso, historial }
```

### 4.1 Resolver filas y alcance

`alcance` sale del perfil: «grupo», «sorteo» (todas las filas de la identidad) o «precio» (las del mismo precio en otros grupos). Se recogen **todas** las filas afectadas antes de escribir nada.

### 4.2 Validar la transición

Tabla única de transiciones, por modalidad. Reproduce las reglas actuales:

- Cerrar, desactivar y las sustituciones solo actúan sobre filas `vigente`.
- Cancelar actúa también sobre filas ya cerradas, salvo las ya canceladas (como hoy).
- Eliminar actúa sobre cualquier fila.
- Normalizar actúa solo sobre filas C3.

Una fila fuera de su transición devuelve `transicionInvalida` sin escribir.

### 4.3 Concurrencia (cierres simultáneos)

- **Toda** escritura es condicionada: `eq("activo", true)` cuando se exige una fila vigente, o `eq` del estado y el motivo leídos (cancelar, eliminar y normalizar). Hoy dos de las cuatro escrituras no lo son (`cambiosFin`, `sustituirEnGrupo`).
- **Gana el primero.** El segundo recibe `yaTerminada` y su modalidad queda en el historial como «omitida: ya cerrada por …», sin reescribir el motivo.
- Las modalidades **todo o nada** (precio, reinicio) conservan su deshacer: si una fila falla, se restauran las ya escritas, solo si siguen con el motivo de este reemplazo, como hace hoy `revertirReemplazo`.
- **No se toca C2** (índice único y carrera detector/publicador): F3 solo hace condicionadas las escrituras de cierre, no la creación.

### 4.4 WhatsApp y reintentos

Una sola función con tres políticas, declaradas en el perfil:

- **«antes»:** el automático. Igual que hoy: cerrar el grupo, y solo si WhatsApp confirma, escribir. Si falla, `cierre_intentos` con espera creciente y `requiere_revision` a los 10.
- **«después»:** el manual. Escribir y luego cerrar el grupo. Si falla, se deja `abierto = true` y el **mismo** registro de reintentos (`cierre_*`), y el worker lo reintenta con la misma espera. Hoy no se reintenta nunca.
- **«no»:** las sustituciones, la desactivación, la cancelación, la eliminación y la normalización.

Se conserva la comprobación «grupo en uso por otro sorteo», también de otra cuenta: entonces no se cierra el grupo, solo se marca la fila.

### 4.5 Escribir el fin

Una sola primitiva, `escribirFin(fila, perfil, motivo)`. Escribe `activo=false`, `estado`, `cierre_estado='cerrado'`, `cierre_motivo`, `cerrado_en`, el `archivado_en` de la eliminación y limpia `cierre_ultimo_error`. Tiene **un** respaldo para «sin la migración 023»; hoy hay tres copias. Las columnas que escribe cada modalidad son exactamente las de hoy, y una prueba lo fija.

### 4.6 Automatización y avisos sin duplicados

- **Se conserva el reparto actual.** El scheduler reacciona a `activo === false`: envía el aviso del grupo (`CLOSE_MESSAGE`) y termina el ciclo. El publicador envía el aviso del sorteo cuando el sorteo es el que anuncia (`prioridadComunicaciones`). El orquestador no envía mensajes, igual que hoy `procesarSorteo`.
- **Silencio por modalidad.** «Aviso de cierre: no» en el perfil equivale a un motivo silencioso. Se mantiene `cierreSilencioso` (prefijos actuales, más `normalizado:`).
- **Una vez por cierre.** La clave del aviso incluye el instante del cierre: `<ciclo>:CLOSE_MESSAGE:<cerrado_en>` y `sorteo:<id>:grupo:<g>:aviso_cierre:<cerrado_en>`.
  - Dos cierres simultáneos son uno solo (gana el primero, §4.3), así que hay un aviso.
  - Un cierre tras reabrir tiene otro `cerrado_en`, así que tiene su propio aviso.
  - **Compatibilidad:** `avisoCierreYaEnviado` busca también las claves antiguas, sin sufijo, para los cierres anteriores al despliegue.
- **Recordatorios:** dejan de salir porque la fila ya no es vigente (F2). No hay un segundo mecanismo de detención.

### 4.7 Grupos asociados

`alcance: "sorteo"` cierra todas las filas de la identidad con la misma solicitud. El resultado de cada fila es independiente: un fallo en un grupo no deshace los demás, salvo en las modalidades todo o nada. La propagación a los grupos hermanos de `cerrarEvento` queda dentro de este paso (ver §8, código sin uso).

### 4.8 Historial

Cada solicitud deja **un** registro estructurado: modalidad, actor (operador del token o «sistema»), origen, motivo, filas, resultado por fila, WhatsApp, aviso decidido e instante.

- **Sin migración:** el registro va al historial de la programación (038) si el evento la tiene, y al log estructurado si no.
- **Persistencia para todos los eventos:** necesita una tabla (F4). Decisión en §9.

### 4.9 Programación asociada

Si el perfil lo pide (desactivar, cancelar, eliminar), se llama a `detenerPublicacionesPendientes` y después al cálculo único del estado final de la programación. Es la lógica actual, en un solo sitio.

## 5. Reapertura central

```
reabrir({ filas | eventoId, alcance, horaCierre, sustituir, actor, ahora })
```

1. **Validar:** la fila no está vigente y no está eliminada; la nueva hora de cierre es futura y no posterior a la del sorteo. Son las reglas actuales de `gestionEventos`.
2. **Conflictos** (otro sorteo en el grupo o del mismo precio, 043): sin `sustituir`, se rechaza como hoy. Con `sustituir`, cada conflicto pasa por el orquestador con la modalidad «sustitución al reabrir», así que hay un solo mecanismo.
3. **Escritura condicionada** al estado leído: `activo=true`, `estado='abierto'`, `abierto=false` (el worker reabre WhatsApp, como hoy), nueva `hora_cierre` y se limpian los `cierre_*`.
4. **Restaurar el ciclo de automatización**, que hoy no se hace (D8). Opción a decidir en §9:
   - **(a)** reabrir el mismo `event_session` (`estado = abierto`);
   - **(b)** crear un ciclo de reapertura con la identidad del ciclo más un sufijo `:reapertura:<n>`.

   En los dos casos el anuncio de apertura no se reenvía y los recordatorios vuelven dentro de su ventana normal.
5. **Nuevos cierres legítimos:** como la clave del aviso lleva `cerrado_en`, el siguiente cierre (por hora, por pagos o manual) se anuncia una vez.
6. **Historial**, igual que un cierre.
7. **No cambia:** las reservas, los pagos y **el permiso de reservas** (§6).

### Normalización (`normalizarCierre`): se conserva

**Hace falta** para las filas históricas `activo=true` que ya terminaron (C3). Hoy:

- ninguna pantalla puede repararlas: «Cerrar» no las ve como terminadas y «Reabrir» las rechaza;
- su ciclo queda abierto para siempre;
- son la única razón por la que Eventos, Sorteos programados y la edición no pueden usar todavía el criterio canónico (F2 §6.1).

Qué hace: `activo=false` y `normalizado:` delante del motivo. No toca `estado` ni el resto de `cierre_*` ni WhatsApp, no avisa y deja que el scheduler cierre el ciclo en silencio. Las reservas, los pagos y la deuda quedan igual. El diagnóstico dirá cuántas filas hay. Si son 0, se conserva igual como herramienta de reparación y se deja disponible solo para filas que la necesiten.

## 6. Permiso de reservas (independiente del estado)

### 6.1 Qué existe hoy (investigado)

| Fuente | ¿Es un permiso del administrador? | Conclusión |
|---|---|---|
| `aceptaReservas` (`detectarReserva.sorteoAceptaReservas`, `reservaManual`, `reservasAnticipadas`) | **No:** se calcula a partir del estado y la hora | Pasará a usar el permiso |
| `eventos_bot.hora_cierre` (cierre de reservas) | Es una **hora** que elige el administrador, no un interruptor | Sigue siendo el disparador del cierre automático |
| `configuracion_seleccion_mensajes.habilitada` (003) | No: su migración dice que es solo de presentación y que **nunca** controla reservas | No se reutiliza |
| `sorteos_programados.config.reservas` (`liberar_no_pagados`, `vencimiento_minutos`) | Configuración de reservas, pero **solo** de los sorteos del panel; los detectados no tienen programación | Insuficiente sola |
| `eventos_bot.publicacion_panel` (jsonb, 036) | Es de publicación y hay una por grupo | Se podría usar sin migración, pero mezcla conceptos |
| Grupos autorizados, contactos bloqueados, grupo de WhatsApp abierto o cerrado | Son reglas de seguridad y de canal, no un permiso de reservas | Se siguen respetando siempre |

**No existe** una fuente de verdad del permiso de reservas. Hay que crear **una** sola (§6.3), no una segunda.

### 6.2 Comportamiento

El permiso tiene tres valores. El tercero es el **predeterminado** y reproduce exactamente el comportamiento actual, así que no cambia nada mientras el administrador no lo toque:

| Permiso | Sorteo abierto | Sorteo cerrado |
|---|---|---|
| `permitidas` | acepta | **acepta** (decisión del administrador) |
| `desactivadas` | **rechaza** | rechaza |
| `segun_estado` (predeterminado) | acepta | rechaza (lo actual, incluida la regla de F2) |

- **Siempre se respetan**, con cualquier permiso: grupo autorizado, contacto bloqueado, formato y cifras, disponibilidad del número, cuadrícula del cliente y el filtro por cliente.
- **Cancelado, eliminado y sustituido:** con `permitidas`, ¿también aceptan? La propuesta es **no**: un cancelado no tiene deuda y un eliminado no se muestra. Decisión en §9.
- **Canales:**
  - Con el sorteo cerrado por hora, el grupo de WhatsApp queda cerrado y los clientes no pueden escribir. «Permitidas» solo tiene efecto por el panel o por el grupo si el administrador lo reabre en WhatsApp.
  - El permiso **no** reabre el grupo: el estado y el permiso son independientes. Decisión en §9.
- **Automatizaciones:** nada lo cambia por su cuenta. Ni el cierre, ni la reapertura, ni el reinicio, ni el publicador lo escriben. Solo el administrador.
- **Reservas existentes y pagos:** cambiar el permiso, cerrar o reabrir no altera ningún número reservado ni pagado.

### 6.3 Dónde se guarda (a decidir)

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A (recomendada)** | Columna nueva `eventos_bot.reservas_modo text` (`segun_estado`, `permitidas`, `desactivadas`; NULL = `segun_estado`), escrita en **todas** las filas de la identidad. Para programados no publicados, `sorteos_programados.config.reservas.modo`, que se copia a las filas al publicar | Explícita, consultable y con CHECK | **Migración (F4)** |
| B | Clave `reservas_modo` dentro de `eventos_bot.publicacion_panel` (036, ya existe) | Sin migración | Mezcla publicación y reservas; jsonb sin CHECK |
| C | Solo `sorteos_programados.config.reservas.modo` | Sin migración | Los sorteos detectados no podrían configurarlo |

### 6.4 Validación y auditoría

- **Una sola función:** `puedeReservar({ fila, permiso, ahora, canal })`, en la fuente única de estado. La usan el bot (`sorteoAceptaReservas`), el panel (`reservaManual`) y los programados (`reservasAnticipadas`). El panel muestra el mismo resultado («acepta reservas: sí/no» y por qué).
- **Cambiar el permiso** es una operación administrativa propia, con su ruta: queda en el historial (§4.8), con el operador del token y los valores anterior y nuevo.
- **Una reserva aceptada en un sorteo cerrado** porque el permiso lo permite queda en `reservas_auditoria` con `codigo = sorteo_cerrado_permitido`.

### 6.5 Relación con F2

- La regla 1 que F2 dejó en local (`sorteoAceptaReservas` con `vigente` y la hora) es **exactamente** `segun_estado`, el predeterminado. Es compatible y no hay que deshacerla.
- La «operación excepcional» propuesta en `ESTADO_SORTEOS.md` §6.2 **queda sustituida** por el permiso `permitidas`.
- La reserva manual del propietario, que hoy ignora el estado, pasará a respetar el permiso. **Es un cambio de regla y necesita autorización** (§9).

## 7. Archivos que cambiarían (cuando se autorice)

| Archivo | Cambio |
|---|---|
| `backend/bot/funciones/eventos/lifecycle/cerrarEvento.js` → `orquestadorCierre.js` (`cerrarEvento.js` se conserva como fachada) | Orquestador, perfiles, `escribirFin`, WhatsApp y reintentos, `reabrir`, `normalizarCierre` |
| `backend/shared/eventos/estadosGestion.js` | Tabla de transiciones, `normalizado:` silencioso, `puedeReservar` |
| `lifecycle/procesarSorteo.js` | Pide «hora», «pagados» o «recuperado» al orquestador (mismo comportamiento) |
| `backend/sorteos/gestionEventos.js` | Las acciones se convierten en solicitudes; reapertura central; normalizar; ruta del permiso |
| `backend/bot/funciones/eventos/detectarEvento.js` (solo `sustituirEnGrupo`), `shared/eventos/unSorteoPorPrecio.js`, `sorteos/publicador.js` (`reemplazarParaReiniciar` y clave del aviso) | Usar el orquestador. **Zonas protegidas: necesita autorización** |
| `backend/automation/scheduler.js`, `automation/prioridadComunicaciones.js` | Clave del aviso por cierre, con compatibilidad |
| `backend/automation/repo/eventSessions.js`, `automation/motorEventos.js` | Restaurar el ciclo al reabrir |
| `backend/sorteos/administracion.js`, `sorteos/repo.js` | Estado final de la programación en una sola función |
| `backend/bot/funciones/reservas/detectarReserva.js`, `services/reservaManual.js`, `sorteos/reservasAnticipadas.js` | `puedeReservar` (permiso). **Cambia la lógica de reservas: necesita autorización** |
| `backend/routes/sorteos.js` | Ruta del permiso de reservas |
| `frontend/components/sorteos/AccionesSorteo.tsx`, `components/eventos/estadoEvento.ts`, `components/tablas/ReservaManualForm.tsx`, `services/sorteos/apiSorteos.ts` | Estado canónico tras normalizar, acción «Cerrar» = normalizar en las filas C3, interruptor del permiso de reservas |
| Migración (F4, si se elige la opción A) | `eventos_bot.reservas_modo` |

**No se elimina código** en F3 sin autorización. La cadena sin uso (`procesarEvento`, `evaluarEvento`, `verificarTodosPagados`, la propagación de `cerrarEvento`, `marcarCerrando`, `marcarExpirado`) queda señalada; se retiraría después de pasar sus pruebas al camino vivo.

## 8. Riesgos y pruebas

### Riesgos

| Ámbito | Riesgo | Mitigación |
|---|---|---|
| Comportamiento | Que un perfil no reproduzca exactamente su modalidad actual | Caracterización previa de **cada** modalidad: columnas escritas, WhatsApp, aviso, alcance y deuda. El perfil debe dar lo mismo |
| Reservas | Que el permiso cambie el comportamiento sin que el administrador actúe | El predeterminado `segun_estado` es lo actual; una prueba compara la matriz completa |
| Reservas | Que cerrar, reabrir, normalizar o cambiar el permiso toque la cuadrícula | 0 escrituras en las tablas de números en todas las pruebas del orquestador |
| Pagos | Que la deuda cambie | `sinDeuda` sin cambios; el sticker y «¿qué debo?» siguen con `vigente` |
| Avisos | Duplicados al cambiar la clave | Se buscan las claves nuevas y las antiguas; C4 ampliada |
| Avisos | Aviso al normalizar o en un cierre recuperado | Perfiles silenciosos; pruebas específicas |
| Concurrencia | Cierre manual y automático a la vez | Escritura condicionada: un ganador, un aviso, historial de los dos |
| WhatsApp | Grupo de otra cuenta cerrado por error | Se conserva «grupo en uso»; prueba con dos cuentas |
| Ciclo | Recordatorios tras reabrir fuera de su ventana | Ventana actual; prueba |
| Zonas protegidas | Tocar la detección y el reemplazo por precio | Solo con autorización; si no, se quedan con su escritura propia, envuelta pero sin cambiar |

### Pruebas necesarias

1. **Caracterización** de las 12 modalidades **antes** de implementar: qué escribe cada una, WhatsApp, aviso, alcance, deuda y programación.
2. **Orquestador:**
   - idempotencia;
   - transiciones válidas e inválidas;
   - concurrencia (manual frente a automático, dos manuales, reemplazo frente a cierre por hora);
   - todo o nada con deshacer.
3. **WhatsApp:** antes / después / no; reintentos con espera; grupo en uso.
4. **Avisos:** uno por cierre; ninguno en las modalidades silenciosas; reabrir y volver a cerrar = un aviso nuevo; las claves antiguas evitan reenvíos.
5. **Reapertura:** conflictos, sustitución a través del orquestador, ciclo restaurado, recordatorios en su ventana, sin anuncio duplicado.
6. **Normalización:** solo filas C3, sin aviso, ciclo cerrado, números intactos.
7. **Permiso de reservas:** la matriz de §6.2 en el bot, el panel y los programados; el predeterminado igual que hoy; los límites de seguridad siempre; las automatizaciones no lo cambian; auditoría del cambio y de las reservas en un sorteo cerrado.
8. **Panel = backend:** el mismo estado, las mismas acciones posibles y el mismo «acepta reservas» para cada fila de la matriz de F2.
9. **Suite completa** con la línea base (199/198, 0 inesperados, 0 intentos de red).

## 9. Decisiones que necesitan autorización

1. Ejecutar el diagnóstico (`docs/activacion/PROCEDIMIENTO_DIAGNOSTICO_ESTADOS.md`).
2. Dónde se guarda el permiso de reservas: **A** (columna nueva, migración F4, recomendada), **B** (`publicacion_panel`) o **C** (solo programados).
3. Con `permitidas`, ¿aceptan reservas también los sorteos **cancelados, eliminados o sustituidos**? Se propone que no.
4. Con el sorteo cerrado y `permitidas`, ¿el permiso solo afecta a las reservas del panel y del grupo si está abierto (propuesto), o debe reabrir el grupo de WhatsApp?
5. La reserva manual del propietario pasa a respetar el permiso (hoy ignora el estado).
6. Reapertura del ciclo: **(a)** el mismo ciclo o **(b)** un ciclo de reapertura.
7. Cierre manual con WhatsApp: mantener «base primero» añadiendo reintentos (propuesto) o igualarlo a «WhatsApp primero».
8. «Cerrar» sobre una fila C3 = normalización silenciosa (propuesto) o con aviso.
9. Llevar al orquestador las modalidades de las zonas protegidas: sustitución por anuncio (detección) y sustitución por precio o reinicio (C2 y publicación).
10. Historial de las acciones sobre eventos: log estructurado más el de la programación (F3) o tabla nueva (F4).
11. Retirar la cadena de cierre sin uso, una vez migradas sus pruebas.

## Anexo A. Auditoría del código actual (revisión 1, vigente)

### A.1 Quién termina o reabre una fila de `eventos_bot` hoy

| # | Implementación | La invoca | Escritura | WhatsApp | Historial |
|---|---|---|---|---|---|
| A1-A3 | `lifecycle/cerrarEvento.js::cerrarFilaDeEvento` vía `procesarSorteo` (hora, pagados, recuperado) | `workerEventos` (cada 30 s) | condicionada a `activo = true`; respaldo 023 | **antes**, con reintentos (`cierre_intentos`, `requiere_revision` a los 10) | columnas `cierre_*` |
| A4 | `procesarEvento → evaluarEvento → verificarTodosPagados → cerrarEvento` (propaga a los grupos hermanos) | **nadie en producción**; solo `tests/eventos/cierrePorPagos.test.js` y `_test_consistencia_grupos.js` | usa `cerrarFilaDeEvento` | igual | — |
| S1 | `detectarEvento.js::sustituirEnGrupo` | detección | **sin condición**; respaldo 023 propio | no | columnas |
| S2 | `unSorteoPorPrecio.js::reemplazarAnteriores` / `revertirReemplazo` | `detectarEvento`, `publicador` | condicionada; todo o nada | no | columnas |
| M1 | `gestionEventos.js::aplicar` (cerrar, desactivar, cancelar, eliminar) | panel | **sin condición** (`cambiosFin`) | solo «cerrar»: **después**, sin reintento; omite el grupo en uso | **solo `console.log`** |
| M2 / R1 | `gestionEventos.aplicar("reabrir")` (+ sustituir) | panel | **sin condición** | `abierto=false` → el worker reabre | `console.log` |
| R2 | `unSorteoPorPrecio.revertirReemplazo` | reemplazo fallido | condicionada al mismo motivo | no | — |
| — | `guardarEvento` / `publicador.eventoTerminado` | — | **rechazan** reactivar una fila terminada | — | — |

**Avisos:**

- El scheduler (`ejecutarCierre`, cuando `activo === false`) envía `CLOSE_MESSAGE` con la clave `<ciclo>:CLOSE_MESSAGE` y después `marcarCerrado`.
- El publicador envía `SORTEO_AVISO_CIERRE` con la clave `sorteo:<id>:grupo:<g>:aviso_cierre`.
- `prioridadComunicaciones.avisoCierreYaEnviado` cruza las dos claves.
- «Cerrar» desde el panel no es silencioso; desactivar, cancelar, eliminar, sustituido y recuperado sí.
- `eventSessions.marcarCerrando` y `marcarExpirado` no tienen uso.
- `motorEventos.reanudarApertura` solo reanuda ciclos **pendientes**.

**Reservas:** ningún cierre toca la cuadrícula. Los números solo se liberan por vencimiento (`liberarVencidas`), por el panel o con el reinicio (030).

**043:** su índice de exclusión ya **excluye** las filas C3: no ocupan el precio.

### A.2 Duplicaciones

| Id | Duplicación | Consecuencia |
|---|---|---|
| D1 | La escritura del fin aparece 4 veces; 2 sin condición (`cambiosFin`, `sustituirEnGrupo`) | Un cierre manual y uno automático simultáneos se pisan |
| D2 | El respaldo «sin la 023» está copiado 3 veces | — |
| D3 | Cierre por pagos dos veces (`verificarTodosPagados` sin uso; `estadoDelSorteo().completo` vivo) | Las pruebas de pagos prueban el camino que producción no usa |
| D4 | Propagación a los grupos hermanos dos veces (A4 y `procesarSorteo`) | — |
| D5 | Sustitución tres veces (S1, S2, M2) | Solo S2 es todo o nada |
| D6 | Dos políticas de WhatsApp opuestas (automático antes con reintento; manual después sin reintento) | Un cierre manual que falla deja el grupo abierto |
| D7 | Dos emisores de aviso con claves permanentes | Ver D8 |
| D8 | La reapertura no restaura el ciclo | Sin recordatorios tras reabrir y sin aviso del segundo cierre |
| D9 | El estado final de la programación se calcula dos veces (`finalizarSorteo`, `cerrarTrasCancelar`) | — |
| D10 | La regla de «activo» está copiada en SQL (043), algo más amplia (cualquier `panel:`) | Coincide en lo que escribe el código |
| D11 | Las pantallas de administración usan los criterios B y C | Regla 5 pendiente (F2 §6.1) |

## Implementación (06/11/2026, local, sin commit)

Por etapas (F3-A a F3-F), con la suite completa en verde: 201 archivos, 200 ✅, 0 inesperados, 0 intentos de red.

| Etapa | Qué se hizo | Prueba |
|---|---|---|
| **F3-A** caracterización | Las 12 modalidades, la reapertura y dos casos simultáneos, fijados **antes** de tocar código: columnas, cuadrícula, WhatsApp, avisos y ciclos | `backend/tests/caracterizacion/modalidadesCierre.test.js` (C6, 15 casos) |
| **F3-B** orquestador | Dentro de `lifecycle/cerrarEvento.js`, evolucionando `cerrarFilaDeEvento` (sin un segundo motor): `MODALIDADES` (perfiles), `terminarFila`, `escribirFin` (escritura **condicionada en la base** con un único respaldo 023/039/CHECK), `registrarHistorialEvento`, `grupoEnUsoPorOtro`, `reintentarCierresWhatsapp` (reintentos del cierre manual en el worker de siempre) | C6 + `orquestadorCierre.test.js` |
| **F3-C** migración | Pasan por el orquestador:<br>• hora, pagados y recuperado (`procesarSorteo` → `cerrarFilaDeEvento`)<br>• cerrar, desactivar, cancelar y eliminar (`gestionEventos`)<br>• sustitución por anuncio (`detectarEvento.sustituirEnGrupo`)<br>• sustitución por precio y para reiniciar (`unSorteoPorPrecio.reemplazarAnteriores`, mismo algoritmo, todo o nada y deshacer)<br>• sustitución al reabrir<br>• **normalización**: «Cerrar» sobre una fila C3 | C6, `gestionEventos.test`, `unSorteoPorPrecioAnuncio.test` |
| **F3-D** reapertura | `reabrirFila`: condicionada al estado leído, con historial. Abre un **ciclo lógico nuevo** por grupo (`engine.onEventoDetectado` con sufijo `:reapertura:<instante>`; el anterior se conserva) sin repetir la apertura ni la tabla inicial (`motorEventos.abrirCicloDeReapertura`). Avisos por **vigencia actual** (`prioridadComunicaciones.ciclosDelEvento`, `sufijoAvisoCierre`); sin reapertura, las claves de siempre | C6 (reapertura), F3-F 4 |
| **F3-E** permiso de reservas | `eventos_bot.reservas_modo` (migración **047, preparada y no aplicada**) y `estadosGestion.puedeReservar`. Lo aplican el bot (`sorteoAceptaReservas`) y la reserva manual y por lote (`reservaManual`, destino `destinoSorteoDelPrecio`). Se cambia con `PUT /sorteos/eventos/:id/reservas` (operador del token, historial). Panel: selector en `AccionesSorteo` | F3-F 5a-5e, `reservaManual.test`, `operacionesLote.test` |
| **F3-F** validación | Idempotencia y protección en la base, WhatsApp antes y después con reintentos y **tras reiniciar el worker**, aviso propio del sorteo tras reabrir, matriz del permiso, sin migración, reserva en un sorteo cerrado sin reabrir WhatsApp, reservas y pagos intactos, panel = backend | `orquestadorCierre.test.js` (13 casos) |

### Cambios de comportamiento intencionados (todos con prueba)

1. **Dos cierres simultáneos:** escribe uno solo; el otro queda en el historial como `ya_terminada` (antes escribían los dos).
2. **Cancelar o eliminar sobre una fila que otra acción acaba de cerrar:** se relee y se aplica sobre el estado actual. El resultado comercial es el de siempre (todo el sorteo cancelado), pero sin escrituras a ciegas.
3. **«Cerrar» sobre una fila C3** = normalización silenciosa (`normalizado: <motivo>`): no reescribe el motivo, no toca WhatsApp y no envía aviso tardío.
4. **Cierre manual con WhatsApp fallido:** queda `abierto=true` con el error y el worker lo reintenta con espera creciente (antes se perdía).
5. **Reabrir:** ciclo nuevo y, en el siguiente cierre, **un** aviso por grupo (antes ninguno).
6. **Reserva manual y por lote:** respetan el permiso. Con el predeterminado, un sorteo cerrado o con la hora pasada **rechaza** (antes el propietario reservaba igual); con `permitidas`, reserva. «Sin sorteo» y las reservas anticipadas no cambian.
7. **Las acciones del panel** registran como actor el operador **del token**, nunca el que envía el navegador.

### Pendiente o a decidir

- **Migraciones 047 (permiso) y 048 (historial):** preparadas y **no aplicadas**. Sin la 047 todo es `segun_estado` y el panel avisa al intentar cambiarlo. Sin la 048, el historial queda en el log.
- **Regla 5 en las pantallas de administración:** ya existe la normalización, así que Eventos, Programados y la edición podrían pasar al criterio canónico sin botones que fallen. No se ha hecho: cambia lo que se muestra y requiere tu decisión (y el diagnóstico SQL).
- ~~WhatsApp doble en un cierre automático y manual simultáneos~~: resuelto en el endurecimiento (abajo).
- **Código sin uso, no eliminado** (F3 no elimina código):
  - `gestionEventos.cerrarWhatsApp` y `actualizarFila`, que solo se usa ya en esa función;
  - la cadena A4 (`procesarEvento`, `evaluarEvento`, `verificarTodosPagados`, la propagación de `cerrarEvento`);
  - `eventSessions.marcarCerrando` y `marcarExpirado`.
- **Despliegue:** nada tiene efecto hasta desplegar el backend en el Droplet y el panel.

## Endurecimiento antes de F4 (06/11/2026, local, sin commit)

Suite completa: 203 archivos, 202 ✅, 0 inesperados, 1 conocido, 3 con entorno, 0 intentos de red.

### 1. Un solo cierre de WhatsApp por grupo, también entre procesos

- **Causa:** el cierre automático llama a WhatsApp **antes** de escribir y el manual **después** de ganar la escritura. Si coincidían en la misma fila, llamaban los dos. Lo mismo pasaba con dos workers o con el reintento.
- **Solución:** sin motor nuevo. `cerrarEvento.cerrarGrupoProtegido` pasa el cierre del grupo por el registro central de ejecuciones (`executionGuard`, tabla `automation_actions`, clave única en Postgres), con clave `CIERRE_GRUPO:<grupo>:<fila>`. No necesita migración. La usan los tres caminos: automático, manual y reintento.

| Estado del registro | Qué hace el siguiente que llega |
|---|---|
| `ok` | No llama a WhatsApp: el grupo ya está cerrado («ya_cerrado») |
| `en_progreso` reciente | No llama. El automático no marca nada ni cuenta un fallo y lo vuelve a mirar en su ciclo. El manual queda pendiente y lo resuelve el reintento |
| `error` | **Lo retoma** y vuelve a llamar. Los reintentos de siempre siguen intactos y `detalle.intentos` los cuenta |
| `en_progreso` de más de 5 min (proceso muerto) | Lo retoma |
| `ok` de más de 10 min | Lo retoma (red de seguridad) |
| registro no disponible | Llama directamente, como antes: la protección nunca impide cerrar |

- **Toma compare-and-swap:** retomar es un `UPDATE` condicionado al estado y a la marca de tiempo leídos. De dos procesos, solo uno lo consigue.
- **`executionGuard`:** gana dos opciones, `db` y `retomar`. Sin ellas se comporta exactamente como siempre; hay una prueba que lo fija.
- **Reabrir libera la clave:** `reabrirFila` llama a `executionGuard.retirarClave`. La fila no se borra: se renombra a `…:retirada:<instante>`. Así el siguiente cierre vuelve a cerrar el grupo.
- **Fallo del automático tras un cierre manual:** `registrarFalloCierre` ya no le pone `cierre_estado = fallido` a una fila que otro cierre terminó; escribe condicionado a `activo = true`.

### 2. Escritura que esquivaba al orquestador

- `unSorteoPorPrecio.revertirReemplazo` (deshacer una sustitución cuyo sorteo nuevo no se guardó) **reactivaba filas fuera del orquestador y sin historial**.
- Ahora la escritura vive en `cerrarEvento.deshacerSustitucion`, con el mismo algoritmo: solo restaura lo que cerró *ese* reemplazo. Deja en el historial `resultado = error` y `detalle.deshecha`. La función y la firma de `revertirReemplazo` se conservan.
- El resto de escrituras en `eventos_bot` fuera del orquestador **no terminan ni reactivan un sorteo**:
  - estado del grupo `abierto` (apertura);
  - contadores;
  - edición de nombre, premios y hora de cierre;
  - publicación del panel;
  - permiso de reservas.

### 3. Historial

| Modalidad | Qué queda registrado |
|---|---|
| hora, pagados, recuperado | `ok`, `ya_terminada` y **`error`** (WhatsApp fallido con su intento, y error de escritura). «En curso» en otro proceso no se registra: no hizo nada y lo registra el otro |
| cerrar, desactivar, cancelar, eliminar, normalización | `ok`, `ya_terminada`, **`rechazado`** (transición inválida), **`error`** |
| reintentos del cierre manual | modalidad `cerrar`, actor `reintento`, `ok` o `error`, con el intento y la vía (`llamada` / `ya_cerrado`). También «omitido, grupo en uso» |
| sustituciones | `ok` y, al deshacer, `error` con `deshecha` |
| reapertura | `ok` (ciclo, `clave_cierre_liberada`), **`rechazado`** (estado cambiado), **`error`** |
| permiso de reservas | `ok` con el modo anterior y el nuevo |

- **Corrección:** el reemplazo para reiniciar la tabla se registraba como `sustitucion_precio`; ahora es `sustitucion_reinicio`.
- El `actor` se recorta a 200 caracteres (el CHECK de la 048).
- Una prueba comprueba que la 048 acepta todas las modalidades y resultados que escribe el código.

**Qué se puede reconstruir tras reiniciar un worker:** todo lo que importa vive en la base, no en memoria.
- **Fila del evento:** estado, `cierre_intentos` y `cierre_ultimo_error`.
- **`automation_actions`:** registro del cierre del grupo, avisos y ciclos.
- **`event_sessions`:** ciclos.
- **Historial (048):** las operaciones.

Lo que **no** se reconstruye: la operación de WhatsApp que estaba en vuelo cuando murió el proceso. Queda `en_progreso` y a los 5 minutos la retoma el siguiente cierre. `cerrarGrupo` es idempotente en WhatsApp.

### 4. Grupos asociados sincronizados

- **Problema:** un grupo que se sumaba a un sorteo con el permiso ya configurado (publicación en un grupo nuevo o continuación detectada) nacía con `reservas_modo = NULL`. Ese grupo quedaba en «según el estado» y los demás no.
- **Corrección:** `guardarEvento` hereda el permiso de la fila vigente que continúa o, si no la hay, de la fila más reciente de la misma identidad. Sin la 047 no añade nada.

### 5. Migraciones 047 y 048 (auditadas, **no aplicadas**)

Validadas en PGlite (Postgres en memoria, sin red): 40 comprobaciones, aplicando cada una **dos veces**.

| | 047 `reservas_modo` | 048 `eventos_bot_historial` |
|---|---|---|
| Compatibilidad | Columna nullable sin valor por defecto: no reescribe la tabla. El `CHECK` revisa las filas (todas `NULL`) | Tabla nueva; `evento_id` sin clave foránea, así que borrar un evento no se bloquea |
| Datos existentes | Ninguna fila cambia; `NULL` = `segun_estado` | Ninguno |
| Idempotente | Sí: `if not exists` y bloque `do` | Sí: `if not exists`, `create or replace` y `drop … if exists` |
| RLS / permisos | Hereda los de `eventos_bot`; solo escribe el backend | anon nada; authenticated solo lee lo suyo; service_role `select` e `insert`. `UPDATE`, `DELETE` y `TRUNCATE` se rechazan para todos |
| Índices | — | por evento y por identidad, ambos con `usuario_id` y fecha |
| **Corregido** | — | Borrar una cuenta (`auth.users`) **fallaba**: el trigger de solo inserción bloqueaba la cascada (demostrado en PGlite). Ahora se permite solo la cascada (`pg_trigger_depth() > 1`). Además, `search_path` fijo en las funciones y `(select auth.uid())` en la política |
| Limitación | — | Si ya existiera una versión anterior de la tabla, `create table if not exists` no actualiza sus `CHECK` |

**Mismo fallo en la 032 (`reservas_auditoria`), no corregido:** borrar una cuenta con auditoría fallaría. La 032 puede estar ya en producción, así que corregirla es una migración aparte que requiere tu autorización.

### 6. Diagnóstico

Segunda consulta de solo lectura: [`../activacion/estado_cierres_f3_solo_lectura.sql`](../activacion/estado_cierres_f3_solo_lectura.sql), descrita en `PROCEDIMIENTO_DIAGNOSTICO_ESTADOS.md` §7. Funciona con o sin 023, 047 y 048 y se validó en PGlite con las dos variantes. No se ha ejecutado.
