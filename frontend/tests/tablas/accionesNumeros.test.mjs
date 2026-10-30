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
function servidor(real = {}, fallos = {}) {
    const llamadas = [];
    const estados = { ...Object.fromEntries(tabla.map(n => [n.numero, n.estado])), ...real };
    return {
        llamadas,
        ops: {
            pagar: async (numero, datos) => {
                llamadas.push(["pagar", numero, datos]);
                if (fallos[numero]) return fallos[numero];
                if (estados[numero] === "pagado") return { ok: false, motivo: "no_reservado", estadoActual: "pagado", mensaje: "Este número ya está pagado." };
                if (estados[numero] !== "reservado") return { ok: false, motivo: "no_reservado", estadoActual: estados[numero], mensaje: "El número no está reservado." };
                estados[numero] = "pagado";
                return { ok: true, estado: "pagado" };
            },
            liberar: async (numero, datos) => {
                llamadas.push(["liberar", numero, datos]);
                if (fallos[numero]) return fallos[numero];
                if (estados[numero] === "libre") return { ok: false, motivo: "ya_libre", mensaje: "El número ya está disponible." };
                estados[numero] = "libre";
                return { ok: true, estado: "libre" };
            },
            estadoReal: async (numero) => {
                llamadas.push(["leer", numero]);
                return { ok: true, estado: estados[numero] };
            }
        }
    };
}

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

await prueba("pago en serie: resultado real por número, un fallo no detiene el resto", async () => {
    const s = servidor({ "05": "pagado" }, { "07": { ok: false, motivo: "pago_sin_telefono", mensaje: "Falta el teléfono." } });
    const avance = [];
    const r = await L.procesarOperacion({
        operacion: "pagar",
        incluidos: [{ numero: "01", estado: "reservado" }, { numero: "07", estado: "reservado" }, { numero: "05", estado: "reservado" }],
        ops: s.ops,
        datos: { metodoPago: "Nequi", observaciones: "ref 1" },
        solicitudLote: "L1",
        alAvanzar: (h, t) => avance.push(`${h}/${t}`)
    });
    assert.deepStrictEqual(r.resultados.map(x => [x.numero, x.estado]), [["01", "hecho"], ["07", "error"], ["05", "sin_cambio"]]);
    assert.strictEqual(r.resultados[1].mensaje, "Falta el teléfono.");
    assert.deepStrictEqual([r.hechos, r.sinCambio, r.omitidos, r.errores], [1, 1, 0, 1]);
    assert.deepStrictEqual(avance, ["1/3", "2/3", "3/3"]);
    // El pago no lee antes (el servidor ya lo condiciona) y usa una solicitud por número.
    assert.ok(s.llamadas.every(c => c[0] === "pagar"));
    assert.deepStrictEqual(s.llamadas.map(c => c[2].solicitudId), ["L1:01", "L1:07", "L1:05"]);
    assert.strictEqual(s.llamadas[0][2].metodoPago, "Nequi");
});

await prueba("liberar comprueba el estado real y no toca un número que cambió", async () => {
    // 03 se vio bloqueado pero ahora está reservado: liberarlo borraría una reserva.
    const s = servidor({ "03": "reservado", "01": "libre" });
    const r = await L.procesarOperacion({
        operacion: "desbloquear",
        incluidos: [{ numero: "03", estado: "bloqueado" }],
        ops: s.ops,
        solicitudLote: "L2"
    });
    assert.strictEqual(r.resultados[0].estado, "omitido");
    assert.match(r.resultados[0].mensaje, /reservado/);
    assert.ok(!s.llamadas.some(c => c[0] === "liberar"));

    const r2 = await L.procesarOperacion({
        operacion: "liberar",
        incluidos: [{ numero: "01", estado: "reservado" }, { numero: "02", estado: "pagado" }],
        ops: s.ops,
        datos: { motivo: "Cliente desistió" },
        solicitudLote: "L3"
    });
    assert.deepStrictEqual(r2.resultados.map(x => [x.numero, x.estado]), [["01", "sin_cambio"], ["02", "hecho"]]);
    const liberados = s.llamadas.filter(c => c[0] === "liberar");
    assert.deepStrictEqual(liberados.map(c => c[1]), ["02"]);
    assert.strictEqual(liberados[0][2].motivo, "Cliente desistió");
    assert.strictEqual(liberados[0][2].solicitudId, "L3:02");
});

await prueba("errores reales del servidor y excepciones se informan sin detener el lote", async () => {
    const s = servidor({}, { "01": { ok: false, motivo: "estado_cambio", mensaje: "El número cambió de estado. Recarga y revisa antes de volver a intentarlo." } });
    const ops = { ...s.ops, estadoReal: async (n) => (n === "05" ? { ok: false, mensaje: "Sin conexión con el panel." } : s.ops.estadoReal(n)) };
    const r = await L.procesarOperacion({
        operacion: "liberar",
        incluidos: [{ numero: "01", estado: "reservado" }, { numero: "05", estado: "reservado" }, { numero: "02", estado: "pagado" }],
        ops: { ...ops, liberar: async (n, d) => { if (n === "02") throw new Error("boom"); return s.ops.liberar(n, d); } },
        datos: { motivo: "xyz" },
        solicitudLote: "L4"
    });
    assert.deepStrictEqual(r.resultados.map(x => [x.numero, x.estado, x.mensaje]), [
        ["01", "error", "El número cambió de estado. Recarga y revisa antes de volver a intentarlo."],
        ["05", "error", "Sin conexión con el panel."],
        ["02", "error", "boom"]
    ]);
});

await prueba("los componentes no escriben en Supabase ni llaman a la red por su cuenta", () => {
    for (const f of ["components/tablas/SeleccionPagos.tsx", "components/tablas/AccionesNumero.tsx", "components/tablas/HistorialNumeros.tsx", "services/tablas/pagoLote.ts"]) {
        const src = fs.readFileSync(path.join(FRONT, f), "utf8");
        assert.ok(!/supabase|fetch\(|fetchConSesion/.test(src), `${f} no debe acceder a datos directamente`);
    }
});

console.log(`\n${ok} pruebas OK`);
