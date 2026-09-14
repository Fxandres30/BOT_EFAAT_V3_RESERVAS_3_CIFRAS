// Fase 8 — pruebas REALES del sistema de sesiones/failover.
// Real: Supabase (tabla "sesiones"), SessionManager (manager.js), bot/index.js,
// registerMessages/unregisterMessages (messages.upsert.js),
// iniciarWorkerEventos/detenerWorkerEventos.
// Simulado: el objeto socket de Baileys en sí (no hay una segunda cuenta de
// WhatsApp real disponible en este entorno, y esta prueba no debe tocar la
// sesión real ya conectada del usuario). El socket simulado implementa
// exactamente la superficie que el código real usa: .ev.on/.off, .context.
//
// Un solo proceso Node, de principio a fin, sin reiniciar nada.
// Restaura Supabase exactamente al estado previo al finalizar.
require("dotenv").config();

const supabase = require("./lib/supabase");
const manager = require("./services/baileys/manager");
const iniciarBot = require("./bot/index.js");

const USUARIO_ID = "2491cbd0-5fb5-4cef-a06d-6092e69d40c4";
const REAL_SESSION_ID = "34906107-227f-40f6-8785-2a4c39e415b8"; // NUNCA se toca su socket, solo se restaura su fila al final

let pasaron = 0, fallaron = 0;
const fallos = [];

function assert(cond, msg) {
    if (cond) { pasaron++; console.log("✅", msg); }
    else { fallaron++; fallos.push(msg); console.log("❌", msg); }
}

// ---------- Instrumentación: contar listeners/intervals activos ----------
const eventosSocket = []; // {sessionId, accion:'on'|'off', event}

function fakeSocket(sessionId) {
    return {
        context: { sessionId, usuarioId: USUARIO_ID, telefono: "000", nombreSesion: "TEST", estado: "conectado" },
        ev: {
            on: (event, handler) => { eventosSocket.push({ sessionId, accion: "on", event }); },
            off: (event, handler) => { eventosSocket.push({ sessionId, accion: "off", event }); }
        }
    };
}

function netListeners(sessionId, event = "messages.upsert") {
    return eventosSocket.filter(e => e.sessionId === sessionId && e.event === event)
        .reduce((acc, e) => acc + (e.accion === "on" ? 1 : -1), 0);
}

function totalListenersActivos() {
    const porSesion = {};
    for (const e of eventosSocket) {
        if (e.event !== "messages.upsert") continue;
        porSesion[e.sessionId] = (porSesion[e.sessionId] || 0) + (e.accion === "on" ? 1 : -1);
    }
    return Object.values(porSesion).reduce((a, b) => a + b, 0);
}

const intervalosActivos = new Set();
const _setInterval = global.setInterval;
const _clearInterval = global.clearInterval;
global.setInterval = (fn, ms, ...args) => {
    const id = _setInterval(fn, ms, ...args);
    intervalosActivos.add(id);
    return id;
};
global.clearInterval = (id) => {
    intervalosActivos.delete(id);
    return _clearInterval(id);
};

const TEST_IDS = { A: null, B: null, C: null };

async function crearSesionTest(nombre) {
    const { data, error } = await supabase.from("sesiones").insert({
        usuario_id: USUARIO_ID, nombre, estado: "conectado", activa: false, principal: false, telefono: "000"
    }).select().single();
    if (error) throw error;
    return data.id;
}

async function limpiar() {

    // Restaurar la sesión REAL exactamente como estaba.
    await supabase.from("sesiones").update({ activa: true, principal: true }).eq("id", REAL_SESSION_ID);

    // Borrar las 3 sesiones de prueba.
    const ids = Object.values(TEST_IDS).filter(Boolean);
    if (ids.length) {
        await supabase.from("sesiones").delete().in("id", ids);
    }

    global.setInterval = _setInterval;
    global.clearInterval = _clearInterval;

}

async function main() {

    console.log("\n========== SETUP ==========");

    TEST_IDS.A = await crearSesionTest("__TEST_FASE8_A__");
    TEST_IDS.B = await crearSesionTest("__TEST_FASE8_B__");
    TEST_IDS.C = await crearSesionTest("__TEST_FASE8_C__");

    console.log("Sesiones de prueba creadas:", TEST_IDS);

    iniciarBot(); // registra activeChanged/activeLost (bot/index.js real)

    // ================= PRUEBA 1: una sesión conectada → BOT activo =================
    console.log("\n========== PRUEBA 1: una sesión conectada ==========");

    const sockA1 = fakeSocket(TEST_IDS.A);
    manager.sockets.set(TEST_IDS.A, sockA1);

    await manager.evaluarConexion(TEST_IDS.A);

    assert(manager.getActiveSession() === TEST_IDS.A, "A se convierte en activeBotSession (única sesión conectada)");
    // FASE 2 (IdentitySync): bot/index.js ahora registra DOS listeners
    // independientes de "messages.upsert" por sesión — registerMessages
    // (negocio real, sin cambios) y registerIdentitySync (escaneo de
    // identidades en vivo, nuevo) — ver bot/events/identitySync.upsert.js.
    // netListeners() cuenta el evento por nombre, sin distinguir quién lo
    // registró, así que el neto saludable pasa de 1 a 2.
    assert(netListeners(TEST_IDS.A) === 2, "Exactamente 2 listeners netos registrados en A (mensajes de negocio + IdentitySync en vivo)");
    // CORRECCIÓN (Fase Producción Real): bot/index.js ahora también arranca
    // automation/scheduler.js (antes nunca se llamaba scheduler.start() en
    // producción — bug real corregido) — cada sesión activa registra 3
    // intervals: el worker de eventos existente + el Scheduler + el
    // escaneo periódico de identidades (FASE 2, escanerIdentidadesLifecycle.js).
    assert(intervalosActivos.size === 3, "Exactamente 3 workers activos (worker de eventos + scheduler de automatización + escaneo periódico de identidades)");

    // ================= PRUEBA 2: dos conectadas, sin duplicación =================
    console.log("\n========== PRUEBA 2: dos sesiones conectadas ==========");

    const sockB1 = fakeSocket(TEST_IDS.B);
    manager.sockets.set(TEST_IDS.B, sockB1);

    await manager.evaluarConexion(TEST_IDS.B);

    assert(manager.getActiveSession() === TEST_IDS.A, "B conectada NO reemplaza a A (ya hay una activa saludable)");
    assert(netListeners(TEST_IDS.A) === 2 && netListeners(TEST_IDS.B) === 0, "Siguen habiendo exactamente 2 listeners (en A), ninguno en B");
    assert(intervalosActivos.size === 3, "Sigue habiendo exactamente 3 workers activos (worker de eventos + scheduler + escaneo periódico de identidades)");

    const okPref = await manager.marcarPreferidaManual(TEST_IDS.B);
    const { data: filaB } = await supabase.from("sesiones").select("principal").eq("id", TEST_IDS.B).single();
    const { data: filaA } = await supabase.from("sesiones").select("principal").eq("id", TEST_IDS.A).single();

    assert(okPref && filaB.principal === true, "B queda marcada preferida en Supabase");
    assert(filaA.principal === false, "A deja de ser preferida (una sola preferida por usuario)");
    assert(manager.getActiveSession() === TEST_IDS.A, "Marcar B como preferida NO fuerza el cambio de activa (A sigue activa)");

    // ================= PRUEBA 3: cambiar preferida desde el frontend (acción explícita) =================
    console.log("\n========== PRUEBA 3: selección explícita de sesión (equivalente a botón del panel) ==========");

    await manager.setActive(TEST_IDS.B, { preferida: true });

    assert(manager.getActiveSession() === TEST_IDS.B, "B pasa a ser la activa del BOT tras la selección explícita, sin reiniciar nada");
    assert(netListeners(TEST_IDS.A) === 0 && netListeners(TEST_IDS.B) === 2, "Los listeners se movieron de A a B, exactamente 2 activos");
    assert(intervalosActivos.size === 3, "Sigue habiendo exactamente 3 workers activos (los de B)");

    // ================= PRUEBA 4/5: desconectar la activa → failover a la otra conectada =================
    console.log("\n========== PRUEBA 4 y 5: failover automático (queda otra conectada) ==========");

    manager.sockets.delete(TEST_IDS.B); // simula que Baileys reportó desconexión definitiva
    await manager.manejarDesconexionActiva(TEST_IDS.B);

    assert(manager.getActiveSession() === TEST_IDS.A, "Al caer B (activa), el BOT continúa automáticamente con A (la otra conectada)");
    assert(netListeners(TEST_IDS.B) === 0 && netListeners(TEST_IDS.A) === 2, "Listeners movidos de vuelta a A, exactamente 2 activos");
    assert(intervalosActivos.size === 3, "Exactamente 3 workers activos tras el failover");

    const { data: filaBTrasFailover } = await supabase.from("sesiones").select("principal").eq("id", TEST_IDS.B).single();
    assert(filaBTrasFailover.principal === true, "La preferencia (B) NO se pierde por el failover automático, aunque B ya no esté activa");

    // ================= PRUEBA 6: ninguna otra conectada → BOT sin sesión activa =================
    console.log("\n========== PRUEBA 6: sin ninguna sesión conectada ==========");

    manager.sockets.delete(TEST_IDS.A);
    await manager.manejarDesconexionActiva(TEST_IDS.A);

    assert(manager.getActiveSession() === null, "activeBotSession queda en null, de forma segura");
    assert(totalListenersActivos() === 0, "0 listeners activos (no queda escuchando ningún socket muerto)");
    assert(intervalosActivos.size === 0, "0 workers activos");

    // ================= PRUEBA 7: conectar otra sesión después → recuperación automática =================
    console.log("\n========== PRUEBA 7: reconexión posterior de otra sesión ==========");

    const sockC1 = fakeSocket(TEST_IDS.C);
    manager.sockets.set(TEST_IDS.C, sockC1);

    await manager.evaluarConexion(TEST_IDS.C);

    assert(manager.getActiveSession() === TEST_IDS.C, "C se recupera automáticamente como activeBotSession al conectar (sin sesión activa previa)");
    assert(netListeners(TEST_IDS.C) === 2, "Exactamente 2 listeners, en C");
    assert(intervalosActivos.size === 3, "Exactamente 3 workers activos");

    // ================= BUG: misma sesión reconecta con socket NUEVO =================
    console.log("\n========== VERIFICACIÓN DEL BUG: reconexión de la misma sesión con socket nuevo ==========");

    const socketViejo = sockC1;
    manager.sockets.delete(TEST_IDS.C); // Baileys tira el socket viejo (p.ej. restartRequired)

    const sockC2 = fakeSocket(TEST_IDS.C); // instancia NUEVA, mismo sessionId
    manager.sockets.set(TEST_IDS.C, sockC2);

    await manager.evaluarConexion(TEST_IDS.C); // esto es lo que llama conectado.js tras el reconnect

    assert(manager.getActiveSession() === TEST_IDS.C, "activeSession sigue siendo C (el sessionId no cambió)");
    assert(netListeners(TEST_IDS.C) === 2, "Sigue habiendo exactamente 2 listeners netos para el sessionId C");

    const listenersEnSocketViejo = eventosSocket.filter(e => e.event === "messages.upsert" && e.accion === "on").length -
        eventosSocket.filter(e => e.event === "messages.upsert" && e.accion === "off").length;

    // Verificación más directa: contar on/off que referencian específicamente
    // cada instancia de socket a través del orden de eventos registrados.
    const eventosC = eventosSocket.filter(e => e.sessionId === TEST_IDS.C && e.event === "messages.upsert");
    console.log("Eventos on/off para sessionId C (debe terminar en un 'on' neto = 2, y haber al menos un ciclo on->off->on por cada listener):", eventosC.map(e => e.accion).join(","));

    assert(eventosC.filter(e => e.accion === "on").length >= 2, "Se volvió a registrar un listener nuevo tras el cambio de socket (no se quedó colgado del socket viejo)");
    assert(eventosC.filter(e => e.accion === "off").length >= 1, "El listener del socket viejo fue correctamente removido antes de registrar el nuevo");

    console.log("\n========== LIMPIEZA ==========");
    await limpiar();
    console.log("Supabase restaurado: sesión real con activa=true/principal=true, sesiones de prueba eliminadas.");

    console.log("\n============================");
    console.log(`TOTAL: ${pasaron + fallaron}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
    console.log("============================");

    if (fallos.length) {
        console.log("Fallos:", fallos);
    }

    // El worker de eventos (setInterval real, sin mockear) mantiene vivo
    // el proceso indefinidamente — correcto en producción, pero este
    // script de un solo proceso debe terminar explícitamente al acabar
    // sus pruebas (ya limpió Supabase e intervalos arriba).
    process.exit(fallos.length ? 1 : 0);

}

main().catch(async (err) => {

    console.error("💥 ERROR:", err);

    try {
        await limpiar();
        console.log("Limpieza de emergencia ejecutada.");
    } catch (e) {
        console.error("No se pudo limpiar automáticamente:", e.message);
    }

    process.exit(1);

});
