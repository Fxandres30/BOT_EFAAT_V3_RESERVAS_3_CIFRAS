// ==========================================================================
// Registro en memoria de los mensajes que envía ESTE programa (send.js).
//
// Baileys re-emite cada mensaje propio por messages.upsert (type "append",
// fromMe=true). Sin esta marca, las respuestas del bot volverían a entrar
// al pipeline como si fueran mensajes nuevos. Distingue:
//
//   - mensaje enviado por el programa  -> id registrado aquí -> NO se procesa
//   - mensaje escrito A MANO desde el teléfono del bot (anuncio de sorteo,
//     sticker de pago) -> fromMe=true pero id NO registrado -> sigue igual
//
// El id se registra ANTES de enviar (send.js genera el messageId y se lo
// pasa a Baileys), porque Baileys emite el evento propio en process.nextTick,
// antes de que la promesa de sendMessage resuelva.
//
// En memoria y con caducidad: basta con cubrir los segundos que tarda el
// eco. Si el proceso se reinicia, el filtro fromMe de eventHandler.js sigue
// impidiendo reservas/consultas sobre mensajes propios.
// ==========================================================================

const CADUCIDAD_MS = 10 * 60 * 1000;
const MAXIMO = 5000;

const enviados = new Map(); // id -> timestamp

function limpiar(ahora) {

    for (const [id, ts] of enviados) {
        if (ahora - ts <= CADUCIDAD_MS && enviados.size <= MAXIMO) break;
        enviados.delete(id);
    }

}

function registrarEnviado(id, ahora = Date.now()) {

    if (typeof id !== "string" || !id) return;

    limpiar(ahora);
    enviados.set(id, ahora);

}

function fueEnviadoPorPrograma(id, ahora = Date.now()) {

    if (typeof id !== "string" || !enviados.has(id)) return false;

    return ahora - enviados.get(id) <= CADUCIDAD_MS;

}

function reiniciar() {
    enviados.clear();
}

module.exports = { registrarEnviado, fueEnviadoPorPrograma, reiniciar, CADUCIDAD_MS };
