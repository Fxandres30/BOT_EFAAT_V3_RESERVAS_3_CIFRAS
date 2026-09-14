// ==========================================================================
// Interruptor único para el diagnóstico de mensajes entrantes (auditoría
// 2026-09: "recopilar TODA la información disponible de cada mensaje
// entrante, sin llenar producción permanentemente con dumps RAW").
// ==========================================================================
// Activar con la variable de entorno:
//
//     DEBUG_INCOMING_MESSAGES=true
//
// Apagado por defecto — sin esta variable, el bot se comporta exactamente
// igual que antes de esta auditoría (ningún log nuevo, ningún costo extra).
// Un único punto de lectura de la variable de entorno: nadie más en el
// código debe leer `process.env.DEBUG_INCOMING_MESSAGES` directamente, para
// que activar/desactivar el diagnóstico sea consistente en todo el bot.
// ==========================================================================

function debugMensajesActivo() {

    return String(process.env.DEBUG_INCOMING_MESSAGES || "").trim().toLowerCase() === "true";

}

module.exports = { debugMensajesActivo };
