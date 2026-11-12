# Sorteos programados sobre el motor único de rifas

Fecha: 12/11/2026. Estado: implementado en local, **sin commit, sin aplicar y sin desplegar**.

## 1. Incidente que lo originó

La vista previa de un sorteo instantáneo de $2.000 mostraba 72 números ocupados (70 pagados y 2 reservados, «anotados en Sinuano Día»), mientras que Reservas mostraba la tabla de $2.000 vacía (100 libres). Además, al elegir «Reiniciar la tabla antes de publicar», la vista previa respondía «No pudimos revisar la tabla para reiniciarla».

| Causa | Detalle |
|---|---|
| Dos fuentes de números | Reservas y el bot leen `numeros_rifa` por `tabla_id`. Los sorteos programados (vista previa, imagen, disponibilidad, reinicio, conteos) leían la cuadrícula antigua `reservas_dos_cifras`, filtrando **solo por `usuario_id`**. Esa cuadrícula la comparten $1.000, $1.500 y $2.000, así que los 72 números del sorteo cerrado de $1.000 «Sinuano Día» aparecían en el de $2.000. |
| La 030 nunca funcionó en Supabase | `reiniciar_tabla_cliente` contiene `update _filas_reinicio set clase = …` sin WHERE. PostgREST carga pg-safeupdate, que lo rechaza con `21000 UPDATE requires a WHERE clause`. Prueba de ello: `reservas_archivo` tiene 0 filas en producción. |

## 2. Regla única

- **La rifa del sorteo (`tabla_id`) es su identidad.** Es obligatoria y explícita: se elige en el formulario y nunca se deduce del precio.
- **Los números de un sorteo son los de su rifa:** `numeros_rifa` con `usuario_id` + `tabla_id`, leídos siempre a través de `backend/rifas/numerosSorteo.js`. Es la misma fuente que usan Reservas y el bot.
- Sin `tabla_id` no se lee nada (falla cerrado). Nunca se muestra «0»: se bloquea con una explicación.
- **El historial vive en `numeros_rifa_archivo`** (por ciclo). Los sorteos anteriores no bloquean un ciclo nuevo; solo protegen sus números mientras están activos.
- La cuadrícula antigua solo se lee con `MOTOR_RIFAS=legado`, que es la vuelta atrás de emergencia y usa el mismo interruptor que el bot. Nunca funcionan los dos motores a la vez: con el motor nuevo, las rutas que escriben en la cuadrícula antigua responden 409.

## 3. Cambios

### Base de datos (preparadas, sin aplicar)

| Migración | Qué hace |
|---|---|
| `054_sorteos_por_rifa.sql` | (1) Vuelve a crear `reiniciar_tabla_cliente` añadiendo `where true` en el UPDATE de su tabla temporal (solo afecta al motor legado). (2) Añade `rifa_reiniciar_sorteo`: reinicio de **una** rifa, en dos pasos: revisión sin escritura y aplicación con huella. Toma la rifa con FOR UPDATE, bloquea sus números y bloquea `eventos_bot` en modo SHARE. Protege los números de un sorteo activo de esa rifa, los pagos en proceso, las reservas anticipadas, las reservas sin sorteo atribuible y los números de otro ciclo. Conserva los bloqueos manuales salvo que se autorice liberarlos. Es todo o nada, archiva lo liberado, sube el ciclo y deja auditoría. (3) Añade `rifa_cambiar_identidad`: «Corregir» un sorteo activo traslada sus reservas a la identidad nueva dentro de su rifa. (4) Añade un trigger en `sorteos_programados`: toda programación nueva, o que pase a programado/publicando, necesita una rifa del mismo cliente, no archivada y del mismo precio. Reversión: `054_revertir_sorteos_por_rifa.sql`. |
| `055_rifa_borradores_sin_tabla.sql` | Asigna la rifa `12887e61…` («Tabla $2.000») a los borradores `8af55145` y `dadea765`. Antes vuelve a comprobar que la correspondencia sigue siendo inequívoca; si algo cambió, aborta sin tocar nada. |

### Backend

| Archivo | Cambio |
|---|---|
| `rifas/numerosSorteo.js` (nuevo) | Fuente única: `fuenteDe`, `consulta`, `leerFilas`, `numerosImagen`, `rifaDe`. |
| `automation/repo/tablaEvento.js` | La imagen y la vista previa leen la rifa del sorteo o del evento. |
| `sorteos/disponibilidad.js` | `revisarTabla` lee la rifa; el tamaño sale de la rifa. |
| `sorteos/reservasAnticipadas.js` | Las anticipadas se buscan en la rifa y solo entre los programados de esa rifa. |
| `sorteos/reinicioTabla.js` | Con el motor nuevo usa `rifa_reiniciar_sorteo`; el error original de Supabase queda en el registro. |
| `sorteos/servicio.js` | `rifaDelSorteo` (obligatoria con el motor nuevo), `tabla_id` en la fila, vista previa por rifa, mensajes que distinguen «sin rifa» de «error» e incluyen el código real. |
| `sorteos/validar.js` | `porRifa`: el precio lo valida la rifa, no la lista fija de precios base. Así una rifa de $13.000 puede tener sorteos. |
| `sorteos/publicador.js` | `problemaDeRifa` sustituye a «la tabla configurada para el precio»; revisa la tabla y reinicia por rifa. |
| `sorteos/capturaProgramada.js` | La huella y la imagen al publicar usan la rifa del sorteo. |
| `services/datosTablaImprimir.js` | La imagen de Compartir/imprimir toma la rifa explícita o la del evento firmado; nunca la del precio. |
| `routes/tablas.js` | Compartir busca el sorteo activo **del precio** (antes lo buscaba por cuadrícula física, compartida por varios precios) y toma su rifa. Las rutas de escritura `/tablas/:precio/numeros/*` y `/lote` responden 409 con el motor nuevo. |
| `sorteos/repo.js` | `numerosPorIdentidad`, `contarNumerosTabla` y `contarNumerosIdentidad` leen la rifa (paginando); sin rifa devuelven `ok=false`. |
| `sorteos/administracion.js`, `gestionEventos.js`, `sorteosActivos.js` | Los conteos van por rifa. Al «corregir», el valor queda atado al precio de la rifa y la identidad se traslada con `rifa_cambiar_identidad`. |
| `sorteos/gruposSorteo.js` | Adoptar un sorteo detectado hereda `eventos_bot.tabla_id`. |
| `bot/funciones/eventos/sorteoReal.js` | `estadoDelSorteo` (cierre por «todos pagados» y recordatorios) lee la rifa del evento. |
| `bot/funciones/eventos/detectarEvento.js` | Un anuncio cuyo precio no está en `tablas_cliente` (rifa nueva) se acepta si el grupo resuelve su rifa con `rifa_resolver`. |

### Panel

`FormularioSorteo` añade el selector «Tabla (rifa) del sorteo»; el valor queda fijado al precio de la rifa elegida. Además, `tabla_id` en los tipos de `apiSorteos`, y la cadena `TablaPrecioView` → `AccionesTabla` → `AnuncioSorteoModal` pasa la rifa abierta y filtra sus sorteos por `tabla_id`.

## 4. Auditoría de dependencias de la cuadrícula antigua

Clasificación: **1** = uso legítimo del historial · **2** = compatibilidad temporal (solo con `MOTOR_RIFAS=legado`) · **3** = debe migrarse · **4** = obsoleto, se puede retirar.

| Aparición | Clase | Nota |
|---|---|---|
| Ramas «legado» de tablaEvento, disponibilidad, anticipadas, reinicio, repo, sorteoReal, publicador (vencimiento), bot (reservar, consultar, pagos, lleno, sorteoAnterior) | 2 | Detrás del interruptor. Se retiran cuando se descarte la vuelta atrás. |
| `reiniciar_tabla_cliente` (030, corregida en 054) | 2 | Solo la usa el motor legado. |
| `services/reservaManual.js` + `/tablas/:precio/numeros/*`, `/lote` | 2 | Bloqueadas (409) con el motor nuevo; el panel usa `/rifas/:id/numero` y `/lote`. |
| `bot/funciones/reservas/liberacion.js` (`consultaLiberacion`) | 2 | Solo la usan reservaManual y la rama legado del vencimiento. |
| `routes/tablas.js` `/inicializar`, `/:precio/preparar`; `tablasCliente.inicializarCliente`/`prepararCuadricula` | 2 | Crean filas de cuadrícula antigua; con el motor nuevo no aportan nada. |
| `tablas_cliente` en detectarEvento, configEvento, filtroCliente, servicio, gruposSorteo | 2 | Solo como etiqueta histórica `eventos_bot.tabla`; con el motor nuevo nunca se leen números de ella. |
| Panel: `services/tablas/obtenerTabla.ts`, `reiniciarTabla.ts`, `impactoReinicio.ts`, `tablasCliente.ts`, `estadoSorteoPrecio.ts` | 2 | Solo cuando la vista no tiene rifa (motor legado). `reiniciarTabla.ts` escribe en la cuadrícula **desde el navegador** (RLS): ver riesgos. |
| `reservas_archivo` (030) y `rifas_migracion_mapa` | 1 | Historial; no se tocan. |
| `bot/funciones/usuarios/obtenerPerfilContacto.js`, `listarContactos.js`, `inactividad/inactividadRepo.js` | **3** | Agregan el historial de compras por contacto sobre las cuadrículas antiguas. No deciden disponibilidad, pero con el motor nuevo muestran datos que ya no se actualizan. Hay que pasarlos a `numeros_rifa` + `numeros_rifa_archivo` por `usuario_id` (agregación de todas las rifas del cliente). **Pendiente.** |
| `backend/_reconstruccion_usuarios.js`, `_test_fase_produccion_real_scheduler.js` | 4 | Scripts sueltos de mantenimiento. |
| `unSorteoPorPrecio.js` (reemplazo por precio, restricción 043) | — | El reemplazo sigue siendo por precio porque la 043 admite un solo sorteo activo por precio y cliente. Choca con D5 (varias rifas del mismo precio): ver riesgos. |

## 5. Pruebas

| Prueba | Casos | Resultado |
|---|---|---|
| `backend/tests/rifasApp/sorteosPorRifa.test.js` (PGlite, SQL real 032+050+030+051+054) | A, B, C, D, E, F, H + corrección de identidad | 8/8 |
| `backend/tests/rifas/concurrenciaSorteoRifa.test.js` (Postgres 17 local y desechable) | G: 25 rondas de reserva y publicación simultáneas | 2/2, con los dos desenlaces (13 reinicios completos y 12 rechazados por la huella; 15 y 10 en una segunda ejecución), nunca a medias |
| `backend/tests/rifas/sinUpdateSinWhere.test.js` (estática) | pg-safeupdate: detecta el defecto real de la 030 y comprueba las 51 funciones vigentes | 2/2 |
| Prueba de la 055 (fuera del repositorio, PGlite) | Caso real, segunda ejecución, otra rifa de $2.000, grupo sin vínculo, borrador ya cambiado | 5/5 |
| Suite completa `npm test` | | 235 correctas, 0 inesperadas, 1 fallo conocido (anterior) |
| Pruebas de rifas con entorno (`--entorno`) | | 12/12 |
| `tsc --noEmit` del panel | | 0 errores |

pg-safeupdate no está disponible en local; la prueba estática cubre los UPDATE/DELETE estáticos (no los dinámicos de `execute format`). La comprobación definitiva es la llamada de revisión en producción después de aplicar la 054 (sección 6).

## 6. Despliegue (requiere autorización)

1. SQL Editor: aplicar `054_sorteos_por_rifa.sql` y comprobar el bloque VERIFICACIÓN.
2. Ejecutar la revisión de solo lectura: `select public.rifa_reiniciar_sorteo('<usuario>', '<tabla_id>', null, null, false);`. Debe devolver JSON, no el error 21000.
3. Aplicar `055_rifa_borradores_sin_tabla.sql`, o editar o cancelar los dos borradores desde el panel.
4. Commit y push (Vercel). Después, en el VPS: pull y `pm2 restart --update-env`, comprobando `MOTOR_RIFAS=nuevo`.
5. Abrir la vista previa de un sorteo de $2.000: debe mostrar la tabla de Reservas, y «Reiniciar» debe revisarse sin error.

## 7. Riesgos pendientes

- **Contactos, perfil e inactividad** siguen leyendo la cuadrícula antigua (clase 3).
- **Reinicio desde el navegador** (`reiniciarTabla.ts`) escribe en la cuadrícula antigua con RLS. Solo se usa sin rifa, pero no hay ningún bloqueo en la base. Propuesta: retirar con una migración los permisos UPDATE de `authenticated` sobre las cuadrículas antiguas cuando se descarte la vuelta atrás.
- **043 y D5:** con dos rifas activas del mismo precio, la base sigue impidiendo dos sorteos activos de ese precio, y «publicar» reemplaza por precio. Hay que decidir si el reemplazo pasa a ser por rifa.
- **Diseño visual** (`tabla_configuracion_visual`): sigue indexado por precio.
- **Más de 1000 números:** las lecturas nuevas paginan; las ramas legado no.
- El detector con una rifa de precio nuevo no tiene prueba unitaria propia; se apoya en las pruebas de `rifa_resolver`.
