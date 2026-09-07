package com.efaat.paymentsreader.storage

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface PaymentMovementDao {

    /**
     * Ignora silenciosamente si ya existe una fila con el mismo
     * `hashLocal` (índice único) — dedup de nivel dispositivo. Devuelve
     * -1 cuando se ignoró.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertar(movimiento: PaymentMovementEntity): Long

    @Update
    suspend fun actualizar(movimiento: PaymentMovementEntity)

    @Query("SELECT * FROM payment_movements WHERE estado IN ('PENDIENTE', 'ERROR_REINTENTABLE') ORDER BY capturadoEnMillis ASC")
    suspend fun obtenerPendientes(): List<PaymentMovementEntity>

    @Query("SELECT * FROM payment_movements ORDER BY capturadoEnMillis DESC LIMIT 200")
    fun observarHistorial(): Flow<List<PaymentMovementEntity>>
}
