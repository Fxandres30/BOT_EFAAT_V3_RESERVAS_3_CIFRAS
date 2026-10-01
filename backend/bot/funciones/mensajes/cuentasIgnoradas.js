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
//
// CUENTAS PROPIAS (además de la lista fija): las cuentas de WhatsApp de
// TODAS las sesiones del sistema conectadas en este proceso (activa y
// secundarias) — su identidad real es sock.user (= creds.me: número y
// LID). Así una sesión nunca toma por pedido de cliente un mensaje
// automático o un aviso de otra sesión propia (evita bucles "No quedan
// números disponibles" entre bots propios). Mismo alcance D2: solo
// reservas/consultas; anuncios de sorteo, stickers de pago e historial
// siguen igual. No depende de ser administrador del grupo.
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

// Número y LID (sin sufijo de dispositivo) de cada sesión conectada en este
// proceso. require perezoso: el manager no se carga si nunca se pregunta.
function identidadesSesionesPropias() {

    const ids = new Set();

    try {

        const manager = require("../../../services/baileys/manager");

        for (const sock of manager?.sockets?.values?.() || []) {

            for (const jid of [sock?.user?.id, sock?.user?.lid]) {

                const id = usuarioDeJid(jid);

                if (id) ids.add(id);

            }

        }

    } catch (err) {

        console.error("⚠️ [CUENTAS PROPIAS] no se pudieron leer las sesiones conectadas:", err?.message);

    }

    return ids;

}

function esCuentaIgnorada({ message, usuario } = {}) {

    const candidatos = [
        message?.key?.participant,
        message?.key?.participantAlt,
        usuario?.lid ? `${usuario.lid}@lid` : null,
        usuario?.telefono || null
    ];

    const propias = identidadesSesionesPropias();

    return candidatos.some(jid => {
        const id = usuarioDeJid(jid);
        return !!id && (LIDS_IGNORADOS.has(id) || propias.has(id));
    });

}

module.exports = { esCuentaIgnorada, identidadesSesionesPropias, LIDS_IGNORADOS };
