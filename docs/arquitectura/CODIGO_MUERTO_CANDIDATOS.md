# Candidatos a código muerto

Inventario F1-C, 06/11/2026. **No se ha eliminado nada.** «Sin importadores» se comprobó buscando `require`/`import` en todo el repositorio, sin contar `node_modules` ni las pruebas. Una carga dinámica o un uso desde fuera del repositorio (otra app, un cron del Droplet) no se detectan así, por eso cada fila dice cómo confirmarlo antes de borrar.

## Backend

| Archivo | Evidencia | Confirmar antes de borrar |
|---|---|---|
| `backend/index.js` | `package.json` arranca con `server.js`; el archivo hace `require("../services/baileys/manager")`, una ruta que no existe desde `backend/` (es una copia antigua de `bot/index.js`) | Que ningún proceso de PM2 del Droplet lo use como script |
| `backend/test.js` | Script suelto que abre Baileys directamente; nadie lo importa | Que no se use a mano para depurar |
| `backend/bot/workers/index.js`, `reservaWorker.js` | Solo se importan entre sí; nada importa `bot/workers` | — |
| `backend/bot/funciones/eventos/index.js` | Es ESM (`export * from`) en un proyecto CommonJS; ningún módulo lo importa (solo lo lee una prueba de catálogo como texto) | Ajustar `tests/catalogo/catalogoActivadores.test.js`, que lo lee |
| `backend/bot/funciones/eventos/notificarEvento.js` | ESM; importa `../../utils/eventoUtils.js`, que no existe; sin importadores | — |
| `backend/bot/ai/responderReserva.js` | Sin importadores; `responderResultado.js` dice que lo generaliza | — |
| Scripts `backend/_*.js` (23), `bot/funciones/consultas/_matriz_*.js`, `bot/funciones/eventos/_test_consistencia_grupos.js`, `services/baileys/_test_groupQueue.js` | Scripts manuales de fases anteriores; los 12 que tocan datos reales llevan la guarda de F1-A | Decidir cuáles se archivan y cuáles se convierten en pruebas de `npm test` |
| `diagnostico-real-send.patch`, `index (3).html` (raíz) | Archivos sueltos en la raíz | Que no sean referencia de nadie |

## Panel

| Archivo | Evidencia | Confirmar antes de borrar |
|---|---|---|
| `components/dashboard/DashboardCards/DashboardCards.tsx` | Sin importadores; `/dashboard` redirige a `/sesiones` | — |
| `components/tablas/ConfirmDialog.tsx` | Sin importadores | — |
| `components/sessions/SessionMenu/actions/{copyLink,makePrincipal,reconnectSession}.ts`, `SessionMenu/hooks/useSessionMenu.ts` | Sin importadores (`SessionMenu.tsx` sí se usa desde `SessionCard`; estas acciones y el hook no) | Comprobar que `SessionMenu` no las cargue de forma dinámica |
| `services/auth/cambiarClave.ts` | Sin importadores | Que la recuperación de contraseña no lo necesite |
| `services/mensajes/guardarConfigMensaje.ts`, `obtenerConfigMensajes.ts` | Sin importadores; escriben y leen `configuracion_mensajes` (migración 001, que según la auditoría del 21/10 no está en producción) | — |
| `app/ui-preview/page.tsx` | Página de vista previa con datos fijos; no está en la navegación | Decidir si se conserva como herramienta interna |
| `app/chats/page.tsx` | Fuera de la barra lateral desde que existe Contactos; solo se llega escribiendo la URL (la barra superior tiene su título, no un enlace) | **No es código muerto**: se conservó a propósito (comentario en `Sidebar.tsx`). Decidir si sigue |
