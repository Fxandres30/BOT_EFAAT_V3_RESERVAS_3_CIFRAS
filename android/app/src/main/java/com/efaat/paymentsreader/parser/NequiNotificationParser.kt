package com.efaat.paymentsreader.parser

import com.efaat.paymentsreader.model.PaymentMovement
import java.time.Instant

/**
 * Paquete real observado de la app Nequi en Google Play a la fecha de
 * este código: "com.nequi.MobileApp". Verificar en el dispositivo real
 * (Ajustes > Apps > Nequi > detalles avanzados) si difiere — ver
 * android/README.md sobre cómo confirmar/ajustar esto.
 */
class NequiNotificationParser : NotificationPaymentParser {

    override val paquetesSoportados = setOf("com.nequi.MobileApp")

    override fun intentarParsear(
        paquete: String,
        titulo: String?,
        texto: String?,
        textoExpandido: String?,
        capturadoEn: Instant
    ): PaymentMovement? {

        val cuerpo = textoExpandido ?: texto ?: return null

        // Nequi notifica "recibiste"/"te llegó" para movimientos entrantes.
        // Si el texto no sugiere un ingreso de dinero, no se interpreta
        // como movimiento (podría ser una promoción, un recordatorio, etc.).
        val pareceMovimientoEntrante = Regex("recibiste|te lleg", RegexOption.IGNORE_CASE)
            .containsMatchIn("$titulo $cuerpo")

        if (!pareceMovimientoEntrante) return null

        return PaymentMovement(
            proveedor = "Nequi",
            valor = ExtraccionUtils.extraerValor(cuerpo),
            moneda = "COP",
            fechaHoraMovimiento = capturadoEn,
            remitenteNombre = ExtraccionUtils.extraerRemitente(cuerpo),
            remitenteCuenta = null, // Nequi normalmente no expone la cuenta del remitente en la notificación.
            referencia = ExtraccionUtils.extraerReferencia(cuerpo),
            textoOriginal = "$titulo\n$cuerpo".trim(),
            paqueteOrigen = paquete
        )
    }
}
