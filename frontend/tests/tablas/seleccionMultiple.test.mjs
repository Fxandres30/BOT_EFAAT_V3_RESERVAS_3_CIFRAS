// ==========================================================================
// PRUEBAS (frontend) — FASE UX-05: selección múltiple y acciones rápidas en
// Tablas («Seleccionar»): todos los libres, reservar en lote y la
// protección de los números de otro sorteo.
//
// Lógica REAL del panel (services/tablas/pagoLote.ts, seleccionTabla.ts y
// recargaAgrupada.ts) transpilada. El servidor del lote se prueba aparte, con
// su ruta real: backend/tests/reservas/operacionesLote.test.js.
//
//     node frontend/tests/tablas/seleccionMultiple.test.mjs
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
const S = cargarTs(path.join(FRONT, "services/tablas/seleccionTabla.ts"));
const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

let ok = 0;
async function prueba(nombre, fn) { await fn(); ok++; console.log(`✔ ${nombre}`); }

// 00..09: 00-03 libres, 04 reservado (activo), 05 pagado (activo),
// 06 reservado de OTRO sorteo, 07 bloqueado, 08 en proceso, 09 libre.
const tabla = [
    { numero: "00", estado: "libre" }, { numero: "01", estado: "libre" }, { numero: "02", estado: "libre" }, { numero: "03", estado: "libre" },
    { numero: "04", estado: "reservado" }, { numero: "05", estado: "pagado" }, { numero: "06", estado: "reservado", otroSorteo: true },
    { numero: "07", estado: "bloqueado" }, { numero: "08", estado: "en_proceso" }, { numero: "09", estado: "libre" }
];

await prueba("todos los libres (con ceros iniciales, sin repetir)", () => {
    assert.deepStrictEqual(S.numerosLibres(tabla), ["00", "01", "02", "03", "09"]);
    assert.deepStrictEqual(S.anadirSeleccion(["05", "01"], ["01", "02"]), ["01", "02", "05"], "sin repetir");
});

await prueba("seleccionar un número y varios de distintos estados: cada operación toma solo los suyos", () => {
    const sel = ["00", "04", "05", "06", "07", "08"];
    assert.deepStrictEqual(L.operacionesCompatibles(tabla, ["00"]), { reservar: 1, pagar: 0, liberar: 0, desbloquear: 0 });
    assert.deepStrictEqual(L.operacionesCompatibles(tabla, sel), { reservar: 1, pagar: 2, liberar: 3, desbloquear: 1 }, "cuenta los de otro sorteo para ofrecer la acción");
    const reservar = L.clasificarOperacion(tabla, sel, "reservar");
    assert.deepStrictEqual(reservar.incluidos.map(n => n.numero), ["00"], "solo libres");
    assert.ok(reservar.excluidos.find(x => x.numero === "05").motivo.includes("pagado"));
    assert.ok(reservar.excluidos.find(x => x.numero === "08").motivo.includes("en proceso"));
});

await prueba("números de otro sorteo: fuera del lote salvo que el administrador los incluya", () => {
    const sel = ["04", "06"];
    const porDefecto = L.clasificarOperacion(tabla, sel, "pagar");
    assert.deepStrictEqual(porDefecto.incluidos.map(n => n.numero), ["04"]);
    assert.deepStrictEqual(porDefecto.excluidos, [{ numero: "06", motivo: porDefecto.excluidos[0].motivo, otroSorteo: true }]);
    const incluidos = L.clasificarOperacion(tabla, sel, "liberar", { incluirOtroSorteo: true }).incluidos.map(n => n.numero);
    assert.deepStrictEqual(incluidos, ["04", "06"]);
    // Reservar nunca toca números ocupados, sean de este sorteo o de otro.
    assert.deepStrictEqual(L.clasificarOperacion(tabla, sel, "reservar", { incluirOtroSorteo: true }).incluidos, []);
});

await prueba("«de otro sorteo» se decide por la identidad del sorteo, no por el grupo", () => {
    const activo = { id: "ev-g1", identidad_evento_real: "manizales-30" };
    assert.strictEqual(S.esDeOtroSorteo({ estado: "reservado", identidad_evento_real: "manizales-30", evento_id: "ev-g2" }, activo), false, "mismo sorteo en otro grupo");
    assert.strictEqual(S.esDeOtroSorteo({ estado: "pagado", identidad_evento_real: "bogota-29", evento_id: "ev-x" }, activo), true);
    assert.strictEqual(S.esDeOtroSorteo({ estado: "libre" }, activo), false, "un libre no es de nadie");
    assert.strictEqual(S.esDeOtroSorteo({ estado: "reservado", evento_id: "ev-g1" }, { id: "ev-g1" }), false, "sin identidad: por evento");
    assert.strictEqual(S.esDeOtroSorteo({ estado: "reservado", identidad_evento_real: "x" }, null), true, "sin sorteo activo: decide el administrador");
});

const DATOS = { contactoId: "c1", eventoId: "ev-g1", motivo: "Reserva por llamada o mensaje privado", observaciones: "lote" };

await prueba("reservar varios: UNA sola solicitud con todos los números, el contacto, el sorteo y el motivo", async () => {
    const envios = [];
    const enviar = async (c) => {
        envios.push(c);
        return { ok: true, accion: "reservar", hechos: 2, sinCambio: 0, omitidos: 1, errores: 0, resultados: [
            { numero: "01", estado: "hecho", mensaje: "Reservado." },
            { numero: "02", estado: "omitido", mensaje: "Ya no estaba libre (ahora está reservado): otra operación lo tomó primero. No se tocó." },
            { numero: "09", estado: "hecho", mensaje: "Reservado." }
        ] };
    };
    const r = await L.procesarOperacion({ operacion: "reservar", incluidos: ["01", "02", "09"].map(numero => ({ numero, estado: "libre" })), enviar, datos: DATOS, solicitudLote: "lote-1" });
    assert.strictEqual(envios.length, 1, "no se envía una solicitud por número");
    assert.deepStrictEqual(envios[0].numeros, ["01", "02", "09"]);
    assert.deepStrictEqual([envios[0].accion, envios[0].contactoId, envios[0].eventoId, envios[0].motivo, envios[0].solicitudId], ["reservar", "c1", "ev-g1", DATOS.motivo, "lote-1"]);
    assert.deepStrictEqual([r.hechos, r.omitidos, r.errores], [2, 1, 0]);
    assert.ok(r.resultados[1].mensaje.includes("No se tocó"));
});

await prueba("los números de otro sorteo solo viajan autorizados si el administrador los incluyó", () => {
    const sin = L.cuerpoDelLote("pagar", [{ numero: "04", estado: "reservado" }], {}, "s");
    assert.deepStrictEqual(sin.otrosSorteoAutorizados, []);
    const con = L.cuerpoDelLote("liberar", [{ numero: "04", estado: "reservado" }, { numero: "06", estado: "reservado", otroSorteo: true }], {}, "s");
    assert.deepStrictEqual(con.otrosSorteoAutorizados, ["06"]);
    assert.ok(!("usuarioId" in con) && !("usuario_id" in con), "el cliente sale del token, nunca del cuerpo");
});

await prueba("Realtime: 60 señales seguidas (20 filas + actividad + evento) son UNA recarga", async () => {
    const R = cargarTs(path.join(FRONT, "services/tablas/recargaAgrupada.ts"));
    let recargas = 0;
    const g = R.crearRecargaAgrupada(async () => { recargas++; }, 10);
    for (let i = 0; i < 60; i++) g.senal();
    await new Promise(r => setTimeout(r, 40));
    assert.strictEqual(recargas, 1);
    g.senal();
    await new Promise(r => setTimeout(r, 40));
    assert.strictEqual(recargas, 2, "un cambio posterior sí recarga");
    g.cancelar();
});

await prueba("Realtime: nunca dos recargas a la vez; lo que llega durante una no se pierde", async () => {
    const R = cargarTs(path.join(FRONT, "services/tablas/recargaAgrupada.ts"));
    let enCurso = 0, maximo = 0, recargas = 0;
    const g = R.crearRecargaAgrupada(async () => {
        recargas++; enCurso++; maximo = Math.max(maximo, enCurso);
        await new Promise(r => setTimeout(r, 30));
        enCurso--;
    }, 5);
    g.senal();
    await new Promise(r => setTimeout(r, 15));
    g.senal();
    await new Promise(r => setTimeout(r, 15));
    g.senal();
    await new Promise(r => setTimeout(r, 90));
    assert.strictEqual(maximo, 1);
    assert.strictEqual(recargas, 2, "una más al terminar, por los cambios llegados mientras tanto");
    g.cancelar();
    g.senal();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(recargas, 2, "cancelada al salir de la tabla");
});

await prueba("acciones rápidas del historial sin cambios: reservar sigue en el detalle del número", () => {
    assert.deepStrictEqual(L.accionesRapidas("libre"), ["detalle"]);
    assert.deepStrictEqual(L.accionesRapidas("reservado"), ["pagar", "liberar", "detalle"]);
});

await prueba("interfaz: barra con «Todos los libres», sin rango, «Ver selección», reservar con el formulario de la reserva manual", () => {
    const barra = leer("components/tablas/SeleccionPagos.tsx");
    assert.ok(!barra.includes("Seleccionar un rango") && !barra.includes("anadirRango"), "el selector de rango se retiró");
    for (const t of ["Todos los libres", "Ver selección", "Limpiar", "Terminar", "<ReservaManualForm", "obtenerContextoNumero(precio", "Incluir {plural(otrosSorteo.length"]) assert.ok(barra.includes(t), t);
    assert.match(barra, /onProcesar\("reservar", incluidos, resto, solicitudId\)/);
    assert.ok(!/from\("|\.update\(|\.insert\(/.test(barra), "el componente no escribe en la base");
    const vista = leer("components/tablas/TablaPrecioView.tsx");
    assert.match(vista, /esDeOtroSorteo\(\{ \.\.\.n, estado \}, coincidePrecio \? eventoActivo : null\)/);
    const hook = leer("hooks/useTablaPrecio.ts");
    assert.match(hook, /enviar: \(cuerpo\) => operarLote\(precio, cuerpo\)/, "el lote usa la solicitud única");
    assert.ok(!/for \(const n of incluidos\)/.test(leer("services/tablas/pagoLote.ts")), "sin bucle de solicitudes por número");
});

console.log(`\n${ok} pruebas OK`);
