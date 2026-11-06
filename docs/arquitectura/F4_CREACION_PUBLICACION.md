# F4 — Creación y publicación centralizadas (F4-A auditoría, F4-B diseño)

06/11/2026. **Solo auditoría y diseño.** No se ha cambiado código funcional, no se ha ejecutado SQL ni se ha tocado Supabase o WhatsApp. Base: F3 implementada y endurecida en local (203 archivos, 202 ✅, 1 conocido, 3 con entorno).

Vocabulario:

- **Programación:** fila de `sorteos_programados` más sus destinos en `sorteos_programados_grupos`. Es lo que crea el panel.
- **Evento:** fila de `eventos_bot`, es decir, un sorteo en un grupo. Es lo que acepta reservas.
- **Ciclo:** fila de `event_sessions`, la automatización del evento.
- **Activar en un grupo:** dejar un evento vigente con su grupo abierto y su ciclo. Es la operación que F4 centraliza.

---

## F4-A. Auditoría

### 1. Mapa de los caminos de creación

| # | Camino | Entrada | Funciones | Escribe | Crea evento | Abre grupo | Ciclo | Publica | Contra duplicados |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Anuncio en WhatsApp** | `bot/handlers/eventHandler.js` → `detectarEvento.js::detectarEvento` | `extraerEvento` → `obtenerConfiguracionCliente` → `consultarEvento` → `buscarSorteoVigente` → `esMismoSorteo` / `estadoTerminado` → `esEventoDeSorteoProgramado` + `remitenteAutorizado` → `consultarEventoDelSorteo` → `sorteosActivosDelPrecio` → `reemplazarAnteriores` → **`guardarEvento`** → `revertirReemplazo` si falla → `sustituirEnGrupo` → `motorEventos.registrarEvento` → **`abrirGrupo`** → `marcarAperturaFallida` / `abierto=true` → `escanearGrupo` → `motorEventos.confirmarApertura` | `eventos_bot` (insert o update), sustituciones (orquestador F3), `event_sessions`, `automation_actions` | sí, o reutiliza la fila | sí, **después** de crear el ciclo | `registrarEvento` **antes** de abrir y `confirmarApertura` después | no: el anuncio es el propio mensaje | Lectura previa por grupo e identidad. `guardarEvento` actualiza condicionado a `activo=true`. El ciclo es único por `(grupo_id, identidad_ciclo)`. **El insert no tiene unicidad** (C2) |
| 2 | **Programación desde el panel** | `POST /sorteos` → `servicio.crearSorteo` | `prepararSorteo` (`validarSorteo`, `tablasCliente`, grupos autorizados, lotería, cuentas, plantilla, diseño, mensajes, límite de texto) → `repo.crearSorteo` → `repo.reemplazarGrupos` | `sorteos_programados` (borrador), `sorteos_programados_grupos` | no | no | no | no | **Ninguna**: un doble clic crea dos borradores |
| 3 | **Confirmar programado** | `POST /sorteos/:id/confirmar` → `servicio.confirmar` | `vistaPrevia` (bloqueos, conflictos de grupo, `programadoSolapado`, reinicio) → `guardarCaptura` → `repo.actualizarSorteoSi` (versión + estado `borrador`) | `sorteos_programados` (`programado`), captura | no | no | no | no (lo hace el publicador a su hora) | CAS por versión y estado |
| 4 | **Sorteo instantáneo** | `POST /sorteos/:id/publicar-ahora` → `servicio.publicarAhora` | como 3, con `estado_publicacion = listo` obligatorio → CAS `borrador → programado` con `publicar_en = ahora` → **`publicador.tick(sock, { sorteoId })`** | ídem, y después todo lo del camino 6 | vía publicador | vía publicador | vía publicador | vía publicador | CAS de la confirmación; si se repite devuelve el estado actual (`repetido`) |
| 5 | **Vincular un sorteo detectado** | `POST /sorteos/activos/:id/vincular` → `gruposSorteo.vincularSorteoDetectado` | `sorteosActivos.obtener` → `programacionDeIdentidad` → cuentas, tabla → `repo.crearSorteo` (estado `publicado`, `origen=whatsapp`) → «gana la más antigua» → `repo.insertarGrupos` (`publicado`) | `sorteos_programados`, grupos | no (adopta los existentes) | no | no | no | Comprobación posterior: si hay dos, la más reciente se cancela |
| 6 | **Incorporar grupos** | `PUT /sorteos/:id/grupos` (`cambiarGrupos`, solo guarda) y `POST /sorteos/:id/grupos/publicar` (`publicarGruposNuevos`). También «Compartir» de Tablas con grupos nuevos (`routes/tablas.js::ejecutarCompartir` → `cambiarGrupos` + `publicarGruposNuevos`) | `publicarGruposNuevos` → captura → estado `publicando` → **`publicador.tick(sorteoId)`** con `textoParaCompartir` / `observar` sustituidos | ídem camino 6 de publicación | vía publicador | vía publicador | vía publicador | vía publicador | Solo se reclaman los grupos `pendiente`/`fallido` |
| 7 | **Edición con corrección de identidad** | `PUT /sorteos/activos/:id` → `sorteosActivos.editar` → `corregirIdentidad` | cambia la identidad de las filas existentes (comprueba choque de identidad, tabla y precio ocupado) | `eventos_bot`, `sorteos_programados`, cuadrícula (identidad) | no (re-identifica) | no | no | no | Comprobación previa de choque, sin unicidad |

### 2. Mapa de publicación

| # | Camino | Disparador | Funciones | Imagen | Texto | Envío y clave | Reintentos | Recuperación |
|---|---|---|---|---|---|---|---|---|
| A | **Programado automático** | `publicador.tick` cada 30 s por sesión (`iniciarPublicadorSorteos`) | `recuperarAtascados` → `publicarPendientes`: reinicio anticipado (`prepararPublicacion`, `estados=["programado"]`), CAS `programado → publicando`, `prepararPublicacion` (reinicio 030, `reemplazarParaReiniciar`, marca `reiniciado_en`), y por grupo `reclamarGrupo` (CAS) → **`publicarEnGrupo`** → `marcarGrupo` → `finalizarSorteo` | `capturarImagen`: la captura guardada al confirmar | `textoParaCompartir` | `compartirEnGrupos`, clave `TABLA_COMPARTIR:…:sorteo-<id>-publicacion-<reintentos_manuales>:<grupo>` | automáticos hasta 5 (`MAX_INTENTOS_AUTOMATICOS`); «en espera» por otra cuenta o sorteo activo | `recuperarAtascados` (grupo `publicando` más de 10 min: decide por el registro del anuncio) |
| B | **Instantáneo** | `publicarAhora` y su `tick(sorteoId)` | igual que A, con `solicitado`, sin día programado y **sin reintentos automáticos** (`resultadoInstantaneo`) | captura del panel | ídem | ídem | solo manuales | ídem |
| C | **Reintento manual** | `POST /:id/grupos/reintentar` → `servicio.reintentarGrupo` | programado: marca `fallido` + `reintentos_manuales+1` (nueva clave de anuncio) y vuelve a `publicando`, que lo toma el tick. Instantáneo o con imagen: `reintentarDestinoInstantaneo` → `tick(sorteoId)` | captura nueva opcional | ídem | clave nueva por reintento manual | — | — |
| D | **Grupos nuevos** | camino 6 | `tick(sorteoId)` | captura del panel o de Compartir | el de Compartir si viene de Tablas | ídem | — | — |
| E | **«Compartir» de Tablas** (manual) | `POST /tablas/compartir` | sorteo con programación: grupos con el sorteo → `compartirEnGrupos`; grupos sin él → D. Sorteo detectado: solo envía la imagen (aviso: no se registran reservas ahí) | `capturarImagenTabla` o la del panel | `textoParaCompartir` o editado | clave por `solicitudId` | no | operación en memoria (`operacionesCompartir`); cerrojo `enviosEnCurso` **por proceso** |
| F | **Tabla inicial** (automatización) | `scheduler` (`INITIAL_TABLE`) | `compartirTabla` | servidor | plantilla | `<ciclo>:INITIAL_TABLE`; en sorteos del panel la cubre el anuncio (`motorEventos.cubrirTablaInicial`) | — | — |
| G | **Apertura diferida** | `workerEventos` (`abierto=false`) | `reconciliarAperturaGrupo` → `abierto=true` → `motorEventos.reanudarApertura` | — | OPEN_MESSAGE | `<ciclo>:OPEN_MESSAGE` | cada ciclo del worker | — |
| H | **Recuperación de ciclos** | `scheduler` → `motorEventos.recuperarCiclos` | OPEN_MESSAGE no registrado; ciclo `pendiente` con el grupo abierto de verdad (`groupMetadata`) | — | — | claves del ciclo | — | sí |

**Lo que hace `publicarEnGrupo`** (el único que activa un sorteo del panel en un grupo):

1. Día y cierre.
2. `revisarGrupo`: otra cuenta → espera; sorteo propio distinto → se reemplaza.
3. Tabla configurada igual a la del sorteo.
4. `revisarTabla`.
5. `consultarEventoDelSorteo`; si está terminado, se para.
6. **Imagen**.
7. Relectura.
8. `sorteosActivosDelPrecio` + `reemplazarAnteriores`.
9. **`guardarEvento`**, con `revertirReemplazo` si falla.
10. Contadores.
11. Texto.
12. **`abrirGrupo`**, con el estado `abierto`.
13. **`compartirEnGrupos`**.
14. `motorEventos.procesarEventoPublicado`.

### 3. Duplicaciones encontradas

| Id | Qué | Dónde | Efecto |
|---|---|---|---|
| **P1** | Dos orquestadores de activación con la misma secuencia: identidad → fila del sorteo en el grupo → ¿terminado? → un sorteo por precio → `guardarEvento` → deshacer → sustituir en el grupo → abrir → ciclo | `detectarEvento.detectarEvento` y `publicador.publicarEnGrupo` | Cualquier regla nueva hay que ponerla dos veces. Es el origen de C2 |
| P2 | Apertura del grupo con su registro (`abierto=false` si falla, `abierto=true` condicionado a `activo=true` si se confirma) | `detectarEvento` (3 reintentos de `marcarAperturaFallida`), `publicador.publicarEnGrupo` (sin reintentos), `workerEventos` (`abierto=true` sin condición) | Tres versiones. Ninguna escritura de `abierto=false` va condicionada a `activo` y el worker tampoco condiciona la suya: sobre una fila que otro cierre acaba de terminar dejan un `abierto` que no corresponde. Es inofensivo para las reservas (deciden `activo` y el estado), pero confunde el reintento de WhatsApp de F3 |
| P3 | Cálculo del motivo de reemplazo y del reemplazo por precio | `detectarEvento` («sustituido por el anuncio de…»), `publicador` («sustituido por el sorteo…», en dos sitios) | Los motivos distinguen el origen (legítimo); la mecánica está duplicada |
| P4 | Resolución de la identidad | `crearIdentidadEventoReal` (detector, `guardarEvento`), `validar.identidadDelSorteo` (panel), `corregirIdentidad` | Misma función base. La fecha de juego sale de dos fuentes: `fechaSorteoAnunciado` y `fechaSorteoDe` |
| P5 | Orden distinto del ciclo | detector: ciclo antes de abrir y apertura confirmada después; panel: ciclo después del anuncio (`procesarEventoPublicado`) | **Diferencia legítima**: el panel no debe anunciar la apertura sin la imagen. Se conserva como política de la entrada |
| P6 | Tres puntos que llaman a `publicador.tick(sorteoId)` desde peticiones HTTP | `publicarAhora`, `reintentarDestinoInstantaneo`, `publicarGruposNuevos` | La misma petición «publica este sorteo ya» con tres preparaciones distintas (captura y estado) |
| P7 | Tres recuperaciones de operaciones interrumpidas | `publicador.recuperarAtascados`, `motorEventos.recuperarCiclos`, `workerEventos` (reapertura) | Cada una con su umbral: 10 min, margen del motor y cada ciclo |
| P8 | Cerrojo de Compartir en memoria | `routes/tablas.js::enviosEnCurso` | Solo vale en un proceso; las demás protecciones están en la base |

### 4. Servicios que deben reutilizarse (no se crea ningún motor nuevo)

| Servicio | Para qué en F4 |
|---|---|
| `guardarEvento` | única escritura del evento (insert/update), ya condicionada y con herencia del permiso (F3) |
| `consultarEventoDelSorteo`, `consultarEvento` | fila del sorteo en el grupo |
| `identidadEventoReal` (`crearIdentidadEventoReal`, `buscarSorteoVigente`, `esMismoSorteo`, `fechaSorteoAnunciado`) y `validar.identidadDelSorteo` | identidad |
| `shared/eventos/unSorteoPorPrecio` (`sorteosActivosDelPrecio`, `reemplazarAnteriores`, `revertirReemplazo`) | regla de un sorteo por precio |
| `lifecycle/cerrarEvento` (`terminarFila`, `deshacerSustitucion`, `registrarHistorialEvento`) | sustituciones e historial (F3) |
| `abrirGrupo`, `groupQueue` | apertura |
| `automation/motorEventos` (`registrarEvento`, `confirmarApertura`, `procesarEventoPublicado`, `reanudarApertura`, `recuperarCiclos`, `cubrirTablaInicial`) | ciclo |
| `automation/executionGuard` (con `retomar` de F3) | idempotencia y control de concurrencia persistente |
| `services/compartirTabla.compartirEnGrupos`, `destinosCompartir.textoParaCompartir`, `capturaProgramada` | publicación (imagen + texto) |
| `sorteos/disponibilidad` (`revisarGrupo`, `revisarTabla`) | conflictos y tabla |
| `sorteos/repo` (`reclamarGrupo`, `marcarGrupoSi`, `actualizarSorteoSi`) | estados de la programación con CAS |
| `tablasCliente.obtenerConfiguracionCliente` | tabla del precio (**única** fuente, clave para la opción B) |

---

## F4-B. Diseño

### 5. El orquestador

**Dónde.** Un módulo nuevo, `bot/funciones/eventos/lifecycle/activarEvento.js`, junto a `cerrarEvento.js`. Es la otra mitad del ciclo de vida: `cerrarEvento` termina un evento y `activarEvento` lo crea, lo reutiliza o lo reanuda. No es un motor nuevo: compone los servicios de §4, que siguen siendo los únicos que escriben.

**Entradas con perfil** (como `MODALIDADES` en F3). Cada entrada conserva su disparador, sus reglas y sus datos. El núcleo solo decide **cómo** se ejecutan los pasos comunes.

| Entrada | Disparador | Datos propios | Reglas propias (se conservan tal cual) | Publicación | Ciclo |
|---|---|---|---|---|---|
| `anuncio_whatsapp` | mensaje del grupo | lo extraído del anuncio, `sorteoVigente` (continuación), remitente | re-anuncio de un terminado no reactiva; un programado activo no se pisa salvo bot/admin con otro sorteo; «otro sorteo sin números» corrige la misma fila; reemplazar en **otros** grupos exige remitente autorizado | ninguna (el anuncio es el mensaje) | `antes_de_abrir` |
| `programado` | `publicador.tick` | programación confirmada, captura | día programado, reinicio de tabla (030), espera por otra cuenta, 5 reintentos automáticos | imagen + texto, clave por reintento manual | `tras_anuncio` |
| `instantaneo` | «Publicar ahora» | ídem | sin día programado, sin reintentos automáticos | ídem | `tras_anuncio` |
| `grupo_nuevo` | grupos nuevos / Compartir | ídem + texto de Compartir | `solicitado`, solo grupos pendientes | ídem | `tras_anuncio` |
| `reintento_manual` | «Reintentar» | ídem | clave nueva (`reintentos_manuales+1`) | ídem | `tras_anuncio` |
| `reanudacion` | worker y recuperaciones | evento existente | nunca crea fila ni ciclo; solo completa | ninguna | solo `reanudar` |

Fuera del núcleo, a propósito:

- **Crear, editar y confirmar la programación** (caminos 2, 3 y 7) y **vincular** (camino 5): son persistencia de la programación, no activación.
- **«Compartir» de un sorteo ya activo** (E): solo publica la imagen. Usa el paso de publicación del núcleo, pero no crea eventos.

**Pasos del núcleo, `activarEnGrupo({ entrada, sock, usuarioId, grupoId, sorteo, politica, deps })`:**

| Paso | Qué hace | Hoy en |
|---|---|---|
| 1 Validación común | dueño de la sesión = `usuarioId` (aislamiento); grupo autorizado; tabla del precio = la del sorteo (`tablasCliente`) | repartido |
| 2 Identificación | `resolverIdentidad(entrada)`: detector → `buscarSorteoVigente` o `crearIdentidadEventoReal` con `fechaSorteoAnunciado`; panel → `sorteo.identidad_evento_real` con `fechaSorteoDe` | P4 |
| 3 Concurrencia | **reclamo persistente de la activación** (ver §7): clave `ACTIVAR_EVENTO:<usuario>:<grupo>:<identidad>` en `executionGuard` | no existe (C2) |
| 4 Fila | `consultarEventoDelSorteo`: terminada → **para** (regla de siempre); existe → reutilizar; no existe → crear. Las reglas propias del detector («otro sorteo sin números», re-anuncio, programado activo) se pasan como **política** de la entrada, sin cambios | detector y publicador |
| 5 Un sorteo por precio | `sorteosActivosDelPrecio` + `reemplazarAnteriores` (modalidad según la entrada) y sustitución del sorteo de otro precio en el grupo (`terminarFila`, `sustitucion_anuncio`). La política decide quién puede reemplazar en otros grupos | P3 |
| 6 Persistencia | `guardarEvento` (insert/update condicionado); si falla, `deshacerSustitucion` | P1 |
| 7 Grupos asociados | herencia del permiso (ya en `guardarEvento`, F3); el destino de la programación queda con su `evento_bot_id` (lo hace el publicador al marcar el grupo) | ya existe |
| 8 Apertura | **una** función `abrirYRegistrar` (P2): `abrirGrupo`; `abierto=false` condicionado a `activo=true` con los 3 reintentos del detector; `abierto=true` condicionado | P2 |
| 9 Ciclo | `motorEventos` con la política de la entrada: `antes_de_abrir` (`registrarEvento` + `confirmarApertura`) o `tras_anuncio` (`procesarEventoPublicado`) | P5 |
| 10 Publicación | solo entradas con anuncio: `compartirEnGrupos` con su clave; resultado normalizado (`enviado` / `ya_enviado` / incierto / fallo) | publicador |
| 11 Resultado e historial | `{ estado, evento, ciclo, publicacion, motivo }` con los mismos estados de hoy (`publicado`, `fallido`, `requiere_revision`, `pendiente` en espera…). Historial en `eventos_bot_historial` con modalidades de activación (§9) | parcial |
| 12 Reanudar | entrada `reanudacion`: pasos 8 y 9 sobre un evento existente, idempotentes (worker, `recuperarCiclos`) | P7 |

**Recuperación de operaciones interrumpidas.** Se conservan los tres mecanismos, que están probados, pero los tres pasan a llamar al paso 12 y a leer el mismo registro:

- `recuperarAtascados`: grupo `publicando` → registro del anuncio.
- `recuperarCiclos`.
- reapertura del worker.

El reclamo del paso 3 añade el caso que hoy falta: una caída entre crear la fila y abrir el grupo deja el reclamo en `en_progreso`, y el siguiente intento lo retoma pasados N minutos (como F3) y **adopta** la fila creada en vez de crear otra.

**Lo que no cambia:**

- las reglas comerciales (modalidades, día y cierre, reintentos, esperas, reemplazos, permisos, cierres de F2/F3);
- los estados de la programación y de los destinos;
- las claves de anuncio y de ciclo existentes, para que no se dupliquen envíos ya registrados en producción;
- los contratos HTTP.

### 6. Riesgos de concurrencia

| Id | Riesgo | Hoy | Con el diseño |
|---|---|---|---|
| **K1 (C2)** | Detector y publicador, o dos publicadores, crean **dos filas** del mismo sorteo en el mismo grupo | Solo lectura previa; `eventos_bot` no tiene índice único. En memoria la prueba pasa (1 fila); con latencia real puede fallar | §7 |
| K2 | Dos procesos publican el mismo destino | CAS `reclamarGrupo` + clave del anuncio | igual |
| K3 | Dos confirmaciones simultáneas de **dos programaciones del mismo sorteo en el mismo grupo** | `programadoSolapado` se comprueba en la vista previa, no bajo cerrojo | lo cubre el reclamo K1 (misma identidad y grupo → una sola fila). La segunda programación publicaría un **segundo anuncio** con su propia clave: **a caracterizar** (C7) antes de decidir |
| K4 | Doble clic en «Crear sorteo» | dos borradores | sin cambio en F4 (no publica nada); opcional: `solicitud_id` del navegador |
| K5 | Dos sorteos **nuevos del mismo precio** a la vez (detector y panel, o dos grupos) | cada uno reemplaza «lo anterior»; sin la 043 aplicada, los dos podrían quedar activos | el reclamo no lo cubre (identidades distintas). Protección real: la **043** (estado sin verificar) más el respaldo `esPrecioOcupado` que ya existe |
| K6 | Vincular un detectado dos veces | comprobación posterior: «gana la más antigua» | igual |
| K7 | Compartir en dos procesos | cerrojo en memoria; la clave por `solicitudId` evita repetir la misma solicitud | igual (una solicitud distinta es una decisión manual) |
| K8 | Caída entre crear la fila y abrir el grupo | el worker abre (`abierto=false`) y `recuperarCiclos` completa | igual, más la adopción por el reclamo |
| K9 | Activación y cierre a la vez | `guardarEvento` condicionado a `activo=true`; cierre condicionado (F3) | igual |
| K10 | Aislamiento entre clientes | `usuario_id` en todas las lecturas; el dueño del socket debe coincidir con el validado | el paso 1 lo hace explícito para todas las entradas |

### 7. Solución propuesta para C2

Dos capas. La primera no necesita migración.

1. **Reclamo persistente de la activación** (sin migración, mismo mecanismo que el cierre de F3).
   - Antes de crear la fila, `executionGuard.ejecutarUnaVez` con la clave `ACTIVAR_EVENTO:<usuario>:<grupo>:<identidad>`. Dentro del reclamo se **relee** la fila del sorteo y solo se inserta si no existe.
   - Quien llega segundo y ve `ok` o `en_progreso` no inserta: relee y **adopta** la fila ganadora. Si está `en_progreso`, espera al siguiente ciclo, como el cierre de F3.
   - `error` y `en_progreso` vencido se retoman (`retomar`).
   - La clave es permanente. Es coherente con la regla de siempre: un sorteo terminado en un grupo **nunca** se reactiva ni se recrea, porque detector y publicador paran ante `finDelEvento`. La reapertura (F3) reutiliza la fila y no crea otra.
2. **Índice único parcial**, como migración **049** preparada y no aplicada:
   ```sql
   create unique index concurrently if not exists eventos_bot_un_evento_por_sorteo_y_grupo
     on public.eventos_bot (usuario_id, grupo_id, identidad_evento_real)
     where activo is true and identidad_evento_real is not null;
   ```
   - Antes, un diagnóstico de solo lectura que cuente duplicados. Si los hay, la 049 no se aplica hasta resolverlos fila a fila, con autorización.
   - `guardarEvento` trataría `23505` como «otro proceso la creó»: relee y devuelve la fila ganadora.
   - Va sobre filas **activas**, así que no choca con el historial (filas cerradas o sustituidas de la misma identidad).

La prueba C2 de hoy se conserva y se añade una versión **con latencia simulada**: el fake retrasa `select` e `insert` con `antesDeEscribir` / `despuesDeLeer`. Debe fallar antes del cambio y pasar después, para demostrar que la protección es real.

### 8. Plan para `independenciaPorPrecio`

**No se cambia su expectativa:** las pruebas 2 y 3 siguen fallando a propósito hasta que exista la opción B (una cuadrícula por precio), que es una decisión de negocio pendiente con su propia migración ([../activacion/AISLAMIENTO_POR_PRECIO.md](../activacion/AISLAMIENTO_POR_PRECIO.md)).

Lo que F4 hace para que la opción B sea después un cambio de configuración y no de código:

1. El núcleo obtiene la tabla **solo** de `tablasCliente.obtenerConfiguracionCliente(usuario, precio)`. Ya lo hacen el detector, el publicador, `vincular` y `corregirIdentidad`; el paso 1 lo centraliza.
2. Los contadores del evento salen hoy de `actualizarEvento` → `sorteoReal.estadoDelSorteo`, que lee **por tabla**: es una de las causas del fallo de `independenciaPorPrecio`. F4 **no lo cambia**, porque sería cambiar una regla. El núcleo los pide a esa única función, así que la opción B la cambiará en un solo sitio.
3. Se inventarían, sin tocarlas, las listas fijas de tablas que la opción B tendría que cambiar: `configEvento.js`, `automation/repo/tablaEvento.js` y `frontend/lib/tablasConfig.ts`.
4. Se añade una caracterización con `TABLA_POR_PRECIO=1` (ya existe el interruptor en `aislamientoPorPrecio.test.js`): el núcleo debe dar 12/12 con tablas separadas, sin código adicional.

### 9. Archivos que cambiarían (F4-C en adelante, con autorización)

| Archivo | Cambio |
|---|---|
| `bot/funciones/eventos/lifecycle/activarEvento.js` (**nuevo**) | núcleo `activarEnGrupo`, perfiles de entrada, `abrirYRegistrar`, reclamo de activación, `reanudar` |
| `bot/funciones/eventos/detectarEvento.js` | conserva extracción, reglas propias y política; los pasos comunes pasan al núcleo |
| `sorteos/publicador.js` | `publicarEnGrupo` conserva día, cierre, revisión, tabla e imagen; la activación y el anuncio pasan al núcleo. `publicarPendientes`, `prepararPublicacion` y `recuperarAtascados` no cambian de lógica |
| `bot/funciones/eventos/guardarEvento.js` | adopción ante `23505` (solo cuando exista la 049) |
| `bot/funciones/eventos/workers/workerEventos.js`, `automation/motorEventos.js` | llaman a `reanudar` / `abrirYRegistrar` (sin cambio de reglas) |
| `sorteos/servicio.js`, `sorteos/gruposSorteo.js` | ninguno o mínimo: siguen llamando a `publicador.tick(sorteoId)` |
| `backend/supabase_migrations/048_historial_eventos.sql` (**sin aplicar todavía**) | ampliar el `CHECK` de modalidades con `activacion_whatsapp`, `activacion_programado`, `activacion_instantaneo`, `activacion_grupo_nuevo`, `activacion_reintento`, `reanudacion`, antes de aplicarla |
| `backend/supabase_migrations/049_un_evento_por_sorteo_y_grupo.sql` (**nuevo, sin aplicar**) | índice único parcial (§7) |
| `docs/activacion/eventos_duplicados_solo_lectura.sql` (**nuevo**) | diagnóstico previo a la 049 |
| Pruebas | ver §10 |

No cambian: rutas ni contratos HTTP, el panel, `executionGuard`, `cerrarEvento`, `unSorteoPorPrecio`, `compartirTabla`, las claves existentes ni las migraciones aplicadas.

### 10. Plan de pruebas y etapas

| Etapa | Qué | Criterio de salida |
|---|---|---|
| **F4-C** caracterización (C7), sin tocar código | fijar hoy, por entrada: filas, ciclo, aperturas, anuncios, destinos, historial. Casos: detector, programado, instantáneo, grupo nuevo, reintento manual y automático, recuperación tras caída en cada punto, sustitución por precio y en grupo, evento existente, terminado, otra cuenta, aislamiento entre clientes. Además: **C2 con latencia** (debe fallar hoy: se marca como conocida), K3 (dos programaciones del mismo sorteo) y K5 (dos precios a la vez) | suite como hoy + C7 en verde salvo los casos conocidos marcados |
| **F4-D** núcleo sin cambio de comportamiento | `activarEvento.js` extraído de `publicarEnGrupo`; el publicador lo usa. Refactor puro | C2, C6, C7 y la suite idénticos |
| **F4-E** detector al núcleo | `detectarEvento` usa el núcleo con su política | ídem |
| **F4-F** C2 | reclamo de activación (sin migración) + 049 y su diagnóstico preparados, no aplicados | C2 con latencia pasa; ninguna otra expectativa cambia |
| **F4-G** recuperación y reanudación | worker, `recuperarCiclos` y `recuperarAtascados` usan `reanudar` | pruebas de recuperación existentes + C7 «caída en cada punto» |
| **F4-H** historial y validación final | modalidades de activación en el historial (048 ampliada); revisión de escrituras que esquiven el núcleo (como en F3); suite completa; `independenciaPorPrecio` sigue siendo el único conocido | 0 inesperados, 0 intentos de red |

Reglas para todas las etapas: no se cambia una regla para que pase una prueba; si una integración exige cambiar otra regla, me detengo y presento el conflicto; no se elimina código.

## F4-C. Caracterización (06/11/2026, local, sin commit)

**No se cambió código funcional.** Solo pruebas y el doble de Supabase de las pruebas.

- Suite completa: 205 archivos, 204 ✅, 0 inesperados, 1 conocido (`independenciaPorPrecio`), 3 con entorno, 0 intentos de red.
- C7 y C8 son deterministas: se ejecutaron 3 veces seguidas con el mismo resultado.

### Archivos

| Archivo | Qué |
|---|---|
| `backend/tests/caracterizacion/activacionEntradas.test.js` (**nuevo**, C7) | Huella completa de **25** escenarios por entrada: filas, ciclos, acciones del ExecutionGuard, programación y destinos, historiales, mensajes, operaciones de grupo, cuadrícula y resultado devuelto. Compara con `huellas/c7_activacion.json` |
| `backend/tests/caracterizacion/huellas/c7_activacion.json` (**nuevo**) | Huellas de referencia generadas con el código ANTERIOR a F4-D. Solo se regeneran (`C7_GENERAR=1`) en una etapa que cambie un comportamiento a propósito, con su motivo |
| `backend/tests/caracterizacion/concurrenciaActivacion.test.js` (**nuevo**, C8) | 7 casos de concurrencia con **latencia simulada** |
| `backend/tests/sorteos/fakeSupabaseSorteos.js` | Gancho opcional `control.latencia(tabla, op)`. Sin él, o si devuelve `null`, el doble funciona exactamente como antes |

### Entradas caracterizadas (C7)

| Grupo | Escenarios |
|---|---|
| Anuncio de WhatsApp | E1 nuevo · E2 re-anuncio · E3 continuación en otro grupo · E4 re-anuncio de un sorteo cerrado (no se reactiva) · E5 otro precio sin números (corrige la misma fila) · **E5b** otro precio con números (fila nueva + `sustitucion_anuncio`) · E6 reemplazo por precio en otro grupo por el administrador · E7 lo mismo por un cliente (no reemplaza) · E8 re-anuncio sobre un programado publicado · E9 aislamiento (sesión de otro cliente) |
| Panel | P1 programado en 2 grupos · P2 antes de su hora · P3 instantáneo · P4 reintento automático · P5 instantáneo + «Reintentar» · P6 programado en revisión + «Reintentar» (clave nueva) · P7 grupo nuevo · P8 reemplazo por precio desde el panel · P9 otra cuenta en el grupo (espera) · P10 evento ya detectado · P11 vincular un detectado + grupo nuevo |
| Recuperación | R1 apertura diferida por el worker · R2 caída antes de enviar · R3 caída después de enviar (registro `ok`) · R4 caída durante el envío (`en_progreso` → revisión) |

### Concurrencia (C8): lo que pasa HOY

| Caso | Resultado actual | Juicio |
|---|---|---|
| **C2** detector + «Publicar ahora», mismo sorteo y grupo | **2 filas activas**; solo una tiene ciclo; 1 anuncio y 1 apertura | **Defecto confirmado** (F4-F) |
| **C2** el mismo anuncio procesado dos veces a la vez | **2 filas, 2 ciclos y 2 mensajes de apertura** en el grupo | **Defecto confirmado** (F4-F) |
| **K3** dos programaciones del mismo sorteo y grupo confirmadas a la vez | se confirman las dos; 1 fila, pero **2 anuncios** con imagen | **Defecto confirmado**. Según tu decisión 4, la segunda adoptará el resultado de la primera |
| K3 en secuencia | la segunda queda bloqueada en la vista previa (`programadoSolapado`) | correcto hoy |
| **K4** doble clic en «Crear sorteo» | 2 borradores iguales | defecto menor (decisión 5: `solicitud_id`) |
| **K5** dos sorteos distintos del mismo precio a la vez | los dos quedan activos | **solo en memoria**: la 043 lo impide en la base si está aplicada. Fuera de F4 |
| Control: dos «Publicar ahora» del mismo sorteo | 1 publicación; la segunda devuelve `repetido` | protegido hoy |

Los defectos se fijan con `riesgo()`: la prueba pasa y el riesgo queda escrito. La etapa que corrija cada uno cambiará su expectativa a propósito, con el motivo.

### Línea base del aislamiento por precio (sin cambios)

- `independenciaPorPrecio`: 2 ✅ y 2 ❌, como siempre.
- `aislamientoPorPrecio`: 4/12 con la tabla compartida y 12/12 simulando una tabla por precio (`TABLA_POR_PRECIO=1`, solo `tablas_cliente`).

### Estado de la 047 y la 048 (para la decisión 3)

Las dos están **sin seguimiento en git** (`??`): nunca se han hecho commit ni push. Que se sepa, tampoco se han aplicado en ningún entorno: no se ha ejecutado SQL. Aun así, la ampliación de la 048 se preparará en F4-H tal como pediste, documentada y sin alterarla en silencio.

## F4-D. Núcleo de activación extraído del publicador (06/11/2026, local, sin commit)

**Refactor puro.** `publicador.publicarEnGrupo` conserva lo propio de su entrada:
- día programado y cierre;
- `revisarGrupo` (otra cuenta, sorteo propio distinto);
- tabla configurada y `revisarTabla`;
- evento terminado;
- imagen y relectura.

Delega el resto, **sin cambiar una línea de comportamiento**, en `bot/funciones/eventos/lifecycle/activarEvento.js`:

| Pieza | Qué hace | Antes en |
|---|---|---|
| `PERFILES` | Perfil de cada entrada: `anuncio_whatsapp`, `programado`, `instantaneo`, `grupo_nuevo`, `reintento_manual`, `reanudacion`. Fija la publicación (anuncio / ninguna), el ciclo (`tras_anuncio` / `antes_de_abrir` / `reanudar`) y los reintentos | — |
| `entradaDelPanel` | Qué entrada del panel llega al publicador (solo identifica el perfil; las cuatro del panel ejecutan hoy lo mismo) | — |
| `reemplazarSorteosDelPrecio` | Un sorteo por precio: `sorteosActivosDelPrecio` + `filasPorId` + `reemplazarAnteriores` | `publicarEnGrupo` |
| `abrirGrupoDelEvento` | `abrirGrupo` con su registro: `abierto=false` si falla; `abierto=true` condicionado a `activo=true` si había una apertura pendiente | `publicarEnGrupo` |
| `activarEnGrupo` | En este orden: reemplazo por precio → `guardarEvento` (deshacer si falla) → contadores → texto → apertura → `compartirEnGrupos` (misma clave) → `motorEventos.procesarEventoPublicado`. Mismos mensajes y estados del destino | `publicarEnGrupo` |

- **Las entradas `anuncio_whatsapp` y `reanudacion`** ya tienen perfil, pero `activarEnGrupo` las rechaza hasta F4-E y F4-G. No hay ninguna protección nueva: C2, K3 y K4 siguen como en C8.
- **Código antiguo que permanece:**
  - `detectarEvento` sigue con su propia secuencia hasta F4-E;
  - `marcarAperturaFallida` (detector) y la apertura del worker siguen igual hasta F4-E y F4-G;
  - en `publicador.js` queda importado `filasPorId`, que ya no se usa ahí. No se retira hasta F4-H, junto con la revisión de lo que quede sin uso.
- **Verificación:**
  - **C7** reproduce las 25 huellas exactas sin regenerar la referencia;
  - **C8** da los mismos 7 resultados;
  - **prueba de mutación:** quitar el arranque del ciclo en el núcleo hace fallar 10 de las 25 huellas, así que C7 detecta cambios reales. El archivo se restauró idéntico.
  - Prueba nueva `tests/sorteos/activarEventoNucleo.test.js` (5 casos).

## F4-E. Detector de WhatsApp integrado en el núcleo (06/11/2026, local, sin commit)

**Un solo motor de activación** con dos entradas que conservan su perfil y su orden. El núcleo se dividió en un paso por responsabilidad.

```
backend/bot/funciones/eventos/
├── detectarEvento.js              ENTRADA WhatsApp: extrae y valida el anuncio (datos, dueño, tabla), pide la
│                                  decisión, invoca el núcleo y traduce el resultado (fila / null)
├── deteccion/
│   ├── decisionAnuncio.js         reglas propias: identidad anunciada, re-anuncio de terminado, programado activo,
│   │                              qué fila se guarda y qué se sustituye (solo lee)
│   ├── sorteoAnterior.js          lecturas del sorteo anterior: ¿terminado/lleno?, ¿tiene números?
│   └── remitente.js               ¿cuenta del bot o administrador del grupo?
└── lifecycle/
    ├── activarEvento.js           ORQUESTADOR: secuencia por perfil (WhatsApp / panel); resultado neutro
    └── activacion/
        ├── perfiles.js            PERFILES y entradaDelPanel
        ├── sustituciones.js       un sorteo por precio (+ autorización de otros grupos) y sustitución en el grupo
        ├── persistencia.js        guardarEvento con deshacer; contadores
        ├── aperturaGrupo.js       abrir y registrar «abierto»; política panel / detección (3 intentos)
        ├── anuncio.js             texto y envío del anuncio del panel (misma clave)
        └── ciclo.js               ciclo de automatización: antes de abrir (WhatsApp) / tras el anuncio (panel)
backend/sorteos/
├── activacionPanel.js             ENTRADA panel: datos del evento, invoca el núcleo y traduce a cambios del destino
└── publicador.js                  conserva día, cierre, conflictos, tabla, imagen y relectura
```

**Perfiles conservados**

| | WhatsApp (`anuncio_whatsapp`) | Panel (`programado` / `instantaneo` / `grupo_nuevo` / `reintento_manual`) |
|---|---|---|
| Orden | guardar → sustituir el de otro precio del grupo → registrar ciclo → abrir → escaneo de identidades + confirmar ciclo en segundo plano | guardar → contadores → texto → abrir → anuncio con imagen → ciclo |
| Reemplazo en otros grupos | solo si lo publica el bot o un administrador | siempre (decisión del 31/10); otra cuenta hace esperar (publicador) |
| Apertura fallida | `abierto=false` siempre, 3 intentos | `abierto=false` una vez, si no lo estaba |
| Resultado | la fila o `null` (contrato de `eventHandler`) | cambios del destino (estados y mensajes de siempre) |

**Funciones movidas:**
- De `detectarEvento.js`:
  - `marcarAperturaFallida` → `aperturaGrupo`;
  - `estadoTerminado` y `sorteoTieneNumeros` → `deteccion/sorteoAnterior`;
  - `sustituirEnGrupo` → `activacion/sustituciones`;
  - `remitenteAutorizado` → `deteccion/remitente`;
  - la decisión del anuncio → `deteccion/decisionAnuncio`;
  - la secuencia (precio, guardar, deshacer, sustituir, ciclo, apertura, escaneo, confirmación) → núcleo.
- De `activarEvento.js` (F4-D): la secuencia del panel se dividió en `activacion/*`, y los textos del destino pasaron a `sorteos/activacionPanel.js`.

**Se quedan en la entrada de WhatsApp:** la extracción y validación del anuncio, el dueño de la sesión, la tabla del precio, la decisión propia y la traducción del resultado. Son responsabilidad de la entrada.

**Fuera de F4-E:** sin cambios en la reconciliación de apertura del worker ni en `recuperarAtascados` (F4-G); C2, K3 y K4 siguen igual (F4-F).

**Archivo de más de 500 líneas:** `sorteos/publicador.js` tiene 982 líneas (540 de código). Mezcla cuatro responsabilidades:
- publicación pendiente y reinicio de tabla;
- recordatorios y aviso final;
- vencimiento de reservas;
- recuperación de publicaciones atascadas.

Propuesta, cada una con autorización:
- **F4-G:** sacar la recuperación a `sorteos/recuperacionPublicacion.js`;
- **etapa aparte:** recordatorios y vencimiento. Tocan reservas, así que no entran en F4.

**Validación:**
- **C7:** 25/25 huellas exactas, sin regenerar.
- **C8:** 7/7.
- **`tests/deteccion/deteccionNucleo.test.js`** (nuevo, 13 casos): anuncio nuevo, re-anuncio, re-anuncio de un cerrado, otro grupo, otro precio con y sin números, reemplazo por precio con administrador y con cliente, programado, aislamiento, error de persistencia con deshacer, apertura fallida más worker, orden del ciclo en las dos entradas, y la comprobación de que el detector y el publicador ya no contienen la secuencia.
- **`activarEventoNucleo`:** 7 casos. Cambio intencionado: las piezas se movieron y ahora se acepta `anuncio_whatsapp`.
- **Revisión estática:**
  - sin ciclos de `require` de nivel superior;
  - los dos ciclos perezosos que aparecen ya existían (`gruposSorteo` → `publicador` dentro de una función);
  - sin imports sin uso, porque se retiró `filasPorId` del publicador (la función sigue en uso en `sustituciones.js`).

**Fallo intermitente de F4-D, identificado:**
- Es `tests/sorteos/sorteosProgramados.test.js`. Pasa sus 29 casos y después el proceso aborta al salir con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c` (código 3221226505), en Windows con Node 24.
- **Ejecutado directamente** aborta 5 de 5 veces con el código actual. **Con el publicador anterior a F4-D** aborta 4 de 5 (comprobado con una copia temporal ya borrada).
- **Dentro del ejecutor** solo aparece a veces.
- **Ya existía antes de F4** y está en el cierre de la prueba (`server.close()` seguido de `process.exit()`), no en la lógica.
- No se ha modificado la prueba. La corrección propuesta, esperar al cierre del servidor antes de salir, necesita tu aprobación.

**Segundo fallo intermitente, encontrado y corregido en F4-E:**
- `caracterizacion/cierreGrupoProtegido.test.js`, caso 1 (endurecimiento de F3), falló una vez en 4 ejecuciones.
- **Causa:** el arnés cambia `setTimeout` por uno de 0 ms. El tope de 20 s de la cola de operaciones de grupo vencía al instante, y según el orden del bucle de eventos la llamada «lenta» acababa en error antes de la aserción.
- **Corrección, solo de la prueba y sin cambiar lo que afirma:** en ese caso la cola usa el temporizador real, y la prueba espera al momento en que WhatsApp recibe la llamada en lugar de 5 vueltas del bucle.
- **Resultado:** 18 de 18 en verde, 8 de ellas en paralelo. El código de F3 no cambió.

## F4-F. Concurrencia e idempotencia: C2, K3 y K4 (06/11/2026, local, sin commit)

### Garantía de la persistencia (lo que de verdad protege)

| Mecanismo | Garantía | Dónde |
|---|---|---|
| **Adquirir** un reclamo | `INSERT` en `automation_actions` con `UNIQUE(clave_idempotencia)` (006, ya aplicada). Postgres serializa los INSERT concurrentes sobre el índice único: gana uno y el resto recibe `23505` | `executionGuard.ejecutarUnaVez` |
| **Retomar** uno fallido o abandonado | `UPDATE … WHERE id AND estado AND actualizado_en` (compare-and-swap): de varios que lo intentan, solo uno cambia la fila | `executionGuard` (`retomar`, F3) |
| **Un dueño antiguo no pisa al nuevo** (nuevo en F4-F) | El resultado se escribe condicionado a la marca `ejecutado_en` de su propia toma, y cada toma usa una marca estrictamente posterior | `executionGuard.marcarResultado` |
| **Dueño visible desde la adquisición** (nuevo) | `detalle` inicial en el INSERT (p. ej. `sorteo_id`) | `executionGuard` (`detalle`) |

- **Validado en PGlite** (Postgres en memoria, sin red), 9 de 9: el segundo INSERT de la misma clave falla con `23505`; la segunda toma con la marca vieja no cambia nada; el dueño antiguo no escribe.
- **Lo que PGlite no permite probar:** varias conexiones simultáneas. Esa garantía la da el índice único de Postgres. En el simulado se prueba con latencia.
- **Sin cambios para quien no pasa las opciones nuevas:** F3, los avisos y la tabla inicial siguen igual (C7, `cierreGrupoProtegido`, `tests/automation`).

### Archivos

```
backend/automation/
├── executionGuard.js      (mod.) detalle inicial; resultado condicionado a la toma (no pisa al nuevo dueño)
└── reclamos.js            (nuevo) reclamo persistente: adquirir, esperar al que está en curso (memoria del
                           proceso + sondeo en la base), liberar; qué hace el perdedor lo decide cada uso
backend/bot/funciones/eventos/
├── guardarEvento.js       (mod.) ante 23505 (solo con la 049) adopta la fila ganadora
├── detectarEvento.js      (mod.) traduce «adoptado» / «activacion_en_curso»
└── lifecycle/
    ├── activarEvento.js   (mod.) crear la fila pasa por el reclamo C2; reutilizarla, no
    └── activacion/reclamoActivacion.js   (nuevo) C2: crear o adoptar
backend/sorteos/
├── publicacionPorGrupo.js (nuevo) K3: una publicación por sorteo y grupo entre programaciones
├── creacionIdempotente.js (nuevo) K4: un borrador por solicitud_id
├── activacionPanel.js     (mod.) imagen + relectura + activación dentro del reclamo K3
│                          (también ERROR_IMAGEN y eventoTerminado, movidos del publicador)
├── publicador.js          (mod.) delega en activacionPanel.publicarDestino; reexporta ERROR_IMAGEN
├── servicio.js            (mod.) crearSorteo con solicitud_id; reintento de la misma confirmación
└── routes/sorteos.js      (mod.) solicitud_en_curso → 409
backend/supabase_migrations/049_un_evento_por_sorteo_y_grupo.sql   (nuevo, SIN aplicar)
docs/activacion/eventos_duplicados_solo_lectura.sql                (nuevo, sin ejecutar)
frontend: apiSorteos.crear (solicitud_id opcional) y FormularioSorteo (uno por intento de creación)
```

### C2: activación duplicada

- **Clave:** `ACTIVAR_EVENTO:<usuario>:<grupo>:<identidad>`. La identidad es la misma `identidad_evento_real` que guarda `guardarEvento`, así que otro sorteo, otro grupo u otro cliente tienen otra clave. La clave es permanente: un sorteo terminado nunca se recrea en el grupo.
- **Solo la CREACIÓN pasa por el reclamo:** cuando no hay fila previa del sorteo en el grupo. Reutilizarla sigue igual, con escritura condicionada.
- **Quien gana** relee la fila (por si un intento anterior se cortó tras crearla) y, si no existe, hace la sustitución por precio y la guarda.
- **Quien pierde:**
  - si el ganador ya terminó, adopta su fila;
  - si sigue en curso, espera (al reclamo en memoria si es el mismo proceso, o sondeando la base hasta unos 30 s) y después adopta.
- **Adoptar, según la entrada:**
  - **WhatsApp:** devuelve la fila adoptada y **no hace nada más** (ni apertura, ni ciclo, ni sustituciones);
  - **panel:** continúa su publicación sobre esa fila, como si hubiera llegado después (P10): reutilizarla, abrir el grupo, anuncio con imagen y ciclo.
- **Recuperación:**
  - un intento fallido (nada guardado, o la sustitución deshecha) se retoma;
  - uno abandonado (más de 2 min en curso) se retoma, y quien lo retoma adopta la fila si ya existía;
  - si la fila del sorteo se eliminó desde el panel, la clave se libera (se conserva renombrada) y se crea de nuevo, como antes.
- **Sin registro disponible:** se crea como antes de F4-F.

### K3: dos programaciones del mismo sorteo y grupo

- **Clave:** `PUBLICAR_SORTEO:<usuario>:<grupo>:<identidad>`. La identidad de la confirmación es estable (el sorteo real y el grupo), no está en memoria.
- **Dueña:** la programación que adquiere el reclamo (`detalle.sorteo_id` desde el INSERT). Se adquiere **antes de la imagen**: quien no es dueña no genera imagen, no abre el grupo y no envía nada.
- **Reglas:**
  - **la dueña** publica como siempre; sus reintentos automáticos y manuales no cambian;
  - **otra programación, con la dueña ya publicada:** ADOPTA. ~~Su destino queda `cancelado`~~ **Sustituido en F4-F.1:** su destino queda `publicado` (publicación compartida) y sus recordatorios, aviso y vencimiento los gobierna la propietaria;
  - **otra programación, con la dueña publicando o con un fallo y aún activa:** ESPERA (`pendiente`). Un anuncio incierto nunca se repite desde otra programación;
  - **dueña abandonada** (destino o programación cancelados o archivados, o más de 10 min en curso): la otra la retoma y pasa a ser la dueña.
- **Mismo sorteo en otro grupo, u otro sorteo:** otra clave, son independientes.
- **Reclamo propio colgado** (el proceso de la dueña murió a mitad): la dueña lo retoma **sin esperar**, porque un destino solo lo toma un proceso a la vez (`reclamarGrupo`, compare-and-swap). La primera versión de F4-F esperaba los 10 min y retrasaba la recuperación de siempre; lo detectó `tests/automation/recuperacionCaidas` (caso 4) y se corrigió, con su prueba (`reclamosF4F` K3-5a).
- **Reintento de la MISMA confirmación** (misma versión ya confirmada): `confirmar` devuelve su estado con un aviso, en vez de `estado_invalido`. Otra versión sigue rechazándose.

### K4: contrato de `POST /sorteos` con `solicitud_id`

| | |
|---|---|
| Campo | `solicitud_id` (opcional) en el cuerpo |
| Formato | 8–100 caracteres `[A-Za-z0-9_-]` (un UUID vale). Otro formato: `400 validacion` (`campo: solicitud_id`), no se crea nada |
| Misma solicitud | Mismo cliente y mismo `solicitud_id` = UNA operación. El doble clic, el reintento o las peticiones simultáneas devuelven **el mismo borrador** (la respuesta original, aunque el reintento traiga otros datos) |
| Solicitudes distintas | Borradores distintos |
| Sin `solicitud_id` (clientes antiguos) | Como siempre: cada petición crea su borrador |
| Alcance | La clave lleva el usuario **del token**: el mismo id de otro cliente es otra operación y nunca devuelve sus sorteos |
| Validación fallida | Queda en `error`; la misma solicitud corregida se puede repetir |
| En curso | Si otra petición con el mismo id no termina a tiempo: `409 solicitud_en_curso` |
| Consumidores | Panel: `FormularioSorteo` genera uno por intento de creación (lo repiten el doble clic y los reintentos; se renueva tras crear). La edición (`PUT /:id`) no cambia. No hay otros consumidores de `POST /sorteos` en el repositorio |

### Migración 049 (preparada, **NO aplicada**)

`eventos_bot_un_evento_activo_por_sorteo_y_grupo`: índice único parcial `(usuario_id, grupo_id, identidad_evento_real) WHERE activo AND identidad_evento_real IS NOT NULL`.

- **No es necesaria para C2:** el reclamo usa la 006. Es la segunda capa, para lo que no pase por el reclamo (una versión antigua del backend durante un despliegue, o el registro no disponible).
- **Antes de aplicarla:**
  1. ejecutar `eventos_duplicados_solo_lectura.sql` y obtener 0;
  2. desplegar el backend con F4-F, porque `guardarEvento` adopta ante su `23505`.
- **La propia migración** se niega a aplicarse si hay duplicados.
- **Validada en PGlite:** se niega con duplicados; es idempotente; permite el historial, otro grupo, otro sorteo, otro cliente y filas sin identidad.

**Producción NO está protegida todavía:** nada de F4-F está desplegado.

### Validación

- **C7:** 25/25. Las filas de reclamo se apartan de la huella y se comprueba que ninguna queda en curso.
  - Se verificó que, **sin ellas, las 25 huellas son idénticas a la referencia**, que no se regeneró.
  - La única diferencia es una fila `ACTIVAR_EVENTO` por cada creación, `ok` salvo E7: el cliente no puede reemplazar, no se crea nada y el reclamo queda `error`, retomable.
- **C8:** 7/7. Cambian a propósito C2 (detector + panel), C2 (doble anuncio) y K3. K4 sin `solicitud_id` y K5 se dejan igual.
- **`caracterizacion/reclamosF4F.test.js`** (nuevo): 19 casos de C2, K3, K4 y del dueño antiguo.
  - 48 ejecuciones (12 de cada prueba de concurrencia, en lotes de 4 en paralelo), todas en verde.
  - Mutación: quitar la condición del dueño antiguo hace fallar C2-10.

### Riesgos y limitaciones

- **R19:** ~~en K3 la programación que adopta queda `cancelado`~~ resuelto en F4-F.1 (publicación compartida).
- **Esperas acotadas:** quien espera al ganador sondea unos 30 s. Si el ganador sigue (por ejemplo, la captura de imagen del panel es lenta):
  - WhatsApp devuelve `null` (no hace nada);
  - el panel queda `fallido` y se reintenta; un instantáneo queda en revisión y se usa «Reintentar».
- **Fuera de K3:** `recuperarAtascados` marca `publicado` desde el registro del anuncio sin pasar por el reclamo. Otra programación del mismo sorteo que llegue después no lo vería.
- **Corrección de la misma fila:** cuando un anuncio de otro sorteo corrige una fila sin números, ese UPDATE cambia la identidad de una fila existente sin reclamo. Una creación simultánea de esa nueva identidad en el mismo grupo no está cubierta; la 049 la cubriría.
- **Registros:** `automation_actions` crece una fila por creación y por publicación. Ninguna limpieza nueva.

## F4-F.1. Revisión: publicación compartida, corrección sin números y reloj de las pruebas (06/11/2026, local, sin commit)

### 1. K3: publicación compartida, sin cancelar nada

**Decisión.** La programación que adopta **ya no queda «cancelado»**. Se distinguen tres cosas:

| | Dónde se ve | Estado |
|---|---|---|
| **Publicación física** (fila del evento + anuncio) | `eventos_bot` y el envío protegido por su clave | — |
| **Programación propietaria** (la que la produjo) | reclamo `PUBLICAR_SORTEO:<usuario>:<grupo>:<identidad>`, `detalle.sorteo_id`. Se escribe de forma atómica al adquirirlo y no cambia | su destino `publicado` |
| **Programación adoptante** | su destino `publicado` con el **mismo** `evento_bot_id`, en un grupo cuyo reclamo es de otra | `publicado`; nunca cancelada |

**Por qué no hay un estado nuevo `adoptada`:** los `CHECK` de `estado` de la 024 no lo admiten y añadirlo exige una migración. La relación se deriva del reclamo, que ya es persistente y atómico, sin migración y sin carreras entre escritores.

**Módulo:** `sorteos/publicacionCompartida.js`, que solo lee.

| Función | Qué hace |
|---|---|
| `propietariasPorGrupo` | De cada grupo, qué programación produjo la publicación |
| `gruposAdoptados` | En qué grupos esta programación adopta la publicación de otra |
| `esPuraAdoptante` | Si todo lo que tiene publicado lo publicó otra |
| `elegirProgramacion` | **Criterio único** de «la programación del sorteo» |

**Consumidores revisados y cambiados:**

| Consumidor | Antes | Ahora |
|---|---|---|
| `publicador.procesarPublicados` (recordatorios y aviso de cierre, por programación) | — | omite los grupos adoptados: una sola vez cada uno |
| `publicador.liberarVencidas` (vencimiento, por programación) | — | una adoptante pura no aplica su vencimiento: lo gobierna la propietaria |
| `gruposSorteo.programacionDeIdentidad`, `sorteosActivos.sorteoProgramadoDe` y `prioridadComunicaciones.sorteoDelEvento` | tres copias de «la más reciente no cancelada» | `elegirProgramacion`: la más reciente, salvo una adoptante pura. Con una sola candidata (lo habitual) no se lee nada más: el resultado de siempre. Cada uno conserva su regla de archivadas |
| `gruposSorteo.cambiarGrupos` al quitar un grupo de la adoptante | — | solo deja de ser su destino; no desactiva el evento, que es de la propietaria |

**Sin cambios, revisados:**
- `administracion`: cancelar, eliminar y archivar no cierran eventos;
- `finalizarSorteo`: la adoptante queda `publicado`;
- los reintentos: un destino `publicado` no se reclama;
- `recuperarAtascados` (ver §3);
- `disponibilidad.programadoSolapado`;
- el panel: `publicado` es un estado conocido.

**Historial:** se registra `publicacion_compartida` en `sorteos_programados_historial`, pero el `CHECK` de `accion` (038) no lo admite y ese insert falla en la base real (se registra en el log, como ya les pasa a `publicar_grupos_nuevos` y `vincular_detectado`). **La trazabilidad garantizada es el reclamo.** Ampliar ese `CHECK` queda para una migración autorizada.

### 2. C2: corrección sin números

- **Riesgo real, ya cerrado.** Un anuncio de WhatsApp «corrige» la fila X (otro sorteo, sin números) hacia el sorteo I mientras el panel publica I en el mismo grupo. Antes quedaban dos filas activas de I, porque la corrección no pasaba por el reclamo.
- **Corrección hacia I = activar I en el grupo:** toma el mismo reclamo `ACTIVAR_EVENTO:<u>:<g>:<I>` (`activarEvento.activaElSorteo`). Si otro ya activó I, la detección vuelve a decidir **una** vez: reutiliza la fila de I y sustituye la anterior, como si hubiera llegado después.
- **Encontrado al probarlo:** el reemplazo del panel cerraba la fila que iba a reutilizar, porque `delGrupo` se calculó antes de la corrección. `sustituciones.reemplazarDelPrecio` ya no cierra la fila que se reutiliza ni una que ya es del sorteo anunciado. Sin carreras no cambia nada.
- **No depende de la 049.**
- **Sin concurrencia:** la corrección sigue corrigiendo la misma fila.

### 3. K3: recuperación, documentado para F4-G

- **Hoy:** `publicador.recuperarAtascados` marca `publicado` un destino atascado cuyo registro del anuncio está en `ok`, sin pasar por el reclamo `PUBLICAR_SORTEO`. Si esa programación no lo tenía (p. ej. se cayó antes de que existiera F4-F), otra del mismo sorteo que llegue después no vería la publicación y la haría otra vez.
- **Integración en F4-G**, con el **mismo** mecanismo y sin otro:
  1. la recuperación del anuncio llama a `publicacionPorGrupo.publicarUnaVez` con un `publicar` que devuelve los cambios ya conocidos, sin enviar nada;
  2. si el reclamo no existe, lo adquiere y lo marca `ok` a su nombre: queda como propietaria;
  3. si es de otra programación ya publicada, adopta su publicación;
  4. si es suyo, continúa como hoy.
- Lo mismo se aplicará a la reanudación del worker y a `recuperarCiclos`.

### 4. R21: prueba del calendario determinista

- `calendarioMaestro` usaba `Date.now() + 24 h` y el reloj real del servicio. Ahora inyecta un instante fijo (08:00 de Colombia) en `servicio._reloj`, el mismo gancho del arnés de eventos, y «mañana» sale de ese instante.
- **Expectativas sin cambios.**
- **24/24** con el reloj del proceso a las 08:00, 13:30 y 23:00 de Colombia.

### 5. Pruebas nuevas

`caracterizacion/publicacionCompartida.test.js` (7 casos):
1. recordatorio y aviso de cierre **una** vez;
2. vencimiento: la adoptante pura no lo aplica y la propietaria sí;
3. los tres resolutores devuelven la propietaria;
4. quitar el grupo de la adoptante no desactiva el evento, y de la propietaria sí;
5. con una candidata, ninguna lectura extra;
6. corrección sin números y panel a la vez: una fila;
- 6b. corrección sin concurrencia: la misma fila, con su reclamo.

Prueba de mutación: sin el reclamo en la corrección fallan 6 y 6b.

## F4-G. Recuperación centralizada de operaciones interrumpidas (06/11/2026, local, sin commit)

### Archivos

```
backend/automation/recuperacion.js           (nuevo) reglas COMUNES: umbrales con su motivo; estado de un envío
                                             por su registro; política de lo incierto; cuándo se retoma un reclamo
backend/sorteos/estadoPublicacion.js         (nuevo) estados de destinos y programación (intentos máximos,
                                             instantáneo, «en espera», finalizarSorteo); salen del publicador sin cambios
backend/sorteos/recuperacionPublicacion.js   (nuevo) recuperarAtascados (antes en el publicador), integrado con K3
backend/sorteos/publicador.js                (mod.) publicación, recordatorios y vencimiento; tick coordina
backend/automation/motorEventos.js           (mod.) recuperarCiclos con las reglas comunes (mismo comportamiento)
backend/bot/funciones/eventos/workers/workerEventos.js   (mod.) apertura reconciliada con el registro común
backend/bot/funciones/eventos/lifecycle/activacion/aperturaGrupo.js     (mod.) registrarAperturaConfirmada
backend/bot/funciones/eventos/lifecycle/activacion/reclamoActivacion.js (mod.) umbral común; el mismo destino
                                             retoma su reclamo colgado sin esperar
backend/sorteos/publicacionPorGrupo.js, creacionIdempotente.js, administracion.js (mod.) umbrales comunes
```

- **Movido del publicador sin cambios de lógica:**
  - `recuperarAtascados`, `claveAnuncio` e `INCIERTO` → `recuperacionPublicacion.js`;
  - `MAX_INTENTOS_AUTOMATICOS`, `EN_ESPERA`, `sinPromesaDeReintento`, `esInstantaneo`, `resultadoInstantaneo` y `finalizarSorteo` → `estadoPublicacion.js`.

  El publicador sigue exportando lo que usan `administracion` y las pruebas. Pasa de 952 a 801 líneas (522 → 430 de código).
- **Fuera de F4-G a propósito:** los recordatorios y el vencimiento siguen en el publicador.

### Los tres caminos, con las mismas reglas

| Camino | Disparador (propio) | Regla común que usa |
|---|---|---|
| Publicaciones atascadas (`recuperacionPublicacion`) | destino `publicando` > `PUBLICACION_ATASCADA_MS` | estado del envío por su registro; reclamo K3 cerrado con el resultado conocido |
| Worker (`workerEventos`) | fila `abierto=false` y WhatsApp confirma el grupo abierto | `registrarAperturaConfirmada` (solo sobre una fila activa) y `motorEventos.reanudarApertura` |
| Ciclos (`motorEventos.recuperarCiclos`) | ciclo abierto sin OPEN o pendiente con el grupo abierto | umbrales `CICLO_*`; el OPEN solo se envía si está NO iniciado |

**El tiempo dice cuándo MIRAR; lo que se hace lo decide el estado persistido:**
- el registro del anuncio y del OPEN;
- los reclamos;
- el estado del destino y el de la fila.

### Umbrales (`automation/recuperacion.UMBRALES`)

| Umbral | Valor | Motivo |
|---|---|---|
| `PUBLICACION_ATASCADA_MS` | 10 min | una publicación viva lleva captura de imagen y envío por la cola de WhatsApp, con esperas por rate-overlimit. Antes estaba copiado en el publicador y en `administracion` |
| `RECLAMO_PUBLICACION_MS` (K3) | 10 min | cubre esa misma publicación |
| `RECLAMO_ACTIVACION_MS` (C2) | 2 min | solo escrituras en la base |
| `RECLAMO_CREACION_MS` (K4) | 1 min | un INSERT |
| `CICLO_MARGEN_MS` / `CICLO_TOLERANCIA_APERTURA_MS` / `CICLO_ANTIGUEDAD_MAXIMA_MS` | 2 min / 15 min / 24 h | los de siempre del motor (no tocar un ciclo que se está abriendo; no anunciar tarde; no reanudar historia) |
| **Reclamo propio de un destino** (K3 y C2 del panel) | se retoma **sin esperar** | un destino solo lo toma un proceso a la vez (`reclamarGrupo`, compare-and-swap): si el mismo destino encuentra su reclamo en curso, el intento anterior murió |
| Cierre de grupo de F3 | 5 min | sin cambios (F3 no se altera) |

### Estados de un envío (`estadoDelEnvio`)

| Estado | Registro del ExecutionGuard | Qué se hace |
|---|---|---|
| **no iniciado** | sin registro | es lo único que se vuelve a intentar |
| **confirmado** | `ok` | nunca se repite. Si la caída fue antes de registrar el resultado, se marca «publicado» y el evento pasa por el motor con la hora real del anuncio |
| **incierto** | `en_progreso` (caída durante el envío) | **nunca se reenvía solo**: revisión manual, y «Reintentar» abre otra clave |
| **fallido** | `error` | revisión manual, como siempre |

**Límite (no inventado):** Baileys no ofrece una forma fiable de comprobar si un mensaje concreto llegó a un grupo, y el registro no distingue «se envió y se cayó» de «se cayó antes». Por eso la política segura es no reenviar lo incierto.

### C2 y K3 en la recuperación

- **C2:**
  - la recuperación nunca crea filas: el reintento normal pasa por el núcleo y adopta la fila existente;
  - un reclamo `ACTIVAR_EVENTO` colgado del mismo destino se retoma sin esperar los 2 min;
  - el de otra entrada (por ejemplo, la detección) sigue esperando su umbral.
- **K3 (cierra R22):** el resultado conocido se entrega a `publicarUnaVez` sin enviar nada. Según quién tenga el reclamo:
  - **suyo** (colgado por la caída): lo retoma y lo cierra con el resultado. `ok` si llegó, y queda como propietaria. `error` si no llegó o es incierto, y las demás programaciones del mismo sorteo **esperan**;
  - **de otra que ya publicó:** adopta su publicación compartida;
  - **de otra que está publicando:** espera;
  - **de otro proceso de su MISMA programación** (dos recuperaciones a la vez): no toca el destino. Esto se encontró en la prueba 11: antes el perdedor lo dejaba `pendiente`.
- **Recordatorios y avisos:** no se duplican, porque la recuperación no los envía y la adoptante no los gobierna (F4-F.1).

### Pruebas

`caracterizacion/recuperacionF4G.test.js` (12 casos):
- las reglas comunes;
- caídas antes de crear el evento, después de guardarlo, antes y después de abrir el grupo y antes del anuncio;
- envío incierto (nunca se reenvía y la otra programación espera);
- anuncio confirmado con caída antes de registrarlo (sin reenvío, y la otra adopta);
- worker (una apertura; una fila cerrada entretanto no se toca);
- ciclos (confirma una vez; un OPEN incierto no se repite);
- dos recuperaciones a la vez;
- recuperación mientras otra programación tiene el reclamo;
- reintento tras un fallo;
- operaciones ya completadas (nada cambia).

**Límite conocido:** tras una caída **después de abrir** el grupo, el reintento vuelve a aplicar el ajuste «abrir» de WhatsApp antes del anuncio. Es idempotente y no es un mensaje: el mensaje de apertura y el anuncio salen una sola vez.

### Decisiones que necesitan tu autorización

1. Ubicación y nombre del núcleo (`lifecycle/activarEvento.js`).
2. C2: reclamo persistente ya en F4-F, y la 049 como preparada (aplicarla aparte).
3. Ampliar el `CHECK` de la 048 (aún sin aplicar) con las modalidades de activación.
4. K3 (dos programaciones del mismo sorteo y grupo): primero caracterizar; si hay doble anuncio, decidir la regla (bloquear la segunda confirmación o adoptar la primera).
5. K4 (doble clic en «Crear»): dejarlo, o añadir `solicitud_id` (cambia el contrato de `POST /sorteos`: opcional y compatible).
6. Orden de las etapas F4-C a F4-H.
