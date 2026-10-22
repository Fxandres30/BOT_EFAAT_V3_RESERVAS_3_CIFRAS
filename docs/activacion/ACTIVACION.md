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
- **Bloqueante 1: el enlace «Compartir» del QR** (`/conectar/<id>`) lee `sesiones` con la clave anon. Tras la Parte A deja de funcionar para quien no haya iniciado sesión como dueño. Decide antes si se acepta o se sustituye por un enlace firmado servido por el backend.
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
| 4 | Desplegar **juntos** backend y panel con este código | — |
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
