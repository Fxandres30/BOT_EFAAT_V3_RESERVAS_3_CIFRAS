// ==========================================================================
// FASE O0 — CARACTERIZACIÓN del motor 3: INICIO DEL DÍA (scheduler.tick →
// evaluarInicioDiaGlobal).
//
// Reales: scheduler.js, eventRules.evaluarInicioDia, automationConfig repo,
// executionGuard.js, shared/variables (resolverTexto) y send.js con socket
// simulado. Simulados: Supabase (fakeSupabaseAutomation) y el repositorio
// de plantillas (automation/repo/plantillasMensaje.js), porque esa fake no
// tiene plantillas_mensaje; se reproduce su misma consulta (usuario + tipo +
// habilitada).
//
//     node backend/tests/mensajes-o0/o0InicioDia.test.js
// ==========================================================================

"use strict";

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const { r, inyectar, silencio, conAzar } = require("./_comun");
const { prueba, riesgo, ejecutar } = require("../caracterizacion/_prueba");

// Plantillas de inicio_dia en memoria (mismo filtro que el repositorio real).
const plantillas = [];
const pedidosPlantillas = [];
inyectar(r("automation/repo/plantillasMensaje.js"), {
    obtenerPlantillasHabilitadas: async (usuarioId, tipo) => {
        pedidosPlantillas.push({ usuarioId, tipo });
        return plantillas.filter(p => p.usuario_id === usuarioId && p.tipo_respuesta === tipo && p.habilitada);
    }
});

const { crearEntorno, acelerarTimers, restaurarTimers } = require("../scheduler/entornoFake");

const A = "usuario-A";
const B = "usuario-B";
const G1 = "573000000000-1111@g.us";
const G2 = "573000000000-2222@g.us";
// Lunes 09/11/2026 08:00 en Colombia (13:00 UTC).
const LUNES_8AM = new Date("2026-11-09T13:00:00Z");

let ent;

function escenario({ hora = "07:00", dias = { lunes: true }, activo = true, inicioActivo = true, autorizado = true } = {}) {
    ent = crearEntorno();
    plantillas.length = 0;
    pedidosPlantillas.length = 0;
    const fs = ent.fakeSupabase;
    if (autorizado) fs._agregar("grupos_autorizados", { usuario_id: A, grupo_id: G1, activo: true });
    fs._agregar("automation_configs", {
        usuario_id: A, grupo_id: G1, activo,
        mensaje_inicio_dia: { activo: inicioActivo, hora, dias_permitidos: dias },
        dias_permitidos: {}, mensaje_apertura: {}, mensaje_cierre: {}, stickers: {}, recordatorios: {}, mensaje_actualizacion: {}
    });
}

function plantilla(contenido, extra = {}) {
    plantillas.push({ id: `p-${plantillas.length + 1}`, usuario_id: A, tipo_respuesta: "inicio_dia", contenido, habilitada: true, ...extra });
}

async function tick(ahora = LUNES_8AM, usuarioId = A) {
    const s = ent.crearFakeSock({ sessionId: `ses-${usuarioId}`, usuarioId });
    await silencio(() => ent.scheduler.tick(s.sock, { ahora }));
    return { textos: s.llamadas.sendMessage.map(m => m.contenido.text), jids: s.llamadas.sendMessage.map(m => m.jid) };
}

const acciones = () => ent.fakeSupabase._tablas.automation_actions;

prueba("ID1 envía UNA plantilla activa al azar, con clave «<grupo>:DAILY_START_MESSAGE:<fecha>»", async () => {
    escenario();
    plantilla("BUENOS DÍAS 1"); plantilla("BUENOS DÍAS 2"); plantilla("INACTIVA", { habilitada: false });
    const { textos, jids } = await conAzar([0.99], () => tick());
    assert.deepStrictEqual(textos, ["BUENOS DÍAS 2"]);
    assert.deepStrictEqual(jids, [G1]);
    assert.ok(acciones().some(a => a.clave_idempotencia === `${G1}:DAILY_START_MESSAGE:2026-11-09` && a.tipo_accion === "DAILY_START_MESSAGE"));
});

prueba("ID2 una vez por grupo y día: un segundo ciclo el mismo día no envía nada", async () => {
    escenario();
    plantilla("HOLA");
    await tick();
    const segundo = await tick(new Date(LUNES_8AM.getTime() + 60 * 60 * 1000));
    assert.deepStrictEqual(segundo.textos, []);
});

prueba("ID3 sin plantillas activas → no envía y NO consume la clave (si se activa una más tarde, sale ese mismo día)", async () => {
    escenario();
    const sin = await tick();
    assert.deepStrictEqual(sin.textos, []);
    assert.strictEqual(acciones().length, 0);
    plantilla("TARDE");
    const luego = await tick(new Date(LUNES_8AM.getTime() + 30 * 60 * 1000));
    assert.deepStrictEqual(luego.textos, ["TARDE"]);
});

prueba("ID4 IGNORA el interruptor y el modo de selección del panel: solo mira «habilitada» de cada plantilla", async () => {
    escenario();
    plantilla("A"); plantilla("B");
    await conAzar([0.0], () => tick());
    // El scheduler no lee configuracion_seleccion_mensajes (esa tabla ni
    // existe en esta fake: leerla fallaría y no habría envío).
    assert.deepStrictEqual(pedidosPlantillas.map(p => p.tipo), ["inicio_dia"]);
    riesgo("Inicio del día no respeta el interruptor ni el modo (fijo/rotación) que el panel muestra para ese tipo: siempre elige al azar entre las plantillas activas.");
});

prueba("ID5 variables del catálogo global SIN evento: {{evento}}/{{nombre_evento}}/{{premio}} quedan vacías (líneas a medias)", async () => {
    escenario();
    plantilla("☀️ Buenos días\n🎯 {{nombre_evento}}\n🏆 {{premio}}\n{{evento|upper}}.");
    const { textos } = await tick();
    assert.strictEqual(textos[0], "☀️ Buenos días\n🎯 \n🏆 \n.");
    riesgo("Plantillas de Inicio del día con {{nombre_evento}} o {{premio}} dejan líneas vacías («🎯 »): a esa hora normalmente no hay sorteo en contexto.");
});

prueba("ID6 condiciones: grupo no autorizado, automatización apagada, acción apagada, día no permitido o antes de la hora → nada", async () => {
    const casos = [
        { autorizado: false }, { activo: false }, { inicioActivo: false }, { dias: { martes: true } }, { hora: "09:30" }
    ];
    for (const caso of casos) {
        escenario(caso);
        plantilla("NO DEBE SALIR");
        const { textos } = await tick();
        assert.deepStrictEqual(textos, [], JSON.stringify(caso));
    }
});

prueba("ID7 «sin límite superior»: si el scheduler arranca tarde ese día, igual se envía", async () => {
    escenario({ hora: "07:00" });
    plantilla("TARDE PERO SALE");
    const { textos } = await tick(new Date("2026-11-10T02:00:00Z")); // lunes 21:00 en Colombia
    assert.deepStrictEqual(textos, ["TARDE PERO SALE"]);
});

prueba("ID8 aislamiento: las plantillas y configuraciones son las del usuario de la sesión", async () => {
    escenario();
    plantilla("DE A");
    ent.fakeSupabase._agregar("grupos_autorizados", { usuario_id: B, grupo_id: G2, activo: true });
    const deB = await tick(LUNES_8AM, B);
    assert.deepStrictEqual(deB.textos, []);
    const deA = await tick(LUNES_8AM, A);
    assert.deepStrictEqual(deA.textos, ["DE A"]);
    assert.ok(pedidosPlantillas.every(p => p.usuarioId === A));
});

acelerarTimers();
ejecutar("O0 · Motor 3: Inicio del día").finally(restaurarTimers);
