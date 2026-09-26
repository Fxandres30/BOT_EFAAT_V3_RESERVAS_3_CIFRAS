# Analítica privada — guía de operación

Sistema de visitas anónimas al panel, **separado del panel EFAAT**: el panel no
muestra ni enlaza nada de esto, y el visitante no ve ninguna pantalla ni tiene
que hacer nada. **No usa variables de entorno ni secretos nuevos**: reutiliza la
conexión Supabase del backend (service role), `BOT_API_URL` y Supabase Auth.

```
visitante ── instrumentation-client.ts (invisible) ──► POST /api/e (Next)
                                                        │ + user-agent + X-Forwarded-For
                                                        ▼
                                             backend POST /analitica/recolectar
                                                        │ valida · rate limit · UA · IP
                                                        ▼
                                  Supabase: analitica_registrar_evento()  (service role)

administrador (sesión normal de Supabase Auth) ── /analitica-privada
      └─ Authorization: Bearer <access_token> ──► /api/analitica-privada/* ──► backend /analitica/*
         el backend verifica el token con Supabase y que el usuario esté en analitica_admins
```

## 1. Activación: un único paso

Ejecutar `backend/supabase_migrations/020_analitica_privada.sql` en el SQL Editor
de Supabase y reiniciar el backend. La migración es idempotente y no toca tablas
existentes. Crea:

- `visitors`, `visitor_sessions`, `visitor_events`: los datos de las visitas.
- `analitica_admins`: quién puede ver el panel privado, sembrada con el usuario
  administrador actual (`2491cbd0-…`).

Todas tienen RLS activo, sin políticas y sin privilegios para `anon` ni
`authenticated`. Solo el backend (service role) accede.

## 2. Acceso al panel privado

1. Iniciar sesión en el panel con la cuenta de siempre (`/login`).
2. En ese mismo navegador, abrir `https://<dominio>/analitica-privada`.

Sin sesión, o con una cuenta que no está en `analitica_admins`, se ve el 404
estándar y el backend no entrega ningún dato. Hace falta la tabla porque el
registro público de Supabase Auth está abierto: estar registrado no basta.

- Dar acceso: `insert into public.analitica_admins (user_id) values ('<uuid>');`
- Quitar acceso: `delete from public.analitica_admins where user_id = '<uuid>';`

Ambos surten efecto en la siguiente petición.

## 3. IP

Se guarda la **última** entrada de `X-Forwarded-For` que recibe Next:

- sin proxy delante, Next pone ahí la IP del socket;
- con nginx (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`),
  la última entrada es la IP real que añadió nginx, y lo que haya escrito el
  cliente queda a la izquierda y se ignora.

Es un dato informativo: si Next queda expuesto sin proxy, un visitante podría
falsear la IP de su propio registro, igual que su user-agent.

La IP completa se conserva 30 días; después se reduce a /24 (IPv4) o /48
(IPv6). Lo hace el backend cada 6 h y, si pg_cron está habilitado, también la base.

## 4. Ubicación aproximada

Se guardan `country`, `region`, `city` y `country_code` en `visitor_sessions`,
**solo** a partir de las cabeceras que añade un CDN delante del servidor. No se
usan GPS, geolocalización del navegador, servicios externos ni coordenadas.

| Fuente | Cabeceras | Qué da |
|---|---|---|
| Cloudflare (proxy activado) | `cf-ipcountry` | código de país, siempre |
| Cloudflare + *Managed Transforms → Add visitor location headers* | `cf-region`, `cf-region-code`, `cf-ipcity` | región y ciudad |
| Vercel | `x-vercel-ip-country`, `x-vercel-ip-country-region`, `x-vercel-ip-city` | país, código de región y ciudad |

- **Sin CDN** (infraestructura actual: VPS), no llega ninguna cabecera y los
  cuatro campos quedan en `NULL`. Nunca se inventan.
- **Precisión:** son bases de geolocalización por IP. El país suele ser fiable;
  la ciudad es aproximada. En redes móviles y con algunos operadores en
  Colombia puede aparecer la ciudad del nodo del operador (por ejemplo, Bogotá
  o Medellín) en lugar de la real. Con VPN o proxy aparece la ubicación de
  estos. Por eso el panel lo etiqueta siempre como "aproximada".
- **ASN o proveedor:** ningún CDN lo da en cabeceras. Requeriría una base
  GeoIP/ASN local (MaxMind GeoLite2 o DB-IP Lite) o una API externa que
  recibiría la IP del visitante. **No está instalado.**

## 5. Semántica de los datos

- **Visitante recurrente:** mismo `visitor_id`, un UUID aleatorio guardado en
  el localStorage del navegador (`_efa_v`).
- **Sesión:** actividad continua con menos de 30 min de inactividad. Si se
  supera, se abre una nueva; la decide el servidor y el navegador adopta el id.
- **Heartbeat:** cada 60 s, solo con la pestaña visible y con interacción en los
  últimos 5 min. Actualiza `last_activity_at` como mucho una vez cada 30 s por
  sesión y **no** inserta filas.
- **Duración aproximada:** `last_activity_at − started_at`.
- **Activo ahora:** sesión abierta con actividad en los últimos 150 s.
- **exit:** se registra al cerrar o recargar la **última** pestaña abierta.
- **No se registran:** `/tablas/imprimir` (Puppeteer), navegadores automatizados
  o bots, `/api/*` y el propio panel privado.

## 6. Subdominio (opcional, más adelante)

Solo con nginx, sin tocar código: un `server_name analytics.<dominio>` que haga
`proxy_pass` al mismo Next, redirija `/` a `/analitica-privada` y pase las mismas
cabeceras. Como el subdominio es otro origen, allí habrá que iniciar sesión otra
vez (la sesión de Supabase se guarda por origen).

## 7. Pruebas

```bash
node backend/tests/analitica/analitica.test.js     # backend (fake de Supabase)
# SQL real sobre Postgres en memoria (PGlite, no es dependencia del proyecto):
npm install --no-save --prefix /tmp/pg @electric-sql/pglite
PGLITE_MODULE=/tmp/pg/node_modules/@electric-sql/pglite node backend/tests/analitica/sqlAnalitica.test.js
```
