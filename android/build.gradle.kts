// Proyecto raíz de Android Studio para "EFAAT Payments Reader" (módulo P2
// del sistema de pagos de EFAAT_V3). Vive como tercera carpeta madre del
// repo, hermana de backend/ y frontend/ — no comparte toolchain con
// ninguna de las dos (Gradle/Kotlin vs npm/Node vs npm/Next.js).
//
// Un solo módulo: app/. Ver android/README.md para cómo abrir/compilar.

plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("org.jetbrains.kotlin.kapt") version "1.9.24" apply false
}
