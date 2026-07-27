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

        // Ignorar mensajes internos de WhatsApp
        if (
            msg.message &&
            Object.keys(msg.message).length === 1 &&
            msg.message.senderKeyDistributionMessage
        ) {
            return null;
        }

        const jidUsuario =
            msg.key.participant ||
            msg.key.remoteJid;

        const usuario = await obtenerUsuarioGlobal({

            jid: jidUsuario,

            nombre: msg.pushName || null

        });

        if (!usuario)
            return null;

        // ===============================
        // Tipo de mensaje
        // ===============================

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

        // ===============================
        // Contexto del mensaje citado
        // ===============================

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
            contextInfo?.stanzaId || null;

        const quotedParticipant =
            contextInfo?.participant || null;

        // ===============================
        // Teléfono
        // ===============================

        let telefono = usuario.telefono;

        if (msg.key.fromMe && !telefono) {

            telefono =
                sock?.context?.telefono ||

                msg.key.remoteJid
                    ?.replace("@s.whatsapp.net", "")
                    ?.replace("@lid", "");

        }

        // ===============================
        // Media
        // ===============================

        const media =

            msg.message?.imageMessage ||

            msg.message?.videoMessage ||

            msg.message?.documentMessage ||

            msg.message?.audioMessage ||

            null;

        // ===============================
        // Guardar
        // ===============================

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

                autor_jid:
                    msg.key.participant ||
                    msg.key.remoteJid,

                participant_jid:
                    msg.key.participant || null,

                remote_jid:
                    msg.key.remoteJid,

                tipo_mensaje: tipoMensaje,

                texto:
                    texto?.trim() || null,

                quoted_id: quotedId,

                quoted_participant:
                    quotedParticipant,

                timestamp_whatsapp:
                    msg.messageTimestamp || null,

                editado:
                    !!msg.message?.editedMessage,

                eliminado:
                    !!msg.message?.protocolMessage,

                mime_type:
                    media?.mimetype || null,

                file_name:
                    media?.fileName || null,

                file_size:
                    media?.fileLength || null,

                media_url: null,

                procesado: false,

                respondido: false,

                estado: "nuevo"

                // Si agregas una columna JSONB llamada "raw"
                // puedes guardar también:
                // raw: msg

            })

            .select()

            .single();

        if (error) {

            console.error("❌ Error guardando mensaje:");
            console.error(error);

            return null;

        }

        return data;

    }

    catch (err) {

        console.error("❌ Excepción guardando mensaje:");
        console.error(err);

        return null;

    }

}

module.exports = {

    guardarMensajeGrupo

};