const { normalizarTexto } = require("../utils/normalizarTexto");

function obtenerContenido(msg) {

    if (!msg)
        return null;

    return (

        msg.ephemeralMessage?.message ||

        msg.viewOnceMessage?.message ||

        msg.viewOnceMessageV2?.message ||

        msg.viewOnceMessageV2Extension?.message ||

        msg.documentWithCaptionMessage?.message ||

        msg.editedMessage?.message ||

        msg

    );

}

module.exports = function (message) {

    const contenido =
        obtenerContenido(message.message);

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

        contenido.documentWithCaptionMessage?.message?.documentMessage?.caption ||

        contenido.buttonsResponseMessage?.selectedDisplayText ||

        contenido.listResponseMessage?.title ||

        contenido.templateButtonReplyMessage?.selectedDisplayText ||

        contenido.interactiveResponseMessage?.body?.text ||

        "";

    return {

        textoOriginal,

        texto:
            normalizarTexto(textoOriginal)

    };

};