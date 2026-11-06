# Componentes de interfaz: reutilizables y duplicados

Inventario F1-C, 06/11/2026. Solo describe. Sustituir un componente propio por el común puede cambiar su aspecto, así que cada sustitución es un **cambio visual que requiere autorización**.

## Componentes base (`frontend/components/ui`, exportados en `index.ts`)

«Archivos que lo usan» cuenta los archivos de `app` y `components` (fuera de `ui`) que importan de `components/ui` y renderizan el componente.

| Componente | Archivos que lo usan | Nota |
|---|---|---|
| `Button` | 48 | hay además 166 `<button>` nativos en 50 archivos |
| `Modal` | 24 | 5 diálogos no lo usan (abajo) |
| `Badge` / `StatusBadge` | 23 / 10 | |
| `Input` | 19 | |
| `EmptyState` | 17 | |
| `PageHeader` | 16 | |
| `Card` | 14 | |
| `Select` | 12 | |
| `SectionHeader` | 8 | |
| `Textarea` | 8 | |
| `IconButton` | 7 | |
| `Aviso` / `avisar` | 5 / 1 | `ContenedorAvisos` montado en `app/layout.tsx` |
| `StatCard` | 5 | |
| `Tabs` | 5 | |
| `Skeleton` | 4 | |
| `Spinner` | 1 | 9 archivos tienen su propio spinner |
| `Field` | 0 | exportado y sin uso |
| `cn` | utilidad de clases | |

Hooks reutilizables (`frontend/hooks`): `useAccion`, `useSesion`, `useSessions`, `useSaludSesiones`, `useContactos`, `usePerfilCuenta`, `useSeccionesPanel`, `useStickerPago`, `useStickerPagoGrupo`, `useBibliotecaStickersPago`, `useTablaDiseno`, `useTablaPrecio`.

## Duplicados del componente común

| Patrón | Implementaciones propias | Archivos |
|---|---|---|
| Spinner (`animate-spin`) | 9 | `tablas/CompartirTablaModal`, `HistorialNumeros`, `NumeroDetalleModal`, `ReinicioTablaModal`, `ReservaManualForm`, `ReservasRecientes`, `SeleccionPagos`, `SelectorContacto`, `TablaPrecioView` |
| Diálogo superpuesto sin `ui/Modal` (`fixed inset-0`, `role="dialog"`) | 5 | `tablas/NumeroDetalleModal`, `tablas/ReinicioTablaModal`, `tablas/SeleccionPagos`, `tablas/ConfirmDialog` (sin uso), `app/analitica-privada/_componentes/PanelAnalitica` |
| Modales que no renderizan `ui/Modal` | 2 más | `automatizacion/AutorizarGrupoModal`, `sessions/SessionCard/components/SessionModals` |
| Navegación por pestañas | 2 propias + `ui/Tabs` | `AutomatizacionNav`, `CuentaNav` (misma estructura `{ href, label, icon }`) |
| Botón nativo | 166 usos en 50 archivos | sin variante común |
| Formato de fecha de presentación | varios `Intl.DateTimeFormat` locales | `HistorialNumero`, `HistorialNumeros`, `ReservaManualForm`, `lib/cuenta/cuenta.ts`, `PanelAnalitica` |
| Cargador `cargarTs` en las pruebas | copiado en varias pruebas `.mjs` | `frontend/tests/**` |

## Sin uso

`components/dashboard/DashboardCards`, `components/tablas/ConfirmDialog`, `ui/Field` y las acciones de `sessions/SessionMenu`. Ver [../arquitectura/CODIGO_MUERTO_CANDIDATOS.md](../arquitectura/CODIGO_MUERTO_CANDIDATOS.md).
