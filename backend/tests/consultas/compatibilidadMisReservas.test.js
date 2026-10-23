// ==========================================================================
// PRUEBAS — Interruptor de «Mis números» y la fila antigua "mis_reservas".
//
// El panel (frontend/services/mensajes/configuracionSeleccion.ts, REAL,
// transpilado con el TypeScript del frontend) y el bot (eventHandler.js,
// REAL) comparten una misma tabla configuracion_seleccion_mensajes en
// memoria: lo que guarda el interruptor es exactamente lo que lee el bot.
//
// Simulados: Supabase (tabla en memoria), envío de WhatsApp y Gemini.
//
//     node backend/tests/consultas/compatibilidadMisReservas.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const FRONT = path.resolve(RAIZ, "../frontend");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ------------------------------------- configuracion_seleccion_mensajes ---

const USUARIO = "tenant-1";
let config = [];
const upserts = [];

function fila(tipo) {
    return config.find(f => f.usuario_id === USUARIO && f.tipo_respuesta === tipo) || null;
}

// Supabase del PANEL: solo lo que usa guardarTipoHabilitado (upsert).
const supabasePanel = {
    from(tabla) {
        assert.strictEqual(tabla, "configuracion_seleccion_mensajes");
        let filas = [];
        const b = {
            upsert(datos, opciones) {
                assert.strictEqual(opciones.onConflict, "usuario_id,tipo_respuesta");
                filas = (Array.isArray(datos) ? datos : [datos]).map(d => {
                    upserts.push(d.tipo_respuesta);
                    let f = config.find(x => x.usuario_id === d.usuario_id && x.tipo_respuesta === d.tipo_respuesta);
                    if (!f) {
                        f = { id: `cfg-${config.length + 1}`, modo_seleccion: "aleatorio", plantilla_fija_id: null, rotacion_indice: 0 };
                        config.push(f);
                    }
                    Object.assign(f, d);
                    return { ...f };
                });
                return b;
            },
            select() { return b; },
            then(ok, ko) { return Promise.resolve({ data: filas, error: null }).then(ok, ko); }
        };
        return b;
    }
};

function cargarServicioPanel() {
    const ts = require(path.join(FRONT, "node_modules/typescript"));
    const fuente = fs.readFileSync(path.join(FRONT, "services/mensajes/configuracionSeleccion.ts"), "utf8");
    const { outputText } = ts.transpileModule(fuente, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase: supabasePanel };
        throw new Error("módulo no previsto: " + spec);
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}

const panel = cargarServicioPanel();

// ------------------------------------------------------------ bot (real) ---

const TABLA = "5k_15k_reservas_2_cifras";
const FILAS = [
    { usuario_id: "tenant-test", numero: "12", estado: "pagado", usuario_global_id: "u1", identidad_evento_real: "id-sorteo" },
    { usuario_id: "tenant-test", numero: "45", estado: "reservado", usuario_global_id: "u1", identidad_evento_real: "id-sorteo" }
];

const fakeSupabase = {
    from(tabla) {
        const b = {
            select() { return b; }, order() { return b; }, or() { return b; }, eq() { return b; },
            neq() { return b; }, in() { return b; }, maybeSingle() { return b; }, single() { return b; },
            then(ok, ko) {
                return Promise.resolve({ data: tabla === TABLA ? FILAS : [], error: null }).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

const PLANTILLA = { id: "p-mis-numeros", contenido: "MIS_NUMEROS: {{numeros_totales_cliente}}", variables: {} };
const enviados = [];

// Misma regla que backend/bot/ai/configMensajes.js, leyendo la tabla en
// memoria que escribe el panel (sin fila = habilitada).
inyectar(r("bot/ai/configMensajes.js"), {
    obtenerConfigSeleccion: async (tipo) => {
        const f = fila(tipo);
        if (tipo === "mis_numeros") return { ...(f || {}), modo_seleccion: "fijo", plantilla_fija_id: PLANTILLA.id };
        return f;
    },
    obtenerPlantillasHabilitadas: async (tipo) => (tipo === "mis_numeros" ? [PLANTILLA] : []),
    actualizarRotacion: async () => {},
    estaRespuestaHabilitada: async (_u, tipo) => {
        const f = fila(tipo);
        return !f || f.habilitada !== false;
    }
});

inyectar(r("bot/ai/aiService.js"), { suggestReply: async () => ({ respuesta: "(IA)" }) });
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({}) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ text }) => { enviados.push(text); },
    sendImage: async () => {}
});
inyectar(r("bot/funciones/reservas/detectarReserva.js"), { detectarReserva: async () => ({ ok: true, mensaje: "x" }) });

const EVENTO = { id: "ev-1", usuario_id: "tenant-test", nombre_evento: "Lotería De Manizales", tabla: TABLA, cifras: 2, identidad_evento_real: "id-sorteo", hora_fin: "22:30", valor: 3000 };

inyectar(r("bot/funciones/eventos/detectarEvento.js"), { detectarEvento: async () => null });
inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => EVENTO });
inyectar(r("bot/funciones/mensajes/cuentasIgnoradas.js"), { esCuentaIgnorada: () => false });

const eventHandler = require(r("bot/handlers/eventHandler.js"));

async function preguntar(texto) {
    enviados.length = 0;
    await eventHandler({
        sock: {},
        session: { usuarioId: USUARIO, sessionId: "s1" },
        chat: { remoteJid: "g@g.us", esGrupo: true },
        message: { key: { id: "M1", remoteJid: "g@g.us", fromMe: false }, message: { conversation: texto } },
        usuario: { id: "u1", nombre: "Cliente" },
        evento: EVENTO,
        textoOriginal: texto
    });
    return [...enviados];
}

// Configuración guardada como la de un cliente real (lectura de prod del
// 22/10): las 4 respuestas de pago apagadas, «Mis números» sin fila
// (activo) y el antiguo «Mis reservas» apagado.
const PAGO = ["consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo", "consulta_pago_sin_saldo"];

function sembrarClienteReal() {
    upserts.length = 0;
    config = [
        ...PAGO.map((t, i) => ({ id: `pago-${i}`, usuario_id: USUARIO, tipo_respuesta: t, habilitada: false, modo_seleccion: "aleatorio" })),
        { id: "old-res", usuario_id: USUARIO, tipo_respuesta: "mis_reservas", habilitada: false, modo_seleccion: "fijo", plantilla_fija_id: "p-antigua", rotacion_indice: 3 }
    ];
}

const GENERALES = ["mis reservas", "¿Qué tengo reservado?", "Mis números", "¿cuáles son mis números?"];

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. mis_numeros activo + antiguo mis_reservas apagado: sin tocar nada, se respeta", async () => {
    sembrarClienteReal();
    assert.strictEqual((await preguntar("Mis números")).length, 1);
    assert.strictEqual((await preguntar("mis reservas")).length, 0);
    assert.strictEqual((await preguntar("¿Qué tengo reservado?")).length, 0);
    // El panel lo señala, pero no escribe nada por su cuenta.
    assert.deepStrictEqual(panel.vinculadosDesactivados("mis_numeros", { mis_reservas: false }), ["mis_reservas"]);
    assert.deepStrictEqual(panel.vinculadosDesactivados("mis_numeros", { mis_numeros: false, mis_reservas: false }), []);
    assert.deepStrictEqual(panel.vinculadosDesactivados("mis_numeros", {}), []);
    assert.strictEqual(upserts.length, 0);
});

prueba("2. el cliente activa «Mis números» -> «mis reservas» responde (con «Mis números»)", async () => {
    sembrarClienteReal();
    const { data, error } = await panel.guardarTipoHabilitado(USUARIO, "mis_numeros", true);
    assert.strictEqual(error, null);
    assert.strictEqual(data.tipo_respuesta, "mis_numeros");
    assert.deepStrictEqual(upserts.sort(), ["mis_numeros", "mis_reservas"]);
    assert.strictEqual(fila("mis_reservas").habilitada, true);
    for (const t of GENERALES) {
        const e = await preguntar(t);
        assert.strictEqual(e.length, 1, t);
        assert.ok(e[0].startsWith("MIS_NUMEROS:") && /12/.test(e[0]) && /45/.test(e[0]), e[0]);
    }
});

prueba("3. la fila antigua se conserva: solo cambia habilitada (modo, fija, rotación intactos)", async () => {
    sembrarClienteReal();
    await panel.guardarTipoHabilitado(USUARIO, "mis_numeros", true);
    const f = fila("mis_reservas");
    assert.strictEqual(f.id, "old-res");
    assert.strictEqual(f.modo_seleccion, "fijo");
    assert.strictEqual(f.plantilla_fija_id, "p-antigua");
    assert.strictEqual(f.rotacion_indice, 3);
});

prueba("4. el cliente desactiva «Mis números» -> ninguna consulta general responde", async () => {
    sembrarClienteReal();
    await panel.guardarTipoHabilitado(USUARIO, "mis_numeros", true);
    await panel.guardarTipoHabilitado(USUARIO, "mis_numeros", false);
    assert.strictEqual(fila("mis_numeros").habilitada, false);
    assert.strictEqual(fila("mis_reservas").habilitada, false);
    for (const t of GENERALES) {
        assert.strictEqual((await preguntar(t)).length, 0, t);
    }
});

prueba("5. activar «Mis números» no activa las 4 respuestas de pago", async () => {
    sembrarClienteReal();
    await panel.guardarTipoHabilitado(USUARIO, "mis_numeros", true);
    assert.ok(!upserts.some(t => PAGO.includes(t)));
    for (const t of PAGO) assert.strictEqual(fila(t).habilitada, false, t);
    assert.strictEqual((await preguntar("¿Cuánto debo?")).length, 0);
    assert.strictEqual((await preguntar("¿cuáles ya pagué?")).length, 0);
    assert.strictEqual((await preguntar("¿qué números cancelé?")).length, 0);
});

prueba("6. combinadas: un solo mensaje, cada número una vez en la lista", async () => {
    sembrarClienteReal();
    await panel.guardarTipoHabilitado(USUARIO, "mis_numeros", true);
    for (const t of ["mis números y mis reservas", "mis reservas y mis números", "mis números y cuáles ya pagué", "¿qué tengo reservado y cuáles son mis números?"]) {
        const e = await preguntar(t);
        assert.strictEqual(e.length, 1, t);
        assert.ok(!/Números pagados/.test(e[0]), `${t}: ${e[0]}`);
        const primera = e[0].split("\n")[0];
        assert.strictEqual(primera.split("12").length - 1, 1, `${t}: ${primera}`);
        assert.strictEqual(primera.split("45").length - 1, 1, `${t}: ${primera}`);
    }
});

prueba("7. otros tipos no arrastran filas vinculadas", async () => {
    sembrarClienteReal();
    await panel.guardarTipoHabilitado(USUARIO, "cantidad_reservas", false);
    assert.deepStrictEqual(upserts, ["cantidad_reservas"]);
    assert.deepStrictEqual(panel.tiposDelInterruptor("consulta_pago_sin_pago"), ["consulta_pago_sin_pago"]);
    assert.strictEqual(fila("mis_reservas").habilitada, false);
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
