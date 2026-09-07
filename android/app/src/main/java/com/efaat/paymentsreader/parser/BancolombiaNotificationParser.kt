package com.efaat.paymentsreader.parser

import com.efaat.paymentsreader.model.PaymentMovement
import java.time.Instant

/**
 * Paquete real observado de "Bancolombia Personas" a la fecha de este
 * código: "com.grupobancolombia.personas". Verificar en el dispositivo
 * real si difiere — ver android/README.md.
 */
class BancolombiaNotificationParser : NotificationPaymentParser {

    override val paquetesSoportados = setOf("com.grupobancolombia.personas")

    override fun intentarParsear(
        paquete: String,
        titulo: String?,
        texto: String?,
        textoExpandido: String?,
        capturadoEn: Instant
    ): PaymentMovement? {

        val cuerpo = textoExpandido ?: texto ?: return null

        val pareceMovimientoEntrante = Regex("consignaci|transferencia recibida|abono", RegexOption.IGNORE_CASE)
            .containsMatchIn("$titulo $cuerpo")

        if (!pareceMovimientoEntrante) return null

        return PaymentMovement(
            proveedor = "Bancolombia",
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
