# Verificar Realtime y los payloads reales de Supabase

Preparado el 31/10/2026. **Todo lo de esta guía es de solo lectura**: no cambia la base, la publicación ni los permisos. Los cambios que pudiera sugerir el resultado (añadir una tabla a la publicación, `replica identity full`) necesitan autorización aparte.

## Qué necesita el panel

La pantalla de Tablas (`frontend/hooks/useTablaPrecio.ts`) se suscribe con `postgres_changes` y el filtro `usuario_id=eq.<uid>` a tres canales:

| Tabla | Eventos | Qué hace el panel con el aviso (`services/tablas/cambiosTabla.ts`) |
|---|---|---|
| Cuadrícula del precio (`reservas_dos_cifras`, `5k_15k_reservas_2_cifras`) | `*` | **Aplica** la fila si trae `id`, `numero`, `estado`, `usuario_id` y todas las columnas que ya tenía; si falta alguna o trae `errors`, **relee** ese número; un `DELETE` de una fila propia (o desconocida) **recarga** la tabla. |
| `eventos_bot` | `*` | Ignora los de otra tabla física (columna `tabla`). |
| `reservas_actividad` | `INSERT` | Añade el movimiento a la lista (fusión por `id`). |

`reservas_auditoria` (migración 032) **no tiene suscripción**: el panel la lee por ventana de tiempo. Puede no existir en producción, y el panel lo tolera.

Si un aviso llega incompleto, el panel no muestra datos erróneos: relee o recarga. Lo que se verifica aquí es si el **camino rápido** (aplicar el aviso) funciona en producción o si cada cambio acaba en una relectura.

## Paso 1 — Diagnóstico SQL (solo lectura)

Ejecutar entero `docs/activacion/diagnostico_realtime_solo_lectura.sql` en el SQL Editor de Supabase. El archivo corre en una transacción `READ ONLY` que termina en `ROLLBACK`.

Anotar, por tabla:

| Comprobación | Resultado esperado | Si no |
|---|---|---|
| `existe` | `true` (salvo `reservas_auditoria` si la 032 no está aplicada) | Esa función del panel no tiene datos. |
| `en_realtime` | `true` para la cuadrícula, `eventos_bot` y `reservas_actividad` | El panel no recibe cambios en vivo de esa tabla: solo los ve al releer. |
| `replica_identity` | `default` es suficiente para INSERT/UPDATE | Con `default`, un `DELETE` solo trae la clave: el panel recarga (correcto, pero más lento). |
| `columnas_publicadas` | Incluye `id`, `numero`, `estado`, `usuario_id` y el resto | El panel releerá cada número (camino lento). |
| Política `SELECT` para `authenticated` y `authenticated_select = true` | Presentes en las tablas suscritas | **Ningún** evento llega al navegador: Realtime solo entrega lo que el SELECT del usuario permite. |

## Paso 2 — Ver los payloads reales en el navegador

Con una cuenta de **prueba** y un grupo de prueba, sin tocar datos de clientes:

1. Abrir el panel publicado en `/tablas/<precio>` con DevTools abierto → pestaña **Network** → filtro **WS** → seleccionar la conexión `realtime/v1/websocket` → sub-pestaña **Messages**.
2. Comprobar que, al abrir la página, cada canal responde `phx_reply` con `status: "ok"` (si no, el panel muestra «Sin conexión en tiempo real»).
3. Hacer una operación de prueba en esa tabla (reservar y liberar un número de prueba).
4. Buscar los mensajes `postgres_changes` y revisar, **sin copiarlos fuera del navegador** (pueden contener nombre o teléfono del comprador):
   - `data.type` (`INSERT` / `UPDATE` / `DELETE`);
   - `data.record` (fila nueva): ¿trae **todas** las columnas que tiene la fila en la tabla, o solo algunas?;
   - `data.old_record` en UPDATE/DELETE: con `replica identity default` solo trae la clave;
   - `data.commit_timestamp` presente;
   - `data.errors` vacío o `null`. Si dice que el payload superó el tamaño máximo, Realtime manda la fila recortada y el panel releerá.
5. Repetir con el detector o el panel modificando `eventos_bot` (por ejemplo, cerrar y reabrir un sorteo de prueba) y con una reserva que genere `reservas_actividad`.

## Paso 3 — Interpretar

| Observación | Significado | Acción (con autorización) |
|---|---|---|
| `record` completo, `errors` vacío | Camino rápido funcionando | Ninguna. |
| `record` sin alguna columna | El panel relee cada número: correcto pero más lento | Revisar la lista de columnas de la publicación. |
| Ningún `postgres_changes` tras operar | Tabla fuera de la publicación, o sin SELECT para `authenticated` | Ver paso 1; añadir la tabla a la publicación es un cambio de producción. |
| `DELETE` con `old_record` solo con `id` | Normal con `replica identity default` | Opcional: `replica identity full` (aumenta el WAL). |
| `errors` con límite de tamaño | Filas muy grandes | Reducir columnas publicadas. |

## Qué no hacer

- No ejecutar `alter publication …`, `alter table … replica identity …` ni crear políticas desde esta guía.
- No probar con números de clientes reales ni pegar payloads en chats o tickets.
