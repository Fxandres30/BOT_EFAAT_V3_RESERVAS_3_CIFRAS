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
        // fromMe: el bot no es un cliente.
        // ==========================================
        // El panel de Chats necesita ver la conversación completa,
        // incluidas las respuestas del BOT — por eso el mensaje SÍ se
        // guarda. Pero jamás se resuelve, crea ni actualiza identidad de
        // cliente para un mensaje propio: usuario_id queda NULL
        // (mensajes_grupos_sorteos.usuario_id es nullable) y ni siquiera se
        // referencia `usuario` en esta rama. El bloqueo real de identidad ya
        // ocurrió antes, en bot/middleware/obtenerUsuario.js (que ni
        // siquiera intenta resolver para fromMe); aquí simplemente no se
        // usa lo que llegue en `usuario` cuando fromMe=true.
        // ==========================================

        const esFromMe = !!msg.key.fromMe;

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
        // Identidad — SOLO para mensajes reales (fromMe=false).
        //
        // Para un mensaje real, la identidad ya fue resuelta UNA vez por el
        // pipeline (obtenerContexto → obtenerUsuario.js → ctx.usuario) y se
        // recibe aquí como `usuario`. Si no vino resuelta (p. ej. no se
        // pudo determinar el JID, o hubo una contingencia de identidad), no
        // se registra el mensaje — igual que el comportamiento anterior
        // cuando obtenerUsuarioGlobal devolvía null. NUNCA se vuelve a
        // llamar aquí a obtenerUsuarioGlobal: eso es lo que causaba la
        // doble resolución.
        //
        // Para fromMe, `usuario` se ignora por completo aunque llegara con
        // algo — el bot nunca es la identidad de un cliente.
        // ==========================================

        if (!esFromMe && !usuario)
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
        // Datos de identidad para la fila — SOLO para mensajes reales.
        // ==========================================
        // Para fromMe quedan NULL a propósito: el bot no es un cliente y su
        // teléfono/LID NUNCA debe mezclarse aquí ni usarse como si fuera un
        // dato de identidad (aunque el registro en sí sí se guarda, para
        // que el panel de Chats muestre la conversación completa).

        let usuarioId = null;
        let telefono = null;
        let lid = null;
        let nombreUsuario = null;

        if (!esFromMe) {

            usuarioId = usuario.id;

            telefono = usuario.telefono || null;

            if (telefono === "null")
                telefono = null;

            lid = usuario.lid || null;

            nombreUsuario = usuario.nombre || null;

        }

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

                usuario_id: usuarioId,

                telefono,

                lid,

                nombre: nombreUsuario,

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