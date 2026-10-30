// ==========================================================================
// PRUEBAS (frontend) — acciones rápidas por número y operaciones por lote
// de Tablas (services/tablas/pagoLote.ts, módulo puro: sin red ni Supabase).
//
//   - qué acciones admite cada estado (libre nunca pasa a pagado; en proceso
//     solo abre el detalle);
//   - clasificación de una selección mixta por operación, con el porqué;
//   - pago en serie con el resultado real de cada número (un fallo no
//     detiene el resto; reintento idempotente = sin cambios);
//   - liberar/desbloquear comprueban el estado real antes de enviar y NO
//     tocan un número que cambió entretanto;
//   - anular un pago exige motivo; el componente no escribe en Supabase.
//
//     node frontend/tests/tablas/accionesNumeros.test.mjs
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

const L = cargarTs(path.join(FRONT, "services/tablas/pagoLote.ts"));

let ok = 0;
async function prueba(nombre, fn) {
    await fn();
    ok++;
    console.log(`✔ ${nombre}`);
}

const tabla = [
    { numero: "00", estado: "libre" },
    { numero: "01", estado: "reservado" },
    { numero: "02", estado: "pagado" },
    { numero: "03", estado: "bloqueado" },
    { numero: "04", estado: "en_proceso" },
    { numero: "05", estado: "reservado" }
];

// Servidor simulado: registra cada llamada; el estado real puede diferir
// del que vio la pantalla.
await prueba("acciones por estado: libre nunca pagado, en proceso solo detalle", () => {
    assert.deepStrictEqual(L.accionesRapidas("reservado"), ["pagar", "liberar", "detalle"]);
    assert.deepStrictEqual(L.accionesRapidas("pagado"), ["liberar", "detalle"]);
    assert.deepStrictEqual(L.accionesRapidas("libre"), ["detalle"]);
    assert.deepStrictEqual(L.accionesRapidas("bloqueado"), ["desbloquear", "detalle"]);
    assert.deepStrictEqual(L.accionesRapidas("en_proceso"), ["detalle"]);
});

await prueba("selección mixta: cada operación incluye solo sus estados", () => {
    const sel = ["05", "00", "01", "02", "03", "04", "99", "01"];
    const pagar = L.clasificarOperacion(tabla, sel, "pagar");
    assert.deepStrictEqual(pagar.incluidos.map(n => n.numero), ["01", "05"]);
    assert.deepStrictEqual(pagar.excluidos.map(n => n.numero), ["00", "02", "03", "04", "99"]);
    assert.ok(pagar.excluidos.every(x => x.motivo.length > 0));

    const liberar = L.clasificarOperacion(tabla, sel, "liberar");
    assert.deepStrictEqual(liberar.incluidos, [{ numero: "01", estado: "reservado" }, { numero: "02", estado: "pagado" }, { numero: "05", estado: "reservado" }]);

    assert.deepStrictEqual(L.clasificarOperacion(tabla, sel, "desbloquear").incluidos.map(n => n.numero), ["03"]);
    // UX-05: la barra también ofrece «Reservar» para los libres (00).
    assert.deepStrictEqual(L.operacionesCompatibles(tabla, sel), { reservar: 1, pagar: 2, liberar: 3, desbloquear: 1 });
    assert.deepStrictEqual(L.operacionesCompatibles(tabla, ["00", "04"]), { reservar: 1, pagar: 0, liberar: 0, desbloquear: 0 });
    assert.deepStrictEqual(L.operacionesCompatibles(tabla, ["04"]), { reservar: 0, pagar: 0, liberar: 0, desbloquear: 0 });
});

await prueba("anular un pago exige motivo; liberar solo reservas, no", () => {
    assert.strictEqual(L.exigeMotivo("liberar", [{ numero: "02", estado: "pagado" }]), true);
    assert.strictEqual(L.exigeMotivo("liberar", [{ numero: "01", estado: "reservado" }]), false);
    assert.strictEqual(L.exigeMotivo("pagar", [{ numero: "01", estado: "reservado" }]), false);
});

// El lote va en UNA solicitud: el servidor (operarLote) responde cada número.
const servidorLote = (respuesta) => {
    const envios = [];
    return { envios, enviar: async (cuerpo) => { envios.push(cuerpo); return respuesta; } };
};
const lote = (resultados) => ({
    ok: true, accion: "pagar", resultados,
    hechos: resultados.filter(x => x.estado === "hecho").length, sinCambio: 0, omitidos: 0, errores: 0
});

await prueba("pagar varios: UNA solicitud con todos los números; resultado real por número", async () => {
    const s = servidorLote(lote([
        { numero: "01", estado: "hecho", mensaje: "Pago registrado." },
        { numero: "05", estado: "sin_cambio", mensaje: "Ya estaba pagado." },
        { numero: "07", estado: "error", mensaje: "Falta el teléfono.", codigo: "pago_sin_telefono" }
    ]));
    const r = await L.procesarOperacion({
        operacion: "pagar",
        incluidos: [{ numero: "01", estado: "reservado" }, { numero: "07", estado: "reservado" }, { numero: "05", estado: "reservado" }],
        enviar: s.enviar,
        datos: { metodoPago: "Nequi", observaciones: "ref 1" },
        solicitudLote: "L1"
    });
    assert.strictEqual(s.envios.length, 1, "una sola solicitud");
    assert.deepStrictEqual(s.envios[0].numeros, ["01", "07", "05"]);
    assert.deepStrictEqual([s.envios[0].accion, s.envios[0].metodoPago, s.envios[0].observaciones, s.envios[0].solicitudId], ["pagar", "Nequi", "ref 1", "L1"]);
    assert.deepStrictEqual(r.resultados.map(x => [x.numero, x.estado]), [["01", "hecho"], ["05", "sin_cambio"], ["07", "error"]]);
    assert.deepStrictEqual([r.hechos, r.sinCambio, r.omitidos, r.errores], [1, 1, 0, 1]);
});

await prueba("liberar y desbloquear: una solicitud con el estado confirmado de cada número", async () => {
    const s = servidorLote(lote([{ numero: "03", estado: "omitido", mensaje: "Cambió de estado (ahora está reservado). No se tocó: revísalo antes." }]));
    const r = await L.procesarOperacion({ operacion: "desbloquear", incluidos: [{ numero: "03", estado: "bloqueado" }], enviar: s.enviar, solicitudLote: "L2" });
    assert.strictEqual(r.resultados[0].estado, "omitido");
    assert.deepStrictEqual([s.envios[0].accion, s.envios[0].confirmar], ["liberar", true], "desbloquear usa la liberación del servidor");
    assert.deepStrictEqual(s.envios[0].numeros, [{ numero: "03", estado: "bloqueado" }]);

    const s2 = servidorLote(lote([]));
    await L.procesarOperacion({ operacion: "liberar", incluidos: [{ numero: "01", estado: "reservado" }, { numero: "02", estado: "pagado" }], enviar: s2.enviar, datos: { motivo: "Cliente desistió" }, solicitudLote: "L3" });
    assert.strictEqual(s2.envios.length, 1);
    assert.strictEqual(s2.envios[0].motivo, "Cliente desistió");
});

await prueba("un rechazo general o un fallo de red se informa en todos los números", async () => {
    const s = servidorLote({ ok: false, motivo: "backend_no_disponible", mensaje: "No se pudo contactar al servidor." });
    const r = await L.procesarOperacion({ operacion: "liberar", incluidos: [{ numero: "01", estado: "reservado" }, { numero: "02", estado: "pagado" }], enviar: s.enviar, datos: { motivo: "xyz" }, solicitudLote: "L4" });
    assert.deepStrictEqual(r.resultados.map(x => [x.numero, x.estado, x.mensaje]), [
        ["01", "error", "No se pudo contactar al servidor."],
        ["02", "error", "No se pudo contactar al servidor."]
    ]);
    assert.strictEqual(r.errores, 2);
});

await prueba("los componentes no escriben en Supabase ni llaman a la red por su cuenta", () => {
    for (const f of ["components/tablas/SeleccionPagos.tsx", "components/tablas/AccionesNumero.tsx", "components/tablas/HistorialNumeros.tsx", "services/tablas/pagoLote.ts"]) {
        const src = fs.readFileSync(path.join(FRONT, f), "utf8");
        assert.ok(!/supabase|fetch\(|fetchConSesion/.test(src), `${f} no debe acceder a datos directamente`);
    }
});

console.log(`\n${ok} pruebas OK`);
