# Inventario visual del panel

Inventario F1-C, 06/11/2026. Describe qué hay; **no propone ningún rediseño** (los cambios visuales necesitan autorización aparte). Tamaños medidos sobre los `.tsx` de `frontend/components`.

## Pantallas y componente principal

| Ruta | Componente principal |
|---|---|
| `/` | `landing/Landing` |
| `/login`, `/register`, `/recuperar-contrasena`, `/restablecer-contrasena` | `auth/*Form` |
| `/sesiones` | `sessions/SessionsPage` |
| `/tablas` | `tablas/IndiceTablas` (tarjetas por precio) |
| `/tablas/[precio]` | `tablas/TablaPrecioView` |
| `/tablas/imprimir/[precio]` | `tablas/TablaImprimible` |
| `/mensajes` | `mensajes/MensajesPage` |
| `/variables-globales` | `variables/VariablesGlobalesPage` |
| `/contactos` | `contactos/ContactosPage` |
| `/chats` | `chats/ChatsPage` |
| `/eventos` | `eventos/EventosPage` |
| `/sorteos` | `sorteos/SorteosPage` |
| `/sorteo-instantaneo` | `sorteos/SorteoInstantaneoPage` |
| `/loterias` | `loterias/CalendarioLoteriasPage` |
| `/automatizacion` y subrutas | `automatizacion/ResumenAutomatizacion`, `GruposAutomatizacion`, `ConfiguracionGrupo`, `CentroMensajes`, `CentroAutomatizaciones` |
| `/lector-pagos` | `pagos/LectorPagosPage` |
| `/bloqueados` | `bloqueados/BloqueadosPage` |
| `/mi-cuenta/*` | `cuenta/MiPerfil`, `MiSuscripcion`, `MisGrupos`, `PagosRenovaciones`, `AyudaSoporte` |
| `/aprende/*` | `aprende/CentroAprendizaje`, `ArticuloAprende` |
| `/conectar/[id]` | la propia página (306 líneas, sin componente aparte) |
| `/analitica-privada` | `app/analitica-privada/_componentes/PanelAnalitica` |
| `/ui-preview` | `tablas/TarjetaPrecio`, `tablas/StatsBar` con datos fijos |

## Tamaño por área

| Carpeta | Archivos `.tsx` | Líneas |
|---|---|---|
| `tablas` | 28 | 6.228 |
| `automatizacion` | 25 | 5.479 |
| `sorteos` | 14 | 3.229 |
| `mensajes` | 7 | 2.162 |
| `landing` | 3 | 1.417 |
| `ui` (componentes base) | 17 | 1.016 |
| `contactos` | 2 | 911 |
| `sessions` | 8 | 900 |
| `eventos` | 8 | 788 |
| `cuenta` | 7 | 742 |
| `auth` | 6 | 740 |
| `variables` | 1 | 652 |
| `bloqueados` | 2 | 610 |
| `layout` | 3 | 478 |
| `loterias` | 1 | 468 |
| `aprende` | 5 | 402 |
| `activadores` | 1 | 385 |
| `pagos` | 2 | 252 |
| `chats` | 1 | 171 |
| `dashboard` | 1 | 126 (sin uso) |

Total: 180 archivos `.tsx` en `app` y `components` y 68 módulos CSS. Los estilos mezclan Tailwind (`globals.css`, clases en línea) y CSS Modules.

## Rasgos visuales que conviven hoy

- **Rediseño parcial:** el rediseño global está en `0e183066` y las tarjetas de Reservas tienen su propio estilo. Lo que no se rediseñó conserva el aspecto anterior.
- **Tablas** (`components/tablas`) concentra la mayoría de los elementos hechos a mano: 9 de los 9 spinners propios y 4 de los 5 diálogos superpuestos propios (ver [COMPONENTES_UI.md](COMPONENTES_UI.md)).
- **Lenguaje visible:** desde el 23/10 no se usa «bot» en los textos visibles («En servicio», «ID de WhatsApp»).
- **Avisos:** sistema único `components/ui/Avisos` (`ContenedorAvisos` en `app/layout.tsx`) y `hooks/useAccion` para el estado de los botones; solo 7 archivos usan `useAccion` y 1 llama a `avisar()`.
