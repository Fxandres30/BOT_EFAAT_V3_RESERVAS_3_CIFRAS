// ==========================================================================
// PRUEBAS — restauración tras reinicio (PM2) y apagado ordenado.
//
// Causa real reproducida: el proceso anterior moría sin soltar su lease; el
// nuevo arrancaba, veía el lease "ocupado", no creaba el socket y NUNCA
// reintentaba: el bot quedaba sordo hasta reconectar a mano.
//
//   E. manager.start() con LEASE_NO_DISPONIBLE:
//      - lease de un proceso anterior de ESTA máquina: reintento al vencer,
//        sin socket duplicado;
//      - lease de OTRA máquina (LOCAL <-> VPS) vigente: nunca se toma solo;
//      - sesión desconectada a propósito en la base: el reintento no la
//        levanta; stop() cancela el reintento; no se programan dos.
//   F. apagadoOrdenado: suelta los leases propios, nunca hace logout y saca
//      el socket del Map antes de cerrarlo (estados.js ignora ese close y
//      no escribe "desconectado").
//
//     node backend/tests/sesiones/reintentoLeaseApagado.test.js
// ==========================================================================

const assert = require("assert");

const { crearEntorno, flush } = require("./entornoFake");

function sesion(id, overrides = {}) {
    return { id, usuario_id: "usuario-1", nombre: `Sesion ${id}`, estado: "conectado", activa: false, principal: false, telefono: "000", ...overrides };
}

// Dispara YA el reintento programado (sin esperar el temporizador real).
async function dispararReintento(manager, id) {
    const t = manager._reintentosLease?.get(id);
    assert.ok(t, "debía haber un reintento programado");
    const callback = t._onTimeout;
    clearTimeout(t);
    await callback();
    await flush(30);
}

const logOriginal = { log: console.log, warn: console.warn, error: console.error };
const silenciar = () => { console.log = console.warn = console.error = () => {}; };
const restaurar = () => Object.assign(console, logOriginal);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("E1 reinicio de PM2: lease del proceso anterior (misma máquina) -> se reintenta al vencer y conecta UNA vez", async () => {
    const id = "S-E1";
    const { manager, lease, estadoBaileys, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });
    const procesoAnterior = lease.OWNER_ID.split(":").slice(0, 2).join(":") + ":11111:proceso-anterior";
    fakeSupabase._lease.sembrar(id, { ownerId: procesoAnterior, ttlSegundosRestantes: 15 });

    assert.strictEqual(await manager.start(id), manager.LEASE_NO_DISPONIBLE);
    assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 0);
    assert.ok(manager._reintentosLease.has(id), "queda programado el reintento");

    fakeSupabase._lease.avanzar(16_000); // vence el lease del proceso muerto
    await dispararReintento(manager, id);

    assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "un único socket nuevo");
    assert.ok(manager.has(id));
    assert.strictEqual(fakeSupabase._lease.obtener(id).owner_id, lease.OWNER_ID);
    await manager.stop(id).catch(() => {});
});

prueba("E2 lease de OTRA máquina vigente: no se programa reintento (nunca se roba la sesión)", async () => {
    const id = "S-E2";
    const { manager, estadoBaileys, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });
    fakeSupabase._lease.sembrar(id, { ownerId: "VPS:servidor:222:otra", ttlSegundosRestantes: 60 });
    assert.strictEqual(await manager.start(id), manager.LEASE_NO_DISPONIBLE);
    assert.ok(!manager._reintentosLease?.has(id));
    assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 0);
});

prueba("E3 sesión desconectada a propósito: el reintento no la levanta", async () => {
    const id = "S-E3";
    const { manager, lease, estadoBaileys, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });
    const anterior = lease.OWNER_ID.split(":").slice(0, 2).join(":") + ":1:x";
    fakeSupabase._lease.sembrar(id, { ownerId: anterior, ttlSegundosRestantes: 5 });
    await manager.start(id);
    // Mientras tanto, el usuario la desconectó desde el panel.
    await fakeSupabase.client.from("sesiones").update({ estado: "desconectado" }).eq("id", id);
    fakeSupabase._lease.avanzar(6000);
    await dispararReintento(manager, id);
    assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 0);
    assert.ok(!manager.has(id));
});

prueba("E4 stop() cancela un reintento pendiente; dos start() no programan dos reintentos", async () => {
    const id = "S-E4";
    const { manager, lease, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });
    const anterior = lease.OWNER_ID.split(":").slice(0, 2).join(":") + ":1:x";
    fakeSupabase._lease.sembrar(id, { ownerId: anterior, ttlSegundosRestantes: 30 });
    await manager.start(id);
    const primero = manager._reintentosLease.get(id);
    await manager.start(id);
    assert.strictEqual(manager._reintentosLease.get(id), primero, "un solo temporizador");
    await manager.stop(id).catch(() => {});
    assert.ok(!manager._reintentosLease.has(id), "stop() lo cancela");
});

prueba("E5 era la sesión ACTIVA: el reintento vuelve a pedir su activación y se activa al llegar a open", async () => {
    const id = "S-E5";
    const { manager, lease, estadoBaileys, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id, { activa: true, principal: true })] });
    const anterior = lease.OWNER_ID.split(":").slice(0, 2).join(":") + ":1:x";
    fakeSupabase._lease.sembrar(id, { ownerId: anterior, ttlSegundosRestantes: 5 });
    let pedidas = 0;
    const original = manager.solicitarActivacion.bind(manager);
    manager.solicitarActivacion = async (...a) => { pedidas++; return original(...a); };
    await manager.start(id);
    fakeSupabase._lease.avanzar(6000);
    await dispararReintento(manager, id);
    assert.strictEqual(pedidas, 1);
    assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1);
    const sock = estadoBaileys.socketsCreados[0];
    sock.user = { id: "573000000000:1@s.whatsapp.net" };
    sock.ev.emit("connection.update", { connection: "open" });
    await flush(80);
    await new Promise(r => setTimeout(r, 1200)); // conectado.js activa 1 s después de open
    await flush(40);
    assert.strictEqual(manager.getActiveSession(), id);
    await manager.stop(id).catch(() => {});
});

prueba("F1 apagado ordenado: suelta los leases propios, saca el socket del Map y NO hace logout", async () => {
    const { instalarApagadoOrdenado } = require("../../services/baileys/apagadoOrdenado");
    const sockets = new Map();
    let logouts = 0, cerrados = 0, enMapAlCerrar = null;
    const sock = { end: () => { cerrados++; enMapAlCerrar = sockets.has("A"); }, logout: () => { logouts++; } };
    sockets.set("A", sock);
    const soltados = [];
    const manager = { sockets, get: id => sockets.get(id) };
    const leaseFalso = { sesionesConLeasePropio: () => ["A"], soltar: async id => { soltados.push(id); } };
    let salida = null;
    const antes = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    const { apagar } = instalarApagadoOrdenado({ manager, lease: leaseFalso, salir: c => { salida = c; } });
    await apagar("SIGINT");
    await apagar("SIGTERM"); // una segunda señal no repite nada
    assert.deepStrictEqual(soltados, ["A"]);
    assert.strictEqual(cerrados, 1);
    assert.strictEqual(enMapAlCerrar, false, "se saca del Map ANTES de cerrarlo");
    assert.strictEqual(logouts, 0, "nunca cierra sesión de WhatsApp");
    assert.strictEqual(salida, 0);
    process.removeAllListeners("SIGINT"); process.removeAllListeners("SIGTERM");
    assert.ok(antes.int >= 0);
});

prueba("F2 si Supabase no responde al soltar, el proceso igual termina", async () => {
    const { instalarApagadoOrdenado } = require("../../services/baileys/apagadoOrdenado");
    const manager = { sockets: new Map(), get: () => null };
    const leaseFalso = { sesionesConLeasePropio: () => ["B"], soltar: async () => { throw new Error("fetch failed"); } };
    let salida = null;
    const { apagar } = instalarApagadoOrdenado({ manager, lease: leaseFalso, salir: c => { salida = c; } });
    await apagar("SIGTERM");
    assert.strictEqual(salida, 0);
    process.removeAllListeners("SIGINT"); process.removeAllListeners("SIGTERM");
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        silenciar();
        try { await fn(); restaurar(); ok++; console.log(`✅ ${n}`); }
        catch (e) { restaurar(); falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
        await flush(20);
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
