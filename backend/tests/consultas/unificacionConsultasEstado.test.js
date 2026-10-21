// ==========================================================================
// PRUEBAS — Unificación de consultas de números y estado de pago.
//
//   A. Frases como INTENCIONES: "mis números" (todo con su estado) y UNA
//      respuesta de pago para "qué debo", "cuánto debo", "¿estoy al día?" y
//      "¿ya pagué?", con sus errores de escritura ("q devo", "ya page?").
//      Las afirmaciones ("ya pagué") no reciben respuesta. "pasar",
//      "pasado" y "falta para el sorteo" no son pago.
//   B. Regresión de reservas: "dame el 25", "el 25 para mí"... siguen
//      siendo reserva; "cancelé el 25" nunca es reserva.
//   C. Una sola lectura y estados reales (sin números / todo pendiente /
//      todo pagado / mixto); el pago muestra solo pendientes; sin precio
//      nunca "$0".
//   D. Respuesta: sin Gemini, plantillas con montos descartadas sin
//      precio, plantillas de estado solo para la respuesta de pago, y la
//      clave antigua "consulta_pago" ya no silencia.
//   E. Flujo real (eventHandler): una afirmación de pago no responde, no
//      lee ni modifica la tabla; "¿ya pagué?" hace una sola lectura.
//
// Reales: detectarIntencion.js, consultarMisNumeros.js, resolverConsulta.js,
// responderResultado.js, configMensajes.js, plantillaMensaje.js,
// eventHandler.js. Simulados: Supabase (en memoria), envío por WhatsApp,
// Gemini (espía) y la detección del evento del grupo.
//
//     node backend/tests/consultas/unificacionConsultasEstado.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ------------------------------------------------------------- Supabase ---

const TABLA = "reservas_test_unificacion";

const db = {
    [TABLA]: [],
    plantillas_mensaje: [],
    configuracion_seleccion_mensajes: []
};

const lecturas = { [TABLA]: 0 };

const fakeSupabase = {
    from(tabla) {
        const filtros = [];
        const distintos = [];
        let operacion = "select";
        let cambios = null;
        let unico = false;
        let orden = null;
        const b = {
            select() { return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            neq(c, v) { distintos.push([c, v]); return b; },
            or() { return b; },
            in() { return b; },
            order(c) { orden = c; return b; },
            update(x) { operacion = "update"; cambios = x; return b; },
            maybeSingle() { unico = true; return b; },
            single() { unico = true; return b; },
            then(ok, ko) {
                if (tabla === TABLA && operacion === "select") lecturas[TABLA]++;
                const filas = (db[tabla] || []).filter(f =>
                    filtros.every(([c, v]) => f[c] === v) && distintos.every(([c, v]) => f[c] !== v));
                let res;
                if (operacion === "update") {
                    filas.forEach(f => Object.assign(f, cambios));
                    res = { data: null, error: null };
                } else {
                    if (orden) filas.sort((a, z) => String(a[orden]).localeCompare(String(z[orden])));
                    res = { data: unico ? (filas[0] || null) : filas, error: null };
                }
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

// -------------------------------------------------------------- espías ---

const espias = { gemini: 0, enviados: [] };

let eventoActual = null;

inyectar(r("bot/ai/aiService.js"), {
    suggestReply: async () => { espias.gemini++; return { respuesta: "Respuesta inventada por IA" }; }
});
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ text }) => { espias.enviados.push(text); },
    sendImage: async () => {}
});
inyectar(r("bot/funciones/eventos/detectarEvento.js"), { detectarEvento: async () => eventoActual });
inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => eventoActual });

const { detectarIntencion } = require(r("bot/funciones/consultas/detectarIntencion.js"));
const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));
const { responderResultado } = require(r("bot/ai/responderResultado.js"));
const eventHandler = require(r("bot/handlers/eventHandler.js"));

// ----------------------------------------------------------------- datos ---

const TENANT = "tenant-1";
const USUARIO = { id: "cliente-1" };
const CON_PRECIO = { id: "ev-1", nombre_evento: "Lotería De Manizales", tabla: TABLA, cifras: 2, valor: 5000 };
const SIN_PRECIO = { ...CON_PRECIO, valor: null };

function sembrar(filas) {
    db[TABLA] = filas.map(([numero, estado, dueno = "cliente-1"]) => ({ numero, estado, usuario_global_id: dueno }));
}

const ESCENARIOS = {
    sinNumeros: [["50", "pagado", "cliente-2"]],
    todoPendiente: [["12", "reservado"], ["45", "reservado"]],
    todoPagado: [["12", "pagado"], ["45", "pagado"]],
    mixto: [["12", "pagado"], ["45", "reservado"], ["60", "bloqueado"], ["70", "reservado", "cliente-2"]]
};

function ctxDe(texto, evento) {
    return {
        chat: { esGrupo: true, remoteJid: "grupo@g.us" },
        message: { key: { id: `m-${Math.random()}`, fromMe: false, remoteJid: "grupo@g.us", participant: "1@s.whatsapp.net" }, message: { conversation: texto } },
        textoOriginal: texto,
        usuario: USUARIO,
        evento,
        session: { usuarioId: TENANT },
        sock: {}
    };
}

async function responder(texto, evento = CON_PRECIO) {
    const intencion = detectarIntencion(texto, 2);
    const ctx = ctxDe(texto, evento);
    ctx.consulta = await resolverConsulta({ ...intencion, evento, usuario: USUARIO });
    espias.enviados = [];
    await responderResultado(ctx);
    return { intencion, consulta: ctx.consulta, texto: espias.enviados[0] };
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

function clasif(texto) {
    const i = detectarIntencion(texto, 2);
    return i.modo ? `${i.tipo}:${i.modo}/${i.bucket}` : i.tipo;
}

(async () => {

    // ------------------------------------------------------------- A ---

    // Dos respuestas: "mis números" y la de PAGO (consulta_pago:resumen/
    // pendiente) — la misma para "qué debo", "cuánto debo", "¿estoy al
    // día?" y "¿ya pagué?". Las afirmaciones de pago no reciben respuesta.
    const PAGO = "consulta_pago:resumen/pendiente";

    const FRASES = [
        ["Mis números", "mis_numeros"],
        ["¿Cuáles son mis números?", "mis_numeros"],
        ["¿Qué números tengo?", "mis_numeros"],
        ["mis nuemros", "mis_numeros"],
        ["q numeros tengo", "mis_numeros"],
        ["¿Cuáles tengo pagos y cuáles no?", "mis_numeros"],
        ["¿Qué debo?", PAGO],
        ["q devo", PAGO],
        ["que devo", PAGO],
        ["k debo", PAGO],
        ["¿Debo algo?", PAGO],
        ["¿Cuánto debo?", PAGO],
        ["cuanto devo", PAGO],
        ["¿Cuánto me falta?", PAGO],
        ["¿Qué me falta por pagar?", PAGO],
        ["¿Qué números me faltan por pagar?", PAGO],
        ["¿Qué me falta?", PAGO],
        ["¿Ya pagué?", PAGO],
        ["ya page?", PAGO],
        ["¿ya estoy paga?", PAGO],
        ["si ya pagué", PAGO],
        ["ya pagué o no", PAGO],
        ["¿Estoy al día?", PAGO],
        ["ya estoy al día", PAGO],
        ["¿Ya quedé al día?", PAGO],
        ["¿Cómo voy?", PAGO],
        ["¿Qué números debo?", "consulta_pago:lista/pendiente"],
        ["¿Cuáles tengo pagos?", "consulta_pago:lista/pagado"],
        ["¿Cuáles están cancelados?", "consulta_pago:lista/pagado"],
        ["¿Cuántos me faltan por pagar?", "consulta_pago:cantidad/pendiente"],
        ["¿Cuántos números tengo?", "cantidad_reservas"]
    ];

    // Afirmaciones: el pago lo confirma el administrador (sticker) — el bot
    // no responde ni confirma nada.
    for (const texto of ["ya pagué", "ya page", "ya les pagué", "listo, ya pagué", "ya estoy paga", "ya cancelé", "ya quedó pago", "quiero pagar", "actualiza mi pago"]) {
        await test(`A. afirmación "${texto}" => ninguna (sin respuesta)`, () => assert.strictEqual(clasif(texto), "ninguna"));
    }

    for (const [texto, esperado] of FRASES) {
        await test(`A. "${texto}" => ${esperado}`, () => assert.strictEqual(clasif(texto), esperado));
    }

    const NO_PAGO = [
        ["me puedes pasar la tabla", "disponibilidad"],
        ["el sorteo pasado", "info_evento"],
        ["¿Cuánto falta para el sorteo?", "info_evento"],
        ["¿Qué números quedan?", "disponibilidad"],
        ["números disponibles", "disponibilidad"]
    ];

    for (const [texto, esperado] of NO_PAGO) {
        await test(`A. "${texto}" NO es pago => ${esperado}`, () => assert.strictEqual(clasif(texto), esperado));
    }

    // ------------------------------------------------------------- B ---

    for (const texto of ["dame el 25", "el 25 para mí", "me llevo el 25", "25", "quiero el 12 y el 45", "mío el 55", "sepárame el 45"]) {
        await test(`B. reserva intacta: "${texto}"`, () => assert.strictEqual(detectarIntencion(texto, 2).tipo, "reserva"));
    }

    for (const texto of ["cancelé el 25", "ya cancelé el 25", "el 25 está cancelado", "ya page el 25", "ya pagué el 25 y el 30"]) {
        await test(`B. afirmación "${texto}" => ninguna (nunca reserva, nunca confirma)`, () => {
            assert.strictEqual(detectarIntencion(texto, 2).tipo, "ninguna");
        });
    }

    for (const texto of ["¿ya cancelé el 25?", "el 25 está pago?", "¿el 25 ya está pagado?"]) {
        await test(`B. pregunta "${texto}" => estado real del 25 (numero_especifico)`, () => {
            const i = detectarIntencion(texto, 2);
            assert.strictEqual(i.tipo, "numero_especifico");
            assert.deepStrictEqual(i.numeros, ["25"]);
        });
    }

    // ------------------------------------------------------------- C ---

    await test("C. mixto: una sola lectura y solo reservado/pagado propios (bloqueado y ajenos fuera)", async () => {
        sembrar(ESCENARIOS.mixto);
        lecturas[TABLA] = 0;
        const c = await resolverConsulta({ tipo: "mis_numeros", evento: CON_PRECIO, usuario: USUARIO });
        assert.strictEqual(lecturas[TABLA], 1);
        assert.deepStrictEqual(c.numerosDelUsuario, ["12", "45"]);
        assert.deepStrictEqual(c.pagados, ["12"]);
        assert.deepStrictEqual(c.reservados, ["45"]);
        assert.strictEqual(c.estadoPago, "pago_parcial");
    });

    // "mis números" muestra todo con su estado; las 4 preguntas de pago dan
    // la MISMA respuesta: solo lo pendiente (+ valor), o "estás al día".
    const ESPERADO_MIS_NUMEROS = {
        sinNumeros: /^No tienes números en este sorteo\.$/,
        todoPendiente: /^Tus números son: \( 12 - 45 \)\n⏳ Todos están pendientes de pago\.$/,
        todoPagado: /^Tus números son: \( 12 - 45 \)\n✅ Todos están pagados\.$/,
        mixto: /^Tus números son: \( 12 - 45 \)\n✅ Pagado: \( 12 \)\n⏳ Pendiente de pago: \( 45 \)$/
    };
    const ESPERADO_PAGO = {
        sinNumeros: "No tienes números en este sorteo, así que no debes nada.",
        todoPendiente: "⏳ Te falta pagar: ( 12 - 45 ) — $10.000.",
        todoPagado: "✅ Estás al día: no tienes números pendientes de pago.",
        mixto: "⏳ Te falta pagar: ( 45 ) — $5.000."
    };

    for (const escenario of Object.keys(ESPERADO_PAGO)) {

        await test(`C. ${escenario} + "mis números": todos con su estado real`, async () => {
            sembrar(ESCENARIOS[escenario]);
            const { texto } = await responder("mis números");
            assert.match(texto, ESPERADO_MIS_NUMEROS[escenario]);
        });

        for (const pregunta of ["qué debo", "cuánto debo", "¿ya pagué?", "¿estoy al día?", "q devo"]) {
            await test(`C. ${escenario} + "${pregunta}": misma respuesta de pago (solo pendientes)`, async () => {
                sembrar(ESCENARIOS[escenario]);
                const { texto } = await responder(pregunta);
                assert.strictEqual(texto, ESPERADO_PAGO[escenario]);
            });
        }

    }

    for (const pregunta of ["qué debo", "cuánto debo", "cuánto he pagado", "cuánto es todo", "mis números", "estoy al día"]) {
        await test(`C. sin precio configurado: "${pregunta}" nunca muestra "$0" ni un importe`, async () => {
            sembrar(ESCENARIOS.mixto);
            const { texto, consulta } = await responder(pregunta, SIN_PRECIO);
            assert.ok(!/\$/.test(texto), texto);
            assert.match(texto, /45/);
            assert.strictEqual(consulta.estadoPago, "pago_parcial");
        });
    }

    await test('C. sin precio, todo pagado => "pago_completo" (no "sin_pago" por montos en 0)', async () => {
        sembrar(ESCENARIOS.todoPagado);
        const { consulta } = await responder("cuánto debo", SIN_PRECIO);
        assert.strictEqual(consulta.estadoPago, "pago_completo");
    });

    // ------------------------------------------------------------- D ---

    await test("D. sin plantillas: mensaje fijo, Gemini NUNCA se llama en esta familia", async () => {
        sembrar(ESCENARIOS.mixto);
        espias.gemini = 0;
        for (const p of ["mis números", "qué debo", "¿ya pagué?", "cuántos números tengo", "mis números y cuánto debo"]) {
            await responder(p);
        }
        assert.strictEqual(espias.gemini, 0);
    });

    await test("D. plantilla del panel se respeta y muestra números pagados/pendientes reales", async () => {
        sembrar(ESCENARIOS.mixto);
        db.plantillas_mensaje = [{ id: "p1", usuario_id: TENANT, tipo_respuesta: "mis_numeros", contenido: "Pagos {{numeros_pagados}} / faltan {{numeros_pendientes}}", variables: {}, habilitada: true, orden: 1 }];
        const { texto } = await responder("mis números");
        db.plantillas_mensaje = [];
        assert.strictEqual(texto, "Pagos ( 12 ) / faltan ( 45 )");
    });

    await test("D. sin precio, plantilla con {{monto_pendiente}} se descarta (mensaje fijo, sin $0)", async () => {
        sembrar(ESCENARIOS.todoPendiente);
        db.plantillas_mensaje = [{ id: "p2", usuario_id: TENANT, tipo_respuesta: "consulta_pago_sin_pago", contenido: "Debes {{monto_pendiente}}", variables: {}, habilitada: true, orden: 1 }];
        const sin = await responder("qué debo", SIN_PRECIO);
        const con = await responder("qué debo", CON_PRECIO);
        db.plantillas_mensaje = [];
        assert.ok(!/\$/.test(sin.texto) && /12 - 45/.test(sin.texto), sin.texto);
        assert.strictEqual(con.texto, "Debes $10.000");
    });

    await test('D. fila heredada "consulta_pago" desactivada ya no silencia "qué debo"', async () => {
        sembrar(ESCENARIOS.todoPendiente);
        eventoActual = CON_PRECIO;
        db.configuracion_seleccion_mensajes = [{ id: "c1", usuario_id: TENANT, tipo_respuesta: "consulta_pago", habilitada: false }];
        espias.enviados = [];
        const ctx = ctxDe("qué debo", null);
        await eventHandler(ctx);
        assert.strictEqual(espias.enviados.length, 1);
        assert.match(espias.enviados[0], /Te falta pagar/);
    });

    await test('D. el interruptor por estado SÍ silencia ("consulta_pago_sin_pago" desactivado)', async () => {
        sembrar(ESCENARIOS.todoPendiente);
        eventoActual = CON_PRECIO;
        db.configuracion_seleccion_mensajes = [{ id: "c2", usuario_id: TENANT, tipo_respuesta: "consulta_pago_sin_pago", habilitada: false }];
        espias.enviados = [];
        await eventHandler(ctxDe("qué debo", null));
        db.configuracion_seleccion_mensajes = [];
        assert.strictEqual(espias.enviados.length, 0);
    });

    await test("D. plantilla de estado NO responde preguntas puntuales (\"¿cuáles están pagados?\" usa su mensaje fijo)", async () => {
        sembrar(ESCENARIOS.mixto);
        db.plantillas_mensaje = [{ id: "p3", usuario_id: TENANT, tipo_respuesta: "consulta_pago_pago_parcial", contenido: "⏳ Te falta pagar: {{numeros_pendientes}}", variables: {}, habilitada: true, orden: 1 }];
        const pagados = await responder("¿cuáles están pagados?");
        const debo = await responder("qué debo");
        db.plantillas_mensaje = [];
        assert.strictEqual(pagados.texto, "✅ Números pagados: ( 12 ).");
        assert.strictEqual(debo.texto, "⏳ Te falta pagar: ( 45 )");
    });

    // ------------------------------------------------------------- E ---

    for (const texto of ["ya pagué", "cancelé el 25", "ya pagué el 45"]) {
        await test(`E. afirmación "${texto}" por el flujo real: sin mensaje y sin tocar la tabla`, async () => {
            sembrar(ESCENARIOS.mixto);
            const antes = JSON.stringify(db[TABLA]);
            eventoActual = CON_PRECIO;
            db.configuracion_seleccion_mensajes = [];
            espias.enviados = [];
            lecturas[TABLA] = 0;
            await eventHandler(ctxDe(texto, null));
            assert.strictEqual(espias.enviados.length, 0, `no debe responder: ${espias.enviados[0]}`);
            assert.strictEqual(lecturas[TABLA], 0, "ni siquiera consulta los números");
            assert.strictEqual(JSON.stringify(db[TABLA]), antes, "la tabla no cambia (nunca reserva ni marca pagado)");
        });
    }

    await test('E. pregunta "¿ya pagué?" por el flujo real: UNA lectura y estado real (sin confirmar el 45)', async () => {
        sembrar(ESCENARIOS.mixto);
        eventoActual = CON_PRECIO;
        espias.enviados = [];
        lecturas[TABLA] = 0;
        await eventHandler(ctxDe("¿ya pagué?", null));
        assert.strictEqual(lecturas[TABLA], 1);
        assert.strictEqual(espias.enviados[0], "⏳ Te falta pagar: ( 45 ) — $5.000.");
    });

    console.log(`\nPruebas: ${ok + fallidas}  |  OK: ${ok}  |  Fallidas: ${fallidas}`);

    process.exit(fallidas > 0 ? 1 : 0);

})();
