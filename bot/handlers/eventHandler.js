const { detectarEvento } = require("../funciones/eventos/detectarEvento");

function obtenerTexto(message) {

    return (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        message.message?.videoMessage?.caption ||
        message.message?.documentMessage?.caption ||
        message.message?.editedMessage?.message?.conversation ||
        ""
    );

}

module.exports = async (sock, message) => {

    if (!message.message)
        return;

    if (message.key.fromMe)
        return;

    if (!message.key.remoteJid.endsWith("@g.us"))
        return;

    const texto = obtenerTexto(message);

    console.log("📄 Texto detectado:");
    console.log(texto);

    await detectarEvento(
        sock,
        message.key.remoteJid,
        texto
    );

};