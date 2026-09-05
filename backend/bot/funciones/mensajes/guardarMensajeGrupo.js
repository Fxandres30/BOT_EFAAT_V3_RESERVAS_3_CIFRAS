const supabase = require("../../../lib/supabase");

async function guardarMensajeGrupo({

    msg,
    texto,
    grupoId,
    grupoNombre,
    usuario = null

}) {

    try {

        // ==========================================
        // fromMe: el bot no es un cliente. No se resuelve ni se crea
        // identidad para sus propios mensajes, y por diseño tampoco se
        // registran en mensajes_grupos_sorteos (no aportan valor y evita
        // cualquier ambigüedad de esquema con usuario_id). El bloqueo de
        // identidad para fromMe ya ocurrió antes, en
        // bot/middleware/obtenerUsuario.js — esto es una segunda barrera.
        // ==========================================

        if (msg.key.fromMe) {

            console.log("⏭️ guardarMensajeGrupo: fromMe=true — no se registra ni se resuelve identidad de cliente.");

            return null;

        }

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
        // Autor del mensaje (solo metadato para la fila; NO es resolución
        // de identidad — esa ya se hizo una única vez en obtenerContexto /
        // obtenerUsuario.js, y se recibe aquí como `usuario`).
        // ==========================================

        const jidUsuario =

            msg.key.participant ||

            msg.participant ||

            msg.key.remoteJid ||

            null;

        if (!jidUsuario)
            return null;

        // ==========================================
        // Identidad ya resuelta por el pipeline (ctx.usuario). Si no vino
        // resuelta (p. ej. no se pudo determinar el JID, o hubo una
        // contingencia de identidad), no se registra el mensaje — igual
        // que el comportamiento anterior cuando obtenerUsuarioGlobal
        // devolvía null. NUNCA se vuelve a llamar aquí a
        // obtenerUsuarioGlobal: eso es lo que causaba la doble resolución.
        // ==========================================

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
        // NOTA: ya no hay fallback a sock.user.id (número del propio bot).
        // Ese fallback era el vestigio del camino fromMe, que ahora se
        // corta arriba antes de llegar aquí; para un mensaje real, si el
        // usuario resuelto no tiene teléfono, se registra tal cual (null).

        let telefono = usuario.telefono || null;

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