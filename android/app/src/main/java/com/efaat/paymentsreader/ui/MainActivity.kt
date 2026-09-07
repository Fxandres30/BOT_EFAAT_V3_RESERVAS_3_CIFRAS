package com.efaat.paymentsreader.ui

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.efaat.paymentsreader.R
import com.efaat.paymentsreader.databinding.ActivityMainBinding
import com.efaat.paymentsreader.parser.GenericTestNotificationParser
import com.efaat.paymentsreader.storage.AppDatabase
import com.efaat.paymentsreader.storage.CredentialStore
import com.efaat.paymentsreader.sync.SyncWorker
import kotlinx.coroutines.launch

/**
 * Única Activity de P2 — es solo una pantalla de operación/depuración
 * (permiso, credencial, prueba, historial). Toda la lógica real vive en
 * listener/, parser/, storage/, network/, sync/, independiente de esta UI.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var credentialStore: CredentialStore
    private val adapter = HistoryAdapter()

    private val solicitarPermisoNotificaciones = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* si se niega, el botón de prueba simplemente no podrá postear la notificación local */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        credentialStore = CredentialStore(applicationContext)

        crearCanalDeNotificacionDePrueba()
        configurarHistorial()
        cargarConfiguracionGuardada()

        binding.btnAbrirAjustesListener.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        binding.btnGuardarConfiguracion.setOnClickListener {
            guardarConfiguracion()
        }

        binding.btnNotificacionPrueba.setOnClickListener {
            enviarNotificacionDePrueba()
        }

        binding.btnForzarSincronizacion.setOnClickListener {
            SyncWorker.dispararAhora(applicationContext)
        }
    }

    override fun onResume() {
        super.onResume()
        actualizarEstadoListener()
    }

    // ---------------------------------------------------------------
    // Acceso a notificaciones (Notification Listener)
    // ---------------------------------------------------------------

    private fun actualizarEstadoListener() {

        val habilitado = NotificationManagerCompat.getEnabledListenerPackages(this)
            .contains(packageName)

        binding.txtEstadoListener.text = getString(
            if (habilitado) R.string.estado_listener_activo else R.string.estado_listener_inactivo
        )

        binding.btnAbrirAjustesListener.isEnabled = !habilitado
    }

    // ---------------------------------------------------------------
    // Configuración (URL del backend + credencial del dispositivo)
    // ---------------------------------------------------------------

    private fun cargarConfiguracionGuardada() {

        binding.edtUrlBackend.setText(credentialStore.backendBaseUrl.orEmpty())

        // La credencial NUNCA se vuelve a mostrar completa una vez
        // guardada — solo se indica que ya hay una configurada. Si el
        // usuario quiere cambiarla, escribe una nueva y la pisa.
        if (!credentialStore.credencialDispositivo.isNullOrBlank()) {
            binding.edtCredencial.hint = "•••••••• (ya configurada — escribí una nueva para reemplazarla)"
        }
    }

    private fun guardarConfiguracion() {

        val url = binding.edtUrlBackend.text?.toString()?.trim().orEmpty()
        val credencialIngresada = binding.edtCredencial.text?.toString()?.trim().orEmpty()

        if (url.isBlank()) {
            binding.txtEstadoConfiguracion.text = getString(R.string.configuracion_incompleta)
            return
        }

        credentialStore.backendBaseUrl = url

        // Si el campo de credencial quedó vacío, se conserva la que ya
        // estaba guardada (permite editar solo la URL sin tener que
        // volver a pegar la credencial).
        if (credencialIngresada.isNotBlank()) {
            credentialStore.credencialDispositivo = credencialIngresada
            binding.edtCredencial.text?.clear()
        }

        binding.txtEstadoConfiguracion.text =
            if (credentialStore.estaConfigurado()) getString(R.string.configuracion_guardada)
            else getString(R.string.configuracion_incompleta)

        cargarConfiguracionGuardada()
    }

    // ---------------------------------------------------------------
    // Notificación de prueba — valida el flujo completo sin depender de
    // tener una app bancaria real instalada (ver GenericTestNotificationParser).
    // ---------------------------------------------------------------

    private fun crearCanalDeNotificacionDePrueba() {

        val canal = NotificationChannel(
            CANAL_PRUEBA,
            "Notificaciones de prueba EFAAT",
            NotificationManager.IMPORTANCE_DEFAULT
        )

        getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
    }

    private fun enviarNotificacionDePrueba() {

        if (Build.VERSION.SDK_INT >= 33 &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            solicitarPermisoNotificaciones.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }

        val referenciaFalsa = "TEST-${System.currentTimeMillis()}"

        val notificacion = NotificationCompat.Builder(this, CANAL_PRUEBA)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("${GenericTestNotificationParser.PREFIJO_PRUEBA} Nequi")
            .setContentText("Recibiste $ 15.000 de JUAN PEREZ. Ref: $referenciaFalsa")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        NotificationManagerCompat.from(this).notify(System.currentTimeMillis().toInt(), notificacion)
    }

    // ---------------------------------------------------------------
    // Historial de depuración
    // ---------------------------------------------------------------

    private fun configurarHistorial() {

        binding.recyclerHistorial.layoutManager = LinearLayoutManager(this)
        binding.recyclerHistorial.adapter = adapter

        val dao = AppDatabase.obtener(applicationContext).paymentMovementDao()

        lifecycleScope.launch {
            dao.observarHistorial().collect { lista ->
                adapter.submitList(lista)
                binding.txtHistorialVacio.visibility =
                    if (lista.isEmpty()) android.view.View.VISIBLE else android.view.View.GONE
            }
        }
    }

    companion object {
        private const val CANAL_PRUEBA = "efaat_pruebas"
    }
}
