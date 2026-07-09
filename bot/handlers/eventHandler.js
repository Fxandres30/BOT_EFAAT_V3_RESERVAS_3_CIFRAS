const { detectarEvento } = require("../funciones/eventos/detectarEvento");

function obtenerTexto(message) {

    const msg = message.message;

    if (!msg)
        return "";

    // Mensajes temporales
    const contenido =
        msg.ephemeralMessage?.message ||
        msg.viewOnceMessage?.message ||
        msg.viewOnceMessageV2?.message ||
        msg.viewOnceMessageV2Extension?.message ||
        msg;

    return (
        contenido.conversation ||
        contenido.extendedTextMessage?.text ||
        contenido.imageMessage?.caption ||
        contenido.videoMessage?.caption ||
        contenido.documentMessage?.caption ||
        contenido.editedMessage?.message?.conversation ||
        ""
    );

}

module.exports = async (sock, message) => {

    if (!message.message)
        return;

    if (message.key.fromMe)
        return;

    const grupoId = message.key.remoteJid;

    if (!grupoId?.endsWith("@g.us"))
        return;

    const texto = obtenerTexto(message);

    console.log("==================================");
    console.log("📩 Tipo de mensaje:");
    console.log(Object.keys(message.message));
    console.log("📄 Texto detectado:");
    console.log(texto || "(vacío)");
    console.log("==================================");

    await detectarEvento(
        sock,
        grupoId,
        texto
    );

};