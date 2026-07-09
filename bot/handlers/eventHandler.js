const { detectarEvento } = require("../funciones/eventos/detectarEvento");

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

function obtenerTexto(message) {

    const contenido = obtenerContenido(message.message);

    if (!contenido)
        return "";

    return (
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
        ""
    );

}

module.exports = async (sock, message) => {

    if (!message?.message)
        return;

    const grupoId = message.key.remoteJid;

    if (!grupoId?.endsWith("@g.us"))
        return;

    const texto = obtenerTexto(message);

    console.log("==================================");
    console.log("📩 Tipo de mensaje:");
    console.log(Object.keys(message.message));
    console.log("📤 fromMe:", message.key.fromMe);
    console.log("📄 Texto detectado:");
    console.log(texto || "(vacío)");
    console.log("==================================");

    // Si no hay texto ni caption no hay nada que analizar
    if (!texto)
        return;

    await detectarEvento(
        sock,
        grupoId,
        texto
    );

};