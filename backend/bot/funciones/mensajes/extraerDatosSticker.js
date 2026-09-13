// ==========================================================================
// extraerDatosSticker() — FASE 1 (infraestructura para confirmación de pago
// por sticker, ver AUDITORÍA sección H/I). Función PURA: no consulta
// Supabase, no llama a Baileys, no descarga ni guarda el archivo del
// sticker. Solo lee campos que Baileys YA entregó dentro del mensaje.
//
// Reutiliza bot/utils/obtenerContextInfo.js (único criterio del sistema
// para leer contextInfo) en vez de reimplementar la lista de tipos de
// mensaje que pueden traer cita — mismo criterio arquitectónico que el
// resto del proyecto.
//
// IMPORTANTE: esta función NO decide si el remitente es administrador ni
// si el sticker es "el sticker de pago" — eso es responsabilidad de
// bot/funciones/admins/esAdministrador.js y de una futura configuración de
// hashes autorizados (todavía no existe, a propósito — ver auditoría).
// ==========================================================================

const { obtenerContextInfo } = require("../../utils/obtenerContextInfo");

// fileSha256 llega de Baileys como Buffer en el caso normal (mensaje recién
// recibido en el proceso). Se normaliza defensivamente por si en algún
// punto llega ya serializado (p. ej. tras pasar por JSON: Buffer se
// convierte en { type: "Buffer", data: [...] }) — nunca lanza, si no puede
// interpretarlo devuelve null en vez de reventar el pipeline de mensajes.
function bufferAHex(valor) {

    if (!valor) return null;

    try {

        if (Buffer.isBuffer(valor)) {
            return valor.toString("hex");
        }

        if (valor instanceof Uint8Array) {
            return Buffer.from(valor).toString("hex");
        }

        if (Array.isArray(valor?.data)) {
            return Buffer.from(valor.data).toString("hex");
        }

        return null;

    } catch (err) {

        return null;

    }

}

function extraerDatosSticker(msg) {

    const sticker = msg?.message?.stickerMessage || null;

    if (!sticker) {

        return { esSticker: false };

    }

    const contextInfo = obtenerContextInfo(msg);

    const quotedId = contextInfo?.stanzaId || null;
    const quotedParticipant = contextInfo?.participant || null;

    return {

        esSticker: true,

        // Identidad del propio mensaje sticker (no del citado).
        stanzaId: msg?.key?.id || null,

        // Identidad del sticker en sí — para comparar contra un hash
        // configurado más adelante. NUNCA es el archivo, solo su huella.
        mimetype: sticker.mimetype || null,
        fileSha256Hex: bufferAHex(sticker.fileSha256),

        // Mensaje citado, si lo hay.
        tieneCita: !!quotedId,
        quotedId,
        quotedParticipant

    };

}

module.exports = { extraerDatosSticker };
