// ==========================================================================
// PRUEBAS — avisos ❌, avisos "sin disponibilidad" y cuentas propias.
//
//   1. ❌ en el contenido original -> nunca se procesa ni se responde
//      (queda en el historial).
//   2. "Sin / no hay / ya no quedan números" (afirmación) -> no dispara la
//      consulta de disponibilidad; las PREGUNTAS sí ("¿No quedan números?").
//   3. Cuentas propias (sesiones conectadas: sock.user id/lid) -> no
//      disparan reservas/consultas, pero sus anuncios de sorteo y stickers
//      de pago siguen funcionando. ADMIN != IGNORAR TODO.
//   4. Sin bucles entre bots propios.
//
// Reales: messages.upsert.js, compuertaIngreso.js, messageHandler.js,
// dispatcher.js, eventHandler.js, detectarIntencion.js,
// cuentasIgnoradas.js, mensajeConCruz.js, normalizarMensaje.js,
// guardarMensajeGrupo.js. Simulados: Supabase, manager (sesiones
// conectadas), obtenerContexto y los extremos de negocio como espías.
//
//     node backend/tests/mensajes/avisosYCuentasPropias.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ------------------------------------------------------------ Supabase ---

function crearFakeSupabase() {

    const tablas = { mensajes_grupos_sorteos: [] };
    let siguienteId = 1;

    function builder(tabla) {

        const filtros = [];
        let operacion = "select";
        let fila = null;
        let limite = null;
        let single = false;

        const ejecutar = async () => {
            const filas = tablas[tabla] || (tablas[tabla] = []);
            if (operacion === "insert") {
                const nueva = { id: siguienteId++, ...fila };
                filas.push(nueva);
                return { data: single ? nueva : [nueva], error: null };
            }
            if (operacion === "update") return { data: null, error: null };
            let res = filas.filter(f => filtros.every(([c, v]) => f[c] === v));
            if (limite !== null) res = res.slice(0, limite);
            return { data: single ? (res[0] || null) : res, error: null };
        };

        const b = {
            select() { return b; },
            insert(f) { operacion = "insert"; fila = f; return b; },
            update(f) { operacion = "update"; fila = f; return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            limit(n) { limite = n; return b; },
            single() { single = true; return b; },
            maybeSingle() { single = true; return b; },
            then(ok, ko) { return ejecutar().then(ok, ko); }
        };

        return b;

    }

    return { client: { from: builder }, tablas };

}

// ------------------------------------------------------------- entorno ---

const GRUPO = "120363000000000001@g.us";
const EVENTO = { id: "ev-1", nombre_evento: "Chontico", cifras: 2, tabla: "reservas_dos_cifras" };

// Cuentas de prueba
const CLIENTE = "100000000001@lid";
const ADMIN_EXTERNO = "200000000002@lid";          // admin del grupo, NO es sesión propia
const SESION_PROPIA_LID = "4289612858";             // p. ej. "Reservas 01 Efaat"
const SESION_PROPIA_TEL = "573009998877";

const acciones = {};
let fake;

function reiniciarAcciones() {
    Object.assign(acciones, {
        detectarEvento: [], abrirGrupo: [], detectarReserva: [], consultas: [], respuestas: [], confirmarPago: []
    });
}

function cargar() {

    fake = crearFakeSupabase();
    reiniciarAcciones();

    inyectar(r("lib/supabase.js"), fake.client);

    // Sesiones conectadas en el proceso: la activa (cuenta del bot) y una
    // secundaria propia cuya identidad real es sock.user (= creds.me).
    inyectar(r("services/baileys/manager.js"), {
        sockets: new Map([
            ["activa", { user: { id: "573000000000:3@s.whatsapp.net", lid: "999000000000:3@lid" } }],
            ["reservas01", { user: { id: `${SESION_PROPIA_TEL}:7@s.whatsapp.net`, lid: `${SESION_PROPIA_LID}:7@lid` } }]
        ]),
        getActiveSocket: () => null,
        getActiveSession: () => "activa"
    });

    const obtenerChat = require(r("bot/middleware/obtenerChat.js"));
    const normalizarMensaje = require(r("bot/middleware/normalizarMensaje.js"));

    inyectar(r("bot/middleware/obtenerContexto.js"), async (sock, message) => {
        const chat = obtenerChat(message);
        const { textoOriginal, texto } = normalizarMensaje(message);
        const lid = (message.key.participant || "").endsWith("@lid") ? message.key.participant : null;
        return {
            sock, message, chat,
            usuario: message.key.fromMe ? null : { id: `u-${message.key.participant}`, lid, telefono: message._telefono || null },
            grupo: { remoteJid: chat.remoteJid },
            textoOriginal: textoOriginal || null,
            texto: texto || null,
            numeros: []
        };
    });

    inyectar(r("bot/funciones/mensajes/clasificarMensaje.js"), { clasificarMensaje: async () => {} });
    inyectar(r("bot/funciones/pagos/registrarStickerPago.js"), { registrarStickerPago: async () => ({ intervino: false }) });
    inyectar(r("bot/funciones/pagos/confirmarPagoPorSticker.js"), {
        confirmarPagoPorSticker: async (ctx) => {
            if (ctx.message.message?.stickerMessage) acciones.confirmarPago.push(ctx.message.key.id);
        }
    });
    inyectar(r("bot/funciones/eventos/detectarEvento.js"), {
        detectarEvento: async (ctx) => {
            acciones.detectarEvento.push(ctx.message.key.id);
            if (/sorteo/i.test(ctx.textoOriginal || "")) {
                acciones.abrirGrupo.push(ctx.message.key.id);
                return EVENTO;
            }
            return null;
        }
    });
    inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => EVENTO });
    inyectar(r("bot/funciones/reservas/detectarReserva.js"), {
        detectarReserva: async ({ texto }) => { acciones.detectarReserva.push(texto); return { ok: true, mensaje: "ok" }; }
    });
    inyectar(r("bot/funciones/consultas/resolverConsulta.js"), {
        resolverConsulta: async ({ tipo }) => { acciones.consultas.push(tipo); return { tipo, mensaje: "No quedan números disponibles." }; }
    });
    inyectar(r("bot/ai/responderResultado.js"), {
        responderResultado: async (ctx) => { acciones.respuestas.push(ctx.message.key.id); }
    });
    inyectar(r("bot/ai/configMensajes.js"), { estaRespuestaHabilitada: async () => true });

    [
        "bot/events/messages.upsert.js",
        "bot/handlers/messageHandler.js",
        "bot/handlers/dispatcher.js",
        "bot/handlers/eventHandler.js",
        "bot/funciones/mensajes/guardarMensajeGrupo.js",
        "bot/funciones/mensajes/compuertaIngreso.js",
        "bot/funciones/mensajes/cuentasIgnoradas.js",
        "bot/funciones/mensajes/mensajeConCruz.js"
    ].map(r).forEach(p => delete require.cache[p]);

    const upsert = require(r("bot/events/messages.upsert.js"));
    const sock = { ev: new EventEmitter(), context: { sessionId: "activa", usuarioId: "tenant-1" } };
    upsert.registerMessages(sock, "activa");

    return { upsert, sock };

}

let contador = 0;

function msg(contenido, { de = CLIENTE, alt = null, telefono = null, fromMe = false } = {}) {
    const m = {
        key: { id: `M-${++contador}`, remoteJid: GRUPO, fromMe, participant: de, participantAlt: alt },
        message: contenido,
        messageTimestamp: Math.floor(Date.now() / 1000)
    };
    if (telefono) m._telefono = telefono;
    return m;
}

const texto = (t, op) => msg({ conversation: t }, op);
const imagen = (caption, op) => msg({ imageMessage: { caption } }, op);
const sticker = (op) => msg({ stickerMessage: { fileSha256: "abc" } }, op);

async function entregar(sock, m) {
    sock.ev.emit("messages.upsert", { messages: [m], type: "notify" });
    await new Promise(res => setTimeout(res, 25));
    return m.key.id;
}

function registrado(id) {
    return fake.tablas.mensajes_grupos_sorteos.some(f => f.mensaje_id === id);
}

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("❌ — los 8 mensajes de la tabla se ignoran por completo (cliente y admin), quedan en historial", async () => {

    const { upsert, sock } = cargar();

    const mensajes = ["❌", "❌ hola", "hola ❌", "hola ❌ mundo", "❌ sin números disponibles", "❌ quedan 3 números", "Número ❌", "texto cualquiera ❌ texto cualquiera", "❌❌❌", "45 ❌", "❌ Sorteo Chontico 10pm valor 5000"];

    for (const de of [CLIENTE, ADMIN_EXTERNO]) {
        for (const t of mensajes) {
            const id = await entregar(sock, texto(t, { de }));
            assert.ok(!acciones.detectarEvento.includes(id), `no llega a detectarEvento: ${t}`);
            assert.ok(!acciones.detectarReserva.includes(t), `no reserva: ${t}`);
            assert.ok(!acciones.respuestas.includes(id), `no responde: ${t}`);
            assert.ok(registrado(id), `queda en historial: ${t}`);
        }
    }

    assert.strictEqual(acciones.consultas.length, 0);

    // pie de foto con ❌
    const idImg = await entregar(sock, imagen("❌ Sin números disponibles", { de: ADMIN_EXTERNO }));
    assert.ok(!acciones.detectarEvento.includes(idImg));

    upsert.unregisterMessages("activa");

});

prueba("Disponibilidad legítima de cliente -> CONSULTA y responde", async () => {

    const { upsert, sock } = cargar();

    for (const t of ["¿Qué números quedan?", "¿Cuáles están disponibles?", "¿Qué números hay disponibles?", "Muéstrame los disponibles", "¿No quedan números?", "¿Ya no quedan?", "¿No hay disponibles?"]) {
        const id = await entregar(sock, texto(t));
        assert.ok(acciones.respuestas.includes(id), `debe responder: ${t}`);
    }

    assert.ok(acciones.consultas.every(c => c === "disponibilidad"));
    assert.strictEqual(acciones.consultas.length, 7);

    upsert.unregisterMessages("activa");

});

prueba("Avisos/negaciones de cliente o admin -> NO dispara consulta automática", async () => {

    const { upsert, sock } = cargar();

    for (const de of [CLIENTE, ADMIN_EXTERNO]) {
        for (const t of ["Sin números disponibles", "No hay números disponibles", "Ya no quedan números", "No quedan números", "Sin disponible por el momento familia"]) {
            const id = await entregar(sock, texto(t, { de }));
            assert.ok(!acciones.respuestas.includes(id), `no responde: ${t}`);
        }
    }

    assert.strictEqual(acciones.consultas.length, 0);

    upsert.unregisterMessages("activa");

});

prueba("ADMIN != IGNORAR TODO — un admin externo que pregunta o anuncia sí se procesa", async () => {

    const { upsert, sock } = cargar();

    const pregunta = await entregar(sock, texto("¿Qué números quedan?", { de: ADMIN_EXTERNO }));
    assert.ok(acciones.respuestas.includes(pregunta), "pregunta real de un admin -> responde");

    const anuncio = await entregar(sock, imagen("Sorteo Chontico 10pm valor 5000", { de: ADMIN_EXTERNO }));
    assert.ok(acciones.abrirGrupo.includes(anuncio), "anuncio de un admin -> abre grupo");

    const stk = await entregar(sock, sticker({ de: ADMIN_EXTERNO }));
    assert.ok(acciones.confirmarPago.includes(stk), "sticker de un admin -> confirma pago");

    upsert.unregisterMessages("activa");

});

prueba("Sesión propia (sock.user) — mensaje automático NO se toma como cliente; anuncio y sticker SÍ se procesan", async () => {

    const { upsert, sock } = cargar();

    const propia = { de: `${SESION_PROPIA_LID}@lid` };

    const auto1 = await entregar(sock, texto("No quedan números disponibles.", propia));
    const auto2 = await entregar(sock, texto("Números disponibles (3): 12 34 56", propia));
    const auto3 = await entregar(sock, texto("¿Qué números quedan?", propia));
    const res = await entregar(sock, texto("71", propia));

    for (const id of [auto1, auto2, auto3, res]) {
        assert.ok(!acciones.respuestas.includes(id), "la sesión propia no dispara respuestas");
    }
    assert.strictEqual(acciones.consultas.length, 0);
    assert.deepStrictEqual(acciones.detectarReserva, [], "la sesión propia no reserva por texto (igual que fromMe)");

    const anuncio = await entregar(sock, imagen("Sorteo Chontico 10pm valor 5000", propia));
    assert.ok(acciones.abrirGrupo.includes(anuncio), "su anuncio de sorteo sigue abriendo el grupo");

    const stk = await entregar(sock, sticker(propia));
    assert.ok(acciones.confirmarPago.includes(stk), "su sticker de pago sigue confirmando");

    // reconocida también por número (participantAlt / teléfono resuelto)
    const porAlt = await entregar(sock, texto("¿Qué números quedan?", { de: "777777777777@lid", alt: `${SESION_PROPIA_TEL}@s.whatsapp.net` }));
    const porTel = await entregar(sock, texto("¿Qué números quedan?", { de: "888888888888@lid", telefono: SESION_PROPIA_TEL }));
    assert.ok(!acciones.respuestas.includes(porAlt) && !acciones.respuestas.includes(porTel));

    upsert.unregisterMessages("activa");

});

prueba("Sin bucle entre bots — la respuesta fija de OTRO bot ya no es una consulta, aunque no sea sesión conocida", async () => {

    const { upsert, sock } = cargar();

    // otro bot propio en OTRA instancia (no está en sock.user de este proceso)
    const otroBot = { de: "555555555555@lid" };

    for (const t of ["No quedan números disponibles.", "❌ Los números solicitados ya están ocupados."]) {
        const id = await entregar(sock, texto(t, otroBot));
        assert.ok(!acciones.respuestas.includes(id), `no responde a: ${t}`);
    }

    assert.strictEqual(acciones.consultas.length, 0);

    upsert.unregisterMessages("activa");

});

prueba("Regresión — cliente: reserva normal, anuncio normal y sticker normal siguen igual", async () => {

    const { upsert, sock } = cargar();

    const r1 = await entregar(sock, texto("71"));
    assert.deepStrictEqual(acciones.detectarReserva, ["71"]);
    assert.ok(acciones.respuestas.includes(r1));

    const a = await entregar(sock, imagen("Sorteo Chontico 10pm valor 5000"));
    assert.ok(acciones.abrirGrupo.includes(a));

    const s = await entregar(sock, sticker());
    assert.ok(acciones.confirmarPago.includes(s));

    // un cliente que RESPONDE (cita) a un mensaje del bot con ❌ sigue pudiendo reservar
    const cita = texto("dame el 45");
    cita.message = { extendedTextMessage: { text: "dame el 45", contextInfo: { quotedMessage: { conversation: "❌ el 63 ya está ocupado" } } } };
    await entregar(sock, cita);
    assert.ok(acciones.detectarReserva.includes("dame el 45"));

    upsert.unregisterMessages("activa");

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
