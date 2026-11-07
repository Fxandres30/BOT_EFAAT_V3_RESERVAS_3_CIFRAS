# Registro de funcionalidades ocultas

Registro permanente de toda funcionalidad que se oculta en la interfaz del panel. **Ocultar no es eliminar**: componentes, rutas, servicios, endpoints, tablas y datos siguen en su sitio y funcionando.

Visión general del lanzamiento: [LAUNCH_VISIBILITY.md](LAUNCH_VISIBILITY.md).

## Cómo funciona el control de visibilidad

Fuente única: `frontend/lib/visibilidad/funcionalidades.ts`.

```ts
export const FUNCIONALIDADES = {
    resultados:     { nombre: "Resultados",      ubicacion: "...", visible: false },
    "lector-pagos": { nombre: "Lector de pagos", ubicacion: "...", visible: false },
    bloqueados:     { nombre: "Bloqueados",      ubicacion: "...", visible: false }
};
```

- `esVisible(id)`: lo usan los componentes para mostrar u ocultar un bloque. Una funcionalidad que no está en la lista se considera visible.
- `soloVisibles(lista)`: filtra listas cuyas entradas llevan `funcionalidad: "<id>"` (el menú lateral).
- `rutaVisible(href)`: false si `href` es una página (`rutas`) de una funcionalidad oculta. Lo usan las pantallas que enlazan a otras (Aprende, catálogo de activadores) para no llevar al cliente a una página oculta.
- Solo controla lo que se **dibuja**. No es un permiso: una ruta oculta sigue abriéndose si se escribe su dirección, y los endpoints responden igual que antes.
- Sin dependencias nuevas, sin base de datos, sin variables de entorno. Cambiar la visibilidad requiere editar el archivo y desplegar el panel (Vercel).

Puntos de la interfaz controlados hoy:

| Archivo | Uso |
|---|---|
| `frontend/components/layout/Sidebar/Sidebar.tsx` | `NAV` conserva todas las entradas; las ocultas llevan `funcionalidad`. El menú dibuja `soloVisibles(NAV)`; la barra superior (`entradaActual`) sigue usando `NAV` completo, así que una página oculta abierta por su dirección conserva su título. |
| `frontend/components/eventos/EventoGrid/EventoGrid.tsx` | La sección «Resultados» está envuelta en `esVisible("resultados") && (...)`. Con Resultados oculta se muestra en su lugar «Finalizados recientes» (`!esVisible("resultados")`), solo con el acceso a administrar. |
| `frontend/components/aprende/CentroAprendizaje.tsx` | Las categorías cuya `seccion.href` no pasa `rutaVisible` no se muestran (Lector de pagos, Bloqueados). El contenido sigue en `lib/aprende/articulos.ts`. |
| `frontend/components/aprende/ArticuloAprende.tsx` | El enlace «Abrir …» de un artículo solo aparece si su ruta pasa `rutaVisible` (hoy ningún artículo apunta a una página oculta; es una protección). |
| `frontend/components/activadores/ActivadoresModal.tsx` (catálogo «Activadores y acciones», abierto desde Mensajes) | Deriva `CATALOGO` de `CATALOGO_ACTIVADORES`: quita los enlaces `panel` a páginas ocultas, y omite una entrada si todos sus enlaces eran a páginas ocultas (hoy solo «Lector de pagos (app Android)»). El catálogo original no cambia. |

## Clasificación actual

| Funcionalidad | Clase | Acceso |
|---|---|---|
| Resultados (sección de Eventos) | Oculta + pendiente | Ninguno visible: falta el número ganador |
| Administrar sorteos finalizados (reabrir / eliminar) | Visible | Eventos → «Finalizados recientes» → «Administrar sorteo» (y `/eventos?sorteo=<id>`) |
| Lector de pagos | Oculta + pendiente | Solo por acceso administrativo: escribir `/lector-pagos` |
| Bloqueados (pantalla de lista) | Oculta | Por acceso administrativo: escribir `/bloqueados` |
| Bloquear / desbloquear un contacto | Visible | Contactos → perfil del contacto |

«Acceso administrativo» significa que la página existe y abre escribiendo su dirección, pero ninguna pantalla la enlaza. No es un permiso: cualquier usuario con sesión que conozca la dirección puede abrirla.

Prueba que vigila este registro: `frontend/tests/visibilidad/visibilidad.test.mjs` (incluida en `npm test --prefix frontend`). Falla si una funcionalidad declarada en el archivo no aparece en este registro y en LAUNCH_VISIBILITY.md.

## Procedimiento general

**Ocultar una funcionalidad nueva**
1. Añadir su id a `IdFuncionalidad` y a `FUNCIONALIDADES` con `visible: false`.
2. Marcar el punto de la interfaz: `funcionalidad: "<id>"` en `NAV`, o `esVisible("<id>") && (...)` en el componente. No escribir condiciones sueltas (`false &&`, comentar JSX, etc.). Si tiene página propia, poner su ruta en `rutas`: Aprende y el catálogo de activadores dejan de enlazarla solos.
3. Buscar otros accesos (enlaces, textos de ayuda) y comprobar qué acción queda sin acceso visible al ocultar la sección (caso «Administrar sorteo» de Resultados).
4. Añadir su ficha aquí y su fila en LAUNCH_VISIBILITY.md (tabla + historial).
5. Ajustar `frontend/tests/visibilidad/visibilidad.test.mjs` (lista de ids y menú esperado) y ejecutar `npm test --prefix frontend`.

**Reactivar una funcionalidad**
1. Completar lo indicado en «Qué falta» y «Pruebas antes de reactivar» de su ficha.
2. Cambiar su `visible` a `true` (o quitar la entrada y su marca).
3. Actualizar el estado de la ficha a «Visible desde <fecha>» y el historial de LAUNCH_VISIBILITY.md.
4. Ajustar la prueba de visibilidad y ejecutar `npm test --prefix frontend` y `npm run build --prefix frontend`.

---

## `resultados` — Resultados

| Campo | Valor |
|---|---|
| Estado de visibilidad | **Oculta** |
| Incorporada al registro | 07/11/2026 |
| Ubicación | Página **Eventos** (`/eventos`), tercera sección plegable «Resultados», bajo «Activos» y «Programados» |
| Motivo | Lanzamiento comercial: la sección no ofrece todavía un resultado real (ver estado) y no es necesaria para empezar a trabajar |

**Componentes y archivos**
- `frontend/components/eventos/EventoGrid/EventoGrid.tsx`: bloque de la sección, filtros «Todos / 3 cifras pagos / 3 cifras gratis» y contador. El cálculo (`resultados`, `totalResultados`, estado `filtro`) sigue ejecutándose; solo no se dibuja.
- `frontend/components/eventos/ResultadoCard/ResultadoCard.tsx` y `ResultadoCard.module.css`: tarjeta de sorteo finalizado. Sin cambios.
- `frontend/components/eventos/modalidad.ts` (`faseDe` → `"finalizado"`). Sin cambios.

**Servicios y endpoints** (todos sin cambios, siguen usándose para Activos y Programados)
- `frontend/services/eventos/obtenerEventos.ts` (lectura de `eventos_bot`).
- `apiSorteos.eventos()` → backend `GET /sorteos/eventos`; `apiSorteos.gestion()` → `GET /sorteos/gestion`.

**Estado actual de desarrollo** (comprobado leyendo el código el 07/11/2026)
- Lista los sorteos en fase «finalizado» con nombre, modalidad, fecha, grupos, reservados y premios.
- **No hay número ganador**: el proyecto no guarda el resultado del sorteo en ninguna tabla. La tarjeta muestra «Sin resultado registrado» y el botón «Ver resultado» está deshabilitado de forma permanente.
- La tarjeta incluye «Administrar sorteo» (reabrir o eliminar un sorteo terminado hace menos de 30 días) cuando el backend lo ofrece. Ver «Efecto del ocultamiento».

**Efecto del ocultamiento y acceso alternativo**
- Fase 1 (07/11/2026): al ocultar la sección desapareció el botón visible «Administrar sorteo» de los finalizados.
- Fase 2 (07/11/2026), **acceso recuperado**: con Resultados oculta, Eventos muestra una sección plegable **«Finalizados recientes»** (cerrada por defecto). Contiene una fila por sorteo finalizado que el backend todavía ofrece administrar, con nombre, fecha, hora, modalidad y el botón «Administrar sorteo». Abre el mismo `AdministrarEventoModal` de siempre (reabrir, eliminar, etc.).
  - No muestra ganador, filtros ni «Ver resultado»; no reutiliza `ResultadoCard`.
  - Antigüedad: solo aparecen los que `GET /sorteos/eventos` devuelve; el backend aplica la ventana de 30 días (`DIAS_RECIENTES` en `backend/sorteos/gestionEventos.js`). El panel no calcula ni amplía esa ventana.
  - Permisos y reglas: las valida el backend en cada acción, igual que antes. Sin rutas nuevas, sin lógica nueva.
  - No se duplica: si Resultados vuelve a ser visible, «Finalizados recientes» desaparece y el botón vuelve a estar en cada tarjeta de Resultados.
- Sigue disponible también `/eventos?sorteo=<id del evento>`.
- No cambia ningún estado, cierre, reapertura ni dato de sorteos.

**Qué falta para terminarla**
1. Decidir y crear dónde se guarda el número ganador (estructura nueva: requiere migración autorizada).
2. Forma de registrarlo (manual en el panel y/o desde el calendario de loterías).
3. Activar «Ver resultado» con el dato real y decidir si se notifica a los grupos.

**Cómo volver a mostrarla**
En `frontend/lib/visibilidad/funcionalidades.ts`, `resultados.visible: true`. «Finalizados recientes» se retira sola. Ajustar la prueba «finalizados» de `tests/visibilidad`.

**Pruebas antes de reactivar**
- `npm test --prefix frontend` (en especial `tests/eventos/*`, `tests/sorteos/administrarSorteos.test.mjs`, `tests/visibilidad/visibilidad.test.mjs`).
- Manual en `/eventos` con sesión real: la sección aparece, contador correcto, filtros por modalidad, «Administrar sorteo» abre el modal y reabrir/eliminar funcionan sobre un sorteo de prueba.
- Si para entonces existe el número ganador: «Ver resultado» muestra el dato real, nunca uno inventado.

---

## `lector-pagos` — Lector de pagos

| Campo | Valor |
|---|---|
| Estado de visibilidad | **Oculta en el menú** (la ruta `/lector-pagos` sigue abriendo) |
| Incorporada al registro | 07/11/2026 |
| Ubicación | Menú lateral → sección «Control» |
| Motivo | Lanzamiento comercial: la funcionalidad no está terminada (ver estado) |

**Componentes y archivos**
- `frontend/app/lector-pagos/page.tsx`
- `frontend/components/pagos/LectorPagosPage/LectorPagosPage.tsx` (+ `.module.css`)
- `frontend/components/pagos/VincularTelefonoModal/VincularTelefonoModal.tsx`
- `frontend/public/downloads/EFAAT-Payments-Reader.apk` (descarga; también `NEXT_PUBLIC_APK_DOWNLOAD_URL`)
- `android/` (app Android lectora de notificaciones)
- `frontend/components/layout/Sidebar/Sidebar.tsx`: entrada de `NAV` con `funcionalidad: "lector-pagos"`

**Otros accesos ocultados (Fase 2, 07/11/2026)**
- Aprende: la categoría «Lector de pagos» y su botón «Abrir Lector de pagos» no se muestran (filtro `rutaVisible` en `CentroAprendizaje.tsx`; la categoría sigue en `lib/aprende/articulos.ts`).
- Aprende, artículo «Qué es EFAAT y cómo orientarte»: se quitó «Lector de pagos y Bloqueados» de la frase de opciones con guía futura (texto estático; el archivo no admite imports). **Al reactivar, volver a nombrarlas en esa frase.**
- Catálogo «Activadores y acciones» (Mensajes): la entrada «Lector de pagos (app Android)» no se muestra (solo enlazaba a `/lector-pagos`). Sigue en `services/activadores/catalogoActivadores.ts`.

**Servicios y endpoints** (sin cambios)
- Backend `backend/routes/pagos.js`, montado en `/pagos` (`backend/server.js`): `POST /pagos/movimientos` y `GET /pagos/movimientos`, autenticados por dispositivo.
- `backend/pagos/` (controlador, credenciales, deduplicación, alta manual de dispositivos); documentación en `backend/pagos/README.md`.
- Tablas `pagos_dispositivos` y `pagos_movimientos` (migración `005_pagos_p1.sql`). No se tocaron.

**Estado actual de desarrollo** (comprobado leyendo el código el 07/11/2026)
- Backend en fase P1: solo ingesta cruda de movimientos. No verifica pagos, no asocia usuarios y no marca números como pagados (según `backend/pagos/README.md`).
- Panel: pantalla informativa (pasos, seguridad, descarga del APK). No consulta ningún dato: no muestra el estado del lector ni la lista de movimientos.
- La vinculación del teléfono es un marcador: el modal dice «Aquí aparecerá un código QR o un código temporal». No hay endpoint de vinculación desde el panel; los dispositivos se dan de alta con un script manual.
- No se comprobó en esta intervención el estado de la app Android ni si el APK publicado está al día.

**Qué falta para terminarla**
1. Vinculación real desde el panel (código/QR + endpoint).
2. Endpoint y pantalla para ver el estado del lector y los movimientos recibidos.
3. Asociación movimiento → reserva y aprobación (definir si es manual o automática).
4. Verificar el APK y la app Android actuales.

**Cómo volver a mostrarla**
En `frontend/lib/visibilidad/funcionalidades.ts`, `"lector-pagos".visible: true`.

**Pruebas antes de reactivar**
- `npm test --prefix frontend` y `npm test --prefix backend` (incluye `backend/tests/pagos/pagosP1.test.js`).
- Manual: la entrada aparece en «Control», abre `/lector-pagos`, la descarga del APK funciona, la vinculación completa un alta real en un dispositivo de prueba.

---

## `bloqueados` — Bloqueados

| Campo | Valor |
|---|---|
| Estado de visibilidad | **Oculta en el menú** (la ruta `/bloqueados` sigue abriendo) |
| Incorporada al registro | 07/11/2026 |
| Ubicación | Menú lateral → sección «Control» |
| Motivo | Lanzamiento comercial: decisión de simplificar el menú. La expulsión de grupos asociada tiene pendientes de activación (ver estado) |

**Componentes y archivos**
- `frontend/app/bloqueados/page.tsx`
- `frontend/components/bloqueados/BloqueadosPage/BloqueadosPage.tsx` (+ `.module.css`)
- `frontend/components/bloqueados/EstadoExpulsion/EstadoExpulsion.tsx`, `frontend/components/bloqueados/types.ts`
- `frontend/services/bloqueados/bloqueados.ts`
- `frontend/components/layout/Sidebar/Sidebar.tsx`: entrada de `NAV` con `funcionalidad: "bloqueados"`

**Servicios y endpoints** (sin cambios)
- Proxies del panel: `frontend/app/api/bloqueados/` (raíz, `contacto`, `desbloquear`, `expulsiones`, `reintentar`).
- Backend `backend/routes/bloqueados.js`, montado en `/bloqueados`: `GET /`, `GET /contacto`, `POST /`, `GET /:id/expulsiones`, `POST /:id/reintentar`, `POST /:id/desbloquear`.
- Expulsión: `backend/bot/funciones/bloqueo/procesarExpulsion.js` (modo `simulacion` / `real`).

**Otros accesos ocultados (Fase 2, 07/11/2026)**
- Aprende: la categoría «Bloqueados» y su botón «Abrir Bloqueados» no se muestran; el artículo «Qué es EFAAT…» ya no la nombra (ver ficha de Lector de pagos; al reactivar, volver a nombrarla).
- Catálogo «Activadores y acciones»: la entrada «Expulsión de bloqueados» **se mantiene** (es un comportamiento que sigue activo en los grupos). Pierde el enlace a `/bloqueados` y gana uno a **Contactos** («Bloquear o desbloquear desde el perfil del contacto»), añadido en `catalogoActivadores.ts`. Al reactivar, el enlace a Bloqueados vuelve solo; el de Contactos puede quedarse.

**Lo que sigue funcionando con la entrada oculta**
- Bloquear y desbloquear un contacto desde su perfil en **Contactos** (`PerfilContacto.tsx` usa el mismo servicio). Esto es lo que permite seguir operando el bloqueo sin la pantalla.
- El efecto del bloqueo en el bot (sin respuestas automáticas, sin reservas) no depende de la visibilidad.

**Estado actual de desarrollo**
- Comprobado en el código (07/11/2026): la pantalla lista bloqueados con búsqueda, desbloqueo y estado real de expulsión por grupo, y permite reintentar expulsiones.
- Según notas internas de trabajo, **no verificado en esta intervención**: la migración 040 está aplicada en producción; la expulsión real está en modo desactivado/simulación en el servidor; y existía una corrección de identidad pendiente de despliegue. Confirmar antes de reactivar.

**Qué falta para terminarla**
1. Confirmar en el servidor el modo de expulsión y decidir si se activa `real` (requiere autorización expresa).
2. Prueba real de expulsión en un grupo de prueba.
3. Decidir si la pantalla se muestra a todos los planes o solo a algunos.

**Cómo volver a mostrarla**
En `frontend/lib/visibilidad/funcionalidades.ts`, `bloqueados.visible: true`.

**Pruebas antes de reactivar**
- `npm test --prefix frontend` y `npm test --prefix backend` (pruebas de bloqueo/expulsión).
- Manual: la entrada aparece en «Control», la lista carga, desbloquear funciona, el estado de expulsión coincide con el grupo real.

---

## Riesgos y hallazgos abiertos (auditoría de navegación, 07/11/2026)

- **Landing pública** (`components/landing/Landing.tsx`): anuncia «Lleva tu lista de participantes bloqueados…» y la expulsión automática. El bloqueo sigue disponible desde Contactos, pero la pantalla de lista está oculta y el modo real de expulsión en el servidor no está confirmado. Decidir el texto antes del lanzamiento (no tocado: fuera del alcance autorizado).
- **Acceso por dirección**: `/lector-pagos` y `/bloqueados` abren para cualquier usuario con sesión que escriba la dirección. La barra superior las titula («Control › …») aunque no estén en el menú.
- **Botón deshabilitado ya existente, no relacionado**: «Ver tabla de reservas» en las tarjetas de sorteos de 3 cifras (`EventoTresCifrasCard.tsx`) aparece deshabilitado («Falta la tabla de reservas 000–999 para esta modalidad»). No se modificó.
- La auditoría de navegación se hizo sobre el código y con pruebas automáticas; falta el recorrido manual con una sesión real.
