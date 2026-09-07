package com.efaat.paymentsreader.model

import java.time.Instant

/**
 * Movimiento de pago normalizado, ya extraído de una notificación —
 * espejo exacto del body que espera POST /pagos/movimientos en el backend
 * (ver backend/pagos/pagosController.js). Campos que la notificación no
 * traía quedan en null — NUNCA se inventan (requisito explícito de P2).
 *
 * `textoOriginal` es el único campo que SIEMPRE debe estar presente y
 * SIEMPRE se conserva completo, tal cual lo entregó Android — es la
 * fuente de verdad si el resto del parseo resulta incompleto.
 */
data class PaymentMovement(
    val proveedor: String,
    val valor: Double?,
    val moneda: String = "COP",
    val fechaHoraMovimiento: Instant,
    val remitenteNombre: String? = null,
    val remitenteCuenta: String? = null,
    val referencia: String? = null,
    val textoOriginal: String,
    val paqueteOrigen: String
)
