// ==========================================================================
// Regla absoluta: un mensaje cuyo contenido ORIGINAL contiene ❌ no se
// procesa ni se responde (avisos operativos: "❌ Sin números disponibles",
// "Número ❌", ...). Se queda solo en el historial (panel de Chats).
//
// Se mira el texto ORIGINAL (textoOriginal de normalizarMensaje.js: texto,
// pie de foto/video/documento, respuestas de botón, también dentro de
// ephemeral/viewOnce/editado) — normalizarTexto() elimina los emojis, así
// que la marca hay que leerla ANTES de normalizar. El mensaje CITADO no
// cuenta: un cliente que responde a un "❌ ya ocupado" del bot con "dame el
// 45" es un pedido real.
// ==========================================================================

const normalizarMensaje = require("../../middleware/normalizarMensaje");

const EMOJI_IGNORAR = "❌";

function contieneCruz(message) {

    const { textoOriginal } = normalizarMensaje(message);

    return typeof textoOriginal === "string" && textoOriginal.includes(EMOJI_IGNORAR);

}

module.exports = {
    EMOJI_IGNORAR,
    contieneCruz
};
