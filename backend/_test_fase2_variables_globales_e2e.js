// Fase 2 — sistema global de variables: prueba de INTEGRACIÓN REAL (sin
// mocks en la capa Supabase) de que "consulta_pago" y "multiple" — antes
// hardcodeados — ahora SÍ pueden usar una plantilla del panel, con las
// variables globales nuevas resolviendo datos reales. Mismo patrón que
// _test_fase7_dinamismo.js: código de producción tal cual, solo se
// sustituyen sendMessage (Baileys) y suggestReply (Gemini). Limpia todo lo
// que crea al final.
require("dotenv").config();

const path = require("path");
const AI_DIR = path.join(__dirname, "bot", "ai");

function fakeModule(modId, exportsObj) {
    const resolved = require.resolve(modId, { paths: [AI_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const enviados = [];

fakeModule("../../services/baileys/send", {
    sendMessage: async ({ text }) => { enviados.push(text); }
});

const aiServiceFake = {
    suggestReply: async () => ({ respuesta: "[[GEMINI_FALLBACK]]" })
};
fakeModule("./aiService", aiServiceFake);

const { responderResultado } = require(path.join(AI_DIR, "responderResultado.js"));
const supabase = require("./lib/supabase");

const USUARIO_ID = "2491cbd0-5fb5-4cef-a06d-6092e69d40c4";

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

function ctxBase(consulta) {

    enviados.length = 0;

    return {
        consulta,
        chat: { remoteJid: "test@g.us" },
        message: { key: { fromMe: false, id: "m-test" } },
        usuario: { nombre: "Andrés", telefono: "3001234567" },
        evento: { nombre_evento: "Sorteo Fase2", valor: 5000, premios: [{ premio: "Nevera" }] },
        session: { usuarioId: USUARIO_ID, sessionId: "s-test" },
        textoOriginal: "cuanto debo",
        sock: {}
    };

}

async function limpiar(tipos) {
    await supabase.from("plantillas_mensaje").delete().eq("usuario_id", USUARIO_ID).in("tipo_respuesta", tipos);
    await supabase.from("configuracion_seleccion_mensajes").delete().eq("usuario_id", USUARIO_ID).in("tipo_respuesta", tipos);
}

async function main() {

    console.log("\n========== SETUP ==========");
    await limpiar(["consulta_pago", "multiple"]);
    console.log("Sin plantillas/config previas para consulta_pago/multiple (usuario de prueba).");

    // ============= PRUEBA 1: consulta_pago SIN plantilla -> fallback igual que hoy =============
    // ANTES de esta fase, consulta_pago/multiple NUNCA tenían plantilla
    // posible (no existían como tipo en el panel) — por eso el 100% de sus
    // respuestas ya pasaban por Gemini (suggestReply), igual que cualquier
    // otro tipo sin plantilla habilitada. Esta prueba confirma que ese
    // camino sigue exactamente igual (cero regresión) cuando no hay
    // plantilla configurada.
    console.log("\n========== PRUEBA 1: consulta_pago sin plantilla -> comportamiento actual sin cambios (Gemini redacta) ==========");

    const resultadoMonto = {
        tipo: "consulta_pago", modo: "monto", bucket: "pendiente",
        montoTotal: 50000, montoPagado: 30000, montoPendiente: 20000,
        mensaje: "💰 Tienes pendiente por pagar: $20.000."
    };

    await responderResultado(ctxBase(resultadoMonto));
    assert(enviados[0] === "[[GEMINI_FALLBACK]]", `Sin plantilla, sigue yendo a Gemini exactamente igual que antes de esta fase (obtenido: "${enviados[0]}")`);

    // ============= PRUEBA 2: consulta_pago CON plantilla nueva usando variables globales =============
    console.log("\n========== PRUEBA 2: consulta_pago con plantilla personalizada (variables de pago) ==========");

    const { data: plantillaPago } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: "consulta_pago", nombre: "__TEST_FASE2_PAGO__",
        estilo: "personalizada",
        contenido: "{{cliente}}, tu total es {{monto_total}}, ya pagaste {{monto_pagado}} y debes {{monto_pendiente}}.",
        variables: {}, habilitada: true, orden: 0
    }).select().single();

    await supabase.from("configuracion_seleccion_mensajes").upsert({
        usuario_id: USUARIO_ID, tipo_respuesta: "consulta_pago", modo_seleccion: "fijo", plantilla_fija_id: plantillaPago.id
    }, { onConflict: "usuario_id,tipo_respuesta" });

    await responderResultado(ctxBase(resultadoMonto));
    const esperado1 = "Andrés, tu total es $50.000, ya pagaste $30.000 y debes $20.000.";
    assert(enviados[0] === esperado1, `Plantilla real resuelve las variables de pago reales (obtenido: "${enviados[0]}")`);
    assert(!/undefined|null|\[object Object\]/.test(enviados[0]), "El texto enviado no contiene undefined/null/[object Object]");

    // ============= PRUEBA 3: consulta_pago modo=lista (otra faceta real) =============
    console.log("\n========== PRUEBA 3: consulta_pago modo=lista — otra faceta real, misma plantilla de tipo distinto ==========");

    const { data: plantillaLista } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: "consulta_pago", nombre: "__TEST_FASE2_PAGO_LISTA__",
        estilo: "personalizada",
        contenido: "{{cliente}}, pagados {{numeros_pagados}} | pendientes {{numeros_pendientes}} | total {{numeros_totales_cliente}}",
        variables: {}, habilitada: true, orden: 1
    }).select().single();

    await supabase.from("configuracion_seleccion_mensajes").update({
        plantilla_fija_id: plantillaLista.id
    }).eq("usuario_id", USUARIO_ID).eq("tipo_respuesta", "consulta_pago");

    const resultadoLista = {
        tipo: "consulta_pago", modo: "lista", bucket: "pagado",
        total: 5, reservados: ["23", "45"], pagados: ["12", "27", "60"], numerosDelUsuario: ["12", "23", "27", "45", "60"],
        mensaje: "✅ Números pagados: ( 12 - 27 - 60 )."
    };

    await responderResultado(ctxBase(resultadoLista));
    const esperado2 = "Andrés, pagados ( 12 - 27 - 60 ) | pendientes ( 23 - 45 ) | total ( 12 - 23 - 27 - 45 - 60 )";
    assert(enviados[0] === esperado2, `Faceta modo=lista resuelve numeros_pagados/pendientes/totales_cliente reales (obtenido: "${enviados[0]}")`);

    // ============= PRUEBA 4: "multiple" SIN plantilla -> fallback igual que hoy =============
    console.log("\n========== PRUEBA 4: multiple sin plantilla -> comportamiento actual sin cambios ==========");

    const resultadoMultiple = {
        tipo: "multiple",
        resultados: [
            { tipo: "mis_numeros", numerosDelUsuario: ["12", "45"], mensaje: "Tus números son: ( 12 - 45 )" },
            { tipo: "consulta_pago", modo: "monto", bucket: "pendiente", montoTotal: 20000, montoPagado: 0, montoPendiente: 20000, mensaje: "💰 Tienes pendiente por pagar: $20.000." }
        ],
        mensaje: "Tus números son: ( 12 - 45 )\n💰 Tienes pendiente por pagar: $20.000."
    };

    await responderResultado(ctxBase(resultadoMultiple));
    assert(enviados[0] === "[[GEMINI_FALLBACK]]", `Sin plantilla, "multiple" sigue yendo a Gemini exactamente igual que antes (obtenido: "${enviados[0]}")`);

    // ============= PRUEBA 5: "multiple" CON plantilla personalizada =============
    console.log("\n========== PRUEBA 5: multiple con plantilla personalizada (variables de varias facetas) ==========");

    const { data: plantillaMultiple } = await supabase.from("plantillas_mensaje").insert({
        usuario_id: USUARIO_ID, tipo_respuesta: "multiple", nombre: "__TEST_FASE2_MULTIPLE__",
        estilo: "personalizada",
        contenido: "Hola {{cliente}} 👋\n🎟️ Tus números: {{numeros_totales_cliente}}\n💰 Pendiente: {{monto_pendiente}}",
        variables: {}, habilitada: true, orden: 0
    }).select().single();

    await supabase.from("configuracion_seleccion_mensajes").upsert({
        usuario_id: USUARIO_ID, tipo_respuesta: "multiple", modo_seleccion: "fijo", plantilla_fija_id: plantillaMultiple.id
    }, { onConflict: "usuario_id,tipo_respuesta" });

    await responderResultado(ctxBase(resultadoMultiple));
    const esperado3 = "Hola Andrés 👋\n🎟️ Tus números: ( 12 - 45 )\n💰 Pendiente: $20.000";
    assert(enviados[0] === esperado3, `Plantilla de "multiple" resuelve variables de DISTINTAS facetas dentro de resultados[] (obtenido: "${enviados[0]}")`);
    assert(!/undefined|null|\[object Object\]/.test(enviados[0]), "El texto de 'multiple' no contiene undefined/null/[object Object]");

    // ============= PRUEBA 6: "multiple" con un combo que NO trae pago -> el campo de pago queda vacío, nunca inventado =============
    console.log("\n========== PRUEBA 6: multiple sin faceta de pago -> {{monto_pendiente}} vacío, no inventado ==========");

    const resultadoSoloNumeros = {
        tipo: "multiple",
        resultados: [{ tipo: "mis_numeros", numerosDelUsuario: ["09"], mensaje: "Tu número es: ( 09 )" }],
        mensaje: "Tu número es: ( 09 )"
    };

    await responderResultado(ctxBase(resultadoSoloNumeros));
    const esperado4 = "Hola Andrés 👋\n🎟️ Tus números: ( 09 )\n💰 Pendiente: ";
    assert(enviados[0] === esperado4, `Sin faceta de pago en el combo, {{monto_pendiente}} queda vacío, nunca "undefined" (obtenido: "${JSON.stringify(enviados[0])}")`);

    // ============= LIMPIEZA =============
    console.log("\n========== LIMPIEZA ==========");
    await limpiar(["consulta_pago", "multiple"]);
    console.log("Plantillas y config de prueba eliminadas (consulta_pago / multiple).");

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
        await limpiar(["consulta_pago", "multiple"]);
        console.log("Limpieza de emergencia ejecutada.");
    } catch (e) {
        console.error("No se pudo limpiar automáticamente:", e.message);
    }

    process.exitCode = 1;

});
