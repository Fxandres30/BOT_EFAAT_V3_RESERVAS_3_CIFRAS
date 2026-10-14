// ==========================================================================
// PRUEBA — pago de un cliente SOLO LID con el trigger heredado de
// compradores_semanales (whatsapp NOT NULL).
//
// Producción: "null value in column \"whatsapp\" of relation
// \"compradores_semanales\" violates not-null constraint". Postgres rechaza
// el UPDATE entero: el pago no se guarda. El código no puede arreglar el
// trigger (está en la base, fuera del repo) y NUNCA inventa un teléfono:
// debe dejar la reserva intacta e informar el motivo exacto.
//
//     node backend/tests/pagos/compradoresSinWhatsapp.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const ERROR_TRIGGER = { code: "23502", message: 'null value in column "whatsapp" of relation "compradores_semanales" violates not-null constraint' };

const actualizaciones = [];
const filas = [{ numero: "07", estado: "reservado", contacto: null, telefono: null, comprador: "Cliente", nombre: "Cliente", lid: "123@lid" }];

function consulta() {
    const q = { op: "select", payload: null };
    const b = {
        select() { return b; }, eq() { return b; },
        update(x) { q.op = "update"; q.payload = x; return b; },
        then(ok, ko) {
            if (q.op === "update") { actualizaciones.push(q.payload); return Promise.resolve({ data: null, error: ERROR_TRIGGER }).then(ok, ko); }
            return Promise.resolve({ data: filas.map(f => ({ ...f })), error: null }).then(ok, ko);
        }
    };
    return b;
}

const rutaSupabase = path.resolve(__dirname, "../../lib/supabase.js");
require.cache[rutaSupabase] = { id: rutaSupabase, filename: rutaSupabase, loaded: true, exports: { from: consulta } };

const { marcarReservasPagadasPorAdmin, esErrorTriggerCompradoresSinWhatsapp } = require("../../bot/funciones/pagos/marcarReservasPagadasPorAdmin");

(async () => {
    const err = console.error; console.error = () => {};
    let falla = 0;
    try {
        const r = await marcarReservasPagadasPorAdmin({
            evento: { tabla: "t", id: "ev", usuario_id: "tenant", identidad_evento_real: "idr" },
            usuario: { id: "u1", telefono: null, nombre: "Cliente", lid: "123@lid" },
            realizadoPor: "admin"
        });
        console.error = err;
        assert.strictEqual(r.estado, "error");
        assert.strictEqual(r.motivo, "compradores_semanales_sin_whatsapp");
        assert.deepStrictEqual(r.actualizadas, []);
        assert.ok(!("contacto" in actualizaciones[0]) && !("telefono" in actualizaciones[0]), "nunca inventa un teléfono");
        assert.strictEqual(filas[0].estado, "reservado", "la reserva no se toca");
        assert.strictEqual(esErrorTriggerCompradoresSinWhatsapp({ code: "23502", message: 'null value in column "otra" of relation "x"' }), false);
        console.log("✅ cliente solo LID + trigger heredado: pago no guardado, motivo exacto, sin inventar teléfono");
    } catch (e) {
        console.error = err; falla++;
        console.log("❌ cliente solo LID + trigger heredado"); console.log(String(e.stack || e));
    }
    console.log(`\n============================\nTOTAL: 1  ✅ PASA: ${1 - falla}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
