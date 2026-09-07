# EFAAT Payments Reader — Android (FASE P2)

Lector de notificaciones de pago (Nequi/Bancolombia/Daviplata/...) que
envía cada movimiento capturado al backend EFAAT (`POST /pagos/movimientos`,
ver `backend/pagos/README.md` — FASE P1, ya validada contra Supabase real).

**La app NO decide nada**: no aprueba/rechaza pagos, no asocia usuarios,
no toca reservas, no interpreta comprobantes, no usa IA. Solo captura,
normaliza y envía.

## Por qué es una carpeta separada

Este repo tenía dos carpetas madre (`backend/`, `frontend/`, ver
`README.md` de la raíz). `android/` es la tercera, hermana de esas dos —
toolchain completamente distinto (Gradle/Kotlin), no comparte nada de
código con backend/frontend salvo el CONTRATO de la API (P1).

## Arquitectura

```
listener/    PaymentNotificationListenerService — único punto que lee
             notificaciones de otras apps. Filtra por paquete ANTES de
             leer cualquier contenido (privacidad).
    ↓
parser/      Un NotificationPaymentParser por proveedor (Nequi,
             Bancolombia, Daviplata, + uno "de prueba"). Cada uno decide
             si el texto es realmente un movimiento y qué puede extraer
             con confianza — lo que no puede extraer, queda null.
    ↓
model/       PaymentMovement — espejo del body que espera POST /pagos/movimientos.
    ↓
storage/     Room (cola local persistente) + CredentialStore
             (EncryptedSharedPreferences, credencial cifrada con Android
             Keystore — nunca texto plano, nunca en un archivo del repo).
    ↓
network/     EfaatApiClient (OkHttp) — un solo endpoint, respuesta
             mapeada a SendResult (Aceptado/Duplicado/ErrorDefinitivo/ErrorReintentable).
    ↓
sync/        SyncWorker (WorkManager) — drena la cola, constraint
             NetworkType.CONNECTED (reintento automático al volver
             internet, sin código de conectividad manual).
```

`ui/` (MainActivity + HistoryAdapter) es solo una pantalla de
operación/depuración — toda la lógica real es independiente de la UI.

## Cómo abrir y compilar

1. Abrir la carpeta `android/` en Android Studio (no la raíz del repo).
2. El wrapper de Gradle (`gradlew`/`gradlew.bat`/`gradle-wrapper.jar`) no
   está commiteado a propósito (son binarios/scripts generados). Android
   Studio los genera solo al sincronizar; si no lo hace automáticamente,
   correr una vez `gradle wrapper --gradle-version 8.7` dentro de `android/`
   (requiere tener Gradle instalado) o dejar que Android Studio use su
   propio Gradle embebido para el primer sync.
3. `compileSdk`/`targetSdk` 34, `minSdk` 26 — instalar esos SDK Platforms
   desde el SDK Manager si Android Studio los pide.

## Primer objetivo de P2 — probarlo sin apps bancarias reales

1. Instalar la app en el teléfono (Run desde Android Studio, o generar un
   APK debug).
2. Abrir la app → botón **"Habilitar acceso a notificaciones"** → Android
   lleva a Ajustes → activar EFAAT Payments Reader en la lista (esto NO
   tiene diálogo de permiso normal, es una pantalla de Ajustes especial de
   Android — no hay forma de saltarse ese paso).
3. Pegar la **URL del backend** (ej. `http://192.168.1.10:4000` si el
   backend corre en tu red local) y la **credencial del dispositivo**
   (`<dispositivo_id>.<secreto>`, la que entrega
   `node backend/pagos/crearDispositivo.js` o
   `rotarCredencialDispositivo.js` — pegarla tal cual, con o sin el
   prefijo "Bearer "). Tocar **Guardar**. La credencial queda cifrada en
   el dispositivo; la app nunca la vuelve a mostrar completa.
4. Botón **"Enviar notificación de prueba"** → dispara una notificación
   LOCAL (posteada por la propia app) con un texto tipo Nequi de mentira
   ("Recibiste $ 15.000 de JUAN PEREZ. Ref: TEST-..."). El listener la
   detecta igual que detectaría una real, el parser de prueba
   (`GenericTestNotificationParser`) extrae valor y referencia, se encola
   y se envía.
5. El **historial** (debajo, en la misma pantalla) muestra el texto
   original completo y el estado (`PENDIENTE` → `ENVIADO`/`DUPLICADO`).
6. Repetir el paso 4 con el MISMO texto → debe verse `DUPLICADO`, no un
   segundo `ENVIADO` (dedup del backend, ver P1).

Esto valida el flujo completo: `CELULAR → notificación → detectada →
texto mostrado → referencia/valor extraídos → POST /pagos/movimientos →
Supabase`, sin depender de tener Nequi/Bancolombia instalados.

## Paquetes reales de las apps bancarias

Los `paquetesSoportados` de `NequiNotificationParser` /
`BancolombiaNotificationParser` / `DaviplataNotificationParser` usan los
nombres de paquete más comúnmente documentados a la fecha de este código
(`com.nequi.MobileApp`, `com.grupobancolombia.personas`,
`com.digitalpaymentsolutions.daviplata`). **Verificar en un dispositivo
real** antes de confiar en ellos (Ajustes > Apps > [banco] > Info de la
app, o `adb shell dumpsys package <nombre> | grep versionName` para
confirmar que ese es el paquete instalado) — si Android/Google Play
cambia el paquete, solo hay que actualizar la constante correspondiente,
nada más del pipeline cambia.

## Qué P2 NO hace (a propósito)

Aprobar/rechazar pagos, asociar usuarios, modificar reservas, marcar
números como pagados, interpretar comprobantes (OCR), usar IA, acceder a
credenciales bancarias, iniciar sesión en apps de bancos, o hacer
scraping de esas apps. La app solo lee las notificaciones que el sistema
operativo ya le entrega porque el usuario autorizó el acceso — nunca abre
ni interactúa con ninguna otra app.

## Privacidad

`PaymentNotificationListenerService.onNotificationPosted` comprueba el
paquete de origen **antes** de leer título/texto — cualquier notificación
de una app que no esté en `ParserRegistry.paquetesConocidos` se descarta
en la primera línea, sin loguearla ni guardarla.

## Seguridad de la credencial

- Se pega a mano en la pantalla de Ajustes de la app — nunca hardcodeada
  en el código ni en ningún archivo del repo.
- Se guarda con `EncryptedSharedPreferences` (Android Keystore, AES-256).
- Nunca se loguea (`EfaatApiClient` no imprime el header `Authorization`).
- Rotarla (si se filtró, o se perdió) se hace del lado del backend:
  `node backend/pagos/rotarCredencialDispositivo.js <dispositivo_id>` —
  ver `backend/pagos/README.md`.

## Siguientes fases (fuera del alcance de P2)

Pantalla propia en el panel web para dar de alta dispositivos desde la
UI (hoy es un script manual, ver P1), soporte multi-dispositivo por
usuario con nombres editables, más proveedores, mejoras de extracción
(regex más robustas, casos con texto multi-línea real de cada banco).
