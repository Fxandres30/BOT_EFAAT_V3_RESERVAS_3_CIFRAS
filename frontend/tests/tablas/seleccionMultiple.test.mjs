// ==========================================================================
// PRUEBAS (frontend) — FASE UX-05: selección múltiple y acciones rápidas en
// Tablas («Seleccionar»): todos los libres, rangos, reservar en lote y la
// protección de los números de otro sorteo.
//
// Lógica REAL del panel (services/tablas/pagoLote.ts y seleccionTabla.ts)
// transpilada; la reserva de cada número se simula con las respuestas
// reales del servidor (backend/services/reservaManual.js): ok, idempotente,
// no_disponible (otro la tomó antes) y rechazos generales.
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

await prueba("todos los libres y rangos (con ceros iniciales, en cualquier orden)", () => {
    assert.deepStrictEqual(S.numerosLibres(tabla), ["00", "01", "02", "03", "09"]);
    assert.deepStrictEqual(S.numerosEnRango(tabla, "2", "05"), { ok: true, numeros: ["02", "03", "04", "05"] });
    assert.deepStrictEqual(S.numerosEnRango(tabla, "07", "06"), { ok: true, numeros: ["06", "07"] }, "orden invertido");
    assert.strictEqual(S.numerosEnRango(tabla, "a", "3").ok, false);
    assert.strictEqual(S.numerosEnRango(tabla, "0", "15").ok, false, "fuera de la tabla");
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

// Servidor simulado: cada número se reserva solo si sigue libre (como el
// UPDATE condicionado del bot); `tomados` = los que otro reservó antes.
function servidor({ tomados = new Set(), rechazoGeneral = null, yaMios = new Set() } = {}) {
    const llamadas = [];
    return {
        llamadas,
        ops: {
            reservar: async (numero, datos) => {
                llamadas.push({ numero, datos });
                if (rechazoGeneral) return { ok: false, motivo: rechazoGeneral, mensaje: "El sorteo ya no acepta reservas (cerrado o pasó la hora de cierre)." };
                if (yaMios.has(numero)) return { ok: true, estado: "reservado", idempotente: true };
                if (tomados.has(numero)) return { ok: false, motivo: "no_disponible", mensaje: "Otra operación reservó el número primero.", estadoActual: "reservado" };
                return { ok: true, estado: "reservado" };
            },
            pagar: async () => ({ ok: true, estado: "pagado" }),
            liberar: async () => ({ ok: true, estado: "libre" }),
            estadoReal: async () => ({ ok: true, estado: "reservado" })
        }
    };
}

const DATOS = { contactoId: "c1", eventoId: "ev-g1", motivo: "Reserva por llamada o mensaje privado", observaciones: "lote" };

await prueba("reservar uno y varios: misma ruta de un número, en serie, mismos datos y una solicitud por número", async () => {
    const srv = servidor();
    const avance = [];
    const r = await L.procesarOperacion({ operacion: "reservar", incluidos: [{ numero: "01", estado: "libre" }, { numero: "02", estado: "libre" }, { numero: "09", estado: "libre" }], ops: srv.ops, datos: DATOS, solicitudLote: "lote-1", alAvanzar: (h, t) => avance.push(`${h}/${t}`) });
    assert.deepStrictEqual([r.hechos, r.omitidos, r.errores], [3, 0, 0]);
    assert.deepStrictEqual(srv.llamadas.map(l => l.numero), ["01", "02", "09"], "en orden y uno a uno");
    assert.deepStrictEqual(srv.llamadas.map(l => l.datos.solicitudId), ["lote-1:01", "lote-1:02", "lote-1:09"]);
    assert.ok(srv.llamadas.every(l => l.datos.contactoId === "c1" && l.datos.eventoId === "ev-g1" && l.datos.motivo === DATOS.motivo));
    assert.deepStrictEqual(avance, ["1/3", "2/3", "3/3"]);
    const uno = await L.procesarOperacion({ operacion: "reservar", incluidos: [{ numero: "00", estado: "libre" }], ops: servidor().ops, datos: DATOS, solicitudLote: "lote-2" });
    assert.strictEqual(uno.hechos, 1);
});

await prueba("concurrencia: si otro tomó un número entre la selección y la reserva, se informa y los demás siguen", async () => {
    const srv = servidor({ tomados: new Set(["02"]) });
    const r = await L.procesarOperacion({ operacion: "reservar", incluidos: ["01", "02", "03"].map(numero => ({ numero, estado: "libre" })), ops: srv.ops, datos: DATOS, solicitudLote: "lote-3" });
    assert.deepStrictEqual(r.resultados.map(x => [x.numero, x.estado]), [["01", "hecho"], ["02", "omitido"], ["03", "hecho"]]);
    assert.ok(r.resultados[1].mensaje.includes("ahora está reservado") && r.resultados[1].mensaje.includes("No se tocó"));
});

await prueba("reintento del mismo lote: lo ya reservado vuelve como «sin cambios» (no se duplica)", async () => {
    const srv = servidor({ yaMios: new Set(["01"]) });
    const r = await L.procesarOperacion({ operacion: "reservar", incluidos: [{ numero: "01", estado: "libre" }, { numero: "03", estado: "libre" }], ops: srv.ops, datos: DATOS, solicitudLote: "lote-3" });
    assert.deepStrictEqual(r.resultados.map(x => x.estado), ["sin_cambio", "hecho"]);
});

await prueba("rechazo general (sorteo cerrado): se detiene sin repetir el mismo error en cada número", async () => {
    const srv = servidor({ rechazoGeneral: "sorteo_cerrado" });
    const r = await L.procesarOperacion({ operacion: "reservar", incluidos: ["01", "02", "03"].map(numero => ({ numero, estado: "libre" })), ops: srv.ops, datos: DATOS, solicitudLote: "lote-4" });
    assert.strictEqual(srv.llamadas.length, 1, "un solo intento");
    assert.deepStrictEqual(r.resultados.map(x => x.estado), ["error", "omitido", "omitido"]);
    assert.ok(r.resultados[1].mensaje.startsWith("No se intentó: El sorteo ya no acepta reservas"));
    assert.strictEqual(L.rechazoGeneral("no_disponible"), false);
    assert.strictEqual(L.rechazoGeneral("red"), false, "un fallo de red no detiene el lote");
    assert.strictEqual(L.rechazoGeneral("falta_contacto"), true);
});

await prueba("acciones rápidas del historial sin cambios: reservar sigue en el detalle del número", () => {
    assert.deepStrictEqual(L.accionesRapidas("libre"), ["detalle"]);
    assert.deepStrictEqual(L.accionesRapidas("reservado"), ["pagar", "liberar", "detalle"]);
});

await prueba("interfaz: barra con «Todos los libres», rango, «Ver selección», reservar con el formulario de la reserva manual", () => {
    const barra = leer("components/tablas/SeleccionPagos.tsx");
    for (const t of ["Todos los libres", "aria-label=\"Seleccionar un rango\"", "Ver selección", "Limpiar", "Terminar", "<ReservaManualForm", "obtenerContextoNumero(precio", "Incluir {plural(otrosSorteo.length"]) assert.ok(barra.includes(t), t);
    assert.match(barra, /onProcesar\("reservar", incluidos, resto, solicitudId/);
    assert.ok(!/from\("|\.update\(|\.insert\(/.test(barra), "el componente no escribe en la base");
    const vista = leer("components/tablas/TablaPrecioView.tsx");
    assert.match(vista, /esDeOtroSorteo\(\{ \.\.\.n, estado \}, eventoActivo\)/);
    assert.match(leer("hooks/useTablaPrecio.ts"), /reservar: \(numero, d\) => reservarNumeroManual\(precio, numero, d\)/);
});

console.log(`\n${ok} pruebas OK`);
