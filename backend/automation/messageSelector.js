// ==========================================================================
// messageSelector.js — selección ALEATORIA de un mensaje del pool, con
// anti-repetición inmediata.
//
// Algoritmo (Fase 4A, "REGLA ALEATORIA"):
//   1. obtener mensajes activos del tipo solicitado (+ categoría si se pide)
//   2. excluir el último mensaje utilizado, CUANDO SEA POSIBLE (si al
//      excluirlo no quedara ningún candidato, no se excluye — no hay
//      alternativa real)
//   3. elegir uno al azar entre los candidatos restantes
//
// Nunca elige "el primero", nunca depende del orden en que la base de
// datos devuelva las filas — el índice aleatorio se calcula sobre el
// array ya completo, después de aplicar los filtros.
// ==========================================================================

const messagesRepo = require("./repo/messages");

// seleccionarMensaje({ usuarioId, grupoId, tipo, categoria? }) -> mensaje | null
async function seleccionarMensaje({ usuarioId, grupoId, tipo, categoria = null }) {

    const activos = await messagesRepo.obtenerMensajesActivos({ usuarioId, tipo, categoria });

    if (!activos.length) {
        return null;
    }

    let candidatos = activos;

    if (activos.length > 1) {

        const ultimoId = await messagesRepo.obtenerUltimoMensajeUsado({ usuarioId, grupoId, tipo });

        if (ultimoId) {

            const sinRepetirElUltimo = activos.filter(m => m.id !== ultimoId);

            // "cuando sea posible": si excluir el último dejara 0
            // candidatos (solo existía ese mensaje), se conserva la lista
            // completa — no hay otra opción real.
            if (sinRepetirElUltimo.length > 0) {
                candidatos = sinRepetirElUltimo;
            }

        }

    }

    const indice = Math.floor(Math.random() * candidatos.length);

    return candidatos[indice];

}

module.exports = {
    seleccionarMensaje
};
