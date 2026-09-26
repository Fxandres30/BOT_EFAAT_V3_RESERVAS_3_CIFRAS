// ==========================================================================
// Cuentas cuyos mensajes NO activan reservas ni consultas de números.
//
// Son 5 cuentas del grupo que publican avisos operativos ("sin números
// disponibles por el momento familia", "recordatorio … se liberan los
// numeritos no pago"). Llegan con fromMe=false y, sin esta lista, el bot
// los interpretaba como pedidos de clientes (p. ej. "disponibilidad").
//
// Alcance deliberadamente estrecho (decisión D2):
//   - solo estas 5 cuentas, NO todos los administradores;
//   - solo se saltan reservas/consultas (eventHandler.js); sus mensajes se
//     siguen registrando y pueden seguir anunciando sorteos.
//
// Se identifican por LID (así llegan en el grupo; no tienen teléfono
// asociado en `usuarios`). Se compara el LID sin sufijo de dispositivo.
// ==========================================================================

const LIDS_IGNORADOS = new Set([
    "249705908932856",
    "148185699872795",
    "19624460550303",
    "7156153774273",
    "21282301169746"
]);

// "7156153774273:11@lid" -> "7156153774273"
function usuarioDeJid(jid) {

    if (typeof jid !== "string" || !jid) return null;

    return jid.split("@")[0].split(":")[0] || null;

}

function esCuentaIgnorada({ message, usuario } = {}) {

    const candidatos = [
        message?.key?.participant,
        message?.key?.participantAlt,
        usuario?.lid ? `${usuario.lid}@lid` : null
    ];

    return candidatos.some(jid => {
        const id = usuarioDeJid(jid);
        return !!id && LIDS_IGNORADOS.has(id);
    });

}

module.exports = { esCuentaIgnorada, LIDS_IGNORADOS };
