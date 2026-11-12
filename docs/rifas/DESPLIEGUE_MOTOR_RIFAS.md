# Despliegue del motor de rifas (VPS + Vercel)

Preparado el 12/11/2026.
- **Base de datos:** la 050, la 051 y la 052 ya están aplicadas en producción; la limpieza operativa también está hecha. Solo falta la **053**.
- **Panel (Vercel):** se despliega solo con el push a `main`.
- **Bot y backend (VPS, PM2):** se actualizan a mano con los pasos de abajo.

El panel no tiene interruptor propio: pregunta el modo al backend (`GET /rifas/modo`). Por eso el bot y el panel **siempre** usan el mismo motor y las mismas rifas (`tabla_id`).

## 0. Base de datos: ejecutar la 053 (SQL Editor de Supabase)

Copia todo [backend/supabase_migrations/053_reinstalar_funciones_rifas.sql](../../backend/supabase_migrations/053_reinstalar_funciones_rifas.sql) y pulsa **Run**.
- Solo reinstala el código de las 25 funciones del motor con su versión actual: no toca tablas, datos ni permisos y se puede repetir.
- Es imprescindible antes del paso 2: sin ella, el vencimiento automático podría liberar una reserva recién hecha.

## 1. Actualizar el código en el VPS (sigue en motor «legado»)

```bash
cd ~/BOT_EFAAT_V3                 # carpeta del repositorio en el VPS (ajústala si es otra)
git rev-parse HEAD                # ANÓTALO: es el commit para volver atrás
git status --short                # debe salir vacío; si no, avisa antes de seguir
git pull origin main
pm2 ls                            # nombre o id del proceso del backend = <APP>
pm2 restart <APP> --update-env
pm2 logs <APP> --lines 80         # sin errores; debe verse la conexión a Supabase y las sesiones
```

No hace falta `npm install`: no hay dependencias nuevas.

Con `MOTOR_RIFAS` sin definir, el comportamiento es **el de siempre**. Si algo falla aquí, `git checkout <commit anotado>` y `pm2 restart <APP> --update-env`.

## 2. Activar el motor nuevo

Elige un momento **sin sorteos en curso**. Hoy no hay ninguno ni hay programados pendientes.

```bash
cd ~/BOT_EFAAT_V3/backend
grep -q '^MOTOR_RIFAS=' .env && sed -i 's/^MOTOR_RIFAS=.*/MOTOR_RIFAS=nuevo/' .env || echo 'MOTOR_RIFAS=nuevo' >> .env
grep '^MOTOR_RIFAS=' .env          # MOTOR_RIFAS=nuevo
pm2 restart <APP> --update-env
pm2 env <APP> | grep MOTOR_RIFAS   # si PM2 define la variable, manda sobre .env: debe decir «nuevo»
pm2 logs <APP> --lines 80
```

Si `pm2 env` muestra otro valor, la variable viene del ecosistema de PM2: cámbiala allí y repite `pm2 restart <APP> --update-env`.

## 3. Comprobar

- Panel → **Tablas** debe llevar a **Mis rifas**, con 16 rifas y 100 números libres en cada una. Las advertencias de «tablas compartidas» ya no aparecen.
- Ejecutar la verificación de producción (la deja preparada la sesión de Claude):
  - solo lectura: comprueba las 16 rifas y que eventos, programados y grupos apuntan a la rifa de su cliente y su precio;
  - con `--operaciones`: reserva, consulta, pago, pago doble, vencimiento, liberación, reinicio y aislamiento entre clientes, sobre una **rifa temporal** que después se archiva.
- Primer sorteo real: publícalo y reserva un número desde WhatsApp. Debe aparecer en la rifa de ese precio, y solo en ella.

## Volver atrás

```bash
cd ~/BOT_EFAAT_V3/backend
sed -i 's/^MOTOR_RIFAS=.*/MOTOR_RIFAS=legado/' .env
pm2 restart <APP> --update-env
```

Las tablas antiguas siguen intactas. Lo que se haya vendido en el motor nuevo durante la prueba queda en `numeros_rifa` y en `reservas_auditoria`, no en las tablas antiguas.
