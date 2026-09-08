// ==========================================================================
// PRUEBAS — formatHora12() (backend/bot/utils/formatHora.js)
//
//     node backend/tests/utils/formatHora.test.js
// ==========================================================================

const assert = require("assert");
const { formatHora12 } = require("../../bot/utils/formatHora");

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

function eq(entrada, esperado) {
    assert.strictEqual(formatHora12(entrada), esperado);
}

// Casos del enunciado
test("07:00 -> 7:00 AM", () => eq("07:00", "7:00 AM"));
test("08:30 -> 8:30 AM", () => eq("08:30", "8:30 AM"));
test("12:00 -> 12:00 PM", () => eq("12:00", "12:00 PM"));
test("13:00 -> 1:00 PM", () => eq("13:00", "1:00 PM"));
test("18:30 -> 6:30 PM", () => eq("18:30", "6:30 PM"));
test("22:30 -> 10:30 PM", () => eq("22:30", "10:30 PM"));
test("00:30 -> 12:30 AM", () => eq("00:30", "12:30 AM"));

// Fronteras AM/PM
test("00:00 -> 12:00 AM", () => eq("00:00", "12:00 AM"));
test("00:01 -> 12:01 AM", () => eq("00:01", "12:01 AM"));
test("11:59 -> 11:59 AM", () => eq("11:59", "11:59 AM"));
test("12:01 -> 12:01 PM", () => eq("12:01", "12:01 PM"));
test("23:59 -> 11:59 PM", () => eq("23:59", "11:59 PM"));

// Errores clásicos que NO deben ocurrir
test("00:00 NO es 12:00 PM", () => assert.notStrictEqual(formatHora12("00:00"), "12:00 PM"));
test("12:00 NO es 12:00 AM", () => assert.notStrictEqual(formatHora12("12:00"), "12:00 AM"));

// Entradas raras -> se devuelven tal cual / vacío
test("null -> ''", () => eq(null, ""));
test("undefined -> ''", () => eq(undefined, ""));
test("'' -> ''", () => eq("", ""));
test("'sin formato' -> 'sin formato'", () => eq("sin formato", "sin formato"));
test("'25:00' (fuera de rango) -> '25:00'", () => eq("25:00", "25:00"));
test("'9:05' (1 dígito) -> '9:05 AM'", () => eq("9:05", "9:05 AM"));
test("'22:30:00' (con segundos) -> '10:30 PM'", () => eq("22:30:00", "10:30 PM"));

const total = resultados.length;
const pasa = resultados.filter(r => r.ok).length;

console.log("");
console.log("============================");
console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
console.log("============================");

if (pasa !== total) {
    process.exitCode = 1;
}
