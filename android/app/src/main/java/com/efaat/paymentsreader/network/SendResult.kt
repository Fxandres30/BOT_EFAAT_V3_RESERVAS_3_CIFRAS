package com.efaat.paymentsreader.network

/**
 * Resultado tipado de intentar enviar un movimiento a
 * POST /pagos/movimientos, mapeado 1:1 desde la respuesta HTTP real del
 * backend (ver backend/pagos/pagosController.js):
 *
 *   201 -> Aceptado
 *   200 con duplicado:true -> Duplicado
 *   401/400 (credencial o datos rechazados) -> ErrorDefinitivo (reintentar
 *       con los MISMOS datos no cambia el resultado)
 *   errores de red / 5xx -> ErrorReintentable
 */
sealed class SendResult {
    data class Aceptado(val movimientoId: String?) : SendResult()
    data class Duplicado(val movimientoOriginalId: String?) : SendResult()
    data class ErrorDefinitivo(val mensaje: String) : SendResult()
    data class ErrorReintentable(val mensaje: String) : SendResult()
}
