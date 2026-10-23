// ==========================================================================
// PRUEBAS — «Mis reservas» retirado del panel.
//
// Las preguntas que detectarIntencion.js clasifica como "mis_reservas"
// («mis reservas», «qué reservé») devuelven los mismos datos que
// "mis_numeros" y ahora responden con las plantillas e interruptor de
// «Mis números». Si el cliente tenía apagado el antiguo «Mis reservas»,
// esas preguntas siguen en silencio (no se reactivan).
//
// Reales: detectarIntencion.js, resolverConsulta.js, consultarMisNumeros.js,
// responderResultado.js, seleccionarPlantilla.js, plantillaMensaje.js,
// eventHandler.js. Simulados: Supabase, configMensajes, envío y Gemini.
//
//     node backend/tests/consultas/misReservasComoMisNumeros.test.js
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

const espias = { tiposPedidos: [], interruptores: [], enviados: [], gemini: 0 };
let apagados = new Set();

const PLANTILLAS = {
    mis_numeros: { id: "p-mis-numeros", contenido: "MIS_NUMEROS: {{numeros_totales_cliente}}", variables: {} },
    mis_reservas: { id: "p-mis-reservas", contenido: "MIS_RESERVAS_ANTIGUA: {{numeros_reservados}}", variables: {} }
};

inyectar(r("bot/ai/configMensajes.js"), {
    obtenerConfigSeleccion: async (tipo) => (PLANTILLAS[tipo] ? { id: "cfg-" + tipo, modo_seleccion: "fijo", plantilla_fija_id: PLANTILLAS[tipo].id } : null),
    obtenerPlantillasHabilitadas: async (tipo) => {
        espias.tiposPedidos.push(tipo);
        return PLANTILLAS[tipo] ? [PLANTILLAS[tipo]] : [];
    },
    actualizarRotacion: async () => {},
    estaRespuestaHabilitada: async (_usuarioId, tipo) => {
        espias.interruptores.push(tipo);
        return !apagados.has(tipo);
    }
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
const { calcularTipoPresentacion } = require(r("bot/ai/plantillaMensaje.js"));
const eventHandler = require(r("bot/handlers/eventHandler.js"));

function reiniciar() {
    Object.assign(espias, { tiposPedidos: [], interruptores: [], enviados: [], gemini: 0 });
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

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. «mis reservas» se sigue detectando (la detección no cambia)", async () => {
    assert.strictEqual(detectarIntencion("mis reservas").tipo, "mis_reservas");
    assert.strictEqual(detectarIntencion("cuáles son mis números").tipo, "mis_numeros");
});

prueba("2. calcularTipoPresentacion: mis_reservas -> mis_numeros; el resto igual", async () => {
    assert.strictEqual(calcularTipoPresentacion({ consulta: {} }, { tipo: "mis_reservas" }), "mis_numeros");
    assert.strictEqual(calcularTipoPresentacion({ consulta: {} }, { tipo: "mis_numeros" }), "mis_numeros");
    assert.strictEqual(calcularTipoPresentacion({ consulta: {} }, { tipo: "cantidad_reservas" }), "cantidad_reservas");
});

prueba("3. «mis reservas» responde con la plantilla de «Mis números», nunca con la antigua", async () => {
    reiniciar();
    await eventHandler(ctxMensaje("mis reservas"));
    assert.strictEqual(espias.enviados.length, 1);
    assert.ok(espias.enviados[0].startsWith("MIS_NUMEROS:"), espias.enviados[0]);
    assert.ok(/12/.test(espias.enviados[0]) && /45/.test(espias.enviados[0]), "incluye todos sus números");
    assert.ok(!espias.tiposPedidos.includes("mis_reservas"), "no lee plantillas de mis_reservas");
    assert.strictEqual(espias.gemini, 0);
});

prueba("4. «Mis números» apagado -> «mis reservas» en silencio", async () => {
    reiniciar();
    apagados.add("mis_numeros");
    await eventHandler(ctxMensaje("mis reservas"));
    assert.strictEqual(espias.enviados.length, 0);
});

prueba("5. antiguo «Mis reservas» apagado -> sigue en silencio (no se reactiva)", async () => {
    reiniciar();
    apagados.add("mis_reservas");
    await eventHandler(ctxMensaje("mis reservas"));
    assert.strictEqual(espias.enviados.length, 0);
});

prueba("6. antiguo «Mis reservas» apagado no afecta a «mis números»", async () => {
    reiniciar();
    apagados.add("mis_reservas");
    await eventHandler(ctxMensaje("cuáles son mis números"));
    assert.strictEqual(espias.enviados.length, 1);
    assert.ok(espias.enviados[0].startsWith("MIS_NUMEROS:"));
    assert.ok(!espias.interruptores.includes("mis_reservas"));
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
