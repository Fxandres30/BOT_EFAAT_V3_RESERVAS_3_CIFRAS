const {
    obtenerUsuarioGlobal
} = require("../funciones/usuarios/obtenerUsuarioGlobal");

// ==========================================================================
// Identificadores disponibles en Baileys (@whiskeysockets/baileys ^7.0.0-rc14
// — verificado en node_modules/@whiskeysockets/baileys/lib/Types/Message.d.ts)
// ==========================================================================
//  - message.key.participant    → JID del remitente real dentro de un grupo.
//                                  Puede terminar en "@lid" o en
//                                  "@s.whatsapp.net" según el modo de
//                                  direccionamiento de ese chat/remitente.
//  - message.key.participantAlt → JID alterno del MISMO remitente (el otro
//                                  lado del par LID/PN) cuando Baileys lo
//                                  expone. Se usa aquí SOLO como respaldo si
//                                  falta "participant" — nunca se prioriza
//                                  por encima del remitente real.
//  - message.key.remoteJid      → JID del chat. En privado coincide con el
//                                  remitente; en grupo es el JID del grupo
//                                  (NO de la persona), por eso es el último
//                                  respaldo, no la primera opción.
//  - sock.user.id                → identidad del propio bot. Válida
//                                  ÚNICAMENTE para decidir que un mensaje es
//                                  fromMe; JAMÁS se usa para identificar a un
//                                  cliente.
//
// Esta versión de Baileys NO expone "senderLid" / "senderPn" como campos del
// mensaje (no existen en Message.d.ts ni en el proto instalado). Si al
// actualizar Baileys aparecen, deben documentarse aquí antes de usarse.
//
// Regla dura de identidad: un JID terminado en "@lid" JAMÁS se convierte en
// teléfono. Esa conversión (y la extracción de teléfono desde
// "@s.whatsapp.net") ocurre únicamente dentro de obtenerUsuarioGlobal.
// ==========================================================================

module.exports = async function (ctx) {

    // ==========================================
    // BLOQUEO fromMe: el bot no es un cliente.
    // ==========================================
    // Un mensaje fromMe=true NUNCA debe crear, actualizar ni resolver una
    // identidad de cliente. Antes, este middleware calculaba un JID a partir
    // de sock.user.id para mensajes propios y lo mandaba a
    // obtenerUsuarioGlobal(), que terminaba creando (o "encontrando" por
    // colisión mal manejada) filas fantasma en "usuarios" — el origen de los
    // 474 duplicados con teléfono del propio bot. Se corta aquí, antes de
    // cualquier resolución.

    if (ctx.message.key.fromMe) {

        console.log("⏭️ obtenerUsuario: fromMe=true — no se resuelve identidad de cliente.");

        return null;

    }

    // ==========================================
    // JID del remitente real (mensaje entrante genuino)
    // ==========================================

    const jid =
        ctx.chat.participante ||
        ctx.message.key.participant ||
        ctx.message.key.participantAlt ||
        ctx.chat.remoteJid ||
        null;

    if (!jid) {

        console.log("⚠ No se pudo determinar el JID del usuario.");

        return null;

    }

    // ==========================================
    // Resolución ÚNICA de identidad para este mensaje. Nadie más en el
    // pipeline de un mensaje entrante debe volver a llamar a
    // obtenerUsuarioGlobal — deben reutilizar ctx.usuario.
    // ==========================================

    return await obtenerUsuarioGlobal({

        jid,

        nombre: ctx.message.pushName || null

    });

};
