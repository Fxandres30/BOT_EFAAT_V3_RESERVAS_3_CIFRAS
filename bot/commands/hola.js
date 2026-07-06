module.exports = async (sock, message) => {

    if (!message.message)
        return;

    const texto =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        "";

    if (texto.toLowerCase() !== "hola")
        return;

    if (message.key.fromMe)
        return;

    if (message.key.remoteJid.endsWith("@g.us"))
        return;

    console.log("👋 HOLA DETECTADO");

};