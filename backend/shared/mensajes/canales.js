// ==========================================================================
// shared/mensajes/canales.js — salida por canal: texto, imagen o reacción.
//
// NO importa services/baileys/send.js: recibe las funciones de envío
// (`envios`: { sendMessage, sendImage, sendReaction }) con su MISMA firma.
// En O2 se le pasarán las de send.js sin cambiarlas; así se conservan el
// «escribiendo…», la marca de salida de EFAAT y el rechazo sin socket (EN1–EN3).
// ==========================================================================

"use strict";

// -> { ok: true } | { ok: false, motivo }
function validarSalida(canal, { texto, imagen, reaccion }) {
    if (canal === "texto") return typeof texto === "string" && texto.trim() ? { ok: true } : { ok: false, motivo: "texto_vacio" };
    if (canal === "imagen") return Buffer.isBuffer(imagen) && imagen.length > 0 ? { ok: true } : { ok: false, motivo: "imagen_invalida" };
    if (canal === "reaccion") return reaccion?.key && reaccion?.emoji ? { ok: true } : { ok: false, motivo: "reaccion_invalida" };
    return { ok: false, motivo: "canal_desconocido" };
}

// Envía por el canal indicado. Lanza si el envío falla (cada motor decide
// qué hacer con el error, como hoy: EN4).
async function enviarPorCanal({ envios, canal, sock, jid, texto, citar, imagen, reaccion }) {
    if (canal === "texto") return envios.sendMessage({ sock, jid, text: texto, ...(citar ? { quoted: citar } : {}) });
    if (canal === "imagen") return envios.sendImage({ sock, jid, image: imagen, caption: texto || "" });
    if (canal === "reaccion") return envios.sendReaction({ sock, jid, key: reaccion.key, emoji: reaccion.emoji });
    throw new Error(`Canal desconocido: ${canal}`);
}

module.exports = { validarSalida, enviarPorCanal };
