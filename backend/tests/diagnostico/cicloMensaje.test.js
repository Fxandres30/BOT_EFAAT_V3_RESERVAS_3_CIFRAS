// ==========================================================================
// PRUEBAS — diagnóstico del ciclo de vida de mensajes (Paso 0).
//
// Verifica que diagnostico/cicloMensaje.js:
//   - apagado (sin DEBUG_MESSAGE_LIFECYCLE) no hace absolutamente nada;
//   - encendido, clasifica cada ingreso (nuevo / offline / histórico /
//     reenvío / duplicado / otra sesión);
//   - reproduce y deja en evidencia el escenario del reinicio: listener de
//     negocio registrado ANTES de open + backlog offline de hace 2 días
//     que termina en una acción real sobre un grupo;
//   - enlaza la acción con el mensaje que la originó a través del
//     listener real (messages.upsert.js) y de la cola real de IQ de grupo
//     (groupQueue.js);
//   - marca acciones y ticks de worker sobre sockets no activos/cerrados.
//
// Sin sockets reales ni red: sockets falsos con EventEmitter y un manager
// falso vía require.cache.
//
//     node backend/tests/diagnostico/cicloMensaje.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");

const RUTA_MANAGER = path.resolve(__dirname, "../../services/baileys/manager.js");
const RUTA_CICLO = path.resolve(__dirname, "../../diagnostico/cicloMensaje.js");
const RUTA_UPSERT = path.resolve(__dirname, "../../bot/events/messages.upsert.js");
const RUTA_HANDLER = path.resolve(__dirname, "../../bot/handlers/messageHandler.js");
const RUTA_DIAG_ORIGINAL = path.resolve(__dirname, "../../bot/funciones/mensajes/diagnosticarMensajeEntranteOriginal.js");
const RUTA_QUEUE = path.resolve(__dirname, "../../services/baileys/groupQueue.js");

// ---------------------------------------------------------------- fakes ---

const managerFake = {
    socketActivo: null,
    sesionActiva: null,
    getActiveSocket() { return this.socketActivo; },
    getActiveSession() { return this.sesionActiva; }
};

function mock(ruta, exports) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports };
}

mock(RUTA_MANAGER, managerFake);

// El handler real arrastra Supabase/dispatcher: se sustituye por uno que
// hace lo mismo que haría detectarEvento -> abrirGrupo (acción real sobre
// la cola real de IQ de grupo).
let handlerImpl = async () => {};
mock(RUTA_HANDLER, (data) => handlerImpl(data));
mock(RUTA_DIAG_ORIGINAL, { diagnosticarMensajeEntranteOriginal: () => {} });

process.env.GROUP_QUEUE_DELAY_MS = "0";

function crearSock(sessionId) {
    return {
        ev: new EventEmitter(),
        context: { sessionId, telefono: null, usuarioId: "u1" },
        groupSettingUpdate: async () => {},
        groupParticipantsUpdate: async () => {}
    };
}

function cargar() {
    [RUTA_CICLO, RUTA_UPSERT, RUTA_QUEUE].forEach(r => delete require.cache[r]);
    return {
        ciclo: require(RUTA_CICLO),
        upsert: require(RUTA_UPSERT),
        groupQueue: require(RUTA_QUEUE)
    };
}

// Captura los bloques [CICLO] emitidos por console.log.
function capturar() {
    const original = console.log;
    const bloques = [];
    console.log = (...args) => {
        const texto = args.map(String).join(" ");
        if (texto.startsWith("[CICLO]")) bloques.push(texto);
    };
    return {
        bloques,
        restaurar() { console.log = original; },
        buscar(titulo) { return bloques.filter(b => b.split("\n")[0].includes(titulo)); }
    };
}

function campo(bloque, nombre) {
    const linea = bloque.split("\n").find(l => l.startsWith(`[CICLO] ${nombre}: `));
    return linea ? linea.slice(`[CICLO] ${nombre}: `.length) : undefined;
}

const esperar = (ms = 0) => new Promise(r => setTimeout(r, ms));

function mensaje(id, { segundosAtras = 0, fromMe = false, grupo = "120363000000000001@g.us" } = {}) {
    return {
        key: { id, remoteJid: grupo, fromMe, participant: "573001112233@s.whatsapp.net" },
        message: { conversation: "Sorteo Chontico 10pm valor 5000" },
        messageTimestamp: Math.floor((Date.now() - segundosAtras * 1000) / 1000)
    };
}

// --------------------------------------------------------------- runner ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. apagado: no registra listeners, no intercepta nada, no emite logs", async () => {

    delete process.env.DEBUG_MESSAGE_LIFECYCLE;
    const { ciclo } = cargar();
    const cap = capturar();

    try {
        const sock = crearSock("A");
        ciclo.observarSocket(sock, "A");

        assert.strictEqual(sock.ev.listenerCount("messages.upsert"), 0);
        assert.strictEqual(sock.ev.listenerCount("connection.update"), 0);
        assert.strictEqual(ciclo.ejecutarConTraza({ sock, message: mensaje("x") }, () => 42), 42);
        assert.strictEqual(ciclo.accion("sendMessage", sock, "g@g.us"), null);
        ciclo.etapa("dispatcher");
        ciclo.tickWorker("scheduler", sock);
        assert.strictEqual(cap.bloques.length, 0);
    } finally {
        cap.restaurar();
    }

});

prueba("2. clasificación pura de cada tipo de ingreso", async () => {

    process.env.DEBUG_MESSAGE_LIFECYCLE = "true";
    const { ciclo } = cargar();
    const ahora = Date.now();
    const meta = { estado: "open", connectedAt: ahora - 60 * 1000 };
    const base = { meta, esSocketActivo: true, vecesVisto: 1, ahora };

    const c = (msg, extra = {}) => ciclo.clasificarIngreso({ message: msg, type: "notify", ...base, ...extra });

    assert.strictEqual(c(mensaje("n1", { segundosAtras: 2 })), "NUEVO");
    assert.strictEqual(c(mensaje("o1", { segundosAtras: 2 * 86400 }), { type: "append" }), "RECUPERADO_OFFLINE");
    assert.strictEqual(c(mensaje("e1", { fromMe: true }), { type: "append" }), "APPEND_ECO_PROPIO_U_OFFLINE");
    assert.strictEqual(c(mensaje("h1", { segundosAtras: 3 * 3600 })), "HISTORICO_ANTERIOR_A_CONEXION");
    assert.strictEqual(c(mensaje("p1", { segundosAtras: 86400 }), { requestId: "req-1" }), "REENVIO_PLACEHOLDER");
    assert.strictEqual(c(mensaje("d1"), { vecesVisto: 2 }), "DUPLICADO");
    assert.strictEqual(c(mensaje("s1"), { esSocketActivo: false }), "OTRA_SESION_O_SOCKET_NO_ACTIVO");
    assert.strictEqual(c(mensaje("c1"), { meta: { estado: "connecting" } }), "SOCKET_NO_OPEN");

    assert.strictEqual(ciclo.formatearEdad((2 * 86400 + 3 * 3600 + 5) * 1000), "2d 3h 5s");

});

prueba("3. escenario reinicio PM2: listener antes de open + backlog offline de 2 días -> abre grupo (ALERTA)", async () => {

    process.env.DEBUG_MESSAGE_LIFECYCLE = "true";
    const { ciclo, upsert, groupQueue } = cargar();
    const cap = capturar();

    try {

        const sock = crearSock("A");
        ciclo.observarSocket(sock, "A");          // socket.js, tras makeWASocket

        // encendido tampoco añade listeners de connection.update (el único
        // debe seguir siendo el de estados.js)
        assert.strictEqual(sock.ev.listenerCount("connection.update"), 0);

        // restaurarSesiones(): setActive() antes de open -> activeChanged
        managerFake.socketActivo = sock;
        managerFake.sesionActiva = "A";

        handlerImpl = async ({ sock: s, message }) => {
            // lo que hace hoy detectarEvento -> abrirGrupo
            await groupQueue.groupSettingUpdate(s, message.key.remoteJid, "not_announcement");
        };

        upsert.registerMessages(sock, "A");       // bot/index.js conectar()

        const alertaListener = cap.buscar("LISTENER_NEGOCIO_REGISTRADO")[0];
        assert.ok(alertaListener, "debe registrar el alta del listener");
        assert.match(campo(alertaListener, "ALERTA"), /ANTES de que el socket esté open/);

        ciclo.observarConexion(sock, { connection: "open" });

        // Baileys: ev.flush() del backlog offline
        sock.ev.emit("messages.upsert", {
            type: "append",
            messages: [mensaje("VIEJO-2D", { segundosAtras: 2 * 86400 })]
        });
        ciclo.observarConexion(sock, { receivedPendingNotifications: true });

        await esperar(20);

        const ingreso = cap.buscar("INGRESO VIEJO-2D")[0];
        assert.ok(ingreso, "debe registrar el ingreso");
        assert.strictEqual(campo(ingreso, "EVENT_TYPE"), "append");
        assert.strictEqual(campo(ingreso, "PROCESSING_REASON"), "RECUPERADO_OFFLINE");
        assert.strictEqual(campo(ingreso, "REMOTE_JID"), "120363000000000001@g.us");
        assert.match(campo(ingreso, "MESSAGE_AGE"), /^2d /);
        assert.ok(campo(ingreso, "SESSION_CONNECTED_AT"));
        assert.ok(campo(ingreso, "MESSAGE_TIMESTAMP"));
        assert.match(campo(ingreso, "DESTINO_REAL_HOY"), /compuerta de ingreso/);

        assert.strictEqual(cap.buscar("ETAPA listener VIEJO-2D").length, 1);

        const accion = cap.buscar("ACCION groupSettingUpdate(not_announcement)")[0];
        assert.ok(accion, "la acción de abrir grupo debe quedar registrada");
        assert.strictEqual(campo(accion, "ORIGEN"), "MENSAJE");
        assert.strictEqual(campo(accion, "ORIGEN_MESSAGE_ID"), "VIEJO-2D");
        assert.strictEqual(campo(accion, "ORIGEN_PROCESSING_REASON"), "RECUPERADO_OFFLINE");
        assert.match(campo(accion, "ALERTA"), /RECUPERADO_OFFLINE/);

        upsert.unregisterMessages("A");

    } finally {
        cap.restaurar();
    }

});

prueba("4. mensaje nuevo en vivo: NUEVO y la acción sale sin ALERTA", async () => {

    process.env.DEBUG_MESSAGE_LIFECYCLE = "true";
    const { ciclo, upsert, groupQueue } = cargar();
    const cap = capturar();

    try {

        const sock = crearSock("A");
        ciclo.observarSocket(sock, "A");
        ciclo.observarConexion(sock, { connection: "open" });
        ciclo.observarConexion(sock, { receivedPendingNotifications: true });

        managerFake.socketActivo = sock;
        managerFake.sesionActiva = "A";

        handlerImpl = async ({ sock: s, message }) => {
            await groupQueue.groupSettingUpdate(s, message.key.remoteJid, "not_announcement");
        };

        upsert.registerMessages(sock, "A");

        sock.ev.emit("messages.upsert", { type: "notify", messages: [mensaje("VIVO-1", { segundosAtras: 1 })] });
        await esperar(20);

        assert.strictEqual(campo(cap.buscar("INGRESO VIVO-1")[0], "PROCESSING_REASON"), "NUEVO");

        const accion = cap.buscar("ACCION groupSettingUpdate")[0];
        assert.strictEqual(campo(accion, "ORIGEN_PROCESSING_REASON"), "NUEVO");
        assert.strictEqual(campo(accion, "ALERTA"), undefined);

        // el mismo id otra vez -> DUPLICADO
        sock.ev.emit("messages.upsert", { type: "notify", messages: [mensaje("VIVO-1", { segundosAtras: 1 })] });
        await esperar(20);
        const ingresos = cap.buscar("INGRESO VIVO-1");
        assert.strictEqual(campo(ingresos[1], "PROCESSING_REASON"), "DUPLICADO");
        assert.strictEqual(campo(ingresos[1], "VECES_VISTO"), "2");

        upsert.unregisterMessages("A");

    } finally {
        cap.restaurar();
    }

});

prueba("5. cambio de sesión A -> B: mensaje/evento de A queda marcado, acción de A y tick de worker con ALERTA", async () => {

    process.env.DEBUG_MESSAGE_LIFECYCLE = "true";
    const { ciclo, groupQueue } = cargar();
    const cap = capturar();

    try {

        const sockA = crearSock("A");
        const sockB = crearSock("B");
        ciclo.observarSocket(sockA, "A");
        ciclo.observarSocket(sockB, "B");
        ciclo.observarConexion(sockA, { connection: "open" });
        ciclo.observarConexion(sockB, { connection: "open" });

        managerFake.socketActivo = sockB;
        managerFake.sesionActiva = "B";

        sockA.ev.emit("messages.upsert", { type: "notify", messages: [mensaje("DE-A", { segundosAtras: 1 })] });
        assert.strictEqual(campo(cap.buscar("INGRESO DE-A")[0], "PROCESSING_REASON"), "OTRA_SESION_O_SOCKET_NO_ACTIVO");
        assert.strictEqual(campo(cap.buscar("INGRESO DE-A")[0], "SOCKET_EPOCH"), "1");
        assert.strictEqual(campo(cap.buscar("INGRESO DE-A")[0], "EPOCH_SOCKET_ACTIVO"), "2");

        // groups.js de A sigue vivo (bloqueo/expulsión)
        sockA.ev.emit("group-participants.update", { id: "g@g.us", action: "add", participants: ["x@s.whatsapp.net"] });
        assert.match(campo(cap.buscar("EVENTO_GRUPO")[0], "ALERTA"), /NO es el activo/);

        await groupQueue.groupParticipantsUpdate(sockA, "g@g.us", ["x@s.whatsapp.net"], "remove");
        const accion = cap.buscar("ACCION groupParticipantsUpdate(remove)")[0];
        assert.strictEqual(campo(accion, "ORIGEN"), "SIN_MENSAJE (worker / scheduler / listener de grupos / panel)");
        assert.match(campo(accion, "ALERTA"), /NO es el socket activo/);

        // worker de A que siguiera vivo
        ciclo.tickWorker("workerEventos", sockA);
        assert.ok(cap.buscar("WORKER_TICK_ANOMALO workerEventos")[0]);

        // worker de B sano: no emite nada
        const antes = cap.bloques.length;
        ciclo.tickWorker("scheduler", sockB);
        assert.strictEqual(cap.bloques.length, antes);

    } finally {
        cap.restaurar();
    }

});

prueba("6. socket activo que se cierra: worker y acción sobre socket closed quedan marcados", async () => {

    process.env.DEBUG_MESSAGE_LIFECYCLE = "true";
    const { ciclo } = cargar();
    const cap = capturar();

    try {

        const sock = crearSock("A");
        ciclo.observarSocket(sock, "A");
        ciclo.observarConexion(sock, { connection: "open" });
        managerFake.socketActivo = sock;
        managerFake.sesionActiva = "A";

        ciclo.observarConexion(sock, { connection: "close", lastDisconnect: { error: { output: { statusCode: 408 } } } });
        assert.strictEqual(campo(cap.buscar("SOCKET_CLOSE")[0], "STATUS_CODE"), "408");

        ciclo.tickWorker("scheduler", sock);
        assert.match(campo(cap.buscar("WORKER_TICK_ANOMALO scheduler")[0], "ALERTA"), /closed/);

        ciclo.accion("sendMessage", sock, "g@g.us");
        assert.match(campo(cap.buscar("ACCION sendMessage")[0], "ALERTA"), /closed/);

    } finally {
        cap.restaurar();
    }

});

prueba("7. error interno del diagnóstico nunca rompe el flujo", async () => {

    process.env.DEBUG_MESSAGE_LIFECYCLE = "true";
    const { ciclo } = cargar();
    const errOriginal = console.error;
    console.error = () => {};
    const cap = capturar();

    try {
        const roto = { get ev() { throw new Error("boom"); } };
        assert.doesNotThrow(() => ciclo.observarSocket(roto, "X"));
        assert.strictEqual(ciclo.ejecutarConTraza({ sock: null, message: null }, () => "ok"), "ok");
    } finally {
        cap.restaurar();
        console.error = errOriginal;
    }

});

(async () => {

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            console.log(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            console.log(`❌ ${nombre}`);
            console.log(err);
        }
    }

    delete process.env.DEBUG_MESSAGE_LIFECYCLE;

    console.log("\n============================");
    console.log(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    console.log("============================");

    process.exit(falla ? 1 : 0);

})();
