// ==========================================================================
// PRUEBAS — consulta de disponibilidad con 0 números disponibles.
//
//   hay libres            -> comportamiento de siempre (plantilla con lista)
//   0 libres (agotado)    -> mensaje fijo de AGOTADO: sin plantillas de
//                            "números disponibles", sin Gemini, sin lista
//   error de consulta     -> NO se asume agotado (comportamiento de siempre)
//
// Reales: consultarDisponibilidad.js (única fuente de verdad, sobre filas
// simuladas de la tabla del evento), resolverConsulta.js,
// responderResultado.js, seleccionarPlantilla.js, plantillaMensaje.js,
// eventHandler.js + detectarIntencion.js (caso de integración).
// Simulados: Supabase, configMensajes (plantillas del panel), envío por
// WhatsApp y Gemini (espías).
//
//     node backend/tests/consultas/disponibilidadAgotada.test.js
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
const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
const estado = { filas: [], error: null };

function filas(asignar) {
    return NUMEROS.map((numero, i) => ({ numero, estado: asignar(i), identidad_evento_real: "id-sorteo" }));
}

const fakeSupabase = {
    from(tabla) {
        const b = {
            select() { return b; },
            order() { return b; },
            or() { return b; },
            eq() { return b; },
            in() { return b; },
            maybeSingle() { return b; },
            single() { return b; },
            then(ok, ko) {
                const res = tabla === TABLA
                    ? (estado.error ? { data: null, error: estado.error } : { data: estado.filas, error: null })
                    : { data: [], error: null };
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

// ------------------------------------------------------------- espías ---

const espias = { seleccionarPlantilla: 0, plantillasPedidas: 0, tiposPedidos: [], gemini: 0, enviados: [], detectarReserva: 0 };
let tipoHabilitado = true;

const PLANTILLA_CLASICA = {
    id: "p-clasico",
    contenido: "🎲 *NÚMEROS DISPONIBLES* 🎲\n\n📋 Estos son los números que puedes elegir:\n\n{{numeros_disponibles}}\n\n⚡ ¡Elige rápido!",
    variables: {}
};

inyectar(r("bot/ai/configMensajes.js"), {
    // Solo el tipo "disponibilidad" tiene plantillas en esta suite (las 35
    // reales son de ese tipo); "disponibilidad_agotada" no tiene ninguna
    // -> el caso agotado cae al mensaje fijo.
    obtenerConfigSeleccion: async (tipo) => (tipo === "disponibilidad" ? { id: "cfg", modo_seleccion: "fijo", plantilla_fija_id: "p-clasico" } : null),
    obtenerPlantillasHabilitadas: async (tipo) => {
        espias.plantillasPedidas++;
        espias.tiposPedidos.push(tipo);
        return tipo === "disponibilidad" ? [PLANTILLA_CLASICA] : [];
    },
    actualizarRotacion: async () => {},
    estaRespuestaHabilitada: async () => tipoHabilitado
});

const seleccionReal = require(r("bot/ai/seleccionarPlantilla.js"));
inyectar(r("bot/ai/seleccionarPlantilla.js"), {
    seleccionarPlantilla: (...args) => { espias.seleccionarPlantilla++; return seleccionReal.seleccionarPlantilla(...args); }
});

inyectar(r("bot/ai/aiService.js"), {
    suggestReply: async () => { espias.gemini++; return { respuesta: "Números disponibles: (inventado por IA)" }; }
});
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({}) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ text }) => { espias.enviados.push(text); },
    sendImage: async () => {}
});
inyectar(r("bot/funciones/reservas/detectarReserva.js"), {
    detectarReserva: async () => { espias.detectarReserva++; return { ok: true, mensaje: "x" }; }
});

const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));
const { responderResultado } = require(r("bot/ai/responderResultado.js"));

const EVENTO = { id: "ev-1", nombre_evento: "Lotería De Manizales", tabla: TABLA, cifras: 2, identidad_evento_real: "id-sorteo", hora_fin: "22:30", valor: 3000 };

function reiniciar() {
    Object.assign(espias, { seleccionarPlantilla: 0, plantillasPedidas: 0, tiposPedidos: [], gemini: 0, enviados: [], detectarReserva: 0 });
    estado.error = null;
    tipoHabilitado = true;
}

function ctxConsulta(consulta) {
    return {
        sock: {},
        session: { usuarioId: "tenant-1", sessionId: "s1" },
        chat: { remoteJid: "g@g.us", esGrupo: true },
        message: { key: { id: "M1", remoteJid: "g@g.us", fromMe: false } },
        usuario: { id: "u1", nombre: "Cliente" },
        evento: EVENTO,
        textoOriginal: "¿qué números quedan?",
        consulta
    };
}

async function consultarYResponder() {
    const consulta = await resolverConsulta({ tipo: "disponibilidad", evento: EVENTO, usuario: { id: "u1" } });
    await responderResultado(ctxConsulta(consulta));
    return { consulta, enviado: espias.enviados[0] };
}

function esAgotado(texto) {
    return /NÚMEROS AGOTADOS/.test(texto) && !/Estos son los números/.test(texto) && !/\b\d{2}\b/.test(texto);
}

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. hay disponibles -> comportamiento actual: plantilla con la lista, sin 'agotado'", async () => {

    reiniciar();
    estado.filas = filas(i => (i < 97 ? "reservado" : "libre"));   // libres: 97, 98, 99

    const { consulta, enviado } = await consultarYResponder();

    assert.deepStrictEqual(consulta.numerosDisponibles, ["97", "98", "99"]);
    assert.notStrictEqual(consulta.agotado, true);
    assert.ok(/Estos son los números que puedes elegir/.test(enviado), "usa la plantilla normal");
    assert.ok(/97/.test(enviado) && /99/.test(enviado), "lista los disponibles");
    assert.ok(!/AGOTADOS/.test(enviado));
    assert.strictEqual(espias.seleccionarPlantilla, 1);

});

prueba("2. 0 disponibles, ocupados mixtos -> AGOTADO, sin lista, sin plantilla, sin Gemini", async () => {

    reiniciar();
    estado.filas = filas(i => (i % 2 ? "reservado" : "pagado"));

    const { consulta, enviado } = await consultarYResponder();

    assert.strictEqual(consulta.agotado, true);
    assert.deepStrictEqual(consulta.numerosDisponibles, []);
    assert.ok(esAgotado(enviado), `mensaje de agotado: ${enviado}`);
    assert.strictEqual(espias.enviados.length, 1);

});

prueba("3. 0 disponibles porque todos están PAGADOS -> AGOTADO", async () => {

    reiniciar();
    estado.filas = filas(() => "pagado");

    const { consulta, enviado } = await consultarYResponder();

    assert.strictEqual(consulta.agotado, true);
    assert.ok(esAgotado(enviado));

});

prueba("4. 0 disponibles porque todos están RESERVADOS -> AGOTADO", async () => {

    reiniciar();
    estado.filas = filas(() => "reservado");

    const { consulta, enviado } = await consultarYResponder();

    assert.strictEqual(consulta.agotado, true);
    assert.ok(esAgotado(enviado));

});

prueba("5. error consultando disponibilidad -> NO se asume agotado (comportamiento de siempre)", async () => {

    reiniciar();
    estado.error = { message: "fallo simulado de Supabase" };

    const { consulta, enviado } = await consultarYResponder();

    assert.notStrictEqual(consulta.agotado, true, "un error no es 'agotado'");
    assert.strictEqual(consulta.mensaje, "No quedan números disponibles.", "fallback de siempre, sin cambios");
    assert.ok(!/AGOTADOS/.test(enviado), "nunca el mensaje de agotado ante un error");
    assert.strictEqual(espias.seleccionarPlantilla, 1, "sigue el camino de presentación de siempre");

});

prueba("6. agotado NO pasa por la presentación normal: nunca plantillas de 'disponibilidad', nunca Gemini", async () => {

    reiniciar();
    estado.filas = filas(() => "reservado");

    await consultarYResponder();

    // Fase 2: el caso agotado pide SOLO las plantillas de su propio tipo.
    assert.ok(!espias.tiposPedidos.includes("disponibilidad"), "no se piden las plantillas de disponibilidad");
    assert.deepStrictEqual(espias.tiposPedidos, ["disponibilidad_agotada"]);
    assert.strictEqual(espias.gemini, 0, "no se llama a Gemini");

});

prueba("6b. sin plantillas configuradas y agotado -> tampoco Gemini (no inventa lista)", async () => {

    reiniciar();
    estado.filas = filas(() => "pagado");
    const original = require(r("bot/ai/configMensajes.js")).obtenerPlantillasHabilitadas;
    require(r("bot/ai/configMensajes.js")).obtenerPlantillasHabilitadas = async () => [];

    try {
        const { enviado } = await consultarYResponder();
        assert.strictEqual(espias.gemini, 0);
        assert.ok(esAgotado(enviado));
    } finally {
        require(r("bot/ai/configMensajes.js")).obtenerPlantillasHabilitadas = original;
    }

});

prueba("7. interruptor del panel: tipo 'disponibilidad' desactivado -> silencio también si está agotado", async () => {

    reiniciar();
    estado.filas = filas(() => "reservado");
    tipoHabilitado = false;

    await consultarYResponder();

    assert.strictEqual(espias.enviados.length, 0);

});

prueba("8. integración eventHandler: '¿qué números quedan?' con tabla llena -> AGOTADO, nunca reserva", async () => {

    reiniciar();
    estado.filas = filas(() => "pagado");

    inyectar(r("bot/funciones/eventos/detectarEvento.js"), { detectarEvento: async () => null });
    inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => EVENTO });
    inyectar(r("bot/funciones/mensajes/cuentasIgnoradas.js"), { esCuentaIgnorada: () => false });
    delete require.cache[r("bot/handlers/eventHandler.js")];
    const eventHandler = require(r("bot/handlers/eventHandler.js"));

    const ctx = ctxConsulta(undefined);
    ctx.message.message = { conversation: "¿qué números quedan?" };
    await eventHandler(ctx);

    assert.strictEqual(espias.detectarReserva, 0, "no intenta reservar");
    assert.strictEqual(espias.enviados.length, 1);
    assert.ok(esAgotado(espias.enviados[0]));

});

(async () => {

    const salida = (t) => process.stdout.write(t + "\n");
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) {
        originales[m] = console[m];
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
            salida(`❌ ${nombre}`);
            salida(String(err && err.stack || err));
        }
    }

    Object.assign(console, originales);

    salida("\n============================");
    salida(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    salida("============================");

    process.exit(falla ? 1 : 0);

})();
