package com.efaat.paymentsreader.storage

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.efaat.paymentsreader.model.PaymentMovement
import com.efaat.paymentsreader.model.SyncStatus
import java.time.Instant

/**
 * Fila de la cola local. `hashLocal` es un dedup de nivel DISPOSITIVO
 * (distinto del hash_duplicado del backend, que dedup por TENANT) — evita
 * encolar dos veces la misma notificación si el sistema operativo la
 * vuelve a entregar (Android a veces reemite onNotificationPosted para la
 * misma notificación, p. ej. al actualizarla). El índice único +
 * OnConflictStrategy.IGNORE en el DAO hacen que un segundo intento de
 * insertar el mismo hashLocal simplemente no haga nada, sin error.
 */
@Entity(
    tableName = "payment_movements",
    indices = [Index(value = ["hashLocal"], unique = true)]
)
data class PaymentMovementEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    val proveedor: String,
    val valor: Double?,
    val moneda: String,

    @ColumnInfo(name = "fecha_hora_movimiento")
    val fechaHoraMovimientoIso: String,

    val remitenteNombre: String?,
    val remitenteCuenta: String?,
    val referencia: String?,
    val textoOriginal: String,
    val paqueteOrigen: String,

    val hashLocal: String,

    val capturadoEnMillis: Long,

    val estado: SyncStatus,
    val intentos: Int = 0,
    val ultimoError: String? = null,

    /** id devuelto por el backend una vez aceptado (estado ENVIADO/DUPLICADO). */
    val movimientoBackendId: String? = null
)

fun PaymentMovementEntity.toDomain(): PaymentMovement = PaymentMovement(
    proveedor = proveedor,
    valor = valor,
    moneda = moneda,
    fechaHoraMovimiento = Instant.parse(fechaHoraMovimientoIso),
    remitenteNombre = remitenteNombre,
    remitenteCuenta = remitenteCuenta,
    referencia = referencia,
    textoOriginal = textoOriginal,
    paqueteOrigen = paqueteOrigen
)
