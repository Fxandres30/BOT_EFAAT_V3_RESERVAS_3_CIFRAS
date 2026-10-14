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

| Orden | Archivo / bloque | Qué hace | Riesgo |
|---|---|---|---|
| 1 | `propuesta_rls_tablas_antiguas.sql` (Parte A) | RLS «solo lo propio» en reservas ×2, `eventos_bot`, `sesiones`; anon sin acceso | Si existe una política no prevista, **aborta sola** y la nombra. Si una app externa escribe con anon en reservas, deja de poder hacerlo (ver `reservas_otro_sorteo.md`) |
| 2 | `parte_b_compradores_semanales.sql` → **B1** | Pagos de clientes solo LID se guardan; no se suman a `compradores_semanales` | Mínimo: solo omite inserciones que hoy fallan |
| 3 | `parte_b_compradores_semanales.sql` → **B2** | La función heredada pasa a `SECURITY DEFINER`; anon y authenticated pierden `compradores_semanales` | Aborta sola si no hay exactamente 1 función heredada o su dueño no tiene permisos |
| 4 | `parte_c_tablas_legado.sql` → C1 (y C2 opcional) | anon pierde ~24 tablas heredadas y 4 RPC heredadas | Rompe cualquier app **externa** que las use con la clave anon |

1. Ejecuta las consultas `ANTES` de cada archivo (solo lectura) y **guarda su resultado**: es la vuelta atrás exacta.
2. Aplica en el orden de la tabla.
3. Comprobación posterior:
   - con la clave anon y sin sesión, las tablas afectadas deben responder 0 filas o permiso denegado;
   - con tu sesión, **Tablas**, **Eventos** y **Sesiones** deben verse igual que antes;
   - un pago desde el panel (número de prueba) y uno por sticker deben seguir funcionando.
4. Vuelta atrás: el bloque `VUELTA ATRÁS` de cada archivo, en orden inverso (C → B2 → B1 → A).
5. Pruebas en Postgres real en memoria: `propuestaRls.test.js` (8/8) y `parteBCompradores.test.js` (10/10).
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

La 022 es independiente de las Partes A/B/C. Su trigger es `SECURITY DEFINER` y atrapa sus propios errores, así que nunca bloquea un pago. Puede aplicarse antes o después de ellas, pero **en otra ventana**: así, si algo falla, sabrás cuál fue.

Las tres son idempotentes y no modifican datos existentes. Están probadas en Postgres real en memoria:
- `migracion022.test.js`: 15/15;
- `migraciones023y024.test.js`: 6/6.

Si una falla a mitad de camino, la transacción del SQL Editor se revierte entera. Revisa el error y no continúes con la siguiente.

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
