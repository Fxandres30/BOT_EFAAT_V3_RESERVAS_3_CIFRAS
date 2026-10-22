// ==========================================================================
// PRUEBAS — MULTISESIÓN: varios clientes, cada uno con su WhatsApp, a la vez.
//
// REALES: services/baileys/{socket,manager,lease,estados,conectado,
// desconectado}.js, bot/index.js (registro por sesión + vigilante),
// bot/events/messages.upsert.js (listener de negocio), propiedadSesion.js y
// restaurarSesiones.js.
// SIMULADOS: Baileys (sockets falsos), Supabase (fakeSupabaseSesiones, con
// el lease 004 replicado), el manejador de negocio (registra con qué socket
// y qué dueño se procesa cada mensaje) y los workers (cuentan arranques y
// paradas por sesión para detectar duplicados y huérfanos).
//
// Sin WhatsApp real ni Supabase real.
//
//     node backend/tests/sesiones/multisesion.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearEntorno, flush, esperarHasta, acelerarTimers, restaurarTimers } = require("./entornoFake");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(rel, exportsObj) {
    const abs = r(rel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const C1 = "cliente-1";
const C2 = "cliente-2";

function sesion(id, usuario_id, extra = {}) {
    return { id, usuario_id, nombre: `Sesión ${id}`, estado: "desconectado", activa: false, principal: false, telefono: null, ...extra };
}

// ------------------------------------------------- bot real + espías ---

const WORKERS = ["eventos", "scheduler", "inactividad", "publicador", "escaner", "identitySync"];

function montarBot() {

    const procesados = [];
    const trabajos = Object.fromEntries(WORKERS.map(w => [w, new Map()])); // sessionId -> veces arrancado sin parar
    const duplicados = [];

    const arrancar = (tipo, sessionId) => {
        const n = trabajos[tipo].get(sessionId) || 0;
        if (n > 0) duplicados.push(`${tipo}:${sessionId}`);
        trabajos[tipo].set(sessionId, n + 1);
    };
    const parar = (tipo, sessionId) => trabajos[tipo].delete(sessionId);

    inyectar("bot/handlers/messageHandler.js", async ({ sock, session, message }) => {
        // Pequeña espera aleatoria: intercala el procesamiento de clientes.
        await new Promise(res => setImmediate(res));
        procesados.push({ sessionId: session?.sessionId, usuarioId: session?.usuarioId, sock, id: message.key.id, grupo: message.key.remoteJid });
    });
    inyectar("bot/events/identitySync.upsert.js", {
        registerIdentitySync: (_s, id) => arrancar("identitySync", id),
        unregisterIdentitySync: id => parar("identitySync", id)
    });
    inyectar("bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js", {
        iniciarWorkerEventos: s => arrancar("eventos", s.context.sessionId),
        detenerWorkerEventos: id => parar("eventos", id)
    });
    inyectar("automation/scheduler.js", { start: s => arrancar("scheduler", s.context.sessionId), stop: id => parar("scheduler", id) });
    inyectar("bot/funciones/inactividad/workerInactividad.js", {
        iniciarWorkerInactividad: s => arrancar("inactividad", s.context.sessionId),
        detenerWorkerInactividad: id => parar("inactividad", id)
    });
    inyectar("sorteos/publicador.js", {
        iniciarPublicadorSorteos: s => arrancar("publicador", s.context.sessionId),
        detenerPublicadorSorteos: id => parar("publicador", id)
    });
    inyectar("bot/funciones/usuarios/escanerIdentidadesLifecycle.js", {
        iniciarEscanerIdentidades: id => arrancar("escaner", id),
        detenerEscanerIdentidades: id => parar("escaner", id)
    });

    for (const m of ["bot/index.js", "bot/events/messages.upsert.js", "services/baileys/propiedadSesion.js", "bot/funciones/mensajes/compuertaIngreso.js"]) {
        delete require.cache[r(m)];
    }

    const iniciarBot = require(r("bot/index.js"));
    const propiedadSesion = require(r("services/baileys/propiedadSesion.js"));
    iniciarBot();

    // Sesiones con cada tipo de trabajo en marcha (deben coincidir entre sí
    // y con las registradas en el bot: ni duplicados ni huérfanos).
    const enMarcha = tipo => [...trabajos[tipo].keys()].sort();

    return { iniciarBot, propiedadSesion, procesados, enMarcha, duplicados };

}

function crear(sesiones) {
    const entorno = crearEntorno({ sesionesIniciales: sesiones });
    const bot = montarBot();
    return { ...entorno, ...bot };
}

function emitir(sock, connection, statusCode) {
    sock.ev.emit("connection.update", connection === "open"
        ? { connection: "open" }
        : { connection: "close", lastDisconnect: { error: { output: { statusCode } } } });
}

// Listeners de NEGOCIO de messages.upsert en un socket: el total menos los
// de observación que socket.js y diagnostico/cicloMensaje.js ponen al crearlo.
const base = new WeakMap();
const listenersNegocio = (sock) => sock.ev.listenerCount("messages.upsert") - (base.get(sock) ?? 0);

// Abre una sesión y espera a que el manager termine de evaluarla.
async function abrir(manager, id) {
    const pendientes = [];
    const original = manager.evaluarConexion.bind(manager);
    manager.evaluarConexion = (sid) => { const p = original(sid); if (sid === id) pendientes.push(p); return p; };
    try {
        if (!manager.has(id)) await manager.start(id);
        const sock = manager.get(id);
        if (!base.has(sock)) base.set(sock, sock.ev.listenerCount("messages.upsert"));
        sock.user = { id: `${id}:1@s.whatsapp.net` };
        emitir(sock, "open");
        await esperarHasta(() => pendientes.length > 0, { maxVueltas: 20000, mensaje: `evaluación de ${id}` });
        await Promise.all(pendientes);
        await flush(4);
        return sock;
    } finally {
        manager.evaluarConexion = original;
    }
}

let secuencia = 0;
function mensaje(grupo) {
    return {
        key: { remoteJid: grupo, id: `M${++secuencia}`, participant: `57300${secuencia}@s.whatsapp.net`, fromMe: false },
        message: { conversation: "quiero el 05" },
        messageTimestamp: Math.floor(Date.now() / 1000) + 5
    };
}

const registradas = (bot) => bot.iniciarBot.estadoBot().sesiones.map(s => s.sessionId).sort();

// Invariante en cualquier momento estable: lo registrado en el bot = las
// sesiones activas del manager con socket open, y cada tipo de worker
// corre exactamente para esas, una vez.
function comprobarInvariantes(e, contexto = "") {
    const activasOpen = e.manager.getSesionesActivas()
        .filter(a => e.manager.isConnected(a.sessionId))
        .map(a => a.sessionId).sort();
    assert.deepStrictEqual(registradas(e), activasOpen, `${contexto}: registradas = activas open`);
    for (const tipo of WORKERS) assert.deepStrictEqual(e.enMarcha(tipo), activasOpen, `${contexto}: ${tipo} sin huérfanos`);
    assert.deepStrictEqual(e.duplicados, [], `${contexto}: ningún worker arrancado dos veces`);
    for (const { sessionId } of e.manager.getSesionesActivas()) {
        const sock = e.manager.get(sessionId);
        if (sock && e.manager.isConnected(sessionId)) assert.strictEqual(listenersNegocio(sock), 1, `${contexto}: un listener de negocio en ${sessionId}`);
    }
}

// ---------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("dos clientes conectados a la vez: ambos activos, ambos procesan, cada uno con su socket", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    const sA = await abrir(e.manager, "A");
    const sB = await abrir(e.manager, "B");
    assert.strictEqual(e.manager.getSesionActivaDe(C1), "A");
    assert.strictEqual(e.manager.getSesionActivaDe(C2), "B");
    assert.deepStrictEqual(registradas(e), ["A", "B"]);
    assert.ok(e.propiedadSesion.puedeActuar(sA) && e.propiedadSesion.puedeActuar(sB), "ambos sockets pueden actuar");
    assert.strictEqual(e.manager.getSocketActivoDe(C1), sA);
    assert.strictEqual(e.manager.getSocketActivoDe(C2), sB);
    comprobarInvariantes(e, "tras conectar A y B");
});

prueba("mensajes concurrentes de ambos clientes: cada mensaje se procesa con SU socket y SU dueño", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    const sA = await abrir(e.manager, "A");
    const sB = await abrir(e.manager, "B");
    const N = 60;
    for (let i = 0; i < N; i++) {
        sA.ev.emit("messages.upsert", { messages: [mensaje("grupoA@g.us")], type: "notify" });
        sB.ev.emit("messages.upsert", { messages: [mensaje("grupoB@g.us")], type: "notify" });
    }
    await esperarHasta(() => e.procesados.length === 2 * N, { mensaje: `procesados ${e.procesados.length}/${2 * N}` });
    const deA = e.procesados.filter(p => p.grupo === "grupoA@g.us");
    const deB = e.procesados.filter(p => p.grupo === "grupoB@g.us");
    assert.strictEqual(deA.length, N);
    assert.strictEqual(deB.length, N);
    assert.ok(deA.every(p => p.sock === sA && p.sessionId === "A" && p.usuarioId === C1), "A siempre con su socket y su dueño");
    assert.ok(deB.every(p => p.sock === sB && p.sessionId === "B" && p.usuarioId === C2), "B siempre con su socket y su dueño");
});

prueba("conectar B no toca a A; desconectar A (panel) no toca a B", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    const sA = await abrir(e.manager, "A");
    await abrir(e.manager, "B");
    assert.strictEqual(e.manager.getSocketActivoDe(C1), sA, "A sigue con el mismo socket");
    assert.strictEqual(listenersNegocio(sA), 1);
    const sB = e.manager.get("B");
    await e.manager.stop("A");
    await flush(10);
    assert.strictEqual(e.manager.getSesionActivaDe(C1), null);
    assert.strictEqual(e.manager.getSocketActivoDe(C2), sB);
    assert.deepStrictEqual(registradas(e), ["B"]);
    assert.strictEqual(listenersNegocio(sA), 0, "A sin listener");
    sB.ev.emit("messages.upsert", { messages: [mensaje("grupoB@g.us")], type: "notify" });
    await esperarHasta(() => e.procesados.length === 1);
    assert.strictEqual(e.procesados[0].sessionId, "B");
    comprobarInvariantes(e, "tras parar A");
});

prueba("fallo TEMPORAL de A (408): se detiene, reconecta con socket nuevo y se re-registra; B intacto", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    const viejoA = await abrir(e.manager, "A");
    const sB = await abrir(e.manager, "B");
    emitir(viejoA, "close", 408);
    await esperarHasta(() => e.manager.get("A") && e.manager.get("A") !== viejoA, { maxVueltas: 20000, mensaje: "A debería crear un socket nuevo" });
    assert.deepStrictEqual(registradas(e), ["B"], "mientras A reconecta, solo B");
    const nuevoA = await abrir(e.manager, "A");
    assert.notStrictEqual(nuevoA, viejoA);
    assert.strictEqual(e.manager.getSocketActivoDe(C1), nuevoA);
    assert.strictEqual(listenersNegocio(viejoA), 0, "el socket viejo no conserva el listener");
    assert.strictEqual(e.manager.getSocketActivoDe(C2), sB, "B nunca se tocó");
    comprobarInvariantes(e, "tras reconectar A");
});

prueba("fallo DEFINITIVO de A (401): A queda fuera; B sigue procesando", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    const sA = await abrir(e.manager, "A");
    const sB = await abrir(e.manager, "B");
    emitir(sA, "close", 401);
    await esperarHasta(() => e.manager.getSesionActivaDe(C1) === null, { mensaje: "A debería dejar de ser activa" });
    await flush(10);
    assert.strictEqual(e.manager.getSocketActivoDe(C2), sB);
    assert.deepStrictEqual(registradas(e), ["B"]);
    comprobarInvariantes(e, "tras caída definitiva de A");
});

prueba("failover limitado al mismo dueño: A1 cae -> A2 (cliente 1); B (cliente 2) intacto", async () => {
    const e = crear([sesion("A1", C1), sesion("A2", C1), sesion("B", C2, { principal: true })]);
    const a1 = await abrir(e.manager, "A1");
    await abrir(e.manager, "A2");
    const sB = await abrir(e.manager, "B");
    assert.deepStrictEqual(registradas(e), ["A1", "B"], "A2 queda en reserva de su cliente");
    emitir(a1, "close", 401);
    await esperarHasta(() => e.manager.getSesionActivaDe(C1) === "A2", { mensaje: "debería pasar a A2" });
    await flush(10);
    assert.strictEqual(e.manager.getSocketActivoDe(C2), sB, "B no se usa para el cliente 1 ni se toca");
    assert.deepStrictEqual(registradas(e), ["A2", "B"]);
    comprobarInvariantes(e, "tras failover");
});

prueba("leases separados: cada sesión tiene su propio lease y su propio heartbeat; parar una suelta solo el suyo", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    await abrir(e.manager, "A");
    await abrir(e.manager, "B");
    const filas = e.fakeSupabase._lease.filas;
    assert.ok(filas.get("A") && filas.get("B"), "un lease por sesión");
    assert.strictEqual(filas.get("A").owner_id, e.lease.OWNER_ID);
    assert.strictEqual(filas.get("B").owner_id, e.lease.OWNER_ID);
    assert.deepStrictEqual(e.lease.sesionesConLeasePropio().sort(), ["A", "B"]);
    await e.manager.stop("A");
    await flush(10);
    assert.deepStrictEqual(e.lease.sesionesConLeasePropio(), ["B"], "solo se soltó el de A");
    assert.ok(filas.get("B").owner_id === e.lease.OWNER_ID);
});

prueba("misma sesión, otro proceso con su lease: este proceso NO crea socket (nunca dos dueños de un WhatsApp)", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    e.fakeSupabase._lease.sembrar("A", { ownerId: "otra-maquina:999", ttlSegundosRestantes: 60 });
    const r1 = await e.manager.start("A");
    assert.strictEqual(r1, e.manager.LEASE_NO_DISPONIBLE);
    assert.strictEqual(e.manager.has("A"), false);
    await abrir(e.manager, "B");
    assert.deepStrictEqual(registradas(e), ["B"], "las demás sesiones funcionan igual");
});

prueba("sin dueño: una sesión sin usuario_id conecta pero no se activa, no procesa y no puede actuar", async () => {
    const e = crear([sesion("X", null), sesion("B", C2)]);
    const sX = await abrir(e.manager, "X");
    const sB = await abrir(e.manager, "B");
    assert.strictEqual(e.manager.isActive("X"), false);
    assert.strictEqual(e.propiedadSesion.puedeActuar(sX), false);
    assert.strictEqual(listenersNegocio(sX), 0);
    assert.strictEqual(await e.manager.setActive("X"), false, "setActive rechaza la sesión sin dueño");
    assert.strictEqual(await e.manager.solicitarActivacion("X"), false);
    assert.deepStrictEqual(registradas(e), ["B"]);
    assert.ok(e.propiedadSesion.puedeActuar(sB));
    comprobarInvariantes(e, "con una sesión sin dueño");
});

prueba("restauración tras reiniciar: levanta TODAS las sesiones conectadas y activa la de CADA cliente", async () => {
    const e = crear([
        sesion("A", C1, { estado: "conectado", activa: true }),
        sesion("A2", C1, { estado: "conectado", activa: false }),
        sesion("B", C2, { estado: "conectado", activa: true }),
        sesion("D", C2, { estado: "desconectado", activa: false })
    ]);
    const { restaurarSesiones } = require(r("services/baileys/restaurarSesiones.js"));
    await restaurarSesiones({ supabase: e.fakeSupabase.client, manager: e.manager });
    assert.deepStrictEqual(e.manager.getAll().sort(), ["A", "A2", "B"], "solo las que estaban conectadas");
    // B abre primero: igual se activa la de cada cliente según la BD.
    await abrir(e.manager, "A2");
    await abrir(e.manager, "B");
    await abrir(e.manager, "A");
    assert.strictEqual(e.manager.getSesionActivaDe(C1), "A", "la activa guardada del cliente 1, no la que abrió antes");
    assert.strictEqual(e.manager.getSesionActivaDe(C2), "B");
    assert.deepStrictEqual(registradas(e), ["A", "B"]);
    comprobarInvariantes(e, "tras restaurar");
});

prueba("sin listeners duplicados ni workers huérfanos tras 5 reconexiones de A mientras B procesa", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    let sA = await abrir(e.manager, "A");
    const sB = await abrir(e.manager, "B");
    const viejos = [];
    for (let i = 0; i < 5; i++) {
        viejos.push(sA);
        emitir(sA, "close", 408);
        sB.ev.emit("messages.upsert", { messages: [mensaje("grupoB@g.us")], type: "notify" });
        await esperarHasta(() => e.manager.get("A") && e.manager.get("A") !== sA, { maxVueltas: 20000, mensaje: `reconexión ${i}` });
        sA = await abrir(e.manager, "A");
        comprobarInvariantes(e, `ciclo ${i}`);
    }
    assert.ok(viejos.every(v => listenersNegocio(v) === 0), "ningún socket viejo con listener");
    await esperarHasta(() => e.procesados.length === 5);
    assert.ok(e.procesados.every(p => p.sessionId === "B" && p.sock === sB));
});

prueba("carrera: cambio de sesión A1 -> A2 del cliente 1 mientras B procesa; B no se entera", async () => {
    const e = crear([sesion("A1", C1), sesion("A2", C1), sesion("B", C2)]);
    const a1 = await abrir(e.manager, "A1");
    const a2 = await abrir(e.manager, "A2");
    const sB = await abrir(e.manager, "B");
    const [r1] = await Promise.all([
        e.manager.solicitarActivacion("A2", { preferida: true }),
        (async () => { for (let i = 0; i < 20; i++) sB.ev.emit("messages.upsert", { messages: [mensaje("grupoB@g.us")], type: "notify" }); })()
    ]);
    assert.strictEqual(r1, "activa");
    await flush(10);
    assert.strictEqual(e.manager.getSesionActivaDe(C1), "A2");
    assert.strictEqual(e.propiedadSesion.puedeActuar(a1), false, "A1 ya no actúa");
    assert.ok(e.propiedadSesion.puedeActuar(a2) && e.propiedadSesion.puedeActuar(sB));
    await esperarHasta(() => e.procesados.length === 20);
    assert.ok(e.procesados.every(p => p.sessionId === "B"));
    comprobarInvariantes(e, "tras el cambio");
});

prueba("vigilante: detiene lo registrado de una sesión que ya no es la activa de su cliente (huérfana)", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    await abrir(e.manager, "A");
    await abrir(e.manager, "B");
    // Estado inconsistente: el manager deja de tener a B como activa sin avisar al bot.
    e.manager.activas.delete(C2);
    e.iniciarBot.revisarSalud();
    assert.deepStrictEqual(registradas(e), ["A"]);
    assert.deepStrictEqual(e.enMarcha("eventos"), ["A"]);
});

prueba("la API antigua (getActiveSession/getActiveSocket) sigue respondiendo con una sesión", async () => {
    const e = crear([sesion("A", C1), sesion("B", C2)]);
    const sA = await abrir(e.manager, "A");
    await abrir(e.manager, "B");
    assert.strictEqual(e.manager.getActiveSession(), "A");
    assert.strictEqual(e.manager.getActiveSocket(), sA);
    assert.strictEqual(e.manager.isActive("B"), true, "isActive: activa de SU cliente");
});

(async () => {
    const originales = {};
    for (const m of ["log", "warn", "error", "time", "timeEnd", "dir", "table"]) { originales[m] = console[m]; console[m] = () => {}; }
    acelerarTimers();
    let ok = 0, falla = 0;
    const resultados = [];
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; resultados.push(`✅ ${n}`); }
        catch (err) { falla++; resultados.push(`❌ ${n}\n   ${err.message}`); }
    }
    restaurarTimers();
    Object.assign(console, originales);
    for (const l of resultados) console.log(l);
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
