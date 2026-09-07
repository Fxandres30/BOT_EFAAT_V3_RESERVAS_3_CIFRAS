package com.efaat.paymentsreader.storage

import androidx.room.TypeConverter
import com.efaat.paymentsreader.model.SyncStatus

class Converters {

    @TypeConverter
    fun fromSyncStatus(estado: SyncStatus): String = estado.name

    @TypeConverter
    fun toSyncStatus(valor: String): SyncStatus = SyncStatus.valueOf(valor)
}
