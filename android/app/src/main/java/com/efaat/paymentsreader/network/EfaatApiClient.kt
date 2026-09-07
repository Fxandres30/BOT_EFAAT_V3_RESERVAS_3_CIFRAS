package com.efaat.paymentsreader.network

import com.efaat.paymentsreader.storage.CredentialStore
import com.efaat.paymentsreader.storage.PaymentMovementEntity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Único cliente HTTP de la app — habla exclusivamente con
 * POST /pagos/movimientos del backend EFAAT (ver
 * backend/pagos/pagosController.js, cuyo contrato de request/response se
 * refleja acá 1:1).
 *
 * NUNCA loguea el header Authorization ni la credencial en texto plano
 * (requisito 11 de P2) — si en el futuro se agrega un interceptor de
 * logging para depurar, debe redactar explícitamente ese header.
 */
class EfaatApiClient(private val credentialStore: CredentialStore) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun enviarMovimiento(movimiento: PaymentMovementEntity): SendResult {

        val baseUrl = credentialStore.backendBaseUrl
        val authHeader = credentialStore.headerAutorizacion()

        if (baseUrl.isNullOrBlank() || authHeader.isNullOrBlank()) {
            return SendResult.ErrorDefinitivo("Falta configurar la URL del backend o la credencial del dispositivo")
        }

        val cuerpoJson = JSONObject().apply {
            put("proveedor", movimiento.proveedor)
            put("valor", movimiento.valor ?: JSONObject.NULL)
            put("moneda", movimiento.moneda)
            put("fecha_hora_movimiento", movimiento.fechaHoraMovimientoIso)
            put("remitente_nombre", movimiento.remitenteNombre ?: JSONObject.NULL)
            put("remitente_cuenta", movimiento.remitenteCuenta ?: JSONObject.NULL)
            put("referencia", movimiento.referencia ?: JSONObject.NULL)
            put("texto_original", movimiento.textoOriginal)
        }

        val request = Request.Builder()
            .url("$baseUrl/pagos/movimientos")
            .header("Authorization", authHeader)
            .post(cuerpoJson.toString().toRequestBody(jsonMediaType))
            .build()

        return try {

            client.newCall(request).execute().use { response ->

                val cuerpoTexto = response.body?.string().orEmpty()

                when (response.code) {

                    201 -> {
                        val id = runCatching {
                            JSONObject(cuerpoTexto).optJSONObject("movimiento")?.optString("id")?.takeIf { it.isNotEmpty() }
                        }.getOrNull()
                        SendResult.Aceptado(id)
                    }

                    200 -> {
                        val json = runCatching { JSONObject(cuerpoTexto) }.getOrNull()
                        if (json?.optBoolean("duplicado") == true) {
                            SendResult.Duplicado(json.optString("movimientoOriginalId").takeIf { it.isNotEmpty() })
                        } else {
                            SendResult.ErrorReintentable("Respuesta 200 inesperada (sin duplicado=true)")
                        }
                    }

                    400, 401 -> SendResult.ErrorDefinitivo("HTTP ${response.code}: $cuerpoTexto")

                    else -> SendResult.ErrorReintentable("HTTP ${response.code}")

                }

            }

        } catch (e: IOException) {

            SendResult.ErrorReintentable(e.message ?: "Error de red")

        }
    }
}
