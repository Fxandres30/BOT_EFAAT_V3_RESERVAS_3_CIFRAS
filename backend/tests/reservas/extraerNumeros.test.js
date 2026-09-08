// ==========================================================================
// PRUEBAS — extraerNumeros() (backend/bot/funciones/reservas/extraerNumeros.js)
//
// Función pura, sin Supabase. Verifica que la cantidad de cifras la decide
// la configuración real del evento (parámetro `cifras`) y NO una suposición
// fija de 2 cifras, y que la normalización "O -> 0" solo ocurre dentro de
// un candidato numérico (nunca sobre nombres/palabras).
//
//     node backend/tests/reservas/extraerNumeros.test.js
// ==========================================================================

const assert = require("assert");
const { extraerNumeros } = require("../../bot/funciones/reservas/extraerNumeros");

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

function eq(a, b) {
    assert.deepStrictEqual(a, b);
}

// ---------------------------------------------------------------
// Compatibilidad: sin `cifras` -> comportamiento previo (2 cifras)
// ---------------------------------------------------------------

test("sin cifras: '1' -> ['01'] (default 2, igual que antes)", () => {
    eq(extraerNumeros("quiero el 1"), ["01"]);
});

test("sin cifras: '27 45' -> ['27','45']", () => {
    eq(extraerNumeros("me das el 27 y el 45"), ["27", "45"]);
});

test("sin cifras: '00' y '99' válidos", () => {
    eq(extraerNumeros("el 00 y el 99"), ["00", "99"]);
});

// ---------------------------------------------------------------
// EVENTO 1 CIFRA
// ---------------------------------------------------------------

test("1 cifra: '1' -> ['1'] (no se convierte a '01')", () => {
    eq(extraerNumeros("quiero el 1", 1), ["1"]);
});

test("1 cifra: '2' -> ['2']", () => {
    eq(extraerNumeros("aparta el 2", 1), ["2"]);
});

test("1 cifra: '9' -> ['9']", () => {
    eq(extraerNumeros("el 9 por favor", 1), ["9"]);
});

test("1 cifra: '5 y 7' -> ['5','7']", () => {
    eq(extraerNumeros("el 5 y el 7", 1), ["5", "7"]);
});

test("1 cifra: '50' NO es válido (fuera del universo 0-9)", () => {
    eq(extraerNumeros("el 50", 1), []);
});

test("1 cifra: '0' -> ['0']", () => {
    eq(extraerNumeros("el 0", 1), ["0"]);
});

// ---------------------------------------------------------------
// EVENTO 2 CIFRAS
// ---------------------------------------------------------------

test("2 cifras: '00' -> ['00']", () => {
    eq(extraerNumeros("el 00", 2), ["00"]);
});

test("2 cifras: '01' -> ['01'] (con cero inicial escrito)", () => {
    eq(extraerNumeros("el 01", 2), ["01"]);
});

test("2 cifras: '1' -> ['01'] (se canoniza a 2 dígitos)", () => {
    eq(extraerNumeros("el 1", 2), ["01"]);
});

test("2 cifras: '02 09' -> ['02','09']", () => {
    eq(extraerNumeros("dame el 02 y el 09", 2), ["02", "09"]);
});

test("2 cifras: '10 11 50 99' -> ['10','11','50','99']", () => {
    eq(extraerNumeros("10 11 50 99", 2), ["10", "11", "50", "99"]);
});

test("2 cifras: '1' y '01' colapsan al mismo canónico '01'", () => {
    eq(extraerNumeros("el 1 y el 01", 2), ["01"]);
});

// ---------------------------------------------------------------
// EVENTO 3 CIFRAS (universo 000-999)
// ---------------------------------------------------------------

test("3 cifras: '7' -> ['007']", () => {
    eq(extraerNumeros("el 7", 3), ["007"]);
});

test("3 cifras: '123' -> ['123']", () => {
    eq(extraerNumeros("el 123", 3), ["123"]);
});

test("3 cifras: '999' válido, '1000' no", () => {
    eq(extraerNumeros("el 999 y el 1000", 3), ["999"]);
});

// ---------------------------------------------------------------
// CASOS CON "O" INICIAL (solo dentro de un candidato numérico)
// ---------------------------------------------------------------

test("2 cifras: 'O0' -> ['00']", () => {
    eq(extraerNumeros("reservar o0", 2), ["00"]);
});

test("2 cifras: 'O1' -> ['01']", () => {
    eq(extraerNumeros("quiero reservar o1", 2), ["01"]);
});

test("2 cifras: 'O9' -> ['09']", () => {
    eq(extraerNumeros("el o9", 2), ["09"]);
});

test("2 cifras: 'O1' en mayúscula real -> ['01']", () => {
    eq(extraerNumeros("Quiero reservar O1", 2), ["01"]);
});

test("1 cifra: 'o1' -> ['1'] (la 'o' es ruido, no cabe como cero inicial)", () => {
    eq(extraerNumeros("el o1", 1), ["1"]);
});

test("3 cifras: 'oo1' -> ['001']", () => {
    eq(extraerNumeros("el oo1", 3), ["001"]);
});

// ---------------------------------------------------------------
// CASOS QUE NO DEBEN CONVERTIRSE (nombres / palabras)
// ---------------------------------------------------------------

test("'Ola' no produce ningún número", () => {
    eq(extraerNumeros("Ola", 2), []);
});

test("'Hola' no produce ningún número", () => {
    eq(extraerNumeros("Hola", 2), []);
});

test("'Pedro' no produce ningún número", () => {
    eq(extraerNumeros("Pedro", 2), []);
});

test("'Evento O' no produce ningún número", () => {
    eq(extraerNumeros("Evento O", 2), []);
});

test("'Hola Pedro' no se modifica ni produce números", () => {
    eq(extraerNumeros("Hola Pedro", 2), []);
});

test("nombre con número al lado: 'soy Pedro, quiero el o5' -> ['05']", () => {
    eq(extraerNumeros("soy Pedro quiero el o5", 2), ["05"]);
});

// ---------------------------------------------------------------
// Entradas sin números válidos
// ---------------------------------------------------------------

test("texto sin números -> []", () => {
    eq(extraerNumeros("hola buenas tardes", 2), []);
});

test("cifras inválidas (0) -> cae al default 2", () => {
    eq(extraerNumeros("el 1", 0), ["01"]);
});

// ---------------------------------------------------------------

const total = resultados.length;
const pasa = resultados.filter(r => r.ok).length;

console.log("");
console.log("============================");
console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
console.log("============================");

if (pasa !== total) {
    process.exitCode = 1;
}
