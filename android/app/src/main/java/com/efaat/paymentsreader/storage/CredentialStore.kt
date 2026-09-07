package com.efaat.paymentsreader.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Guarda la credencial del dispositivo y la URL del backend en
 * EncryptedSharedPreferences, respaldado por una clave del Android
 * Keystore — nunca en texto plano en disco, nunca en el repo (esto es
 * 100% local al dispositivo, se configura a mano desde la pantalla de
 * ajustes de la app).
 *
 * La credencial se pega tal cual la entrega
 * `backend/pagos/crearDispositivo.js` / `rotarCredencialDispositivo.js`:
 * "<dispositivo_id>.<secreto>" (con o sin el prefijo "Bearer ", se
 * normaliza acá).
 *
 * IMPORTANTE: nunca loguear el valor de `credencial` en ningún punto del
 * código que la lea desde acá (ver EfaatApiClient — el interceptor de
 * logging, si se agrega en el futuro, debe redactar el header
 * Authorization).
 */
class CredentialStore(context: Context) {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "efaat_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    var backendBaseUrl: String?
        get() = prefs.getString(CLAVE_URL, null)
        set(value) = prefs.edit().putString(CLAVE_URL, value?.trimEnd('/')).apply()

    var credencialDispositivo: String?
        get() = prefs.getString(CLAVE_CREDENCIAL, null)
        set(value) = prefs.edit().putString(CLAVE_CREDENCIAL, normalizar(value)).apply()

    fun estaConfigurado(): Boolean =
        !backendBaseUrl.isNullOrBlank() && !credencialDispositivo.isNullOrBlank()

    /** Header Authorization completo, listo para usar. Null si falta configurar. */
    fun headerAutorizacion(): String? =
        credencialDispositivo?.takeIf { it.isNotBlank() }?.let { "Bearer $it" }

    private fun normalizar(valor: String?): String? =
        valor?.trim()?.removePrefix("Bearer ")?.removePrefix("bearer ")?.trim()

    companion object {
        private const val CLAVE_URL = "backend_base_url"
        private const val CLAVE_CREDENCIAL = "device_credential"
    }
}
