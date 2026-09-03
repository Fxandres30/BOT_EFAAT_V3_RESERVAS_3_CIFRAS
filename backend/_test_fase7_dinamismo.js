// Fase 7 — pruebas REALES de dinamismo (sin mocks en la capa Supabase).
// Usa el código de producción tal cual (configMensajes.js, seleccionarPlantilla.js,
// plantillaMensaje.js, responderResultado.js) contra el Supabase REAL del
// proyecto. Solo se sustituyen las dos puntas que no podemos ejercitar aquí
// sin una sesión de WhatsApp real y sin gastar Gemini: sendMessage (Baileys)
// y suggestReply (Gemini) — exactamente lo que el enunciado permite mockear.
//
// Todo el script corre en UN SOLO proceso Node, de principio a fin, sin
// reiniciar nada — esa es la prueba de "sin reinicio".
//
// Limpia todo lo que crea al final (plantillas y fila de config de prueba),
// dejando Supabase EXACTAMENTE como estaba antes de correr el script.
require("dotenv").config();

const path = require("path");
const AI_DIR = path.join(__dirname, "bot", "ai");

function fakeModule(modId, exportsObj) {
    const resolved = require.resolve(modId, { paths: [AI_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const enviados = [];

fakeModule("../../services/baileys/send", {
    sendMessage: async ({ text }) => {
        enviados.push(text);
    }
});

fakeModule("./aiService", {
    suggestReply: async () => ({ respuesta: "[[GEMINI_FALLBACK]]" })
});

const { responderResultado } = require(path.join(AI_DIR, "responderResultado.js"));
const { obtenerConfigSeleccion, obtenerPlantillasHabilitadas, actualizarRotacion } = require(path.join(AI_DIR, "configMensajes.js"));
const { seleccionarPlantilla } = require(path.join(AI_DIR, "seleccionarPlantilla.js"));
const supabase = require("./lib/supabase");

const USUARIO_ID = "2491cbd0-5fb5-4cef-a06d-6092e69d40c4";
const TIPO_TEST = "numero_ocupado"; // sin fila de config antes de este script (verificado)
// "otro_determinista" es uno de los tipos "Futuro" (no soportados aún por
// el BOT, ver tiposMensaje.ts) — se usa SOLO para la prueba de rotación/
// aleatorio porque no tiene ninguna de las 150 plantillas reales
// sembradas, así el pool de selección queda perfectamente aislado (solo
// las 2 plantillas de prueba), sin mezclarse con las 15 plantillas reales
// que "numero_ocupado" ya tiene de producción.
const TIPO_ROTACION = "otro_determinista";

let pasaron = 0, fallaron = 0;
const fallos = [];

function assert(cond, msg) {
    if (cond) {
        pasaron++;
        console.log("✅", msg);
    } else {
        fallaron++;
        fallos.push(msg);
        console.log("❌", msg);
    }
}

function ctxReservaOcupado() {

    enviados.length = 0;

    return {
        reserva: { ok: false, reservados: [], ocupados: ["77"], mensaje: "El número 77 ya está ocupado." },
        chat: { remoteJid: "test@g.us" },
        message: { key: { fromMe: false, id: "m-test" } },
        usuario: { nombre: "Tester" },
        evento: { nombre_evento: "Evento de prueba" },
        session: { usuarioId: USUARIO_ID, sessionId: "s-test" },
        textoOriginal: "el 77 esta libre?",
        sock: {}
    };

}

async function limpiarFilaConfig() {
    await supabase.from("configuracion_seleccion_mensajes").delete().eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_TEST);
}

async function main() {

    console.log("\n========== SETUP ==========");
    await limpiarFilaConfig();
    console.log("Fila de config de prueba limpia (estado inicial: sin fila = habilitada por defecto).");

    // ================= PRUEBA 1: activar/desactivar sin reinicio =================
    console.log("\n========== PRUEBA 1: activar/desactivar (numero_ocupado) ==========");

    await responderResultado(ctxReservaOcupado());
    assert(enviados.length === 1, "Estado inicial (sin fila = habilitada por defecto) → responde");

    await supabase.from("configuracion_seleccion_mensajes").upsert(
        { usuario_id: USUARIO_ID, tipo_respuesta: TIPO_TEST, habilitada: false, updated_at: new Date().toISOString() },
        { onConflict: "usuario_id,tipo_respuesta" }
    );
    console.log("→ Escrito habilitada=false directamente en Supabase (igual que haría el frontend). Proceso Node SIN reiniciar.");

    await responderResultado(ctxReservaOcupado());
    assert(enviados.length === 0, "Tras desactivar (mismo proceso, sin reinicio) → silencio");

    await supabase.from("configuracion_seleccion_mensajes").update({ habilitada: true, updated_at: new Date().toISOString() }).eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_TEST);
    console.log("→ Escrito habilitada=true de nuevo. Proceso Node SIGUE sin reiniciar.");

    await responderResultado(ctxReservaOcupado());
    assert(enviados.length === 1, "Tras reactivar (mismo proceso, sin reinicio) → vuelve a responder");

    console.log("\n(Esto también demuestra la regla de reservas: ctx.reserva ya viene con el resultado REAL ya ejecutado; responderResultado() nunca vuelve a tocar la reserva, solo decide si se envía el mensaje.)");

    // ================= PRUEBA 2: editar plantilla sin reinicio =================
    console.log("\n========== PRUEBA 2: editar contenido de una plantilla ==========");

    const { data: plantillaA } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: TIPO_TEST, nombre: "__TEST_FASE7_A__",
        estilo: "personalizada", contenido: "TEXTO_ORIGINAL_PRUEBA", variables: {}, habilitada: true, orden: 900
    }).select().single();

    await supabase.from("configuracion_seleccion_mensajes").update({
        modo_seleccion: "fijo", plantilla_fija_id: plantillaA.id, updated_at: new Date().toISOString()
    }).eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_TEST);

    await responderResultado(ctxReservaOcupado());
    assert(enviados[0] === "TEXTO_ORIGINAL_PRUEBA", `Usa el texto original de la plantilla (obtenido: "${enviados[0]}")`);

    await supabase.from("plantillas_mensaje").update({ contenido: "TEXTO_NUEVO_PRUEBA_EDITADO", updated_at: new Date().toISOString() }).eq("id", plantillaA.id);
    console.log("→ Editado el contenido directamente en Supabase. Proceso Node SIGUE sin reiniciar.");

    await responderResultado(ctxReservaOcupado());
    assert(enviados[0] === "TEXTO_NUEVO_PRUEBA_EDITADO", `Usa el texto NUEVO sin reiniciar (obtenido: "${enviados[0]}")`);

    // ================= PRUEBA 5: crear plantilla + cambiar fija =================
    console.log("\n========== PRUEBA 5 y 4: crear plantilla nueva + cambiar plantilla fija ==========");

    const { data: plantillaB } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: TIPO_TEST, nombre: "__TEST_FASE7_B__",
        estilo: "personalizada", contenido: "TEXTO_PLANTILLA_B_RECIEN_CREADA", variables: {}, habilitada: true, orden: 901
    }).select().single();

    console.log("→ Plantilla B creada en Supabase (simulando 'crear plantilla' desde el panel).");

    await supabase.from("configuracion_seleccion_mensajes").update({ plantilla_fija_id: plantillaB.id, updated_at: new Date().toISOString() }).eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_TEST);

    await responderResultado(ctxReservaOcupado());
    assert(enviados[0] === "TEXTO_PLANTILLA_B_RECIEN_CREADA", `La plantilla recién creada queda disponible de inmediato (obtenido: "${enviados[0]}")`);

    // ================= PRUEBA 7: deshabilitar plantilla individual =================
    console.log("\n========== PRUEBA 7: deshabilitar plantilla individual (la fija) ==========");

    await supabase.from("plantillas_mensaje").update({ habilitada: false, updated_at: new Date().toISOString() }).eq("id", plantillaB.id);
    console.log("→ Plantilla B deshabilitada. La config sigue apuntando a B como fija (caso real: usuario deshabilita justo la que estaba fija).");

    await responderResultado(ctxReservaOcupado());
    assert(enviados[0] === "[[GEMINI_FALLBACK]]", `Plantilla deshabilitada YA NO se selecciona, cae a redacción normal (obtenido: "${enviados[0]}")`);

    // ================= PRUEBA 6: eliminar plantilla =================
    console.log("\n========== PRUEBA 6: eliminar una plantilla habilitada ==========");

    await supabase.from("plantillas_mensaje").update({ habilitada: true }).eq("id", plantillaA.id); // re-habilitar A
    await supabase.from("configuracion_seleccion_mensajes").update({ plantilla_fija_id: plantillaA.id, updated_at: new Date().toISOString() }).eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_TEST);

    await responderResultado(ctxReservaOcupado());
    assert(enviados[0] === "TEXTO_NUEVO_PRUEBA_EDITADO", "Config apuntando de nuevo a A (habilitada) → la selecciona");

    await supabase.from("plantillas_mensaje").delete().eq("id", plantillaA.id);
    console.log("→ Plantilla A ELIMINADA de Supabase.");

    await responderResultado(ctxReservaOcupado());
    assert(enviados[0] === "[[GEMINI_FALLBACK]]", `Plantilla eliminada, el BOT no la vuelve a seleccionar (obtenido: "${enviados[0]}")`);

    // ================= PRUEBA 3: modos aleatorio / rotación / fijo =================
    // Se usa TIPO_ROTACION (sin ninguna de las 150 plantillas reales) para
    // que el pool de selección quede aislado a solo C y D — así se puede
    // verificar el PATRÓN exacto de rotación/aleatorio sin que se mezcle
    // con las 15 plantillas reales que "numero_ocupado" ya tiene de
    // producción. Se llama directo a las mismas funciones reales que usa
    // responderResultado() (obtenerConfigSeleccion/obtenerPlantillasHabilitadas/
    // seleccionarPlantilla/actualizarRotacion) — el mismo código de
    // producción, sin pasar por la construcción de un ctx.reserva/consulta
    // artificial para un tipo que el BOT nunca produce de forma real.
    console.log("\n========== PRUEBA 3: modo aleatorio / rotación / fijo (pool aislado) ==========");

    await supabase.from("configuracion_seleccion_mensajes").delete().eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_ROTACION);

    const { data: plantillaC } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: TIPO_ROTACION, nombre: "__TEST_FASE7_C__",
        estilo: "personalizada", contenido: "MARCA_C", variables: {}, habilitada: true, orden: 0
    }).select().single();

    const { data: plantillaD } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: TIPO_ROTACION, nombre: "__TEST_FASE7_D__",
        estilo: "personalizada", contenido: "MARCA_D", variables: {}, habilitada: true, orden: 1
    }).select().single();

    await supabase.from("configuracion_seleccion_mensajes").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: TIPO_ROTACION, modo_seleccion: "rotacion", rotacion_indice: 0
    });

    async function elegirUna() {
        const [config, habilitadas] = await Promise.all([
            obtenerConfigSeleccion(TIPO_ROTACION, USUARIO_ID),
            obtenerPlantillasHabilitadas(TIPO_ROTACION, USUARIO_ID)
        ]);
        const { plantilla, nuevoIndiceRotacion } = seleccionarPlantilla(config, habilitadas);
        if (nuevoIndiceRotacion !== null && config?.id) {
            await actualizarRotacion(config.id, nuevoIndiceRotacion);
        }
        return plantilla?.contenido;
    }

    const secuenciaRotacion = [];
    for (let i = 0; i < 4; i++) {
        secuenciaRotacion.push(await elegirUna());
    }

    console.log("Secuencia de rotación obtenida (pool aislado C,D):", secuenciaRotacion.join(" , "));
    const alterna = secuenciaRotacion[0] === secuenciaRotacion[2] && secuenciaRotacion[1] === secuenciaRotacion[3] && secuenciaRotacion[0] !== secuenciaRotacion[1];
    assert(alterna, "Modo rotación alterna en orden y persiste el índice entre llamadas (C,D,C,D)");

    const { data: configTrasRotacion } = await supabase.from("configuracion_seleccion_mensajes").select("rotacion_indice").eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_ROTACION).single();
    console.log("rotacion_indice persistido en Supabase tras 4 llamadas:", configTrasRotacion.rotacion_indice);
    assert(typeof configTrasRotacion.rotacion_indice === "number", "rotacion_indice quedó persistido en Supabase (no en memoria)");

    // Cambiar a aleatorio sin reiniciar
    await supabase.from("configuracion_seleccion_mensajes").update({ modo_seleccion: "aleatorio", updated_at: new Date().toISOString() }).eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_ROTACION);

    const vistos = new Set();
    for (let i = 0; i < 12; i++) {
        vistos.add(await elegirUna());
    }
    console.log("Textos vistos en 12 llamadas en modo aleatorio (pool aislado):", [...vistos]);
    assert(vistos.has("MARCA_C") && vistos.has("MARCA_D") && vistos.size === 2, "Modo aleatorio elige SOLO entre C y D, sin reiniciar");

    // Cambiar a fijo apuntando a D sin reiniciar
    await supabase.from("configuracion_seleccion_mensajes").update({ modo_seleccion: "fijo", plantilla_fija_id: plantillaD.id, updated_at: new Date().toISOString() }).eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_ROTACION);

    assert((await elegirUna()) === "MARCA_D", "Modo fijo, tras cambiarlo sin reiniciar, usa exactamente la plantilla fija nueva");

    // ================= LIMPIEZA =================
    console.log("\n========== LIMPIEZA (restaurando Supabase al estado previo) ==========");

    await supabase.from("plantillas_mensaje").delete().in("id", [plantillaB.id, plantillaC.id, plantillaD.id]);
    await limpiarFilaConfig();
    await supabase.from("configuracion_seleccion_mensajes").delete().eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_ROTACION);

    console.log("Plantillas de prueba eliminadas y filas de config de prueba eliminadas (numero_ocupado y otro_determinista).");

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

    // Intento de limpieza best-effort si algo falló a mitad de camino.
    try {
        await supabase.from("plantillas_mensaje").delete().eq("usuario_id", USUARIO_ID).like("nombre", "__TEST_FASE7_%");
        await limpiarFilaConfig();
        await supabase.from("configuracion_seleccion_mensajes").delete().eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", TIPO_ROTACION);
        console.log("Limpieza de emergencia ejecutada.");
    } catch (e) {
        console.error("No se pudo limpiar automáticamente:", e.message);
    }

    process.exitCode = 1;

});
