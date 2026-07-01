const manager = require("./manager");

async function sendMessage(jid, message) {

    const sock = manager.getActiveSocket();

    if (!sock) {

        throw new Error("No hay una sesión activa.");

    }

    return await sock.sendMessage(jid, message);

}

module.exports = {

    sendMessage

};