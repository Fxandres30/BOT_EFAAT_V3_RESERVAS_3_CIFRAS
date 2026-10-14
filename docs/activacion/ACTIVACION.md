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
- **`reservas_dos_cifras`** conservaba datos de un sorteo ya cerrado (68 pagados y 17 reservados) más 1 reserva con otra identidad.
  - Ninguna fila de `eventos_bot` apunta ya a ese sorteo: las reservas quedaron huérfanas.
  - El próximo sorteo de ≤ $2.000 solo tendría 14 números libres, y el panel de sorteos programados lo bloquearía.
  - Requiere que **decidas** si reinicias esa tabla desde el panel (🔐).
- **Clientes:** 2 con sesiones (uno con todos los datos y otro con 1 sesión desconectada y sin datos).
  - Ninguna fila tiene `usuario_id` nulo.
  - Cada tabla física tiene exactamente una cuadrícula completa (100 números únicos) del cliente principal.

## 0. Antes de empezar

1. Revisa el diff y haz el commit en una rama (🔐).
2. Ventana: después del cierre del sorteo activo y antes del siguiente anuncio.
3. Copia de seguridad lógica desde Supabase (Database → Backups) o, como mínimo, guarda el resultado de las consultas de políticas de `propuesta_rls_tablas_antiguas.sql`.

## 1. Seguridad urgente (independiente del resto) 🔐

1. Ejecuta las consultas de solo lectura del encabezado de `propuesta_rls_tablas_antiguas.sql`: `usuario_id` nulos (deben ser 0) y políticas actuales.
2. Si hay políticas permisivas abiertas, añádelas al bloque como `drop policy`.
3. Aplica la **Parte A** (una sola transacción).
4. Comprobación posterior:
   - con la clave anon y sin sesión, las 4 tablas deben responder 0 filas o permiso denegado;
   - con tu sesión, **Tablas**, **Eventos** y **Sesiones** deben verse igual que antes;
   - un pago desde el panel debe seguir funcionando.
5. Vuelta atrás: el bloque `VUELTA ATRÁS` del mismo archivo.
6. **Parte B** (`compradores_semanales`): no aplicar hasta revisar la definición del trigger (consulta incluida en el archivo).
7. **Rutas proxy del panel sin autenticación** (`/api/sessions/*`, `/api/contactos*`, `/api/bloqueados*`, `/api/tablas/compartir`): requieren un cambio de código que **no está hecho**. Ver «Decisiones» en el informe.

## 2. Migraciones (en este orden) 🔐

Compatibilidad verificada con el esquema real: ninguna de sus tablas o columnas existe todavía, y todas sus dependencias sí (`eventos_bot`, `usuarios`, `grupos`, `grupos_autorizados`, `automation_actions`, `reservas_actividad`).

| Orden | Archivo | Qué hace | Verificación posterior | Vuelta atrás |
|---|---|---|---|---|
| 1 | `022_control_inactividad_miembros.sql` | Control de 15 días (en simulación) + trigger de compras en las 2 tablas de reservas | `docs/inactividad/022_verificacion.sql` | Bloque `REVERSIÓN` (primero quitar los triggers) |
| 2 | `023_estado_cierre_por_grupo.sql` | 6 columnas opcionales de cierre en `eventos_bot` | Consulta de verificación del archivo | Bloque de reversión del archivo |
| 3 | `024_sorteos_programados.sql` | Cuentas, plantillas, sorteos programados y su estado por grupo, con RLS | Consulta de verificación del archivo | `drop table` del archivo (no toca eventos ni reservas) |

Las tres son idempotentes y no modifican datos existentes. Están probadas en Postgres real en memoria:
- `migracion022.test.js`: 15/15;
- `migraciones023y024.test.js`: 6/6.

Si una falla a mitad de camino, la transacción del SQL Editor se revierte entera. Revisa el error y no continúes con la siguiente.

## 3. Variables de entorno (en **cada** instancia: VPS y LOCAL)

| Dónde | Variable | Para qué | Si falta |
|---|---|---|---|
| backend | `SESSIONS_API_TOKEN` | Token entre el panel y el backend (rutas `/sorteos`) | `/sorteos/*` responde **503** (falla cerrado) |
| backend | `INACTIVIDAD_MODO=simulacion` | Control de 15 días sin expulsar | Por defecto ya es simulación |
| backend | (NO definir) `INACTIVIDAD_CONFIRMAR_EXPULSIONES` | — | — |
| panel | `BOT_API_TOKEN` (= `SESSIONS_API_TOKEN`) | Lo envían los proxies | Las rutas `/sorteos` responden 401 |
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

- **Cierre:** en el siguiente sorteo, los 3 grupos deben mostrar los **mismos** contadores (antes eran distintos: 27/30/32 pagados en el sorteo de hoy). Al pagar el último número, los grupos se cierran en ≤ 30 s. Con la migración 023, cada grupo muestra `cierre_estado = 'cerrado'`.
- **Panel → Sorteos programados:** la página carga; crea un borrador de prueba en un grupo de pruebas, revisa la vista previa y **cancélalo** sin confirmarlo.
- **Inactividad:** sigue el runbook `docs/inactividad/RUNBOOK_022.md`.

## Vuelta atrás general

- **Código:** volver al commit anterior y `pm2 restart <APP> --update-env`. Las migraciones 023 y 024 no estorban al código anterior (solo añaden columnas y tablas).
- **Cierre automático:** el código anterior seguía cerrando por hora; volver atrás no deja ningún sorteo abierto para siempre.
