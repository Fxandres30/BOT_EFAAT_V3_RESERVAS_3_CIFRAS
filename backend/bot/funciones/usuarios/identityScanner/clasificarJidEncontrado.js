// ==========================================================================
// Clasifica un JID crudo ya extraído por recorrerObjeto.js, usando los
// helpers OFICIALES de Baileys — mismo criterio (no una copia propia de las
// reglas) que ya usa bot/funciones/usuarios/escanerIdentidades.js con
// isLidUser/isPnUser. Se agregan aquí también isHostedPnUser/
// isHostedLidUser: verificado contra el paquete instalado
// (node_modules/@whiskeysockets/baileys, 7.0.0-rc14) que Baileys reconoce
// HOY 4 dominios de identidad personal, no 2.
//
//   @s.whatsapp.net / @hosted      -> "phone"
//   @lid            / @hosted.lid  -> "lid"
//
// Cualquier otro dominio (@g.us, @broadcast, @newsletter, @bot, @c.us...)
// no es una identidad de PERSONA — se clasifica "otro". recorrerObjeto.js
// ya no los captura (su patrón solo reconoce estos 4 dominios), así que en
// la práctica este módulo solo necesita distinguir entre "phone" y "lid";
// "otro" queda como salida defensiva si en el futuro se amplía el patrón.
// ==========================================================================

const {
    isPnUser,
    isLidUser,
    isHostedPnUser,
    isHostedLidUser
} = require("@whiskeysockets/baileys");

function clasificarJidEncontrado(jid) {

    if (!jid || typeof jid !== "string") return "otro";

    if (isLidUser(jid) || isHostedLidUser(jid)) return "lid";

    if (isPnUser(jid) || isHostedPnUser(jid)) return "phone";

    return "otro";

}

module.exports = { clasificarJidEncontrado };
