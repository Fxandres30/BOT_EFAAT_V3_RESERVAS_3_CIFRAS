// ==========================================================================
// Único criterio del sistema para loguear un JID sin exponerlo completo
// (contiene el teléfono). Mismo espíritu que maskPhone() en
// services/baileys/identidadSesion.js, extraído aquí porque ya lo
// necesitaban por separado bot/funciones/pagos/confirmarPagoPorSticker.js y
// bot/funciones/pagos/depurarStickerPago.js — se centraliza para no
// triplicarlo con bot/funciones/pagos/registrarStickerPago.js.
// ==========================================================================

function enmascararJid(jid) {

    if (!jid) return "(ninguno)";

    const [usuario, dominio] = jid.split("@");

    if (!usuario) return "(formato desconocido)";

    const visible = usuario.slice(-4);

    return `***${visible}@${dominio || "?"}`;

}

module.exports = { enmascararJid };
