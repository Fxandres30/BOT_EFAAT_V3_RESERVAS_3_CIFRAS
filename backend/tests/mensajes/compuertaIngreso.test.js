// ==========================================================================
// PRUEBAS — compuerta de ingreso: un mensaje que ya pasó NUNCA vuelve a
// ejecutar una acción, ni tras cambiar de sesión ni tras reiniciar.
//
// Reales: bot/events/messages.upsert.js (listener), messageHandler.js,
// dispatcher.js, eventHandler.js, guardarMensajeGrupo.js,
// compuertaIngreso.js, detectarIntencion.js, normalizarMensaje.js,
// obtenerChat.js, mensajesEnviados.js.
// Simulados (require.cache): Supabase (en memoria, con índice único
// opcional), obtenerContexto (identidad), y los EXTREMOS de negocio como
// espías — detectarEvento (el único camino desde un mensaje hacia
// abrirGrupo), detectarReserva, responderResultado, resolverConsulta,
// confirmarPagoPorSticker — para ver si un mensaje llega o no a ellos.
// Nunca se toca Supabase real.
//
//     node backend/tests/mensajes/compuertaIngreso.test.js
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

function crearFakeSupabase({ unico = false } = {}) {

    const tablas = { mensajes_grupos_sorteos: [] };
    let siguienteId = 1;
    const hooks = { antesDeInsertar: null };

    function builder(tabla) {

        const filtros = [];
        let operacion = "select";
        let fila = null;
        let limite = null;
        let single = false;

        const ejecutar = async () => {

            const filas = tablas[tabla] || (tablas[tabla] = []);

            if (operacion === "insert") {

                if (hooks.antesDeInsertar) await hooks.antesDeInsertar(fila, tablas);

                if (unico && tabla === "mensajes_grupos_sorteos" &&
                    filas.some(f => f.grupo_id === fila.grupo_id && f.mensaje_id === fila.mensaje_id)) {
                    return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
                }

                const nueva = { id: siguienteId++, ...fila };
                filas.push(nueva);
                return { data: single ? nueva : [nueva], error: null };

            }

            if (operacion === "update") {
                filas.filter(f => filtros.every(([c, v]) => f[c] === v)).forEach(f => Object.assign(f, fila));
                return { data: null, error: null };
            }

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

    return { client: { from: builder }, tablas, hooks };

}

// ------------------------------------------------------- espías negocio ---

function crearAcciones() {
    return {
        detectarEvento: [],   // key.id de mensajes que llegaron a detectarEvento
        abrirGrupo: [],       // key.id de mensajes que abrieron grupo
        detectarReserva: [],
        respuestas: [],
        confirmarPago: [],
        clasificados: []
    };
}

const EVENTO = { id: "ev-1", nombre_evento: "Chontico", cifras: 2, tabla: "reservas_dos_cifras" };

const RUTAS_RECARGAR = [
    "bot/events/messages.upsert.js",
    "bot/handlers/messageHandler.js",
    "bot/handlers/dispatcher.js",
    "bot/handlers/eventHandler.js",
    "bot/funciones/mensajes/guardarMensajeGrupo.js",
    "bot/funciones/mensajes/compuertaIngreso.js",
    "bot/utils/mensajesEnviados.js"
].map(r);

// Carga el pipeline REAL sobre un Supabase simulado dado. Llamar de nuevo
// con el mismo `fake` = "reinicio de PM2": memoria del proceso vacía, BD
// intacta.
function cargarPipeline(fake, acciones) {

    inyectar(r("lib/supabase.js"), fake.client);

    const obtenerChat = require(r("bot/middleware/obtenerChat.js"));
    const normalizarMensaje = require(r("bot/middleware/normalizarMensaje.js"));

    inyectar(r("bot/middleware/obtenerContexto.js"), async (sock, message) => {
        const chat = obtenerChat(message);
        const { textoOriginal, texto } = normalizarMensaje(message);
        return {
            sock, message, chat,
            usuario: message.key.fromMe ? null : { id: "u-1", lid: "111@lid", telefono: "573000000000" },
            grupo: { remoteJid: chat.remoteJid },
            textoOriginal: textoOriginal || null,
            texto: texto || null,
            numeros: []
        };
    });

    inyectar(r("bot/funciones/mensajes/clasificarMensaje.js"), {
        clasificarMensaje: async ({ mensaje }) => { acciones.clasificados.push(mensaje.mensaje_id); }
    });
    inyectar(r("bot/funciones/pagos/registrarStickerPago.js"), { registrarStickerPago: async () => ({ intervino: false }) });
    inyectar(r("bot/funciones/pagos/confirmarPagoPorSticker.js"), {
        confirmarPagoPorSticker: async (ctx) => {
            if (ctx.message.message?.stickerMessage) acciones.confirmarPago.push(ctx.message.key.id);
        }
    });

    // detectarEvento real guarda el evento y llama a abrirGrupo(); aquí se
    // registra exactamente eso para anuncios de sorteo.
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
        detectarReserva: async ({ texto }) => { acciones.detectarReserva.push(texto); return { ok: true }; }
    });
    inyectar(r("bot/funciones/consultas/resolverConsulta.js"), { resolverConsulta: async () => ({}) });
    inyectar(r("bot/ai/responderResultado.js"), {
        responderResultado: async (ctx) => { acciones.respuestas.push(ctx.message.key.id); }
    });
    inyectar(r("bot/ai/configMensajes.js"), { estaRespuestaHabilitada: async () => true });
    inyectar(r("bot/funciones/mensajes/cuentasIgnoradas.js"), { esCuentaIgnorada: () => false });

    RUTAS_RECARGAR.forEach(p => delete require.cache[p]);

    return {
        upsert: require(r("bot/events/messages.upsert.js")),
        mensajesEnviados: require(r("bot/utils/mensajesEnviados.js"))
    };

}

// --------------------------------------------------------------- util ---

const GRUPO = "120363000000000001@g.us";
const DIA = 24 * 3600;

function crearSock(sessionId) {
    const ev = new EventEmitter();
    ev.setMaxListeners(50);
    return { ev, context: { sessionId, usuarioId: "tenant-1", telefono: null } };
}

function msg(id, { texto = null, sticker = false, fromMe = false, segundosAtras = 0, participant = "573001112233@s.whatsapp.net" } = {}) {
    return {
        key: { id, remoteJid: GRUPO, fromMe, participant },
        message: sticker ? { stickerMessage: { fileSha256: "abc" } } : { conversation: texto },
        messageTimestamp: Math.floor(Date.now() / 1000) - segundosAtras
    };
}

async function entregar(sock, messages, { type = "notify", requestId } = {}) {
    sock.ev.emit("messages.upsert", { messages, type, requestId });
    await new Promise(res => setTimeout(res, 25));
}

function filasDe(fake, id) {
    return fake.tablas.mensajes_grupos_sorteos.filter(f => f.mensaje_id === id);
}

// Entorno limpio: BD vacía, proceso "recién arrancado", sesión A escuchando.
function montar(opcionesFake) {
    const fake = crearFakeSupabase(opcionesFake);
    const acciones = crearAcciones();
    const pipeline = cargarPipeline(fake, acciones);
    const A = crearSock("A");
    pipeline.upsert.registerMessages(A, "A");
    return { fake, acciones, pipeline, A };
}

// --------------------------------------------------------------- runner ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("Caso 1 — mensaje nuevo -> se procesa normalmente", async () => {

    const { fake, acciones, pipeline, A } = montar();

    await entregar(A, [msg("NUEVO-1", { texto: "71" })]);

    assert.deepStrictEqual(acciones.detectarReserva, ["71"], "llega a detectarReserva");
    assert.deepStrictEqual(acciones.respuestas, ["NUEVO-1"], "se responde");
    assert.deepStrictEqual(acciones.clasificados, ["NUEVO-1"]);
    assert.strictEqual(filasDe(fake, "NUEVO-1").length, 1);

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 2 — el mismo mensaje dos veces (seguidas y simultáneas) -> se procesa una sola vez", async () => {

    const { fake, acciones, pipeline, A } = montar();

    // simultáneas: la segunda llega mientras la primera sigue en proceso
    A.ev.emit("messages.upsert", { messages: [msg("DUP-1", { texto: "71" })], type: "notify" });
    A.ev.emit("messages.upsert", { messages: [msg("DUP-1", { texto: "71" })], type: "notify" });
    await new Promise(res => setTimeout(res, 30));

    // seguida, con timestamp unos segundos distinto (reintento real observado)
    const reintento = msg("DUP-1", { texto: "71" });
    reintento.messageTimestamp += 4;
    await entregar(A, [reintento]);

    assert.strictEqual(acciones.detectarReserva.length, 1, "una sola reserva");
    assert.strictEqual(acciones.respuestas.length, 1, "una sola respuesta");
    assert.strictEqual(filasDe(fake, "DUP-1").length, 1, "una sola fila de historial");

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 3 — A procesa X -> cambio a B -> B recibe X -> B NO lo procesa (memoria y BD)", async () => {

    const { fake, acciones, pipeline, A } = montar();

    await entregar(A, [msg("X-3", { texto: "71" })]);
    assert.strictEqual(acciones.respuestas.length, 1);

    // cambio A -> B (bot/index.js: unregister A, register B)
    pipeline.upsert.unregisterMessages("A");
    const B = crearSock("B");
    pipeline.upsert.registerMessages(B, "B");

    // B recibe X en vivo (mismo key.id; participante en otro formato)
    await entregar(B, [msg("X-3", { texto: "71", participant: "999@lid" })]);

    // ...y aunque la memoria del proceso no lo supiera, la BD sí lo sabe
    require(r("bot/funciones/mensajes/compuertaIngreso.js"))._reiniciarMemoria();
    await entregar(B, [msg("X-3", { texto: "71" })]);

    assert.strictEqual(acciones.detectarReserva.length, 1, "B no reserva");
    assert.strictEqual(acciones.respuestas.length, 1, "B no responde");
    assert.strictEqual(acciones.detectarEvento.length, 1, "B no evalúa eventos");
    assert.strictEqual(filasDe(fake, "X-3").length, 1, "sin segunda fila");

    pipeline.upsert.unregisterMessages("B");

});

prueba("Caso 4 — mensaje 'append' antiguo (backlog offline) -> NO ejecuta acciones", async () => {

    const { acciones, pipeline, A } = montar();

    await entregar(A, [
        msg("OFF-1", { texto: "71", segundosAtras: 2 * DIA }),
        msg("OFF-2", { texto: "Sorteo Chontico 10pm valor 5000", segundosAtras: 2 * DIA })
    ], { type: "append" });

    assert.deepStrictEqual(acciones.detectarEvento, []);
    assert.deepStrictEqual(acciones.abrirGrupo, []);
    assert.deepStrictEqual(acciones.detectarReserva, []);
    assert.deepStrictEqual(acciones.respuestas, []);
    assert.deepStrictEqual(acciones.clasificados, [], "no se clasifica para ningún worker");

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 5 — mensaje 'notify' con timestamp antiguo -> NO ejecuta acciones", async () => {

    const { acciones, pipeline, A } = montar();

    await entregar(A, [msg("VIEJO-N", { texto: "71", segundosAtras: 2 * DIA })], { type: "notify" });

    assert.deepStrictEqual(acciones.detectarReserva, []);
    assert.deepStrictEqual(acciones.respuestas, []);
    assert.deepStrictEqual(acciones.detectarEvento, []);

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 5b — reenvío de placeholder (notify + requestId) -> NO ejecuta acciones", async () => {

    const { acciones, pipeline, A } = montar();

    await entregar(A, [msg("PH-1", { texto: "71", segundosAtras: 3600 })], { type: "notify", requestId: "req-1" });

    assert.deepStrictEqual(acciones.detectarReserva, []);
    assert.deepStrictEqual(acciones.respuestas, []);

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 6 — mensaje histórico queda en el historial pero NO llega al negocio", async () => {

    const { fake, acciones, pipeline, A } = montar();

    await entregar(A, [msg("HIST-1", { texto: "71", segundosAtras: DIA })], { type: "append" });

    const filas = filasDe(fake, "HIST-1");
    assert.strictEqual(filas.length, 1, "registrado para historial/panel");
    assert.strictEqual(filas[0].texto, "71");
    assert.deepStrictEqual(acciones.detectarReserva, []);
    assert.deepStrictEqual(acciones.respuestas, []);
    assert.deepStrictEqual(acciones.clasificados, []);

    // y si vuelve a llegar, ni siquiera se duplica el historial
    require(r("bot/funciones/mensajes/compuertaIngreso.js"))._reiniciarMemoria();
    await entregar(A, [msg("HIST-1", { texto: "71", segundosAtras: DIA })], { type: "append" });
    assert.strictEqual(filasDe(fake, "HIST-1").length, 1);

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 7 — reinicio de PM2 -> un mensaje ya procesado no vuelve a ejecutarse", async () => {

    const { fake, acciones, pipeline, A } = montar();

    await entregar(A, [msg("PM2-1", { texto: "71" })]);
    assert.strictEqual(acciones.respuestas.length, 1);
    pipeline.upsert.unregisterMessages("A");

    // "reinicio": módulos recargados, memoria vacía, misma BD
    const tras = cargarPipeline(fake, acciones);
    const B = crearSock("B");
    tras.upsert.registerMessages(B, "B");

    // llega otra vez como notify con timestamp reciente (solo la BD puede frenarlo)
    await entregar(B, [msg("PM2-1", { texto: "71" })]);

    assert.strictEqual(acciones.detectarReserva.length, 1);
    assert.strictEqual(acciones.respuestas.length, 1);
    assert.strictEqual(filasDe(fake, "PM2-1").length, 1);

    tras.upsert.unregisterMessages("B");

});

prueba("Caso 8 — cambio A -> B -> un mensaje NUEVO en B funciona normalmente", async () => {

    const { acciones, pipeline, A } = montar();

    await entregar(A, [msg("DE-A", { texto: "71" })]);
    pipeline.upsert.unregisterMessages("A");

    const B = crearSock("B");
    pipeline.upsert.registerMessages(B, "B");

    await entregar(B, [msg("NUEVO-B", { texto: "35" })]);
    await entregar(B, [msg("SORTEO-B", { texto: "Sorteo Chontico 10pm valor 5000" })]);

    assert.deepStrictEqual(acciones.detectarReserva, ["71", "35"]);
    assert.ok(acciones.respuestas.includes("NUEVO-B"));
    assert.ok(acciones.abrirGrupo.includes("SORTEO-B"), "un anuncio nuevo en B abre el grupo");

    // y A ya no procesa nada
    await entregar(A, [msg("TARDE-A", { texto: "44" })]);
    assert.ok(!acciones.detectarReserva.includes("44"));

    pipeline.upsert.unregisterMessages("B");

});

prueba("Caso 9 — un anuncio antiguo NO vuelve a abrir el grupo", async () => {

    const { acciones, pipeline, A } = montar();

    const anuncio = "Sorteo Chontico 10pm valor 5000";

    await entregar(A, [msg("ANUNCIO-VIEJO", { texto: anuncio, segundosAtras: 2 * DIA })], { type: "append" });
    await entregar(A, [msg("ANUNCIO-VIEJO-N", { texto: anuncio, segundosAtras: 2 * DIA })], { type: "notify" });

    assert.deepStrictEqual(acciones.detectarEvento, [], "no llega a detectarEvento");
    assert.deepStrictEqual(acciones.abrirGrupo, [], "no abre el grupo");

    // el mismo anuncio, nuevo, sí abre (no se rompió la detección)
    await entregar(A, [msg("ANUNCIO-NUEVO", { texto: anuncio })]);
    assert.deepStrictEqual(acciones.abrirGrupo, ["ANUNCIO-NUEVO"]);

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 10 — un mensaje antiguo que parece reserva NO crea una reserva nueva", async () => {

    const { acciones, pipeline, A } = montar();

    await entregar(A, [msg("RES-VIEJA", { texto: "71 72 73", segundosAtras: 5 * 3600 })], { type: "append" });
    await entregar(A, [msg("RES-VIEJA-N", { texto: "71 72 73", segundosAtras: 5 * 3600 })], { type: "notify" });

    assert.deepStrictEqual(acciones.detectarReserva, []);
    assert.deepStrictEqual(acciones.respuestas, []);

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 11 — un sticker de pago antiguo NO confirma el pago otra vez", async () => {

    const { acciones, pipeline, A } = montar();

    await entregar(A, [msg("STK-VIEJO", { sticker: true, segundosAtras: DIA })], { type: "append" });
    await entregar(A, [msg("STK-VIEJO-N", { sticker: true, segundosAtras: DIA })], { type: "notify" });
    assert.deepStrictEqual(acciones.confirmarPago, []);

    await entregar(A, [msg("STK-NUEVO", { sticker: true })]);
    assert.deepStrictEqual(acciones.confirmarPago, ["STK-NUEVO"], "un sticker nuevo sí confirma");

    // y el mismo sticker nuevo re-entregado no confirma dos veces
    require(r("bot/funciones/mensajes/compuertaIngreso.js"))._reiniciarMemoria();
    await entregar(A, [msg("STK-NUEVO", { sticker: true })]);
    assert.deepStrictEqual(acciones.confirmarPago, ["STK-NUEVO"]);

    pipeline.upsert.unregisterMessages("A");

});

prueba("Caso 12 — mensajes manuales NUEVOS del administrador (fromMe desde el teléfono) siguen funcionando", async () => {

    const { fake, acciones, pipeline, A } = montar();

    // anuncio escrito a mano desde el teléfono del bot: fromMe, notify, id no registrado por el programa
    await entregar(A, [msg("ADMIN-1", { texto: "Sorteo Chontico 10pm valor 5000", fromMe: true })]);
    assert.deepStrictEqual(acciones.abrirGrupo, ["ADMIN-1"], "el anuncio manual abre el grupo como siempre");
    assert.strictEqual(filasDe(fake, "ADMIN-1").length, 1);

    // sticker manual del administrador
    await entregar(A, [msg("ADMIN-STK", { sticker: true, fromMe: true })]);
    assert.deepStrictEqual(acciones.confirmarPago, ["ADMIN-STK"]);

    // una respuesta ENVIADA por el programa (eco) sigue quedando solo registrada
    pipeline.mensajesEnviados.registrarEnviado("ECO-1");
    await entregar(A, [msg("ECO-1", { texto: "Sorteo Chontico 10pm valor 5000", fromMe: true })], { type: "append" });
    assert.deepStrictEqual(acciones.abrirGrupo, ["ADMIN-1"]);
    assert.strictEqual(filasDe(fake, "ECO-1").length, 1, "el eco queda en el historial");

    pipeline.upsert.unregisterMessages("A");

});

prueba("Extra — reclamo atómico entre dos procesos (índice único 021 -> 23505) -> cero acciones", async () => {

    const { fake, acciones, pipeline, A } = montar({ unico: true });

    // Otro proceso (p. ej. la otra instancia) inserta el MISMO mensaje entre
    // la verificación y la inserción de este: carrera real.
    fake.hooks.antesDeInsertar = async (fila, tablas) => {
        if (fila.mensaje_id === "CARRERA-1") {
            tablas.mensajes_grupos_sorteos.push({ id: 999, grupo_id: fila.grupo_id, mensaje_id: fila.mensaje_id });
        }
    };

    await entregar(A, [msg("CARRERA-1", { texto: "71" })]);

    assert.deepStrictEqual(acciones.detectarReserva, []);
    assert.deepStrictEqual(acciones.respuestas, []);
    assert.deepStrictEqual(acciones.clasificados, []);
    assert.strictEqual(filasDe(fake, "CARRERA-1").length, 1, "solo la fila del otro proceso");

    pipeline.upsert.unregisterMessages("A");

});

(async () => {

    // Silenciar los logs del pipeline real; solo se imprime el resultado.
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
