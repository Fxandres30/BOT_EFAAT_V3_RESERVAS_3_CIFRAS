// ==========================================================================
// PRUEBAS — corrección del bucle de reconexión conflict/replaced (440).
//
// Cubre las 4 correcciones aplicadas:
//   1) Lock de creación en vuelo por sessionId (socket.js: createSocket).
//   2) registrarEstados() una sola vez por socket real (manager.js: start).
//   3) Rama explícita para DisconnectReason.connectionReplaced=440
//      (desconectado.js) que NO reconecta automáticamente.
//   4) Guardia de identidad: un evento tardío de un socket reemplazado no
//      puede tocar el socket nuevo de la misma sesión (estados.js).
//
// Todo mockeado (Supabase y @whiskeysockets/baileys) vía require.cache —
// ningún socket real, ninguna llamada de red. Las carreras se reproducen
// con una promesa controlable (el "gate" de useMultiFileAuthState), no con
// sleeps de duración fija. Las transiciones que dependen de setTimeout
// internos (conectado.js: 1s: desconectado.js: 5s, acelerados a 0 durante
// esta prueba) se esperan por CONDICIÓN (esperarHasta / espiar
// evaluarConexion), nunca por un número fijo de "ticks" — un conteo fijo
// resulta frágil en un proceso con varias pruebas secuenciales que dejan
// timers de fondo drenándose.
//
//     node backend/tests/sesiones/socketLockReconexion.test.js
// ==========================================================================

const assert = require("assert");
const { EventEmitter } = require("events");

const {
    crearEntorno,
    flush,
    crearDiferido,
    acelerarTimers,
    restaurarTimers,
    esperarHasta
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

// Espía manager.evaluarConexion (único punto por el que pasa CUALQUIER
// conexión/reconexión antes de decidir failover) para tener una señal
// precisa y determinista de "ya terminó de procesarse la apertura de este
// socket", en vez de adivinar cuántas vueltas de setTimeout/microtareas
// hacen falta. No modifica producción: es una instrumentación de prueba
// sobre la instancia ya creada.
function espiarEvaluarConexion(manager) {

    const completadas = [];
    const original = manager.evaluarConexion.bind(manager);

    manager.evaluarConexion = async (sessionId) => {
        const resultado = await original(sessionId);
        completadas.push(sessionId);
        return resultado;
    };

    return {
        veces: (sessionId) => completadas.filter(id => id === sessionId).length
    };

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

    // Drenar cualquier timer/microtarea de fondo que esta prueba haya
    // dejado pendiente (p. ej. un setTimeout acelerado que aún no corrió)
    // antes de arrancar la siguiente, para no mezclar logs/estado de
    // pruebas distintas en el mismo proceso.
    await flush(60);

}

async function main() {

    acelerarTimers();

    // ---------------------------------------------------------------
    // 1) start() simultáneo 2 veces → 1 socket
    // ---------------------------------------------------------------
    await test("start() simultáneo x2 para el mismo sessionId crea UN solo socket", async () => {

        const id = "sesion-a";
        const { manager, estadoBaileys } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        const diferido = crearDiferido();
        estadoBaileys.gate = diferido.promise;

        const p1 = manager.start(id);
        const p2 = manager.start(id);

        await flush(5);
        diferido.resolve();

        const [s1, s2] = await Promise.all([p1, p2]);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "makeWASocket debe llamarse exactamente 1 vez");
        assert.strictEqual(s1, s2, "ambas llamadas deben devolver la MISMA instancia de socket");
        assert.strictEqual(manager.getAll().length, 1, "solo debe quedar 1 sesión registrada en el Map de sockets");

    });

    // ---------------------------------------------------------------
    // 2) start() simultáneo 10 veces → 1 socket
    // ---------------------------------------------------------------
    await test("start() simultáneo x10 para el mismo sessionId crea UN solo socket", async () => {

        const id = "sesion-b";
        const { manager, estadoBaileys } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        const diferido = crearDiferido();
        estadoBaileys.gate = diferido.promise;

        const llamadas = Array.from({ length: 10 }, () => manager.start(id));

        await flush(5);
        diferido.resolve();

        const resultadosStart = await Promise.all(llamadas);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "makeWASocket debe llamarse exactamente 1 vez con 10 start() concurrentes");
        assert(resultadosStart.every(s => s === resultadosStart[0]), "las 10 llamadas deben devolver la MISMA instancia de socket");
        assert.strictEqual(manager.getAll().length, 1, "solo debe quedar 1 sesión registrada");

    });

    // ---------------------------------------------------------------
    // 3) registrarEstados una sola vez (verificado vía listenerCount)
    // ---------------------------------------------------------------
    await test("registrarEstados() se ejecuta una sola vez por socket real (sin duplicar listeners)", async () => {

        const id = "sesion-c";
        const { manager, estadoBaileys } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        const diferido = crearDiferido();
        estadoBaileys.gate = diferido.promise;

        const llamadas = [manager.start(id), manager.start(id), manager.start(id)];

        await flush(5);
        diferido.resolve();

        await Promise.all(llamadas);

        const sock = manager.get(id);

        // 1 listener interno de socket.js (debug/log) + 1 de estados.js
        // (registrarEstados) = 2. Si registrarEstados se hubiera llamado
        // más de una vez (el bug original), este número sería 3, 4...
        assert.strictEqual(sock.ev.listenerCount("connection.update"), 2, "debe haber exactamente 2 listeners de connection.update (1 interno de socket.js + 1 de registrarEstados), nunca más");

    });

    // ---------------------------------------------------------------
    // 4) socket existente → no registrar listener duplicado
    // ---------------------------------------------------------------
    await test("start() sobre una sesión YA conectada no crea socket ni registra listeners de nuevo", async () => {

        const id = "sesion-d";
        const { manager, estadoBaileys } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        await manager.start(id);

        const sockAntes = manager.get(id);
        const listenersAntes = sockAntes.ev.listenerCount("connection.update");

        // Segunda llamada, secuencial, SIN carrera — la sesión ya existe.
        const resultado2 = await manager.start(id);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "no debe crearse un segundo socket real");
        assert.strictEqual(resultado2, sockAntes, "debe devolver el mismo socket ya existente");
        assert.strictEqual(sockAntes.ev.listenerCount("connection.update"), listenersAntes, "el número de listeners no debe cambiar");

    });

    // ---------------------------------------------------------------
    // 5) Socket A reemplazado por B → A no elimina B / no crea C
    // ---------------------------------------------------------------
    await test("un close tardío del socket viejo (ya reemplazado) no borra el socket nuevo ni crea uno adicional", async () => {

        const id = "sesion-e";
        const { manager, estadoBaileys } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        await manager.start(id);
        const A = manager.get(id);

        // Simular que, por la razón que sea, B ya reemplazó a A como el
        // socket vigente de esta sesión (sin pasar por el close de A).
        const B = { ev: new EventEmitter(), context: { sessionId: id }, user: null };
        manager.sockets.set(id, B);

        // A (viejo, ya no vigente) emite un close tardío.
        emitirClose(A, 428);
        await flush(20);

        assert.strictEqual(manager.sockets.get(id), B, "B debe seguir siendo el socket vigente en el Map — A no debe haberlo borrado ni reemplazado");
        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "el close tardío de A no debe haber disparado la creación de un socket adicional");

    });

    // ---------------------------------------------------------------
    // 6) close tardío de A (incluso con restartRequired) → no inicia otro socket
    // ---------------------------------------------------------------
    await test("close tardío de A con restartRequired (515) tampoco dispara una reconexión sobre el socket nuevo", async () => {

        const id = "sesion-f";
        const { manager, estadoBaileys, DisconnectReason } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        await manager.start(id);
        const A = manager.get(id);

        const B = { ev: new EventEmitter(), context: { sessionId: id }, user: null };
        manager.sockets.set(id, B);

        // restartRequired es el código que en desconectado.js SÍ dispara
        // manager.start() de inmediato — el más peligroso si el guard de
        // identidad no funcionara.
        emitirClose(A, DisconnectReason.restartRequired);
        await flush(20);

        assert.strictEqual(manager.sockets.get(id), B, "B sigue intacto");
        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "restartRequired del socket viejo NO debe crear un socket nuevo (el evento es obsoleto)");

    });

    // ---------------------------------------------------------------
    // 7) 440 → NO reconexión automática infinita
    // ---------------------------------------------------------------
    await test("440 (connectionReplaced) NO dispara reconexión automática, ni siquiera tras dejar pasar tiempo", async () => {

        const id = "sesion-g";
        const { manager, estadoBaileys, DisconnectReason, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });
        const espia = espiarEvaluarConexion(manager);

        await manager.start(id);
        const A = manager.get(id);

        emitirOpen(A);
        await esperarHasta(() => espia.veces(id) >= 1, { mensaje: "evaluarConexion(A) debería haberse ejecutado tras abrir" });

        assert.strictEqual(manager.getActiveSession(), id, "precondición: la sesión quedó activa tras abrir");

        emitirClose(A, DisconnectReason.connectionReplaced);
        await flush(20);

        assert.strictEqual(manager.sockets.has(id), false, "el socket debe eliminarse del Map tras el 440");
        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "NO debe haberse creado un socket nuevo inmediatamente tras el 440");

        // Dejar pasar "tiempo" equivalente a varios ciclos de reintento de
        // 5s de la rama genérica (ya acelerados a 0) — si el bug siguiera
        // presente, aquí se vería una cadena start->440->start->440...
        await flush(60);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "sigue sin reintento automático después de dejar pasar tiempo — el bucle infinito no ocurre");
        assert.strictEqual(fakeSupabase._obtenerSesion(id).estado, "desconectado", "el estado en Supabase debe reflejar la desconexión");

    });

    // ---------------------------------------------------------------
    // 8) error temporal real (no 440) → conserva la política actual
    // ---------------------------------------------------------------
    await test("un error temporal genérico (no 440) conserva la política actual: se reintenta la misma sesión", async () => {

        const id = "sesion-h";
        const { manager, estadoBaileys, DisconnectReason } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        await manager.start(id);
        const A = manager.get(id);

        // connectionClosed (428): no tiene rama especial, cae al catch-all
        // "Errores temporales" -> debe seguir reintentando automáticamente.
        emitirClose(A, DisconnectReason.connectionClosed);

        await esperarHasta(() => estadoBaileys.llamadasMakeWASocket === 2, { mensaje: "un error temporal genérico debería reintentar y crear un socket nuevo" });

        assert.strictEqual(manager.sockets.has(id), true, "la sesión debe quedar reconectada");

    });

    // ---------------------------------------------------------------
    // 9) dos sesiones diferentes → pueden crear sockets independientemente
    // ---------------------------------------------------------------
    await test("dos sessionId distintos se crean de forma independiente, sin bloquearse entre sí", async () => {

        const idA = "sesion-i1";
        const idB = "sesion-i2";
        const { manager, estadoBaileys } = crearEntorno({
            sesionesIniciales: [sesion(idA), sesion(idB)]
        });

        const diferido = crearDiferido();
        estadoBaileys.gate = diferido.promise;

        const p1 = manager.start(idA);
        const p2 = manager.start(idB);

        await flush(5);
        diferido.resolve();

        await Promise.all([p1, p2]);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 2, "deben crearse 2 sockets reales, uno por sessionId");
        assert.strictEqual(manager.has(idA), true);
        assert.strictEqual(manager.has(idB), true);

    });

    // ---------------------------------------------------------------
    // 10) activeChanged sigue funcionando cuando realmente cambia el socket
    // ---------------------------------------------------------------
    await test("activeChanged se emite al conectar y se re-emite cuando la misma sesión reconecta con un socket nuevo", async () => {

        const id = "sesion-j";
        const { manager, DisconnectReason } = crearEntorno({ sesionesIniciales: [sesion(id)] });
        const espia = espiarEvaluarConexion(manager);

        const eventos = [];
        manager.on("activeChanged", (payload) => eventos.push(payload));

        await manager.start(id);
        const A = manager.get(id);

        emitirOpen(A);
        await esperarHasta(() => espia.veces(id) >= 1, { mensaje: "evaluarConexion(A) debería completarse tras abrir" });

        assert.strictEqual(eventos.length, 1, "activeChanged debe emitirse una vez al conectar (única sesión disponible)");
        assert.strictEqual(eventos[0].sessionId, id);
        assert.strictEqual(eventos[0].socket, A);

        // Reemplazo legítimo y secuencial (restartRequired): A muere, se
        // crea B para la MISMA sesión.
        emitirClose(A, DisconnectReason.restartRequired);
        await esperarHasta(() => !!manager.get(id) && manager.get(id) !== A, { mensaje: "debería haberse creado un socket nuevo (B) tras restartRequired" });

        const B = manager.get(id);
        assert.notStrictEqual(B, A, "debe haberse creado una instancia de socket nueva (B) para la misma sesión");

        emitirOpen(B);
        await esperarHasta(() => espia.veces(id) >= 2, { mensaje: "evaluarConexion(B) debería completarse tras abrir" });

        assert.strictEqual(eventos.length, 2, "activeChanged debe volver a emitirse porque el socket cambió, aunque el sessionId sea el mismo");
        assert.strictEqual(eventos[1].sessionId, id);
        assert.strictEqual(eventos[1].socket, B, "el segundo activeChanged debe llevar el socket NUEVO (B)");

    });

    // ---------------------------------------------------------------
    // 11) activeLost sigue funcionando correctamente
    // ---------------------------------------------------------------
    await test("activeLost se emite cuando la única sesión activa se desconecta definitivamente", async () => {

        const id = "sesion-k";
        const { manager } = crearEntorno({ sesionesIniciales: [sesion(id)] });
        const espia = espiarEvaluarConexion(manager);

        let activeLostEmitido = false;
        manager.on("activeLost", () => { activeLostEmitido = true; });

        await manager.start(id);
        const A = manager.get(id);

        emitirOpen(A);
        await esperarHasta(() => espia.veces(id) >= 1, { mensaje: "evaluarConexion(A) debería completarse tras abrir" });

        assert.strictEqual(manager.getActiveSession(), id);

        emitirClose(A, 401); // logout, desconexión definitiva
        await esperarHasta(() => activeLostEmitido, { mensaje: "activeLost debería haberse emitido tras el logout" });

        assert.strictEqual(manager.getActiveSession(), null);

    });

    // ---------------------------------------------------------------
    // 12) failover entre sesiones existentes no se rompe
    // ---------------------------------------------------------------
    await test("el failover automático hacia la sesión preferida sigue funcionando tras la corrección", async () => {

        const idA = "sesion-l1";
        const idB = "sesion-l2";
        const { manager } = crearEntorno({
            sesionesIniciales: [
                sesion(idA, { usuario_id: "user-x" }),
                sesion(idB, { usuario_id: "user-x", principal: true })
            ]
        });
        const espia = espiarEvaluarConexion(manager);

        await manager.start(idA);
        await manager.start(idB);

        const A = manager.get(idA);
        const B = manager.get(idB);

        emitirOpen(A);
        await esperarHasta(() => espia.veces(idA) >= 1, { mensaje: "evaluarConexion(A) debería completarse tras abrir" });

        assert.strictEqual(manager.getActiveSession(), idA, "A se vuelve activa (única conectada por ahora)");

        emitirOpen(B);
        await esperarHasta(() => espia.veces(idB) >= 1, { mensaje: "evaluarConexion(B) debería completarse tras abrir" });

        assert.strictEqual(manager.getActiveSession(), idA, "B conectada no reemplaza a A (A sigue saludable)");

        // Cae A (activa) de forma definitiva -> failover a B (marcada preferida).
        emitirClose(A, 401);
        await esperarHasta(() => manager.getActiveSession() === idB, { mensaje: "debería hacerse failover automático a B (preferida) tras caer A" });

    });

    // ---------------------------------------------------------------
    // SIMULACIÓN DEL BUG ORIGINAL
    // ---------------------------------------------------------------
    await test("BUG REPRODUCIDO Y CORREGIDO: start(A) concurrente + 440 no entra en bucle infinito", async () => {

        const id = "sesion-bug";
        const { manager, estadoBaileys, DisconnectReason, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion(id)] });
        const espia = espiarEvaluarConexion(manager);

        // Paso 1: la carrera que en el código original producía DOS sockets
        // reales con las mismas credenciales (causa de fondo del conflict/
        // replaced contra WhatsApp).
        const diferido = crearDiferido();
        estadoBaileys.gate = diferido.promise;

        const p1 = manager.start(id);
        const p2 = manager.start(id);

        await flush(5);
        diferido.resolve();

        await Promise.all([p1, p2]);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "la carrera original (start(A) x2) ya NO produce un segundo socket real");

        const A = manager.get(id);
        emitirOpen(A);
        await esperarHasta(() => espia.veces(id) >= 1, { mensaje: "evaluarConexion(A) debería completarse tras abrir" });

        // Paso 2: aun así, simular que WhatsApp responde con conflict/
        // replaced (440) sobre el socket vigente (p. ej. un dispositivo
        // externo real, ajeno a este proceso).
        emitirClose(A, DisconnectReason.connectionReplaced);

        // Paso 3: dejar correr varias vueltas de reloj — con el bug
        // original esto habría sido: start -> socket -> 440 -> start ->
        // socket -> 440 -> ... indefinidamente.
        await flush(80);

        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 1, "tras el 440 NO debe haberse creado ningún socket adicional — el bucle NO ocurre");
        assert.strictEqual(manager.sockets.has(id), false, "la sesión queda limpiamente fuera del Map, no reintentando");
        assert.strictEqual(fakeSupabase._obtenerSesion(id).estado, "desconectado");

    });

    // ---------------------------------------------------------------
    // Socket A creado / Socket B creado (reemplazo legítimo) / A cierra
    // tarde -> B permanece intacto.
    // ---------------------------------------------------------------
    await test("Socket A creado, Socket B lo reemplaza, A cierra tarde -> B permanece intacto", async () => {

        const id = "sesion-ab";
        const { manager, estadoBaileys, DisconnectReason } = crearEntorno({ sesionesIniciales: [sesion(id)] });

        await manager.start(id);
        const A = manager.get(id);

        // Reemplazo legítimo y secuencial: A es reemplazado por B mediante
        // el flujo normal de restartRequired.
        emitirClose(A, DisconnectReason.restartRequired);
        await esperarHasta(() => !!manager.get(id) && manager.get(id) !== A, { mensaje: "debería haberse creado B tras restartRequired" });

        const B = manager.get(id);

        assert.notStrictEqual(B, A, "B debe ser una instancia de socket distinta de A");
        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 2, "deben existir exactamente 2 creaciones reales hasta aquí (A y B)");

        // A, ya reemplazado, emite un close tardío (evento fantasma/objeto
        // colgado con listeners viejos).
        emitirClose(A, 428);
        await flush(20);

        assert.strictEqual(manager.get(id), B, "B debe permanecer intacto como el socket vigente");
        assert.strictEqual(estadoBaileys.llamadasMakeWASocket, 2, "el close tardío de A no debe generar un tercer socket (C)");

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
