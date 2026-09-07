package com.efaat.paymentsreader.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.efaat.paymentsreader.databinding.ItemMovementBinding
import com.efaat.paymentsreader.storage.PaymentMovementEntity
import java.text.NumberFormat
import java.util.Locale

class HistoryAdapter : ListAdapter<PaymentMovementEntity, HistoryAdapter.ViewHolder>(DIFF) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemMovementBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class ViewHolder(private val binding: ItemMovementBinding) : RecyclerView.ViewHolder(binding.root) {

        private val formatoMoneda = NumberFormat.getCurrencyInstance(Locale("es", "CO"))

        fun bind(item: PaymentMovementEntity) {

            val valorTexto = item.valor?.let { formatoMoneda.format(it) } ?: "(sin valor detectado)"
            binding.txtProveedorValor.text = "${item.proveedor} — $valorTexto"

            binding.txtEstado.text = "Estado: ${item.estado}" +
                (item.ultimoError?.let { " — $it" } ?: "")

            binding.txtReferencia.text = "Referencia: ${item.referencia ?: "(sin referencia)"}" +
                (item.remitenteNombre?.let { " · De: $it" } ?: "")

            binding.txtTextoOriginal.text = item.textoOriginal
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<PaymentMovementEntity>() {
            override fun areItemsTheSame(oldItem: PaymentMovementEntity, newItem: PaymentMovementEntity) =
                oldItem.id == newItem.id

            override fun areContentsTheSame(oldItem: PaymentMovementEntity, newItem: PaymentMovementEntity) =
                oldItem == newItem
        }
    }
}
