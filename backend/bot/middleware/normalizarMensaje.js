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

module.exports = function (message) {

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

};