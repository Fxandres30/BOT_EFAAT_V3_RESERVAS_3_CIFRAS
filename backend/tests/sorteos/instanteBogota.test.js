// ==========================================================================
// PRUEBAS — sorteos/validar.js::instanteBogota con los formatos de hora que
// existen de verdad: "HH:MM" (formularios), "HH:MM:SS" y "HH:MM:SS.ffffff"
// (columna `time` de Postgres) y "H:MM:SS" sin cero inicial (como la escribe
// reservarNumeros.js con toLocaleTimeString "es-CO").
//
// Regresión de reservaAnticipada 7e: una reserva hecha antes de las 10:00
// ("8:36:42") daba null y la liberación por vencimiento nunca la soltaba.
// Función pura: sin Supabase ni red.
//
//     node backend/tests/sorteos/instanteBogota.test.js
// ==========================================================================

const assert = require("assert");
const { instanteBogota } = require("../../sorteos/validar");

const casos = [
    ["8:36:42", "2026-10-28T13:36:42.000Z"],
    ["08:36:42", "2026-10-28T13:36:42.000Z"],
    ["08:36", "2026-10-28T13:36:00.000Z"],
    ["0:05:00", "2026-10-28T05:05:00.000Z"],
    ["22:30:15.123456", "2026-10-29T03:30:15.000Z"],
    ["23:59", "2026-10-29T04:59:00.000Z"]
];

let fallos = 0;

for (const [hora, esperado] of casos) {
    try {
        assert.strictEqual(instanteBogota("2026-10-28", hora)?.toISOString(), esperado, hora);
        console.log(`✅ ${hora} -> ${esperado}`);
    } catch (e) {
        fallos++;
        console.log(`❌ ${hora}: ${e.message}`);
    }
}

for (const [fecha, hora] of [[null, "08:00"], ["2026-10-28", null], ["2026-10-28", "ocho"], ["2026-10-28", "25:00"], ["fecha", "08:00"]]) {
    try {
        assert.strictEqual(instanteBogota(fecha, hora), null, `${fecha} ${hora}`);
        console.log(`✅ inválido ${fecha} ${hora} -> null`);
    } catch (e) {
        fallos++;
        console.log(`❌ inválido ${fecha} ${hora}: ${e.message}`);
    }
}

const total = casos.length + 5;
console.log(`\n============================\nTOTAL: ${total}  ✅ PASA: ${total - fallos}  ❌ FALLA: ${fallos}\n============================`);
process.exit(fallos ? 1 : 0);
