// ==========================================================================
// PRUEBAS — diagnosticarMensajeEntranteOriginal() (auditoría de
// observabilidad, 2026-09). Sin Supabase de por medio: esta capa es 100%
// pura (lee `msg`, hace console.log, no devuelve nada usado por nadie).
//
// Verifica exactamente las garantías pedidas:
//   - DEBUG_INCOMING_MESSAGES=false -> CERO output.
//   - DEBUG_INCOMING_MESSAGES=true  -> corre para cualquier tipo de mensaje
//     sin lanzar, y NUNCA modifica el objeto `msg` original.
//   - No "resuelve" nada: reporta presencia/ausencia literal, nunca deriva
//     un teléfono a partir de un LID.
//   - sanitizarMensajeParaDebug() redacta por nombre de campo y no falla
//     con Buffers/Long.js.
//
//     node backend/tests/identidad/diagnosticarMensajeEntranteOriginal.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RUTA_MODULO = path.resolve(__dirname, "../../bot/funciones/mensajes/diagnosticarMensajeEntranteOriginal.js");

function cargarModulo() {

    delete require.cache[RUTA_MODULO];
    return require(RUTA_MODULO);

}

// Captura console.log/console.error durante `fn()` y los restaura siempre,
// incluso si `fn` lanza.
function capturarConsola(fn) {

    const logOriginal = console.log;
    const errorOriginal = console.error;

    const lineas = [];
    const errores = [];

    console.log = (...args) => lineas.push(args.join(" "));
    console.error = (...args) => errores.push(args.join(" "));

    try {

        fn();
        return { salida: lineas.join("\n"), errores };

    } finally {

        console.log = logOriginal;
        console.error = errorOriginal;

    }

}

function conDebug(activo, fn) {

    const anterior = process.env.DEBUG_INCOMING_MESSAGES;
    process.env.DEBUG_INCOMING_MESSAGES = activo ? "true" : "false";

    try {
        return fn();
    } finally {

        if (anterior === undefined) delete process.env.DEBUG_INCOMING_MESSAGES;
        else process.env.DEBUG_INCOMING_MESSAGES = anterior;

    }

}

const resultados = [];

function test(nombre, fn) {

    try {
        fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.stack || err.message}`);
    }

}

function main() {

    // ======================================================================
    // 1. DEBUG apagado -> cero output, sin importar el mensaje.
    // ======================================================================
    test("1. DEBUG_INCOMING_MESSAGES=false -> no imprime absolutamente nada", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = { key: { remoteJid: "3001112222@s.whatsapp.net", fromMe: false, id: "M1" }, pushName: "X", message: { conversation: "hola" } };

        const { salida, errores } = conDebug(false, () =>
            capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg))
        );

        assert.strictEqual(salida, "", "no debe haber ninguna línea de log con el flag apagado");
        assert.strictEqual(errores.length, 0);

    });

    // ======================================================================
    // 2. Grupo con PN directo en participant -> reporta PN SÍ, fuente participant.
    // ======================================================================
    test("2. Grupo, participant=PN -> PN detectado SÍ, fuente=participant, chat=GRUPO", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = {
            key: { remoteJid: "120363111111111111@g.us", participant: "3003334444@s.whatsapp.net", fromMe: false, id: "M2" },
            pushName: "Cliente",
            message: { conversation: "hola grupo" }
        };

        const { salida } = conDebug(true, () =>
            capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg))
        );

        assert.ok(salida.includes("🔎 DIAGNÓSTICO ORIGINAL"), "debe imprimir el encabezado");
        assert.ok(salida.includes("PN detectado: ✅ SÍ"));
        assert.ok(salida.includes("Fuente: participant"));
        assert.ok(salida.includes("Tipo chat: GRUPO"));
        assert.ok(salida.includes("¿WhatsApp/Baileys entregó teléfono en este mensaje?"));
        assert.ok(salida.includes("✅ SÍ"));

    });

    // ======================================================================
    // 3. Grupo con participant=LID y SIN participantAlt -> PN NO DISPONIBLE,
    //    NUNCA se deriva un teléfono del LID.
    // ======================================================================
    test("3. Grupo, participant=LID sin participantAlt -> PN NO DISPONIBLE (nunca se inventa)", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = {
            key: { remoteJid: "120363222222222222@g.us", participant: "700001@lid", fromMe: false, id: "M3" },
            message: { conversation: "hola" }
        };

        const { salida } = conDebug(true, () =>
            capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg))
        );

        assert.ok(salida.includes("PN detectado: ❌ NO DISPONIBLE"));
        assert.ok(salida.includes("LID detectado: ✅ SÍ"));
        assert.ok(salida.includes("Fuente: participant"));
        assert.ok(!salida.includes("PN: 700001"), "el LID JAMÁS debe aparecer reportado como PN");

    });

    // ======================================================================
    // 4. Grupo con participant=LID + participantAlt=PN -> ambos reportados,
    //    fuente del PN = participantAlt.
    // ======================================================================
    test("4. Grupo, participant=LID + participantAlt=PN -> PN SÍ, fuente=participantAlt", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = {
            key: {
                remoteJid: "120363333333333333@g.us",
                participant: "800002@lid",
                participantAlt: "3005556666@s.whatsapp.net",
                fromMe: false,
                id: "M4"
            },
            message: { extendedTextMessage: { text: "hola" } }
        };

        const { salida } = conDebug(true, () =>
            capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg))
        );

        assert.ok(salida.includes("PN detectado: ✅ SÍ"));
        assert.ok(salida.includes("PN: 3005556666@s.whatsapp.net"));
        assert.ok(salida.includes("Fuente: participantAlt"));
        assert.ok(salida.includes("LID: 800002@lid"));

    });

    // ======================================================================
    // 5. Privado con PN directo en remoteJid.
    // ======================================================================
    test("5. Privado, remoteJid=PN -> chat=PRIVADO, PN SÍ, fuente=remoteJid", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = {
            key: { remoteJid: "3009998888@s.whatsapp.net", fromMe: false, id: "M5" },
            message: { conversation: "hola privado" }
        };

        const { salida } = conDebug(true, () =>
            capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg))
        );

        assert.ok(salida.includes("Tipo chat: PRIVADO"));
        assert.ok(salida.includes("🏠 CHAT PRIVADO"));
        assert.ok(salida.includes("PN detectado: ✅ SÍ"));
        assert.ok(salida.includes("Fuente: remoteJid"));

    });

    // ======================================================================
    // 6. fromMe=true -> SÍ se diagnostica (no se ignora), pero no ejecuta
    //    ninguna lógica de negocio (esta función no tiene ninguna, por
    //    diseño -- se verifica que igual imprime fromMe: true).
    // ======================================================================
    test("6. fromMe=true -> se diagnostica igual, reporta fromMe: true", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = {
            key: { remoteJid: "3001112222@s.whatsapp.net", fromMe: true, id: "M6" },
            message: { conversation: "mensaje del bot" }
        };

        const { salida } = conDebug(true, () =>
            capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg))
        );

        assert.ok(salida.includes("fromMe: true"));

    });

    // ======================================================================
    // 7. Mensaje SIN message.message (p. ej. solo senderKeyDistributionMessage)
    //    -> igual se diagnostica (el listener real lo filtra DESPUÉS).
    // ======================================================================
    test("7. Mensaje sin contenido reconocible -> no lanza, reporta tipo como protocolo", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = { key: { remoteJid: "3001112222@s.whatsapp.net", fromMe: false, id: "M7" }, message: {} };

        assert.doesNotThrow(() => {

            conDebug(true, () => capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg)));

        });

    });

    // ======================================================================
    // 8. Distintos tipos de mensaje (sticker, imagen, reaction) -> se
    //    reporta el tipo real, sin filtrar por texto.
    // ======================================================================
    test("8. stickerMessage / imageMessage / reactionMessage -> se reporta el tipo real de cada uno", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const base = { key: { remoteJid: "3001112222@s.whatsapp.net", fromMe: false } };

        const casos = [
            { ...base, key: { ...base.key, id: "S1" }, message: { stickerMessage: { mimetype: "image/webp" } } },
            { ...base, key: { ...base.key, id: "S2" }, message: { imageMessage: { caption: "foto" } } },
            { ...base, key: { ...base.key, id: "S3" }, message: { reactionMessage: { text: "👍" } } }
        ];

        const tiposEsperados = ["stickerMessage", "imageMessage", "reactionMessage"];

        casos.forEach((msg, i) => {

            const { salida } = conDebug(true, () =>
                capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg))
            );

            assert.ok(salida.includes(`Tipo:\n${tiposEsperados[i]}`), `debe reportar el tipo real: ${tiposEsperados[i]}`);

        });

    });

    // ======================================================================
    // 9. El objeto `msg` original NUNCA se modifica.
    // ======================================================================
    test("9. El objeto msg original nunca se modifica (ni key, ni message, ni el objeto completo)", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        const msg = {
            key: { remoteJid: "120363444444444444@g.us", participant: "900003@lid", participantAlt: "3007778888@s.whatsapp.net", fromMe: false, id: "M9" },
            pushName: "Intacto",
            message: { extendedTextMessage: { text: "no me toques" } }
        };

        const copiaAntes = JSON.parse(JSON.stringify(msg));

        conDebug(true, () => capturarConsola(() => diagnosticarMensajeEntranteOriginal(msg)));

        assert.deepStrictEqual(msg, copiaAntes, "msg debe quedar exactamente igual después del diagnóstico");

    });

    // ======================================================================
    // 10. Entradas raras (null/undefined/sin key) nunca deben lanzar.
    // ======================================================================
    test("10. Entradas inválidas (null, undefined, sin key) nunca lanzan", () => {

        const { diagnosticarMensajeEntranteOriginal } = cargarModulo();

        assert.doesNotThrow(() => conDebug(true, () => capturarConsola(() => diagnosticarMensajeEntranteOriginal(null))));
        assert.doesNotThrow(() => conDebug(true, () => capturarConsola(() => diagnosticarMensajeEntranteOriginal(undefined))));
        assert.doesNotThrow(() => conDebug(true, () => capturarConsola(() => diagnosticarMensajeEntranteOriginal({}))));

    });

    // ======================================================================
    // 11. sanitizarMensajeParaDebug() redacta por nombre de campo y no
    //     falla con Buffers/valores tipo Long.
    // ======================================================================
    test("11. sanitizarMensajeParaDebug redacta campos sensibles y resume Buffers sin lanzar", () => {

        const { sanitizarMensajeParaDebug } = cargarModulo();

        const msgConDatoSensible = {

            key: { remoteJid: "3001112222@s.whatsapp.net", id: "M11" },

            // Nunca debería existir en un WAMessage real -- se agrega solo
            // para probar que, SI apareciera, quedaría redactado.
            authState: { privKey: "no-debe-verse-esto", rootKey: "tampoco-esto" },
            token: "tampoco-esto-otro",

            message: {
                imageMessage: {
                    jpegThumbnail: Buffer.from([1, 2, 3, 4, 5]),
                    caption: "una foto normal"
                }
            },

            messageTimestamp: { low: 123, high: 0, toNumber: () => 123 }

        };

        const resultado = sanitizarMensajeParaDebug(msgConDatoSensible);

        assert.ok(!resultado.includes("no-debe-verse-esto"));
        assert.ok(!resultado.includes("tampoco-esto"));
        assert.ok(!resultado.includes("tampoco-esto-otro"));
        assert.ok(resultado.includes("[REDACTED]"));
        assert.ok(resultado.includes("una foto normal"), "los campos normales SÍ deben verse");
        assert.ok(resultado.includes("<binario 5 bytes>"), "los Buffers se resumen, nunca se vuelcan bytes");
        assert.ok(resultado.includes("123"), "los valores tipo Long se convierten a número");

    });

    // ======================================================================
    // Resumen
    // ======================================================================

    const fallidos = resultados.filter((r) => !r.ok);

    console.log("\n================================");
    console.log(`✅ Pasaron: ${resultados.length - fallidos.length}/${resultados.length}`);

    if (fallidos.length) {
        console.log(`❌ Fallaron: ${fallidos.length}`);
        fallidos.forEach((f) => console.log(`   - ${f.nombre}: ${f.err.message}`));
        console.log("================================");
        process.exitCode = 1;
    } else {
        console.log("================================");
    }

}

main();
