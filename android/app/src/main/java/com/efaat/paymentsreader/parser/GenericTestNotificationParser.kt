package com.efaat.paymentsreader.parser

import com.efaat.paymentsreader.model.PaymentMovement
import java.time.Instant

/**
 * Parser de PRUEBA/DEPURACIÓN — reacciona a una notificación posteada por
 * la PROPIA app (botón "Enviar notificación de prueba" en MainActivity),
 * no a ninguna app bancaria real. Existe para validar el PRIMER OBJETIVO
 * de P2 de punta a punta (listener -> parser -> cola -> API -> Supabase)
 * sin depender de tener Nequi/Bancolombia/Daviplata instalados.
 *
 * No debe activarse con notificaciones de ninguna otra app: su único
 * paquete soportado es el de esta misma aplicación.
 */
class GenericTestNotificationParser(private val paqueteApp: String) : NotificationPaymentParser {

    override val paquetesSoportados = setOf(paqueteApp)

    override fun intentarParsear(
        paquete: String,
        titulo: String?,
        texto: String?,
        textoExpandido: String?,
        capturadoEn: Instant
    ): PaymentMovement? {

        val cuerpo = textoExpandido ?: texto ?: return null

        // Solo procesa notificaciones que la propia app marcó como de
        // prueba (ver MainActivity: siempre arrancan con este prefijo) —
        // así una notificación real de la propia app en el futuro (si
        // llegara a mostrar alguna) no se confunde con un movimiento.
        if (titulo?.startsWith(PREFIJO_PRUEBA) != true) return null

        return PaymentMovement(
            proveedor = "Prueba",
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

    companion object {
        const val PREFIJO_PRUEBA = "[EFAAT-PRUEBA]"
    }
}
