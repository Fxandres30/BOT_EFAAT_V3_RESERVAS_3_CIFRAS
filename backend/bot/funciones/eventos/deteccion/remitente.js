// ==========================================================================
// ¿Quién publicó el anuncio? Solo la propia cuenta del bot (fromMe) o un
// administrador del grupo pueden reemplazar un sorteo programado desde el
// panel o el sorteo de ese precio en otros grupos: un cliente que reenvía un
// anuncio viejo nunca lo hace.
// ==========================================================================

"use strict";

async function remitenteAutorizado(ctx, grupoId) {
    if (ctx.message?.key?.fromMe) return true;

    const jid = ctx.message?.key?.participant || null;
    if (!jid) return false;

    try {
        const { esAdministrador } = require("../../admins/esAdministrador");
        const r = await esAdministrador({ sock: ctx.sock, grupoId, jid });
        return r?.esAdministrador === true;
    } catch {
        return false;
    }
}

module.exports = { remitenteAutorizado };
