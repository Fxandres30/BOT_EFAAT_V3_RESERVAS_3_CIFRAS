// ==========================================================================
// PRUEBAS — crearIdentidadCiclo() (backend/automation/eventRules.js).
//
// Función pura: sin Supabase, sin fakes de red. Cubre exactamente los 3
// casos pedidos en la consigna de Fase 2B §6/§12.
//
//     node backend/tests/automation/identidadCiclo.test.js
// ==========================================================================

const assert = require("assert");
const { crearIdentidadCiclo } = require("../../automation/eventRules");

function eventoBase(overrides = {}) {
    return {
        id: "evento-bot-uuid-fijo", // mismo id de eventos_bot en varios casos
        grupo_id: "573000000000-1111@g.us",
        nombre_evento: "SORTEO DE LA TARDE",
        hora_fin: "20:00",
        valor: 5000,
        fecha_evento: "2026-09-08",
        ...overrides
    };
}

const resultados = [];

function test(nombre, fn) {

    try {

        fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);

    } catch (err) {

        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);

    }

}

// ---------------------------------------------------------------
// 1) mismo evento -> mismo hash
// ---------------------------------------------------------------
test("1) mismo evento produce la misma identidad de ciclo", () => {

    const a = crearIdentidadCiclo(eventoBase());
    const b = crearIdentidadCiclo(eventoBase());

    assert.strictEqual(a, b, "la identidad debe ser determinística para los mismos datos");
    assert.strictEqual(typeof a, "string");
    assert.ok(a.length > 0);

});

// ---------------------------------------------------------------
// 2) evento distinto -> hash distinto (uno por cada campo de identidad)
// ---------------------------------------------------------------
test("2) evento distinto produce identidad distinta (grupo_id)", () => {

    const a = crearIdentidadCiclo(eventoBase());
    const b = crearIdentidadCiclo(eventoBase({ grupo_id: "573000000000-2222@g.us" }));

    assert.notStrictEqual(a, b);

});

test("2) evento distinto produce identidad distinta (nombre_evento)", () => {

    const a = crearIdentidadCiclo(eventoBase());
    const b = crearIdentidadCiclo(eventoBase({ nombre_evento: "SORTEO DE LA NOCHE" }));

    assert.notStrictEqual(a, b);

});

test("2) evento distinto produce identidad distinta (hora_fin)", () => {

    const a = crearIdentidadCiclo(eventoBase());
    const b = crearIdentidadCiclo(eventoBase({ hora_fin: "21:00" }));

    assert.notStrictEqual(a, b);

});

test("2) evento distinto produce identidad distinta (valor)", () => {

    const a = crearIdentidadCiclo(eventoBase());
    const b = crearIdentidadCiclo(eventoBase({ valor: 10000 }));

    assert.notStrictEqual(a, b);

});

test("2) evento distinto produce identidad distinta (fecha_evento)", () => {

    const a = crearIdentidadCiclo(eventoBase());
    const b = crearIdentidadCiclo(eventoBase({ fecha_evento: "2026-09-09" }));

    assert.notStrictEqual(a, b);

});

// ---------------------------------------------------------------
// 3) mismo eventos_bot.id, pero es un sorteo NUEVO -> identidad distinta
//    (el caso central de Fase 2A: eventos_bot.id se reutiliza entre
//    sorteos del mismo grupo, así que la identidad NUNCA debe depender de
//    evento.id — solo de los 5 campos de contenido).
// ---------------------------------------------------------------
test("3) mismo evento.id (fila de eventos_bot reutilizada) pero datos de un sorteo nuevo -> identidad distinta", () => {

    const sorteoDeAyer = eventoBase({ id: "misma-fila-eventos-bot", fecha_evento: "2026-09-07" });
    const sorteoDeHoy = eventoBase({ id: "misma-fila-eventos-bot", fecha_evento: "2026-09-08" });

    assert.strictEqual(sorteoDeAyer.id, sorteoDeHoy.id, "este test asume el mismo evento.id en ambos, a propósito");

    const a = crearIdentidadCiclo(sorteoDeAyer);
    const b = crearIdentidadCiclo(sorteoDeHoy);

    assert.notStrictEqual(a, b, "evento.id NO debe influir en la identidad de ciclo — debe cambiar por fecha_evento distinta");

});

test("3b) evento.id no participa en el cálculo en absoluto (cambiarlo solo, nada más, no cambia la identidad)", () => {

    const conIdA = eventoBase({ id: "aaaa" });
    const conIdB = eventoBase({ id: "bbbb" });

    const a = crearIdentidadCiclo(conIdA);
    const b = crearIdentidadCiclo(conIdB);

    assert.strictEqual(a, b, "evento.id no es uno de los 5 campos de identidad — cambiarlo solo no debe cambiar el hash");

});

const total = resultados.length;
const pasa = resultados.filter(r => r.ok).length;

console.log("");
console.log("============================");
console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
console.log("============================");

if (pasa !== total) {
    process.exitCode = 1;
}
