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
const { extraerNumeros, validarFormatoNumero } = require("../../bot/funciones/reservas/extraerNumeros");

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

// Auditoría "reservas por número de cifras": "1" (una sola cifra escrita)
// NUNCA se completa con un cero a la izquierda — son datos distintos de
// "01". Solo el número EXACTAMENTE con las cifras configuradas es válido.
test("sin cifras: '1' -> [] (default 2; una sola cifra NO se completa)", () => {
    eq(extraerNumeros("quiero el 1"), []);
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

test("2 cifras: '1' -> [] (una sola cifra NUNCA se completa a '01')", () => {
    eq(extraerNumeros("el 1", 2), []);
});

test("2 cifras: '02 09' -> ['02','09']", () => {
    eq(extraerNumeros("dame el 02 y el 09", 2), ["02", "09"]);
});

test("2 cifras: '10 11 50 99' -> ['10','11','50','99']", () => {
    eq(extraerNumeros("10 11 50 99", 2), ["10", "11", "50", "99"]);
});

test("2 cifras: '1' se descarta, '01' sigue siendo válido -> ['01']", () => {
    eq(extraerNumeros("el 1 y el 01", 2), ["01"]);
});

// ---------------------------------------------------------------
// EVENTO 3 CIFRAS (universo 000-999)
// ---------------------------------------------------------------

test("3 cifras: '7' -> [] (una sola cifra NO es válida para un evento de 3 cifras)", () => {
    eq(extraerNumeros("el 7", 3), []);
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

test("cifras inválidas (0) -> cae al default 2 ('1' sigue sin ser válido)", () => {
    eq(extraerNumeros("el 1", 0), []);
});

// ---------------------------------------------------------------
// Auditoría "reservas por número de cifras" — evento de 2 cifras
// (regla de negocio vigente hoy). Sección A-F del pedido.
// ---------------------------------------------------------------

// A. Una cifra -> NUNCA válida para un evento de 2 cifras
test("A. '1' -> [] (evento 2 cifras)", () => {
    eq(extraerNumeros("1", 2), []);
});

test("A. '2' -> []", () => {
    eq(extraerNumeros("2", 2), []);
});

test("A. '5' -> []", () => {
    eq(extraerNumeros("5", 2), []);
});

test("A. '9' -> []", () => {
    eq(extraerNumeros("9", 2), []);
});

// B. Dos cifras -> formato válido (cero inicial incluido)
test("B. '00' -> ['00']", () => {
    eq(extraerNumeros("00", 2), ["00"]);
});

test("B. '01' -> ['01']", () => {
    eq(extraerNumeros("01", 2), ["01"]);
});

test("B. '05' -> ['05']", () => {
    eq(extraerNumeros("05", 2), ["05"]);
});

test("B. '09' -> ['09']", () => {
    eq(extraerNumeros("09", 2), ["09"]);
});

test("B. '10' -> ['10']", () => {
    eq(extraerNumeros("10", 2), ["10"]);
});

test("B. '25' -> ['25']", () => {
    eq(extraerNumeros("25", 2), ["25"]);
});

test("B. '50' -> ['50']", () => {
    eq(extraerNumeros("50", 2), ["50"]);
});

test("B. '99' -> ['99']", () => {
    eq(extraerNumeros("99", 2), ["99"]);
});

// C. Tres cifras -> NUNCA válido para un evento de 2 cifras
test("C. '100' -> []", () => {
    eq(extraerNumeros("100", 2), []);
});

test("C. '123' -> []", () => {
    eq(extraerNumeros("123", 2), []);
});

test("C. '999' -> []", () => {
    eq(extraerNumeros("999", 2), []);
});

// D. Frases completas
test("D. 'quiero el 5' -> [] (frase con una cifra)", () => {
    eq(extraerNumeros("quiero el 5", 2), []);
});

test("D. 'quiero el 05' -> ['05'] (frase con cero inicial explícito)", () => {
    eq(extraerNumeros("quiero el 05", 2), ["05"]);
});

test("D. 'resérvame el 5' -> []", () => {
    eq(extraerNumeros("resérvame el 5", 2), []);
});

test("D. 'resérvame el 05' -> ['05']", () => {
    eq(extraerNumeros("resérvame el 05", 2), ["05"]);
});

test("D. 'quiero el 100' -> [] (3 cifras)", () => {
    eq(extraerNumeros("quiero el 100", 2), []);
});

test("D. 'quiero el 25' -> ['25'] (sigue funcionando igual)", () => {
    eq(extraerNumeros("quiero el 25", 2), ["25"]);
});

// E. Múltiples números — SIN conversión silenciosa de "5" a "05"
test("E. '05 25' -> ['05','25'] (ambos válidos)", () => {
    eq(extraerNumeros("05 25", 2), ["05", "25"]);
});

test("E. '5 25' -> ['25'] ('5' se descarta, NUNCA se convierte en '05')", () => {
    eq(extraerNumeros("5 25", 2), ["25"]);
});

test("E. '05 5' -> ['05'] (el '5' suelto NUNCA se fusiona con '05')", () => {
    eq(extraerNumeros("05 5", 2), ["05"]);
});

// F. Teléfonos / cédulas — cadenas largas, ya protegidas por el límite de
// palabra del patrón (ningún dígito interno de una racha larga tiene un
// límite de palabra a ambos lados)
test("F. '3001234567' -> [] (teléfono)", () => {
    eq(extraerNumeros("3001234567", 2), []);
});

test("F. '3216549870' -> [] (teléfono)", () => {
    eq(extraerNumeros("3216549870", 2), []);
});

test("F. 'mi cedula es 1023456789' -> [] (cédula)", () => {
    eq(extraerNumeros("mi cedula es 1023456789", 2), []);
});

// ---------------------------------------------------------------
// validarFormatoNumero() — defensa en profundidad reutilizable, misma
// regla exacta que usa extraerNumeros() internamente.
// ---------------------------------------------------------------

test("validarFormatoNumero('05', 2) -> true", () => {
    assert.strictEqual(validarFormatoNumero("05", 2), true);
});

test("validarFormatoNumero('5', 2) -> false", () => {
    assert.strictEqual(validarFormatoNumero("5", 2), false);
});

test("validarFormatoNumero('100', 2) -> false", () => {
    assert.strictEqual(validarFormatoNumero("100", 2), false);
});

test("validarFormatoNumero('25', 2) -> true", () => {
    assert.strictEqual(validarFormatoNumero("25", 2), true);
});

test("validarFormatoNumero('7', 1) -> true (evento de 1 cifra)", () => {
    assert.strictEqual(validarFormatoNumero("7", 1), true);
});

test("validarFormatoNumero(undefined, 2) -> false (nunca revienta con datos raros)", () => {
    assert.strictEqual(validarFormatoNumero(undefined, 2), false);
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
