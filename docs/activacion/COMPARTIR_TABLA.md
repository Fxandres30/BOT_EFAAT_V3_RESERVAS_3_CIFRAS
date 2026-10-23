# Despliegue de «Compartir tabla» (captura en el navegador)

Nada de esto está aplicado ni desplegado. Cada paso requiere autorización.

## Qué cambia

- El panel nuevo captura el `div` real de la tabla (`html-to-image`) y envía el PNG en `imagen`. El backend lo valida y lo envía con `sendImage` y su caption.
- **Compatibilidad temporal:** el backend nuevo acepta también el panel publicado hasta ahora.
  - Si una solicitud de envío llega con `solicitudId` y sin `imagen`, la imagen se genera con Puppeteer, como antes.
  - Si la vista previa se pide sin `sin_imagen=1`, también trae la imagen de Puppeteer.
  - Si llega una `imagen` presente pero inválida, se responde 400 y nunca se recurre a Puppeteer.
- **Límite de cuerpo:** 6 MB solo para `/tablas/compartir` (`server.js`). El resto de rutas mantiene el límite global de 100 KB.

## Orden seguro (sin intervalo roto)

El backend nuevo funciona con el panel publicado y con el nuevo. El panel nuevo **no** funciona con el backend actual del VPS (límite de 100 KB → 413). Por eso:

1. (Opcional, en cualquier momento) Aplicar la migración 037.
2. En el VPS: instalar el Chrome de Puppeteer, si falta. Lo necesitan el panel publicado durante la transición y la tabla inicial automática.
3. Publicar y desplegar **solo el backend** (commit 1) y reiniciarlo.
4. Publicar el **panel** (commit 2) → Vercel.
5. Prueba real con un grupo de prueba.

Cualquier push a `main` despliega el panel en Vercel. Por eso el commit 1 lleva solo `backend/` y `docs/`: Vercel vuelve a desplegar el mismo panel, sin cambios.

## Comandos

### Local — commit 1 (backend)

```bash
cd <ruta-del-repo-local>
git add backend/server.js backend/routes/tablas.js backend/services/compartirTabla.js backend/services/destinosCompartir.js \
        backend/tests/tablas/compartirConDestinos.test.js backend/tests/e2e/compartirTabla.e2e.js backend/tests/e2e/entornoPanel.js \
        docs/activacion/COMPARTIR_TABLA.md
git commit -m "Compartir tabla: aceptar captura PNG del panel (con compatibilidad temporal)"
git push origin main
```

### VPS — backend (como root, el usuario del proceso)

```bash
cd <ruta-del-repo>/backend
git pull origin main
git diff HEAD@{1} --stat -- package.json package-lock.json   # vacío: no hay dependencias nuevas en el backend
npx puppeteer browsers list                                   # ¿chrome@152.0.7977.75?
npx puppeteer browsers install chrome --install-deps          # solo si no aparece
pm2 ls                                                        # nombre/id del backend = <APP>
pm2 restart <APP> --update-env
pm2 logs <APP> --lines 80                                     # sin errores al arrancar
```

Comprobación con el panel aún publicado: pulsa «Compartir» en una tabla. La vista previa debe mostrar la imagen y el envío debe funcionar como antes.

### Local — commit 2 (panel)

```bash
cd <ruta-del-repo-local>
git add frontend/package.json frontend/package-lock.json frontend/services/tablas/capturarTabla.ts \
        frontend/services/tablas/compartirTabla.ts frontend/app/api/tablas/compartir/route.ts \
        frontend/app/api/tablas/compartir/vista-previa/route.ts frontend/components/tablas/AccionesTabla.tsx \
        frontend/components/tablas/CompartirTablaModal.tsx frontend/components/tablas/Grid.tsx \
        frontend/components/tablas/TablaPrecioView.tsx
git commit -m "Compartir tabla: capturar el div real de la tabla y enviarlo como PNG"
git push origin main     # Vercel despliega el panel
```

### Verificación tras el despliegue (WhatsApp real, grupo de prueba)

1. Tablas → una tabla con sorteo activo → «Cambiar grupos» → elegir **solo** un grupo de prueba.
2. La vista previa debe mostrar la tabla tal como se ve en pantalla. «Continuar» → «Confirmar y enviar».
3. En WhatsApp: **una** foto con el texto como pie, en ese grupo y en ningún otro.
4. Pulsar «Compartir» otra vez: se envía directamente, sin pedir los grupos.
5. En `pm2 logs <APP>` no debe aparecer `imagen_invalida` ni `error_imagen`.

## Migración 037 (`backend/supabase_migrations/037_destinos_compartir_tabla.sql`)

- **Qué hace:** crea `public.destinos_compartir_tabla` (una fila por cliente y precio), con RLS activado y `REVOKE ALL` para `anon` y `authenticated`. Solo el backend (`service_role`) la usa.
- **Sin ella:** «Compartir» funciona, pero la selección de grupos no se guarda y se pide en cada envío.
- **Revisión local** en PostgreSQL 17 con roles y privilegios por defecto como los de Supabase:
  - se aplicó dos veces sin error (es idempotente);
  - `rls=true`;
  - `anon` y `authenticated` sin `select` ni `insert`;
  - `service_role` puede leer y escribir;
  - `precio = 0` se rechaza.

Aplicación (Supabase → SQL Editor):

1. Pegar el archivo completo y pulsar «Run».
2. Verificar:
   ```sql
   select relrowsecurity from pg_class where relname = 'destinos_compartir_tabla';   -- true
   select has_table_privilege('anon', 'public.destinos_compartir_tabla', 'select');    -- false
   select has_table_privilege('authenticated', 'public.destinos_compartir_tabla', 'select'); -- false
   ```
3. Revertir (se pierden las selecciones guardadas):
   ```sql
   drop table if exists public.destinos_compartir_tabla;
   ```

## Retirar la compatibilidad temporal (más adelante)

Cuando ningún navegador use el panel anterior, se puede quitar de `backend/routes/tablas.js`:
- la rama que genera la imagen con Puppeteer si falta `imagen`;
- la imagen de la vista previa sin `sin_imagen=1`.

Puppeteer seguirá siendo necesario para la tabla inicial automática del scheduler.
