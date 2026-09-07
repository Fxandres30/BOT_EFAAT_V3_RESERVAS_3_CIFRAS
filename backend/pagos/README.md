# Módulo de Pagos — FASE P1

Infraestructura mínima para recibir movimientos de pago capturados por una
futura app Android (lectura de notificaciones bancarias con permiso
explícito del usuario) y guardarlos en Supabase para revisión posterior.

```
ANDROID  →  POST /pagos/movimientos  →  BACKEND EFAAT  →  SUPABASE  →  (panel, en P2)
```

**P1 no verifica pagos, no asocia usuarios automáticamente, no toca
reservas ni marca números como pagados.** Es solo ingesta cruda y segura.

## Arquitectura P1

```
backend/
├── routes/pagos.js                       Router Express, monta las 2 rutas
├── pagos/
│   ├── autenticacionDispositivo.js       Middleware: valida Bearer <id>.<secreto>
│   ├── pagosController.js                POST /movimientos, GET /movimientos
│   ├── credenciales.js                   Generar/hashear/verificar secreto (scrypt)
│   ├── hashDuplicado.js                  Hash determinista de deduplicación
│   ├── crearDispositivo.js               Script manual para dar de alta un dispositivo
│   └── README.md                         Este archivo
├── supabase_migrations/
│   └── 005_pagos_p1.sql                  Tablas pagos_dispositivos y pagos_movimientos
└── tests/pagos/
    ├── fakeSupabasePagos.js
    ├── entornoFakePagos.js
    └── pagosP1.test.js
```

No se modificó ningún archivo de reservas, eventos, usuarios, sesiones de
WhatsApp, grupos, mensajes, intención del BOT ni workers existentes. El
único archivo compartido tocado fue `server.js`, con una única línea
adicional para montar `/pagos` (igual que ya monta `/sessions`).

## Flujo Android → API → Supabase

1. Se crea un dispositivo con `node backend/pagos/crearDispositivo.js <usuario_id> "<nombre>"`
   (no hay endpoint HTTP de alta todavía — no existe panel de Pagos, ver P2).
   Esto imprime la credencial en texto plano **una sola vez**.
2. La app Android guarda esa credencial y la envía en cada petición:
   `Authorization: Bearer <dispositivo_id>.<secreto>`.
3. `POST /pagos/movimientos` recibe el JSON con los datos extraídos de la
   notificación, autentica el dispositivo, resuelve `usuario_id` y
   `dispositivo_id` **desde la base de datos** (nunca desde el body),
   calcula el hash de deduplicación, e inserta en `pagos_movimientos` con
   `estado='pendiente'` (o `'duplicado'` si ya existía).
4. `GET /pagos/movimientos` (uso interno de pruebas por ahora) lista los
   movimientos del mismo tenant autenticado, para verificar que llegaron.

## Autenticación del dispositivo

No existía ningún middleware de autenticación HTTP en este backend antes
de esto (`routes/sessions.js` no tiene ninguno) — es exclusivo de `/pagos`.

- Credencial: `<dispositivo_id>.<secreto_plano>` en el header
  `Authorization: Bearer`.
- `dispositivo_id` permite un lookup directo por índice; `secreto_plano`
  se verifica con `crypto.scrypt` (nativo de Node, sin dependencias
  nuevas) + `crypto.timingSafeEqual` contra `pagos_dispositivos.credencial_hash`.
- **El secreto en texto plano nunca se guarda** — solo `"<salt>:<hash>"`.
  Si se pierde, no se puede recuperar: hay que crear un dispositivo nuevo
  y desactivar el anterior (`activo=false`).
- `usuario_id` y `dispositivo_id` se resuelven **siempre** desde la fila
  de `pagos_dispositivos` ya autenticada — el body de la petición nunca
  se usa para determinar el tenant. Esto garantiza que un dispositivo
  jamás pueda enviar movimientos "a nombre" de otro `usuario_id`, sin
  importar qué mande el cliente (probado explícitamente en
  `tests/pagos/pagosP1.test.js`, caso 4).
- Un dispositivo inactivo (`activo=false`) o con secreto incorrecto
  reciben la **misma** respuesta 401 genérica, a propósito, para no
  revelar a un atacante cuál de los dos casos ocurrió.

## Deduplicación

`hash_duplicado` (ver `backend/pagos/hashDuplicado.js`) se calcula a partir
de: `usuario_id, proveedor (normalizado), valor, fecha_hora_movimiento
(redondeada al minuto), referencia (normalizada), remitente_cuenta
(normalizada)`.

La garantía de "nunca dos movimientos independientes para el mismo hecho"
es **atómica a nivel de Postgres**, no un "buscar → comprobar → insertar"
desde Node (esa clase de carrera ya causó un bug real en la fase de
sesiones de este mismo proyecto — ver `services/baileys/socket.js`):

- Índice único parcial: `unique (usuario_id, hash_duplicado) WHERE estado <> 'duplicado'`.
- El backend intenta insertar siempre con `estado='pendiente'`. Si
  Postgres devuelve `23505` (unique_violation) — el mismo código que ya
  maneja `bot/funciones/usuarios/obtenerUsuarioGlobal.js` para colisiones
  de usuario — el backend localiza el movimiento original y **inserta el
  intento actual como una fila `estado='duplicado'`, enlazada por
  `duplicado_de_id`** al original. Nunca se descarta en silencio (queda
  auditable) ni se cuenta como un movimiento nuevo independiente.

**Limitaciones documentadas (aceptadas para P1):**
- Sin `referencia` (algunos bancos no la incluyen), el hash cae a
  proveedor+valor+minuto+remitente_cuenta — dos movimientos reales y
  distintos con esos 4 datos idénticos en el mismo minuto se
  confundirían como duplicado. P2/P3 podrán sumar más señales
  (`texto_original` completo, ventana más fina, etc.).
- Redondear al minuto es intencional: tolera pequeñas diferencias de cómo
  Android serializa el timestamp entre reintentos del mismo evento.

## Qué P1 NO hace todavía

- No crea la app Android (solo el backend que la recibirá).
- No asocia automáticamente un movimiento a un usuario/comprador
  (`usuarios`/`usuario_global_id`).
- No hace matching contra reservas ni tablas dinámicas de eventos.
- No procesa comprobantes, OCR, ni usa IA para pagos.
- No marca ninguna reserva/número como `pagado`.
- No implementa `pagoWorker` ni `androidWorker` (siguen comentados en
  `bot/workers/index.js`, sin tocar).
- No tiene realtime en el frontend ni página `/pagos` en el panel.
- No integra Nequi/Bancolombia/Daviplata (la app Android sigue sin existir).
- `GET /pagos/movimientos` es solo para pruebas internas del backend —
  no está pensado para ser consumido por el panel todavía.

## Siguientes fases

- **P2** — Panel de revisión manual: página `/pagos` en el frontend (clon
  del patrón de `/tablas`), políticas RLS `auth.uid()=usuario_id` para que
  el panel pueda leer directo desde Supabase, endpoint de alta de
  dispositivos desde la UI, ampliar `estado` con `'asociado'`.
- **P3** — Matching automático + `pagos_cuentas_usuario`: proponer
  coincidencias con `usuarios` (reutilizando la lógica de
  `obtenerUsuarioGlobal.js`), el admin solo confirma/rechaza.
- **P4** — Verificación contra reservas: cruzar movimientos confirmados
  contra la tabla dinámica del evento correspondiente y escribir
  `estado='pagado'` en esa tabla (reutilizando el valor ya consumido por
  `verificarTodosPagados.js`), sin inventar un estado paralelo.
