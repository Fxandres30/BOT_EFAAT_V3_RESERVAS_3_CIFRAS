// ==========================================================================
// PRUEBAS — Fase 0: conflictos entre anuncios de sorteo, horas/precios,
// consultas y reservas.
//
//   A. Horas ("10:30", "2:30 PM", "10pm") nunca se leen como números de la
//      dinámica; las reservas normales se extraen igual que siempre.
//   B. El precio del anuncio es el número que sigue a "valor número" (o el
//      que acompaña a "cada número"), nunca la hora de la misma línea.
//   C. Un mensaje con forma de anuncio de sorteo no se interpreta además
//      como consulta ni como reserva; los mensajes de clientes sí.
//   D. Sin reserva cuando el sorteo ya no acepta reservas (activo=false,
//      estado "cerrado" o pasada la hora de cierre aunque WhatsApp no haya
//      cerrado el grupo). Las consultas siguen respondiendo.
//   E. Flujo real (eventHandler): anuncio -> 0 respuestas y 0 reservas;
//      reserva normal -> 1 reserva y 1 respuesta; disponibilidad -> 1
//      respuesta; nunca dos respuestas al mismo mensaje.
//
// Simulados: Supabase (en memoria), envío por WhatsApp, Gemini, detección
// del evento del grupo y la escritura de reservas (espía) — así se cuenta
// exactamente qué se habría reservado.
//
//     node backend/tests/reservas/fase0AnunciosYReservas.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ------------------------------------------------------------- Supabase ---

const TABLA = "reservas_test_fase0";
const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
const db = { [TABLA]: [], plantillas_mensaje: [], configuracion_seleccion_mensajes: [] };

inyectar(r("lib/supabase.js"), {
    from(tabla) {
        const filtros = [];
        const distintos = [];
        let unico = false;
        const b = {
            select() { return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            neq(c, v) { distintos.push([c, v]); return b; },
            or() { return b; },
            in() { return b; },
            order() { return b; },
            update() { return b; },
            maybeSingle() { unico = true; return b; },
            then(ok, ko) {
                const filas = (db[tabla] || []).filter(f => filtros.every(([c, v]) => f[c] === v) && distintos.every(([c, v]) => f[c] !== v));
                return Promise.resolve({ data: unico ? (filas[0] || null) : filas, error: null }).then(ok, ko);
            }
        };
        return b;
    }
});

// -------------------------------------------------------------- espías ---

const espias = { enviados: [], reservados: [], gemini: 0 };
let eventoActual = null;

inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ text }) => { espias.enviados.push(text); },
    sendImage: async () => {},
    sendReaction: async () => {}
});
inyectar(r("bot/ai/aiService.js"), { suggestReply: async () => { espias.gemini++; return null; } });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("bot/funciones/eventos/detectarEvento.js"), { detectarEvento: async () => null });
inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => eventoActual });
inyectar(r("bot/funciones/reservas/reaccionReserva.js"), { decidirReaccion: () => null, reaccionarAlMensaje: async () => {} });
inyectar(r("bot/funciones/reservas/actualizarEvento.js"), { actualizarEvento: async () => {} });
inyectar(r("bot/funciones/reservas/consultarReservas.js"), {
    consultarReservas: async (_evento, numeros) => numeros.map(numero => ({ numero, estado: "libre" }))
});
inyectar(r("bot/funciones/reservas/reservarNumeros.js"), {
    reservarNumeros: async ({ numeros }) => { espias.reservados.push(...numeros); return numeros.map(numero => ({ numero })); }
});

const { extraerNumeros } = require(r("bot/funciones/reservas/extraerNumeros.js"));
const { extraerValorNumero } = require(r("bot/funciones/eventos/extractor/extraerValorNumero.js"));
const { pareceAnuncioDeSorteo } = require(r("bot/funciones/eventos/extraerEvento.js"));
const { detectarIntencion } = require(r("bot/funciones/consultas/detectarIntencion.js"));
const { detectarReserva } = require(r("bot/funciones/reservas/detectarReserva.js"));
const eventHandler = require(r("bot/handlers/eventHandler.js"));

// ----------------------------------------------------------------- datos ---

const USUARIO = { id: "cliente-1", nombre: "Ana" };
const ABIERTO = { id: "ev-1", usuario_id: "tenant-test", nombre_evento: "Lotería De Medellín", tabla: TABLA, cifras: 2, valor: 3000, activo: true, abierto: true, estado: "abierto", hora_cierre: null };

const ANUNCIOS = [
    "🎯 LOTERÍA DE MANIZALES 10:30 PM\n💰 Valor número: 5000\n🏆 Premio: $500.000",
    "Sorteo de hoy Lotería de Medellín 10:40 pm\nValor número 3000\nPremio 300.000\nNúmeros disponibles",
    "🎰 SINUANO DIA 2:30 PM 🎰\nValor número $2.000\nPremio $200.000",
    "Lotería de Boyacá 10:40 pm valor número 5.000 premio 1.000.000"
];

// Cada mensaje en su propio grupo: la ventana anti-ráfaga de disponibilidad
// (8 s por grupo, controlDisponibilidad.js) no debe mezclar pruebas.
function ctxDe(texto) {
    const grupo = `grupo-${Math.random()}@g.us`;
    return {
        chat: { esGrupo: true, remoteJid: grupo },
        message: { key: { id: `m-${Math.random()}`, fromMe: false, remoteJid: grupo, participant: "1@s.whatsapp.net" }, message: { conversation: texto } },
        textoOriginal: texto,
        usuario: USUARIO,
        session: { usuarioId: "tenant-1" },
        sock: {}
    };
}

async function procesar(texto) {
    espias.enviados = [];
    espias.reservados = [];
    await eventHandler(ctxDe(texto));
    return { enviados: [...espias.enviados], reservados: [...espias.reservados] };
}

// ----------------------------------------------------------------- runner ---

let ok = 0;
let fallidas = 0;

async function test(nombre, fn) {
    try {
        await fn();
        ok++;
        console.log(`✅ ${nombre}`);
    } catch (error) {
        fallidas++;
        console.log(`❌ ${nombre}\n   ${error.message}`);
    }
}

(async () => {

    // ------------------------------------------------------------- A ---

    const HORAS = [
        ["a las 10:30", []],
        ["Lotería de Bogotá 10:30 quiero el 25", ["25"]],
        ["juega 2:30 PM, dame el 07", ["07"]],
        ["10pm", []],
        ["el sorteo es 10 p.m.", []],
        ["10:40pm el 45", ["45"]]
    ];

    for (const [texto, esperado] of HORAS) {
        await test(`A. hora no es número: "${texto}" -> ${JSON.stringify(esperado)}`, () => {
            assert.deepStrictEqual(extraerNumeros(texto, 2), esperado);
        });
    }

    const RESERVAS = [
        ["25", ["25"]],
        ["12 45", ["12", "45"]],
        ["dame el 07 y el 99", ["07", "99"]],
        ["el 10 y el 30", ["10", "30"]],
        ["10-30", ["10", "30"]],
        ["10, 30", ["10", "30"]],
        ["O1", ["01"]]
    ];

    for (const [texto, esperado] of RESERVAS) {
        await test(`A. reserva intacta: "${texto}" -> ${JSON.stringify(esperado)}`, () => {
            assert.deepStrictEqual(extraerNumeros(texto, 2), esperado);
        });
    }

    // ------------------------------------------------------------- B ---

    const PRECIOS = [
        ["Valor número: 5000", 5000],
        ["💰 Valor número $3.000", 3000],
        ["Valor del número: 1.500", 1500],
        ["Lotería de Bogotá 10:30 valor número 5000", 5000],
        ["Lotería de Boyacá 10:40 pm valor número 5.000 premio 1.000.000", 5000],
        ["$2.000 cada número", 2000],
        ["Cada número 7000", 7000],
        ["Sin precio en el texto", null]
    ];

    for (const [texto, esperado] of PRECIOS) {
        await test(`B. precio: "${texto}" -> ${esperado}`, () => {
            assert.strictEqual(extraerValorNumero(texto), esperado);
        });
    }

    // ------------------------------------------------------------- C ---

    for (const texto of ANUNCIOS) {
        await test(`C. anuncio reconocido: ${JSON.stringify(texto.slice(0, 40))}`, () => {
            assert.strictEqual(pareceAnuncioDeSorteo(texto), true);
        });
    }

    const CLIENTES = ["dame el 25", "el 25 para mí", "25", "¿Qué números quedan?", "tabla", "mis números", "qué debo",
        "a qué hora juega la lotería de Manizales? a las 10:30", "¿está libre el 45?", "Sorteo Chontico 10pm"];

    for (const texto of CLIENTES) {
        await test(`C. mensaje de cliente NO es anuncio: "${texto}"`, () => {
            assert.strictEqual(pareceAnuncioDeSorteo(texto), false);
        });
    }

    await test('C. "Lotería de Medellín 10:40 pm ... Números disponibles" ya no es numero_especifico del 10', () => {
        assert.notStrictEqual(detectarIntencion(ANUNCIOS[1], 2).tipo, "numero_especifico");
    });

    // ------------------------------------------------------------- D ---

    const ESTADOS = [
        ["sorteo abierto", { ...ABIERTO }, ["25"]],
        ["apertura fallida (abierto=false, activo=true): el sorteo sigue vigente", { ...ABIERTO, abierto: false }, ["25"]],
        ["sorteo de mañana con hora de cierre ya pasada hoy", { ...ABIERTO, hora_cierre: "00:00", fecha_evento: "2099-01-01" }, ["25"]],
        ["activo=false", { ...ABIERTO, activo: false }, []],
        ["estado cerrado", { ...ABIERTO, estado: "cerrado" }, []],
        ["hora de cierre pasada (WhatsApp no cerró el grupo)", { ...ABIERTO, hora_cierre: "00:00" }, []]
    ];

    for (const [nombre, evento, esperado] of ESTADOS) {
        await test(`D. ${nombre} -> reserva ${JSON.stringify(esperado)}`, async () => {
            espias.reservados = [];
            await detectarReserva({ evento, texto: "dame el 25", usuario: USUARIO });
            assert.deepStrictEqual(espias.reservados, esperado);
        });
    }

    await test("D. sorteo cerrado: las consultas siguen respondiendo (\"mis números\")", async () => {
        eventoActual = { ...ABIERTO, activo: false, estado: "cerrado" };
        db[TABLA] = [{ usuario_id: "tenant-test", numero: "25", estado: "reservado", usuario_global_id: "cliente-1" }];
        const { enviados, reservados } = await procesar("mis números");
        assert.strictEqual(enviados.length, 1);
        assert.match(enviados[0], /25/);
        assert.deepStrictEqual(reservados, []);
    });

    await test("D. sorteo cerrado: \"dame el 25\" no reserva ni responde", async () => {
        eventoActual = { ...ABIERTO, activo: false, estado: "cerrado" };
        const { enviados, reservados } = await procesar("dame el 25");
        assert.deepStrictEqual(reservados, []);
        assert.strictEqual(enviados.length, 0);
    });

    // ------------------------------------------------------------- E ---

    for (const texto of ANUNCIOS) {
        await test(`E. anuncio por el flujo real: 0 respuestas y 0 reservas — ${JSON.stringify(texto.slice(0, 30))}`, async () => {
            eventoActual = { ...ABIERTO };
            db[TABLA] = NUMEROS.map(numero => ({ usuario_id: "tenant-test", numero, estado: "libre" }));
            const { enviados, reservados } = await procesar(texto);
            assert.deepStrictEqual(reservados, []);
            assert.strictEqual(enviados.length, 0, `respondió: ${enviados[0]}`);
        });
    }

    for (const [texto, esperado] of [["dame el 25", ["25"]], ["el 25 para mí", ["25"]], ["12 45", ["12", "45"]], ["mío el 55", ["55"]]]) {
        await test(`E. reserva normal por el flujo real: "${texto}" -> ${JSON.stringify(esperado)} y 1 respuesta`, async () => {
            eventoActual = { ...ABIERTO };
            const { enviados, reservados } = await procesar(texto);
            assert.deepStrictEqual(reservados, esperado);
            assert.strictEqual(enviados.length, 1);
        });
    }

    for (const texto of ["¿Qué números quedan?", "tabla", "números disponibles"]) {
        await test(`E. disponibilidad por el flujo real: "${texto}" -> 1 respuesta, 0 reservas`, async () => {
            eventoActual = { ...ABIERTO, id: `ev-${Math.random()}` };
            db[TABLA] = NUMEROS.map(numero => ({ usuario_id: "tenant-test", numero, estado: numero === "25" ? "reservado" : "libre" }));
            const { enviados, reservados } = await procesar(texto);
            assert.deepStrictEqual(reservados, []);
            assert.strictEqual(enviados.length, 1);
        });
    }

    console.log(`\nPruebas: ${ok + fallidas}  |  OK: ${ok}  |  Fallidas: ${fallidas}`);

    process.exit(fallidas > 0 ? 1 : 0);

})();
