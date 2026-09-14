const { normalizarTexto } = require("../utils/normalizarTexto");

function obtenerContenido(msg) {

    if (!msg)
        return null;

    while (true) {

        if (msg.ephemeralMessage) {
            msg = msg.ephemeralMessage.message;
            continue;
        }

        if (msg.viewOnceMessage) {
            msg = msg.viewOnceMessage.message;
            continue;
        }

        if (msg.viewOnceMessageV2) {
            msg = msg.viewOnceMessageV2.message;
            continue;
        }

        if (msg.viewOnceMessageV2Extension) {
            msg = msg.viewOnceMessageV2Extension.message;
            continue;
        }

        if (msg.documentWithCaptionMessage) {
            msg = msg.documentWithCaptionMessage.message;
            continue;
        }

        if (msg.editedMessage) {
            msg = msg.editedMessage.message;
            continue;
        }

        break;

    }

    return msg;

}

function normalizarMensaje(message) {

    const contenido = obtenerContenido(message.message);

    if (!contenido) {

        return {

            textoOriginal: "",

            texto: ""

        };

    }

    const textoOriginal =

        contenido.conversation ||

        contenido.extendedTextMessage?.text ||

        contenido.imageMessage?.caption ||

        contenido.videoMessage?.caption ||

        contenido.documentMessage?.caption ||

        contenido.buttonsResponseMessage?.selectedDisplayText ||

        contenido.listResponseMessage?.title ||

        contenido.templateButtonReplyMessage?.selectedDisplayText ||

        contenido.interactiveResponseMessage?.body?.text ||

        "";

    return {

        textoOriginal,

        texto: normalizarTexto(textoOriginal)

    };

}

module.exports = normalizarMensaje;

// Se cuelga como propiedad de la función exportada (en vez de cambiar el
// export a un objeto) para no romper a su único llamador actual
// (obtenerContexto.js, que hace `const normalizarMensaje = require(...)` y
// lo invoca directo como función). Auditoría de mensajes entrantes,
// 2026-09: el desenvuelto de ephemeral/viewOnce/editedMessage ya existía
// aquí y es exactamente lo que necesita el diagnóstico para saber el TIPO
// real de mensaje (conversation/extendedTextMessage/imageMessage/...) —
// se reutiliza tal cual en vez de reimplementarlo, ver
// bot/funciones/mensajes/diagnosticoMensajeEntrante.js.
module.exports.obtenerContenido = obtenerContenido;