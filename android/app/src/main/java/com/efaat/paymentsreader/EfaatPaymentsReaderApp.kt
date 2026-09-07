package com.efaat.paymentsreader

import android.app.Application
import com.efaat.paymentsreader.sync.SyncWorker

class EfaatPaymentsReaderApp : Application() {

    override fun onCreate() {
        super.onCreate()

        // Red de seguridad: aunque cada captura dispara un intento
        // inmediato (SyncWorker.dispararAhora), este trabajo periódico
        // asegura que nada quede varado en PENDIENTE/ERROR_REINTENTABLE
        // si, por ejemplo, el intento inmediato falló y no hubo ninguna
        // captura nueva que lo reintentara.
        SyncWorker.programarPeriodico(this)
    }
}
