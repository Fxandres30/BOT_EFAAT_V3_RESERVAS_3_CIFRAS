// FASE PRODUCCIÓN REAL — prueba de INTEGRACIÓN REAL (Supabase real, sin
// mocks de datos) de los DOS bugs encontrados y corregidos:
//
//   1) automation/scheduler.js nunca se arrancaba en producción
//      (bot/index.js no llamaba a scheduler.start()/stop()).
//   2) event_sessions se quedaba en "pendiente" para siempre — nada
//      llamaba a eventSessionsRepo.marcarAbierto() — así que aunque el
//      Scheduler corriera, nunca encontraba nada que procesar
//      (obtenerAbiertasPorSesion solo lee "abierto"/"cerrando").
//
// Este script ejercita el código de producción real (engine.js,
// scheduler.js, eventRules.js, los repos reales) contra Supabase real,
// usando un usuario/grupo/sesión de PRUEBA (nunca el grupo real en vivo).
// Solo se sustituye sendMessage (Baileys) — mismo criterio que
// _test_fase7_dinamismo.js / _test_fase2_variables_globales_e2e.js.
require("dotenv").config();

const path = require("path");
const AUTOMATION_DIR = path.join(__dirname, "automation");

function fakeModule(modId, exportsObj) {
    const resolved = require.resolve(modId, { paths: [AUTOMATION_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const enviados = [];

fakeModule("../services/baileys/send", {
    sendMessage: async ({ jid, text }) => { enviados.push({ jid, text }); }
});

const engine = require(path.join(AUTOMATION_DIR, "engine.js"));
const scheduler = require(path.join(AUTOMATION_DIR, "scheduler.js"));
const supabase = require("./lib/supabase");

const USUARIO_ID = "2491cbd0-5fb5-4cef-a06d-6092e69d40c4";
const GRUPO_ID = "999999999999999999-testproduccionreal@g.us";
// event_sessions.session_id tiene FK real a la tabla "sesiones" — se usa
// una sesión real inactiva ("Nueva sesión", desconectada, no la sesión en
// vivo) solo como referencia válida; el scheduler.tick() de esta prueba se
// filtra por este sessionId, nunca toca la sesión de WhatsApp real activa.
const SESSION_ID = "55cd8ef9-b137-424d-b9f2-dd5fe856888f";
const TABLA_REAL_SOLO_LECTURA = "5k_15k_reservas_2_cifras"; // misma tabla real que ya usa el evento de producción — solo SELECT

let pasaron = 0, fallaron = 0;
const fallos = [];

function assert(cond, msg) {
    if (cond) { pasaron++; console.log("✅", msg); }
    else { fallaron++; fallos.push(msg); console.log("❌", msg); }
}

async function limpiar() {
    await supabase.from("automation_actions").delete().eq("grupo_id", GRUPO_ID);
    await supabase.from("event_sessions").delete().eq("grupo_id", GRUPO_ID);
    await supabase.from("automation_configs").delete().eq("usuario_id", USUARIO_ID).eq("grupo_id", GRUPO_ID);
    await supabase.from("grupos_autorizados").delete().eq("usuario_id", USUARIO_ID).eq("grupo_id", GRUPO_ID);
    await supabase.from("eventos_bot").delete().eq("grupo_id", GRUPO_ID);
}

// scheduler.js::procesarEventSession() lee el evento EN VIVO desde
// eventos_bot por evento_id (nunca el snapshot, para datos que cambian
// como "activo") — hace falta una fila real, no solo el objeto en memoria
// que se le pasa a onEventoDetectado().
async function crearEventoBotReal() {

    const { data, error } = await supabase.from("eventos_bot").insert({
        usuario_id: USUARIO_ID,
        session_id: SESSION_ID,
        grupo_id: GRUPO_ID,
        nombre_evento: "__TEST_PRODUCCION_REAL__",
        hora_fin: "23:59",
        hora_cierre: "23:55",
        fecha_evento: "2026-09-13",
        valor: 5000,
        premios: [],
        tabla: TABLA_REAL_SOLO_LECTURA,
        cifras: 2,
        cantidad_numeros: 100,
        grupo_nombre: "Grupo de prueba",
        activo: true,
        abierto: true
    }).select().single();

    if (error) throw error;

    return data;

}

function eventoFake(eventoBotId) {
    return {
        id: eventoBotId,
        usuario_id: USUARIO_ID,
        session_id: SESSION_ID,
        grupo_id: GRUPO_ID,
        nombre_evento: "__TEST_PRODUCCION_REAL__",
        hora_fin: "23:59",
        hora_cierre: "23:55",
        fecha_evento: "2026-09-13",
        valor: 5000,
        premios: [],
        tabla: TABLA_REAL_SOLO_LECTURA,
        cifras: 2,
        cantidad_numeros: 100,
        grupo_nombre: "Grupo de prueba"
    };
}

async function main() {

    console.log("\n========== SETUP ==========");
    await limpiar();

    // Grupo autorizado + configuración activa, con publicación inicial de
    // tabla YA vencida (hora "00:00", cualquier día) — para que
    // evaluarPublicacionInicialTabla() de eventRules.js (SIN cambios) la
    // permita de inmediato al primer tick, exactamente igual que ya
    // decide para el grupo real de producción.
    await supabase.from("grupos_autorizados").insert({
        usuario_id: USUARIO_ID, grupo_id: GRUPO_ID, activo: true
    });

    const diasTodos = { activo: true, desde: "00:00", hasta: "23:59" };

    await supabase.from("automation_configs").insert({
        usuario_id: USUARIO_ID, grupo_id: GRUPO_ID, activo: true,
        dias_permitidos: { lunes: diasTodos, martes: diasTodos, miercoles: diasTodos, jueves: diasTodos, viernes: diasTodos, sabado: diasTodos, domingo: diasTodos },
        publicacion_inicial_tabla: {
            activo: true, hora: "00:00",
            dias_permitidos: { lunes: true, martes: true, miercoles: true, jueves: true, viernes: true, sabado: true, domingo: true }
        }
    });

    const eventoBot = await crearEventoBotReal();

    console.log("Grupo/config/eventos_bot de prueba creados.");

    // ============= PRUEBA 1: event_session se crea "pendiente" =============
    console.log("\n========== PRUEBA 1: onEventoDetectado crea el event_session en 'pendiente' ==========");

    const decision = await engine.onEventoDetectado(eventoFake(eventoBot.id));

    assert(decision.creoEventSession === true, `event_session creado (motivo: ${decision.motivo})`);
    assert(decision.eventSession?.estado === "pendiente", `estado inicial es 'pendiente' (obtenido: ${decision.eventSession?.estado})`);

    const eventSession = decision.eventSession;

    // ============= PRUEBA 2: BUG #2 corregido — pendiente -> abierto =============
    console.log("\n========== PRUEBA 2: marcarEventSessionAbierta() transiciona pendiente -> abierto ==========");

    const resultadoMarcar = await engine.marcarEventSessionAbierta(eventSession);
    assert(resultadoMarcar.actualizado === true, "marcarEventSessionAbierta() confirma la actualización");

    const { data: sesionActualizada } = await supabase.from("event_sessions").select("estado, abierto_en").eq("id", eventSession.id).single();
    assert(sesionActualizada.estado === "abierto", `Supabase confirma estado='abierto' (obtenido: ${sesionActualizada.estado})`);
    assert(!!sesionActualizada.abierto_en, "abierto_en quedó registrado con una fecha real");

    // ============= PRUEBA 3: BUG #1 corregido — scheduler.tick() SÍ encuentra y procesa la sesión =============
    console.log("\n========== PRUEBA 3: scheduler.tick() encuentra la sesión (ya abierta) y publica INITIAL_TABLE con datos reales ==========");

    await scheduler.tick({ context: { sessionId: SESSION_ID } });

    assert(enviados.length === 1, `scheduler.tick() causó exactamente 1 envío (obtenido: ${enviados.length})`);

    if (enviados.length === 1) {

        assert(enviados[0].jid === GRUPO_ID, "El mensaje se dirige al grupo real del evento (evento.grupo_id)");
        assert(typeof enviados[0].text === "string" && enviados[0].text.length > 0, "El texto de INITIAL_TABLE no está vacío");
        assert(!/undefined|null|\[object Object\]|NaN/.test(enviados[0].text), "El texto no contiene undefined/null/[object Object]/NaN");
        console.log("Texto INITIAL_TABLE real (primeros 120 caracteres):", enviados[0].text.slice(0, 120));

    }

    const { data: accion } = await supabase.from("automation_actions")
        .select("*").eq("event_session_id", eventSession.id).eq("tipo_accion", "INITIAL_TABLE").maybeSingle();

    assert(accion?.estado === "ok", `automation_actions registra INITIAL_TABLE como 'ok' (obtenido: ${accion?.estado})`);

    // ============= PRUEBA 4: idempotencia real — un segundo tick NO reenvía =============
    console.log("\n========== PRUEBA 4: un segundo tick() no vuelve a enviar (ExecutionGuard real) ==========");

    await scheduler.tick({ context: { sessionId: SESSION_ID } });
    assert(enviados.length === 1, `Sigue habiendo exactamente 1 envío tras un segundo tick (obtenido: ${enviados.length})`);

    // ============= PRUEBA 5: sin la corrección del bug #2, esto habría fallado =============
    // (regresión explícita: confirma que un event_session que se HUBIERA
    // quedado en "pendiente" jamás es visto por el scheduler — así se sabe
    // que la Prueba 3 realmente depende de la corrección, no de otra cosa)
    console.log("\n========== PRUEBA 5: control — una sesión 'pendiente' (sin corregir) NUNCA se procesa ==========");

    const grupoControl = GRUPO_ID + "-control";

    await supabase.from("grupos_autorizados").insert({ usuario_id: USUARIO_ID, grupo_id: grupoControl, activo: true });
    await supabase.from("automation_configs").insert({
        usuario_id: USUARIO_ID, grupo_id: grupoControl, activo: true,
        dias_permitidos: { lunes: diasTodos, martes: diasTodos, miercoles: diasTodos, jueves: diasTodos, viernes: diasTodos, sabado: diasTodos, domingo: diasTodos },
        publicacion_inicial_tabla: { activo: true, hora: "00:00", dias_permitidos: { lunes: true, martes: true, miercoles: true, jueves: true, viernes: true, sabado: true, domingo: true } }
    });

    const { data: eventoBotControl } = await supabase.from("eventos_bot").insert({
        usuario_id: USUARIO_ID, session_id: SESSION_ID, grupo_id: grupoControl,
        nombre_evento: "__TEST_PRODUCCION_REAL_CONTROL__", hora_fin: "23:59", hora_cierre: "23:55",
        fecha_evento: "2026-09-13", valor: 5000, premios: [], tabla: TABLA_REAL_SOLO_LECTURA,
        cifras: 2, cantidad_numeros: 100, grupo_nombre: "Grupo de control", activo: true, abierto: true
    }).select().single();

    const evento2 = eventoFake(eventoBotControl.id);
    evento2.nombre_evento = "__TEST_PRODUCCION_REAL_CONTROL__";
    evento2.grupo_id = grupoControl;

    const decision2 = await engine.onEventoDetectado(evento2);
    // Deliberadamente NO se llama marcarEventSessionAbierta() aquí.

    const enviadosAntes = enviados.length;
    await scheduler.tick({ context: { sessionId: SESSION_ID } });
    assert(enviados.length === enviadosAntes, "Una sesión que se queda en 'pendiente' sigue sin procesarse (confirma que la Prueba 3 dependía de la corrección real)");

    await supabase.from("event_sessions").delete().eq("id", decision2.eventSession.id);
    await supabase.from("automation_configs").delete().eq("grupo_id", grupoControl);
    await supabase.from("grupos_autorizados").delete().eq("grupo_id", grupoControl);
    await supabase.from("eventos_bot").delete().eq("grupo_id", grupoControl);

    // ============= LIMPIEZA =============
    console.log("\n========== LIMPIEZA ==========");
    await limpiar();
    console.log("Grupo/config/event_session/acciones de prueba eliminados.");

    console.log("\n============================");
    console.log(`TOTAL: ${pasaron + fallaron}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
    console.log("============================");

    if (fallos.length) {
        console.log("Fallos:", fallos);
        process.exitCode = 1;
    }

}

main().catch(async (err) => {

    console.error("💥 ERROR en el script de pruebas:", err);

    try {
        await limpiar();
        const grupoControl = GRUPO_ID + "-control";
        await supabase.from("grupos_autorizados").delete().eq("grupo_id", grupoControl);
        await supabase.from("automation_configs").delete().eq("grupo_id", grupoControl);
        await supabase.from("event_sessions").delete().eq("grupo_id", grupoControl);
        await supabase.from("eventos_bot").delete().eq("grupo_id", grupoControl);
        console.log("Limpieza de emergencia ejecutada.");
    } catch (e) {
        console.error("No se pudo limpiar automáticamente:", e.message);
    }

    process.exitCode = 1;

});
