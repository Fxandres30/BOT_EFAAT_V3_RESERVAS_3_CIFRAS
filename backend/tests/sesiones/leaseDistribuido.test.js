// ==========================================================================
// PRUEBAS — lease distribuido LOCAL <-> VPS para una misma sesión de
// WhatsApp (supabase_migrations/004_lease_sesiones.sql +
// services/baileys/lease.js + integración en manager.js/desconectado.js).
//
// Las pruebas 1-10 y 13 ejercitan la semántica ATÓMICA del lease
// directamente (acquire/heartbeat/release), usando el mismo contrato que
// la migración SQL real (réplica fiel en fakeSupabaseSesiones.js — no hay
// Postgres real disponible en este entorno de pruebas; ver el reporte
// final para el detalle de esta limitación).
//
// Las pruebas 11, 12, 14 y 15 ejercitan la INTEGRACIÓN con manager.js:
// que start() nunca llegue a makeWASocket() sin ownership, que perder el
// lease detenga el socket/BOT local, que el failover entre sesiones
// DISTINTAS siga intacto, y que el lock intra-proceso conviva con el
// lease sin romperse.
//
// TTL/heartbeat se prueban con un reloj virtual controlable
// (fakeSupabase._lease.avanzar(ms)) — nunca con sleeps reales de
// duración fija. La única prueba que sí depende de un intervalo real
// (heartbeat automático de manager.start()) usa un heartbeat de
// milisegundos (LEASE_HEARTBEAT_SEGUNDOS muy pequeño), no de duración
// fija arbitraria, y se espera por CONDICIÓN (esperarHasta), no por
// tiempo fijo.
//
//     node backend/tests/sesiones/leaseDistribuido.test.js
// ==========================================================================

const assert = require("assert");

const {
    crearEntorno,
    flush,
    crearDiferido,
    acelerarTimers,
    restaurarTimers,
    esperarHasta,
    esperarHastaReal
} = require("./entornoFake");

function sesion(id, overrides = {}) {
    return {
        id,
        usuario_id: overrides.usuario_id || "usuario-1",
        nombre: overrides.nombre || `Sesion ${id}`,
        estado: overrides.estado || "conectado",
        activa: overrides.activa || false,
        principal: overrides.principal || false,
        telefono: overrides.telefono || "000",
        ...overrides
    };
}

function emitirClose(sock, statusCode) {
    sock.ev.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { output: { statusCode } } }
    });
}

function emitirOpen(sock) {
    sock.ev.emit("connection.update", { connection: "open" });
}

const resultados = [];

async function test(nombre, fn) {

    try {

        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);

    } catch (err) {

        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);

    }

    await flush(60);

}

async function main() {

    acelerarTimers();

    // ---------------------------------------------------------------
    // 1) LOCAL adquiere lease → éxito
    // ---------------------------------------------------------------
    await test("1. LOCAL adquiere el lease de una sesión libre → éxito", async () => {

        const { lease } = crearEntorno({});
        const id = "sesion-lease-1";

        const r = await lease.acquire(id, "LOCAL-a", 20);

        assert.strictEqual(r.adquirido, true, "LOCAL debe adquirir un lease que no existía");
        assert.strictEqual(r.ownerId, "LOCAL-a");

    });

    // ---------------------------------------------------------------
    // 2) VPS intenta el mismo sessionId → rechazado
    // ---------------------------------------------------------------
    await test("2. VPS intenta adquirir un sessionId ya tomado por LOCAL → rechazado", async () => {

        const { lease } = crearEntorno({});
        const id = "sesion-lease-2";

        await lease.acquire(id, "LOCAL-a", 20);
        const r = await lease.acquire(id, "VPS-b", 20);

        assert.strictEqual(r.adquirido, false, "VPS no debe poder adquirir un lease vigente de otro owner");
        assert.strictEqual(r.ownerId, "LOCAL-a", "debe informar quién es el dueño actual");

    });

    // ---------------------------------------------------------------
    // 3) LOCAL heartbeat → éxito
    // ---------------------------------------------------------------
    await test("3. LOCAL puede hacer heartbeat de su propio lease → éxito", async () => {

        const { lease } = crearEntorno({});
        const id = "sesion-lease-3";

        await lease.acquire(id, "LOCAL-a", 20);
        const r = await lease.heartbeat(id, "LOCAL-a", 20);

        assert.strictEqual(r.renovado, true, "el heartbeat del dueño actual debe renovar el lease");

    });

    // ---------------------------------------------------------------
    // 4) VPS no puede robar un lease vigente
    // ---------------------------------------------------------------
    await test("4. VPS no puede robar un lease vigente aunque lo intente repetidamente", async () => {

        const { lease, fakeSupabase } = crearEntorno({});
        const id = "sesion-lease-4";

        await lease.acquire(id, "LOCAL-a", 20);

        for (let i = 0; i < 5; i++) {
            const r = await lease.acquire(id, "VPS-b", 20);
            assert.strictEqual(r.adquirido, false, `intento ${i + 1} de VPS debe seguir siendo rechazado`);
        }

        assert.strictEqual(fakeSupabase._lease.obtener(id).owner_id, "LOCAL-a", "LOCAL debe seguir siendo el dueño");

    });

    // ---------------------------------------------------------------
    // 5) LOCAL libera → VPS puede adquirir
    // ---------------------------------------------------------------
    await test("5. LOCAL libera el lease → VPS puede adquirirlo de inmediato", async () => {

        const { lease } = crearEntorno({});
        const id = "sesion-lease-5";

        await lease.acquire(id, "LOCAL-a", 20);

        const liberacion = await lease.release(id, "LOCAL-a");
        assert.strictEqual(liberacion.liberado, true);

        const r = await lease.acquire(id, "VPS-b", 20);
        assert.strictEqual(r.adquirido, true, "VPS debe poder adquirir el lease ya liberado");
        assert.strictEqual(r.ownerId, "VPS-b");

    });

    // ---------------------------------------------------------------
    // 6) LOCAL lease expira (TTL) → VPS puede adquirir
    // ---------------------------------------------------------------
    await test("6. tras expirar el TTL de LOCAL (sin liberar explícitamente), VPS puede adquirir", async () => {

        const { lease, fakeSupabase } = crearEntorno({});
        const id = "sesion-lease-6";

        await lease.acquire(id, "LOCAL-a", 20); // TTL de 20s

        // Reloj virtual: avanzar 21s SIN que LOCAL libere ni haga heartbeat
        // (simula que el proceso LOCAL murió sin oportunidad de liberar).
        fakeSupabase._lease.avanzar(21_000);

        const rVps = await lease.acquire(id, "VPS-b", 20);
        assert.strictEqual(rVps.adquirido, true, "VPS debe poder adquirir un lease cuyo TTL ya venció");
        assert.strictEqual(rVps.ownerId, "VPS-b");

    });

    // ---------------------------------------------------------------
    // 7) Dos adquisiciones simultáneas → exactamente una gana
    // ---------------------------------------------------------------
    await test("7. dos adquisiciones simultáneas para el mismo sessionId → exactamente una gana", async () => {

        const { lease } = crearEntorno({});
        const id = "sesion-lease-7";

        const [rLocal, rVps] = await Promise.all([
            lease.acquire(id, "LOCAL-a", 20),
            lease.acquire(id, "VPS-b", 20)
        ]);

        const ganadores = [rLocal, rVps].filter(r => r.adquirido);

        assert.strictEqual(ganadores.length, 1, "debe ganar EXACTAMENTE una de las dos adquisiciones simultáneas");

        const perdedor = rLocal.adquirido ? rVps : rLocal;
        assert.strictEqual(perdedor.adquirido, false, "la otra debe quedar rechazada");
        assert.strictEqual(perdedor.ownerId, ganadores[0].ownerId, "la rechazada debe ver al ganador como dueño actual");

    });

    // ---------------------------------------------------------------
    // 8) Mismo owner puede renovar (acquire, no solo heartbeat)
    // ---------------------------------------------------------------
    await test("8. el mismo owner puede volver a adquirir (renovar) su propio lease vía acquire()", async () => {

        const { lease, fakeSupabase } = crearEntorno({});
        const id = "sesion-lease-8";

        await lease.acquire(id, "LOCAL-a", 20);
        const antes = fakeSupabase._lease.obtener(id).lease_until.getTime();

        fakeSupabase._lease.avanzar(5000);

        const r = await lease.acquire(id, "LOCAL-a", 20);
        const despues = fakeSupabase._lease.obtener(id).lease_until.getTime();

        assert.strictEqual(r.adquirido, true, "el mismo owner debe poder renovar vía acquire()");
        assert(despues > antes, "lease_until debe haberse extendido tras la renovación");

    });

    // ---------------------------------------------------------------
    // 9) Owner incorrecto no puede liberar
    // ---------------------------------------------------------------
    await test("9. un owner que no es el dueño actual no puede liberar el lease", async () => {

        const { lease, fakeSupabase } = crearEntorno({});
        const id = "sesion-lease-9";

        await lease.acquire(id, "LOCAL-a", 20);

        const r = await lease.release(id, "VPS-b");

        assert.strictEqual(r.liberado, false, "VPS no debe poder liberar el lease de LOCAL");
        assert.strictEqual(fakeSupabase._lease.obtener(id).owner_id, "LOCAL-a", "el lease de LOCAL debe seguir intacto");

    });

    // ---------------------------------------------------------------
    // 10) Owner incorrecto no puede renovar
    // ---------------------------------------------------------------
    await test("10. un owner que no es el dueño actual no puede renovar (heartbeat) el lease", async () => {

        const { lease, fakeSupabase } = crearEntorno({});
        const id = "sesion-lease-10";

        await lease.acquire(id, "LOCAL-a", 20);
        const antes = fakeSupabase._lease.obtener(id).lease_until.getTime();

        const r = await lease.heartbeat(id, "VPS-b", 20);

        assert.strictEqual(r.renovado, false, "VPS no debe poder renovar el lease de LOCAL");
        assert.strictEqual(fakeSupabase._lease.obtener(id).lease_until.getTime(), antes, "lease_until de LOCAL no debe cambiar");

    });

    // ---------------------------------------------------------------
    // 11) Si lease falla → makeWASocket NO se ejecuta
    // ---------------------------------------------------------------
    await test("11. si el lease ya pertenece a otra instancia, manager.start() NUNCA llama a makeWASocket()", async () => {

        const id = "sesion-lease-11";
        const { manager, estadoBaileys, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        // Simula que la VPS ya es dueña de esta sesión.
        fakeSupabase._lease.sembrar(id, { ownerId: "VPS-otra-instancia", ttlSegundosRestantes: 60 });

        const resultado = await manager.start(id);

        assert.strictEqual(resultado, manager.LEASE_NO_DISPONIBLE, "start() debe devolver el sentinel LEASE_NO_DISPONIBLE");
        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 0, "makeWASocket NUNCA debe llamarse sin ownership del lease");
        assert.strictEqual(manager.has(id), false, "no debe quedar ningún socket registrado localmente");

    });

    // ---------------------------------------------------------------
    // 12) Si lease se pierde → socket/BOT de esa sesión se detiene
    // ---------------------------------------------------------------
    await test("12. si el heartbeat detecta pérdida de ownership, el socket local se cierra y el BOT deja de escucharlo", async () => {

        // Heartbeat real muy corto (milisegundos) SOLO para esta prueba —
        // no es un sleep de duración fija: se espera la condición
        // resultante (esperarHasta), el intervalo simplemente necesita
        // disparar al menos una vez en un tiempo razonable.
        const HEARTBEAT_ANTERIOR = process.env.LEASE_HEARTBEAT_SEGUNDOS;
        process.env.LEASE_HEARTBEAT_SEGUNDOS = "0.03"; // 30ms

        try {

            const id = "sesion-lease-12";
            const { manager, lease, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });

            let activeLostEmitido = false;
            manager.on("activeLost", () => { activeLostEmitido = true; });

            await manager.start(id);
            const A = manager.get(id);
            assert(A, "precondición: el socket debe haberse creado (ownership propio)");

            emitirOpen(A);
            await esperarHasta(() => manager.getActiveSession() === id, { mensaje: "precondición: la sesión debería quedar activa tras abrir" });

            // Simular que, en algún momento, otro owner tomó el lease (p.
            // ej. este proceso no llegó a hacer heartbeat a tiempo en un
            // escenario real y la VPS lo adquirió tras expirar el TTL).
            const filaLease = fakeSupabase._lease.obtener(id);
            filaLease.owner_id = "VPS-que-robo-el-lease";

            // El próximo heartbeat automático (cada 30ms, un setInterval
            // REAL que acelerarTimers() no toca) debe detectarlo.
            await esperarHastaReal(() => manager.has(id) === false, {
                maxEsperaMs: 2000,
                pasoMs: 5,
                mensaje: "el socket debería haberse eliminado del Map tras perder el ownership del lease"
            });

            assert.strictEqual(activeLostEmitido, true, "al perder la única sesión conectada, debe emitirse activeLost");
            assert.strictEqual(manager.getActiveSession(), null);

            lease.detenerHeartbeat(id);

        } finally {

            if (HEARTBEAT_ANTERIOR === undefined) delete process.env.LEASE_HEARTBEAT_SEGUNDOS;
            else process.env.LEASE_HEARTBEAT_SEGUNDOS = HEARTBEAT_ANTERIOR;

        }

    });

    // ---------------------------------------------------------------
    // 13) Dos sesiones diferentes pueden tener owners independientes
    // ---------------------------------------------------------------
    await test("13. dos sessionId distintos tienen leases completamente independientes", async () => {

        const { lease } = crearEntorno({});
        const idA = "sesion-lease-13a";
        const idB = "sesion-lease-13b";

        const rA = await lease.acquire(idA, "LOCAL-a", 20);
        const rB = await lease.acquire(idB, "VPS-b", 20);

        assert.strictEqual(rA.adquirido, true);
        assert.strictEqual(rB.adquirido, true, "un owner distinto debe poder adquirir una sesión DIFERENTE sin ningún conflicto");

        // Y que uno no pueda tocar el lease del otro.
        const intentoCruzado = await lease.release(idA, "VPS-b");
        assert.strictEqual(intentoCruzado.liberado, false, "VPS no debe poder liberar el lease de la sesión A (es de LOCAL)");

    });

    // ---------------------------------------------------------------
    // 14) Failover existente entre sesiones distintas sigue funcionando
    // ---------------------------------------------------------------
    await test("14. el failover automático entre sesiones DISTINTAS sigue intacto con el lease habilitado", async () => {

        const idA = "sesion-lease-14a";
        const idB = "sesion-lease-14b";
        const { manager } = crearEntorno({
            sesionesIniciales: [
                sesion(idA, { usuario_id: "user-y" }),
                sesion(idB, { usuario_id: "user-y", principal: true })
            ]
        });

        await manager.start(idA);
        await manager.start(idB);

        const A = manager.get(idA);
        assert(A, "A debe haber adquirido su propio lease y creado su socket");
        assert(manager.get(idB), "B debe haber adquirido su propio lease y creado su socket");

        emitirOpen(A);
        await esperarHasta(() => manager.getActiveSession() === idA, { mensaje: "A debería quedar activa" });

        emitirClose(A, 401); // desconexión definitiva de A
        await esperarHasta(() => manager.getActiveSession() === idB, { mensaje: "debería hacerse failover automático a B (preferida)" });

    });

    // ---------------------------------------------------------------
    // 15) Lock intra-proceso existente sigue funcionando (con el lease de por medio)
    // ---------------------------------------------------------------
    await test("15. el lock intra-proceso (1 sessionId = 1 socket) sigue funcionando con el lease de por medio", async () => {

        const id = "sesion-lease-15";
        const { manager, estadoBaileys } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        const diferido = crearDiferido();
        estadoBaileys.gate = diferido.promise;

        const llamadas = Array.from({ length: 10 }, () => manager.start(id));

        await flush(5);
        diferido.resolve();

        const resultadosStart = await Promise.all(llamadas);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "10 start() concurrentes con lease habilitado deben seguir creando UN solo socket real");
        assert(resultadosStart.every(s => s === resultadosStart[0]), "las 10 llamadas deben devolver la misma instancia de socket");

    });

    restaurarTimers();

    console.log("\n============================");
    const pasaron = resultados.filter(r => r.ok).length;
    const fallaron = resultados.filter(r => !r.ok).length;
    console.log(`TOTAL: ${resultados.length}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
    console.log("============================");

    if (fallaron) {
        console.log("Fallos:", resultados.filter(r => !r.ok).map(r => r.nombre));
    }

    process.exit(fallaron ? 1 : 0);

}

main().catch(err => {
    restaurarTimers();
    console.error("💥 ERROR INESPERADO:", err);
    process.exit(1);
});
