# Riesgos, migraciones pendientes y decisiones que requieren autorización

Registro F1-C, 06/11/2026. El estado de las migraciones es **el último observado** (fecha al lado); hoy no se consultó la base porque F1-C no permite conectarse a Supabase. Todo lo que diga «sin verificar» hay que comprobarlo con SQL de solo lectura antes de decidir.

## Migraciones (`backend/supabase_migrations/`)

| Migración | Estado observado | Fecha | Qué depende de ella |
|---|---|---|---|
| 001 `configuracion_mensajes` | ausente en producción | 21/10 | `services/mensajes/guardarConfigMensaje.ts` (sin uso) |
| 021 mensaje procesado único | sin verificar (no se ve por REST) | 30/10 | — |
| 022 control de inactividad | presente | 30/10 | worker de inactividad (en simulación) |
| 023, 024 | presentes | 14/10 | sorteos programados |
| 025 / 026 calendario de loterías | 026 aplicada a medias | 16/10 y 04/11 | calendario |
| 027 `tablas_cliente` | presente | 30/10 | tablas por cliente |
| 028 / 029 mensajes por cliente | 028 presente; 029 sin verificar | 30/10 | aislamiento de mensajes |
| 030 reinicio seguro | presente | 30/10 | reinicio de tablas; `liberacion.js` usa la misma lista de campos |
| 031 QR público | presente | 30/10 | `/conectar/[id]` |
| **032 auditoría de reservas** | **contradictorio: ausente el 23/10; presente el 30/10 por REST, sin comprobar triggers ni permisos. Pendiente de verificación.** | 23/10 y 30/10 | auditoría de pagos y liberaciones (también la de vencimiento desde F1-B), idempotencia de `pagarManual`, historial de números |
| 033 unicidad por cliente | sin verificar | 30/10 | — |
| 034 compradores por cliente | ausente | 30/10 | — |
| 035 RLS de tablas de cliente | sin verificar | 30/10 | — |
| 036, 037, 038 | presentes | 30/10 | texto del sorteo detectado, destinos de compartir, administración de programados |
| 039 gestión de `eventos_bot` | ausente | 30/10 | gestión de eventos |
| 040 expulsiones | presente | 06/11 | expulsión de bloqueados (modo desactivado) |
| 041 pagos sin WhatsApp | sin aplicar | 31/10 | el trigger `whatsapp NOT NULL` sigue bloqueando pagos sin contacto |
| 042 preferencias de mensaje | sin aplicar | 31/10 | plantillas de mensajes de sorteos |
| 043 un sorteo activo por precio | sin verificar | 01/11 | reemplazo por precio |
| 044 frecuencia de loterías | sin aplicar | 04/11 | calendario maestro |
| 045 historial de acciones de grupos | sin verificar | 04/11 | historial de grupos |
| 046 biblioteca de stickers | sin aplicar | 05/11 | galería de stickers de pago |

Comprobación preparada y **no ejecutada** para la 032: [activacion/verificar_032_solo_lectura.sql](activacion/verificar_032_solo_lectura.sql). Sin conectarse, el panel también lo indica: **Tablas → Historial de números** muestra «La auditoría de operaciones aún no está activada en la base» si la tabla falta.

## Riesgos abiertos

| Id | Riesgo | Evidencia | Mitigación actual |
|---|---|---|---|
| R1 | Dos filas de evento para el mismo sorteo y grupo | C2; no hay índice único | caracterizado; se trata en F2/F4 |
| R2 | Fila `activo=true` y cerrada a la vez (C3) y filas con `activo NULL` | `estadosGestion.contradicciones()` | **F2:** ya no aceptan reservas nuevas por WhatsApp ni reciben recordatorios; `NULL` = cerrada en todas partes. **Pendiente:** las filas C3 se siguen mostrando «En curso»/«abiertas» en Eventos, Sorteos programados y edición (conflicto con las acciones de F3, [arquitectura/ESTADO_SORTEOS.md](arquitectura/ESTADO_SORTEOS.md) §6.1). Recuento preparado y validado en local, **sin ejecutar**: `activacion/estado_sorteos_contradicciones_solo_lectura.sql` |
| R14 | Borrar una cuenta (`auth.users`) con filas en `reservas_auditoria` (032) falla: el trigger de solo inserción bloquea la cascada | demostrado en PGlite con la 048, que tenía el mismo trigger y ya está corregida | ninguna en la 032; requiere una migración aparte autorizada |
| R15 | Una operación de WhatsApp en vuelo cuando muere el proceso deja el registro `CIERRE_GRUPO` en `en_progreso` | `cerrarEvento.cerrarGrupoProtegido` | se retoma pasados 5 min; `cerrarGrupo` es idempotente en WhatsApp |
| R19 | **Resuelto en F4-F.1.** La adoptante queda «publicado» (publicación compartida; relación en el reclamo `PUBLICAR_SORTEO`); sus comunicaciones las gobierna la propietaria. Pendiente: el `CHECK` de `accion` (038) rechaza `publicacion_compartida` en el historial de programación | `sorteos/publicacionCompartida.js` | ampliar el `CHECK` en una migración autorizada (también faltan `publicar_grupos_nuevos` y `vincular_detectado`) |
| R22 | **Resuelto en F4-G.** La recuperación entrega el resultado conocido a `publicarUnaVez` (cierra o adopta el reclamo K3 sin enviar) | `sorteos/recuperacionPublicacion.js` | — |
| R23 | Un envío INCIERTO (caída durante el envío) nunca se reenvía solo: queda en revisión manual. WhatsApp/Baileys no permite comprobar si llegó | `automation/recuperacion.js` (política) | «Reintentar» del administrador tras revisar el grupo |
| R20 | La protección de F4-F (C2, K3, K4) NO está en producción hasta desplegar backend y panel; la 049 (segunda capa) está sin aplicar | F4-F | desplegar con autorización; 049 tras su diagnóstico |
| R21 | **Resuelto en F4-F.1** (reloj inyectado en la prueba, 24/24 a cualquier hora). Antes: `tests/sorteos/calendarioMaestro.test.js` (caso «historial: renombrar o restaurar la lotería») fallaba si se ejecutaba después de las 12:56 de Colombia: programa la publicación a `Date.now() + 24 h` y el sorteo cierra a las 12:56 del día siguiente | comprobado en F4-F: con el reloj a las 08:00 de Colombia pasa 24/24 (ya existía; no depende de F4) | ninguna; se propone fijar el reloj en la prueba (cambio de la prueba, requiere aprobación) |
| R18 | Pruebas que esperan un número fijo de vueltas del bucle con el `setTimeout` de 0 ms del arnés pueden ser intermitentes (caso corregido: `cierreGrupoProtegido` 1) | F4-E | revisar este patrón en cualquier prueba nueva; usar señales explícitas |
| R17 | `tests/sorteos/sorteosProgramados.test.js` aborta al salir en Windows (libuv `UV_HANDLE_CLOSING`) tras pasar sus 29 casos: falso fallo intermitente de la suite | ya existía antes de F4 (comprobado con el publicador anterior) | ninguna; se propone esperar a `server.close()` antes de `process.exit()` (cambio de la prueba, requiere aprobación) |
| R16 | **Corregido en local (F4-F), sin desplegar.** C2 y K3 confirmados con latencia simulada (F4-C): dos filas activas del mismo sorteo en el mismo grupo (una sin ciclo, o con dos aperturas), y dos anuncios con dos programaciones del mismo sorteo confirmadas a la vez | `caracterizacion/concurrenciaActivacion.test.js` | ninguna hoy; se corrige en F4-F |
| R13 | Cambios de comportamiento de F3 sin desplegar: reserva manual con permiso, cierres condicionados, normalización, reapertura con ciclo, reintentos de WhatsApp, un solo cierre de WhatsApp por grupo, herencia del permiso en grupos nuevos | [arquitectura/F3_CIERRE_REAPERTURA.md](arquitectura/F3_CIERRE_REAPERTURA.md), sección «Implementación» | Probados (C6, `orquestadorCierre`). Tienen efecto solo al desplegar el Droplet y el panel; antes, aplicar la 047 o aceptar que el permiso queda en «según el estado» |
| R12 | Cambios de comportamiento de F2 sin desplegar | reservas por WhatsApp, recordatorios (scheduler y publicador), «¿qué debo?», estado del panel | Probados (`criteriosEstadoSorteo.test.js`); solo afectan a filas contradictorias. Llegan al Droplet y a Vercel solo cuando se despliegue |
| R3 | La captura de imagen con Puppeteer falla en el Droplet | 13/16 programados fallidos el 30/10 | regla del generador único; D6 pendiente |
| R4 | 25 tablas heredadas con datos personales legibles por anon | auditoría 30/10 | SQL preparado, sin aplicar |
| R5 | El navegador escribe 13 tablas directamente | D9 | RLS |
| R6 | El Droplet no tiene los últimos cambios del backend | sin acceso SSH desde este equipo | ninguno: F1-B y F1-C tampoco están desplegados |
| R7 | Si falta la 032, la auditoría se omite sin error | `auditoriaReservas.js` | aviso único en el log |
| R8 | En producción, `fechaCompraDeFila` sigue dando medianoche a los pagos anteriores a las 10:00 | corregido solo en local (F1-C) | Adelanta la compra hasta unas 10 h: en el borde de los 15 días un miembro puede parecer inactivo hasta 10 h antes. El worker está en simulación, así que no expulsa |
| R9 | La protección de rutas del panel es solo en el navegador | no hay `middleware.ts` | RLS y backend con token |
| R10 | `/ui-preview` está accesible sin sesión | `app/ui-preview/page.tsx` | solo datos fijos de ejemplo |
| R11 | Cambios de comportamiento intencionados en F1-B/F1-C | Vencimiento: limpia 19 campos y audita. `fechaCompraDeFila`: la hora sin cero y la fracción de segundo ya no se convierten en medianoche, y una fecha imposible da `null` en vez de moverse al mes siguiente. Una hora imposible («25:00:00») sigue dando `null`, como antes (revisado en el cierre de F1) | probados; la prueba compara con la versión anterior y falla ante cualquier otra diferencia |

## Decisiones que requieren autorización

| Decisión | Contexto |
|---|---|
| Ejecutar `verificar_032_solo_lectura.sql` (solo lectura) | Cierra el estado de la 032 |
| Aplicar la **047** (permiso de reservas) y la **048** (historial del orquestador) | Preparadas, auditadas y validadas en PGlite, no aplicadas. Sin ellas: todo «según el estado» e historial en el log |
| Ejecutar `eventos_duplicados_solo_lectura.sql` y aplicar la **049** (índice único parcial, segunda capa de C2) | Preparadas y validadas en PGlite; requiere backend con F4-F desplegado |
| Corregir el trigger de la 032 para permitir el borrado de cuentas (R14) | Migración aparte; la 032 puede estar en producción |
| Ejecutar `estado_cierres_f3_solo_lectura.sql` (solo lectura) | Estado operativo de los cierres tras desplegar F3 |
| Pasar Eventos, Programados y edición al criterio canónico (regla 5) ahora que existe la normalización | Cambia lo que muestran las pantallas; mejor después del diagnóstico SQL |
| Retirar el código sin uso señalado en F3 | [arquitectura/CODIGO_MUERTO_CANDIDATOS.md](arquitectura/CODIGO_MUERTO_CANDIDATOS.md) |
| Ejecutar `estado_sorteos_contradicciones_solo_lectura.sql` (solo lectura) | Mide las filas C3 y `NULL`; decide si el conflicto §6.1 de [ESTADO_SORTEOS.md](arquitectura/ESTADO_SORTEOS.md) tiene efecto |
| Regla 5 en las pantallas de administración (Eventos, Sorteos programados, edición) | Exige cambiar las acciones cerrar/reabrir (F3) y la lectura de Compartir (protegida) |
| Permiso de reservas independiente del estado (`permitidas` / `desactivadas` / `segun_estado`): dónde guardarlo (A columna nueva en F4, B `publicacion_panel`, C solo programados), cancelados, canales y reserva del propietario | [arquitectura/F3_CIERRE_REAPERTURA.md](arquitectura/F3_CIERRE_REAPERTURA.md) §6 y §9. Sustituye a la «operación excepcional» |
| F3: orquestador central con 12 modalidades conservadas; 11 decisiones (diagnóstico, permiso de reservas ×4, ciclo al reabrir, WhatsApp en el cierre manual, normalizar C3, zonas protegidas, historial, retirar código sin uso) | [arquitectura/F3_CIERRE_REAPERTURA.md](arquitectura/F3_CIERRE_REAPERTURA.md) §9 |
| Aplicar migraciones pendientes (034, 039, 041, 042, 044, 046 y, si falta, la 032) | Cada una cambia la base |
| Desplegar el backend en el Droplet y reiniciar PM2 | Lleva F1-B y la corrección de la fecha de compra |
| Iniciar F2 (ciclo único del evento) | Toca C2/C3 |
| Eliminar código muerto | Lista en [arquitectura/CODIGO_MUERTO_CANDIDATOS.md](arquitectura/CODIGO_MUERTO_CANDIDATOS.md) |
| Sustituir componentes propios por los de `components/ui` | Es un cambio visual ([frontend/COMPONENTES_UI.md](frontend/COMPONENTES_UI.md)) |
| Mantener o retirar `/chats` y `/ui-preview` | Fuera de la navegación |
| Opción B de aislamiento por precio (cuadrícula por precio) | Decisión de negocio pendiente; `independenciaPorPrecio` falla por ello |
| Activar inactividad o expulsiones en modo real | Requiere doble confirmación |
| Unificar el arnés de pruebas copiado (D13) | Solo afecta a las pruebas |
| Commit y push de F1-A, F1-B y F1-C | Todo está en local |
