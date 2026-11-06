// ==========================================================================
// PRUEBAS: shared/tiempo/colombia.js (F1-B, 06/11/2026).
//
// Equivalencia EXACTA con las expresiones que sustituyó (copiadas aquí
// literalmente, tal como estaban en cada archivo), minuto a minuto, en días
// que cruzan medianoche UTC, cambio de mes y de año, y un año bisiesto.
// Si una sola salida difiere, centralizar habría cambiado un resultado.
//
//     node backend/tests/utils/tiempoColombia.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const t = require(path.resolve(__dirname, "../../shared/tiempo/colombia.js"));

// ---- expresiones ANTIGUAS, literales ----
const antiguas = {
    // automation/scheduler.js (fechaHoyColombia), identidadEventoReal.fechaEventoHoy,
    // eventRules.obtenerFechaISO: mismo formato en-CA.
    fechaEnCA: (a) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(a),
    // eventRules.obtenerHoraMinuto
    horaEnGB: (a) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false }).format(a),
    // identidadEventoReal.fechaSorteoAnunciado (horaActual)
    horaH23: (a) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(a),
    // sorteos/validar.partesBogota y sorteos/calendario.ahoraColombia
    partes: (a) => {
        const v = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(a).map(p => [p.type, p.value]));
        return { fecha: `${v.year}-${v.month}-${v.day}`, hora: `${v.hour}:${v.minute}` };
    },
    // bot/funciones/inactividad/workerInactividad.horaBogota
    horaNumero: (a) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Bogota" }).format(a)),
    // eventRules.obtenerClaveDia
    dia: (a) => ({ Monday: "lunes", Tuesday: "martes", Wednesday: "miercoles", Thursday: "jueves", Friday: "viernes", Saturday: "sabado", Sunday: "domingo" })[new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", weekday: "long" }).format(a)] || null,
    // reservarNumeros, marcarReservasPagadasPorAdmin, reservaManual.ahoraBogota
    registro: (a) => ({ fecha: a.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" }), hora: a.toLocaleTimeString("es-CO", { hour12: false, timeZone: "America/Bogota" }) }),
    // sorteos/validar.instanteBogota
    instante: (fecha, hora) => {
        if (!fecha || !hora) return null;
        const m = String(hora).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!m) return null;
        const h = `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
        const d = new Date(`${fecha}T${h}-05:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
};

const DIAS_INICIO = ["2026-10-22T00:00:00Z", "2026-12-31T00:00:00Z", "2028-02-28T00:00:00Z", "2026-11-01T00:00:00Z"];
let comparados = 0;

function cadaMinuto(fn) {
    for (const inicio of DIAS_INICIO) {
        const base = new Date(inicio).getTime();
        for (let m = 0; m < 48 * 60; m++) { fn(new Date(base + m * 60000 + 37000)); comparados++; } // segundo 37: no cae en :00
    }
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("fechaColombia = en-CA de scheduler / identidadEventoReal / eventRules", () => cadaMinuto(a => assert.strictEqual(t.fechaColombia(a), antiguas.fechaEnCA(a), a.toISOString())));
prueba("horaColombia = en-GB hour12:false (eventRules) = h23 (identidadEventoReal)", () => cadaMinuto(a => {
    assert.strictEqual(t.horaColombia(a), antiguas.horaEnGB(a), a.toISOString());
    assert.strictEqual(t.horaColombia(a), antiguas.horaH23(a), a.toISOString());
}));
prueba("partesColombia = partesBogota (validar) = ahoraColombia (calendario)", () => cadaMinuto(a => assert.deepStrictEqual(t.partesColombia(a), antiguas.partes(a), a.toISOString())));
prueba("horaNumeroColombia = horaBogota (workerInactividad)", () => cadaMinuto(a => assert.strictEqual(t.horaNumeroColombia(a), antiguas.horaNumero(a), a.toISOString())));
prueba("diaSemanaColombia = obtenerClaveDia (eventRules)", () => cadaMinuto(a => assert.strictEqual(t.diaSemanaColombia(a), antiguas.dia(a), a.toISOString())));
prueba("fechaHoraRegistro = formato guardado en las cuadrículas (sv-SE + es-CO)", () => cadaMinuto(a => assert.deepStrictEqual(t.fechaHoraRegistro(a), antiguas.registro(a), a.toISOString())));
prueba("fechaHoraRegistro conserva la hora sin cero inicial que ya está en la base (p. ej. «8:36:42»)", () => {
    const r = t.fechaHoraRegistro(new Date("2026-10-22T13:36:42Z"));
    assert.deepStrictEqual(r, antiguas.registro(new Date("2026-10-22T13:36:42Z")));
    assert.strictEqual(r.fecha, "2026-10-22");
});
prueba("instanteColombia = instanteBogota (validar) en todos los formatos de hora", () => {
    const casos = [["2026-10-22", "22:26"], ["2026-10-22", "22:26:30"], ["2026-10-22", "8:36:42"], ["2026-10-22", "08:36"], ["2026-10-22", "00:00"], ["2026-12-31", "23:59:59"],
        ["2026-10-22", null], [null, "10:00"], ["2026-10-22", "sin hora"], ["2026-13-40", "10:00"], ["2026-10-22", "25:00"]];
    for (const [f, h] of casos) {
        const a = antiguas.instante(f, h);
        const n = t.instanteColombia(f, h);
        assert.strictEqual(n === null ? null : n.toISOString(), a === null ? null : a.toISOString(), `${f} ${h}`);
    }
    assert.strictEqual(t.instanteColombia("2026-10-22", "22:26").toISOString(), "2026-10-23T03:26:00.000Z");
});
prueba("constantes de zona", () => {
    assert.strictEqual(t.ZONA_COLOMBIA, "America/Bogota");
    assert.strictEqual(t.DESFASE_COLOMBIA, "-05:00");
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK · ${comparados} instantes comparados`);
process.exitCode = fallos ? 1 : 0;
