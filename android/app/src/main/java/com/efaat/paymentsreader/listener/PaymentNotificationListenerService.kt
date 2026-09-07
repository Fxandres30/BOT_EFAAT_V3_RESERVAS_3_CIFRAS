package com.efaat.paymentsreader.listener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.efaat.paymentsreader.model.PaymentMovement
import com.efaat.paymentsreader.model.SyncStatus
import com.efaat.paymentsreader.parser.ParserRegistry
import com.efaat.paymentsreader.storage.AppDatabase
import com.efaat.paymentsreader.storage.PaymentMovementEntity
import com.efaat.paymentsreader.sync.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.time.Instant

/**
 * ÚNICO punto de la app que recibe notificaciones de OTRAS apps —
 * requiere que el usuario lo habilite a mano en Ajustes > Acceso a
 * notificaciones (Android no tiene un diálogo de permiso runtime para
 * esto; MainActivity guía hacia esa pantalla).
 *
 * PRIVACIDAD (requisito explícito de P2): el paquete de origen se
 * comprueba ANTES de leer cualquier extra de la notificación. Si no está
 * en [ParserRegistry.paquetesConocidos], la notificación se descarta de
 * inmediato — nunca se lee su título/texto, nunca se guarda, nunca se
 * loguea su contenido.
 */
class PaymentNotificationListenerService : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val parserRegistry by lazy { ParserRegistry(packageName) }

    override fun onNotificationPosted(sbn: StatusBarNotification) {

        val paquete = sbn.packageName

        // Filtro de privacidad: cortar ACÁ, antes de tocar el contenido,
        // para cualquier app que no sea un proveedor de pago conocido (o
        // la propia app, para la notificación de prueba).
        if (paquete !in parserRegistry.paquetesConocidos) return

        val parser = parserRegistry.parserPara(paquete) ?: return

        val extras = sbn.notification.extras
        val titulo = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val texto = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val textoExpandido = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()

        val movimiento = parser.intentarParsear(
            paquete = paquete,
            titulo = titulo,
            texto = texto,
            textoExpandido = textoExpandido,
            capturadoEn = Instant.ofEpochMilli(sbn.postTime)
        ) ?: return // El parser decidió que esto no es un movimiento de dinero.

        scope.launch {
            guardarYEncolar(movimiento)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun guardarYEncolar(movimiento: PaymentMovement) {

        val entidad = PaymentMovementEntity(
            proveedor = movimiento.proveedor,
            valor = movimiento.valor,
            moneda = movimiento.moneda,
            fechaHoraMovimientoIso = movimiento.fechaHoraMovimiento.toString(),
            remitenteNombre = movimiento.remitenteNombre,
            remitenteCuenta = movimiento.remitenteCuenta,
            referencia = movimiento.referencia,
            textoOriginal = movimiento.textoOriginal,
            paqueteOrigen = movimiento.paqueteOrigen,
            hashLocal = calcularHashLocal(movimiento),
            capturadoEnMillis = movimiento.fechaHoraMovimiento.toEpochMilli(),
            estado = SyncStatus.PENDIENTE
        )

        val dao = AppDatabase.obtener(applicationContext).paymentMovementDao()
        val idInsertado = dao.insertar(entidad)

        // idInsertado == -1 significa que ya existía (mismo hashLocal) —
        // dedup de nivel dispositivo, ver PaymentMovementEntity. No se
        // vuelve a encolar ni a disparar sincronización en ese caso.
        if (idInsertado != -1L) {
            SyncWorker.dispararAhora(applicationContext)
        }
    }

    // Dedup local: mismo paquete + mismo texto original -> misma notificación.
    // No pretende ser el dedup autoritativo (eso lo hace el backend, por
    // tenant, con más señales — ver hash_duplicado en pagos_movimientos);
    // esto solo evita procesar dos veces la MISMA entrega del sistema
    // operativo para la MISMA instancia de notificación.
    private fun calcularHashLocal(movimiento: PaymentMovement): String {

        val crudo = "${movimiento.paqueteOrigen}|${movimiento.textoOriginal}"
        val bytes = MessageDigest.getInstance("SHA-256").digest(crudo.toByteArray())

        return bytes.joinToString("") { "%02x".format(it) }
    }
}
