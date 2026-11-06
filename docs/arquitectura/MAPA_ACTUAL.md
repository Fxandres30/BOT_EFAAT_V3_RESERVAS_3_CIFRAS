# Mapa de arquitectura actual

Inventario F1-C, 06/11/2026, sobre `main` en `97975555` con los cambios locales de F1-A y F1-B (sin commit). Es solo descripción: no cambia nada.

## Piezas y dónde corren

| Pieza | Carpeta | Dónde corre | Cómo se despliega |
|---|---|---|---|
| Panel (Next.js) | `frontend/` | Vercel | `git push` a `main` = despliegue automático |
| Backend + bot de WhatsApp (Express + Baileys) | `backend/` | Droplet (PM2, puerto 4000) | manual: `git pull` + reinicio de PM2 (requiere autorización) |
| Base de datos | Supabase (proyecto compartido con otras apps) | — | migraciones a mano en el SQL Editor (`backend/supabase_migrations/`) |
| Lector de pagos Android | `android/` | dispositivo | — (1 dispositivo registrado, sin uso) |

## Flujo de una petición del panel

```
Navegador ──► Next (frontend/app/api/*/route.ts, proxy con token del usuario)
                 │  BOT_API_TOKEN (Vercel)
                 ▼
          Backend Express (backend/server.js :4000)
                 │  middleware/autenticacionUsuario.js (token Supabase) · tokenServicio.js
                 ▼
          routes/*.js ──► services/ · sorteos/ · bot/funciones/ ──► lib/supabase.js (service_role)
```

El navegador **también** escribe directamente en 13 tablas de Supabase con la clave anon y RLS (ver [DUPLICACIONES_PENDIENTES.md](DUPLICACIONES_PENDIENTES.md), D9).

## Endpoints del backend (`backend/routes/`)

| Ruta base | Archivo | Endpoints |
|---|---|---|
| `/sessions` | `sessions.js` | connect, disconnect, status, salud, active (GET/POST), preferred, escáner y diagnóstico de la sesión activa, backfill de contactos, grupos disponibles, CRUD de sesiones, QR, reconnect |
| `/tablas` | `tablas.js` | imprimir-datos, compartir (vista previa, mensaje, destinos, operaciones, cancelar, compartir manual), inicializar, preparar, contactos/buscar, número (leer, reservar, pagar, liberar), lote |
| `/sorteos` | `sorteos.js` | grupos, loterías (CRUD, restaurar, horario), plantillas, estilos de mensaje, generar mensaje, cuentas, eventos y acciones, activos (leer, editar, vincular), programados (CRUD, vista previa, confirmar, publicar ahora, imagen de prueba, detalle, cancelar, eliminar, archivar, grupos) |
| `/contactos` | `contactos.js` | listar, perfil, vincular teléfono |
| `/bloqueados` | `bloqueados.js` | listar, por contacto, bloquear, expulsiones, reintentar, desbloquear |
| `/pagos` | `pagos.js` | movimientos (POST del dispositivo, GET) |
| `/analitica` | `analitica.js` | recolectar, verificar, resumen, activos, historial, sesión |

## Procesos periódicos (por sesión activa, arrancados en `backend/bot/index.js`)

| Proceso | Archivo | Qué hace |
|---|---|---|
| Worker de eventos | `bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js` → `workers/workerEventos.js` | cierre por hora, pendientes de eventos detectados |
| Scheduler de automatización | `automation/scheduler.js` | tabla inicial, recordatorios, actualización, cierre de grupos |
| Publicador de sorteos | `sorteos/publicador.js` | publicar programados, recordatorios y aviso de cierre del sorteo, vencimiento de reservas, recuperación de atascados |
| Inactividad (15 días) | `bot/funciones/inactividad/workerInactividad.js` | simulación por defecto |
| Expulsión de bloqueados | `bot/funciones/bloqueo/workerExpulsiones.js` | desactivado si `BLOQUEO_EXPULSION_MODO` no está definido |
| Escáner de identidades | `bot/funciones/usuarios/escanerIdentidadesLifecycle.js` | escaneo inicial y periódico |
| Vigilante de salud | `bot/index.js` | recuperación de la sesión |
| Lease de sesión | `services/baileys/lease.js` | exclusión entre procesos |
| Retención de analítica | `analitica/retencion.js` | limpieza de datos de analítica |

Dos motores mandan recordatorios (scheduler y publicador); `automation/prioridadComunicaciones.js` decide cuál tiene prioridad.

## Capas del backend

| Carpeta | Papel |
|---|---|
| `bot/events`, `bot/handlers`, `bot/middleware` | entrada de mensajes de WhatsApp y su contexto |
| `bot/funciones/*` | reglas del bot por dominio: eventos, reservas, pagos, consultas, grupos, usuarios, bloqueo, inactividad, cobros, admins, mensajes |
| `bot/ai` | plantillas y textos de respuesta |
| `automation/` | motor de automatización: reglas puras, motor de eventos, scheduler, guard de idempotencia |
| `sorteos/` | sorteos del panel: validar, programar, publicar, administrar, loterías, mensajes |
| `services/` | servicios usados por las rutas: reserva manual, compartir tabla, Baileys |
| `shared/` | código puro compartido: tiempo, eventos, pagos, variables |
| `pagos/` | lector Android (dispositivos y movimientos) |
| `analitica/` | analítica privada |
| `diagnostico/` | herramientas de diagnóstico (solo observan) |
| `scripts/` | utilidades; `guardaProduccion.js` protege los scripts `_*.js` |
| `tests/` | pruebas (`npm test`, ver [../pruebas/LINEA_BASE.md](../pruebas/LINEA_BASE.md)) |

## Panel

Ver [../frontend/NAVEGACION_Y_RUTAS.md](../frontend/NAVEGACION_Y_RUTAS.md), [../frontend/INVENTARIO_VISUAL.md](../frontend/INVENTARIO_VISUAL.md) y [../frontend/COMPONENTES_UI.md](../frontend/COMPONENTES_UI.md).
