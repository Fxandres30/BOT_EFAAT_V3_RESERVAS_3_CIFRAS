// ==========================================================================
// Ayudante de las PRUEBAS DE CARACTERIZACIÓN (F1-A, 06/11/2026).
//
// Una prueba de caracterización fija el comportamiento ACTUAL, sea el
// deseado o no, para que la consolidación (F1-B en adelante) demuestre que
// no lo cambió sin querer. Cuando el comportamiento actual es un riesgo
// conocido, la prueba lo dice con riesgo("…"): sigue pasando, pero el
// riesgo queda escrito en la salida y en docs/pruebas/LINEA_BASE.md.
//
// Si una consolidación cambia A PROPÓSITO uno de estos comportamientos, se
// actualiza aquí la expectativa, en el mismo cambio y con su motivo.
// ==========================================================================

"use strict";

const pruebas = [];
const riesgos = [];

const prueba = (nombre, fn) => pruebas.push({ nombre, fn });
const riesgo = (texto) => riesgos.push(texto);

async function ejecutar(titulo) {
    let fallos = 0;
    console.log(`\n${titulo}\n${"─".repeat(Math.min(78, titulo.length))}`);
    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            console.log(`✅ ${nombre}`);
        } catch (err) {
            fallos++;
            console.log(`❌ ${nombre}\n   ${String(err && err.stack || err).split("\n").slice(0, 6).join("\n   ")}`);
        }
    }
    for (const r of [...new Set(riesgos)]) console.log(`⚠️  RIESGO ACTUAL (caracterizado, no corregido): ${r}`);
    console.log(`\nTOTAL: ${pruebas.length} · ✅ ${pruebas.length - fallos} · ❌ ${fallos}`);
    process.exitCode = fallos ? 1 : 0;
}

module.exports = { prueba, riesgo, ejecutar };
