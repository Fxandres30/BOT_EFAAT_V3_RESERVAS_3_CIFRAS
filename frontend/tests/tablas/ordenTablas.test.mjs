// ==========================================================================
// PRUEBAS (frontend) — Reservas: orden de las tarjetas, crear y editar tablas.
//
//   - orden por VALOR numérico ascendente (no por texto: $10.000 después de
//     $2.000), estable y sin perder ni agrupar tablas del mismo precio;
//   - tras editar el valor de una tabla, se reubica en su sitio;
//   - el índice usa ese orden, una tarjeta por tabla (clave tabla_id) y se
//     vuelve a leer al crear o editar; «Nueva tabla» no tiene lista fija de
//     precios y crea por el backend (su propio tabla_id).
//
//     node frontend/tests/tablas/ordenTablas.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));
const leer = (p) => fs.readFileSync(path.join(FRONT, p), "utf8");

function cargarTs(rel) {
    const { outputText } = ts.transpileModule(leer(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const modulo = { exports: {} };
    new Function("require", "module", "exports", outputText)(require, modulo, modulo.exports);
    return modulo.exports;
}
const { ordenarPorPrecio } = cargarTs("services/tablas/resumenTabla.ts");

let ok = 0;
const prueba = (nombre, fn) => { fn(); ok++; console.log(`✔ ${nombre}`); };
const tarjetas = (lista) => lista.map(t => t.id ? `${t.precio}:${t.id}` : t.precio);

prueba("1. orden numérico ascendente (no por texto)", () => {
    const lista = [15000, 2000, 10000, 1000, 5000, 2500, 7000, 1500, 3000, 4000].map(p => ({ precio: p }));
    assert.deepStrictEqual(tarjetas(ordenarPorPrecio(lista)), [1000, 1500, 2000, 2500, 3000, 4000, 5000, 7000, 10000, 15000]);
    // Valores que llegan como texto: «10000» va después de «2000», no antes.
    assert.deepStrictEqual(ordenarPorPrecio([{ precio: "10000" }, { precio: "2000" }, { precio: "500" }]).map(t => t.precio), ["500", "2000", "10000"]);
});

prueba("2-3. tablas del mismo precio: siguen siendo tarjetas distintas, en su orden de creación; ninguna se pierde", () => {
    const lista = [{ precio: 1500, id: "b" }, { precio: 1000, id: "a" }, { precio: 1500, id: "c" }, { precio: 2500, id: "d" }];
    const r = ordenarPorPrecio(lista);
    assert.deepStrictEqual(tarjetas(r), ["1000:a", "1500:b", "1500:c", "2500:d"]);
    assert.strictEqual(r.length, lista.length);
    assert.notStrictEqual(r, lista, "no modifica la lista original");
});

prueba("6. tras editar el valor, la tarjeta se reubica en su posición", () => {
    const lista = [{ precio: 1000, id: "a" }, { precio: 1500, id: "b" }, { precio: 2000, id: "c" }, { precio: 5000, id: "d" }];
    const editada = lista.map(t => (t.id === "b" ? { ...t, precio: 4000 } : t));
    assert.deepStrictEqual(tarjetas(ordenarPorPrecio(editada)), ["1000:a", "2000:c", "4000:b", "5000:d"], "la misma tabla (b) pasa a su nuevo sitio");
});

prueba("índice: ordena por precio antes de pintar, una tarjeta por tabla_id y se relee al crear o editar", () => {
    const indice = leer("components/tablas/IndiceTablas.tsx");
    assert.match(indice, /ordenarPorPrecio\(vistaTablas\.map/);
    assert.ok(!indice.includes("ordenarPorSorteoActivo"), "el orden ya no depende del sorteo activo");
    assert.match(indice, /key=\{tablaId \?\? precio\}/, "clave por tabla: dos del mismo precio no se agrupan");
    assert.match(indice, /addEventListener\(EVENTO_TABLAS_CAMBIADAS/);
});

prueba("crear y editar: sin lista fija de precios, por el backend, con los componentes del proyecto", () => {
    const boton = leer("components/tablas/NuevaTablaBoton.tsx");
    assert.match(boton, /apiRifas\.crearTabla\(precio/);
    assert.ok(!/PRECIOS_VALIDOS|TABLAS_CONFIG/.test(boton), "cualquier valor: no hay lista fija");
    assert.match(boton, /avisarTablasCambiadas\(\)/);
    assert.match(boton, /from "@\/components\/ui"/);
    const editar = leer("components/tablas/EditarValorTablaModal.tsx");
    assert.match(editar, /from "@\/components\/ui"/);
    const hook = leer("hooks/useTablaPrecio.ts");
    assert.match(hook, /apiRifas\.editarPrecio\(rifa\.id, nuevo\)/, "edita la MISMA rifa por su tabla_id");
    assert.ok(!/module\.css/.test(boton + editar), "sin hojas de estilo nuevas");
    const pagina = leer("app/tablas/page.tsx");
    assert.match(pagina, /actions=\{<><NuevaTablaBoton \/><AyudaContextual slug="tablas-de-precio" \/><\/>\}/);
});

console.log(`\n${ok} pruebas OK`);
