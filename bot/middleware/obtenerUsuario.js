const {
    obtenerUsuarioGlobal
} = require("../funciones/usuarios/obtenerUsuarioGlobal");

module.exports = async function (ctx) {

    let jid;

    // Si el mensaje lo envió el propio bot
    if (ctx.message.key.fromMe) {

        jid = ctx.session.telefono + "@s.whatsapp.net";

    } else {

        jid =
            ctx.chat.participante ||
            ctx.chat.remoteJid;

    }

    return await obtenerUsuarioGlobal(jid);

};