// ==========================================================================
// PRUEBAS — cola de operaciones IQ de grupo POR SESIÓN (groupQueue.js real).
//
//   - cuentas distintas corren en paralelo; dentro de una cuenta, FIFO y
//     nunca dos operaciones en vuelo a la vez;
//   - el backoff por rate-overlimit de una cuenta no retrasa a las demás;
//   - un error o un socket no vigente en una cuenta no afecta a otra;
//   - cada operación se ejecuta una sola vez (salvo reintentos por
//     rate-overlimit, que son por diseño) y las colas vacías se eliminan.
//
// Sockets falsos; tiempos reducidos solo en este proceso de prueba.
//
//     node backend/tests/sesiones/groupQueuePorSesion.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

process.env.GROUP_QUEUE_DELAY_MS = "5";
process.env.GROUP_QUEUE_BACKOFF_MS = "120";
process.env.GROUP_QUEUE_BACKOFF_MAX_MS = "500";
process.env.GROUP_QUEUE_TIMEOUT_MS = "2000";

const RAIZ = path.resolve(__dirname, "../..");
const groupQueue = require(path.join(RAIZ, "services/baileys/groupQueue.js"));
const propiedadSesion = require(path.join(RAIZ, "services/baileys/propiedadSesion.js"));

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// Socket falso: registra cada ejecución real y permite fijar su duración y
// sus errores de rate-overlimit.
function sockFalso(sessionId, { duracionMs = 20, rateLimits = 0 } = {}) {
    const s = {
        context: { sessionId, usuarioId: `cliente-${sessionId}` },
        ejecuciones: [],
        enVuelo: 0,
        maxEnVuelo: 0,
        rateLimits,
        async groupMetadata(grupoId) {
            s.enVuelo++; s.maxEnVuelo = Math.max(s.maxEnVuelo, s.enVuelo);
            s.ejecuciones.push({ grupoId, t: Date.now() });
            try {
                await esperar(duracionMs);
                if (s.rateLimits > 0) { s.rateLimits--; const e = new Error("rate-overlimit"); e.data = 429; throw e; }
                return { id: grupoId };
            } finally { s.enVuelo--; }
        },
        async groupSettingUpdate(grupoId, ajuste) { s.ejecuciones.push({ grupoId, ajuste, t: Date.now() }); return true; }
    };
    return s;
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("cuentas distintas en paralelo: B no espera a que A termine", async () => {
    const a = sockFalso("A", { duracionMs: 200 });
    const b = sockFalso("B", { duracionMs: 10 });
    const inicio = Date.now();
    const pa = groupQueue.groupMetadata(a, "gA");
    const pb = groupQueue.groupMetadata(b, "gB").then(() => Date.now() - inicio);
    const msB = await pb;
    await pa;
    assert.ok(msB < 150, `B terminó en ${msB} ms (con cola global habría esperado los 200 ms de A)`);
});

prueba("dentro de una cuenta: FIFO y nunca dos operaciones en vuelo", async () => {
    const a = sockFalso("A2", { duracionMs: 15 });
    const grupos = ["g1", "g2", "g3", "g4", "g5"];
    await Promise.all(grupos.map(g => groupQueue.groupMetadata(a, g)));
    assert.deepStrictEqual(a.ejecuciones.map(e => e.grupoId), grupos);
    assert.strictEqual(a.maxEnVuelo, 1);
});

prueba("el backoff por rate-overlimit de A no retrasa a B; A reintenta y termina", async () => {
    const a = sockFalso("A3", { duracionMs: 5, rateLimits: 2 });   // 120 + 240 ms de backoff
    const b = sockFalso("B3", { duracionMs: 5 });
    const inicio = Date.now();
    const log = console.log; console.log = () => {};
    let msB;
    try {
        const pa = groupQueue.groupMetadata(a, "gA");
        msB = await Promise.all([1, 2, 3].map(i => groupQueue.groupMetadata(b, `gB${i}`))).then(() => Date.now() - inicio);
        const ra = await pa;
        assert.deepStrictEqual(ra, { id: "gA" });
    } finally { console.log = log; }
    assert.ok(msB < 200, `B terminó en ${msB} ms mientras A esperaba su backoff`);
    assert.strictEqual(a.ejecuciones.length, 3, "1 intento + 2 reintentos por rate-overlimit");
    assert.strictEqual(b.ejecuciones.length, 3, "cada operación de B una sola vez");
});

prueba("un error en una cuenta se propaga solo a su llamador; la otra sigue", async () => {
    const a = { context: { sessionId: "A4" }, async groupMetadata() { throw new Error("fallo real de A"); } };
    const b = sockFalso("B4");
    const [ra, rb] = await Promise.allSettled([groupQueue.groupMetadata(a, "gA"), groupQueue.groupMetadata(b, "gB")]);
    assert.strictEqual(ra.status, "rejected");
    assert.match(ra.reason.message, /fallo real de A/);
    assert.deepStrictEqual(rb.value, { id: "gB" });
});

prueba("socket no vigente: la acción de A se rechaza (SOCKET_NO_VIGENTE) y la de B se ejecuta", async () => {
    const a = sockFalso("A5");
    const b = sockFalso("B5");
    propiedadSesion.configurar(s => s !== a);
    try {
        const [ra, rb] = await Promise.allSettled([
            groupQueue.groupSettingUpdate(a, "gA", "announcement"),
            groupQueue.groupSettingUpdate(b, "gB", "announcement")
        ]);
        assert.strictEqual(ra.status, "rejected");
        assert.strictEqual(ra.reason.code, "SOCKET_NO_VIGENTE");
        assert.strictEqual(a.ejecuciones.length, 0);
        assert.strictEqual(rb.status, "fulfilled");
    } finally { propiedadSesion.configurar(null); }
});

prueba("limpieza: sin operaciones pendientes no queda ninguna cola (ni de sesiones que ya no existen)", async () => {
    const socks = Array.from({ length: 20 }, (_, i) => sockFalso(`L${i}`, { duracionMs: 2 }));
    await Promise.all(socks.flatMap(s => [groupQueue.groupMetadata(s, "g1"), groupQueue.groupMetadata(s, "g2")]));
    await esperar(20);
    const estado = groupQueue._estado();
    assert.deepStrictEqual(estado.porSesion, {});
    assert.strictEqual(estado.enCola, 0);
    assert.strictEqual(estado.procesando, false);
    assert.ok(socks.every(s => s.ejecuciones.length === 2), "cada operación exactamente una vez");
});

prueba("100 cuentas a la vez: todas avanzan en paralelo, cada una en su orden", async () => {
    const socks = Array.from({ length: 100 }, (_, i) => sockFalso(`C${i}`, { duracionMs: 20 }));
    const inicio = Date.now();
    await Promise.all(socks.flatMap(s => ["x", "y", "z"].map(g => groupQueue.groupMetadata(s, g))));
    const ms = Date.now() - inicio;
    assert.ok(ms < 1500, `${ms} ms (con cola global serían ~${100 * 3 * 25} ms)`);
    assert.ok(socks.every(s => s.ejecuciones.map(e => e.grupoId).join() === "x,y,z" && s.maxEnVuelo === 1));
    assert.deepStrictEqual(groupQueue._estado().porSesion, {});
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
