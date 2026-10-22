// ==========================================================================
// PRUEBAS (frontend) — Automatización → Programación: estados de los
// recordatorios y cálculos de tiempo (services/automatizacion/
// estadoProgramacion.ts, módulo puro: sin red ni Supabase).
//
// Comprueba que ningún estado se inventa: "Enviado" solo con un registro
// "ok" de automation_actions, sin fecha válida no hay cuenta regresiva, y
// la clave consultada es la misma que escribe backend/automation/
// scheduler.js.
//
//     node frontend/tests/automatizacion/estadoProgramacion.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAIZ = path.resolve(FRONT, "..");
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

// Cierre real: 21/10/2026 14:56 en Colombia = 19:56 UTC.
const CIERRE = E.calcularCierreReal("2026-10-21", "14:56");
const min = (n) => n * 60000;
const antesDelCierre = (m) => new Date(CIERRE.getTime() - min(m));

function accion(estado, extra = {}) {
    return {
        id: "a1",
        event_session_id: "ciclo-1",
        tipo_accion: "REMINDER_30M",
        clave_idempotencia: "ciclo-1:REMINDER_30M",
        estado,
        ejecutado_en: "2026-10-21T19:26:05.000Z",
        finalizado_en: "2026-10-21T19:26:07.000Z",
        detalle: {},
        ...extra
    };
}

function entrada(extra = {}) {
    return { offset: 30, activo: true, cierre: CIERRE, cicloAbierto: true, accion: null, ahora: antesDelCierre(90), ...extra };
}

// ------------------------------------------------------------- tiempo ---

prueba("cierre real: fecha + hora de Colombia → instante UTC correcto", () => {
    assert.strictEqual(CIERRE.toISOString(), "2026-10-21T19:56:00.000Z");
    assert.strictEqual(E.calcularCierreReal("2026-10-21T00:00:00", "7:05").toISOString(), "2026-10-21T12:05:00.000Z");
});

prueba("cierre real: sin fecha, sin hora o con valores inválidos → null (sin cuenta regresiva)", () => {
    assert.strictEqual(E.calcularCierreReal(null, "14:56"), null);
    assert.strictEqual(E.calcularCierreReal("2026-10-21", null), null);
    assert.strictEqual(E.calcularCierreReal("21/10/2026", "14:56"), null);
    assert.strictEqual(E.calcularCierreReal("2026-10-21", "25:00"), null);
    assert.strictEqual(E.calcularCierreReal("2026-10-21", "2:56 PM"), null);
});

prueba("formatearRestante: días, horas, minutos, segundos; nunca negativo", () => {
    assert.strictEqual(E.formatearRestante(45000), "45 s");
    assert.strictEqual(E.formatearRestante(min(12) + 30000), "12 min 30 s");
    assert.strictEqual(E.formatearRestante(min(125)), "2 h 05 min");
    assert.strictEqual(E.formatearRestante(min(60 * 26)), "1 d 2 h");
    assert.strictEqual(E.formatearRestante(-5000), "0 s");
});

prueba("formatearMomento: hoy / mañana / ayer / fecha, en hora de Colombia", () => {
    const ahora = new Date("2026-10-21T15:00:00.000Z"); // 10:00 a. m. en Colombia
    assert.match(E.formatearMomento(CIERRE, ahora), /^hoy 2:56/);
    assert.match(E.formatearMomento(new Date("2026-10-22T14:00:00Z"), ahora), /^mañana 9:00/);
    assert.match(E.formatearMomento(new Date("2026-10-20T20:00:00Z"), ahora), /^ayer 3:00/);
    assert.match(E.formatearMomento(new Date("2026-10-25T20:00:00Z"), ahora), /^25\/10 3:00/);
    // 02:00 UTC del 22 todavía es el 21 en Colombia.
    assert.match(E.formatearMomento(new Date("2026-10-22T02:00:00Z"), ahora), /^hoy 9:00/);
});

prueba("formatearHace", () => {
    const ahora = new Date("2026-10-21T20:00:00Z");
    assert.strictEqual(E.formatearHace(new Date("2026-10-21T19:59:30Z"), ahora), "hace un momento");
    assert.strictEqual(E.formatearHace(new Date("2026-10-21T19:56:20Z"), ahora), "hace 3 min");
    assert.strictEqual(E.formatearHace(new Date("2026-10-21T17:55:00Z"), ahora), "hace 2 h 05 min");
});

// --------------------------------------------------------- recordatorios ---

prueba("clave de recordatorio = la que escribe scheduler.js", () => {
    const fuente = fs.readFileSync(path.join(RAIZ, "backend/automation/scheduler.js"), "utf8");
    assert.ok(fuente.includes("const tipoAccion = `REMINDER_${offset}M`;"));
    assert.ok(fuente.includes("const claveIdempotencia = `${eventSession.id}:${tipoAccion}`;"));
    assert.strictEqual(E.claveRecordatorio("ciclo-1", 60), "ciclo-1:REMINDER_60M");
});

prueba("programado: falta más de 5 min para su hora, con cuenta regresiva", () => {
    const r = E.estadoRecordatorio(entrada({ ahora: antesDelCierre(90) }));
    assert.strictEqual(r.estado, "programado");
    assert.strictEqual(r.restanteMs, min(60));
    assert.strictEqual(r.momento.toISOString(), "2026-10-21T19:26:00.000Z");
});

prueba("próximo a enviarse: faltan 5 min o menos", () => {
    const r = E.estadoRecordatorio(entrada({ ahora: antesDelCierre(33) }));
    assert.strictEqual(r.estado, "proximo");
    assert.strictEqual(r.restanteMs, min(3));
});

prueba("pasada su hora sin registro: primero «enviándose», luego «sin registro» (nunca «enviado»)", () => {
    assert.strictEqual(E.estadoRecordatorio(entrada({ ahora: antesDelCierre(29) })).estado, "pendiente");
    const r = E.estadoRecordatorio(entrada({ ahora: antesDelCierre(20) }));
    assert.strictEqual(r.estado, "sin_registro");
    assert.strictEqual(r.restanteMs, null);
    assert.ok(r.motivo);
});

prueba("cerrado sin registro → «No enviado»", () => {
    const r = E.estadoRecordatorio(entrada({ ahora: new Date(CIERRE.getTime() + 1000) }));
    assert.strictEqual(r.estado, "no_enviado");
});

prueba("enviado SOLO con registro ok; aclara que no confirma entrega", () => {
    const r = E.estadoRecordatorio(entrada({ accion: accion("ok", { detalle: { resultado: { mensajeId: "m1" } } }) }));
    assert.strictEqual(r.estado, "enviado");
    assert.strictEqual(r.registradoEn.toISOString(), "2026-10-21T19:26:07.000Z");
    assert.match(r.motivo, /no confirma la entrega/);
});

prueba("omitido: registro ok con resultado.omitido, motivo sencillo", () => {
    const r = E.estadoRecordatorio(entrada({ accion: accion("ok", { detalle: { resultado: { omitido: true, motivo: "grupo_cerrado" } } }) }));
    assert.strictEqual(r.estado, "omitido");
    assert.match(r.motivo, /grupo ya estaba cerrado/);
    assert.strictEqual(r.detalleTecnico, "grupo_cerrado");
    const desconocido = E.estadoRecordatorio(entrada({ accion: accion("ok", { detalle: { resultado: { omitido: true, motivo: "otro" } } }) }));
    assert.match(desconocido.motivo, /estado del sorteo/);
});

prueba("los motivos de omisión conocidos existen en eventRules.js", () => {
    const fuente = fs.readFileSync(path.join(RAIZ, "backend/automation/eventRules.js"), "utf8");
    for (const codigo of ["grupo_cerrado", "sin_disponibles", "sin_disponibles_ni_pendientes"]) {
        assert.ok(fuente.includes(`"${codigo}"`), codigo);
    }
});

prueba("error: motivo sencillo para el cliente, texto técnico aparte", () => {
    const r = E.estadoRecordatorio(entrada({ accion: accion("error", { detalle: { mensaje: "Connection Closed" } }) }));
    assert.strictEqual(r.estado, "error");
    assert.strictEqual(r.motivo, "No se pudo enviar el mensaje.");
    assert.strictEqual(r.detalleTecnico, "Connection Closed");
});

prueba("en curso: «enviándose»; más de 5 min sin terminar → «sin confirmar»", () => {
    const enCurso = accion("en_progreso", { finalizado_en: null, ejecutado_en: "2026-10-21T19:26:00.000Z" });
    assert.strictEqual(E.estadoRecordatorio(entrada({ accion: enCurso, ahora: new Date("2026-10-21T19:27:00Z") })).estado, "enviando");
    assert.strictEqual(E.estadoRecordatorio(entrada({ accion: enCurso, ahora: new Date("2026-10-21T19:32:00Z") })).estado, "sin_confirmar");
});

prueba("el registro manda aunque el recordatorio se haya desactivado después", () => {
    const r = E.estadoRecordatorio(entrada({ activo: false, accion: accion("ok") }));
    assert.strictEqual(r.estado, "enviado");
});

prueba("desactivado, sin evento y sin hora: sin cuenta regresiva", () => {
    for (const [extra, estado] of [
        [{ activo: false }, "desactivado"],
        [{ cicloAbierto: false }, "sin_evento"],
        [{ cierre: null }, "sin_hora"]
    ]) {
        const r = E.estadoRecordatorio(entrada(extra));
        assert.strictEqual(r.estado, estado);
        assert.strictEqual(r.restanteMs, null);
    }
});

// --------------------------------------------------------------- resumen ---

prueba("resumen: próximo = el pendiente más cercano; último envío ignora omitidos y errores", () => {
    const ahora = antesDelCierre(45);
    const recordatorios = [60, 30, 10].map((offset) => E.estadoRecordatorio(entrada({ offset, ahora })));
    const acciones = [
        accion("ok", { tipo_accion: "REMINDER_60M", finalizado_en: "2026-10-21T18:56:05Z" }),
        accion("ok", { tipo_accion: "UPDATE_MESSAGE", finalizado_en: "2026-10-21T19:05:00Z", detalle: { resultado: { omitido: true } } }),
        accion("error", { tipo_accion: "INITIAL_TABLE", finalizado_en: "2026-10-21T19:10:00Z" })
    ];
    const { proximo, ultimoEnviado } = E.resumirEnvios(recordatorios, acciones);
    assert.strictEqual(proximo.offset, 30);
    assert.strictEqual(proximo.restanteMs, min(15));
    assert.strictEqual(ultimoEnviado.tipo, "Recordatorio 60 min antes");
    assert.strictEqual(ultimoEnviado.en.toISOString(), "2026-10-21T18:56:05.000Z");
    assert.deepStrictEqual(E.resumirEnvios([], []), { proximo: null, ultimoEnviado: null });
});

prueba("nombreAccion traduce los tipos reales del backend", () => {
    assert.strictEqual(E.nombreAccion("REMINDER_10M"), "Recordatorio 10 min antes");
    assert.strictEqual(E.nombreAccion("CLOSE_MESSAGE"), "Mensaje de cierre");
    assert.strictEqual(E.nombreAccion("INITIAL_TABLE"), "Tabla inicial");
});

// ------------------------------------------------------- grupo y conexión ---

prueba("nombre del grupo: primer nombre real; nunca el identificador @g.us", () => {
    assert.strictEqual(E.resolverNombreGrupo(null, "  Rifas Diarias ", "Otro"), "Rifas Diarias");
    assert.strictEqual(E.resolverNombreGrupo("Vivo", "Viejo"), "Vivo");
    assert.strictEqual(E.resolverNombreGrupo("120363421290339105@g.us", ""), "Grupo sin nombre disponible");
    assert.strictEqual(E.resolverNombreGrupo(), "Grupo sin nombre disponible");
});

prueba("conexión: solo una sesión que respondió con el grupo prueba «conectado»", () => {
    const g = "G1@g.us";
    assert.strictEqual(E.conexionDeGrupo(g, null), "no_verificable");
    assert.strictEqual(E.conexionDeGrupo(g, [{ estado: "conectada", grupos: [{ id: g, nombre: "x" }] }]), "conectado");
    assert.strictEqual(E.conexionDeGrupo(g, [{ estado: "conectada", grupos: [] }]), "no_visto");
    assert.strictEqual(E.conexionDeGrupo(g, [{ estado: "no_verificable", grupos: [] }, { estado: "desconectada", grupos: [] }]), "no_verificable");
    assert.strictEqual(E.conexionDeGrupo(g, [{ estado: "desconectada", grupos: [] }]), "sin_sesion");
    assert.strictEqual(E.conexionDeGrupo(g, []), "sin_sesion");
});

prueba("frescura de los datos", () => {
    const ahora = new Date("2026-10-21T20:00:00Z");
    assert.strictEqual(E.frescuraDatos(new Date("2026-10-21T19:59:00Z"), false, ahora), "al_dia");
    assert.strictEqual(E.frescuraDatos(new Date("2026-10-21T19:56:00Z"), false, ahora), "desactualizado");
    assert.strictEqual(E.frescuraDatos(new Date("2026-10-21T19:59:00Z"), true, ahora), "sin_respuesta");
    assert.strictEqual(E.frescuraDatos(null, false, ahora), "sin_respuesta");
});

// ------------------------------------------------- seguridad (estática) ---

prueba("seguimiento: solo lectura, filtrado por el usuario de la sesión, sin endpoints", () => {
    const fuente = fs.readFileSync(path.join(FRONT, "services/automatizacion/seguimientoProgramacion.ts"), "utf8");
    assert.ok(!/\.(insert|update|upsert|delete)\(/.test(fuente), "no escribe");
    assert.ok(!/fetch\(|fetchConSesion/.test(fuente), "no llama endpoints");
    for (const tabla of ["eventos_bot", "event_sessions", "automation_actions", "sesiones"]) {
        const bloques = fuente.split(`.from("${tabla}")`).slice(1);
        assert.ok(bloques.length > 0, tabla);
        for (const b of bloques) assert.ok(b.slice(0, 400).includes('.eq("usuario_id", usuarioId)'), `${tabla} filtra por usuario`);
    }
    const pagina = fs.readFileSync(path.join(FRONT, "components/automatizacion/ProgramacionAutomatizacion/ProgramacionAutomatizacion.tsx"), "utf8");
    assert.ok(pagina.includes("data.user?.id"), "el usuario sale de la sesión");
});

console.log(`\nTOTAL: ${total}  ✅ PASA: ${total - fallidas}  ❌ FALLA: ${fallidas}`);
process.exit(fallidas ? 1 : 0);
