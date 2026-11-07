# Navegación y rutas del panel

Inventario F1-C, 06/11/2026. Solo describe: no cambia ninguna ruta ni ningún texto.

## Cómo se protegen las rutas

- No hay `middleware.ts` en Next. Las pantallas privadas se envuelven en `components/layout/DashboardLayout`, que usa `useSesion` y redirige a `/login` si no hay sesión de Supabase. La protección está **en el navegador**; la seguridad real de los datos depende de RLS y del backend.
- Las rutas `app/api/*` hacen de proxy hacia el backend con el token del usuario y el `BOT_API_TOKEN` del servidor.

## Navegación principal (`components/layout/Sidebar/Sidebar.tsx`, constante `NAV`)

| Sección | Etiqueta | Ruta |
|---|---|---|
| Operación | Sesiones | `/sesiones` |
| Operación | Reservas | `/tablas` |
| Comunicación | Mensajes | `/mensajes` |
| Comunicación | Variables globales | `/variables-globales` |
| Comunicación | Contactos | `/contactos` |
| Sorteos | Eventos | `/eventos` |
| Sorteos | Programados | `/sorteos` |
| Sorteos | Publicar ahora | `/sorteo-instantaneo` |
| Sorteos | Calendario de loterías | `/loterias` |
| Control | Automatización | `/automatizacion` |
| Control | Lector de pagos | `/lector-pagos` — **oculta en el menú** (07/11/2026) |
| Control | Bloqueados | `/bloqueados` — **oculta en el menú** (07/11/2026) |

Las entradas marcadas con `funcionalidad` en `NAV` se dibujan solo si `lib/visibilidad/funcionalidades.ts` las tiene visibles; sus rutas siguen abriéndose por dirección. Registro: [../FEATURE_VISIBILITY_REGISTER.md](../FEATURE_VISIBILITY_REGISTER.md).

## Navegaciones secundarias

| Componente | Pestañas |
|---|---|
| `components/automatizacion/AutomatizacionNav` | Resumen `/automatizacion` · Grupos `/automatizacion/grupos` · Mensajes `/automatizacion/mensajes` · Centro de control `/automatizacion/programacion` |
| `components/cuenta/CuentaNav` | Mi perfil `/mi-cuenta` · Mi suscripción `/mi-cuenta/suscripcion` · Mis grupos `/mi-cuenta/grupos` · Pagos y renovaciones `/mi-cuenta/pagos` · Ayuda y soporte `/mi-cuenta/ayuda` |

## Todas las páginas (`frontend/app/**/page.tsx`)

| Ruta | Acceso | En la navegación | Nota |
|---|---|---|---|
| `/` | pública | — | landing |
| `/login`, `/register`, `/recuperar-contrasena`, `/restablecer-contrasena` | pública | — | autenticación |
| `/aprende`, `/aprende/[slug]` | privada | enlaces desde artículos y ayuda | centro de aprendizaje |
| `/conectar/[id]` | pública por enlace | — | QR de una sesión (RPC `qr_sesion_publica`, 031) |
| `/dashboard` | — | — | redirige a `/sesiones` |
| `/sesiones` … `/bloqueados` | privada | barra lateral | ver tabla anterior |
| `/tablas/[precio]` | privada | desde `/tablas` | tabla de un precio |
| `/tablas/imprimir/[precio]` | privada | desde la tabla | vista de impresión; la usa la captura de imagen |
| `/automatizacion/grupos/[grupoId]` | privada | desde Grupos | configuración de un grupo |
| `/mi-cuenta/*` | privada | `CuentaNav` | — |
| `/chats` | privada | **no** (solo por URL) | lectura de mensajes por grupo; sustituida por Contactos |
| `/analitica-privada` | privada, con verificación propia | **no** | analítica interna |
| `/ui-preview` | sin protección | **no** | vista previa con datos fijos (candidato, ver código muerto) |

## Rutas API del panel (`frontend/app/api`)

| Grupo | Rutas |
|---|---|
| `sessions` | `active`, `backfill-contactos`, `connect`, `disconnect`, `eliminar`, `estado-backfill-contactos`, `grupos-disponibles`, `preferred`, `salud`, `status` |
| `tablas` | `compartir` (+ `destinos`, `mensaje`, `operaciones`, `vista-previa`), `contactos`, `imprimir`, `inicializar`, `lote`, `numero`, `preparar` |
| `sorteos` | `[[...ruta]]` (proxy con lista blanca hacia `/sorteos`) |
| `contactos` | raíz, `perfil`, `telefono` |
| `bloqueados` | raíz, `contacto`, `desbloquear`, `expulsiones`, `reintentar` |
| `analitica-privada` | `[...ruta]` |
| `e` | recolección de analítica |

Los endpoints del backend a los que llegan están en [../arquitectura/MAPA_ACTUAL.md](../arquitectura/MAPA_ACTUAL.md).
