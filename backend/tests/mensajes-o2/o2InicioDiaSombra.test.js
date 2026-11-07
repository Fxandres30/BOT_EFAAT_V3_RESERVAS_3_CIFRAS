// ==========================================================================
// FASE O2 — Inicio del día con el orquestador en MODO SOMBRA.
//
// Reales: scheduler.tick → evaluarInicioDiaPorGrupo (con la llamada en
// sombra), automation/sombraInicioDia.js, shared/mensajes, executionGuard,
// shared/variables y send.js con socket simulado. Simulados: Supabase
// (fakeSupabaseAutomation) y el repositorio de plantillas (misma consulta).
//
// Comprueba: el envío actual no cambia; la sombra compara (coincidencias y
// diferencias), no tiene efectos, no rompe nada si falla, aísla clientes,
// no duplica y no usa IA ni imágenes.
//
//     node backend/tests/mensajes-o2/o2InicioDiaSombra.test.js
// ==========================================================================

"use strict";

process.env.GROUP_QUEUE_DELAY_MS = "0";
delete process.env.MENSAJES_ORQUESTADOR_INICIO_DIA;

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (ruta, exp) => { require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exp }; };

// IA e imágenes: si algo las tocara, quedaría registrado aquí.
const prohibido = { ia: 0, chromium: 0 };
inyectar(r("bot/ai/aiService.js"), { suggestReply: async () => { prohibido.ia++; return {}; } });
inyectar(require.resolve("puppeteer", { paths: [RAIZ] }), { launch: async () => { prohibido.chromium++; throw new Error("Chromium prohibido"); } });

// Repositorio de plantillas: misma consulta que el real; cada lectura queda
// registrada y se puede alterar la N-ésima (para provocar diferencias).
const plantillas = [];
const lecturas = [];
let alterarLectura = null; // (numeroDeLectura, filas) => filas | throw
inyectar(r("automation/repo/plantillasMensaje.js"), {
    obtenerPlantillasHabilitadas: async (usuarioId, tipo) => {
        lecturas.push({ usuarioId, tipo });
        const filas = plantillas.filter(p => p.usuario_id === usuarioId && p.tipo_respuesta === tipo && p.habilitada).map(p => ({ ...p }));
        return alterarLectura ? alterarLectura(lecturas.length, filas) : filas;
    }
});

const { crearEntorno, acelerarTimers, restaurarTimers } = require("../scheduler/entornoFake");

const A = "usuario-A";
const B = "usuario-B";
const G1 = "573001112233-1111@g.us";
const G2 = "573009998877-2222@g.us";
const LUNES_8AM = new Date("2026-11-09T13:00:00Z");

let ent;

function escenario({ modo = "shadow" } = {}) {
    if (modo) process.env.MENSAJES_ORQUESTADOR_INICIO_DIA = modo; else delete process.env.MENSAJES_ORQUESTADOR_INICIO_DIA;
    ent = crearEntorno();
    plantillas.length = 0;
    lecturas.length = 0;
    alterarLectura = null;
    prohibido.ia = 0; prohibido.chromium = 0;
    const fs = ent.fakeSupabase;
    fs._agregar("grupos_autorizados", { usuario_id: A, grupo_id: G1, activo: true });
    fs._agregar("automation_configs", {
        usuario_id: A, grupo_id: G1, activo: true,
        mensaje_inicio_dia: { activo: true, hora: "07:00", dias_permitidos: { lunes: true } },
        dias_permitidos: {}, mensaje_apertura: {}, mensaje_cierre: {}, stickers: {}, recordatorios: {}, mensaje_actualizacion: {}
    });
}

function plantilla(contenido, extra = {}) {
    const p = { id: `p-${plantillas.length + 1}`, usuario_id: A, tipo_respuesta: "inicio_dia", contenido, habilitada: true, ...extra };
    plantillas.push(p);
    return p;
}

// Ejecuta un tick capturando la consola: devuelve envíos y líneas de sombra.
async function tick({ ahora = LUNES_8AM, usuarioId = A, azar = null, sock = null } = {}) {
    const s = sock || ent.crearFakeSock({ sessionId: `ses-${usuarioId}`, usuarioId });
    const capturadas = [];
    const { log, warn, error } = console;
    console.log = console.warn = console.error = (...a) => capturadas.push(a.map(String).join(" "));
    const realRandom = Math.random;
    if (azar != null) Math.random = () => azar;
    try {
        await ent.scheduler.tick(s.sock, { ahora });
    } finally {
        Math.random = realRandom;
        Object.assign(console, { log, warn, error });
    }
    const sombras = capturadas.filter(l => l.startsWith("[MENSAJES SOMBRA]"));
    return {
        textos: s.llamadas.sendMessage.map(m => m.contenido.text),
        sombras: sombras.map(l => { try { return JSON.parse(l.slice("[MENSAJES SOMBRA] ".length)); } catch { return { crudo: l }; } }),
        crudas: sombras,
        todo: capturadas
    };
}

const acciones = () => ent.fakeSupabase._tablas.automation_actions;
const usos = () => ent.fakeSupabase._tablas.automation_message_uses;

// ================================================================ modo off ===

prueba("O2-1 sin la variable (off): mismo envío, ninguna línea de sombra y ninguna lectura extra", async () => {
    escenario({ modo: null });
    plantilla("BUENOS DÍAS");
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, ["BUENOS DÍAS"]);
    assert.strictEqual(sombras.length, 0);
    assert.strictEqual(lecturas.length, 1, "solo la lectura del motor actual");
});

// ============================================================ coincidencia ===

prueba("O2-2 shadow: el envío es idéntico y la comparación coincide (misma plantilla y texto)", async () => {
    escenario();
    plantilla("☀️ Buenos días familia");
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, ["☀️ Buenos días familia"]);
    assert.strictEqual(sombras.length, 1);
    const s = sombras[0];
    assert.deepStrictEqual([s.origen, s.tipo, s.usuarioId, s.coincide, s.motivo], ["inicio_dia", "inicio_dia", A, true, null]);
    assert.deepStrictEqual([s.actual.estado, s.actual.plantillaId, s.orquestador.estado, s.orquestador.plantillaId], ["enviado", "p-1", "sombra", "p-1"]);
    assert.strictEqual(s.actual.huellaTexto, s.orquestador.huellaTexto);
});

prueba("O2-3 el mismo azar llega a la sombra: con 3 plantillas y azar 0.99, ambos eligen la 3ª", async () => {
    escenario();
    plantilla("UNO"); plantilla("DOS"); plantilla("TRES");
    const { textos, sombras } = await tick({ azar: 0.99 });
    assert.deepStrictEqual(textos, ["TRES"]);
    assert.deepStrictEqual([sombras[0].orquestador.plantillaId, sombras[0].coincide], ["p-3", true]);
});

prueba("O2-4 reproduce las inconsistencias: líneas vacías de {{nombre_evento}}/{{premio}} en ambos (coincide)", async () => {
    escenario();
    plantilla("☀️ Buenos días\n🎯 {{nombre_evento}}\n🏆 {{premio}}");
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, ["☀️ Buenos días\n🎯 \n🏆 "]);
    assert.strictEqual(sombras[0].coincide, true);
});

prueba("O2-5 reproduce que se ignora el interruptor/modo del panel: la sombra tampoco los lee", async () => {
    escenario();
    plantilla("A"); plantilla("B");
    const { sombras } = await tick({ azar: 0 });
    // Ni el motor ni la sombra leen configuracion_seleccion_mensajes (la fake
    // ni la tiene): solo plantillas.
    assert.ok(lecturas.every(l => l.tipo === "inicio_dia"));
    assert.strictEqual(sombras[0].coincide, true);
});

prueba("O2-6 sin plantillas: ninguno envía y la comparación coincide", async () => {
    escenario();
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, []);
    assert.deepStrictEqual([sombras[0].actual.estado, sombras[0].orquestador.estado, sombras[0].orquestador.motivo, sombras[0].coincide], ["sin_plantillas", "omitido", "sin_plantillas", true]);
});

// ============================================================= diferencias ===

prueba("O2-7 diferencia: las plantillas cambian entre la lectura del motor y la de la sombra → candidatas_distintas", async () => {
    escenario();
    plantilla("VIEJA");
    alterarLectura = (n, filas) => (n === 2 ? [{ id: "p-nueva", usuario_id: A, tipo_respuesta: "inicio_dia", contenido: "NUEVA", habilitada: true }] : filas);
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, ["VIEJA"], "el envío real no cambia");
    assert.deepStrictEqual([sombras[0].coincide, sombras[0].motivo], [false, "candidatas_distintas"]);
    assert.deepStrictEqual(sombras[0].diferencias, ["texto", "plantillaId"]);
});

prueba("O2-8 diferencia: mismo texto de partida pero distinto resultado → texto_distinto / plantilla_distinta", async () => {
    escenario();
    const { compararInicioDiaEnSombra } = require(r("automation/sombraInicioDia.js"));
    const repo = { obtenerPlantillasHabilitadas: async () => [{ id: "p-1", usuario_id: A, contenido: "HOLA" }, { id: "p-2", usuario_id: A, contenido: "ADIÓS" }] };
    const log = () => {};
    const texto = await compararInicioDiaEnSombra({ usuarioId: A, grupoId: G1, fecha: "2026-11-09", azar: 0, candidatasActuales: ["p-1", "p-2"], actual: { enviado: true, texto: "OTRO", plantillaId: "p-1" }, repo, log });
    assert.deepStrictEqual([texto.coincide, texto.motivo], [false, "texto_distinto"]);
    const pl = await compararInicioDiaEnSombra({ usuarioId: A, grupoId: G1, fecha: "2026-11-09", azar: 0.99, candidatasActuales: ["p-1", "p-2"], actual: { enviado: true, texto: "HOLA", plantillaId: "p-1" }, repo, log });
    assert.deepStrictEqual([pl.coincide, pl.motivo], [false, "plantilla_distinta"]);
    const envio = await compararInicioDiaEnSombra({ usuarioId: A, grupoId: G1, fecha: "2026-11-09", candidatasActuales: ["p-1", "p-2"], actual: { enviado: false }, repo, log });
    assert.deepStrictEqual([envio.coincide, envio.motivo], [false, "envio_distinto"]);
});

// ======================================================= sin efectos ===

prueba("O2-9 sin efectos: un solo envío, una sola clave consumida (la del motor), ningún uso registrado", async () => {
    escenario();
    plantilla("HOLA");
    const antes = JSON.stringify(ent.fakeSupabase._tablas.automation_configs);
    const { textos } = await tick();
    assert.strictEqual(textos.length, 1);
    assert.strictEqual(acciones().length, 1);
    assert.strictEqual(acciones()[0].clave_idempotencia, `${G1}:DAILY_START_MESSAGE:2026-11-09`);
    assert.strictEqual(usos().length, 0);
    assert.strictEqual(JSON.stringify(ent.fakeSupabase._tablas.automation_configs), antes);
    assert.strictEqual(plantillas.length, 1);
});

prueba("O2-10 la sombra se crea sin funciones de envío ni guardián (no puede enviar ni consumir claves)", async () => {
    const fuente = require("fs").readFileSync(r("automation/sombraInicioDia.js"), "utf8");
    const creacion = fuente.slice(fuente.indexOf("crearOrquestador({"), fuente.indexOf("});", fuente.indexOf("crearOrquestador({")));
    assert.ok(!/envios\s*:/.test(creacion) && !/guardian\s*:/.test(creacion), creacion);
    assert.ok(!/require\([^)]*(send|executionGuard|aiService|compartirTabla|puppeteer)/.test(fuente));
});

// ================================================ fallos sin afectar ===

prueba("O2-11 si la lectura de la sombra falla, el envío actual ya ocurrió y el tick no lanza", async () => {
    escenario();
    plantilla("HOLA");
    alterarLectura = (n, filas) => { if (n === 2) throw new Error("Supabase caído (simulado)"); return filas; };
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, ["HOLA"]);
    assert.deepStrictEqual([sombras[0].orquestador.estado, sombras[0].orquestador.motivo], ["error", "excepcion_decision"]);
});

prueba("O2-12 si el módulo de sombra entero falla (excepción), el envío actual no se ve afectado", async () => {
    escenario();
    plantilla("HOLA");
    const ruta = r("automation/sombraInicioDia.js");
    const original = require.cache[ruta];
    inyectar(ruta, { compararInicioDiaEnSombra: async () => { throw new Error("explotó (simulado)"); } });
    try {
        const { textos, todo } = await tick();
        assert.deepStrictEqual(textos, ["HOLA"]);
        assert.ok(todo.some(l => l.includes("comparación omitida") && l.includes("explotó")));
        assert.strictEqual(acciones()[0].estado, "ok");
    } finally {
        if (original) require.cache[ruta] = original; else delete require.cache[ruta];
    }
});

prueba("O2-13 si WhatsApp falla en el envío real, la sombra compara igual (estado fallo_envio)", async () => {
    escenario();
    plantilla("HOLA");
    const s = ent.crearFakeSock({ sessionId: "ses-A", usuarioId: A });
    s.sock.sendMessage = async () => { throw new Error("rechazado (simulado)"); };
    const { sombras } = await tick({ sock: s });
    assert.deepStrictEqual([sombras[0].actual.estado, sombras[0].coincide], ["fallo_envio", true]);
    assert.strictEqual(acciones()[0].estado, "error");
});

// ============================================= duplicados y aislamiento ===

prueba("O2-14 sin duplicados: el segundo tick del día no envía ni vuelve a comparar", async () => {
    escenario();
    plantilla("HOLA");
    await tick();
    const segundo = await tick({ ahora: new Date(LUNES_8AM.getTime() + 3600000) });
    assert.deepStrictEqual([segundo.textos.length, segundo.sombras.length], [0, 0]);
    assert.strictEqual(acciones().length, 1);
});

prueba("O2-15 aislamiento: la sombra lee solo las plantillas del cliente de la sesión", async () => {
    escenario();
    plantilla("DE A");
    plantillas.push({ id: "p-B", usuario_id: B, tipo_respuesta: "inicio_dia", contenido: "DE B", habilitada: true });
    ent.fakeSupabase._agregar("grupos_autorizados", { usuario_id: B, grupo_id: G2, activo: true });
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, ["DE A"]);
    assert.ok(lecturas.every(l => l.usuarioId === A));
    assert.deepStrictEqual([sombras[0].orquestador.plantillaId, sombras[0].coincide], ["p-1", true]);
});

// ======================================================= IA, imágenes, privacidad ===

prueba("O2-16 ni IA ni imágenes en todo el flujo", async () => {
    escenario();
    plantilla("HOLA");
    await tick();
    assert.deepStrictEqual(prohibido, { ia: 0, chromium: 0 });
});

prueba("O2-17 la línea de comparación no contiene teléfonos ni el JID del grupo", async () => {
    escenario();
    plantilla("Pagos a Nequi 3001234567 o 300 123 4567 ✅");
    const { crudas, sombras } = await tick();
    const linea = crudas[0];
    assert.ok(!linea.includes("573001112233") && !linea.includes(G1), linea);
    assert.ok(!/\d{7,}/.test(linea.replace(/"[a-f0-9]{16}"/g, "")), linea);
    assert.strictEqual(sombras[0].actual.vistaPrevia, "Pagos a Nequi ••• o ••• ✅");
    assert.strictEqual(sombras[0].grupo.length, 16);
});

prueba("O2-18 con «active» configurado, en O2 se comporta SOLO como sombra (un único envío, el del motor)", async () => {
    escenario({ modo: "active" });
    plantilla("HOLA");
    const { textos, sombras } = await tick();
    assert.deepStrictEqual(textos, ["HOLA"]);
    assert.deepStrictEqual([sombras[0].orquestador.estado, sombras[0].modoConfigurado], ["sombra", "active"]);
    assert.ok(sombras[0].aviso);
});

acelerarTimers();
ejecutar("O2 · Inicio del día en modo sombra").finally(() => { restaurarTimers(); delete process.env.MENSAJES_ORQUESTADOR_INICIO_DIA; });
