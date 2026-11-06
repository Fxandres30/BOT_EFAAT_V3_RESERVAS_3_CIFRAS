// ==========================================================================
// PRUEBAS: inactividadRepo.fechaCompraDeFila (corrección F1-C, 06/11/2026).
//
// Fallo corregido: la hora con que se GUARDAN los pagos ("8:36:42", sin cero
// inicial antes de las 10:00, ver shared/tiempo/colombia.js::
// fechaHoraRegistro) no pasaba la validación y el pago contaba como de las
// 00:00. Se fija:
//   - horas con y sin cero inicial, con y sin segundos, medianoche "0:05:00"
//     y la "24:05:00" del Intl antiguo (mismo día, como siempre);
//   - hora vacía o con otro formato -> 00:00 de ese día (como siempre);
//   - hora con formato correcto pero imposible ("25:00:00") -> null (como
//     siempre);
//   - frente a la versión anterior solo cambian los casos corregidos;
//   - fecha ausente o imposible -> null (no se inventa ninguna fecha);
//   - límites: fin de mes, fin de año, bisiesto, cruce de medianoche UTC;
//   - coherencia con lo que escriben de verdad los pagos (ida y vuelta).
// El umbral de 15 días y las reglas de evaluarMiembro no se tocan.
//
//     node backend/tests/inactividad/fechaCompraDeFila.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: { from() { throw new Error("sin base en esta prueba"); } } };

const { fechaCompraDeFila } = require(r("bot/funciones/inactividad/inactividadRepo.js"));
const { fechaHoraRegistro } = require(r("shared/tiempo/colombia.js"));

const iso = (fecha_pago, hora_pago) => {
    const d = fechaCompraDeFila({ fecha_pago, hora_pago });
    return d === null ? null : d.toISOString();
};

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("hora SIN cero inicial (formato guardado): ya no es medianoche", () => {
    assert.strictEqual(iso("2026-10-22", "8:36:42"), "2026-10-22T13:36:42.000Z");
    assert.strictEqual(iso("2026-10-22", "9:05:00"), "2026-10-22T14:05:00.000Z");
    assert.strictEqual(iso("2026-10-22", "0:05:00"), "2026-10-22T05:05:00.000Z");
    assert.strictEqual(iso("2026-10-22", "8:36"), "2026-10-22T13:36:00.000Z");
});

prueba("hora CON cero inicial (columna time / datos antiguos): igual que antes", () => {
    assert.strictEqual(iso("2026-10-22", "08:36:42"), "2026-10-22T13:36:42.000Z");
    assert.strictEqual(iso("2026-10-01", "19:30:00"), "2026-10-02T00:30:00.000Z");
    assert.strictEqual(iso("2026-10-22", "08:36"), "2026-10-22T13:36:00.000Z");
    assert.strictEqual(iso("2026-10-22", "00:00:00"), "2026-10-22T05:00:00.000Z");
    assert.strictEqual(iso("2026-10-22", "23:59:59"), "2026-10-23T04:59:59.000Z");
    assert.strictEqual(iso("2026-10-22", " 10:00:00 "), "2026-10-22T15:00:00.000Z", "espacios alrededor");
    assert.strictEqual(iso("2026-10-22", "08:36:42.123"), "2026-10-22T13:36:42.000Z", "fracción de segundo (time(6))");
});

prueba("con y sin cero dan EXACTAMENTE el mismo instante", () => {
    for (let h = 0; h < 10; h++) {
        assert.strictEqual(iso("2026-10-22", `${h}:15:30`), iso("2026-10-22", `0${h}:15:30`), `hora ${h}`);
    }
});

prueba("medianoche «24:mm» del Intl antiguo: 00:mm del MISMO día (como siempre)", () => {
    assert.strictEqual(iso("2026-10-01", "24:05:00"), "2026-10-01T05:05:00.000Z");
    assert.strictEqual(iso("2026-10-01", "24:00"), "2026-10-01T05:00:00.000Z");
});

prueba("hora vacía o con otro formato: 00:00 de ese día (como siempre), la fecha se conserva", () => {
    const medianoche = "2026-10-22T05:00:00.000Z";
    for (const h of [null, undefined, "", "   ", "basura", "8", "8:3", "8:36:4", "10h30", "8:36:42 p. m.", "-1:00:00", 830]) {
        assert.strictEqual(iso("2026-10-22", h), medianoche, `hora ${JSON.stringify(h)}`);
    }
});

prueba("hora con formato correcto pero imposible: null (como siempre; no se inventa una hora)", () => {
    for (const h of ["25:00:00", "25:00", "10:60:00", "10:00:60", "24:60:00", "99:99:99"]) {
        assert.strictEqual(iso("2026-10-22", h), null, `hora ${JSON.stringify(h)}`);
    }
});

// La versión ANTERIOR, copiada literalmente de 97975555.
function fechaCompraAntigua({ fecha_pago, hora_pago }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_pago || ""))) return null;
    let hora = String(hora_pago || "00:00:00").trim().replace(/^24:/, "00:");
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) hora = "00:00:00";
    if (hora.length === 5) hora += ":00";
    const fecha = new Date(`${fecha_pago}T${hora}-05:00`);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
}

prueba("frente a la versión anterior: SOLO cambian los casos corregidos a propósito", () => {
    const fechas = ["2026-10-22", "2026-12-31", "2028-02-29", "2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "", null, "2026-10-22T10:00:00"];
    const horas = [null, undefined, "", "  ", "basura", "8:36:42 p. m.", "-1:00:00", "10h30", "8", "8:3", "8:36:4",
        "00:00:00", "08:36:42", "08:36", "19:30:00", "23:59:59", " 10:00:00 ", "24:05:00", "24:00", "24:60:00",
        "25:00:00", "25:00", "10:60:00", "10:00:60", "99:99:99",
        "8:36:42", "0:05:00", "9:05", "08:36:42.123"];
    // Diferencias intencionadas, y solo estas:
    const sinCero = (h) => /^\d:\d{2}(:\d{2})?$/.test(String(h ?? "").trim());   // antes: medianoche
    const fraccion = (h) => /\.\d+$/.test(String(h ?? ""));                         // antes: medianoche
    const fechaImposible = (f) => ["2026-02-30", "2026-02-29", "2026-04-31"].includes(f); // antes: mes siguiente
    let iguales = 0, cambiadas = 0;
    for (const f of fechas) for (const h of horas) {
        const antes = fechaCompraAntigua({ fecha_pago: f, hora_pago: h });
        const ahora = fechaCompraDeFila({ fecha_pago: f, hora_pago: h });
        const a = antes && antes.toISOString(), n = ahora && ahora.toISOString();
        if (a === n) { iguales++; continue; }
        cambiadas++;
        const motivo = fechaImposible(f) ? "fecha imposible" : sinCero(h) ? "hora sin cero" : fraccion(h) ? "fracción de segundo" : null;
        assert.ok(motivo, `cambio NO previsto: ${f} ${JSON.stringify(h)} antes=${a} ahora=${n}`);
        if (motivo === "fecha imposible") assert.strictEqual(n, null, `${f}: ahora null`);
        if (motivo !== "fecha imposible") assert.strictEqual(a, new Date(`${f}T00:00:00-05:00`).toISOString(), `${f} ${h}: antes medianoche`);
    }
    assert.ok(iguales > 200 && cambiadas > 0, `iguales=${iguales} cambiadas=${cambiadas}`);
});

prueba("sin fecha o con fecha imposible: null (no se inventa ninguna fecha)", () => {
    for (const f of [null, undefined, "", "2026-10", "22/10/2026", "2026-10-22T10:00:00", "2026-13-01", "2026-00-10", "2026-02-30", "2026-02-29", "2026-04-31", "2026-10-00"]) {
        assert.strictEqual(iso(f, "10:00:00"), null, `fecha ${JSON.stringify(f)}`);
    }
});

prueba("límites de fecha: fin de mes, fin de año, bisiesto, cruce de medianoche UTC", () => {
    assert.strictEqual(iso("2026-10-31", "23:59:59"), "2026-11-01T04:59:59.000Z");
    assert.strictEqual(iso("2026-12-31", "19:00:00"), "2027-01-01T00:00:00.000Z");
    assert.strictEqual(iso("2026-12-31", "18:59:59"), "2026-12-31T23:59:59.000Z");
    assert.strictEqual(iso("2027-01-01", "0:00:00"), "2027-01-01T05:00:00.000Z");
    assert.strictEqual(iso("2028-02-29", "9:00:00"), "2028-02-29T14:00:00.000Z", "29 de febrero bisiesto");
    assert.strictEqual(iso("2026-03-01", "0:30:00"), "2026-03-01T05:30:00.000Z");
});

prueba("ida y vuelta con lo que escriben los pagos (fechaHoraRegistro) minuto a minuto", () => {
    let comparados = 0;
    for (const inicio of ["2026-10-22T00:00:00Z", "2026-12-31T00:00:00Z", "2028-02-28T00:00:00Z"]) {
        const base = new Date(inicio).getTime();
        for (let m = 0; m < 48 * 60; m++) {
            const ahora = new Date(base + m * 60000 + 42000);
            const { fecha, hora } = fechaHoraRegistro(ahora);
            const esperado = new Date(Math.floor(ahora.getTime() / 1000) * 1000).toISOString();
            assert.strictEqual(iso(fecha, hora), esperado, `${fecha} ${hora}`);
            comparados++;
        }
    }
    assert.strictEqual(comparados, 3 * 48 * 60);
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK`);
process.exitCode = fallos ? 1 : 0;
