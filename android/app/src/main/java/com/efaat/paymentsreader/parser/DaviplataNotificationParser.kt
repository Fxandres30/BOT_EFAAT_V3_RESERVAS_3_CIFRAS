package com.efaat.paymentsreader.parser

import com.efaat.paymentsreader.model.PaymentMovement
import java.time.Instant

/**
 * Paquete real observado de Daviplata a la fecha de este código:
 * "com.digitalpaymentsolutions.daviplata". Verificar en el dispositivo
 * real si difiere — ver android/README.md.
 */
class DaviplataNotificationParser : NotificationPaymentParser {

    override val paquetesSoportados = setOf("com.digitalpaymentsolutions.daviplata")

    override fun intentarParsear(
        paquete: String,
        titulo: String?,
        texto: String?,
        textoExpandido: String?,
        capturadoEn: Instant
    ): PaymentMovement? {

        val cuerpo = textoExpandido ?: texto ?: return null

        val pareceMovimientoEntrante = Regex("recibiste|recibido|abono", RegexOption.IGNORE_CASE)
            .containsMatchIn("$titulo $cuerpo")

        if (!pareceMovimientoEntrante) return null

        return PaymentMovement(
            proveedor = "Daviplata",
            valor = ExtraccionUtils.extraerValor(cuerpo),
            moneda = "COP",
            fechaHoraMovimiento = capturadoEn,
            remitenteNombre = ExtraccionUtils.extraerRemitente(cuerpo),
            remitenteCuenta = null,
            referencia = ExtraccionUtils.extraerReferencia(cuerpo),
            textoOriginal = "$titulo\n$cuerpo".trim(),
            paqueteOrigen = paquete
        )
    }
}
