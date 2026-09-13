// INICIO DEL DÍA (Master Spec §15) — prueba de INTEGRACIÓN REAL (Supabase
// real, sin mocks de datos) sobre el flujo EXISTENTE: scheduler.js real,
// eventRules.js real, ExecutionGuard real, catálogo/resolver GLOBAL real
// (backend/shared/variables), plantillas_mensaje real. Solo se sustituye
// el envío final a WhatsApp (sendMessage) — mismo criterio que el resto
// de _test_*.js de este proyecto.
//
// Checklist verificado (pedido explícitamente):
//   1. scheduler detecta Inicio del día
//   2. selecciona una plantilla (al azar, entre varias activas)
//   3. resuelve las variables (catálogo global — nunca inventa)
//   4. envía el mensaje al grupo correcto
//   5. registra la ejecución (automation_actions, DAILY_START_MESSAGE)
//   6. un segundo tick NO vuelve a enviarlo (idempotencia real)
//   7. otro grupo/evento no recibe el mensaje incorrectamente
require("dotenv").config();

const path = require("path");
const AUTOMATION_DIR = path.join(__dirname, "automation");

function fakeModule(modId, exportsObj) {
    const resolved = require.resolve(modId, { paths: [AUTOMATION_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const enviados = [];

fakeModule("../services/baileys/send", {
    sendMessage: async ({ jid, text }) => { enviados.push({ jid, text }); },
    sendImage: async () => { throw new Error("Inicio del día no debe usar sendImage — es solo texto."); }
});

const scheduler = require(path.join(AUTOMATION_DIR, "scheduler.js"));
const supabase = require("./lib/supabase");

const USUARIO_ID = "2491cbd0-5fb5-4cef-a06d-6092e69d40c4";
const GRUPO_ID = "999999999999999999-testiniciodia@g.us";
const GRUPO_ID_OTRO = "999999999999999999-testiniciodia-otro@g.us";
// tick() solo exige sessionId para el barrido de event_sessions (que aquí
// da vacío — es un SELECT, nunca un INSERT, así que no hace falta que
// corresponda a una fila real de "sesiones"), pero la columna sí es uuid
// y Postgres valida el formato incluso en un SELECT sin resultados. El
// usuarioId sí debe ser real para automation_configs/plantillas_mensaje.
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

let pasaron = 0, fallaron = 0;
const fallos = [];

function assert(cond, msg) {
    if (cond) { pasaron++; console.log("✅", msg); }
    else { fallaron++; fallos.push(msg); console.log("❌", msg); }
}

async function limpiar(grupoId) {
    await supabase.from("automation_actions").delete().eq("grupo_id", grupoId);
    await supabase.from("automation_configs").delete().eq("usuario_id", USUARIO_ID).eq("grupo_id", grupoId);
    await supabase.from("grupos_autorizados").delete().eq("usuario_id", USUARIO_ID).eq("grupo_id", grupoId);
}

async function limpiarPlantillas(nombres) {
    await supabase.from("plantillas_mensaje").delete().eq("usuario_id", USUARIO_ID).in("nombre", nombres);
}

async function main() {

    console.log("\n========== SETUP ==========");

    const nombresPlantillas = ["__TEST_INICIO_DIA_A__", "__TEST_INICIO_DIA_B__", "__TEST_INICIO_DIA_VAR__"];

    await limpiar(GRUPO_ID);
    await limpiar(GRUPO_ID_OTRO);
    await limpiarPlantillas(nombresPlantillas);

    const diasTodos = { activo: true, desde: "00:00", hasta: "23:59" };
    const inicioDiaActivo = {
        activo: true, hora: "00:00",
        dias_permitidos: { lunes: true, martes: true, miercoles: true, jueves: true, viernes: true, sabado: true, domingo: true }
    };

    // Grupo A: autorizado, con Inicio del día activo y 3 plantillas reales
    // habilitadas (2 sin variables, 1 con {{evento}} — para probar que
    // resuelve sin inventar cuando no hay evento en contexto).
    await supabase.from("grupos_autorizados").insert({ usuario_id: USUARIO_ID, grupo_id: GRUPO_ID, activo: true });
    await supabase.from("automation_configs").insert({
        usuario_id: USUARIO_ID, grupo_id: GRUPO_ID, activo: true,
        dias_permitidos: { lunes: diasTodos, martes: diasTodos, miercoles: diasTodos, jueves: diasTodos, viernes: diasTodos, sabado: diasTodos, domingo: diasTodos },
        mensaje_inicio_dia: inicioDiaActivo
    });

    const { data: plantillaA } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: "inicio_dia", nombre: "__TEST_INICIO_DIA_A__",
        estilo: "personalizada", contenido: "☀️ ¡Buenos días, familia A!", variables: {}, habilitada: true, orden: 0
    }).select().single();

    const { data: plantillaB } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: "inicio_dia", nombre: "__TEST_INICIO_DIA_B__",
        estilo: "personalizada", contenido: "🌅 ¡Buenos días, familia B!", variables: {}, habilitada: true, orden: 1
    }).select().single();

    const { data: plantillaVar } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: "inicio_dia", nombre: "__TEST_INICIO_DIA_VAR__",
        estilo: "personalizada", contenido: "🎯 {{nombre_evento}} 🎰 {{loteria}} 🏆 {{premio}} FIN", variables: {}, habilitada: false, orden: 2
        // habilitada:false a propósito en este bloque — se activa más abajo, aparte, para aislar esa verificación.
    }).select().single();

    // Grupo OTRO: autorizado, PERO sin Inicio del día activo — control de
    // aislamiento (punto 7 del checklist).
    await supabase.from("grupos_autorizados").insert({ usuario_id: USUARIO_ID, grupo_id: GRUPO_ID_OTRO, activo: true });
    await supabase.from("automation_configs").insert({
        usuario_id: USUARIO_ID, grupo_id: GRUPO_ID_OTRO, activo: true,
        dias_permitidos: { lunes: diasTodos, martes: diasTodos, miercoles: diasTodos, jueves: diasTodos, viernes: diasTodos, sabado: diasTodos, domingo: diasTodos },
        mensaje_inicio_dia: { activo: false }
    });

    console.log("Grupos/config/plantillas de prueba creados.");

    // ============= PUNTOS 1-4: detecta, selecciona, resuelve, envía =============
    console.log("\n========== PUNTOS 1-4: scheduler.tick() detecta Inicio del día, selecciona y envía ==========");

    const vistos = new Set();

    for (let i = 0; i < 12; i++) {

        // Cada intento usa una clave de idempotencia distinta (grupo
        // ligeramente distinto) SOLO para poder observar la selección
        // aleatoria varias veces sin que ExecutionGuard bloquee el resto —
        // el grupo real de la Prueba 1 se evalúa aparte, una sola vez.
        const grupoMuestra = `${GRUPO_ID}-muestra-${i}`;
        await supabase.from("grupos_autorizados").insert({ usuario_id: USUARIO_ID, grupo_id: grupoMuestra, activo: true });
        await supabase.from("automation_configs").insert({
            usuario_id: USUARIO_ID, grupo_id: grupoMuestra, activo: true,
            dias_permitidos: { lunes: diasTodos, martes: diasTodos, miercoles: diasTodos, jueves: diasTodos, viernes: diasTodos, sabado: diasTodos, domingo: diasTodos },
            mensaje_inicio_dia: inicioDiaActivo
        });

        await scheduler.tick({ context: { sessionId: SESSION_ID, usuarioId: USUARIO_ID } });

        const envio = enviados.find(e => e.jid === grupoMuestra);
        if (envio) vistos.add(envio.text);

        await supabase.from("automation_configs").delete().eq("grupo_id", grupoMuestra);
        await supabase.from("grupos_autorizados").delete().eq("grupo_id", grupoMuestra);
        await supabase.from("automation_actions").delete().eq("grupo_id", grupoMuestra);

    }

    assert(vistos.size === 2, `La selección al azar usó AMBAS plantillas activas a lo largo de 12 intentos (obtenido: ${vistos.size} texto(s) distintos: ${JSON.stringify([...vistos])})`);
    assert([...vistos].every(t => t === plantillaA.contenido || t === plantillaB.contenido), "Todos los textos enviados son exactamente el contenido real de A o B (nunca inventado)");

    // El grupo real (GRUPO_ID) comparte el mismo usuarioId que los grupos
    // de muestra de arriba, así que cada tick() del bucle YA lo evaluó de
    // paso — su envío real (único, por idempotencia) ya ocurrió durante la
    // PRIMERA vuelta del bucle, no después. Se verifica sobre lo ya
    // capturado en vez de esperar un envío nuevo aquí (que ExecutionGuard
    // correctamente ya bloquearía, siendo el mismo día).
    const envioReal = enviados.find(e => e.jid === GRUPO_ID);

    assert(!!envioReal, `El grupo real recibió exactamente 1 envío durante el barrido (obtenido: ${enviados.filter(e => e.jid === GRUPO_ID).length})`);
    assert(enviados.filter(e => e.jid === GRUPO_ID).length === 1, "Nunca más de 1 envío real al grupo principal en todo el barrido (idempotencia ya activa desde el primer tick)");
    assert(envioReal?.jid === GRUPO_ID, "El mensaje se dirige al grupo correcto (punto 4)");
    assert(envioReal?.text === plantillaA.contenido || envioReal?.text === plantillaB.contenido, "El texto enviado es el contenido real de una plantilla habilitada (punto 2)");

    // ============= PUNTO 3 (variables): {{evento}} sin evento -> "" nunca inventado =============
    console.log("\n========== PUNTO 3: variables del catálogo global — sin evento en contexto, nunca inventa ==========");

    // Se aísla en su propio grupo para no interferir con la selección
    // aleatoria ya verificada arriba.
    const grupoVar = `${GRUPO_ID}-variables`;
    await supabase.from("grupos_autorizados").insert({ usuario_id: USUARIO_ID, grupo_id: grupoVar, activo: true });
    await supabase.from("automation_configs").insert({
        usuario_id: USUARIO_ID, grupo_id: grupoVar, activo: true,
        dias_permitidos: { lunes: diasTodos, martes: diasTodos, miercoles: diasTodos, jueves: diasTodos, viernes: diasTodos, sabado: diasTodos, domingo: diasTodos },
        mensaje_inicio_dia: inicioDiaActivo
    });
    await supabase.from("plantillas_mensaje").update({ habilitada: true }).eq("id", plantillaVar.id);
    // Aislar: deshabilitar A/B temporalmente para que SOLO la de variables se use aquí.
    await supabase.from("plantillas_mensaje").update({ habilitada: false }).in("id", [plantillaA.id, plantillaB.id]);

    enviados.length = 0;
    await scheduler.tick({ context: { sessionId: SESSION_ID, usuarioId: USUARIO_ID } });

    const envioVar = enviados.find(e => e.jid === grupoVar);
    assert(!!envioVar, "Se envió el mensaje con variables para el grupo de la prueba de variables");
    assert(envioVar?.text === "🎯  🎰  🏆  FIN", `{{nombre_evento}}/{{loteria}}/{{premio}} resuelven a "" sin evento en contexto — nunca undefined/null (obtenido: ${JSON.stringify(envioVar?.text)})`);
    assert(!/undefined|null|\[object Object\]/.test(envioVar?.text || ""), "El texto no contiene undefined/null/[object Object]");

    await supabase.from("plantillas_mensaje").update({ habilitada: true }).in("id", [plantillaA.id, plantillaB.id]);
    await supabase.from("automation_configs").delete().eq("grupo_id", grupoVar);
    await supabase.from("grupos_autorizados").delete().eq("grupo_id", grupoVar);
    await supabase.from("automation_actions").delete().eq("grupo_id", grupoVar);

    // ============= PUNTO 5: registro real en automation_actions =============
    console.log("\n========== PUNTO 5: automation_actions registra DAILY_START_MESSAGE ==========");

    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const claveEsperada = `${GRUPO_ID}:DAILY_START_MESSAGE:${hoy}`;

    const { data: accion } = await supabase.from("automation_actions")
        .select("*").eq("clave_idempotencia", claveEsperada).maybeSingle();

    assert(accion?.estado === "ok", `automation_actions registra DAILY_START_MESSAGE como 'ok' con la clave exacta del Master Spec §8 (obtenido: ${accion?.estado}, clave=${claveEsperada})`);
    assert(accion?.event_session_id === null, "event_session_id queda NULL — Inicio del día no pertenece a ningún Event Session (Master Spec §15)");

    // ============= PUNTO 6: idempotencia — un segundo tick NO reenvía =============
    console.log("\n========== PUNTO 6: un segundo tick() no vuelve a enviar ==========");

    enviados.length = 0;
    await scheduler.tick({ context: { sessionId: SESSION_ID, usuarioId: USUARIO_ID } });

    assert(enviados.filter(e => e.jid === GRUPO_ID).length === 0, "Sin envíos nuevos al grupo real tras un segundo tick (idempotencia real vía ExecutionGuard)");

    // ============= PUNTO 7: aislamiento — otro grupo no recibe nada =============
    console.log("\n========== PUNTO 7: otro grupo (Inicio del día inactivo) no recibe nada ==========");

    assert(enviados.filter(e => e.jid === GRUPO_ID_OTRO).length === 0, "El grupo OTRO (mensaje_inicio_dia.activo=false) nunca recibió nada");

    // ============= LIMPIEZA =============
    console.log("\n========== LIMPIEZA ==========");
    await limpiar(GRUPO_ID);
    await limpiar(GRUPO_ID_OTRO);
    await limpiarPlantillas(nombresPlantillas);
    console.log("Grupos/config/plantillas/acciones de prueba eliminados.");

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
        await limpiar(GRUPO_ID);
        await limpiar(GRUPO_ID_OTRO);
        await limpiarPlantillas(["__TEST_INICIO_DIA_A__", "__TEST_INICIO_DIA_B__", "__TEST_INICIO_DIA_VAR__"]);
        for (let i = 0; i < 12; i++) {
            const g = `${GRUPO_ID}-muestra-${i}`;
            await supabase.from("automation_configs").delete().eq("grupo_id", g);
            await supabase.from("grupos_autorizados").delete().eq("grupo_id", g);
            await supabase.from("automation_actions").delete().eq("grupo_id", g);
        }
        await supabase.from("automation_configs").delete().eq("grupo_id", `${GRUPO_ID}-variables`);
        await supabase.from("grupos_autorizados").delete().eq("grupo_id", `${GRUPO_ID}-variables`);
        await supabase.from("automation_actions").delete().eq("grupo_id", `${GRUPO_ID}-variables`);
        console.log("Limpieza de emergencia ejecutada.");
    } catch (e) {
        console.error("No se pudo limpiar automáticamente:", e.message);
    }

    process.exitCode = 1;

});
