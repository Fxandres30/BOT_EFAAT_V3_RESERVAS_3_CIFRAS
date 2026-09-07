package com.efaat.paymentsreader.parser

import com.efaat.paymentsreader.model.PaymentMovement
import java.time.Instant

/**
 * Contrato que implementa cada proveedor (Nequi, Bancolombia, Daviplata,
 * ...). NO se asume que todos los proveedores comparten formato — cada
 * uno interpreta el texto a su manera y decide si la notificación es
 * realmente un movimiento de dinero o no (puede devolver null: por
 * ejemplo, una notificación promocional de la misma app bancaria NO debe
 * convertirse en un PaymentMovement).
 *
 * Regla dura para toda implementación: si un campo no se puede extraer
 * con confianza, se deja null. Nunca se inventa ni se adivina un valor.
 */
interface NotificationPaymentParser {

    /** Nombres de paquete de Android que este parser sabe interpretar. */
    val paquetesSoportados: Set<String>

    /**
     * Intenta interpretar una notificación ya confirmada como proveniente
     * de uno de [paquetesSoportados]. `capturadoEn` es el instante en que
     * el listener recibió la notificación (fallback de fecha si el texto
     * no trae una fecha propia parseable).
     *
     * Devuelve null si el parser determina que esta notificación puntual
     * NO es un movimiento de dinero (ej: notificación de marketing).
     */
    fun intentarParsear(
        paquete: String,
        titulo: String?,
        texto: String?,
        textoExpandido: String?,
        capturadoEn: Instant
    ): PaymentMovement?
}
