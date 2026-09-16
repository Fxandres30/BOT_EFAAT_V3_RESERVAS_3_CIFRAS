// ==========================================================================
// PRUEBAS — determinarEstadoPago() (backend/shared/pagos/determinarEstadoPago.js)
//
// Cubre los 4 casos obligatorios de la auditoría "consulta de pago
// contextual": sin_pago / pago_parcial / pago_completo / sin_saldo NUNCA
// deben compartir una sola plantilla universal — el backend decide primero
// el estado real, y solo después se elige la categoría de plantilla
// (ver calcularTipoPresentacion en backend/bot/ai/plantillaMensaje.js).
//
//     node backend/tests/pagos/determinarEstadoPago.test.js
// ==========================================================================

const assert = require("assert");
const { determinarEstadoPago } = require("../../shared/pagos/determinarEstadoPago");

const resultados = [];

function test(nombre, fn) {

    try {
        fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.stack || err.message}`);
    }

}

// Caso A del pedido: total $20.000, pagado $0, pendiente $20.000 -> sin_pago
test("Caso A: reservas activas + $0 pagado => sin_pago", () => {

    const estado = determinarEstadoPago({ total: 4, montoTotal: 20000, montoPagado: 0, montoPendiente: 20000 });

    assert.strictEqual(estado, "sin_pago");

});

// Caso B del pedido: total $20.000, pagado $10.000, pendiente $10.000 -> pago_parcial
test("Caso B: pagado > 0 y pendiente > 0 => pago_parcial", () => {

    const estado = determinarEstadoPago({ total: 4, montoTotal: 20000, montoPagado: 10000, montoPendiente: 10000 });

    assert.strictEqual(estado, "pago_parcial");

});

// Caso C del pedido: total $20.000, pagado $20.000, pendiente $0 -> pago_completo
test("Caso C: pendiente = 0 y pagado = total => pago_completo", () => {

    const estado = determinarEstadoPago({ total: 4, montoTotal: 20000, montoPagado: 20000, montoPendiente: 0 });

    assert.strictEqual(estado, "pago_completo");

});

// Caso D del pedido: reservas canceladas/liberadas (sin filas activas) -> sin_saldo
test("Caso D: sin números activos (reservas liberadas/canceladas o nunca reservó) => sin_saldo", () => {

    const estado = determinarEstadoPago({ total: 0, montoTotal: 0, montoPagado: 0, montoPendiente: 0 });

    assert.strictEqual(estado, "sin_saldo");

});

test("sin_saldo gana incluso si total es undefined/null (nunca hubo consulta previa)", () => {

    assert.strictEqual(determinarEstadoPago({}), "sin_saldo");

});

const fallidas = resultados.filter(r => !r.ok);

console.log("\n============================================");
console.log(`Pruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas.length}  |  Fallidas: ${fallidas.length}`);
console.log("============================================\n");

if (fallidas.length > 0) {
    process.exitCode = 1;
}
