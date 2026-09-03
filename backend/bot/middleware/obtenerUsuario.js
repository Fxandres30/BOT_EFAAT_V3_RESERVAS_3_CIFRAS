const {
    obtenerUsuarioGlobal
} = require("../funciones/usuarios/obtenerUsuarioGlobal");

module.exports = async function (ctx) {

    let jid = null;

    // ==========================================
    // Determinar el JID real del autor
    // ==========================================

    if (ctx.message.key.fromMe) {

        // Si el mensaje lo envió el bot

        jid =
            ctx.sock?.user?.id ||
            ctx.message.key.participant ||
            ctx.message.key.remoteJid ||
            null;

    } else {

        // Si lo envió otra persona

        jid =
            ctx.chat.participante ||
            ctx.message.key.participant ||
            ctx.chat.remoteJid ||
            null;

    }

    // ==========================================
    // Validar
    // ==========================================

    if (!jid) {

        console.log("⚠ No se pudo determinar el JID del usuario.");

        return null;

    }

    // ==========================================
    // Obtener usuario global
    // ==========================================

    return await obtenerUsuarioGlobal({

        jid,

        nombre: ctx.chat.pushName || null

    });

};