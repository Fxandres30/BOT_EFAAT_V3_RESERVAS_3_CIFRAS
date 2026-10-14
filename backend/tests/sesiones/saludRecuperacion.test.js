// ==========================================================================
// PRUEBAS — salud real de la sesión y recuperación automática segura.
//
//   A. services/baileys/salud.js: clasificación (la ausencia de mensajes
//      nunca degrada; listener ausente, worker detenido, errores seguidos,
//      lease sin renovar y lease de otra instancia sí).
//   B. services/baileys/lease.js: heartbeat tolerante (un fallo de red no
//      cierra el socket; lease vencido sin otro dueño se recupera; solo se
//      declara la pérdida cuando OTRA instancia es la dueña).
//   C. bot/index.js revisarSalud(): el vigilante re-registra el listener
//      sobre el socket activo vigente sin duplicar listeners, y no toca
//      nada sin socket activo open.
//   D. iniciarWorkerEventos: un tick colgado no bloquea el worker para
//      siempre y su final tardío no libera la guarda del tick nuevo.
//
// Sin red, sin Supabase real, sin WhatsApp: todo se inyecta vía
// require.cache.
//
//     node backend/tests/sesiones/saludRecuperacion.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");

const RAIZ = path.resolve(__dirname, "../..");
const ruta = r => path.join(RAIZ, r);

function inyectar(rutaRel, exportsObj) {
    const abs = ruta(rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

function recargar(rutaRel) {
    delete require.cache[ruta(rutaRel)];
    return require(ruta(rutaRel));
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function esperarHasta(cond, msMax = 2000) {
    const inicio = Date.now();
    while (!cond()) {
        if (Date.now() - inicio > msMax) throw new Error("timeout esperando condición");
        await esperar(5);
    }
}

// Silencia el ruido de logs de los módulos bajo prueba.
const logOriginal = { log: console.log, warn: console.warn, error: console.error, dir: console.dir };
function silenciar() { console.log = console.warn = console.error = console.dir = () => {}; }
function restaurarLogs() { Object.assign(console, logOriginal); }

// ── Supabase falso: solo las RPC del lease, con fallos programables ──────
const fakeLease = {
    duenio: null,           // owner_id actual
    vence: 0,               // ms epoch
    fallarHeartbeat: false,
    fallarAcquire: false,
    acquireSinFila: false
};

const supabaseFalso = {
    async rpc(nombre, p) {
        const ahora = Date.now();
        if (nombre === "lease_sesiones_heartbeat") {
            if (fakeLease.fallarHeartbeat) return { data: null, error: { message: "fetch failed" } };
            const renovado = fakeLease.duenio === p.p_owner_id && fakeLease.vence > ahora;
            if (renovado) fakeLease.vence = ahora + p.p_ttl_seconds * 1000;
            return { data: [{ renovado, owner_id: fakeLease.duenio, lease_until: new Date(fakeLease.vence).toISOString() }], error: null };
        }
        if (nombre === "lease_sesiones_acquire") {
            if (fakeLease.fallarAcquire) return { data: null, error: { message: "fetch failed" } };
            if (fakeLease.acquireSinFila) return { data: [], error: null };
            const libre = !fakeLease.duenio || fakeLease.vence <= ahora || fakeLease.duenio === p.p_owner_id;
            if (libre) { fakeLease.duenio = p.p_owner_id; fakeLease.vence = ahora + p.p_ttl_seconds * 1000; }
            return { data: [{ adquirido: libre, owner_id: fakeLease.duenio, lease_until: new Date(fakeLease.vence).toISOString() }], error: null };
        }
        if (nombre === "lease_sesiones_release") return { data: [{ liberado: true }], error: null };
        return { data: null, error: { message: "rpc no soportada" } };
    },
    from() { throw new Error("from() no esperado en esta prueba"); }
};

inyectar("lib/supabase.js", supabaseFalso);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ==========================================================================
// A. Clasificación
// ==========================================================================

const salud = recargar("services/baileys/salud.js");

function base(extra = {}) {
    const sock = { id: "s" };
    return { sessionId: "S1", sock, abierto: true, activa: true, ...extra };
}

prueba("A1 sin mensajes en horas NO degrada: socket activo + listener = saludable", () => {
    salud.olvidar("S1");
    const args = base();
    salud.marcarListener("S1", args.sock);
    const r = salud.evaluar(args);
    assert.strictEqual(r.estado, "saludable");
    assert.strictEqual(r.ultimoMensajeRecibidoEn, null);
});

prueba("A2 socket activo open SIN listener sobre ese socket = degradada", () => {
    salud.olvidar("S1");
    const args = base();
    salud.marcarListener("S1", { id: "viejo" });
    const r = salud.evaluar(args);
    assert.strictEqual(r.estado, "degradada");
    assert.ok(r.causas.some(c => /SIN listener/.test(c)));
    assert.ok(r.accion);
});

prueba("A3 sesión no activa y open = conectada (en espera), nunca 'saludable'", () => {
    salud.olvidar("S1");
    const r = salud.evaluar(base({ activa: false }));
    assert.strictEqual(r.estado, "conectada");
});

prueba("A4 socket todavía no open = conectando", () => {
    assert.strictEqual(salud.evaluar(base({ abierto: false })).estado, "conectando");
});

prueba("A5 errores seguidos >= 5 degradan; un procesado OK los reinicia", () => {
    salud.olvidar("S1");
    const args = base();
    salud.marcarListener("S1", args.sock);
    for (let i = 0; i < 5; i++) salud.marcarErrorProceso("S1", new Error("boom " + i));
    assert.strictEqual(salud.evaluar(args).estado, "degradada");
    salud.marcarProcesado("S1");
    assert.strictEqual(salud.evaluar(args).estado, "saludable");
});

prueba("A6 worker de eventos sin ciclos > 3 min = degradada; recién arrancado no", () => {
    salud.olvidar("S1");
    const args = base();
    salud.marcarListener("S1", args.sock);
    salud.marcarTickWorker("S1", "arranque");
    assert.strictEqual(salud.evaluar(args).estado, "saludable");
    const futuro = Date.now() + salud.UMBRAL_WORKER_MS + 1000;
    assert.strictEqual(salud.evaluar({ ...args, ahora: futuro }).estado, "degradada");
    salud.marcarTickWorker("S1", "detenido");
    assert.strictEqual(salud.evaluar({ ...args, ahora: futuro }).estado, "saludable", "sin worker no se evalúa");
});

prueba("A7 lease propio sin renovar 3 veces = degradada (Supabase caído)", () => {
    salud.olvidar("S1");
    const args = base();
    salud.marcarListener("S1", args.sock);
    const r = salud.evaluar({ ...args, estadoLeasePropio: { erroresSeguidos: 3, ultimoError: "fetch failed" } });
    assert.strictEqual(r.estado, "degradada");
});

prueba("A8 sin socket local y lease vigente de OTRA instancia = conflicto_lease", () => {
    const lease = { lease_until: new Date(Date.now() + 10000).toISOString(), owner_id: "VPS:x" };
    assert.strictEqual(salud.evaluar({ sessionId: "S1", sock: null, lease, leasePropio: false }).estado, "conflicto_lease");
});

prueba("A9 sin socket y la base dice 'conectado' = desconectada con causa y acción", () => {
    const r = salud.evaluar({ sessionId: "S1", sock: null, estadoSupabase: "conectado" });
    assert.strictEqual(r.estado, "desconectada");
    assert.ok(/ningún proceso/.test(r.causas[0]));
    assert.ok(r.accion);
});

// ==========================================================================
// B. Heartbeat tolerante del lease
// ==========================================================================

const lease = recargar("services/baileys/lease.js");
const YO = "LOCAL:test:1:yo";
const TTL = 0.3; // segundos
const INTERVALO = 20; // ms

function reiniciarLease(duenio = YO) {
    Object.assign(fakeLease, { duenio, vence: Date.now() + TTL * 1000, fallarHeartbeat: false, fallarAcquire: false, acquireSinFila: false });
}

prueba("B1 error transitorio del heartbeat NO cierra el socket y luego se recupera", async () => {
    reiniciarLease();
    let perdidas = 0;
    lease.iniciarHeartbeat("L1", { ownerId: YO, ttlSegundos: TTL, intervaloMs: INTERVALO, onOwnershipPerdido: () => { perdidas++; } });
    fakeLease.fallarHeartbeat = true;
    await esperarHasta(() => (lease.estadoLease("L1")?.erroresSeguidos || 0) >= 2);
    fakeLease.fallarHeartbeat = false;
    await esperarHasta(() => lease.estadoLease("L1")?.erroresSeguidos === 0);
    lease.detenerHeartbeat("L1");
    assert.strictEqual(perdidas, 0);
});

prueba("B2 lease VENCIDO sin otro dueño: se readquiere sin cerrar el socket", async () => {
    reiniciarLease();
    let perdidas = 0;
    lease.iniciarHeartbeat("L2", { ownerId: YO, ttlSegundos: TTL, intervaloMs: INTERVALO, onOwnershipPerdido: () => { perdidas++; } });
    fakeLease.vence = Date.now() - 1; // expiró (p. ej. proceso pausado)
    await esperarHasta(() => fakeLease.vence > Date.now() && fakeLease.duenio === YO);
    await esperar(INTERVALO * 3);
    lease.detenerHeartbeat("L2");
    assert.strictEqual(perdidas, 0);
});

prueba("B3 OTRA instancia tiene el lease vigente: se declara la pérdida UNA vez", async () => {
    reiniciarLease();
    let perdidas = 0;
    lease.iniciarHeartbeat("L3", { ownerId: YO, ttlSegundos: TTL, intervaloMs: INTERVALO, onOwnershipPerdido: () => { perdidas++; } });
    Object.assign(fakeLease, { duenio: "VPS:otro", vence: Date.now() + 60000 });
    await esperarHasta(() => perdidas > 0);
    await esperar(INTERVALO * 4);
    assert.strictEqual(perdidas, 1);
    assert.deepStrictEqual(lease.sesionesConLeasePropio().includes("L3"), false, "heartbeat detenido");
});

prueba("B4 Supabase caído más allá del TTL (heartbeat y acquire fallan): no cierra nada", async () => {
    reiniciarLease();
    let perdidas = 0;
    lease.iniciarHeartbeat("L4", { ownerId: YO, ttlSegundos: TTL, intervaloMs: INTERVALO, onOwnershipPerdido: () => { perdidas++; } });
    fakeLease.fallarHeartbeat = true;
    fakeLease.fallarAcquire = true;
    await esperar(TTL * 1000 + INTERVALO * 5);
    assert.strictEqual(perdidas, 0);
    assert.ok(lease.estadoLease("L4").erroresSeguidos >= 3, "la salud ve los errores");
    // Supabase vuelve: el lease se recupera solo.
    fakeLease.fallarHeartbeat = false;
    fakeLease.fallarAcquire = false;
    await esperarHasta(() => lease.estadoLease("L4")?.erroresSeguidos === 0);
    lease.detenerHeartbeat("L4");
    assert.strictEqual(perdidas, 0);
});

prueba("B5 acquire sin fila (respuesta vacía) no se toma como 'otro dueño'", async () => {
    reiniciarLease();
    let perdidas = 0;
    lease.iniciarHeartbeat("L5", { ownerId: YO, ttlSegundos: TTL, intervaloMs: INTERVALO, onOwnershipPerdido: () => { perdidas++; } });
    fakeLease.vence = Date.now() - 1;
    fakeLease.acquireSinFila = true;
    await esperar(INTERVALO * 5);
    lease.detenerHeartbeat("L5");
    assert.strictEqual(perdidas, 0);
});

// ==========================================================================
// C. Vigilante de bot/index.js
// ==========================================================================

function montarBot() {

    const manager = new EventEmitter();
    manager.activa = null;
    manager.socket = null;
    manager.getActiveSession = () => manager.activa;
    manager.getActiveSocket = () => manager.socket;
    manager.esSocketVigenteActivo = s => !!s && s === manager.socket;

    const listeners = new Map();
    const llamadas = [];
    const registrados = new Map(); // sessionId -> sock

    inyectar("services/baileys/manager.js", manager);
    inyectar("bot/events/messages.upsert.js", {
        registerMessages(sock, sid) {
            // como el real: quita el anterior antes de registrar
            if (registrados.has(sid)) { const viejo = registrados.get(sid); viejo.ev.off("messages.upsert", listeners.get(sid)); }
            const fn = () => {};
            sock.ev.on("messages.upsert", fn);
            listeners.set(sid, fn);
            registrados.set(sid, sock);
            llamadas.push(["register", sid]);
        },
        unregisterMessages(sid) {
            const s = registrados.get(sid);
            if (s) s.ev.off("messages.upsert", listeners.get(sid));
            registrados.delete(sid);
            llamadas.push(["unregister", sid]);
        },
        socketConListener: sid => registrados.get(sid) || null
    });
    const noop = () => {};
    inyectar("bot/events/identitySync.upsert.js", { registerIdentitySync: noop, unregisterIdentitySync: noop });
    inyectar("bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js", { iniciarWorkerEventos: noop, detenerWorkerEventos: noop });
    inyectar("automation/scheduler.js", { start: noop, stop: noop });
    inyectar("bot/funciones/inactividad/workerInactividad.js", { iniciarWorkerInactividad: noop, detenerWorkerInactividad: noop });
    inyectar("sorteos/publicador.js", { iniciarPublicadorSorteos: noop, detenerPublicadorSorteos: noop });
    inyectar("bot/funciones/usuarios/escanerIdentidadesLifecycle.js", { iniciarEscanerIdentidades: noop, detenerEscanerIdentidades: noop });
    inyectar("services/baileys/identidadSesion.js", { identidadDesdeSocket: () => ({}), maskPhone: x => x });

    const iniciarBot = recargar("bot/index.js");

    return { manager, iniciarBot, llamadas, registrados };

}

function sockFalso(sessionId) {
    const ev = new EventEmitter();
    return { ev, context: { sessionId } };
}

prueba("C1 todo alineado: el vigilante no hace nada", () => {
    const { manager, iniciarBot, llamadas } = montarBot();
    const s = sockFalso("A");
    manager.activa = "A"; manager.socket = s;
    iniciarBot(); // registra con el socket activo existente
    const antes = llamadas.length;
    assert.strictEqual(iniciarBot.revisarSalud(), null);
    assert.strictEqual(iniciarBot.revisarSalud(), null);
    assert.strictEqual(llamadas.length, antes);
});

prueba("C2 socket nuevo sin listener (activeChanged perdido): se recupera a la 2ª revisión, sin duplicar", () => {
    const { manager, iniciarBot, registrados } = montarBot();
    const viejo = sockFalso("A");
    manager.activa = "A"; manager.socket = viejo;
    iniciarBot();
    // Reconexión: el manager ya tiene un socket nuevo open, pero el bot no se enteró.
    const nuevo = sockFalso("A");
    manager.socket = nuevo;
    assert.strictEqual(iniciarBot.revisarSalud(), "sospecha", "primera vez: puede ser una transición");
    assert.strictEqual(iniciarBot.revisarSalud(), "recuperado");
    assert.strictEqual(registrados.get("A"), nuevo);
    assert.strictEqual(nuevo.ev.listenerCount("messages.upsert"), 1, "exactamente un listener");
    assert.strictEqual(viejo.ev.listenerCount("messages.upsert"), 0, "el socket viejo quedó sin listener");
    assert.ok(salud._registros.get("A").recuperaciones.length >= 1, "queda registrada la recuperación");
    assert.strictEqual(iniciarBot.revisarSalud(), null, "después ya está alineado");
});

prueba("C3 mismo socket pero el listener desapareció: re-registro forzado, un solo listener", () => {
    const { manager, iniciarBot, registrados } = montarBot();
    const s = sockFalso("A");
    manager.activa = "A"; manager.socket = s;
    iniciarBot();
    // Algo quitó el listener sin pasar por conectar().
    s.ev.removeAllListeners("messages.upsert");
    registrados.delete("A");
    iniciarBot.revisarSalud();
    assert.strictEqual(iniciarBot.revisarSalud(), "recuperado");
    assert.strictEqual(s.ev.listenerCount("messages.upsert"), 1);
});

prueba("C4 sin socket activo open (reconectando): el vigilante no toca nada", () => {
    const { manager, iniciarBot, llamadas } = montarBot();
    manager.activa = "A"; manager.socket = null;
    iniciarBot();
    assert.strictEqual(iniciarBot.revisarSalud(), null);
    assert.strictEqual(iniciarBot.revisarSalud(), null);
    assert.strictEqual(llamadas.filter(l => l[0] === "register").length, 0);
});

prueba("C5 una transición que se resuelve sola no dispara recuperación", () => {
    const { manager, iniciarBot, llamadas } = montarBot();
    const viejo = sockFalso("A");
    manager.activa = "A"; manager.socket = viejo;
    iniciarBot();
    const nuevo = sockFalso("A");
    manager.socket = nuevo;
    assert.strictEqual(iniciarBot.revisarSalud(), "sospecha");
    manager.emit("activeChanged", { socket: nuevo, sessionId: "A" }); // llega el evento
    const registros = llamadas.filter(l => l[0] === "register").length;
    assert.strictEqual(iniciarBot.revisarSalud(), null);
    assert.strictEqual(llamadas.filter(l => l[0] === "register").length, registros);
});

// ==========================================================================
// D. Tick colgado del worker de eventos
// ==========================================================================

prueba("D1 un tick colgado > 5 min se libera; su final tardío no borra la guarda del nuevo", async () => {

    let colgados = 0;
    let liberarPrimero;
    const workerFalso = {
        workerEventos: () => {
            colgados++;
            if (colgados === 1) return new Promise(r => { liberarPrimero = r; });
            return new Promise(() => {}); // el segundo también queda en curso
        }
    };
    inyectar("bot/funciones/eventos/workers/workerEventos.js", workerFalso);
    inyectar("services/baileys/propiedadSesion.js", { puedeActuar: () => true });
    inyectar("diagnostico/cicloMensaje.js", { tickWorker: () => {} });
    delete require.cache[ruta("bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js")];

    const setIntervalReal = global.setInterval;
    let tick;
    global.setInterval = fn => { tick = fn; return { unref() {} }; };
    const nowReal = Date.now;
    let reloj = nowReal();
    Date.now = () => reloj;

    try {
        const w = require(ruta("bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js"));
        w.iniciarWorkerEventos({ context: { sessionId: "W" } });

        tick();                       // tick 1 queda colgado
        await esperar(1);
        tick();                       // omitido: el anterior sigue en curso
        assert.strictEqual(colgados, 1);

        reloj += 5 * 60 * 1000 + 1;  // pasan más de 5 min
        tick();                       // se libera la guarda: tick 2 arranca
        await esperar(1);
        assert.strictEqual(colgados, 2);

        liberarPrimero();             // el tick 1 termina tarde
        await esperar(1);
        tick();                       // el 2 sigue en curso: debe omitirse
        await esperar(1);
        assert.strictEqual(colgados, 2, "el final tardío no liberó la guarda del tick nuevo");

        w.detenerWorkerEventos("W");
    } finally {
        global.setInterval = setIntervalReal;
        Date.now = nowReal;
    }

});

// ==========================================================================

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        silenciar();
        try { await fn(); restaurarLogs(); ok++; console.log(`✅ ${n}`); }
        catch (e) { restaurarLogs(); falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
