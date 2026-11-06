// ==========================================================================
// PRUEBAS (frontend) — Centro de Automatizaciones: reglas puras
// (services/automatizacion/centroAutomatizaciones.ts) y el nuevo estado
// «En pausa» / motivo de omisión de estadoProgramacion.ts. Sin red.
//
//     node frontend/tests/automatizacion/centroAutomatizaciones.test.mjs
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
    // Imports relativos a otros .ts (p. ej. lib/tiempo/colombia, F1-B).
    const requerir = (id) => id.startsWith(".") ? cargarTs(path.resolve(path.dirname(rutaAbs), `${id}.ts`)) : require(id);
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const C = cargarTs(path.join(FRONT, "services/automatizacion/centroAutomatizaciones.ts"));
const E = cargarTs(path.join(FRONT, "services/automatizacion/estadoProgramacion.ts"));

let total = 0;
let fallidas = 0;

function prueba(nombre, fn) {
    total++;
    try {
        fn();
        console.log(`✅ ${nombre}`);
    } catch (err) {
        fallidas++;
        console.log(`❌ ${nombre}\n   ${err.message}`);
    }
}

function config(grupo, extra = {}) {
    return {
        id: `id-${grupo}`, usuario_id: "u1", grupo_id: grupo, activo: true,
        dias_permitidos: {}, mensaje_inicio_dia: { activo: false, hora: "06:00", dias_permitidos: {} },
        mensaje_apertura: { activo: true, categoria: null }, mensaje_cierre: { activo: false, categoria: null },
        stickers: {}, recordatorios: { "60": { activo: true, categoria: "tiempo" }, "10": { activo: false, categoria: null } },
        mensaje_actualizacion: { activo: true, categoria: "movimiento" },
        publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { lunes: true } },
        umbral_reservas: 5, cooldown_minutos: 15,
        creado_en: "2026-11-01T00:00:00.000Z", actualizado_en: "2026-11-06T10:00:00.000Z",
        ...extra
    };
}

// ------------------------------------------------------------ minutos ---

prueba("validarMinutos acepta enteros 1..1439 y rechaza el resto", () => {
    assert.strictEqual(C.validarMinutos("30", []), null);
    assert.strictEqual(C.validarMinutos("1439", []), null);
    assert.ok(C.validarMinutos("0", []));
    assert.ok(C.validarMinutos("1440", []));
    assert.ok(C.validarMinutos("12.5", []));
    assert.ok(C.validarMinutos("abc", []));
    assert.ok(C.validarMinutos("", []));
});

prueba("validarMinutos impide programar dos veces la misma anticipación (salvo la propia fila)", () => {
    assert.match(C.validarMinutos("60", ["60", "30"]), /Ya existe/);
    assert.strictEqual(C.validarMinutos("60", ["60", "30"], "60"), null);
    assert.match(C.validarMinutos("060", ["60"]), /Ya existe/);
});

prueba("listarProgramaciones ordena de mayor a menor y descarta claves no numéricas", () => {
    const lista = C.listarProgramaciones({ "10": { activo: true, categoria: null }, x: { activo: true }, "120": { activo: false, categoria: "urgencia" } });
    assert.deepStrictEqual(lista.map((p) => p.minutos), [120, 10]);
    assert.strictEqual(lista[0].cfg.categoria, "urgencia");
});

prueba("cambiarMinutos conserva activo/categoría y no muta el original", () => {
    const original = { "60": { activo: true, categoria: "tiempo" }, "10": { activo: false, categoria: null } };
    const copia = C.cambiarMinutos(original, "60", "45");
    assert.deepStrictEqual(copia["45"], { activo: true, categoria: "tiempo" });
    assert.strictEqual(copia["60"], undefined);
    assert.ok(original["60"], "el original sigue intacto");
});

prueba("minutosParaDuplicado elige una anticipación libre", () => {
    assert.strictEqual(C.minutosParaDuplicado({ "60": {} }, 60), 30);
    assert.strictEqual(C.minutosParaDuplicado({ "60": {}, "30": {} }, 60), 59);
    assert.strictEqual(C.minutosParaDuplicado({ "1": {} }, 1), 2);
});

// ------------------------------------------------------------- reglas ---

prueba("umbral, espera y hora se validan como los lee el backend", () => {
    assert.strictEqual(C.validarUmbral(1), null);
    assert.ok(C.validarUmbral(0));
    assert.ok(C.validarUmbral(2.5));
    assert.ok(C.validarUmbral(NaN));
    assert.strictEqual(C.validarEspera(0), null);
    assert.ok(C.validarEspera(-1));
    assert.strictEqual(C.validarHora("07:30"), null);
    assert.ok(C.validarHora("24:00"));
    assert.ok(C.validarHora("7:3"));
});

// ---------------------------------------------------------- variables ---

prueba("las variables admitidas son exactamente las que resuelve engine.js", () => {
    const motor = fs.readFileSync(path.join(FRONT, "../backend/automation/engine.js"), "utf8");
    const cuerpo = motor.slice(motor.indexOf("function construirVariablesDesdeEvento"));
    const enMotor = new Set([...cuerpo.slice(0, cuerpo.indexOf("return variables")).matchAll(/variables\.([a-z_]+)\s*=/g)].map((m) => m[1]));
    const enPanel = new Set(C.VARIABLES_AUTOMATIZACION.map((v) => v.nombre));
    assert.deepStrictEqual([...enPanel].sort(), [...enMotor].sort());
});

prueba("validarTextoMensaje rechaza variables desconocidas (el backend no lo enviaría) y vacío", () => {
    assert.strictEqual(C.validarTextoMensaje("🎉 Quedan {disponibles} de {{nombre_evento}}"), null);
    assert.match(C.validarTextoMensaje("Hola {cliente}"), /\{cliente\}/);
    assert.ok(C.validarTextoMensaje("   "));
});

prueba("vistaPreviaMensaje sustituye variables conocidas y conserva emojis y desconocidas", () => {
    const vista = C.vistaPreviaMensaje("⏰ Cierra a las {hora_cierre} · {otra}");
    assert.ok(vista.startsWith("⏰ Cierra a las 22:30"));
    assert.ok(vista.includes("{otra}"));
});

// -------------------------------------------------------------- copia ---

prueba("construirCopia copia solo los bloques elegidos, nunca activo ni identidad", () => {
    const origen = config("A");
    const copia = C.construirCopia(origen, ["recordatorios", "actualizacion"]);
    assert.deepStrictEqual(Object.keys(copia).sort(), ["cooldown_minutos", "mensaje_actualizacion", "recordatorios", "umbral_reservas"]);
    assert.ok(!("activo" in copia) && !("grupo_id" in copia) && !("usuario_id" in copia) && !("id" in copia));
});

prueba("construirCopia es profunda: modificar la copia no altera el origen", () => {
    const origen = config("A");
    const copia = C.construirCopia(origen, ["recordatorios"]);
    copia.recordatorios["60"].activo = false;
    assert.strictEqual(origen.recordatorios["60"].activo, true);
});

prueba("validarCopia: todo o nada si un destino cambió, ya no existe o es el origen", () => {
    const origen = config("A");
    const destinos = [
        { grupo_id: "B", nombre: "B", actualizado_en: "2026-11-06T10:00:00.000Z" },
        { grupo_id: "C", nombre: "C", actualizado_en: "2026-11-06T10:00:00.000Z" }
    ];
    assert.deepStrictEqual(C.validarCopia(origen, destinos, ["recordatorios"], { B: "2026-11-06T10:00:00+00:00", C: "2026-11-06T10:00:00.000+00:00" }), []);
    assert.strictEqual(C.validarCopia(origen, destinos, ["recordatorios"], { B: "2026-11-06T10:00:00Z", C: "2026-11-06T11:00:00Z" }).length, 1);
    assert.strictEqual(C.validarCopia(origen, destinos, ["recordatorios"], { B: "2026-11-06T10:00:00Z" }).length, 1);
    assert.ok(C.validarCopia(origen, [{ grupo_id: "A", nombre: "A", actualizado_en: origen.actualizado_en }], ["recordatorios"], { A: origen.actualizado_en }).length > 0);
    assert.ok(C.validarCopia(origen, destinos, [], {}).length > 0);
});

// ----------------------------------------------------------- guardado ---

prueba("columnasCambiadas devuelve solo lo editado (orden de claves irrelevante)", () => {
    const original = config("A");
    const igual = { ...original, recordatorios: { "10": { categoria: null, activo: false }, "60": { categoria: "tiempo", activo: true } } };
    assert.deepStrictEqual(C.columnasCambiadas(original, igual), {});
    const editado = { ...original, umbral_reservas: 8, recordatorios: { ...original.recordatorios, "30": { activo: true, categoria: null } } };
    assert.deepStrictEqual(Object.keys(C.columnasCambiadas(original, editado)).sort(), ["recordatorios", "umbral_reservas"]);
});

prueba("columnasCambiadas nunca incluye columnas que el editor no administra", () => {
    const original = config("A");
    const otro = { ...original, mensaje_apertura: { activo: false }, stickers: { x: 1 }, grupo_id: "Z" };
    assert.deepStrictEqual(C.columnasCambiadas(original, otro), {});
});

// ---------------------------------------------------------- historial ---

prueba("estadoHistorial distingue enviado, omitido, fallido, en curso y sin confirmar", () => {
    const ahora = new Date("2026-11-06T15:00:00Z");
    assert.strictEqual(C.estadoHistorial({ estado: "ok", detalle: { resultado: { mensajeId: "m" } } }, ahora), "enviado");
    assert.strictEqual(C.estadoHistorial({ estado: "ok", detalle: { resultado: { omitido: true, motivo: "grupo_cerrado" } } }, ahora), "omitido");
    assert.strictEqual(C.estadoHistorial({ estado: "error", detalle: { mensaje: "x" } }, ahora), "fallido");
    assert.strictEqual(C.estadoHistorial({ estado: "en_progreso", ejecutado_en: "2026-11-06T14:59:00Z" }, ahora), "en_curso");
    assert.strictEqual(C.estadoHistorial({ estado: "en_progreso", ejecutado_en: "2026-11-06T14:00:00Z" }, ahora), "sin_confirmar");
});

prueba("motivoHistorial traduce el motivo nuevo de la automatización desactivada", () => {
    assert.match(C.motivoHistorial({ detalle: { resultado: { omitido: true, motivo: "automatizacion_desactivada" } } }), /desactivada/);
    assert.strictEqual(C.motivoHistorial({ detalle: { mensaje: "socket cerrado" } }), "socket cerrado");
    assert.strictEqual(C.motivoHistorial({ detalle: null }), null);
});

prueba("tipoHistorial agrupa los tipo_accion reales del backend", () => {
    assert.strictEqual(C.tipoHistorial("REMINDER_120M"), "recordatorio");
    assert.strictEqual(C.tipoHistorial("CLOSE_MESSAGE"), "cierre");
    assert.strictEqual(C.tipoHistorial("INITIAL_TABLE"), "tabla");
    assert.strictEqual(C.tipoHistorial("SORTEO_RECORDATORIO"), "sorteo");
    assert.strictEqual(C.tipoHistorial("ALGO_NUEVO"), "otro");
});

// ------------------------------------------------------------ filtros ---

prueba("filtrarFilas combina texto (sin acentos), conexión, estado y evento", () => {
    const filas = [
        { nombre: "Sorteos Medellín", grupo_id: "1@g.us", conectado: true, activo: true, conEvento: true },
        { nombre: "Bogotá VIP", grupo_id: "2@g.us", conectado: false, activo: false, conEvento: false },
        { nombre: "Otro", grupo_id: "3@g.us", conectado: null, activo: true, conEvento: false }
    ];
    const base = { texto: "", conexion: "todos", automatizacion: "todos", evento: "todos" };
    assert.strictEqual(C.filtrarFilas(filas, { ...base, texto: "medellin" }).length, 1);
    assert.strictEqual(C.filtrarFilas(filas, { ...base, conexion: "desconectado" }).length, 1, "sin verificar no cuenta como desconectado");
    assert.strictEqual(C.filtrarFilas(filas, { ...base, conexion: "conectado" }).length, 1, "sin verificar no cuenta como conectado");
    assert.strictEqual(C.filtrarFilas(filas, { ...base, automatizacion: "activa" }).length, 2);
    assert.strictEqual(C.filtrarFilas(filas, { ...base, evento: "sin_evento" }).length, 2);
});

// ------------------------------------------- estadoProgramacion (pausa) ---

prueba("con la automatización apagada un recordatorio sin registro sale «En pausa», no «Programado»", () => {
    const cierre = E.calcularCierreReal("2026-11-06", "22:00");
    const r = E.estadoRecordatorio({ offset: 30, activo: true, cierre, cicloAbierto: true, accion: null, ahora: new Date(cierre.getTime() - 3600000), automatizacionActiva: false });
    assert.strictEqual(r.estado, "pausado");
    assert.strictEqual(r.etiqueta, "En pausa");
});

prueba("lo registrado manda: un omitido por automatización desactivada muestra su motivo", () => {
    const cierre = E.calcularCierreReal("2026-11-06", "22:00");
    const r = E.estadoRecordatorio({
        offset: 30, activo: true, cierre, cicloAbierto: true, ahora: new Date(cierre.getTime() - 60000), automatizacionActiva: true,
        accion: { id: "a", event_session_id: "c", tipo_accion: "REMINDER_30M", estado: "ok", ejecutado_en: null, finalizado_en: null, detalle: { resultado: { omitido: true, motivo: "automatizacion_desactivada" } } }
    });
    assert.strictEqual(r.estado, "omitido");
    assert.match(r.motivo, /desactivada/);
});

console.log(`\nTOTAL: ${total}  ✅ PASA: ${total - fallidas}  ❌ FALLA: ${fallidas}`);
if (fallidas > 0) process.exitCode = 1;
