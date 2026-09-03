const supabase = require("../../../lib/supabase");

const {
    obtenerUsuarioGlobal
} = require("../usuarios/obtenerUsuarioGlobal");

async function guardarMensajeGrupo({

    msg,
    texto,
    grupoId,
    grupoNombre,
    sock

}) {

    try {

        // ==========================================
        // Ignorar mensajes internos
        // ==========================================

        if (
            msg.message &&
            Object.keys(msg.message).length === 1 &&
            msg.message.senderKeyDistributionMessage
        ) {
            return null;
        }

        // ==========================================
        // Autor del mensaje
        // ==========================================

        const jidUsuario =

            msg.key.participant ||

            msg.participant ||

            msg.key.remoteJid ||

            sock?.user?.id ||

            null;

        if (!jidUsuario)
            return null;

        const usuario = await obtenerUsuarioGlobal({

            jid: jidUsuario,

            nombre: msg.pushName || null

        });

        if (!usuario)
            return null;

        // ==========================================
        // Timestamp (Baileys v7)
        // ==========================================

        const timestampWhatsapp =

            msg.messageTimestamp?.toNumber?.() ??

            Number(msg.messageTimestamp) ??

            null;

        // ==========================================
        // Tipo de mensaje
        // ==========================================

        let tipoMensaje = "texto";

        if (msg.message?.imageMessage)

            tipoMensaje = "imagen";

        else if (msg.message?.videoMessage)

            tipoMensaje = "video";

        else if (msg.message?.audioMessage)

            tipoMensaje = "audio";

        else if (msg.message?.documentMessage)

            tipoMensaje = "documento";

        else if (msg.message?.stickerMessage)

            tipoMensaje = "sticker";

        // ==========================================
        // Contexto citado
        // ==========================================

        const contextInfo =

            msg.message?.extendedTextMessage?.contextInfo ||

            msg.message?.imageMessage?.contextInfo ||

            msg.message?.videoMessage?.contextInfo ||

            msg.message?.documentMessage?.contextInfo ||

            msg.message?.buttonsResponseMessage?.contextInfo ||

            msg.message?.listResponseMessage?.contextInfo ||

            msg.message?.templateButtonReplyMessage?.contextInfo ||

            null;

        const quotedId =

            contextInfo?.stanzaId ||

            null;

        const quotedParticipant =

            contextInfo?.participant ||

            null;

        // ==========================================
        // Teléfono
        // ==========================================

        let telefono = usuario.telefono;

        if (!telefono && sock?.user?.id) {

            telefono = sock.user.id

                .split("@")[0]

                .split(":")[0]

                .replace(/^57/, "");

        }

        if (telefono === "null")
            telefono = null;

        // ==========================================
        // Media
        // ==========================================

        const media =

            msg.message?.imageMessage ||

            msg.message?.videoMessage ||

            msg.message?.documentMessage ||

            msg.message?.audioMessage ||

            null;

        const fileSize =

            media?.fileLength?.toNumber?.() ??

            Number(media?.fileLength) ??

            null;

        // ==========================================
        // Guardar
        // ==========================================

        const { data, error } = await supabase

            .from("mensajes_grupos_sorteos")

            .insert({

                mensaje_id: msg.key.id,

                grupo_id: grupoId,

                grupo_nombre: grupoNombre || null,

                usuario_id: usuario.id,

                telefono,

                lid: usuario.lid,

                nombre: usuario.nombre,

                push_name: msg.pushName || null,

                from_me: msg.key.fromMe,

                autor_jid: jidUsuario,

                participant_jid:

                    msg.key.participant ||

                    null,

                remote_jid:

                    msg.key.remoteJid ||

                    null,

                tipo_mensaje: tipoMensaje,

                texto:

                    texto?.trim() ||

                    null,

                quoted_id: quotedId,

                quoted_participant:

                    quotedParticipant,

                timestamp_whatsapp:

                    timestampWhatsapp,

                editado:

                    !!msg.message?.editedMessage,

                eliminado:

                    !!msg.message?.protocolMessage,

                mime_type:

                    media?.mimetype ||

                    null,

                file_name:

                    media?.fileName ||

                    null,

                file_size:

                    fileSize,

                media_url: null,

                procesado: false,

                respondido: false,

                estado: "nuevo"

            })

            .select()

            .single();

        if (error) {

            console.error("================================");
            console.error("❌ ERROR GUARDANDO MENSAJE");
            console.error(error);
            console.error("================================");

            return null;

        }

        return data;

    }

    catch (err) {

        console.error("================================");
        console.error("❌ EXCEPCIÓN GUARDANDO MENSAJE");
        console.error(err);
        console.error("================================");

        return null;

    }

}

module.exports = {

    guardarMensajeGrupo

};