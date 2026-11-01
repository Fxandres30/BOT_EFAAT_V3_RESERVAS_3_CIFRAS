# Requisito `FRONTEND_URL` del backend (Droplet)

Verificado en local el 31/10/2026, **sin acceso ni cambios en producción**. Las comprobaciones del Droplet de abajo son de solo lectura y debe ejecutarlas quien tenga acceso.

## Para qué sirve

Cuando el **servidor** tiene que generar la imagen de la tabla, abre con Chromium (Puppeteer) la página `<FRONTEND_URL>/tablas/imprimir/<precio>` del panel y captura la cuadrícula (`backend/services/compartirTabla.js`, `capturarImagenTabla`).

| Caso | ¿Necesita `FRONTEND_URL`? |
|---|---|
| **Publicación programada** a su hora | **Sí** |
| **Reintentos** automáticos y «Reintentar» de un grupo | **Sí** |
| «Imagen que se enviará» (prueba de imagen del servidor) | **Sí** |
| «Compartir» o «Publicar ahora» desde el panel **actual** (la imagen la captura el navegador) | No |
| «Compartir» desde un panel antiguo (sin captura en el navegador) | Sí |

**Sin un `FRONTEND_URL` correcto, ningún sorteo programado se publica.** El grupo queda en «Requiere revisión» con el motivo y no se envía nada (ni imagen ni texto).

## Reglas del código (comprobadas en local)

| Valor | `NODE_ENV` | Resultado |
|---|---|---|
| vacío | cualquiera | Error de configuración «Falta FRONTEND_URL…»: revisión al primer intento, sin abrir Chromium. |
| no es una URL | cualquiera | Error de configuración «no es una dirección válida». |
| `http://localhost:…` | `production` | Error de configuración: «en producción no es el panel». |
| `http://localhost:…` | **no definido** | **Pasa la validación** y luego falla al conectar (`ERR_CONNECTION_REFUSED`). Cuenta como fallo reintentable: gasta los reintentos automáticos. |
| Otra web (p. ej. otro proyecto de Vercel) | cualquiera | Abre la página pero no encuentra la tabla: el error nombra el dominio abierto. |
| `https://bot-efaat-cifras-six.vercel.app` | `production` | **Captura correcta** con el código actual: `tests/sorteos/capturaRealSorteo.test.js` 4/4 contra el panel público (31/10). |

Pruebas: `tests/sorteos/capturaErrores.test.js` 8/8.

Atención: el `backend/.env` local tiene `FRONTEND_URL=http://localhost:3000`, que solo vale para desarrollo. Si el `.env` del Droplet se copió del local, las programadas fallan.

Antecedente (memoria del proyecto): el 30/10 a las 15:40 UTC el Droplet ya registró «Falta FRONTEND_URL», es decir, la variable no estaba en el entorno del proceso.

## Cómo verificarlo en el Droplet (solo lectura)

```bash
# 1. Proceso y entorno REAL que ve Node (PM2 manda sobre .env: dotenv no sobrescribe)
pm2 ls
pm2 env <id-del-proceso> | grep -E '^(FRONTEND_URL|NODE_ENV)='

# 2. Lo que dice el .env del backend (solo esa clave)
grep -E '^(FRONTEND_URL|NODE_ENV)=' /ruta/al/backend/.env

# 3. Que el panel responde desde el Droplet
curl -s -o /dev/null -w '%{http_code}\n' "https://bot-efaat-cifras-six.vercel.app/tablas/imprimir/5000"

# 4. Que Chromium arranca con el usuario del proceso (no envía nada)
node -e "require('puppeteer').launch({args:['--no-sandbox']}).then(b=>{console.log('Chromium OK');return b.close()}).catch(e=>console.error('Chromium FALLA:',e.message))"
```

Resultado esperado:
1. `FRONTEND_URL=https://<dominio público del panel>` y `NODE_ENV=production`.
2. Lo mismo que el 1, o la clave ausente si se define en PM2.
3. Un código 200 (o una redirección a la misma web).
4. `Chromium OK`.

Confirmar que el dominio público vigente del panel es `bot-efaat-cifras-six.vercel.app`. Si se usa otro dominio propio, poner ese.

## Prueba final sin publicar nada

En el panel ya desplegado: abrir un sorteo instantáneo → vista previa → **«Imagen que se enviará»**. Llama a `GET /sorteos/:id/imagen-prueba`, que captura con el servidor y **no envía nada**. Si aparece la imagen, el servidor está bien configurado para las programadas.

## Corrección (requiere autorización: es un cambio de producción)

Definir `FRONTEND_URL` y `NODE_ENV=production` en el entorno del proceso (ecosistema de PM2 o `.env` del backend) y reiniciar con `pm2 restart <id> --update-env`. Sin `--update-env`, PM2 conserva el entorno anterior.
