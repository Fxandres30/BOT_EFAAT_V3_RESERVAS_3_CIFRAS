// ==========================================================================
// ÚNICA función del sistema para extraer el "contextInfo" (datos de mensaje
// citado/reply) de un mensaje crudo de Baileys, sin importar de qué tipo de
// mensaje se trate. Se extrae aquí para que ningún otro módulo reimplemente
// la lista de tipos de mensaje que pueden traer contextInfo (mismo criterio
// arquitectónico que normalizarIdentificadoresDesdeJid() en
// bot/funciones/usuarios/obtenerUsuarioGlobal.js: "no crear lógica
// independiente de identificación en cada módulo").
//
// Historial: hasta esta revisión, bot/funciones/mensajes/guardarMensajeGrupo.js
// tenía esta misma lista inline SIN "stickerMessage" — un sticker que
// respondía a otro mensaje perdía silenciosamente su contextInfo.stanzaId /
// contextInfo.participant (quoted_id / quoted_participant quedaban null).
// Se corrige acá, en el único lugar, para que tanto el guardado en
// mensajes_grupos_sorteos como el futuro detector de "sticker de pago"
// (bot/funciones/mensajes/extraerDatosSticker.js) usen exactamente el mismo
// criterio.
// ==========================================================================

function obtenerContextInfo(msg) {

    const contenido = msg?.message || null;

    if (!contenido) {
        return null;
    }

    return (

        contenido.extendedTextMessage?.contextInfo ||

        contenido.imageMessage?.contextInfo ||

        contenido.videoMessage?.contextInfo ||

        contenido.documentMessage?.contextInfo ||

        contenido.stickerMessage?.contextInfo ||

        contenido.buttonsResponseMessage?.contextInfo ||

        contenido.listResponseMessage?.contextInfo ||

        contenido.templateButtonReplyMessage?.contextInfo ||

        null

    );

}

module.exports = { obtenerContextInfo };
