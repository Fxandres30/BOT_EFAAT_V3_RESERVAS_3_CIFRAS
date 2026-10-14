# Token de servicio entre el panel y el backend (solo administrador técnico)

Los clientes nunca ven ni configuran nada de esto.

## Qué es

El panel (Next) llama al backend del bot con una clave compartida en la cabecera `x-service-token`. Además, el backend comprueba la sesión del usuario y que los datos sean suyos.

| Proceso | Variable |
|---|---|
| backend (`backend/.env` o entorno de PM2) | `SESSIONS_API_TOKEN` |
| panel (`frontend/.env.production`, `.env.local` o entorno de PM2) | `BOT_API_TOKEN` |

Las dos deben tener **el mismo valor**.

Si el panel y el backend corren en el mismo servidor, desde el mismo repositorio, basta con que **uno** de los dos lo tenga:
- el backend lee `BOT_API_TOKEN` de `frontend/.env*`;
- el panel lee `SESSIONS_API_TOKEN` de `backend/.env`.

Si no está en ningún lado, el backend responde **503** en `/sessions`, `/sorteos`, `/contactos`, `/bloqueados` y `/tablas/compartir`. No queda abierto. El log muestra `[AUTH SERVICIO] Sin token de servicio…`.

## Configurarlo (VPS)

1. Genera un valor, si no existe ya: `openssl rand -base64 32`.
2. Añádelo en `backend/.env`: `SESSIONS_API_TOKEN=<valor>`.
3. Añade el mismo valor al panel: `BOT_API_TOKEN=<valor>`.
4. Comprueba sin mostrar valores: `cd backend && node scripts/verificarTokenServicio.js <ruta al .env del panel>`. Debe decir «✅ Coinciden» o «✅ … usará…».
5. Reinicia los procesos: `pm2 restart <backend> --update-env` y `pm2 restart <panel> --update-env`.
6. En el log del backend no debe aparecer `[AUTH SERVICIO]`, y en el panel deben cargar Sesiones y «Nuevo sorteo».

Si el panel corre en otra máquina (por ejemplo, Vercel), el paso 3 es obligatorio en la configuración de esa plataforma.
