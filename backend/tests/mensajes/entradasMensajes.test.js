// ==========================================================================
// PRUEBAS — separación de entradas del bot:
//   1. foto / video / documento (comprobante con pie de foto) NO entra a
//      reservas ni consultas, pero SÍ puede seguir anunciando un sorteo;
//   2. un mensaje enviado por el propio programa (send.js) se registra y NO
//      vuelve a procesarse; lo escrito a mano desde el teléfono del bot sí;
//   3. las 5 cuentas indicadas no disparan reservas ni consultas;
//   4. el flujo normal de 2 cifras (texto de un cliente) sigue igual.
//
// Ejecuta los módulos REALES eventHandler.js, dispatcher.js, send.js,
// detectarIntencion.js, cuentasIgnoradas.js y mensajesEnviados.js. Solo se
// sustituyen (vía require.cache) sus dependencias externas: Supabase,
// WhatsApp, reserva/consulta/respuesta — para registrar si se llamaron.
//
//     node backend/tests/mensajes/entradasMensajes.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const GRUPO = "120363000000000000@g.us";
const CLIENTE_LID = "111111111111111@lid";
const CUENTAS_IGNORADAS = ["249705908932856", "148185699872795", "19624460550303", "7156153774273", "21282301169746"];

const EVENTO = { id: "ev-1", usuario_id: "tenant-1", cifras: 2, tabla: "reservas_dos_cifras", grupo_id: GRUPO };

const resultados = [];

async function test(nombre, fn) {
    try {
        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false });
        console.log(`❌ ${nombre}\n   ${err.message}`);
    }
}

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

function limpiar(rutas) {
    for (const ruta of rutas) delete require.cache[ruta];
}

// --------------------------------------------------------------------------
// eventHandler con dependencias externas registradas
// --------------------------------------------------------------------------
function crearEventHandler({ eventoDetectado = null } = {}) {

    const llamadas = { detectarEvento: 0, detectarReserva: [], resolverConsulta: [], responder: 0 };

    limpiar([r("bot/handlers/eventHandler.js"), r("bot/funciones/consultas/detectarIntencion.js")]);

    inyectar(r("bot/funciones/eventos/detectarEvento.js"), {
        detectarEvento: async () => { llamadas.detectarEvento++; return eventoDetectado; }
    });
    inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => EVENTO });
    inyectar(r("bot/funciones/reservas/detectarReserva.js"), {
        detectarReserva: async (args) => { llamadas.detectarReserva.push(args); return { ok: true, mensaje: "ok" }; }
    });
    inyectar(r("bot/funciones/consultas/resolverConsulta.js"), {
        resolverConsulta: async (args) => { llamadas.resolverConsulta.push(args); return { ok: true, mensaje: "ok" }; }
    });
    inyectar(r("bot/ai/responderResultado.js"), { responderResultado: async () => { llamadas.responder++; } });
    inyectar(r("bot/ai/configMensajes.js"), { estaRespuestaHabilitada: async () => true });

    return { eventHandler: require(r("bot/handlers/eventHandler.js")), llamadas };

}

function textoMsg(texto, { participant = CLIENTE_LID, fromMe = false, id = "M-" + Math.random() } = {}) {
    return { key: { id, remoteJid: GRUPO, participant, fromMe }, message: { conversation: texto } };
}

function imagenMsg(caption, { envoltorio = null } = {}) {
    let message = { imageMessage: { caption, mimetype: "image/jpeg" } };
    if (envoltorio) message = { [envoltorio]: { message } };
    return { key: { id: "IMG-" + Math.random(), remoteJid: GRUPO, participant: CLIENTE_LID, fromMe: false }, message };
}

function ctxDe(message, textoOriginal, usuario = { id: "u-1", lid: "111111111111111" }) {
    return { chat: { esGrupo: true, remoteJid: GRUPO }, message, textoOriginal, usuario, sock: {} };
}

// --------------------------------------------------------------------------

async function main() {

    // ---------------- 1. Foto / video / documento ----------------

    await test("1a. foto de comprobante con pie 'comprobante 12 34' NO crea reserva ni consulta", async () => {
        const { eventHandler, llamadas } = crearEventHandler();
        await eventHandler(ctxDe(imagenMsg("comprobante 12 34"), "comprobante 12 34"));
        assert.strictEqual(llamadas.detectarReserva.length, 0, "no entra a reserva");
        assert.strictEqual(llamadas.resolverConsulta.length, 0, "no entra a consulta");
        assert.strictEqual(llamadas.responder, 0, "no responde nada");
    });

    await test("1b. pies de foto reales ('los 23 y 45 que pedí', 'Pagué $10.000', 'ya pagué el 23 y el 45') -> nada", async () => {
        for (const caption of ["los 23 y 45 que pedí", "Pagué $10.000", "ya pagué el 23 y el 45", "23 45", "5 números que pedí"]) {
            const { eventHandler, llamadas } = crearEventHandler();
            await eventHandler(ctxDe(imagenMsg(caption), caption));
            assert.strictEqual(llamadas.detectarReserva.length + llamadas.resolverConsulta.length + llamadas.responder, 0, caption);
        }
    });

    await test("1c. video y documento con pie, e imagen dentro de 'ver una vez'/efímero -> nada", async () => {
        const casos = [
            { key: { id: "V", remoteJid: GRUPO, participant: CLIENTE_LID, fromMe: false }, message: { videoMessage: { caption: "me llevo el 23" } } },
            { key: { id: "D", remoteJid: GRUPO, participant: CLIENTE_LID, fromMe: false }, message: { documentWithCaptionMessage: { message: { documentMessage: { caption: "me llevo el 23" } } } } },
            imagenMsg("me llevo el 23", { envoltorio: "viewOnceMessageV2" }),
            imagenMsg("me llevo el 23", { envoltorio: "ephemeralMessage" })
        ];
        for (const m of casos) {
            const { eventHandler, llamadas } = crearEventHandler();
            await eventHandler(ctxDe(m, "me llevo el 23"));
            assert.strictEqual(llamadas.detectarReserva.length + llamadas.resolverConsulta.length, 0, JSON.stringify(Object.keys(m.message)));
        }
    });

    await test("1d. D1: el pie de foto SIGUE pasando por la detección de anuncios de sorteo", async () => {
        const { eventHandler, llamadas } = crearEventHandler();
        await eventHandler(ctxDe(imagenMsg("SORTEO LOTERÍA DE MEDELLÍN 11:00 PM"), "SORTEO LOTERÍA DE MEDELLÍN 11:00 PM"));
        assert.strictEqual(llamadas.detectarEvento, 1);
    });

    // ---------------- 3. Cuentas ignoradas ----------------

    await test("3a. las 5 cuentas: 'sin números disponibles…' y 'recordatorio…' NO disparan consultas ni reservas", async () => {
        for (const lid of CUENTAS_IGNORADAS) {
            for (const texto of ["Sin números disponibles por el momento familia", "recordatorio familia a las 9:30 p. m. se liberan los numeritos no pago", "me llevo el 23 y el 45"]) {
                const { eventHandler, llamadas } = crearEventHandler();
                await eventHandler(ctxDe(textoMsg(texto, { participant: `${lid}@lid` }), texto, { id: "u-x", lid }));
                assert.strictEqual(llamadas.detectarReserva.length + llamadas.resolverConsulta.length + llamadas.responder, 0, `${lid}: ${texto}`);
            }
        }
    });

    await test("3b. se reconocen también con sufijo de dispositivo o por participantAlt", async () => {
        const { eventHandler, llamadas } = crearEventHandler();
        const m = textoMsg("me llevo el 23", { participant: "573001112233@s.whatsapp.net" });
        m.key.participantAlt = "7156153774273:11@lid";
        await eventHandler(ctxDe(m, "me llevo el 23", { id: "u-y", lid: null }));
        assert.strictEqual(llamadas.detectarReserva.length, 0);
    });

    await test("3c. esas cuentas SÍ siguen pasando por la detección de anuncios (no se rompe el registro/anuncio)", async () => {
        const { eventHandler, llamadas } = crearEventHandler();
        await eventHandler(ctxDe(textoMsg("Sin números disponibles por el momento familia", { participant: "249705908932856@lid" }), "Sin números disponibles por el momento familia", { id: "u", lid: "249705908932856" }));
        assert.strictEqual(llamadas.detectarEvento, 1);
    });

    await test("3d. NO se ignora a otros administradores/clientes: 'sin números disponibles' de otra cuenta sigue siendo consulta", async () => {
        const { eventHandler, llamadas } = crearEventHandler();
        await eventHandler(ctxDe(textoMsg("Sin números disponibles por el momento familia"), "Sin números disponibles por el momento familia"));
        assert.strictEqual(llamadas.resolverConsulta.length, 1, "comportamiento previo intacto para el resto");
    });

    // ---------------- 4. Flujo normal de 2 cifras ----------------

    await test("4a. texto normal de cliente 'me llevo el 23 y el 45' -> detectarReserva con evento y usuario (sin cambios)", async () => {
        const { eventHandler, llamadas } = crearEventHandler();
        await eventHandler(ctxDe(textoMsg("me llevo el 23 y el 45"), "me llevo el 23 y el 45"));
        assert.strictEqual(llamadas.detectarReserva.length, 1);
        assert.strictEqual(llamadas.detectarReserva[0].evento, EVENTO);
        assert.strictEqual(llamadas.detectarReserva[0].texto, "me llevo el 23 y el 45");
        assert.strictEqual(llamadas.responder, 1);
    });

    await test("4b. texto '23 45' de cliente sigue reservando; consulta 'mis números' sigue consultando", async () => {
        let e = crearEventHandler();
        await e.eventHandler(ctxDe(textoMsg("23 45"), "23 45"));
        assert.strictEqual(e.llamadas.detectarReserva.length, 1);
        e = crearEventHandler();
        await e.eventHandler(ctxDe(textoMsg("cuáles son mis números"), "cuáles son mis números"));
        assert.strictEqual(e.llamadas.resolverConsulta.length, 1);
    });

    await test("4c. mensaje fromMe escrito a mano con números: sigue sin reservar (comportamiento previo)", async () => {
        const { eventHandler, llamadas } = crearEventHandler();
        await eventHandler(ctxDe(textoMsg("23 45", { fromMe: true }), "23 45"));
        assert.strictEqual(llamadas.detectarReserva.length, 0);
        assert.strictEqual(llamadas.detectarEvento, 1, "pero sí puede anunciar sorteos");
    });

    // ---------------- 2. Mensajes enviados por el programa ----------------

    function crearDispatcher() {
        const llamadas = { guardar: 0, clasificar: 0, registrarSticker: 0, confirmarSticker: 0, eventHandler: 0, commandHandler: 0 };
        limpiar([r("bot/handlers/dispatcher.js")]);
        inyectar(r("bot/middleware/obtenerContexto.js"), async (sock, message) => ({
            chat: { esGrupo: true, remoteJid: message.key.remoteJid, texto: "" },
            message, texto: "", textoOriginal: message.message?.conversation || "", usuario: null
        }));
        inyectar(r("bot/funciones/mensajes/guardarMensajeGrupo.js"), { guardarMensajeGrupo: async () => { llamadas.guardar++; return { id: 1 }; } });
        inyectar(r("bot/funciones/mensajes/clasificarMensaje.js"), { clasificarMensaje: async () => { llamadas.clasificar++; } });
        inyectar(r("bot/handlers/eventHandler.js"), async () => { llamadas.eventHandler++; });
        inyectar(r("bot/handlers/commandHandler.js"), async () => { llamadas.commandHandler++; });
        inyectar(r("bot/funciones/pagos/confirmarPagoPorSticker.js"), { confirmarPagoPorSticker: async () => { llamadas.confirmarSticker++; } });
        inyectar(r("bot/funciones/pagos/registrarStickerPago.js"), { registrarStickerPago: async () => { llamadas.registrarSticker++; return { intervino: false }; } });
        return { dispatcher: require(r("bot/handlers/dispatcher.js")), llamadas };
    }

    function crearSend() {
        limpiar([r("services/baileys/send.js")]);
        inyectar(r("services/baileys/manager.js"), { getActiveSocket: () => null });
        inyectar(r("services/baileys/identidadSesion.js"), {
            identidadDesdeSocket: () => ({ nombre: "t", telefono: null, sessionId: "s", estado: "conectado" }),
            maskPhone: (x) => x, tipoDestino: () => "GRUPO"
        });
        return require(r("services/baileys/send.js"));
    }

    // Socket fake que imita a Baileys: re-emite el mensaje propio (fromMe)
    // por messages.upsert en process.nextTick, ANTES de resolver sendMessage.
    function crearSocketFake(onEco) {
        return {
            user: { id: "573000000000:5@s.whatsapp.net" },
            sendPresenceUpdate: async () => {},
            sendMessage: async (jid, contenido, opciones) => {
                const id = opciones?.messageId;
                const eco = { key: { id, remoteJid: jid, fromMe: true }, message: { conversation: contenido.text || contenido.caption || "" } };
                process.nextTick(() => onEco(eco));
                return eco;
            }
        };
    }

    const mensajesEnviados = require(r("bot/utils/mensajesEnviados.js"));

    await test("2a. respuesta enviada por el programa ('Sin números disponibles…') -> se registra y NO se reprocesa", async () => {
        mensajesEnviados.reiniciar();
        const { dispatcher, llamadas } = crearDispatcher();
        const { sendMessage } = crearSend();
        const ecos = [];
        const sock = crearSocketFake((eco) => ecos.push(dispatcher({ sock, message: eco, session: {}, tipo: "append" })));
        const enviado = await sendMessage({ sock, jid: GRUPO, text: "Sin números disponibles por el momento familia" });
        await new Promise(res => setImmediate(res)); // el eco llega en process.nextTick
        await Promise.all(ecos);
        assert.ok(enviado.key.id, "Baileys recibió un messageId");
        assert.strictEqual(ecos.length, 1);
        assert.strictEqual(llamadas.guardar, 1, "queda registrado");
        assert.strictEqual(llamadas.clasificar + llamadas.registrarSticker + llamadas.confirmarSticker + llamadas.eventHandler + llamadas.commandHandler, 0, "no se procesa");
    });

    await test("2b. imagen enviada por el programa (compartir tabla) tampoco reentra", async () => {
        mensajesEnviados.reiniciar();
        const { dispatcher, llamadas } = crearDispatcher();
        const { sendImage } = crearSend();
        const ecos = [];
        const sock = crearSocketFake((eco) => ecos.push(dispatcher({ sock, message: eco, session: {}, tipo: "append" })));
        await sendImage({ sock, jid: GRUPO, image: Buffer.from("x"), caption: "Tabla 23 45" });
        await new Promise(res => setImmediate(res)); // el eco llega en process.nextTick
        await Promise.all(ecos);
        assert.strictEqual(llamadas.guardar, 1);
        assert.strictEqual(llamadas.eventHandler, 0);
    });

    await test("2c. el id se registra ANTES de enviar (el eco de Baileys llega antes de resolver)", async () => {
        mensajesEnviados.reiniciar();
        const { sendMessage } = crearSend();
        let registradoAlEnviar = null;
        const sock = {
            user: { id: "573000000000@s.whatsapp.net" },
            sendPresenceUpdate: async () => {},
            sendMessage: async (jid, c, o) => { registradoAlEnviar = mensajesEnviados.fueEnviadoPorPrograma(o.messageId); return { key: { id: o.messageId } }; }
        };
        await sendMessage({ sock, jid: GRUPO, text: "hola" });
        assert.strictEqual(registradoAlEnviar, true);
    });

    await test("2d. mensaje escrito A MANO desde el teléfono del bot (fromMe, id no registrado) -> pipeline completo como antes", async () => {
        mensajesEnviados.reiniciar();
        const { dispatcher, llamadas } = crearDispatcher();
        await dispatcher({ sock: {}, message: { key: { id: "MANUAL-1", remoteJid: GRUPO, fromMe: true }, message: { conversation: "SORTEO …" } }, session: {}, tipo: "notify" });
        assert.strictEqual(llamadas.guardar, 1);
        assert.strictEqual(llamadas.clasificar, 1);
        assert.strictEqual(llamadas.registrarSticker, 1);
        assert.strictEqual(llamadas.confirmarSticker, 1);
        assert.strictEqual(llamadas.eventHandler, 1, "anuncios y stickers manuales siguen funcionando");
    });

    await test("2e. mensaje de cliente (fromMe=false) aunque su id coincidiera -> pipeline completo", async () => {
        mensajesEnviados.reiniciar();
        mensajesEnviados.registrarEnviado("ID-X");
        const { dispatcher, llamadas } = crearDispatcher();
        await dispatcher({ sock: {}, message: { key: { id: "ID-X", remoteJid: GRUPO, participant: CLIENTE_LID, fromMe: false }, message: { conversation: "23 45" } }, session: {}, tipo: "notify" });
        assert.strictEqual(llamadas.eventHandler, 1);
    });

    await test("2f. el registro caduca (10 min) y no crece sin límite", async () => {
        mensajesEnviados.reiniciar();
        mensajesEnviados.registrarEnviado("A", 0);
        assert.strictEqual(mensajesEnviados.fueEnviadoPorPrograma("A", 1000), true);
        assert.strictEqual(mensajesEnviados.fueEnviadoPorPrograma("A", mensajesEnviados.CADUCIDAD_MS + 1), false);
        for (let i = 0; i < 6000; i++) mensajesEnviados.registrarEnviado("id-" + i, 1000);
        assert.ok(!mensajesEnviados.fueEnviadoPorPrograma("id-0", 1000), "los más viejos se descartan");
        assert.ok(mensajesEnviados.fueEnviadoPorPrograma("id-5999", 1000));
    });

    const fallidas = resultados.filter(x => !x.ok);
    console.log(`\nTOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas.length}  ❌ FALLA: ${fallidas.length}`);
    process.exit(fallidas.length ? 1 : 0);

}

main();
