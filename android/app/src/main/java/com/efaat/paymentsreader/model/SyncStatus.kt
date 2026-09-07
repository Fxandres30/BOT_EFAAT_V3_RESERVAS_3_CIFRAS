package com.efaat.paymentsreader.model

/**
 * Estado de sincronización de un movimiento capturado localmente, contra
 * el backend EFAAT (POST /pagos/movimientos).
 */
enum class SyncStatus {
    /** Todavía no se intentó enviar, o falló con un error reintentable. */
    PENDIENTE,

    /** El backend respondió 201 — aceptado como movimiento nuevo. */
    ENVIADO,

    /** El backend respondió 200 con duplicado=true — ya existía. */
    DUPLICADO,

    /** Error de red o 5xx — se reintentará automáticamente (WorkManager). */
    ERROR_REINTENTABLE,

    /**
     * Error definitivo (4xx que no es de red/servidor: credencial
     * inválida, campos rechazados) — reintentar con los MISMOS datos no
     * cambiaría el resultado. Queda visible en el historial para
     * depuración, no se reintenta solo.
     */
    ERROR_DEFINITIVO
}
