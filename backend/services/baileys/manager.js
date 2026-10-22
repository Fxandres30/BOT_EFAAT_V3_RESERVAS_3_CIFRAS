const EventEmitter = require("events");

const {
    createSocket,
    disconnectSocket,
    getSocket,
    sockets
} = require("./socket");

const registrarEstados = require("./estados");
const supabase = require("../../lib/supabase");
const lease = require("./lease");

// Ciclo de vida real de cada instancia de socket (Fase 1): connecting /
// open / pending_flushed / closed. Estar en el Map NO es estar conectado.
const cicloSocket = require("./cicloSocket");

const {
    cancelarReintentoPendiente
} = require("./desconectado");

// Señal inequívoca para "la fila de Supabase no existe" — se distingue del
// null que se devuelve para un error real de Supabase, así quien llama
// (baileysService.connect) puede reaccionar distinto en cada caso.
const SESSION_NOT_FOUND = "SESSION_NOT_FOUND";

// Señal inequívoca para "no se creó socket porque otra instancia (LOCAL/VPS)
// ya tiene el lease distribuido de esta sesión". Un llamador que reciba
// esto NO debe tratar la sesión como desconectada: puede estar funcionando
// correctamente en la otra instancia (ver server.js: restaurarSesiones).
const LEASE_NO_DISPONIBLE = "LEASE_NO_DISPONIBLE";

// Utilidades de SOLO LECTURA para logs de trazabilidad (no afectan al
// algoritmo de failover ni a la selección de sesión).
const {
    identidadDesdeSocket,
    maskPhone
} = require("./identidadSesion");

class SessionManager extends EventEmitter {

    constructor() {

        super();

        this.sockets = sockets;

        // MULTISESIÓN (2026-10-21): UNA sesión activa POR DUEÑO
        // (sesiones.usuario_id), no una por proceso. Cada cliente procesa con
        // su propio WhatsApp a la vez que los demás; un cambio, una caída o
        // un failover de un cliente nunca toca la sesión de otro.
        //   usuarioId -> { sessionId, socket }
        // "socket" es el objeto que el BOT tiene registrado como listener de
        // esa sesión: separado del sessionId para detectar cuándo la MISMA
        // sesión reconecta con una instancia de socket nueva (ver
        // evaluarConexion: se re-emite "activeChanged" para mover listener y
        // workers al socket nuevo).
        this.activas = new Map();

        // Activación diferida (Fase 1), también por dueño: sesión pedida como
        // activa mientras su socket todavía NO estaba open. Se activa en
        // evaluarConexion() cuando llega realmente a open — nunca antes.
        //   usuarioId -> sessionId
        this.pendientes = new Map();

    }

    // ---- Compatibilidad (consumidores de la época de una sola sesión) ----
    // Devuelven la PRIMERA sesión activa registrada. Con varios clientes no
    // identifican a ninguno en concreto: el código nuevo usa
    // getSesionActivaDe(usuarioId) / getSocketActivoDe(usuarioId).
    _primeraActiva() {
        const primera = this.activas.values().next();
        return primera.done ? null : primera.value;
    }

    get activeSession() {
        return this._primeraActiva()?.sessionId ?? null;
    }

    get activeSocket() {
        return this._primeraActiva()?.socket ?? null;
    }

    get activacionPendiente() {
        const p = this.pendientes.values().next();
        return p.done ? null : { sessionId: p.value };
    }

    // Dueño validado de una sesión: el del socket (socket.js lo lee de la
    // fila de sesiones al crearlo, en el servidor) o, si aún no hay socket,
    // el de la fila. Nunca se infiere de un mensaje. null = sin dueño.
    async _duenioDe(sessionId) {

        const desdeSocket = this.get(sessionId)?.context?.usuarioId;
        if (desdeSocket) return desdeSocket;

        try {
            const { data, error } = await supabase
                .from("sesiones")
                .select("usuario_id")
                .eq("id", sessionId)
                .maybeSingle();
            if (error) return null;
            return data?.usuario_id || null;
        } catch {
            return null;
        }

    }

    // Dueño para el que esta sesión es HOY la activa (o null).
    _duenioActivoDe(sessionId) {
        for (const [usuarioId, activa] of this.activas) {
            if (activa.sessionId === sessionId) return usuarioId;
        }
        return null;
    }

    async start(sessionId) {

    if (this.has(sessionId)) {

        console.log("🟢 Sesión ya iniciada:", sessionId);

        return this.get(sessionId);

    }

    console.log("🚀 Iniciando sesión:", sessionId);

    const { data: sesion, error } = await supabase
    .from("sesiones")
    .select("estado")
    .eq("id", sessionId)
    .maybeSingle();

if (error) {

    console.error("❌ Error obteniendo sesión:", error.message);

    return null;

}

if (!sesion) {

    console.log(`⚠️ La sesión ${sessionId} ya no existe.`);

    await this._cancelarActivacionPendiente(sessionId, "la sesión ya no existe");

    return SESSION_NOT_FOUND;

}

    // LEASE DISTRIBUIDO (LOCAL <-> VPS) — PRIMERA capa, antes de tocar el
    // lock intra-proceso de socket.js. Si otra instancia ya es dueña de
    // esta sesión, esta llamada NUNCA debe llegar a createSocket()/
    // makeWASocket(). No es un error: la sesión puede estar funcionando
    // correctamente en la otra instancia.
    const resultadoLease = await lease.acquire(sessionId);

    if (!resultadoLease.adquirido) {

        console.log(`🚫 [SESSION] ${sessionId} no se crea socket: lease ocupado por otra instancia`);

        await this._cancelarActivacionPendiente(sessionId, "lease ocupado por otra instancia");

        // CORRECCIÓN: antes no se reintentaba NUNCA. Tras un reinicio de PM2
        // el lease del proceso anterior sigue vigente unos segundos (TTL), así
        // que la sesión quedaba sin socket hasta reconectar a mano. Ahora se
        // vuelve a intentar cuando el lease vence. Si otra instancia viva lo
        // sigue renovando, el reintento vuelve a fallar sin crear ningún socket
        // (espera en reserva, nunca un socket duplicado).
        // Solo cuando el lease es de un proceso anterior de ESTA MISMA
        // máquina (reinicio de PM2): el de otra máquina (LOCAL <-> VPS) nunca
        // se toma solo — eso sigue requiriendo Conectar desde el panel.
        if (!resultadoLease.error && lease.esDeEstaMaquina(resultadoLease.ownerId)) {
            this._programarReintentoLease(sessionId, resultadoLease.leaseUntil);
        } else if (resultadoLease.error) {
            // Sin respuesta de Supabase no se sabe de quién es: reintentar.
            this._programarReintentoLease(sessionId, null);
        }

        return LEASE_NO_DISPONIBLE;

    }

    let socket, isNew;

    try {

        ({ sock: socket, isNew } = await createSocket(sessionId));

    } catch (err) {

        console.error(`❌ Error creando socket para ${sessionId}, liberando lease:`, err.message);

        await lease.soltar(sessionId);

        throw err;

    }

    if (!socket) {

        console.log(`⚠️ createSocket() no devolvió un socket para ${sessionId}, liberando lease`);

        await lease.soltar(sessionId);

        await this._cancelarActivacionPendiente(sessionId, "no se pudo crear el socket");

        return null;

    }

    // Si createSocket() devolvió un socket YA existente (o la misma
    // creación en vuelo reutilizada por otra llamada concurrente a
    // start()), NO se vuelve a registrar — un socket solo puede tener UN
    // listener de connection.update. Registrar dos veces duplicaba
    // desconectado()/conectado() por cada evento real, lo cual disparaba
    // reintentos duplicados y facilitaba crear un segundo socket real con
    // las mismas credenciales (causa del bucle conflict/replaced 440).
    if (isNew) {

        registrarEstados(

            socket,

            sessionId,

            {

                manager: this,

                sockets: this.sockets

            }

        );

        // Un solo heartbeat por sessionId por proceso — arranca junto con
        // el ÚNICO socket real creado para esta sesión (isNew), nunca con
        // una reutilización concurrente (evitaría duplicar el interval).
        lease.iniciarHeartbeat(sessionId, {
            onOwnershipPerdido: (id) => this._abandonarPorLeasePerdido(id)
        });

    } else {

        console.log("🟢 Socket ya existía (o en creación concurrente), no se registran listeners duplicados:", sessionId);

    }

    return socket;

}

    // Se invoca cuando el heartbeat del lease distribuido falla (otra
    // instancia tomó el ownership, o el TTL venció antes de renovar). Esta
    // sesión sigue viva — solo que ya no en ESTE proceso — así que:
    //   - se cierra el socket local SIN logout (sock.end(), no
    //     sock.logout()): las credenciales de WhatsApp no se invalidan,
    //     la otra instancia sigue usando la MISMA sesión;
    //   - se saca el socket del Map ANTES de sock.end() para que el
    //     guard de identidad de estados.js ignore el evento "close" que
    //     sock.end() emite (no debe disparar el reintento genérico ni
    //     ningún otro camino de reconexión — esta instancia ya no es
    //     dueña);
    //   - se reutiliza manejarDesconexionActiva() (el mismo único punto
    //     de decisión de failover que ya existía) para que, si esta
    //     instancia tenía OTRAS sesiones conectadas, el BOT local
    //     failover a una de ellas en vez de quedar sin ninguna.
    async _abandonarPorLeasePerdido(sessionId) {

        console.log(`⚠️ [LEASE] ownership perdido, cerrando socket local: ${sessionId}`);

        const sock = this.get(sessionId);

        if (sock && this.sockets.get(sessionId) === sock) {

            this.sockets.delete(sessionId);

        }

        if (sock && typeof sock.end === "function") {

            try {

                await sock.end(new Error("[LEASE] ownership perdido: otra instancia tomó el lease de esta sesión"));

            } catch (err) {

                console.error(`❌ [LEASE] error cerrando socket tras perder ownership (${sessionId}):`, err.message);

            }

        }

        await this.manejarDesconexionActiva(sessionId);

    }

    // Reintento de adquisición del lease (ver start()). Uno por sesión.
    _programarReintentoLease(sessionId, leaseUntil) {

        if (!this._reintentosLease) this._reintentosLease = new Map();
        if (this._reintentosLease.has(sessionId)) return;

        const vence = leaseUntil ? new Date(leaseUntil).getTime() : Date.now();
        const espera = Math.min(Math.max(vence - Date.now(), 0) + 2000 + Math.floor(Math.random() * 1000), 60000);

        console.log(`⏳ [SESSION] ${sessionId}: se reintentará adquirir el lease en ${Math.round(espera / 1000)} s`);

        const temporizador = setTimeout(async () => {

            this._reintentosLease.delete(sessionId);

            if (this.has(sessionId)) return;

            try {

                // Solo si la sesión SIGUE debiendo estar conectada (mismo
                // criterio que restaurarSesiones en server.js). Una sesión
                // desconectada a propósito nunca se levanta sola.
                const { data } = await supabase.from("sesiones").select("estado, activa, usuario_id").eq("id", sessionId).maybeSingle();

                if (!data || data.estado !== "conectado") return;

                // Era la activa de SU dueño: se vuelve a pedir su activación
                // (start() la canceló al no poder adquirir el lease); se
                // activa al llegar a open, nunca antes.
                if (data.activa === true && data.usuario_id && !this.activas.has(data.usuario_id)) {
                    await this.solicitarActivacion(sessionId, { permitirSinSocket: true });
                }

                await this.start(sessionId);

            } catch (err) {

                console.error(`❌ [SESSION] reintento de lease falló para ${sessionId}:`, err?.message);
                this._programarReintentoLease(sessionId, null);

            }

        }, espera);

        if (typeof temporizador.unref === "function") temporizador.unref();

        this._reintentosLease.set(sessionId, temporizador);

    }

    _cancelarReintentoLease(sessionId) {
        const t = this._reintentosLease?.get(sessionId);
        if (t) {
            clearTimeout(t);
            this._reintentosLease.delete(sessionId);
        }
    }

    async stop(sessionId) {

        console.log("🔴 Deteniendo sesión:", sessionId);

        this._cancelarReintentoLease(sessionId);

        // Parada manual explícita: si había un reintento de reconexión
        // temporal pendiente (desconectado.js) para esta sesión, se
        // cancela aquí — de lo contrario ese setTimeout podía disparar
        // manager.start() después de que el usuario ya pidió desconectar,
        // volviendo a levantar una sesión que se acaba de detener a propósito.
        cancelarReintentoPendiente(sessionId);

        await disconnectSocket(sessionId);

        // Parada manual explícita: esta instancia deja de querer ser dueña
        // de la sesión (además de cerrarla con logout, arriba). Liberar el
        // lease permite que la otra instancia (si la sesión se reconecta
        // más adelante) pueda adquirirlo sin esperar a que expire el TTL.
        await lease.soltar(sessionId);

        await this._cancelarActivacionPendiente(sessionId, "parada manual");

        const usuarioId = this._duenioActivoDe(sessionId);

        if (usuarioId) {

            this.activas.delete(usuarioId);

            const candidata = await this.selectFailoverSession({ excluir: sessionId });

            if (candidata) {

                const idNueva = identidadDesdeSocket(this.get(candidata));

                console.log("🔄 [SESSION FAILOVER]", {
                    sesionAnterior: sessionId,
                    motivo: "parada manual",
                    nuevaSesionActivaId: candidata,
                    nuevaSesionActiva: idNueva.nombre,
                    telefono: maskPhone(idNueva.telefono)
                });

                await this.setActive(candidata);

            } else {

                console.log("🔄 [SESSION FAILOVER]", {
                    sesionAnterior: sessionId,
                    motivo: "parada manual",
                    nuevaSesionActivaId: null,
                    nuevaSesionActiva: "(ninguna — BOT sin sesión activa)"
                });

                console.log("[FAILOVER] sin sesiones disponibles tras detener", sessionId);

                this.emit("activeLost", { sessionId, usuarioId });

            }

        }

        return true;

    }

    has(sessionId) {

        return this.sockets.has(sessionId);

    }

    // Fase 1: conectado = el socket VIGENTE de la sesión está realmente
    // open (o pending_flushed). Un socket que solo existe en el Map
    // (connecting, esperando QR, reconectando) NO cuenta como conectado.
    isConnected(sessionId) {

        return this.has(sessionId) && cicloSocket.estaAbierto(this.get(sessionId));

    }

    get(sessionId) {

        return getSocket(sessionId);

    }

    getAll() {

        return [...this.sockets.keys()];

    }

    getConnectedSessions() {

        return this.getAll().filter(id => this.isConnected(id));

    }

    // preferida:true SOLO cuando el cambio viene de una selección manual real
    // del usuario (ver bot/controllers/sessionsController.js). El failover
    // automático nunca pasa preferida:true, para no cambiar la preferencia
    // del usuario sin que él lo haya pedido.
    async setActive(sessionId, { preferida = false } = {}) {

    console.log("========== SET ACTIVE ==========");
    console.log("Session recibida:", sessionId);
    console.log("Sockets conectados:", this.getAll());
    console.log("================================");

    // Fase 1: estar en el Map no basta — el socket debe estar open. Para
    // pedir la activación de una sesión que todavía está conectando se usa
    // solicitarActivacion(), que la difiere hasta que llegue a open.
    if (!this.isConnected(sessionId)) {

        console.log("❌ La sesión no está conectada (socket inexistente o todavía no open).", {
            sessionId,
            estadoSocket: cicloSocket.estadoDe(this.get(sessionId))
        });

        return false;

    }

    // Dueño validado ANTES de activar nada: una sesión sin usuario_id nunca
    // procesa mensajes ni ejecuta workers (falla cerrado).
    const usuarioId = await this._duenioDe(sessionId);

    if (!usuarioId) {

        console.error("❌ [SESSION] activación rechazada: la sesión no tiene dueño (usuario_id):", sessionId);

        return false;

    }

    if (this.pendientes.get(usuarioId) === sessionId) {

        this.pendientes.delete(usuarioId);

    }

    const socket = this.get(sessionId);
    const actual = this.activas.get(usuarioId);

    if (actual?.sessionId === sessionId) {

        console.log("ℹ️ Ya era la sesión activa de su cliente.");

        // Mantener alineada la referencia de socket, por si esta sesión
        // reconectó con una instancia nueva entre medio (el camino normal
        // para ese caso es evaluarConexion; esto es solo un resguardo).
        actual.socket = socket;

        if (preferida) {
            await this._marcarPreferida(sessionId, usuarioId);
        }

        return true;

    }

    // Actualizar memoria: solo la entrada de ESTE dueño.
    this.activas.set(usuarioId, { sessionId, socket });

    const sesion = { usuario_id: usuarioId };

    // Desactivar todas las sesiones de ese usuario
    const r1 = await supabase
        .from("sesiones")
        .update({ activa: false })
        .eq("usuario_id", sesion.usuario_id);

    console.log("UPDATE FALSE:", r1);

    // Activar únicamente la seleccionada
    const r2 = await supabase
        .from("sesiones")
        .update({ activa: true })
        .eq("id", sessionId);

    console.log("UPDATE TRUE:", r2);

    console.log("⭐ Nueva sesión activa:", sessionId);
    console.log("[SESSION]", { preferida: preferida ? sessionId : "(sin cambio)", activa: sessionId });

    if (preferida) {
        await this._marcarPreferida(sessionId, sesion.usuario_id);
    }

    this.emit("activeChanged", {
        sessionId,
        socket: this.get(sessionId),
        usuarioId,
        anterior: actual?.sessionId || null
    });

    return true;

}

    // Persiste la preferencia del usuario reutilizando la columna existente
    // "principal" (auditada en Fase 5.1: no la lee ni la escribe ningún otro
    // código del backend, así que reutilizarla no cambia ningún
    // comportamiento existente).
    async _marcarPreferida(sessionId, usuarioId) {

        try {

            let uid = usuarioId;

            if (!uid) {

                const { data } = await supabase
                    .from("sesiones")
                    .select("usuario_id")
                    .eq("id", sessionId)
                    .single();

                uid = data?.usuario_id;

            }

            if (!uid) return;

            await supabase
                .from("sesiones")
                .update({ principal: false })
                .eq("usuario_id", uid);

            await supabase
                .from("sesiones")
                .update({ principal: true })
                .eq("id", sessionId);

            console.log("[SESSION] preferida:", sessionId);

        } catch (err) {

            console.error("❌ Error marcando sesión preferida:", err.message);

        }

    }

    // Marca una sesión como preferida sin exigir que esté conectada (a
    // diferencia de setActive). Uso: botón "Hacer principal" del panel
    // sobre una sesión desconectada. Nunca toca activeSession ni el
    // listener del BOT — solo la preferencia persistida.
    async marcarPreferidaManual(sessionId) {

        const { data, error } = await supabase
            .from("sesiones")
            .select("id")
            .eq("id", sessionId)
            .maybeSingle();

        if (error || !data) {
            return false;
        }

        await this._marcarPreferida(sessionId);

        return true;

    }

    // Compatibilidad: la primera sesión activa del proceso (ver _primeraActiva).
    getActiveSession() {

        return this.activeSession;

    }

    // Fase 1: nunca devuelve un socket que no esté open (p. ej. durante la
    // reconexión de la sesión activa) — así ningún fallback termina
    // actuando sobre un socket muerto o todavía conectando.
    // Compatibilidad: el de la primera sesión activa; con varios clientes
    // hay que usar getSocketActivoDe(usuarioId).
    getActiveSocket() {

        const sessionId = this.activeSession;

        if (!sessionId || !this.isConnected(sessionId)) {

            return null;

        }

        return this.get(sessionId);

    }

    // ---- API multisesión ----

    // Sesión activa del cliente (aunque esté reconectando), o null.
    getSesionActivaDe(usuarioId) {

        if (!usuarioId) return null;

        return this.activas.get(usuarioId)?.sessionId ?? null;

    }

    // Socket OPEN de la sesión activa del cliente, o null. Es el socket con
    // el que se actúa en nombre de ese cliente (envíos, bloqueos, escáner…).
    getSocketActivoDe(usuarioId) {

        const sessionId = this.getSesionActivaDe(usuarioId);

        if (!sessionId || !this.isConnected(sessionId)) return null;

        return this.get(sessionId);

    }

    // Todas las sesiones activas del proceso: [{ usuarioId, sessionId, socket }].
    getSesionesActivas() {

        return [...this.activas].map(([usuarioId, a]) => ({ usuarioId, sessionId: a.sessionId, socket: a.socket }));

    }

    // ============================================================
    // FASE 1 — propiedad de sesión y ciclo de vida
    // ============================================================

    // ¿Puede ESTE socket ejecutar acciones de negocio ahora mismo?
    //   1. tiene dueño (sesiones.usuario_id, leído por socket.js),
    //   2. su sesión es la activa DE ESE dueño,
    //   3. sigue siendo el socket vigente de esa sesión (no reemplazado),
    //   4. es el socket que el BOT tiene registrado para ese dueño,
    //   5. está open.
    // Regla única, instalada en propiedadSesion.js por bot/index.js. Varios
    // sockets (de clientes distintos) pueden cumplirla a la vez.
    esSocketVigenteActivo(sock) {

        if (!sock) return false;

        const sessionId = sock.context?.sessionId;
        const usuarioId = sock.context?.usuarioId;

        if (!sessionId || !usuarioId) return false;

        const activa = this.activas.get(usuarioId);

        return !!activa
            && activa.sessionId === sessionId
            && activa.socket === sock
            && this.sockets.get(sessionId) === sock
            && cicloSocket.estaAbierto(sock);

    }

    // Único punto de entrada para PEDIR que una sesión sea la activa
    // (panel y arranque del servidor). Nunca activa un socket que no esté
    // open:
    //   - si ya está open -> setActive() inmediato (corte limpio A -> B vía
    //     "activeChanged": bot/index.js detiene todo lo de A y registra B);
    //   - si todavía está conectando -> la sesión anterior deja de ser la
    //     activa YA (se detienen sus listeners/workers/scheduler vía
    //     "activeLost") y la activación queda pendiente hasta que la nueva
    //     llegue a open (evaluarConexion).
    // Devuelve "activa", "pendiente" o false (sesión sin socket en esta
    // instancia, salvo permitirSinSocket — usado por el arranque, donde el
    // socket se crea justo después).
    async solicitarActivacion(sessionId, { preferida = false, permitirSinSocket = false } = {}) {

        if (this.isConnected(sessionId)) {

            const ok = await this.setActive(sessionId, { preferida });

            return ok ? "activa" : false;

        }

        if (!this.has(sessionId) && !permitirSinSocket) {

            console.log("❌ [SESSION] activación rechazada: la sesión no tiene socket en esta instancia:", sessionId);

            return false;

        }

        const usuarioId = await this._duenioDe(sessionId);

        if (!usuarioId) {

            console.error("❌ [SESSION] activación rechazada: la sesión no tiene dueño (usuario_id):", sessionId);

            return false;

        }

        if (preferida) {
            await this._marcarPreferida(sessionId, usuarioId);
        }

        const anterior = this.activas.get(usuarioId)?.sessionId || null;

        this.pendientes.set(usuarioId, sessionId);

        console.log("⏳ [SESSION] activación pendiente hasta que el socket esté open:", {
            sessionId,
            estadoSocket: cicloSocket.estadoDe(this.get(sessionId)),
            sesionAnterior: anterior || "(ninguna)"
        });

        if (anterior && anterior !== sessionId) {

            // A deja de ser la activa de SU cliente ANTES de que B conecte:
            // sus recursos de negocio se detienen ya, nada de A pasa a B. Las
            // sesiones de otros clientes no se tocan.
            this.activas.delete(usuarioId);

            console.log("🔌 [SESSION] sesión anterior desactivada por cambio de sesión:", anterior);

            this.emit("activeLost", { sessionId: anterior, usuarioId });

        }

        return "pendiente";

    }

    // Cancela la activación pendiente de ESA sesión (no llegó a open y ya no
    // lo va a hacer: parada manual, desconexión definitiva, lease ajeno,
    // sesión inexistente). Si su cliente quedó sin sesión activa, se aplica
    // el failover de siempre, solo entre sesiones de ese mismo cliente.
    async _cancelarActivacionPendiente(sessionId, motivo) {

        let usuarioId = null;

        for (const [u, pendiente] of this.pendientes) {
            if (pendiente === sessionId) { usuarioId = u; break; }
        }

        if (!usuarioId) return;

        this.pendientes.delete(usuarioId);

        console.log("🚫 [SESSION] activación pendiente cancelada:", { sessionId, motivo });

        if (this.activas.has(usuarioId)) return;

        const candidata = await this.selectFailoverSession({ excluir: sessionId });

        if (candidata) {

            await this.setActive(candidata);

            return;

        }

        this.emit("activeLost", { sessionId, usuarioId });

    }

    // Lo llama estados.js en CADA connection === "close" (antes de su
    // guardia de socket obsoleto). Si el socket que se cierra es
    // exactamente el que usa el BOT para su cliente, se avisa para detener
    // ya sus listeners/workers/scheduler — no se toca la activa: la decisión
    // de reconectar o hacer failover sigue siendo de desconectado.js.
    notificarSocketCerrado(sessionId, sock) {

        const usuarioId = this._duenioActivoDe(sessionId);

        if (!sock || !usuarioId || this.activas.get(usuarioId).socket !== sock) return;

        console.log("🔌 [SESSION] el socket activo se cerró — se detiene el procesamiento del BOT sobre él:", sessionId);

        this.emit("activeSocketClosed", { sessionId, socket: sock, usuarioId });

    }

    // ¿Es la sesión activa de su cliente?
    isActive(sessionId) {

        return !!this._duenioActivoDe(sessionId);

    }

    // ============================================================
    // FASE 5.1 — decisión central de conexión y failover
    // ============================================================

    // Llamado cuando CUALQUIER sesión termina de conectar/reconectar.
    // Decide si debe convertirse en la sesión activa DE SU CLIENTE o si
    // queda "disponible" (otra del mismo cliente ya está activa). Las
    // sesiones de otros clientes no intervienen en la decisión.
    async evaluarConexion(sessionId) {

        const socketDeEstaConexion = this.get(sessionId);

        // Fase 1: solo un socket realmente open puede ser evaluado para
        // activarse (conectado.js lo llama 1 s después de "open"; en ese
        // lapso pudo cerrarse o ser reemplazado).
        if (!this.isConnected(sessionId)) {

            console.log("[SESSION] evaluarConexion ignorado: el socket ya no está open:", {
                sessionId,
                estadoSocket: cicloSocket.estadoDe(socketDeEstaConexion)
            });

            return;

        }

        const usuarioId = await this._duenioDe(sessionId);

        if (!usuarioId) {

            console.error("❌ [SESSION] sesión conectada SIN dueño (usuario_id): no se activa ni procesa nada:", sessionId);

            return;

        }

        // Fase 1: activación diferida (cambio de sesión / arranque) de ESTE cliente.
        const pendiente = this.pendientes.get(usuarioId);

        if (pendiente) {

            if (pendiente !== sessionId) {

                console.log("[SESSION] sesión conectada, pero su cliente tiene una activación pendiente para otra sesión — no se promueve:", {
                    sesionConectada: sessionId,
                    pendiente
                });

                return;

            }

            this.pendientes.delete(usuarioId);

            if (this.activas.get(usuarioId)?.sessionId !== sessionId) {

                console.log("[SESSION] la sesión pendiente llegó a open -> se activa:", sessionId);

                await this.setActive(sessionId);

                return;

            }

            // Era ya la activa (pidió activarse a sí misma mientras
            // reconectaba): sigue el camino normal de abajo, que re-emite
            // activeChanged si el socket cambió.

        }

        const actual = this.activas.get(usuarioId);
        const activaValida = !!actual && this.isConnected(actual.sessionId);

        console.log("[SESSION]", {
            evento: "conexion",
            sesionConectada: sessionId,
            activaDelCliente: actual?.sessionId || null,
            activaValida
        });

        // Ya es la activa de su cliente. Si el socket es DISTINTO (misma
        // sesión reconectada con una instancia nueva — "restartRequired" o
        // reconexión temporal) se re-emite "activeChanged" para mover el
        // listener y los workers al socket nuevo, sin tocar Supabase ni la
        // preferencia (no es un cambio real de sesión activa).
        if (activaValida && actual.sessionId === sessionId) {

            if (actual.socket !== socketDeEstaConexion) {

                console.log("[SESSION] mismo sessionId activo, socket reemplazado -> re-emitiendo activeChanged:", sessionId);

                actual.socket = socketDeEstaConexion;

                this.emit("activeChanged", {
                    sessionId,
                    socket: socketDeEstaConexion,
                    usuarioId,
                    anterior: sessionId
                });

            }

            return;

        }

        // Su cliente no tiene ninguna sesión activa válida -> esta toma el
        // control (también cubre "es la preferida y la activa cayó").
        if (!activaValida) {

            console.log("[SESSION] su cliente no tiene sesión activa válida -> promoviendo:", sessionId);

            await this.setActive(sessionId);

            return;

        }

        // Su cliente ya tiene otra activa saludable -> no la reemplaza.
        console.log("[SESSION] sesión secundaria conectada, se mantiene la activa de su cliente:", actual.sessionId);

    }

    // Elige la mejor candidata para failover entre las sesiones REALMENTE
    // conectadas (excluyendo la que acaba de caer) y SOLO del mismo dueño
    // (sesiones.usuario_id) que la sesión que cae: el BOT nunca pasa a
    // atender con el WhatsApp de otro cliente. Orden: la preferida de ese
    // dueño primero; si no, otra suya conectada.
    //
    // Falla cerrado: si no se puede saber el dueño (fila eliminada, error de
    // Supabase) no hay failover (null -> activeLost), nunca una sesión
    // ajena por descarte.
    async selectFailoverSession({ excluir } = {}) {

        const conectadas = this.getConnectedSessions()
            .filter(id => id !== excluir);

        if (!excluir || conectadas.length === 0) {
            return null;
        }

        try {

            const { data, error } = await supabase
                .from("sesiones")
                .select("id, usuario_id, principal")
                .in("id", [excluir, ...conectadas]);

            if (error) throw error;

            const filas = data || [];
            const duenio = filas.find(f => f.id === excluir)?.usuario_id || null;

            if (!duenio) {

                console.warn("⚠️ [FAILOVER] no se conoce el dueño de la sesión que cae — sin failover (nunca a otro cliente):", excluir);

                return null;

            }

            // Mismo orden que getConnectedSessions(), solo las del dueño.
            const propias = conectadas.filter(id => filas.some(f => f.id === id && f.usuario_id === duenio));
            const preferida = propias.find(id => filas.some(f => f.id === id && f.principal === true));

            return preferida || propias[0] || null;

        } catch (err) {

            console.error("❌ [FAILOVER] error buscando candidata del mismo dueño — sin failover:", err.message);

            return null;

        }

    }

    // Llamado cuando una sesión se desconecta de forma DEFINITIVA (no en los
    // casos de reintento automático de la misma sesión). Si esa sesión era
    // la activa de su cliente, dispara el failover SOLO entre sesiones de
    // ese cliente; si no lo era, no hace nada. Los demás clientes siguen.
    async manejarDesconexionActiva(sessionIdCaida) {

        await this._cancelarActivacionPendiente(sessionIdCaida, "desconexión definitiva");

        const usuarioId = this._duenioActivoDe(sessionIdCaida);

        if (!usuarioId) {
            return;
        }

        console.log("[FAILOVER]", {
            sesionCaida: sessionIdCaida,
            cliente: usuarioId
        });

        this.activas.delete(usuarioId);

        const candidata = await this.selectFailoverSession({ excluir: sessionIdCaida });

        if (!candidata) {

            console.log("[FAILOVER]", {
                sesionCaida: sessionIdCaida,
                nuevaSesion: null,
                motivo: "sin sesiones disponibles del mismo cliente"
            });

            console.log("🔄 [SESSION FAILOVER]", {
                sesionAnterior: sessionIdCaida,
                motivo: "desconexión definitiva",
                nuevaSesionActivaId: null,
                nuevaSesionActiva: "(ninguna — su cliente queda sin sesión activa)"
            });

            this.emit("activeLost", { sessionId: sessionIdCaida, usuarioId });

            return;

        }

        console.log("[FAILOVER]", {
            sesionCaida: sessionIdCaida,
            nuevaSesion: candidata
        });

        const idNueva = identidadDesdeSocket(this.get(candidata));

        console.log("🔄 [SESSION FAILOVER]", {
            sesionAnterior: sessionIdCaida,
            motivo: "desconexión definitiva",
            nuevaSesionActivaId: candidata,
            nuevaSesionActiva: idNueva.nombre,
            telefono: maskPhone(idNueva.telefono)
        });

        await this.setActive(candidata);

    }

}

const manager = new SessionManager();

// Constante pública para que los llamadores (p.ej. baileysService) puedan
// comparar el resultado de start() sin depender de un string mágico duplicado.
manager.SESSION_NOT_FOUND = SESSION_NOT_FOUND;
manager.LEASE_NO_DISPONIBLE = LEASE_NO_DISPONIBLE;

module.exports = manager;