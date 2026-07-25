const {
    obtenerUsuarioGlobal
} = require("../funciones/usuarios/obtenerUsuarioGlobal");

module.exports = async function (chat) {

    const jid =

        chat.participante ||

        chat.remoteJid;

    return await obtenerUsuarioGlobal(jid);

};