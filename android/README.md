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

## Cómo compilar — CI (recomendado, sin instalar nada)

El flujo de trabajo real de este proyecto es **código → CI (GitHub
Actions) → APK**, sin depender de Android Studio, Java, Gradle ni el
Android SDK instalados localmente. Ver
`.github/workflows/android-build.yml`.

1. Hacer push a `main` tocando algo dentro de `android/` (o disparar el
   workflow a mano: pestaña **Actions** del repo en GitHub → *Android
   build (EFAAT Payments Reader)* → **Run workflow**).
2. El workflow: valida el Gradle Wrapper (checksum oficial), instala JDK
   17 + Android SDK (`platforms;android-34`, `build-tools;34.0.0`), corre
   `./gradlew test` (unit tests JVM de `parser/`, ver `app/src/test`) y
   luego `./gradlew assembleDebug`.
3. El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`
   dentro del runner, y se publica como:
   - **Artifact del run** (`EFAAT-Payments-Reader-debug-apk`, pestaña
     Actions del commit/run correspondiente, requiere sesión de GitHub,
     expira a los 30 días) — en todo push/PR/dispatch.
   - **Release `apk-latest`** (`EFAAT-Payments-Reader-debug.apk`,
     descargable con una URL pública fija, sin login) — solo en push a
     `main`. Ver la sección "Descarga desde el panel" más abajo.

El wrapper de Gradle (`gradlew`, `gradlew.bat`,
`gradle/wrapper/gradle-wrapper.jar`) **sí está commiteado** a propósito
— es justamente lo que permite compilar en un runner limpio sin tener
Gradle preinstalado. `distributionUrl` en
`gradle/wrapper/gradle-wrapper.properties` fija Gradle 8.7 (compatible
con AGP 8.5.2 + Kotlin 1.9.24 + JDK 17, ver `build.gradle.kts` /
`app/build.gradle.kts`).

### Descarga desde el panel

`frontend/components/pagos/LectorPagosPage` lee la URL del APK desde la
variable de entorno `NEXT_PUBLIC_APK_DOWNLOAD_URL` (ver `.env.local`).
Una vez que el workflow de arriba corrió con éxito al menos una vez en
`main`, esa URL es:

```
https://github.com/Fxandres30/BOT_EFAAT_V3_RESERVAS_3_CIFRAS/releases/download/apk-latest/EFAAT-Payments-Reader-debug.apk
```

Mientras esa variable no esté configurada, el botón "Descargar
aplicación" del panel se muestra deshabilitado con la etiqueta
"Próximamente" — nunca apunta a una URL inventada ni a `localhost`.

### Cómo compilar localmente (opcional, si igual querés instalar el SDK)

`compileSdk`/`targetSdk` 34, `minSdk` 26. Con Android Studio instalado,
simplemente abrir la carpeta `android/` (no la raíz del repo) y dejar que
sincronice — usa el mismo wrapper commiteado. Sin Android Studio, con
JDK 17 y el Android SDK ya instalados y `ANDROID_HOME` configurado:

```bash
cd android
./gradlew assembleDebug      # Linux/Mac
gradlew.bat assembleDebug    # Windows
```

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

## Tests

`app/src/test/java/.../parser/ExtraccionUtilsTest.kt` — unit tests JVM
puros (sin Robolectric, sin emulador) sobre las expresiones regulares
compartidas de extracción (valor/referencia/remitente). Corren en CI con
`./gradlew test`.

**No hay tests instrumentados (`androidTest`) todavía** — probar
`PaymentNotificationListenerService`, `AppDatabase` (Room) o
`CredentialStore` (EncryptedSharedPreferences/Keystore) de punta a punta
requiere un emulador o dispositivo real corriendo Android, lo que un
runner estándar de GitHub Actions no trae por defecto (existen acciones
como `reactivecircus/android-emulator-runner` para esto, pero son
notablemente más lentas y no se agregaron en esta fase — documentado acá
a propósito en vez de ocultarlo).

## Siguientes fases (fuera del alcance de P2)

Pantalla propia en el panel web para dar de alta dispositivos desde la
UI (hoy es un script manual, ver P1), soporte multi-dispositivo por
usuario con nombres editables, más proveedores, mejoras de extracción
(regex más robustas, casos con texto multi-línea real de cada banco).
