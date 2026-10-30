// ==========================================================================
// PRUEBAS (frontend) — estadoEfectivo / estadoVisual con números en proceso
// (components/tablas/estadoVisual.ts, regla de veracidad 30/10/2026).
//
//   - un "en_proceso" con la retención VENCIDA sigue en proceso: nunca se
//     muestra ni se cuenta como Disponible (el backend solo reserva filas
//     con estado 'libre', así que pintarlo libre sería mentir);
//   - lo mismo con la retención vigente, sin fecha o con fecha inválida;
//   - el resto de estados pasa tal cual;
//   - el bucket visual de un en_proceso (vencido o no) es «Reservado».
//
//     node frontend/tests/tablas/estadoEfectivo.test.mjs
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

const V = cargarTs(path.join(FRONT, "components/tablas/estadoVisual.ts"));

let ok = 0;
function prueba(nombre, fn) {
    fn();
    ok++;
    console.log(`✔ ${nombre}`);
}

const HACE_UNA_HORA = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const EN_UNA_HORA = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const fila = (estado, bloqueado_hasta = null) => ({ numero: "07", estado, bloqueado_hasta });

prueba("en_proceso con retención vencida sigue en_proceso (no libre)", () => {
    assert.strictEqual(V.estadoEfectivo(fila("en_proceso", HACE_UNA_HORA)), "en_proceso");
    assert.strictEqual(V.estadoVisualSimplificado(fila("en_proceso", HACE_UNA_HORA)), "reservado");
});

prueba("en_proceso vencido justo ahora tampoco se libera", () => {
    assert.strictEqual(V.estadoEfectivo(fila("en_proceso", new Date().toISOString())), "en_proceso");
});

prueba("en_proceso vigente, sin fecha o con fecha inválida: en_proceso", () => {
    assert.strictEqual(V.estadoEfectivo(fila("en_proceso", EN_UNA_HORA)), "en_proceso");
    assert.strictEqual(V.estadoEfectivo(fila("en_proceso", null)), "en_proceso");
    assert.strictEqual(V.estadoEfectivo(fila("en_proceso", "no-es-fecha")), "en_proceso");
});

prueba("los demás estados pasan tal cual, aunque traigan bloqueado_hasta vencido", () => {
    for (const estado of ["libre", "reservado", "pagado", "bloqueado"]) {
        assert.strictEqual(V.estadoEfectivo(fila(estado, HACE_UNA_HORA)), estado);
    }
});

prueba("conteo de disponibles: un en_proceso vencido no suma como libre", () => {
    const numeros = [fila("libre"), fila("en_proceso", HACE_UNA_HORA), fila("en_proceso", EN_UNA_HORA), fila("reservado")];
    const libres = numeros.map(V.estadoEfectivo).filter(e => e === "libre").length;
    assert.strictEqual(libres, 1);
    assert.deepStrictEqual(numeros.map(V.estadoVisualSimplificado), ["libre", "reservado", "reservado", "reservado"]);
});

prueba("ningún componente compara bloqueado_hasta por su cuenta", () => {
    const dir = path.join(FRONT, "components/tablas");
    const infractores = fs.readdirSync(dir)
        .filter(f => /\.(ts|tsx)$/.test(f) && f !== "estadoVisual.ts" && f !== "types.ts" && f !== "TablaImprimible.tsx")
        .filter(f => /bloqueado_hasta[^\n]*(Date|<=|>=|getTime)/.test(fs.readFileSync(path.join(dir, f), "utf8")));
    assert.deepStrictEqual(infractores, []);
});

console.log(`\n${ok} pruebas OK`);
