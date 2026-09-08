// ==========================================================================
// PRUEBAS — executionGuard.js (backend/automation/executionGuard.js).
//
// Supabase 100% fake (fakeSupabaseAutomation.js vía entornoFake.js) —
// ningún socket real, ninguna llamada de red.
//
//     node backend/tests/automation/executionGuard.test.js
// ==========================================================================

const assert = require("assert");
const { crearEntorno } = require("./entornoFake");

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

}

function base(overrides = {}) {
    return {
        claveIdempotencia: "sesion-1:OPEN_MESSAGE",
        eventSessionId: "sesion-1",
        grupoId: "573000000000-1111@g.us",
        usuarioId: "usuario-1",
        tipoAccion: "OPEN_MESSAGE",
        ...overrides
    };
}

async function main() {

    // ---------------------------------------------------------------
    // 4) primera ejecución -> ejecuta
    // ---------------------------------------------------------------
    await test("4) primera ejecución de una clave nueva ejecuta el callback", async () => {

        const { executionGuard } = crearEntorno();

        let llamadas = 0;

        const r = await executionGuard.ejecutarUnaVez({
            ...base(),
            ejecutar: async () => { llamadas++; return "ok"; }
        });

        assert.strictEqual(llamadas, 1);
        assert.strictEqual(r.ejecutada, true);
        assert.strictEqual(r.resultado, "ok");
        assert.strictEqual(r.accion.estado, executionGuard.ESTADOS.OK);

    });

    // ---------------------------------------------------------------
    // 5) segunda ejecución (misma clave, ya en 'ok') -> no ejecuta
    // ---------------------------------------------------------------
    await test("5) segunda ejecución con la misma clave (ya 'ok') no vuelve a ejecutar", async () => {

        const { executionGuard } = crearEntorno();

        let llamadas = 0;
        const args = { ...base(), ejecutar: async () => { llamadas++; return "ok"; } };

        await executionGuard.ejecutarUnaVez(args);
        const segunda = await executionGuard.ejecutarUnaVez(args);

        assert.strictEqual(llamadas, 1, "el callback no debe volver a correr");
        assert.strictEqual(segunda.ejecutada, false);
        assert.strictEqual(segunda.motivo, "ya_ok");

    });

    // ---------------------------------------------------------------
    // 6) dos ejecuciones concurrentes -> solo una ejecuta
    // ---------------------------------------------------------------
    await test("6) dos llamadas concurrentes con la misma clave: solo una ejecuta el callback", async () => {

        const { executionGuard } = crearEntorno();

        let llamadas = 0;

        const ejecutar = async () => {
            llamadas++;
            return "ok";
        };

        const [r1, r2] = await Promise.all([
            executionGuard.ejecutarUnaVez({ ...base(), ejecutar }),
            executionGuard.ejecutarUnaVez({ ...base(), ejecutar })
        ]);

        assert.strictEqual(llamadas, 1, "el callback debe correr exactamente una vez entre las dos llamadas concurrentes");

        const ejecutadas = [r1, r2].filter(r => r.ejecutada).length;
        const noEjecutadas = [r1, r2].filter(r => !r.ejecutada).length;

        assert.strictEqual(ejecutadas, 1);
        assert.strictEqual(noEjecutadas, 1);

    });

    // ---------------------------------------------------------------
    // 7) acción OK -> estado ok
    // ---------------------------------------------------------------
    await test("7) callback exitoso deja la acción en estado 'ok' con el resultado guardado", async () => {

        const { executionGuard, fakeSupabase } = crearEntorno();

        await executionGuard.ejecutarUnaVez({
            ...base(),
            ejecutar: async () => ({ enviado: true })
        });

        const filas = fakeSupabase._filas("automation_actions");

        assert.strictEqual(filas.length, 1);
        assert.strictEqual(filas[0].estado, executionGuard.ESTADOS.OK);
        assert.ok(filas[0].finalizado_en, "debe registrar cuándo terminó");
        assert.deepStrictEqual(filas[0].detalle.resultado, { enviado: true });

    });

    // ---------------------------------------------------------------
    // 8) callback falla -> estado error
    // ---------------------------------------------------------------
    await test("8) callback que lanza excepción deja la acción en estado 'error', no revienta el guard", async () => {

        const { executionGuard, fakeSupabase } = crearEntorno();

        const r = await executionGuard.ejecutarUnaVez({
            ...base(),
            ejecutar: async () => { throw new Error("WhatsApp rechazó el envío"); }
        });

        assert.strictEqual(r.ejecutada, false);
        assert.strictEqual(r.motivo, "fallo_ejecucion");
        assert.strictEqual(r.error.message, "WhatsApp rechazó el envío");

        const filas = fakeSupabase._filas("automation_actions");

        assert.strictEqual(filas[0].estado, executionGuard.ESTADOS.ERROR);
        assert.strictEqual(filas[0].detalle.mensaje, "WhatsApp rechazó el envío");

    });

    // ---------------------------------------------------------------
    // 9) acción en_progreso (crash simulado) -> no ejecutar segunda vez
    // ---------------------------------------------------------------
    await test("9) una acción que quedó 'en_progreso' (crash entre INSERT y ejecución) no se vuelve a ejecutar", async () => {

        const { executionGuard, fakeSupabase } = crearEntorno();

        // Simula exactamente el escenario de PHASE_2A_FINDINGS §10: el
        // INSERT llegó a persistirse, pero el proceso murió antes de
        // ejecutar el callback real (nunca se llamó a ejecutarUnaVez con
        // esta clave dentro de este proceso — la fila ya está ahí desde
        // "antes").
        fakeSupabase._agregar("automation_actions", {
            event_session_id: "sesion-1",
            grupo_id: "573000000000-1111@g.us",
            usuario_id: "usuario-1",
            tipo_accion: "OPEN_MESSAGE",
            clave_idempotencia: "sesion-1:OPEN_MESSAGE",
            estado: "en_progreso",
            ejecutado_en: new Date().toISOString(),
            detalle: {}
        });

        let llamadas = 0;

        const r = await executionGuard.ejecutarUnaVez({
            ...base(),
            ejecutar: async () => { llamadas++; return "ok"; }
        });

        assert.strictEqual(llamadas, 0, "NO debe ejecutar mientras exista una fila en_progreso con la misma clave");
        assert.strictEqual(r.ejecutada, false);
        assert.strictEqual(r.motivo, "ya_en_progreso");

    });

    // ---------------------------------------------------------------
    // 10) acción error -> no reintenta automáticamente
    // ---------------------------------------------------------------
    await test("10) una acción que ya quedó en 'error' no se reintenta automáticamente", async () => {

        const { executionGuard, fakeSupabase } = crearEntorno();

        fakeSupabase._agregar("automation_actions", {
            event_session_id: "sesion-1",
            grupo_id: "573000000000-1111@g.us",
            usuario_id: "usuario-1",
            tipo_accion: "OPEN_MESSAGE",
            clave_idempotencia: "sesion-1:OPEN_MESSAGE",
            estado: "error",
            ejecutado_en: new Date().toISOString(),
            finalizado_en: new Date().toISOString(),
            detalle: { mensaje: "fallo anterior" }
        });

        let llamadas = 0;

        const r = await executionGuard.ejecutarUnaVez({
            ...base(),
            ejecutar: async () => { llamadas++; return "ok"; }
        });

        assert.strictEqual(llamadas, 0, "una acción en 'error' no debe reintentarse automáticamente en esta fase");
        assert.strictEqual(r.ejecutada, false);
        assert.strictEqual(r.motivo, "ya_error");

    });

    // ---------------------------------------------------------------
    // Extra (no numerado en la consigna, pero cubre §5/§10 directamente):
    // obtenerAccionesEstancadas() lista, pero nunca reintenta.
    // ---------------------------------------------------------------
    await test("extra) obtenerAccionesEstancadas() encuentra acciones en_progreso viejas, sin tocarlas", async () => {

        const { executionGuard, fakeSupabase } = crearEntorno();

        const vieja = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min atrás
        const reciente = new Date().toISOString();

        fakeSupabase._agregar("automation_actions", {
            grupo_id: "g1", usuario_id: "u1", tipo_accion: "OPEN_MESSAGE",
            clave_idempotencia: "vieja:OPEN_MESSAGE", estado: "en_progreso",
            ejecutado_en: vieja, detalle: {}
        });

        fakeSupabase._agregar("automation_actions", {
            grupo_id: "g1", usuario_id: "u1", tipo_accion: "OPEN_MESSAGE",
            clave_idempotencia: "reciente:OPEN_MESSAGE", estado: "en_progreso",
            ejecutado_en: reciente, detalle: {}
        });

        const estancadas = await executionGuard.obtenerAccionesEstancadas({ minutosAntiguedad: 5 });

        assert.strictEqual(estancadas.length, 1);
        assert.strictEqual(estancadas[0].clave_idempotencia, "vieja:OPEN_MESSAGE");

        // Nunca las modifica.
        const filas = fakeSupabase._filas("automation_actions");
        assert.ok(filas.every(f => f.estado === "en_progreso"));

    });

    console.log("");
    console.log("============================");

    const total = resultados.length;
    const pasa = resultados.filter(r => r.ok).length;

    console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
    console.log("============================");

    if (pasa !== total) {
        process.exitCode = 1;
    }

}

main();
