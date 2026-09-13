// FASE PRODUCCIÓN REAL + "COMPARTIR REAL" — prueba de INTEGRACIÓN REAL
// (Supabase real, Puppeteer real contra el panel Next.js real corriendo
// en localhost:3000, sin mocks de datos) de:
//
//   1) automation/scheduler.js nunca se arrancaba en producción (ya
//      corregido — bot/index.js ahora llama scheduler.start()/stop()).
//   2) event_sessions se quedaba en "pendiente" para siempre (ya
//      corregido — detectarEvento.js ahora llama marcarEventSessionAbierta()).
//   3) INITIAL_TABLE ahora reutiliza la MISMA función real de "Compartir"
//      (imagen real + texto real) que usa el botón manual del panel —
//      esta prueba ejecuta AMBOS caminos (manual y automático) y compara
//      que producen el mismo resultado real.
//
// Requiere el frontend real corriendo en localhost:3000 (dev server) —
// si no está corriendo, este script lo indica claramente y falla, en vez
// de fingir éxito con datos inventados.
//
// Solo se sustituye el envío final a WhatsApp (sendImage) — mismo
// criterio que el resto de _test_*.js de este proyecto: todo lo demás
// (Supabase, Puppeteer, Express, Next.js) es real.
require("dotenv").config();

const path = require("path");
const express = require("express");
const AUTOMATION_DIR = path.join(__dirname, "automation");

function fakeModule(modId, exportsObj) {
    const resolved = require.resolve(modId, { paths: [AUTOMATION_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const enviados = [];

fakeModule("../services/baileys/send", {
    sendMessage: async ({ jid, text }) => { enviados.push({ tipo: "texto", jid, text }); },
    sendImage: async ({ jid, image, caption }) => { enviados.push({ tipo: "imagen", jid, image, caption }); }
});

const engine = require(path.join(AUTOMATION_DIR, "engine.js"));
const scheduler = require(path.join(AUTOMATION_DIR, "scheduler.js"));
const { compartirTabla } = require("./services/compartirTabla");
const tablasRoutes = require("./routes/tablas");
const supabase = require("./lib/supabase");

const USUARIO_ID = "2491cbd0-5fb5-4cef-a06d-6092e69d40c4";
const GRUPO_ID = "999999999999999999-testproduccionreal@g.us";
// event_sessions.session_id tiene FK real a la tabla "sesiones" — se usa
// una sesión real inactiva ("Nueva sesión", desconectada, no la sesión en
// vivo) solo como referencia válida; el scheduler.tick() de esta prueba se
// filtra por este sessionId, nunca toca la sesión de WhatsApp real activa.
const SESSION_ID = "55cd8ef9-b137-424d-b9f2-dd5fe856888f";
const TABLA_REAL_SOLO_LECTURA = "5k_15k_reservas_2_cifras"; // misma tabla real que ya usa el evento de producción — solo SELECT
const PUERTO_SERVIDOR_PRUEBA = 4000;

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

async function crearEventoBotReal(nombreEvento = "__TEST_PRODUCCION_REAL__") {

    const { data, error } = await supabase.from("eventos_bot").insert({
        usuario_id: USUARIO_ID,
        session_id: SESSION_ID,
        grupo_id: GRUPO_ID,
        nombre_evento: nombreEvento,
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

function eventoDesde(eventoBotRow) {
    return { ...eventoBotRow };
}

async function iniciarServidorPruebaTablas() {

    const app = express();
    app.use(express.json());
    app.use("/tablas", tablasRoutes);

    return new Promise((resolve, reject) => {

        const servidor = app.listen(PUERTO_SERVIDOR_PRUEBA, "127.0.0.1", () => resolve(servidor));
        servidor.on("error", reject);

    });

}

async function main() {

    console.log("\n========== SETUP ==========");

    const frontendUp = await fetch("http://localhost:3000/").then(r => r.status < 500).catch(() => false);

    if (!frontendUp) {
        throw new Error("El frontend real (localhost:3000) no está corriendo — esta prueba necesita el dev server real, no simula la captura de imagen.");
    }

    const servidorTablas = await iniciarServidorPruebaTablas();
    console.log(`Servidor de prueba de /tablas/* real levantado en :${PUERTO_SERVIDOR_PRUEBA} (aislado — nunca toca bot/index.js ni la sesión de WhatsApp real).`);

    await limpiar();

    const diasTodos = { activo: true, desde: "00:00", hasta: "23:59" };

    await supabase.from("grupos_autorizados").insert({ usuario_id: USUARIO_ID, grupo_id: GRUPO_ID, activo: true });

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

    const decision = await engine.onEventoDetectado(eventoDesde(eventoBot));

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

    // ============= PRUEBA MANUAL: compartirTabla() llamado directamente (botón del panel) =============
    console.log("\n========== PRUEBA MANUAL: compartirTabla() real (equivalente al botón Compartir) ==========");

    const antesDeManual = enviados.length;

    const resultadoManual = await compartirTabla({ evento: eventoDesde(eventoBot) }); // sin idempotencia — igual que el botón

    assert(resultadoManual.enviado === true, `compartirTabla() manual reporta enviado=true (obtenido: ${JSON.stringify(resultadoManual)})`);
    assert(enviados.length === antesDeManual + 1, "El envío manual generó exactamente 1 mensaje real");

    const envioManual = enviados[enviados.length - 1];

    assert(envioManual.tipo === "imagen", "El envío manual es una IMAGEN real (no un texto plano)");
    assert(Buffer.isBuffer(envioManual.image) && envioManual.image.length > 500, `La imagen manual es un buffer PNG real no vacío (bytes: ${envioManual.image?.length})`);
    assert(envioManual.jid === GRUPO_ID, "El envío manual va al grupo real del evento");
    assert(typeof envioManual.caption === "string" && envioManual.caption.length > 0, "El envío manual trae texto real (caption)");
    assert(!/undefined|null|\[object Object\]|NaN/.test(envioManual.caption), "El caption manual no contiene undefined/null/[object Object]/NaN");
    console.log("Caption REAL (manual):", JSON.stringify(envioManual.caption));

    // ============= PRUEBA 3: BUG #1 corregido — scheduler.tick() SÍ encuentra y procesa la sesión (AUTOMÁTICO) =============
    console.log("\n========== PRUEBA 3 (AUTOMÁTICO): scheduler.tick() encuentra la sesión y publica INITIAL_TABLE con la MISMA función real ==========");

    const antesDeAuto = enviados.length;

    await scheduler.tick({ context: { sessionId: SESSION_ID } });

    assert(enviados.length === antesDeAuto + 1, `scheduler.tick() causó exactamente 1 envío nuevo (obtenido: ${enviados.length - antesDeAuto})`);

    const envioAutomatico = enviados[enviados.length - 1];

    assert(envioAutomatico.tipo === "imagen", "El envío automático (INITIAL_TABLE) también es una IMAGEN real");
    assert(envioAutomatico.jid === GRUPO_ID, "El envío automático va al grupo real del evento");
    assert(Buffer.isBuffer(envioAutomatico.image) && envioAutomatico.image.length > 500, `La imagen automática es un buffer PNG real no vacío (bytes: ${envioAutomatico.image?.length})`);
    console.log("Caption REAL (automático):", JSON.stringify(envioAutomatico.caption));

    // ============= COMPARACIÓN MANUAL vs AUTOMÁTICO =============
    console.log("\n========== COMPARACIÓN: manual vs automático ==========");

    assert(envioManual.caption === envioAutomatico.caption, "El texto (caption) manual y automático son IDÉNTICOS — misma plantilla, mismos datos reales");
    // Los bytes exactos de la imagen pueden variar por detalles de render
    // (antialiasing/timestamps de captura) — lo que importa, y se prueba
    // aquí, es que AMBOS caminos producen una imagen real de tamaño
    // comparable a partir de la MISMA función (nunca dos generadores
    // distintos).
    const diferenciaTamano = Math.abs(envioManual.image.length - envioAutomatico.image.length) / envioManual.image.length;
    assert(diferenciaTamano < 0.05, `Las imágenes manual y automática tienen tamaño equivalente (±5%): manual=${envioManual.image.length}B, automático=${envioAutomatico.image.length}B`);

    const { data: accion } = await supabase.from("automation_actions")
        .select("*").eq("event_session_id", eventSession.id).eq("tipo_accion", "INITIAL_TABLE").maybeSingle();

    assert(accion?.estado === "ok", `automation_actions registra INITIAL_TABLE como 'ok' (obtenido: ${accion?.estado})`);

    // ============= PRUEBA 4: idempotencia real — un segundo tick NO reenvía =============
    console.log("\n========== PRUEBA 4: un segundo tick() no vuelve a enviar (ExecutionGuard real) ==========");

    const antesDeSegundoTick = enviados.length;
    await scheduler.tick({ context: { sessionId: SESSION_ID } });
    assert(enviados.length === antesDeSegundoTick, `Sin envíos nuevos tras un segundo tick automático (obtenido: ${enviados.length - antesDeSegundoTick} nuevos)`);

    // La llamada MANUAL, en cambio, SÍ debe poder repetirse (un admin que
    // pulsa "Compartir" dos veces espera que se reenvíe las dos veces —
    // nunca queda bloqueada como "duplicado").
    const antesDeSegundoManual = enviados.length;
    const resultadoManual2 = await compartirTabla({ evento: eventoDesde(eventoBot) });
    assert(resultadoManual2.enviado === true && enviados.length === antesDeSegundoManual + 1, "compartirTabla() manual SÍ se puede repetir (sin idempotencia — es una acción explícita del admin)");

    // ============= PRUEBA 5: sin la corrección del bug #2, esto habría fallado =============
    console.log("\n========== PRUEBA 5: control — una sesión 'pendiente' (sin corregir) NUNCA se procesa ==========");

    const grupoControl = GRUPO_ID + "-control";

    await supabase.from("grupos_autorizados").insert({ usuario_id: USUARIO_ID, grupo_id: grupoControl, activo: true });
    await supabase.from("automation_configs").insert({
        usuario_id: USUARIO_ID, grupo_id: grupoControl, activo: true,
        dias_permitidos: { lunes: diasTodos, martes: diasTodos, miercoles: diasTodos, jueves: diasTodos, viernes: diasTodos, sabado: diasTodos, domingo: diasTodos },
        publicacion_inicial_tabla: { activo: true, hora: "00:00", dias_permitidos: { lunes: true, martes: true, miercoles: true, jueves: true, viernes: true, sabado: true, domingo: true } }
    });

    const eventoBotControl = await crearEventoBotReal("__TEST_PRODUCCION_REAL_CONTROL__");

    const evento2 = eventoDesde(eventoBotControl);
    evento2.grupo_id = grupoControl;

    // Nota: crearEventoBotReal() ya insertó con grupo_id=GRUPO_ID; para el
    // control necesitamos una fila real con el grupo_id del control.
    await supabase.from("eventos_bot").update({ grupo_id: grupoControl }).eq("id", eventoBotControl.id);
    evento2.id = eventoBotControl.id;

    const decision2 = await engine.onEventoDetectado(evento2);
    // Deliberadamente NO se llama marcarEventSessionAbierta() aquí.

    const enviadosAntesControl = enviados.length;
    await scheduler.tick({ context: { sessionId: SESSION_ID } });
    assert(enviados.length === enviadosAntesControl, "Una sesión que se queda en 'pendiente' sigue sin procesarse (confirma que la Prueba 3 dependía de la corrección real)");

    await supabase.from("event_sessions").delete().eq("id", decision2.eventSession.id);
    await supabase.from("automation_configs").delete().eq("grupo_id", grupoControl);
    await supabase.from("grupos_autorizados").delete().eq("grupo_id", grupoControl);
    await supabase.from("eventos_bot").delete().eq("grupo_id", grupoControl);

    // ============= LIMPIEZA =============
    console.log("\n========== LIMPIEZA ==========");
    await limpiar();
    await new Promise(resolve => servidorTablas.close(resolve));
    console.log("Grupo/config/event_session/acciones de prueba eliminados. Servidor de prueba cerrado.");

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
