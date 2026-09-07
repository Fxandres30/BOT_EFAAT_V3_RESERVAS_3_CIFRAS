package com.efaat.paymentsreader.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.efaat.paymentsreader.model.SyncStatus
import com.efaat.paymentsreader.network.EfaatApiClient
import com.efaat.paymentsreader.network.SendResult
import com.efaat.paymentsreader.storage.AppDatabase
import com.efaat.paymentsreader.storage.CredentialStore
import java.util.concurrent.TimeUnit

/**
 * Drena la cola local (estado PENDIENTE o ERROR_REINTENTABLE) e intenta
 * enviar cada movimiento a POST /pagos/movimientos, uno por uno,
 * actualizando su estado según la respuesta real del backend.
 *
 * Requisito 13 (cola local + reintento cuando vuelva internet): resuelto
 * por la constraint NetworkType.CONNECTED al programar el trabajo — el
 * propio sistema operativo no ejecuta este Worker hasta que hay
 * conexión, así que no hace falta ningún BroadcastReceiver de
 * conectividad manual.
 *
 * Cada fila decide su PROPIO resultado (éxito/duplicado/error) — el
 * Worker en sí siempre devuelve success() tras intentar todas las
 * pendientes; la siguiente ejecución periódica (o la disparada tras la
 * próxima captura) recogerá lo que haya quedado en PENDIENTE/ERROR_REINTENTABLE.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {

        val db = AppDatabase.obtener(applicationContext)
        val dao = db.paymentMovementDao()
        val apiClient = EfaatApiClient(CredentialStore(applicationContext))

        val pendientes = dao.obtenerPendientes()

        for (movimiento in pendientes) {

            // Sin proveedor/valor/texto_original el backend rechazaría con
            // 400 CAMPOS_INCOMPLETOS de forma segura e inmediata (ver
            // pagosController.js) — se marca así localmente sin gastar una
            // llamada de red, quedando igual visible en el historial para
            // depurar por qué el parser no extrajo ese campo.
            if (movimiento.valor == null || movimiento.proveedor.isBlank() || movimiento.textoOriginal.isBlank()) {

                dao.actualizar(
                    movimiento.copy(
                        estado = SyncStatus.ERROR_DEFINITIVO,
                        ultimoError = "Faltan campos obligatorios extraídos por el parser (valor/proveedor/texto)"
                    )
                )
                continue

            }

            when (val resultado = apiClient.enviarMovimiento(movimiento)) {

                is SendResult.Aceptado -> dao.actualizar(
                    movimiento.copy(
                        estado = SyncStatus.ENVIADO,
                        movimientoBackendId = resultado.movimientoId,
                        ultimoError = null,
                        intentos = movimiento.intentos + 1
                    )
                )

                is SendResult.Duplicado -> dao.actualizar(
                    movimiento.copy(
                        estado = SyncStatus.DUPLICADO,
                        movimientoBackendId = resultado.movimientoOriginalId,
                        ultimoError = null,
                        intentos = movimiento.intentos + 1
                    )
                )

                is SendResult.ErrorDefinitivo -> dao.actualizar(
                    movimiento.copy(
                        estado = SyncStatus.ERROR_DEFINITIVO,
                        ultimoError = resultado.mensaje,
                        intentos = movimiento.intentos + 1
                    )
                )

                is SendResult.ErrorReintentable -> dao.actualizar(
                    movimiento.copy(
                        estado = SyncStatus.ERROR_REINTENTABLE,
                        ultimoError = resultado.mensaje,
                        intentos = movimiento.intentos + 1
                    )
                )
            }
        }

        return Result.success()
    }

    companion object {

        private const val TRABAJO_UNICO = "efaat_sync_periodico"
        private const val TRABAJO_INMEDIATO = "efaat_sync_inmediato"

        private fun constraints() = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** Llamar una vez al iniciar la app (ver EfaatPaymentsReaderApp). */
        fun programarPeriodico(context: Context) {

            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints())
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(TRABAJO_UNICO, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Llamar justo después de encolar un movimiento nuevo, para intentar enviarlo ya mismo si hay internet. */
        fun dispararAhora(context: Context) {

            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints())
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(TRABAJO_INMEDIATO, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
