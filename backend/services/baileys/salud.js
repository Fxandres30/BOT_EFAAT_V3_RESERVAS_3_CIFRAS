// ==========================================================================
// salud.js — estado REAL de cada sesión de WhatsApp para el panel.
//
// "Conectada a WhatsApp" no es lo mismo que "el bot está funcionando". Este
// módulo junta, por sesión, las señales internas que sí lo demuestran:
//   - socket: existe en este proceso y está open (cicloSocket.js);
//   - listener de mensajes registrado sobre ESE socket (messages.upsert.js);
//   - worker de eventos haciendo ciclos (iniciarWorkerEventos.js);
//   - mensajes procesados sin error vs. errores seguidos (dispatcher.js);
//   - lease propio renovándose (lease.js) o en manos de otra instancia.
//
// La AUSENCIA de mensajes nunca degrada la salud (un grupo puede estar en
// silencio horas): solo cuentan errores y piezas que faltan o se detienen.
// Solo memoria del proceso: sin escrituras en Supabase.
// ==========================================================================

const registros = new Map();

const UMBRAL_WORKER_MS = 3 * 60 * 1000;   // el worker cicla cada 30 s
const UMBRAL_ERRORES = 5;                  // errores de proceso seguidos
const UMBRAL_LEASE = 3;                    // heartbeats seguidos con error

function reg(sessionId) {
    if (!registros.has(sessionId)) registros.set(sessionId, { errores: 0, recuperaciones: [] });
    return registros.get(sessionId);
}

const ahoraIso = () => new Date().toISOString();

function marcarConexion(sessionId, estado) {
    const r = reg(sessionId);
    r.ultimaConexion = { estado, en: ahoraIso() };
    if (estado === "open") r.conectadoEn = ahoraIso();
}

function marcarListener(sessionId, sock) {
    const r = reg(sessionId);
    r.listenerSocket = sock || null;
    r.listenerEn = sock ? ahoraIso() : null;
}

function marcarMensajeRecibido(sessionId) {
    reg(sessionId).ultimoMensajeRecibidoEn = ahoraIso();
}

function marcarProcesado(sessionId) {
    const r = reg(sessionId);
    r.ultimoProcesadoOkEn = ahoraIso();
    r.errores = 0;
}

function marcarErrorProceso(sessionId, error) {
    const r = reg(sessionId);
    r.errores = (r.errores || 0) + 1;
    r.ultimoError = { mensaje: String(error?.message || error || "error").slice(0, 300), en: ahoraIso() };
}

// fases: "arranque" (worker recién iniciado: cuenta como ciclo terminado,
// así un worker que nunca cicla también se detecta), "inicio", "fin",
// "detenido" (sin worker: no se evalúa).
function marcarTickWorker(sessionId, fase) {
    const r = reg(sessionId);
    if (fase === "arranque") { r.workerTickInicioEn = 0; r.workerTickFinEn = Date.now(); }
    else if (fase === "detenido") { r.workerTickInicioEn = 0; r.workerTickFinEn = 0; }
    else if (fase === "inicio") r.workerTickInicioEn = Date.now();
    else r.workerTickFinEn = Date.now();
}

function marcarRecuperacion(sessionId, causa) {
    const r = reg(sessionId);
    r.recuperaciones = [{ causa, en: ahoraIso() }, ...(r.recuperaciones || [])].slice(0, 10);
}

function olvidar(sessionId) {
    registros.delete(sessionId);
}

// ¿El worker está colgado? Un ciclo empezó hace más del umbral y no terminó,
// o el último ciclo terminado es más viejo que el umbral.
function workerDetenido(r, ahora) {
    const inicio = r.workerTickInicioEn || 0;
    const fin = r.workerTickFinEn || 0;
    if (!inicio && !fin) return false; // aún no arrancó: no es una falla
    if (inicio > fin && ahora - inicio > UMBRAL_WORKER_MS) return true;
    return ahora - Math.max(inicio, fin) > UMBRAL_WORKER_MS;
}

// evaluar() — clasificación para el panel. `lease` es la fila de
// sesiones_lease (o null); `propio` = este proceso es el dueño.
//   estados: conectando | conectada | escuchando | saludable | degradada |
//            desconectada | conflicto_lease
function evaluar({ sessionId, sock, abierto, activa, lease = null, leasePropio = false, estadoLeasePropio = null, estadoSupabase = null, ahora = Date.now() }) {

    const r = registros.get(sessionId) || { errores: 0, recuperaciones: [] };
    const causas = [];
    const base = {
        conectadoEn: r.conectadoEn || null,
        listenerEn: r.listenerSocket && r.listenerSocket === sock ? r.listenerEn : null,
        ultimoMensajeRecibidoEn: r.ultimoMensajeRecibidoEn || null,
        ultimoProcesadoOkEn: r.ultimoProcesadoOkEn || null,
        ultimoError: r.ultimoError || null,
        erroresSeguidos: r.errores || 0,
        recuperaciones: r.recuperaciones || []
    };

    const leaseVigente = !!lease && new Date(lease.lease_until).getTime() > ahora;

    if (!sock) {

        if (leaseVigente && !leasePropio) {
            return { ...base, estado: "conflicto_lease", causas: ["La sesión está abierta en otra instancia del bot (otro proceso o servidor)."], accion: "Si no hay otra instancia en uso, espera unos segundos: este servidor la tomará cuando venza su lease." };
        }

        if (estadoSupabase === "conectado") {
            causas.push("En la base de datos figura como conectada, pero ningún proceso del bot la está atendiendo.");
            return { ...base, estado: "desconectada", causas, accion: "El bot reintentará automáticamente; si no vuelve en 1 minuto, pulsa Reconectar." };
        }

        return { ...base, estado: "desconectada", causas: ["Sin conexión a WhatsApp."], accion: "Pulsa Conectar y escanea el QR si se solicita." };

    }

    if (!abierto) return { ...base, estado: "conectando", causas: ["Estableciendo la conexión con WhatsApp."], accion: null };

    if (!activa) {
        return { ...base, estado: "conectada", causas: ["Conectada a WhatsApp, en espera: no procesa mensajes mientras otra sesión sea la activa."], accion: null };
    }

    const escuchando = !!r.listenerSocket && r.listenerSocket === sock;

    if (!escuchando) causas.push("Conectada pero SIN listener de mensajes: el bot no está leyendo los grupos.");
    if (workerDetenido(r, ahora)) causas.push("El worker de eventos (apertura/cierre de grupos) no completa ciclos.");
    if ((r.errores || 0) >= UMBRAL_ERRORES) causas.push(`${r.errores} errores seguidos al procesar mensajes. Último: ${r.ultimoError?.mensaje || "—"}`);
    if ((estadoLeasePropio?.erroresSeguidos || 0) >= UMBRAL_LEASE) causas.push(`No se puede renovar el lease en Supabase (${estadoLeasePropio.erroresSeguidos} intentos). Último: ${estadoLeasePropio.ultimoError || "—"}`);

    if (causas.length) {
        return { ...base, estado: "degradada", escuchando, causas, accion: "El bot intenta recuperarse solo. Si el estado no mejora en 2 minutos, pulsa Reconectar." };
    }

    return { ...base, estado: "saludable", escuchando: true, causas: [], accion: null };

}

module.exports = {
    marcarConexion,
    marcarListener,
    marcarMensajeRecibido,
    marcarProcesado,
    marcarErrorProceso,
    marcarTickWorker,
    marcarRecuperacion,
    olvidar,
    evaluar,
    workerDetenido,
    _registros: registros,
    UMBRAL_WORKER_MS
};
