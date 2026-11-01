# Un sorteo activo por precio — modelo, protección, despliegue y reversión

Preparado el 01/11/2026. Sustituye a la versión «por tabla física» del 31/10, que ya está en `main` (186d75b7) pero **no debe desplegarse en el Droplet**. **Nada aplicado en producción.**

## 1. Modelo de identidad definitivo

| Concepto | Clave | Notas |
|---|---|---|
| **Sorteo** | `identidad_evento_real` = cliente + lotería + hora + **precio** + fecha | Ya incluía el precio (`crearIdentidadEventoReal`). Un sorteo en varios grupos = varias filas de `eventos_bot` con la misma identidad. |
| **Configuración de precio** (unidad de exclusión) | `usuario_id` + **precio normalizado** (solo dígitos de `valor`) | Como máximo **un sorteo activo** por cliente y precio. |
| **Grupo** | `grupo_id` + `usuario_id` | Como máximo **un sorteo vigente** por grupo y cliente: el bot atiende un sorteo por grupo (`consultarEvento`). |
| **Cuadrícula de números** (hoy) | tabla física + `usuario_id` + `numero` | ⚠️ **Compartida entre precios**: $1.000–$2.000 en `reservas_dos_cifras`; $3.000–$15.000 en `5k_15k_reservas_2_cifras`. **No incluye el precio**: ver sección 4. |

### Reglas de publicación (decisiones del 31/10 y 01/11)

| Situación | Resultado |
|---|---|
| Sorteo nuevo del **mismo precio** y cliente | Reemplaza al anterior en **todos sus grupos**. |
| Sorteo de **otro precio** en el **mismo grupo** | Reemplaza al anterior **solo en ese grupo**; en sus otros grupos sigue. |
| Sorteo de **otro precio** en **otros grupos** | Conviven ($3.000 y $10.000; $5.000 y $15.000). |
| Sorteo de **otra cuenta** en el grupo | El programado **espera**, como siempre. |
| Anuncio de WhatsApp de alguien que no es administrador, con el mismo precio activo en **otros** grupos | No se aplica (no puede apoderarse del precio). |
| «Reabrir» con el mismo precio activo en otro grupo | Rechazado salvo «sustituir» confirmado; si se confirma, reemplaza en todos. Con otro precio, se reabre sin tocar nada. |
| Corregir el precio de un sorteo en curso hacia un precio ocupado | Rechazado. Hacia uno libre, permitido. |

Siempre: el reemplazado se cierra como `sustituido…`, sin mensaje de cierre y sin tocar el grupo de WhatsApp, y **sus reservas y pagos se conservan sin reasignarse**. El cierre va justo antes de activar el nuevo (después de capturar la imagen) y se deshace si el nuevo no se guarda.

## 2. Cambios realizados (local, sin commit)

- `backend/shared/eventos/unSorteoPorPrecio.js` (sustituye a `unSorteoPorTabla.js`): `precioDe`, `sorteosActivosDelPrecio`, `reemplazarAnteriores`, `revertirReemplazo`, `esPrecioOcupado`.
- `sorteos/publicador.js`, `sorteos/servicio.js` (aviso de la vista previa por precio), `bot/funciones/eventos/detectarEvento.js`, `sorteos/gestionEventos.js` (Reabrir), `sorteos/sorteosActivos.js` (corregir precio, aunque la tabla física sea la misma), `bot/funciones/eventos/guardarEvento.js` (mensaje del rechazo de la 043).
- `frontend/components/sorteos/FormularioSorteo.tsx`: texto «Un sorteo por precio…».
- Migración **043** reescrita por precio: `043_un_sorteo_activo_por_precio.sql` (la de por tabla se eliminó; nunca se aplicó).
- Diagnóstico: `docs/activacion/sorteos_activos_por_precio_solo_lectura.sql`.

## 3. Migración 043 (sin aplicar)

`EXCLUDE USING gist (usuario_id =, precio_normalizado =, identidad_evento_real <>)`, con la misma regla de «activo» que `finDelEvento`, y `DEFERRABLE INITIALLY IMMEDIATE`.
- Permite precios distintos a la vez aunque compartan tabla.
- Rechaza dos sorteos activos del mismo precio con `23P01`, también entre escrituras simultáneas.
- Funciona con `valor` en texto o en número.
- Se detiene sin cambiar nada si ya hay conflictos.
- No toca RLS ni permisos. Requiere `btree_gist`.

Prueba: `backend/tests/sorteos/migracion043.test.js`, **18/18** en Postgres real (PGlite).

**Límite conocido:** si al corregir la identidad falla el traslado de reservas, la reversión de `corregirIdentidad` restaura fila por fila. Con dos o más grupos, la 043 rechazaría esa reversión a mitad. Es un camino de error poco frecuente; arreglarlo requiere autorización.

## 4. ⚠️ Lo que la regla NO consigue todavía: cuadrículas independientes

Con la cuadrícula física compartida, dos precios activos a la vez **comparten los números 00–99**:
- si el 07 está pagado en $3.000, aparece ocupado en $10.000;
- los contadores y el recaudo del sorteo activo se leen por tabla (regla «una tabla = un sorteo»), así que el de $10.000 cuenta los números del de $3.000.

Medido en `backend/tests/sorteos/independenciaPorPrecio.test.js`: las pruebas 2 y 3 **fallan a propósito** hasta que se separen las cuadrículas.

### Propuesta (requiere decisión y autorización): una tabla física por precio

Casi todo el código ya lee la cuadrícula a través de la tabla configurada para cada precio (41 lecturas genéricas). Solo 5 archivos nombran tablas a mano (`configEvento.js`, `filtroCliente.js`, `automation/repo/tablaEvento.js`, `frontend/lib/tablasConfig.ts`, `frontend/components/tablas/types.ts`). Con una tabla por precio:
- «una tabla = un sorteo» pasa a ser exactamente «un precio = un sorteo»;
- reservas, pagos, recaudo, Realtime y la lógica de reemplazo funcionan sin reescribir consultas.

Pasos (cada uno con autorización):
1. **Migración 044**: crear las 6 tablas que faltan con la misma estructura (`like … including all`), `UNIQUE(usuario_id, numero)`, las mismas políticas RLS que las actuales y alta en `supabase_realtime`.
2. **Transición sin reasignar datos**:
   - `reservas_dos_cifras` se queda con $1.000 y `5k_15k_reservas_2_cifras` con $3.000.
   - Cada uno de los otros precios pasa a su tabla nueva **solo cuando no tiene sorteo activo** (por cliente, en `tablas_cliente`).
   - Los números históricos se quedan donde están, con su identidad (historia y deuda por identidad).
3. Actualizar el mapa precio → tabla en `configEvento.js` y en el panel.
4. Coordinar con la sesión de pagos por lote (`reservaManual`, `pagoLote`), que también lee la tabla por precio.

## 5. Compatibilidad con lo ya publicado

| Pieza | Estado | Riesgo |
|---|---|---|
| Panel en Vercel (186d75b7) | Texto «Una tabla = un sorteo…» (incorrecto con la regla final); envía `sustituir_activo: true` | Solo es texto. Se corrige con el próximo despliegue del panel. |
| **Backend 186d75b7** (en `main`, **no** en el Droplet) | Reemplaza por **tabla física**: un $10.000 reemplazaría a un $3.000 | **No desplegar 186d75b7 en el Droplet.** Desplegar solo la versión con estos cambios por precio. |
| Backend actual del Droplet (anterior) | Con `sustituir_activo: true` sustituye solo en el grupo, sin tocar otros grupos ni otros precios | Compatible con el panel publicado. No aplica la regla «mismo precio en todos los grupos». |
| Migración 043 | Sin aplicar | Sin ella, la regla la aplica solo el código (posible carrera muy ajustada entre publicador y detector). |

## 6. Despliegue seguro (cada paso con autorización)

1. Hacer commit de estos cambios locales (por precio) **y** de los del resto de sesiones que estén listos, y revisar el diff contra 186d75b7.
2. **Backend (Droplet)**: comprobar `FRONTEND_URL` (ver `FRONTEND_URL.md`), hacer pull y reiniciar PM2.
3. Probar en un grupo de prueba:
   - un programado de $3.000 y otro de $10.000 en grupos distintos → quedan los dos activos;
   - otro de $10.000 → reemplaza al primero de $10.000 en todos sus grupos.
4. **Panel (Vercel)**: push, para que salga el texto corregido.
5. `sorteos_activos_por_precio_solo_lectura.sql` hasta 0 conflictos (consulta 1). Luego aplicar la **043**.
6. Decidir la separación de cuadrículas (sección 4) antes de usar en producción dos precios de la misma tabla física a la vez.

## 7. Reversión

- **043:** `alter table public.eventos_bot drop constraint if exists eventos_bot_un_sorteo_activo_por_precio;` (no toca filas).
- **Backend:** volver al commit anterior en el Droplet y reiniciar PM2. Los sorteos cerrados como `sustituido…` **no se reabren solos**: si hiciera falta, «Reabrir» desde el panel. Para los mensajes con variables nuevas, seguir `REVERSION_BACKEND_MENSAJES.md` **antes** de revertir.
- **Panel:** revertir en Vercel. El formulario anterior seguía enviando la casilla «Sustituir».
