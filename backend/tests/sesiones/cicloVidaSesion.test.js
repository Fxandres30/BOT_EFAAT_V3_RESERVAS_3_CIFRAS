// ==========================================================================
// PRUEBAS — FASE 1: ciclo de vida del socket + propiedad de sesión.
//
// Módulos REALES bajo prueba: socket.js, manager.js, estados.js,
// conectado.js, desconectado.js, cicloSocket.js, propiedadSesion.js,
// bot/index.js, bot/events/groups.js, groupQueue.js, iniciarWorkerEventos.js.
// Se simulan (require.cache) solo las piezas de negocio que cuelgan de
// ellos (listener de mensajes, scheduler, escáner, sincronizarGrupo,
// bloqueo, workerEventos) para OBSERVAR qué se registra, qué se detiene
// y qué acción llega a ejecutarse — sin tocar su lógica.
//
// Cubre:
//   1. A conecta: connecting NO es conectado ni activo; activa al llegar a open.
//   2. A funciona: su socket puede actuar (grupos, cola de IQ de grupo).
//   3. Cambio A -> B (B open): corte limpio, A deja de actuar, B actúa.
//   4. Cambio A -> B (B connecting): A se detiene YA, B se activa al abrir.
//   5. B pendiente falla definitivamente -> vuelve a A (failover normal).
//   6. Reinicio (restaurarSesiones): nadie activo antes de open; la
//      sesión guardada como activa gana aunque otra abra antes.
//   7. Reconexión de A: se detiene todo al cerrarse el socket, el socket
//      viejo no actúa, el nuevo se registra al abrir.
//   8. Listeners de grupos: sesión secundaria no actúa; dos sesiones en el
//      mismo grupo -> la acción se ejecuta UNA sola vez.
//   9. Cola de IQ de grupo: acción encolada con A, ejecutada tras el
//      cambio -> se cancela (SOCKET_NO_VIGENTE).
//  10. workerEventos: el tick sobre un socket no vigente se omite.
//
//     node backend/tests/sesiones/cicloVidaSesion.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const {
    crearEntorno,
    flush,
    acelerarTimers,
    restaurarTimers,
    esperarHasta
} = require("./entornoFake");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const RUTAS_BOT = {
    index: r("bot/index.js"),
    groups: r("bot/events/groups.js"),
    upsert: r("bot/events/messages.upsert.js"),
    identitySync: r("bot/events/identitySync.upsert.js"),
    worker: r("bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js"),
    workerEventos: r("bot/funciones/eventos/workers/workerEventos.js"),
    scheduler: r("automation/scheduler.js"),
    escaner: r("bot/funciones/usuarios/escanerIdentidadesLifecycle.js"),
    sincronizar: r("bot/funciones/grupos/sincronizarGrupo.js"),
    bloqueo: r("bot/funciones/bloqueo/bloqueoParticipantesGrupo.js"),
    groupQueue: r("services/baileys/groupQueue.js"),
    propiedad: r("services/baileys/propiedadSesion.js")
};

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

function sesion(id, overrides = {}) {
    return {
        id,
        usuario_id: overrides.usuario_id || "usuario-1",
        nombre: `Sesion ${id}`,
        estado: "conectado",
        activa: false,
        principal: false,
        telefono: "000",
        ...overrides
    };
}

function emitirOpen(sock) {
    sock.ev.emit("connection.update", { connection: "open" });
}

function emitirClose(sock, statusCode) {
    sock.ev.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { output: { statusCode } } }
    });
}

// Registro de todo lo que el BOT registra/detiene y de las acciones reales.
function crearRegistro() {
    return {
        registrados: [],        // { sessionId, sock }
        eliminados: [],         // sessionId
        workersIniciados: [],   // sock
        workersDetenidos: [],   // sessionId
        schedulerIniciado: [],
        schedulerDetenido: [],
        sincronizados: [],      // { sock, grupoId }
        expulsiones: [],        // { sock, grupoId }
        escaneos: [],
        iqEjecutadas: []        // { sessionId, op, grupoId }
    };
}

// Carga el BOT real (bot/index.js + groups.js reales) sobre el manager del
// entorno recién creado, con las piezas de negocio simuladas.
function cargarBot(reg) {

    inyectar(RUTAS_BOT.upsert, {
        registerMessages: (sock, sessionId) => reg.registrados.push({ sessionId, sock }),
        unregisterMessages: (sessionId) => reg.eliminados.push(sessionId)
    });
    inyectar(RUTAS_BOT.identitySync, { registerIdentitySync: () => {}, unregisterIdentitySync: () => {} });
    inyectar(RUTAS_BOT.worker, {
        iniciarWorkerEventos: (sock) => reg.workersIniciados.push(sock),
        detenerWorkerEventos: (sessionId) => reg.workersDetenidos.push(sessionId)
    });
    inyectar(RUTAS_BOT.scheduler, {
        start: (sock) => reg.schedulerIniciado.push(sock),
        stop: (sessionId) => reg.schedulerDetenido.push(sessionId)
    });
    inyectar(RUTAS_BOT.escaner, {
        iniciarEscanerIdentidades: () => {},
        detenerEscanerIdentidades: () => {},
        escanearGrupo: async (sessionId, sock, grupoId) => { reg.escaneos.push({ sock, grupoId }); }
    });
    inyectar(RUTAS_BOT.sincronizar, {
        sincronizarGrupo: async ({ sock, grupoId }) => { reg.sincronizados.push({ sock, grupoId }); }
    });
    inyectar(RUTAS_BOT.bloqueo, {
        procesarIngresoParticipante: async (sock, grupoId) => { reg.expulsiones.push({ sock, grupoId }); }
    });

    delete require.cache[RUTAS_BOT.index];
    delete require.cache[RUTAS_BOT.groups];

    const iniciarBot = require(RUTAS_BOT.index);
    const groups = require(RUTAS_BOT.groups);

    iniciarBot();

    return { groups };

}

// Crea entorno + BOT, y dota a cada socket falso creado de los métodos IQ
// que usa la cola real de grupos + los listeners reales de groups.js
// (el entorno de sesiones inyecta un registerGroups no-op).
function montar(sesiones) {

    process.env.GROUP_QUEUE_DELAY_MS = "0";

    const entorno = crearEntorno({ sesionesIniciales: sesiones });
    const reg = crearRegistro();
    const { groups } = cargarBot(reg);

    delete require.cache[RUTAS_BOT.groupQueue];
    const groupQueue = require(RUTAS_BOT.groupQueue);

    const prepararSocket = (sessionId) => {
        const sock = entorno.manager.get(sessionId);
        if (!sock || sock._preparado) return sock;
        sock._preparado = true;
        sock.user = { id: `${sessionId}:1@s.whatsapp.net` };
        sock.groupSettingUpdate = async (grupoId, ajuste) => { reg.iqEjecutadas.push({ sessionId, op: ajuste, grupoId }); };
        sock.groupParticipantsUpdate = async (grupoId, p, accion) => { reg.iqEjecutadas.push({ sessionId, op: accion, grupoId }); };
        groups.registerGroups(sock);
        return sock;
    };

    return { ...entorno, reg, groupQueue, prepararSocket };

}

const eventosActivos = (manager) => {
    const eventos = [];
    manager.on("activeChanged", (p) => eventos.push({ tipo: "activeChanged", ...p }));
    manager.on("activeLost", () => eventos.push({ tipo: "activeLost" }));
    manager.on("activeSocketClosed", (p) => eventos.push({ tipo: "activeSocketClosed", ...p }));
    return eventos;
};

const resultados = [];

async function test(nombre, fn) {

    try {
        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.stack || err.message}`);
    }

    await flush(60);

}

async function main() {

    acelerarTimers();

    // -----------------------------------------------------------------
    await test("1. A conecta: connecting NO cuenta como conectado ni activo; se activa al llegar a open", async () => {

        const { manager, reg, prepararSocket } = montar([sesion("A")]);
        const eventos = eventosActivos(manager);

        await manager.start("A");
        const A = prepararSocket("A");

        assert.strictEqual(manager.has("A"), true, "el socket existe en el Map");
        assert.strictEqual(manager.isConnected("A"), false, "connecting NO es conectado");
        assert.deepStrictEqual(manager.getConnectedSessions(), []);
        assert.strictEqual(manager.getActiveSocket(), null);
        assert.strictEqual(await manager.setActive("A"), false, "setActive rechaza un socket connecting");
        assert.strictEqual(manager.getActiveSession(), null);
        assert.strictEqual(reg.registrados.length, 0, "ningún listener de negocio antes de open");

        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A", { mensaje: "A debería activarse al llegar a open" });
        await esperarHasta(() => reg.registrados.length === 1);

        assert.strictEqual(manager.isConnected("A"), true);
        assert.strictEqual(reg.registrados[0].sock, A);
        assert.strictEqual(eventos.filter(e => e.tipo === "activeChanged").length, 1);

        A.ev.emit("connection.update", { receivedPendingNotifications: true });
        assert.strictEqual(manager.isConnected("A"), true, "pending_flushed sigue siendo conectado");

    });

    // -----------------------------------------------------------------
    await test("2. A funciona: grupos y cola de IQ de grupo actúan con el socket activo", async () => {

        const { manager, reg, groupQueue, prepararSocket } = montar([sesion("A")]);

        await manager.start("A");
        const A = prepararSocket("A");
        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");

        assert.strictEqual(manager.esSocketVigenteActivo(A), true);

        A.ev.emit("group-participants.update", { id: "g1@g.us", action: "add", participants: ["x@s.whatsapp.net"] });
        await esperarHasta(() => reg.expulsiones.length === 1 && reg.sincronizados.length === 1, { mensaje: "A debería evaluar bloqueo y sincronizar" });

        await groupQueue.groupSettingUpdate(A, "g1@g.us", "not_announcement");
        assert.deepStrictEqual(reg.iqEjecutadas, [{ sessionId: "A", op: "not_announcement", grupoId: "g1@g.us" }]);

    });

    // -----------------------------------------------------------------
    await test("3. cambio A -> B (B open): corte limpio, A deja de actuar, B funciona", async () => {

        const { manager, reg, groupQueue, prepararSocket } = montar([sesion("A"), sesion("B")]);

        await manager.start("A");
        await manager.start("B");
        const A = prepararSocket("A");
        const B = prepararSocket("B");

        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");
        emitirOpen(B);
        await esperarHasta(() => manager.isConnected("B"));
        await flush(20);
        assert.strictEqual(manager.getActiveSession(), "A", "B conectada no reemplaza a A por sí sola");

        const resultado = await manager.solicitarActivacion("B", { preferida: true });
        assert.strictEqual(resultado, "activa");
        await esperarHasta(() => reg.registrados.length === 2);

        assert.strictEqual(manager.getActiveSession(), "B");
        assert.deepStrictEqual(reg.eliminados, ["A"], "listener de negocio de A eliminado");
        assert.deepStrictEqual(reg.workersDetenidos, ["A"], "worker de A detenido");
        assert.deepStrictEqual(reg.schedulerDetenido, ["A"], "scheduler de A detenido");
        assert.strictEqual(reg.registrados[1].sock, B);

        assert.strictEqual(manager.esSocketVigenteActivo(A), false, "A ya no puede actuar");
        assert.strictEqual(manager.esSocketVigenteActivo(B), true);

        await assert.rejects(groupQueue.groupSettingUpdate(A, "g@g.us", "announcement"), /SOCKET_NO_VIGENTE/);
        await groupQueue.groupSettingUpdate(B, "g@g.us", "announcement");
        assert.deepStrictEqual(reg.iqEjecutadas.map(x => x.sessionId), ["B"], "solo B ejecutó la acción");

    });

    // -----------------------------------------------------------------
    await test("4. cambio A -> B (B connecting): A se detiene ya; B se activa solo al llegar a open", async () => {

        const { manager, reg, prepararSocket } = montar([sesion("A"), sesion("B")]);
        const eventos = eventosActivos(manager);

        await manager.start("A");
        const A = prepararSocket("A");
        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");

        await manager.start("B");
        const B = prepararSocket("B");

        const resultado = await manager.solicitarActivacion("B", { preferida: true });
        assert.strictEqual(resultado, "pendiente");

        assert.strictEqual(manager.getActiveSession(), null, "A deja de ser activa de inmediato");
        assert.strictEqual(manager.getActiveSocket(), null);
        assert.ok(eventos.some(e => e.tipo === "activeLost"));
        await esperarHasta(() => reg.eliminados.includes("A") && reg.workersDetenidos.includes("A"), { mensaje: "recursos de A detenidos" });
        assert.strictEqual(manager.esSocketVigenteActivo(A), false);
        assert.strictEqual(reg.registrados.length, 1, "B todavía no registra nada");

        // Una reconexión de A mientras B está pendiente NO devuelve A a activa.
        await manager.evaluarConexion("A");
        assert.strictEqual(manager.getActiveSession(), null);

        emitirOpen(B);
        await esperarHasta(() => manager.getActiveSession() === "B", { mensaje: "B debería activarse al llegar a open" });
        await esperarHasta(() => reg.registrados.length === 2);
        assert.strictEqual(reg.registrados[1].sock, B);
        assert.strictEqual(manager.activacionPendiente, null);

    });

    // -----------------------------------------------------------------
    await test("5. B pendiente cae definitivamente -> se cancela y vuelve a A (failover normal)", async () => {

        const { manager, reg, prepararSocket } = montar([sesion("A"), sesion("B")]);

        await manager.start("A");
        const A = prepararSocket("A");
        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");

        await manager.start("B");
        const B = prepararSocket("B");
        assert.strictEqual(await manager.solicitarActivacion("B"), "pendiente");

        emitirClose(B, 401);
        await esperarHasta(() => manager.getActiveSession() === "A", { mensaje: "debería volver a A" });
        assert.strictEqual(manager.activacionPendiente, null);
        await esperarHasta(() => reg.registrados.filter(x => x.sock === A).length === 2, { mensaje: "A re-registrada" });

    });

    // -----------------------------------------------------------------
    await test("6. reinicio (restaurarSesiones): nadie activo antes de open; gana la sesión guardada como activa", async () => {

        const { manager, reg, prepararSocket } = montar([sesion("A", { activa: true }), sesion("B")]);

        // mismo orden que server.js/restaurarSesiones
        assert.strictEqual(await manager.solicitarActivacion("A", { permitirSinSocket: true }), "pendiente");
        await manager.start("A");
        await manager.start("B");
        const A = prepararSocket("A");
        const B = prepararSocket("B");

        await flush(30);
        assert.strictEqual(manager.getActiveSession(), null, "ninguna sesión activa antes de open");
        assert.strictEqual(manager.getActiveSocket(), null);
        assert.strictEqual(reg.registrados.length, 0, "ningún listener de negocio antes de open");

        // B abre primero: NO se promueve (A está pendiente)
        emitirOpen(B);
        await esperarHasta(() => manager.isConnected("B"));
        await flush(30);
        assert.strictEqual(manager.getActiveSession(), null);
        assert.strictEqual(reg.registrados.length, 0);

        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");
        await esperarHasta(() => reg.registrados.length === 1);
        assert.strictEqual(reg.registrados[0].sock, A);

    });

    // -----------------------------------------------------------------
    await test("7. reconexión de A: todo se detiene al cerrarse; el socket viejo no actúa; el nuevo se registra al abrir", async () => {

        const { manager, reg, groupQueue, prepararSocket, estadoBaileys } = montar([sesion("A")]);
        const eventos = eventosActivos(manager);

        await manager.start("A");
        const A1 = prepararSocket("A");
        emitirOpen(A1);
        await esperarHasta(() => manager.getActiveSession() === "A");
        await esperarHasta(() => reg.registrados.length === 1);

        emitirClose(A1, 408); // corte temporal de una sesión autenticada

        assert.ok(eventos.some(e => e.tipo === "activeSocketClosed" && e.socket === A1), "aviso inmediato de cierre del socket activo");
        await esperarHasta(() => reg.workersDetenidos.includes("A") && reg.schedulerDetenido.includes("A"), { mensaje: "workers/scheduler detenidos al cerrarse" });
        assert.strictEqual(manager.esSocketVigenteActivo(A1), false, "el socket cerrado ya no puede actuar");
        assert.strictEqual(manager.getActiveSocket(), null);
        await assert.rejects(groupQueue.groupSettingUpdate(A1, "g@g.us", "announcement"), /SOCKET_NO_VIGENTE/);

        await esperarHasta(() => estadoBaileys.socketsCreados.length === 2, { mensaje: "reconexión crea socket nuevo" });
        const A2 = prepararSocket("A");
        assert.notStrictEqual(A2, A1);
        assert.strictEqual(manager.isConnected("A"), false, "el socket nuevo todavía está connecting");

        emitirOpen(A2);
        await esperarHasta(() => reg.registrados.length === 2, { mensaje: "listener registrado en el socket nuevo" });
        assert.strictEqual(reg.registrados[1].sock, A2);
        assert.strictEqual(manager.esSocketVigenteActivo(A2), true);
        assert.strictEqual(manager.esSocketVigenteActivo(A1), false);

        // Eventos tardíos del socket viejo no disparan nada.
        A1.ev.emit("group-participants.update", { id: "g@g.us", action: "add", participants: ["x@s.whatsapp.net"] });
        await flush(20);
        assert.strictEqual(reg.expulsiones.length, 0);

    });

    // -----------------------------------------------------------------
    await test("8. grupos: la sesión secundaria no actúa; dos sesiones en el mismo grupo -> una sola acción", async () => {

        const { manager, reg, prepararSocket } = montar([sesion("A"), sesion("B")]);

        await manager.start("A");
        await manager.start("B");
        const A = prepararSocket("A");
        const B = prepararSocket("B");
        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");
        emitirOpen(B);
        await esperarHasta(() => manager.isConnected("B"));

        const evento = { id: "compartido@g.us", action: "add", participants: ["x@s.whatsapp.net"] };

        B.ev.emit("group-participants.update", evento);
        B.ev.emit("groups.update", [{ id: "compartido@g.us" }]);
        await flush(30);
        assert.strictEqual(reg.expulsiones.length, 0, "B (secundaria) no expulsa");
        assert.strictEqual(reg.escaneos.length, 0, "B (secundaria) no escanea");
        assert.strictEqual(reg.sincronizados.length, 0, "B (secundaria) no sincroniza");

        A.ev.emit("group-participants.update", evento);
        B.ev.emit("group-participants.update", evento);
        await esperarHasta(() => reg.sincronizados.length >= 1);
        await flush(30);

        assert.strictEqual(reg.expulsiones.length, 1, "la acción se ejecuta UNA sola vez");
        assert.strictEqual(reg.expulsiones[0].sock, A);
        assert.strictEqual(reg.sincronizados.length, 1);
        assert.strictEqual(reg.sincronizados[0].sock, A);

    });

    // -----------------------------------------------------------------
    await test("9. cola de IQ de grupo: acción encolada con A y ejecutada después del cambio -> cancelada", async () => {

        const { manager, reg, groupQueue, prepararSocket } = montar([sesion("A"), sesion("B")]);

        await manager.start("A");
        await manager.start("B");
        const A = prepararSocket("A");
        const B = prepararSocket("B");
        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");
        emitirOpen(B);
        await esperarHasta(() => manager.isConnected("B"));

        // Bloquear la cola con una operación lenta de A, encolar otra de A,
        // cambiar a B antes de que le toque turno.
        let liberar;
        A.groupSettingUpdate = (grupoId, ajuste) => new Promise(res => {
            liberar = () => { reg.iqEjecutadas.push({ sessionId: "A", op: ajuste, grupoId }); res(); };
        });

        const primera = groupQueue.groupSettingUpdate(A, "g1@g.us", "announcement");
        const segunda = groupQueue.groupSettingUpdate(A, "g2@g.us", "announcement");
        await esperarHasta(() => typeof liberar === "function");

        await manager.solicitarActivacion("B");
        liberar();

        await primera; // ya estaba en vuelo cuando A era válida
        await assert.rejects(segunda, /SOCKET_NO_VIGENTE/, "la acción de A que esperaba turno se cancela");
        assert.deepStrictEqual(reg.iqEjecutadas.map(x => x.grupoId), ["g1@g.us"]);
        assert.ok(B);

    });

    // -----------------------------------------------------------------
    await test("10. workerEventos: el tick sobre un socket no vigente se omite (sin tocar el socket)", async () => {

        const { manager, prepararSocket } = montar([sesion("A"), sesion("B")]);

        await manager.start("A");
        await manager.start("B");
        const A = prepararSocket("A");
        const B = prepararSocket("B");
        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === "A");
        emitirOpen(B);
        await esperarHasta(() => manager.isConnected("B"));

        // Módulo REAL de iniciarWorkerEventos, con workerEventos simulado y
        // el setInterval capturado (mismo enfoque que _test_consistencia_grupos).
        const ticks = [];
        inyectar(RUTAS_BOT.workerEventos, { workerEventos: async (sock) => ticks.push(sock) });
        delete require.cache[RUTAS_BOT.worker];

        const setIntervalOriginal = global.setInterval;
        const callbacks = [];
        global.setInterval = (fn) => { callbacks.push(fn); return { unref() {} }; };

        let worker;
        try {
            worker = require(RUTAS_BOT.worker);
            worker.iniciarWorkerEventos(A);
        } finally {
            global.setInterval = setIntervalOriginal;
        }

        await callbacks[0]();
        assert.deepStrictEqual(ticks, [A], "con A activa el tick trabaja");

        await manager.solicitarActivacion("B");
        await callbacks[0]();
        assert.deepStrictEqual(ticks, [A], "tras el cambio el tick de A se omite");

        worker.detenerWorkerEventos("A");
        assert.ok(B);

    });

    restaurarTimers();

    require(RUTAS_BOT.propiedad).configurar(null);

    console.log("\n============================");
    const pasaron = resultados.filter(x => x.ok).length;
    const fallaron = resultados.filter(x => !x.ok).length;
    console.log(`TOTAL: ${resultados.length}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
    console.log("============================");

    if (fallaron) {
        console.log("Fallos:", resultados.filter(x => !x.ok).map(x => x.nombre));
    }

    process.exit(fallaron ? 1 : 0);

}

main().catch(err => {
    restaurarTimers();
    console.error("💥 ERROR INESPERADO:", err);
    process.exit(1);
});
