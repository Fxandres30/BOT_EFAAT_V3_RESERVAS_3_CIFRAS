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
| R2 | Fila `activo=true` y cerrada a la vez | C3 | caracterizado; F3 |
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
