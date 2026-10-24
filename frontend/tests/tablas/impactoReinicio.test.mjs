// ==========================================================================
// PRUEBAS (frontend) — impacto del reinicio de una tabla
// (services/tablas/impactoReinicio.ts, módulo puro: sin red ni Supabase).
//
//   - una reserva es ANTICIPADA solo si su sorteo programado no se publicó y
//     su identidad no tiene ningún evento (un sorteo 'fallido' que llegó a
//     publicarse y cerró NO bloquea: caso real de producción, 23/10);
//   - el resumen cuenta cada estado, avisa de sorteos en curso y de los
//     otros precios que usan la misma tabla física;
//   - la huella cambia si cambia cualquier número ocupado;
//   - sin el texto exacto, o sin aceptar las anticipadas, no se confirma.
//
//     node frontend/tests/tablas/impactoReinicio.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, require);
    return modulo.exports;
}

const { calcularImpacto, huellaFilas, identidadesAnticipadas, puedeConfirmar, TEXTO_CONFIRMACION } = cargarTs(path.join(FRONT, "services/tablas/impactoReinicio.ts"));

let total = 0;
function prueba(nombre, fn) { fn(); total++; console.log(`✅ ${nombre}`); }

const T = "5k_15k_reservas_2_cifras";
const fila = (numero, estado = "libre", identidad = null) => ({ numero, estado, identidad_evento_real: identidad });
const cuadricula = (ocupados = {}) => Array.from({ length: 100 }, (_, i) => {
    const n = String(i).padStart(2, "0");
    return ocupados[n] ? fila(n, ...ocupados[n]) : fila(n);
});
const PRECIOS = [{ precio: 1000, tabla: "reservas_dos_cifras" }, { precio: 3000, tabla: T }, { precio: 5000, tabla: T }, { precio: 7000, tabla: T }];
const impacto = (filas, sorteos = [], eventos = []) => calcularImpacto({ tabla: T, precio: 3000, filas, sorteos, eventos, precios: PRECIOS });

prueba("anticipada = sorteo sin publicar y SIN evento; 'fallido' con evento (publicado y cerrado) no lo es", () => {
    const sorteos = [
        { id: "medellin", estado: "fallido", identidad_evento_real: "id-medellin", config: { nombre: "Lotería de Medellín" } },
        { id: "antioq", estado: "programado", identidad_evento_real: "id-antioq", config: { nombre: "Antioqueñita" } },
        { id: "viejo", estado: "publicado", identidad_evento_real: "id-viejo" },
        { id: "borrador", estado: "borrador", identidad_evento_real: "id-borrador" }
    ];
    const eventos = [{ identidad_evento_real: "id-medellin", activo: false, tabla: T, nombre_evento: "Lotería de Medellín", valor: 5000 }];
    assert.deepStrictEqual([...identidadesAnticipadas(sorteos, eventos).keys()].sort(), ["id-antioq", "id-borrador"]);
});

prueba("caso de producción: 100 números del sorteo de Medellín (fallido pero jugado) -> 0 anticipadas", () => {
    const ocupados = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i).padStart(2, "0"), [i < 88 ? "pagado" : "reservado", "id-medellin"]]));
    const r = impacto(cuadricula(ocupados),
        [{ id: "medellin", estado: "fallido", identidad_evento_real: "id-medellin", config: { nombre: "Lotería de Medellín" } }],
        [{ identidad_evento_real: "id-medellin", activo: false, tabla: T }]);
    assert.strictEqual(r.totalAnticipadas, 0);
    assert.deepStrictEqual([r.ocupados, r.porEstado.pagado, r.porEstado.reservado], [100, 88, 12]);
    assert.ok(puedeConfirmar(r, { texto: TEXTO_CONFIRMACION, aceptaAnticipadas: false }), "no exige aceptar anticipadas inexistentes");
});

prueba("resumen: estados, anticipadas por sorteo, sorteos en curso de esta tabla y precios que la comparten", () => {
    const r = impacto(cuadricula({
        "01": ["reservado", "id-antioq"], "02": ["pagado", "id-antioq"], "03": ["reservado", "id-activo"],
        "04": ["pagado", "id-activo"], "05": ["bloqueado"], "06": ["en_proceso"], "07": ["raro"]
    }), [
        { id: "antioq", estado: "programado", identidad_evento_real: "id-antioq", config: { nombre: "Antioqueñita" } }
    ], [
        { identidad_evento_real: "id-activo", activo: true, tabla: T, nombre_evento: "Chontico", valor: "7000" },
        { identidad_evento_real: "id-otra", activo: true, tabla: "reservas_dos_cifras", nombre_evento: "De otra tabla", valor: 1000 }
    ]);
    assert.deepStrictEqual(r.porEstado, { reservado: 2, pagado: 2, bloqueado: 1, en_proceso: 1, otros: 1 });
    assert.strictEqual(r.ocupados, 7);
    assert.deepStrictEqual(r.anticipadas, [{ sorteoId: "antioq", nombre: "Antioqueñita", cantidad: 2, reservados: 1, pagados: 1 }]);
    assert.strictEqual(r.totalAnticipadas, 2);
    assert.deepStrictEqual(r.sorteosActivos, [{ nombre: "Chontico", valor: 7000 }], "solo los sorteos en curso de ESTA tabla física");
    assert.deepStrictEqual(r.preciosCompartidos, [5000, 7000]);
});

prueba("huella: cambia con cualquier número ocupado (estado o sorteo); ignora el orden y los libres", () => {
    const a = cuadricula({ "10": ["reservado", "x"], "20": ["pagado", "y"] });
    const b = [...a].reverse();
    assert.strictEqual(huellaFilas(a), huellaFilas(b));
    assert.notStrictEqual(huellaFilas(a), huellaFilas(cuadricula({ "10": ["pagado", "x"], "20": ["pagado", "y"] })));
    assert.notStrictEqual(huellaFilas(a), huellaFilas(cuadricula({ "10": ["reservado", "x"], "20": ["pagado", "y"], "30": ["reservado", "z"] })));
    assert.notStrictEqual(huellaFilas(a), huellaFilas(cuadricula({ "10": ["reservado", "OTRO"], "20": ["pagado", "y"] })));
});

prueba("confirmación: texto exacto (sin importar mayúsculas/espacios) y, con anticipadas, aceptarlas", () => {
    const sin = impacto(cuadricula({ "01": ["reservado", null] }));
    assert.strictEqual(puedeConfirmar(sin, { texto: "", aceptaAnticipadas: false }), false);
    assert.strictEqual(puedeConfirmar(sin, { texto: "reiniciar la tabla", aceptaAnticipadas: true }), false);
    assert.strictEqual(puedeConfirmar(sin, { texto: "  reiniciar ", aceptaAnticipadas: false }), true);
    const con = impacto(cuadricula({ "01": ["reservado", "id-antioq"] }), [{ id: "antioq", estado: "programado", identidad_evento_real: "id-antioq" }]);
    assert.strictEqual(puedeConfirmar(con, { texto: "REINICIAR", aceptaAnticipadas: false }), false);
    assert.strictEqual(puedeConfirmar(con, { texto: "REINICIAR", aceptaAnticipadas: true }), true);
});

console.log(`\n${total} pruebas OK`);
