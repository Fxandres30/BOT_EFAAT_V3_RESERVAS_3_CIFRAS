// ==========================================================================
// PRUEBAS — «Mis números» (respuesta principal) y sus preguntas puntuales.
//
// Cada pregunta llega a UNA intención con propósito propio y produce UN
// solo mensaje; la respuesta general nunca se repite dentro de una
// combinada. «Cancelé» = pagué: nunca se inventa un historial de
// cancelaciones (la tabla no lo conserva).
//
// Reales: detectarIntencion.js, resolverConsulta.js, consultarMisNumeros.js,
// responderResultado.js, plantillaMensaje.js, eventHandler.js. Simulados:
// Supabase, configMensajes, envío y Gemini.
//
//     node backend/tests/consultas/intencionesMisNumeros.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ------------------------------------------------- tabla del evento (fake) ---

const TABLA = "5k_15k_reservas_2_cifras";
const FILAS = [
    { usuario_id: "tenant-test", numero: "12", estado: "pagado", usuario_global_id: "u1", identidad_evento_real: "id-sorteo" },
    { usuario_id: "tenant-test", numero: "45", estado: "reservado", usuario_global_id: "u1", identidad_evento_real: "id-sorteo" }
];

const fakeSupabase = {
    from(tabla) {
        const b = {
            select() { return b; },
            order() { return b; },
            or() { return b; },
            eq() { return b; },
            neq() { return b; },
            in() { return b; },
            maybeSingle() { return b; },
            single() { return b; },
            then(ok, ko) {
                return Promise.resolve({ data: tabla === TABLA ? FILAS : [], error: null }).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

// ------------------------------------------------------------- espías ---

const espias = { enviados: [], gemini: 0 };
let apagados = new Set();

const PLANTILLAS = {
    mis_numeros: { id: "p-mis-numeros", contenido: "MIS_NUMEROS: {{numeros_totales_cliente}}", variables: {} }
};

inyectar(r("bot/ai/configMensajes.js"), {
    obtenerConfigSeleccion: async (tipo) => (PLANTILLAS[tipo] ? { id: "cfg-" + tipo, modo_seleccion: "fijo", plantilla_fija_id: PLANTILLAS[tipo].id } : null),
    obtenerPlantillasHabilitadas: async (tipo) => (PLANTILLAS[tipo] ? [PLANTILLAS[tipo]] : []),
    actualizarRotacion: async () => {},
    estaRespuestaHabilitada: async (_usuarioId, tipo) => !apagados.has(tipo)
});

inyectar(r("bot/ai/aiService.js"), {
    suggestReply: async () => { espias.gemini++; return { respuesta: "(inventado por IA)" }; }
});
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({}) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ text }) => { espias.enviados.push(text); },
    sendImage: async () => {}
});
inyectar(r("bot/funciones/reservas/detectarReserva.js"), {
    detectarReserva: async () => ({ ok: true, mensaje: "x" })
});

const EVENTO = { id: "ev-1", usuario_id: "tenant-test", nombre_evento: "Lotería De Manizales", tabla: TABLA, cifras: 2, identidad_evento_real: "id-sorteo", hora_fin: "22:30", valor: 3000 };

inyectar(r("bot/funciones/eventos/detectarEvento.js"), { detectarEvento: async () => null });
inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => EVENTO });
inyectar(r("bot/funciones/mensajes/cuentasIgnoradas.js"), { esCuentaIgnorada: () => false });

const { detectarIntencion } = require(r("bot/funciones/consultas/detectarIntencion.js"));
const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));
const eventHandler = require(r("bot/handlers/eventHandler.js"));

function reiniciar() {
    Object.assign(espias, { enviados: [], gemini: 0 });
    apagados = new Set();
}

function ctxMensaje(texto) {
    return {
        sock: {},
        session: { usuarioId: "tenant-1", sessionId: "s1" },
        chat: { remoteJid: "g@g.us", esGrupo: true },
        message: { key: { id: "M1", remoteJid: "g@g.us", fromMe: false }, message: { conversation: texto } },
        usuario: { id: "u1", nombre: "Cliente" },
        evento: EVENTO,
        textoOriginal: texto
    };
}

async function responder(texto) {
    reiniciar();
    await eventHandler(ctxMensaje(texto));
    return espias.enviados;
}

const veces = (texto, sub) => texto.split(sub).length - 1;

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

// Cada pregunta -> su intención. "mis_reservas" responde como la general.
const CASOS = [
    ["Mis números", { tipo: "mis_numeros" }],
    ["¿Cuáles son mis números?", { tipo: "mis_numeros" }],
    ["¿Qué tengo reservado?", { tipo: "mis_reservas" }],
    ["mis reservas", { tipo: "mis_reservas" }],
    ["¿Cuánto debo?", { tipo: "consulta_pago", modo: "resumen", bucket: "pendiente" }],
    ["¿Cuáles ya pagué?", { tipo: "consulta_pago", modo: "lista", bucket: "pagado" }],
    ["¿Cuáles pagué?", { tipo: "consulta_pago", modo: "lista", bucket: "pagado" }],
    ["que numeros pague", { tipo: "consulta_pago", modo: "lista", bucket: "pagado" }],
    ["¿Qué números cancelé?", { tipo: "consulta_pago", modo: "lista", bucket: "pagado" }],
    ["¿cuáles cancelé?", { tipo: "consulta_pago", modo: "lista", bucket: "pagado" }],
    ["que numeros he cancelado", { tipo: "consulta_pago", modo: "lista", bucket: "pagado" }],
    ["¿cuáles tengo pendientes?", { tipo: "consulta_pago", modo: "lista", bucket: "pendiente" }]
];

prueba("1. cada pregunta llega a su intención específica", async () => {
    for (const [texto, esperado] of CASOS) {
        const i = detectarIntencion(texto);
        for (const [k, v] of Object.entries(esperado)) {
            assert.strictEqual(i[k], v, `${texto} -> ${JSON.stringify(i)}`);
        }
    }
});

prueba("2. afirmaciones de pago siguen sin respuesta (no son preguntas)", async () => {
    assert.strictEqual(detectarIntencion("ya cancelé").tipo, "ninguna");
    assert.strictEqual(detectarIntencion("cancelé el 25").tipo, "ninguna");
    assert.strictEqual(detectarIntencion("ya pagué").tipo, "ninguna");
});

prueba("3. «mis números y mis reservas» (en cualquier orden) es UNA sola pregunta", async () => {
    assert.strictEqual(detectarIntencion("mis números y mis reservas").tipo, "mis_numeros");
    assert.notStrictEqual(detectarIntencion("mis reservas y mis números").tipo, "multiple");
    for (const texto of ["mis números y mis reservas", "mis reservas y mis números"]) {
        const enviados = await responder(texto);
        assert.strictEqual(enviados.length, 1, texto);
        assert.strictEqual(veces(enviados[0], "12"), 1, enviados[0]);
    }
});

prueba("4. general + lista de pagados: la lista no se repite", async () => {
    const i = detectarIntencion("mis números y cuáles ya pagué");
    assert.strictEqual(i.tipo, "multiple");
    const res = await resolverConsulta({ ...i, evento: EVENTO, usuario: { id: "u1" } });
    assert.deepStrictEqual(res.resultados.map(x => x.tipo), ["mis_numeros"]);

    const enviados = await responder("mis números y cuáles ya pagué");
    assert.strictEqual(enviados.length, 1);
    assert.ok(!/Números pagados/.test(enviados[0]), enviados[0]);
    assert.strictEqual(veces(enviados[0], "12"), 2, "12 en la lista y en «Pagado», nada más: " + enviados[0]);
});

prueba("5. general apagada: la lista de pagados sí se responde sola", async () => {
    reiniciar();
    apagados.add("mis_numeros");
    await eventHandler(ctxMensaje("mis números y cuáles ya pagué"));
    assert.strictEqual(espias.enviados.length, 1);
    assert.ok(/Números pagados: .*12/.test(espias.enviados[0]), espias.enviados[0]);
    assert.ok(!/45/.test(espias.enviados[0]));
});

prueba("6. general + monto: el monto sí aporta y se conserva", async () => {
    const enviados = await responder("mis números y cuánto debo");
    assert.strictEqual(enviados.length, 1);
    assert.ok(/3\.000/.test(enviados[0]), enviados[0]);
});

prueba("7. respuestas individuales: un mensaje cada una, con su dato", async () => {
    let e = await responder("Mis números");
    assert.strictEqual(e.length, 1);
    assert.ok(e[0].startsWith("MIS_NUMEROS:") && /12/.test(e[0]) && /45/.test(e[0]), e[0]);

    e = await responder("¿Qué tengo reservado?");
    assert.strictEqual(e.length, 1);
    assert.ok(e[0].startsWith("MIS_NUMEROS:"), e[0]);

    e = await responder("¿Cuánto debo?");
    assert.strictEqual(e.length, 1);
    assert.ok(/45/.test(e[0]) && !/12/.test(e[0]), e[0]);

    e = await responder("¿Cuáles ya pagué?");
    assert.strictEqual(e.length, 1);
    assert.ok(/12/.test(e[0]) && !/45/.test(e[0]), e[0]);
});

prueba("8. «¿qué números cancelé?» muestra pagados, nunca un historial de cancelaciones", async () => {
    const e = await responder("¿Qué números cancelé?");
    assert.strictEqual(e.length, 1);
    assert.ok(/pagados: .*12/.test(e[0]) && !/45/.test(e[0]), e[0]);
    assert.ok(!/cancel/i.test(e[0]), e[0]);
    assert.strictEqual(espias.gemini, 0);
});

(async () => {

    const salida = (t) => process.stdout.write(t + "\n");
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) {
        console[m] = () => {};
    }

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            salida(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            salida(`❌ ${nombre}\n   ${err.message}`);
        }
    }

    salida(`\nPruebas: ${ok + falla}  |  OK: ${ok}  |  Fallidas: ${falla}`);
    process.exit(falla ? 1 : 0);

})();
