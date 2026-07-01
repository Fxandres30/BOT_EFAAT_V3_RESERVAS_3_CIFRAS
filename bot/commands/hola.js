module.exports = async (sock, message) => {

    if (!message.message) return;

    const texto =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        "";

    if (texto.toLowerCase() !== "hola")
        return;

    // No responderse a sí mismo
    if (message.key.fromMe)
        return;

    // Solo chats privados
    if (message.key.remoteJid.endsWith("@g.us"))
        return;

    console.log("👋 HOLA DETECTADO");

    await sock.sendMessage(

        message.key.remoteJid,

        {

            text: "Hola, aquí estoy."

        }

    );

};