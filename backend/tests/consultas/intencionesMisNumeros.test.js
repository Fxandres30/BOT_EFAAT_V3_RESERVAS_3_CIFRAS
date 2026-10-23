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
    { usuario_id: "tenant-test", numero: "45", estado: "reservado", usuario_global_id: "u1", identidad_evento_real: "id-sorteo" },
    // Otros clientes del mismo sorteo, uno por estado de pago: u3 sin pago,
    // u4 pago completo (comparte teléfono con u1: su fila nunca es de u1),
    // u5 sin números.
    { usuario_id: "tenant-test", numero: "33", estado: "reservado", usuario_global_id: "u3", identidad_evento_real: "id-sorteo" },
    { usuario_id: "tenant-test", numero: "66", estado: "pagado", usuario_global_id: "u4", telefono: "573000", identidad_evento_real: "id-sorteo" }
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

const espias = { enviados: [], gemini: 0, consultados: [] };
let apagados = new Set();

const PLANTILLAS = {
    mis_numeros: { id: "p-mis-numeros", contenido: "MIS_NUMEROS: {{numeros_totales_cliente}}", variables: {} }
};

inyectar(r("bot/ai/configMensajes.js"), {
    obtenerConfigSeleccion: async (tipo) => (PLANTILLAS[tipo] ? { id: "cfg-" + tipo, modo_seleccion: "fijo", plantilla_fija_id: PLANTILLAS[tipo].id } : null),
    obtenerPlantillasHabilitadas: async (tipo) => (PLANTILLAS[tipo] ? [PLANTILLAS[tipo]] : []),
    actualizarRotacion: async () => {},
    estaRespuestaHabilitada: async (_usuarioId, tipo) => { espias.consultados.push(tipo); return !apagados.has(tipo); }
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
    Object.assign(espias, { enviados: [], gemini: 0, consultados: [] });
    apagados = new Set();
}

function ctxMensaje(texto, usuario = { id: "u1", nombre: "Cliente" }) {
    return {
        sock: {},
        session: { usuarioId: "tenant-1", sessionId: "s1" },
        chat: { remoteJid: "g@g.us", esGrupo: true },
        message: { key: { id: "M1", remoteJid: "g@g.us", fromMe: false }, message: { conversation: texto } },
        usuario,
        evento: EVENTO,
        textoOriginal: texto
    };
}

async function responder(texto, { apagar = [], usuario } = {}) {
    reiniciar();
    apagados = new Set(apagar);
    await eventHandler(ctxMensaje(texto, usuario));
    return espias.enviados;
}

const PAGO = ["consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo", "consulta_pago_sin_saldo"];

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

// ------------------------------- deuda e interruptores de pago por estado ---

prueba("9. «debo»/«devo»/«deboo»/«¿debo?» responden con lo pendiente si el interruptor del estado está activo", async () => {
    for (const texto of ["debo", "devo", "deboo", "¿debo?", "qué debo", "qué devo", "cuánto debo"]) {
        const e = await responder(texto);
        assert.strictEqual(e.length, 1, texto);
        assert.ok(/45/.test(e[0]) && !/12/.test(e[0]), `${texto}: ${e[0]}`);
    }
    for (const texto of ["debe", "debemos"]) {
        assert.strictEqual((await responder(texto)).length, 0, texto);
    }
});

prueba("10. interruptor de pago apagado: «debo» calla (no es un fallo del detector)", async () => {
    for (const texto of ["debo", "devo", "qué debo", "cuánto debo"]) {
        assert.strictEqual(detectarIntencion(texto).tipo, "consulta_pago", texto);
        assert.strictEqual((await responder(texto, { apagar: PAGO })).length, 0, texto);
    }
});

prueba("11. cada estado de pago respeta SOLO su propio interruptor (solo y combinado)", async () => {
    const CLIENTES = {
        consulta_pago_pago_parcial: { id: "u1" },
        consulta_pago_sin_pago: { id: "u3" },
        consulta_pago_pago_completo: { id: "u4" },
        consulta_pago_sin_saldo: { id: "u5" }
    };
    for (const apagado of PAGO) {
        for (const [estado, usuario] of Object.entries(CLIENTES)) {
            const debeCallar = estado === apagado;
            const solo = await responder("qué debo", { apagar: [apagado], usuario });
            assert.strictEqual(solo.length, debeCallar ? 0 : 1, `solo ${estado} con ${apagado} apagado`);

            const combinada = await responder("mis números y cuánto debo", { apagar: [apagado], usuario });
            assert.strictEqual(combinada.length, 1, `combinada ${estado}`);
            const conPago = /Te falta pagar|Estás al día|no debes nada/.test(combinada[0]);
            assert.strictEqual(conPago, !debeCallar, `combinada ${estado} con ${apagado} apagado: ${combinada[0]}`);
        }
    }
});

prueba("12. combinada con pago apagado: números sí, deuda no; nada que mostrar -> silencio", async () => {
    for (const texto of ["mis números y cuánto debo", "mis números y cuáles ya pagué", "mis números y qué tengo pendiente"]) {
        const e = await responder(texto, { apagar: PAGO });
        assert.strictEqual(e.length, 1, texto);
        assert.ok(/12/.test(e[0]) && /45/.test(e[0]), `${texto}: ${e[0]}`);
        assert.ok(!/Te falta pagar|3\.000|Números pagados|Pendientes de pago:/.test(e[0]), `${texto}: ${e[0]}`);
    }

    // Solo partes de pago y todas apagadas -> ningún mensaje.
    assert.strictEqual(detectarIntencion("cuánto debo y cuáles ya pagué").tipo, "multiple");
    assert.strictEqual((await responder("cuánto debo y cuáles ya pagué", { apagar: PAGO })).length, 0);

    // Números apagados y pago apagado -> silencio, sin filtrar nada.
    assert.strictEqual((await responder("mis números y cuánto debo", { apagar: ["mis_numeros", ...PAGO] })).length, 0);
});

prueba("13. una plantilla «multiple» no recibe datos de pago de una parte omitida", async () => {
    const texto = "cuántos números tengo y cuánto debo";
    assert.deepStrictEqual(detectarIntencion(texto).intenciones.map(i => i.tipo), ["cantidad_reservas", "consulta_pago"]);

    PLANTILLAS.multiple = { id: "p-multiple", contenido: "MULTI [{{monto_pendiente}}] [{{numeros_pendientes}}] [{{cantidad_pendientes}}]", variables: {} };
    try {
        const apagado = await responder(texto, { apagar: PAGO });
        assert.strictEqual(apagado.length, 1);
        assert.strictEqual(apagado[0], "MULTI [] [] []", apagado[0]);

        const activo = await responder(texto);
        assert.ok(/3\.000/.test(activo[0]) && /45/.test(activo[0]), activo[0]);
    } finally {
        delete PLANTILLAS.multiple;
    }
});

prueba("14. todo activo: cada parte autorizada aparece una sola vez", async () => {
    const e = await responder("mis números y cuánto debo");
    assert.strictEqual(e.length, 1);
    assert.strictEqual(veces(e[0], "Te falta pagar"), 1, e[0]);
    assert.strictEqual(veces(e[0], "Tus números"), 1, e[0]);
});

prueba("15. sin mezclar clientes: u1 con el teléfono de u4 nunca ve el 66 ni el 33", async () => {
    for (const texto of ["mis números", "debo", "mis números y cuánto debo"]) {
        const e = await responder(texto, { usuario: { id: "u1", telefono: "573000" } });
        assert.strictEqual(e.length, 1, texto);
        assert.ok(!/66|33/.test(e[0]), `${texto}: ${e[0]}`);
    }
    const u4 = await responder("debo", { usuario: { id: "u4" } });
    assert.ok(/al día/.test(u4[0]) && !/45|12/.test(u4[0]), u4[0]);
});

prueba("16. «Mis reservas» antiguo apagado sigue respetándose; «mis números» intacto", async () => {
    assert.strictEqual((await responder("mis reservas", { apagar: ["mis_reservas"] })).length, 0);
    assert.strictEqual((await responder("mis números", { apagar: ["mis_reservas"] })).length, 1);
    assert.strictEqual((await responder("mis reservas", { apagar: PAGO })).length, 1);
});

prueba("17. sin fila o con error de lectura rige la política de siempre (configMensajes.js real)", async () => {
    // El bot consulta la clave del estado real con la MISMA función de
    // siempre: ninguna regla de autorización nueva.
    await responder("mis números y cuánto debo");
    assert.ok(espias.consultados.includes("consulta_pago_pago_parcial"), espias.consultados.join(","));
    assert.ok(!espias.consultados.includes("consulta_pago"), espias.consultados.join(","));

    // configMensajes.js REAL, aislado del simulado de arriba.
    const fs = require("fs");
    const fuente = fs.readFileSync(r("bot/ai/configMensajes.js"), "utf8");
    const cargar = (respuesta) => {
        const sb = { from() { const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve(respuesta) }; return b; } };
        const modulo = { exports: {} };
        new Function("require", "module", "exports", fuente)(
            (spec) => { if (spec === "../../lib/supabase") return sb; throw new Error("módulo no previsto: " + spec); },
            modulo, modulo.exports
        );
        return modulo.exports;
    };

    const sinFila = cargar({ data: null, error: null });
    const apagada = cargar({ data: { habilitada: false }, error: null });
    const conError = cargar({ data: null, error: { message: "fallo simulado" } });

    assert.strictEqual(await sinFila.estaRespuestaHabilitada("tenant-1", "consulta_pago_pago_parcial"), true);
    assert.strictEqual(await apagada.estaRespuestaHabilitada("tenant-1", "consulta_pago_pago_parcial"), false);
    // Política EXISTENTE (DEFAULT SEGURO documentado en configMensajes.js),
    // sin cambios en esta fase.
    assert.strictEqual(await conError.estaRespuestaHabilitada("tenant-1", "consulta_pago_pago_parcial"), true);
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
