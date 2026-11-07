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

// seleccionarMensaje({ usuarioId, grupoId, tipo, categoria? }, opciones?) -> mensaje | null
//
// opciones (FASE O3, opcionales; sin ellas el comportamiento es EXACTAMENTE
// el de siempre):
//   observar(foto)  recibe la foto de la selección — { activosIds,
//                   ultimoLeido, ultimoId, azar, elegidoId } — para que la
//                   comparación en sombra use el MISMO último uso (leído aquí,
//                   ANTES de que el motor registre el nuevo) y el mismo azar.
//                   Solo observa: un fallo suyo se ignora.
async function seleccionarMensaje({ usuarioId, grupoId, tipo, categoria = null }, opciones = {}) {

    const observar = (foto) => {
        if (typeof opciones.observar !== "function") return;
        try { opciones.observar(foto); } catch { /* solo observa */ }
    };

    const activos = await messagesRepo.obtenerMensajesActivos({ usuarioId, tipo, categoria });

    if (!activos.length) {
        observar({ activosIds: [], ultimoLeido: false, ultimoId: null, azar: null, elegidoId: null });
        return null;
    }

    let candidatos = activos;
    let ultimoLeido = false;
    let ultimoId = null;

    if (activos.length > 1) {

        ultimoId = await messagesRepo.obtenerUltimoMensajeUsado({ usuarioId, grupoId, tipo });
        ultimoLeido = true;

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

    const azar = Math.random();
    const indice = Math.floor(azar * candidatos.length);

    observar({ activosIds: activos.map(m => m.id), ultimoLeido, ultimoId, azar, elegidoId: candidatos[indice]?.id ?? null });

    return candidatos[indice];

}

module.exports = {
    seleccionarMensaje
};
