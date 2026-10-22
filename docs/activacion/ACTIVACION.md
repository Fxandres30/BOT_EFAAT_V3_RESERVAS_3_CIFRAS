# EFAAT — Activación segura: cierre automático, sorteos programados y seguridad

Estado auditado el **2026-10-14** con consultas de solo lectura. Cada paso marcado 🔐 requiere tu autorización expresa.

## Datos reales que condicionan el orden

Resultados de la auditoría de solo lectura. Los identificadores completos no se guardan en el repositorio.

- **Puede haber un sorteo activo en el momento de desplegar** (el 14/10 había uno en 3 grupos, en la tabla `5k_15k_reservas_2_cifras`). Antes de cada paso, comprueba:
  ```sql
  select count(*) filter (where activo) as activos, min(hora_cierre) filter (where activo) as primer_cierre
  from public.eventos_bot;
  ```
  **No despliegues ni apliques nada con sorteos activos.**
- **Reservas de sorteos ya cerrados** (revisado el 14/10 a las 13:40):
  - `reservas_dos_cifras` ya está limpia: todas sus filas reservadas o pagadas son del sorteo activo.
  - `5k_15k_reservas_2_cifras` tiene **6** filas reservadas de sorteos ya jugados (Antioqueñita 14/10 y Cruz Roja 13/10).
  - **3 de ellas se pagaron hoy y algo externo al código las devolvió a «reservado».**
  - Detalle, investigación y propuesta (archivar sin borrar): `reservas_otro_sorteo.md` (🔐).
- **Migraciones:** **023 y 024 ya están aplicadas en producción** (existen las columnas `cierre_*` y las 4 tablas de sorteos programados, vacías). **022 no** (sus tablas no existen).
- **Exposición anon:** además de las 5 tablas conocidas, anon lee **~20 tablas heredadas** con datos personales (`parte_c_tablas_legado.sql`).
- **Clientes:** 2 con sesiones (uno con todos los datos y otro con 1 sesión desconectada y sin datos).
  - Ninguna fila tiene `usuario_id` nulo.
  - Cada tabla física tiene exactamente una cuadrícula completa (100 números únicos) del cliente principal.

## 0. Antes de empezar

1. Revisa el diff y haz el commit en una rama (🔐).
2. Ventana: después del cierre del sorteo activo y antes del siguiente anuncio.
3. Copia de seguridad lógica desde Supabase (Database → Backups) o, como mínimo, guarda el resultado de las consultas de políticas de `propuesta_rls_tablas_antiguas.sql`.

## 1. Seguridad urgente (independiente del resto) 🔐

Cada paso es una transacción independiente. Si uno falla, se revierte entero y **no** sigues con el siguiente.

**Antes de autorizar A y D (revisión Fase 2, 2026-10-21):**
- Ejecuta a mano `diagnostico_rls_solo_lectura.sql` (bloques D0–D16, solo lectura) y guarda cada resultado. Cada bloque dice qué resultado se espera.
- Semáforo previo (P0) y validación posterior (V1–V6, incluida la guardia de la 027 evaluada sin ejecutarla): `validacion_parte_a_solo_lectura.sql`. La 027 no se ejecuta hasta que V3 dé `027_podria_pasar` en las 2 tablas.
- Diagnóstico específico de las 2 tablas de reservas (R0–R15, semáforo R15): `diagnostico_reservas_parte_a_solo_lectura.sql`. Cubre lo que las pruebas locales no pueden: el trigger heredado real (R9), las funciones SECURITY DEFINER (R10) y la ACL exacta para revertir (R3/R4).
- **Bloqueante 1: el enlace «Compartir» del QR** (`/conectar/<id>`) lee `sesiones` con la clave anon. Tras la Parte A deja de funcionar para quien no haya iniciado sesión como dueño.
  - **Solución preparada (21/10, sin aplicar):** `031_qr_sesion_publica.sql`. Devuelve solo `qr`, `estado` y `qr_expira_en` de **una** sesión, a partir de su id, que es el mismo dato que ya lleva el enlace. No lista sesiones ni devuelve teléfono, nombre o dueño, y no escribe.
  - El panel local ya la usa y, si no existe, vuelve a la lectura de siempre.
  - Orden: 031 → desplegar el panel → comprobar el enlace sin sesión → Parte A.
  - Si la Parte A va antes que el despliegue, entre ambos pasos el enlace solo funciona para el dueño con sesión iniciada en ese navegador. En ese intervalo, no compartas enlaces de QR.
- **Bloqueante 2: anon en la API.** Revisa en Logs → API si alguien usa anon en las 4 tablas (además de `/conectar`). Una app externa así dejaría de funcionar con la Parte A.
- **Hallazgo aparte (A y D no lo corrigen):** las funciones de lease de la 004 no revocan `EXECUTE`. Con un `session_id`, anon puede leer el dueño del lease, liberarlo y quedárselo (bot sordo). Reproducido en local: `revisionActivacionRls.test.js`. Confírmalo con el bloque D10. Corrección preparada, sin aplicar: Parte F (`parteFLease.test.js`, 15/15).

| Orden | Archivo / bloque | Qué hace | Riesgo |
|---|---|---|---|
| 1 | `propuesta_rls_tablas_antiguas.sql` (Parte A) | RLS «solo lo propio» en reservas ×2, `eventos_bot`, `sesiones`; anon sin acceso | Si existe una política no prevista, **aborta sola** y la nombra. Si una app externa escribe con anon en reservas, deja de poder hacerlo (ver `reservas_otro_sorteo.md`) |
| 2 | `parte_b_compradores_semanales.sql` → **B1** | Pagos de clientes solo LID se guardan; no se suman a `compradores_semanales` | Mínimo: solo omite inserciones que hoy fallan |
| 3 | `parte_b_compradores_semanales.sql` → **B2** | La función heredada pasa a `SECURITY DEFINER`; anon y authenticated pierden `compradores_semanales` | Aborta sola si no hay exactamente 1 función heredada o su dueño no tiene permisos |
| 4 | `parte_c_tablas_legado.sql` → C1 (y C2 opcional) | anon pierde ~24 tablas heredadas y 4 RPC heredadas | Rompe cualquier app **externa** que las use con la clave anon |
| 5 | `parte_d_sesiones_columnas.sql` (Parte D, después de A) | El panel solo puede **renombrar** sus sesiones y crearlas desconectadas; no cambia `usuario_id`, `activa`, `principal`, `preferida`, `estado`, `qr` ni `telefono`, ni borra directamente | Aborta sola si falta la Parte A. Desplegar **antes** el panel con `updateSession` restringido. El bot (service_role) no se ve afectado |
| 6 | `parte_f_permisos_lease.sql` (Parte F, independiente) | Solo `service_role` puede ejecutar `lease_sesiones_acquire/heartbeat/release`. Cierra el robo del lease (bot sordo) | **Antes**, en cada instancia del bot: `node backend/scripts/verificarRolSupabase.js` debe decir `service_role`; si no, ese bot no podría conectar. Aborta sola si hay sobrecargas o herencias no previstas. Si se vuelve a ejecutar la 004, repetir la F |
| — | `parte_e_mensajes_por_cliente.sql` (Parte E) | **Solo diseño.** Chats por cliente: columna `cliente_usuario_id` (dueño de la sesión que recibió el mensaje) + RLS | Requiere cambio en el bot y decidir el relleno histórico: sin él, los chats antiguos quedan ocultos. Ver cabecera del archivo |

1. Ejecuta las consultas `ANTES` de cada archivo (solo lectura) y **guarda su resultado**: es la vuelta atrás exacta.
2. Aplica en el orden de la tabla.
3. Comprobación posterior:
   - con la clave anon y sin sesión, las tablas afectadas deben responder 0 filas o permiso denegado;
   - con tu sesión, **Tablas**, **Eventos** y **Sesiones** deben verse igual que antes;
   - un pago desde el panel (número de prueba) y uno por sticker deben seguir funcionando.
4. Vuelta atrás: el bloque `VUELTA ATRÁS` de cada archivo, en orden inverso (D → C → B2 → B1 → A).
5. Pruebas en Postgres real en memoria: `propuestaRls.test.js` (8/8), `parteBCompradores.test.js` (10/10) y `backend/tests/seguridad/aislamientoClientesRls.test.js` (A + D + E con clientes A y B, 19/19) y `backend/tests/seguridad/revisionActivacionRls.test.js` (vueltas atrás exactas, casos límite y diagnóstico, 15/15). Necesitan PGlite, que **no** está en el repo: instálalo en una carpeta aparte (`npm install @electric-sql/pglite@0.2.17`) y ejecuta con `PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite`. Sin él, las pruebas se omiten (no fallan). Nunca contra la base real.
6. **Rutas del panel sin autenticación** (`/sessions/*`, `/contactos`, `/bloqueados`, `/tablas/compartir`): **corregido en el código local** (sin desplegar).
   - El backend exige el token de servicio y la sesión de Supabase del usuario.
   - Cada sesión de WhatsApp solo la maneja su dueño.
   - El `usuarioId` del navegador se ignora.
   - Las rutas de administración BANN (`GET/POST /sessions`, `/sessions/:id`, `/qr`, `/reconnect`) exigen solo el token de servicio.
   - Prueba: `backend/tests/seguridad/rutasMultiusuario.test.js` (15/15).
   - **Consecuencia al desplegar:** backend y panel deben desplegarse **juntos** y con `SESSIONS_API_TOKEN` = `BOT_API_TOKEN` (sección 3). Si no, el panel recibe 401/503 en Sesiones, Contactos, Bloqueados y Compartir tabla.
   - Las llamadas manuales por terminal a `/sessions/active/escaner-identidades` o `/diagnostico-telefonos-lid` ahora necesitan el token de servicio **y** un `Authorization: Bearer` de un usuario dueño de la sesión activa.

## 2. Migraciones 🔐

Estado real (14/10): **023 y 024 ya están aplicadas**. Quedan **022** y **025**.

| Orden | Archivo | Estado | Qué hacer |
|---|---|---|---|
| — | `023_estado_cierre_por_grupo.sql` | Aplicada | Solo verificar con la consulta del archivo. No hace falta reaplicarla (si se hace, es idempotente). |
| — | `024_sorteos_programados.sql` | Aplicada (anon recibe 401 en sus 4 tablas) | Verificar políticas con la consulta del archivo. |
| 1 | `022_control_inactividad_miembros.sql` | **Pendiente** | Control de 15 días (en simulación) + trigger de compras en las 2 tablas de reservas. Verificación: `docs/inactividad/022_verificacion.sql`. Vuelta atrás: bloque `REVERSIÓN` (primero quitar los triggers). |
| 2 | `025_calendario_loterias.sql` | **Pendiente** | Calendario de loterías (tabla nueva `loterias_catalogo`, RLS por propietario). Sin ella el panel funciona: el formulario acepta un nombre escrito a mano y el calendario muestra «Falta aplicar la migración 025». Verificación y reversión: al final del archivo. Prueba SQL: `calendarioLoterias.test.js`. |
| 3 | `027_tablas_cliente.sql` | **Pendiente** (preparada 21/10) | Solo después de la Parte A validada. Orden completo y bloqueos en la sección 2b. |
| 4 | `028_mensajes_por_cliente.sql` | **Pendiente** (preparada 21/10) | Después de desplegar el bot nuevo. Sección 2c. |
| 5 | `029_rls_mensajes_por_cliente.sql` | **Pendiente** (preparada 21/10) | Después de la 028 y con el bot nuevo escribiendo `cliente_usuario_id`. Sección 2c. |
| 6 | `030_reinicio_tabla_seguro.sql` | **Pendiente** (preparada 21/10) | Reinicio opcional de la tabla al programar un sorteo. Una sola transacción con las filas bloqueadas: archiva (copia completa, pagos incluidos) y libera solo los reservados o pagados atribuibles a un sorteo **terminado** del cliente.<br>Nunca toca un sorteo activo, los pagos en proceso, las reservas sin sorteo identificable ni los estados desconocidos: si hay alguno, no hace nada.<br>Los **bloqueados a mano se conservan**, salvo que el usuario elija liberarlos.<br>Si la tabla cambió desde la vista previa, no hace nada (`tabla_cambio`).<br>Independiente de las demás. Sin ella, «Reiniciar tabla antes de programar» aparece como no disponible.<br>Prueba SQL: `seguridad/migracion030.test.js` (14/14, PGlite) y concurrencia real en Postgres 17 local (9/9). |
| 7 | `031_qr_sesion_publica.sql` | **Pendiente** (preparada 21/10) | QR de una sesión para `/conectar/<id>` sin la clave anon sobre `sesiones`. Aplicar **antes** de la Parte A (ver bloqueante 1). Prueba SQL: `seguridad/migracion031.test.js` (4/4). |

La 022 es independiente de las Partes A/B/C. Su trigger es `SECURITY DEFINER` y atrapa sus propios errores, así que nunca bloquea un pago. Puede aplicarse antes o después de ellas, pero **en otra ventana**: así, si algo falla, sabrás cuál fue.

Las tres son idempotentes y no modifican datos existentes. Están probadas en Postgres real en memoria:
- `migracion022.test.js`: 15/15;
- `migraciones023y024.test.js`: 6/6.

Si una falla a mitad de camino, la transacción del SQL Editor se revierte entera. Revisa el error y no continúes con la siguiente.

## 2b. Tablas propias por cliente (027) 🔐 — requisito de negocio del 2026-10-21

**Regla:** solo la cuenta principal usa sus dos cuadrículas actuales (una en `reservas_dos_cifras` y otra en `5k_15k_reservas_2_cifras`). Cada cliente nuevo tiene sus **propias configuraciones** (los 8 precios base del código) y su **propia cuadrícula 00–99** en esas mismas tablas físicas, aislada por `usuario_id`. No se crean tablas físicas por cliente. No se migra, reasigna, duplica ni borra nada de la cuenta principal.

**No habilites clientes nuevos (registro, prueba gratuita) hasta completar los pasos 1–4.**

| Orden | Paso | Bloquea si… |
|---|---|---|
| 1 | Diagnóstico de solo lectura: D13, D15, **D17/D17b** (restricciones e índices de las 2 tablas físicas), **D18** (quién crea sorteos en cada tabla) y **D19** (027 aún no aplicada) | D17 muestra una unicidad solo sobre `numero` (o sin `usuario_id`). D15/D18 muestran otro `usuario_id` o filas sin dueño en las tablas de la cuenta principal |
| 2 | **Parte A** aplicada **y validada** (sección 1) | Sin ella, cualquier sesión del panel o la clave anon pueden leer o modificar las cuadrículas de otros. La 027 **aborta sola** si falta |
| 3 | `027_tablas_cliente.sql` | Aborta sola sin la Parte A. No toca filas existentes |
| 4 | Desplegar **juntos** backend y panel con este código (**orden actualizado: el despliegue va antes de la Parte A, ver sección 2d**) | — |
| 5 | Primer acceso de la cuenta principal: debe responder `cuadriculas: existente, existente` y D15 idéntico al guardado en el paso 1 | Cualquier diferencia en D15: detener y revisar |
| 6 | Alta de un cliente de **prueba** propio: 8 configuraciones y 2 cuadrículas `creada`; comprobar con su sesión que no ve nada de la principal | — |

**Si D17 bloquea:** la inicialización de un cliente nuevo falla entera (`409 restriccion_unica`) y no toca nada; la cuenta principal sigue funcionando. Hace falta una migración aparte para pasar la unicidad a `(usuario_id, numero)`, preparada **con el resultado real de D17**. La 027 no la incluye.

**Código (local, sin desplegar):**
- El bot **rechaza** las operaciones de reservas de un sorteo sin `usuario_id` (antes salían sin filtro). Además filtra por dueño la lectura previa del pago por sticker. Un anuncio en una sesión sin dueño no crea sorteo.
- Precio → tabla física según la configuración **del cliente** (`tablas_cliente`) en el bot (anuncios), en los sorteos programados, en «Compartir» e imprimir, y en todas las acciones del panel. Sin la 027, sin inicializar o si la lectura falla, se usan los 8 precios base: el aislamiento no depende de esa tabla, sino de `usuario_id` y la RLS.
- `POST /tablas/inicializar` (panel → backend en el primer acceso). El cliente sale del token; el cuerpo se ignora. Es idempotente y la función solo la ejecuta `service_role`.
- Limitación: el detector de anuncios (`pareceAnuncioDeSorteo`) sigue reconociendo solo los 8 precios base. Un precio añadido a mano en `tablas_cliente` no se anuncia por WhatsApp hasta ampliarlo.

**Pruebas:**
- `migracion027.test.js` (PGlite, 15/15): cuenta principal idéntica campo por campo; A y B con 8 configuraciones y su cuadrícula; idempotencia; RLS cruzada; solo `service_role`; casos de cuadrícula incompleta, unicidad sobre `numero` y Parte A revertida; vuelta atrás.
- `reservas/aislamientoCuadriculas.test.js` (8/8): reservar, disponibilidad, consultar número, «mis números» y pago por sticker con dos cuadrículas en la misma tabla, y sorteo sin dueño.
- `seguridad/tablasCliente.test.js` (8/8) y `frontend/tests/seguridad/tablasCliente.test.mjs` (8/8).

Vuelta atrás: el bloque «Reversión» de la 027. Las cuadrículas ya creadas siguen siendo de su cliente y no afectan a nadie más.

## 2c. Aislamiento integral multiusuario 🔐 — orden único de activación (2026-10-21)

Integra las secciones 1, 2 y 2b con la multisesión (una sesión activa por cliente), los mensajes por cliente (028/029) y la política de grupos autorizados. Todo está preparado y probado **solo en local**. Cada paso requiere autorización, y si uno falla no se sigue.

> **Sustituido por la sección 2d (auditoría del 2026-10-22)**, que adelanta el despliegue y la 028 a la Parte A. Esta tabla se conserva como referencia.

| Orden | Paso | Dónde | Bloquea si… |
|---|---|---|---|
| 1 | Diagnóstico de solo lectura completo: D0–D23 y P0 | `diagnostico_rls_solo_lectura.sql`, `validacion_parte_a_solo_lectura.sql` | Ver cada bloque. Clave: **D21 = 0** (o autorizar antes esos grupos), D17 sin unicidad solo sobre `numero`, P0 todo en `true`, D23 para confirmar que las migraciones 001–026 con RLS están aplicadas |
| 2 | **Parte A** (+ V1–V6 de la validación) | sección 1 | Una política no prevista o PUBLIC con permisos (P0). Decidir antes el enlace `/conectar/<id>` (bloqueante 1) |
| 3 | Partes B1/B2, C, D y F | sección 1 | Ver la sección 1 |
| 4 | `027_tablas_cliente.sql` | sección 2b | Aborta sola sin la Parte A |
| 5 | **Desplegar juntos** backend y panel con el código de aislamiento | sección 4 | — |
| 6 | `028_mensajes_por_cliente.sql` (después del paso 5) | migraciones | Al revés, durante el intervalo las filas del bot anterior no tendrían deduplicación única |
| 7 | (Opcional, decisión del dueño) relleno del historial de chats: R1, después R2 | `relleno_cliente_mensajes.sql` | Revisar R1 antes de escribir |
| 8 | `029_rls_mensajes_por_cliente.sql` (≥ 1 h después de los pasos 5 y 6, con tráfico) | migraciones | Aborta sola sin 028, sin mensajes en la última hora o con mensajes recientes sin cliente |
| 9 | Comprobaciones con cuentas de **prueba** propias: dos clientes, cada uno con su WhatsApp, en un grupo de prueba compartido | — | Ver la lista de abajo |

**Qué cambia al desplegar el código (paso 5):**
- **Política de grupos autorizados.** Cada cliente solo actúa (historial, anuncios, reservas, pagos, worker de sorteos y expulsiones) en sus grupos de **Automatización → Autorizar grupo**. Un grupo con sorteo activo sin autorizar deja de atenderse (D21). Un grupo autorizado nuevo empieza a atenderse en ≤ 30 s.
- **Sesiones.** Sin dueño (`sesiones.usuario_id` nulo) una sesión conecta pero no procesa nada.
- **Chats del panel.** Muestran solo los mensajes con `cliente_usuario_id` del usuario. Hasta la 028 (y el relleno opcional) se ven **vacíos**: falla cerrado en lugar de mostrar los de todos.
- **Colas de grupo por sesión.** El *rate-limit* de una cuenta ya no retrasa a las demás.

**Comprobaciones del paso 9:**
1. Un mensaje del grupo compartido lo procesa cada bot por separado (una fila por cliente).
2. Una reserva en el sorteo de A no toca la cuadrícula de B.
3. Desconectar la cuenta de B no afecta a A.
4. Con su sesión, cada usuario del panel ve solo lo suyo.

**Pruebas locales:**
- `seguridad/aislamientoMensajesGrupo.test.js` (13)
- `seguridad/migracion028y029.test.js` (8, PGlite)
- `sesiones/groupQueuePorSesion.test.js` (7)
- `sesiones/multisesion.test.js` (14)
- `seguridad/multisesionDatos.test.js` (7)
- `frontend/tests/seguridad/aislamientoPanel.test.mjs` (9)
- Más las de las secciones 1 y 2b.

## 2d. Secuencia final de activación (revisión del 2026-10-21) 🔐

> **Sustituida por la sección 2e (2026-10-22)**, que incorpora el diagnóstico real de producción. Esta tabla se conserva como referencia de las comprobaciones de cada paso.

**Ninguna migración posterior a la 024 consta como aplicada por completo** (la 026 constaba aplicada a medias el 16/10; falta `loterias_catalogo_ofrecidas`). Las 022, 025, 027, 028, 029, 030 y 031 y las Partes A–F están preparadas y probadas solo en local (PGlite y dobles en memoria). Antes de empezar, confírmalo con D19, D22, D23 y D24: que exista el archivo no significa que esté aplicada.

**Reglas comunes a todos los pasos:**
- Ventana sin sorteos activos (D0 = 0).
- Guarda el resultado de las consultas `ANTES` de cada paso; son la vuelta atrás.
- Un paso por ventana.
- Si un paso falla o aborta solo, **no se sigue**: se revisa y se decide.

**Auditoría previa del 2026-10-22: este orden sustituye a los de las secciones 2b y 2c.** Diferencia principal: el despliegue va **antes** de la Parte A. Motivos:
- el enlace QR (`/conectar`) no queda cortado entre la Parte A y el despliegue;
- la Parte D exige el panel restringido ya desplegado;
- la 028 exige el bot nuevo ya desplegado.

El código nuevo funciona sin la Parte A ni la 027 (usa los 8 precios base) y sin la 028 (guarda los mensajes sin cliente).

Toda la secuencia, salvo B1/B2 y C, se ejecutó en un **Postgres 17 local** (copia de las tablas heredadas, con un dueño sin `bypassrls` como `postgres` en Supabase). Resultado: 29/29, y D0–D24, P0 y V1–V6 sin errores antes y después. No es la base real.

| # | Paso | Depende de | Comprobación previa | Comprobación posterior | Seguir si… / Abortar si… | Riesgo y vuelta atrás |
|---|---|---|---|---|---|---|
| 0 | Commit en rama, revisión y copia de seguridad | — | `git diff` revisado | Copia descargada | Seguir: copia disponible | — |
| 1 | Diagnóstico D0–D24, P0 (sustituyendo `<UUID_PRINCIPAL>`) y Logs → API. En **cada** instancia del bot: `node backend/scripts/verificarRolSupabase.js` | — | — | Resultados guardados | **Abortar si:** D0 > 0; D1 con `forzado = true` en `sesiones` o en las 2 tablas de reservas (la 027, la 030 y la 031 no verían filas); D17 con unicidad solo sobre `numero`; D21 > 0 sin decidir; P0 con algún `false`; peticiones anon distintas de `/conectar`; algún bot sin `service_role` | Solo lectura |
| 2 | `031_qr_sesion_publica.sql` | — | D24: `hay_031 = false` | D24: `hay_031 = true`. `select public.qr_sesion_publica('<id>')` devuelve solo qr, estado y expiración | **Abortar si** da error (no se crea nada) | Ninguno: la página de producción todavía no la usa. Vuelta atrás: `drop function` |
| 3 | Desplegar **juntos** backend (VPS) y panel (Vercel) con este código (secciones 3 y 4) | 1 (D21 = 0), variables de la sección 3 | `SESSIONS_API_TOKEN` en el VPS y `BOT_API_TOKEN` en Vercel, comprobadas sin mostrar valores | Logs de la sección 4, **sin** `ERROR GUARDANDO MENSAJE`. `/conectar/<id>` **sin sesión** muestra el QR. Sesiones, Tablas, Eventos y pagos como antes. Chats vacíos hasta el paso 4 (esperado) | **Abortar si:** 401/503 en el panel, mensajes sin guardar o un grupo autorizado sin atender → volver al commit anterior en los dos | Las migraciones pendientes no estorban al código anterior |
| 4 | `028_mensajes_por_cliente.sql` y, si el dueño lo decide, relleno R1 → R2 | 3 (bot nuevo escribiendo `cliente_usuario_id`) | D22: `hay_columna_cliente = false` | D22: `true`. Un mensaje del grupo compartido genera una fila por cliente | Abortar si da error | Vuelta atrás: la de la propia 028 (recrear el índice de la 021) |
| 5 | **Parte A** + validación V1–V6 | 1 (P0), 2 y 3 (para no cortar el QR) | P0 en `true` | V1–V6. Con la clave anon y sin sesión: 0 filas o permiso denegado. `/conectar/<id>` **sin sesión** sigue mostrando el QR. Panel con sesión igual. Una reserva y un pago por sticker de prueba funcionan | Aborta sola ante políticas no previstas. **Abortar** (vuelta atrás de A) si el panel deja de ver lo propio o el bot falla | Bloque `VUELTA ATRÁS` de la Parte A |
| 6 | Partes B1 → B2, C, D y F (sección 1) | 5 (D exige A). F: todos los bots con `service_role` | Las de cada archivo | Las de cada archivo. Tras D, renombrar una sesión desde el panel funciona. Tras F, la sesión sigue «Saludable» | Cada archivo aborta solo si falta algo | Vuelta atrás en orden inverso (F → D → C → B2 → B1) |
| 7 | `027_tablas_cliente.sql` | 5 validada | D19 = no aplicada. D15 guardado | D19 = aplicada. D15 idéntico. Primer acceso de la principal: `existente, existente` | Aborta sola sin la Parte A. **Abortar** si D15 cambia | Bloque «Reversión»: no toca cuadrículas |
| 8 | `029_rls_mensajes_por_cliente.sql` | 4, con ≥ 1 h de tráfico del bot nuevo | D22 | Cada usuario del panel ve solo los chats de su bot | Aborta sola sin 028, sin mensajes recientes o con mensajes sin cliente | Bloque «Reversión» de la 029 |
| 9 | `030_reinicio_tabla_seguro.sql` (cuando se quiera la opción) | Ninguna (no depende de A ni de 027) | D24: `hay_030_* = false`. Anota `sin_atribuir`, `bloqueados` y `en_proceso` | D24 `true`. Vista previa de un sorteo de prueba con «Reiniciar tabla», **sin** confirmarlo | Aborta sola si a una tabla le falta alguna columna que usa | Reinicio aplicado por error: plantilla de **recuperación** al final de la 030. Función: `drop function` |
| 10 | Comprobaciones con dos cuentas de prueba (sección 2c, paso 9) y las de la sección 5 | Todo lo anterior | — | — | **Abortar** (volver atrás el último paso) si cualquier dato de un cliente se ve desde el otro | — |

**Revisión de las funciones 030 y 031 (2026-10-22):**
- **030.**
  - La ejecuta solo `service_role`, con el usuario sacado del token. Solo se toca la tabla del cliente indicado y solo una de las 2 tablas permitidas.
  - Corregido: antes leía los sorteos activos **antes** de bloquear las filas. Un sorteo reactivado justo en ese momento perdía sus reservas: reproducido en Postgres 17 local con dos sesiones simultáneas.
  - Ahora bloquea las filas del cliente, después `eventos_bot` en modo SHARE (máximo 5 s; si no lo consigue, error y nada cambia) y solo entonces lee los sorteos.
  - Un sorteo con `activo` nulo, o activo sin tabla registrada, protege sus reservas.
  - Dos reinicios simultáneos: solo uno aplica. Una reserva concurrente provoca `tabla_cambio`.
  - Coste: mientras dura (milisegundos), las **escrituras** en `eventos_bot` de todos los clientes esperan.
- **031.**
  - Sin la `id`, no devuelve nada. No lista sesiones, no expone teléfono ni dueño y no escribe.
  - Quien tenga el enlace ve el QR, igual que hoy (hoy anon puede leer toda la tabla).
  - Con `FORCE ROW LEVEL SECURITY` en `sesiones` devolvería `null`: lo controla D1 en el paso 1.
- **Bot y 028 (corregido).** Antes de la 028, el bot nuevo intentaba guardar `cliente_usuario_id` y solo reintentaba sin ella ante el error `42703`. PostgREST responde `PGRST204` a una columna desconocida en un INSERT, así que todos los mensajes de grupo habrían fallado entre los pasos 3 y 4. Ahora reintenta ante cualquier error que nombre esa columna (salvo duplicado).

**Qué cambia en los sorteos programados con este código (al desplegar el paso 5):**
- **Fecha del sorteo.** Se puede programar la víspera: la publicación es en su día y el cierre automático, en la fecha y hora del sorteo **en Colombia**.
  - El cierre por hora ya no usa la hora local del servidor (antes, en un VPS en UTC, cerraba 5 h antes).
  - Los sorteos existentes sin `fecha_sorteo` usan el día de publicación, como antes.
- **Estilo.** Se guarda en el sorteo y la imagen de WhatsApp lo lee de ese sorteo (el token de impresión firma el evento).
  - Publicar **ya no cambia** el diseño global de la tabla del precio.
  - Un evento sin sorteo programado usa el diseño de la tabla, como antes.
- **Cuentas de pago.** Son obligatorias (al menos una, propia y activa) y pueden crearse desde el formulario.
- **Reinicio.** Por defecto se elige «Conservar tabla». Reiniciar requiere la 030, elegirlo y confirmarlo en la vista previa con la misma huella.

## 2e. Aislamiento multicliente — orden definitivo (2026-10-22) 🔐

**La Parte A sigue BLOQUEADA** hasta cumplir todas las condiciones de la tabla «Condiciones de la Parte A». Este orden sustituye a los de las secciones 2b, 2c y 2d.

### Estado real de producción (22/10, catálogo + API)

- **Reservas.** `reservas_dos_cifras` y `5k_15k_reservas_2_cifras`:
  - sin RLS, con `UNIQUE(numero)` y con políticas públicas antiguas abiertas;
  - anon lee sus 100 + 100 filas.
- **Pagos.** El trigger heredado `actualizar_compradores_semanales()` escribe en `compradores_semanales` al pagar:
  - esa tabla no tiene columna de cliente;
  - anon lee sus 1930 filas.
- **Funciones.** Hay 4 funciones SECURITY DEFINER ejecutables desde el navegador.
- **Sesión huérfana.** 1 sesión pertenece a una cuenta que ya no existe (`8b31d700…`, desconectada).
- **Migraciones presentes:**

  | Migración | Qué hay en producción |
  |---|---|
  | 022 | Tablas presentes |
  | 028 | Columna `cliente_usuario_id` presente |
  | 030 | `reservas_archivo` y `reiniciar_tabla_cliente` presentes |
  | 031 | `qr_sesion_publica` presente |
  | 027 | Ausente |
  | 026 | Sigue a medias (falta `loterias_catalogo_ofrecidas`) |
  | 001 | Ausente: no existe `configuracion_mensajes`, aunque el panel la usa |

  **Que un objeto exista no prueba que su migración esté completa ni que sea la versión local.** Antes de seguir hay que comparar:
  - la 030 de producción con la local, que es la versión corregida (bloquea las filas antes de leer `eventos_bot`). Bloque `D16_D19_D22_D24_migraciones`, campo `030_version_con_lock_share`;
  - las ACL de la 031 y la 030, en `R10_D10_funciones`.
- **0 sorteos activos.** D21 = 0.

### Archivos nuevos o revisados (todos probados en local, ninguno aplicado)

| Archivo | Qué hace |
|---|---|
| `limpieza_sesion_huerfana.sql` | Archiva (`efaat_admin.sesiones_archivadas`) y borra la sesión de la cuenta inexistente. Aborta si no es exactamente esa, si está activa o conectada, o si tiene sorteos o reservas |
| `propuesta_rls_tablas_antiguas.sql` (**Parte A revisada**) | Ver detalle debajo de esta tabla |
| `033_cuadricula_por_cliente.sql` | Cambia `UNIQUE(numero)` por `UNIQUE(usuario_id, numero)`. No toca filas. Aborta ante filas sin dueño, duplicados dentro de un cliente, claves foráneas dependientes o una clave primaria solo sobre `numero` |
| `027_tablas_cliente.sql` | Guardia nueva: aborta si queda una unicidad sin `usuario_id` (exige la 033) |
| `parte_b_compradores_semanales.sql` | Sin cambios. B2 pasa la función del trigger a SECURITY DEFINER y cierra la tabla al navegador |
| `034_compradores_por_cliente.sql` | Ver detalle debajo de esta tabla |
| `parte_g_funciones_definer.sql` | Ver detalle debajo de esta tabla |
| `035_rls_tablas_cliente.sql` | Ver detalle debajo de esta tabla |

**Parte A revisada:**
- Elimina las políticas abiertas y guarda su definición en `efaat_admin.cambios_seguridad`.
- Aborta ante cualquier otra política que no conozca.
- Quita todo a anon y a PUBLIC.
- Conserva (y concede explícitamente si venían de PUBLIC) los permisos de authenticated y service_role.
- Aborta si hay filas sin dueño o de cuentas inexistentes.

**034 (`compradores_semanales` por cliente):**
- Añade `usuario_id`.
- Cada compra nueva se marca con el cliente de la reserva pagada, sin tocar el código heredado ni desactivar el trigger.
- Si una misma sentencia toca filas de dos clientes, la compra queda sin cliente («mixto»).
- RLS sin políticas.
- Exige la B2.
- Las filas históricas quedan sin dueño.

**Parte G (funciones SECURITY DEFINER):**
- Todas pasan a solo `service_role`, salvo `qr_sesion_publica`.
- Aborta si una función ejecutable desde el navegador depende de alguna de ellas.
- Incluye la Parte F.

**035 (red de seguridad RLS en las tablas de cliente):**
- Revisa en el catálogo cada tabla con `usuario_id`.
- Activa la RLS donde falte y elimina las políticas sin condición.
- Crea las políticas «propietario» solo para lo que el panel hace en esa tabla.
- Respeta los mensajes globales (`usuario_id` nulo) de `automation_messages`.
- Cierra `usuarios` y `grupos` (globales, solo backend).
- Aborta si una tabla del panel tiene filas sin dueño.

**Registro común:** todas las piezas anotan lo que eliminan o conceden en `efaat_admin.cambios_seguridad`. Ese esquema no está expuesto por la API.

### Orden

Reglas: ventana sin sorteos activos (D0 = 0), un paso por ventana. Si un paso aborta, **no se sigue**.

| # | Paso | Requisito previo | Validación posterior | Reversión segura |
|---|---|---|---|---|
| 0 | Commit en rama, revisión y copia de seguridad de la base | — | Copia descargada | — |
| 1 | En **cada** bot (VPS y LOCAL): `node backend/scripts/verificarRolSupabase.js` = `service_role`. Logs → API: ninguna llamada anon salvo `/conectar` y `rpc/qr_sesion_publica` | — | — | Solo lectura |
| 2 | Confirmar que la 030 y la 031 de producción coinciden con las locales (`030_version_con_lock_share = true`). Si no, reaplicar la 030 local 🔐 | 1 | D24 | La de la 030 |
| 3 | Desplegar **juntos** backend y panel con este código (secciones 3 y 4) | 1 | `/conectar/<id>` sin sesión muestra el QR (usa la 031). Panel y bot como antes | Commit anterior en los dos |
| 4 | `limpieza_sesion_huerfana.sql` (sustituir `<ID_SESION>`) | 3 | La consulta previa devuelve 0 filas | Bloque «Reversión» del archivo |
| 5 | **Parte A** | 4, condiciones de abajo | V1–V6 (`validacion_parte_a_solo_lectura.sql`), V3 = `027_podria_pasar` salvo por la unicidad (paso 6). Anon: permiso denegado en las 4 tablas. Panel con sesión: igual. Una reserva, un pago desde el panel y uno por sticker de prueba | Desactivar la RLS de las 4 tablas (bloque del archivo). **Nunca** devolver permisos a anon |
| 6 | `033_cuadricula_por_cliente.sql` | 5 | Solo `UNIQUE (usuario_id, numero)` en las 2 tablas. D15/R13 idénticos | Bloque «Reversión» (solo si ningún otro cliente tiene cuadrícula) |
| 7 | `027_tablas_cliente.sql` | 5 y 6 | D19 aplicada. Primer acceso de la principal: `existente, existente`. Una cuenta de prueba recibe `creada, creada` | Bloque «Reversión» de la 027 |
| 8 | Parte B (B1 y B2) | 5 | Pago desde el panel y por sticker. Anon sin acceso a `compradores_semanales` | Bloques de vuelta atrás B2 → B1 |
| 9 | `034_compradores_por_cliente.sql` | 8 | Un pago de prueba crea o actualiza la fila de compradores; las nuevas, con `usuario_id` | Bloque «Reversión» de la 034 |
| 10 | Parte G (incluye F) | 1 y 9 | El bot conecta y renueva el lease. `/conectar` sin sesión muestra el QR. Pagos como en el paso 9 | Conceder de nuevo solo la función que alguien legítimo necesite (ACL previa en `efaat_admin.cambios_seguridad`) |
| 11 | `035_rls_tablas_cliente.sql` | 5 | Con dos cuentas: Automatización, Mensajes, Plantillas, Variables, Diseños, Stickers y Grupos autorizados, cada una solo lo suyo (más los mensajes globales) | Desactivar la RLS solo de la tabla afectada si estaba desactivada antes (`estado_previo`) |
| 12 | Partes C y D; 028 (relleno opcional) y 029 si no están completas (D22) | 5 | Las de cada archivo | Las de cada archivo |
| 13 | Prueba con dos cuentas reales (A con datos, B nueva) | Todo | B no ve nada de A en Tablas, Eventos, Sesiones, Chats ni Contactos; B tiene su cuadrícula con los mismos números; los pagos de cada uno solo cambian lo suyo | Volver atrás el último paso |

### Condiciones de la Parte A (todas obligatorias)

1. La sesión huérfana está archivada (paso 4). Si no, la Parte A aborta sola.
2. Todos los bots usan `service_role` (paso 1).
3. Logs → API no muestra escritores anon externos.
4. El panel desplegado usa `qr_sesion_publica` (paso 3) y `/conectar` funciona sin sesión.
5. Sin RLS forzada en las 4 tablas y sin políticas desconocidas. Si existieran, la Parte A aborta sola.
6. 0 sorteos activos.

### Lo que sigue pendiente aunque todo se aplique

- **Contadores de `compradores_semanales`.** Son por teléfono. Si un mismo comprador paga a dos clientes, la función heredada actualiza la misma fila; queda un WARNING sin datos personales, pero nadie puede leer esa fila desde el navegador. Separarlos por cliente exige reescribir `actualizar_compradores_semanales()`, y su código no está en el repositorio.
- **`configuracion_mensajes`** no existe en producción (falta la 001): esa pantalla del panel falla hoy, con o sin aislamiento.

### Pruebas

`seguridad/aislamientoMulticliente.test.js` (PGlite, 21) aplica los archivos reales en este orden sobre una base que reproduce producción:
- `UNIQUE(numero)`, políticas públicas abiertas, trigger de pago heredado en modo invoker, funciones definer abiertas y la sesión huérfana;
- dos clientes.

Más las de las secciones 1, 2b y 2c.

## 3. Variables de entorno (en **cada** instancia: VPS y LOCAL)

| Dónde | Variable | Para qué | Si falta |
|---|---|---|---|
| backend | `SESSIONS_API_TOKEN` | Token entre el panel y el backend (`/sorteos`, `/sessions`, `/contactos`, `/bloqueados`, `/tablas/compartir`) | Esas rutas responden **503** (falla cerrado): el panel no puede manejar sesiones |
| backend | `INACTIVIDAD_MODO=simulacion` | Control de 15 días sin expulsar | Por defecto ya es simulación |
| backend | (NO definir) `INACTIVIDAD_CONFIRMAR_EXPULSIONES` | — | — |
| panel | `BOT_API_TOKEN` (= `SESSIONS_API_TOKEN`) | Lo envían los proxies | Esas mismas rutas responden 401 |
| panel | `BOT_API_URL` | Dirección del backend | Se usa `http://127.0.0.1:4000` |

En local existen las tres primeras; **en el servidor no lo he podido comprobar**. Verifícalo así, sin mostrar valores:

```bash
grep -c '^SESSIONS_API_TOKEN=.\+' backend/.env    # debe dar 1
pm2 env <APP> | grep -c SESSIONS_API_TOKEN        # si PM2 la inyecta
```

## 4. Despliegue 🔐

1. Backend: `git pull` → `pm2 restart <APP> --update-env`.
2. Panel: compilar (`npm run build`, ya verificado en local) y reiniciar el proceso del panel.
3. En los logs, en este orden:
   - `Worker de eventos iniciado`;
   - `[SCHEDULER] iniciado`;
   - `[INACTIVIDAD] worker iniciado … (modo simulacion…)`;
   - sin errores de `[SORTEOS PROGRAMADOS]`.

## 5. Comprobaciones posteriores

- **Sesiones:** en `/sesiones`, cada tarjeta muestra el estado real: Saludable · escuchando, Conectada a WhatsApp (en espera), Conectando, Degradada (con causa y acción), Desconectada o Conflicto de lease. También muestra la hora de conexión, la del último mensaje y la del último procesado OK.
  - Prueba controlada (en una ventana sin sorteos): `pm2 restart <APP>`. La sesión debe volver sola a «Saludable» en ≤ 30 s, sin pulsar Reconectar.
  - Logs esperados: `🛑 [APAGADO] SIGINT: soltando 1 lease(s)` y, al arrancar, `🟢 [LEASE] adquirido`.
- **Mensajes automáticos:** las plantillas con `{loteria}`, `{evento}` o `{fecha}` (o `{{...}}`) ya no se bloquean por «variables sin resolver».
- **Pagos de clientes solo LID:** fallan hasta aplicar **B1** (`parte_b_compradores_semanales.sql`). El log ya lo dice explícitamente («Pago NO guardado: … solo LID»). Tras B1, el siguiente pago de un cliente solo LID debe quedar `pagado`.

- **Cierre:** en el siguiente sorteo, los 3 grupos deben mostrar los **mismos** contadores (antes eran distintos: 27/30/32 pagados en el sorteo de hoy). Al pagar el último número, los grupos se cierran en ≤ 30 s. Con la migración 023, cada grupo muestra `cierre_estado = 'cerrado'`.
- **Panel → Eventos → Crear sorteo** (o **Sorteos programados → Nuevo sorteo**): crea un borrador de prueba en un grupo de pruebas, revisa la vista previa y **cancélalo** sin confirmarlo.
- **Inactividad:** sigue el runbook `docs/inactividad/RUNBOOK_022.md`.

## Vuelta atrás general

- **Código:** volver al commit anterior y `pm2 restart <APP> --update-env`. Las migraciones 023 y 024 no estorban al código anterior (solo añaden columnas y tablas).
- **Cierre automático:** el código anterior seguía cerrando por hora; volver atrás no deja ningún sorteo abierto para siempre.
