// ==========================================================================
// Listener INDEPENDIENTE de "messages.upsert" para el escaneo de
// identidades en vivo (IdentitySync, FASE 2).
// ==========================================================================
// Deliberadamente SEPARADO del listener real de negocio
// (bot/events/messages.upsert.js -> dispatcher.js -> ... -> reservas). Dos
// razones, ambas de la auditoría ("no tocar reservas todavía" / "no
// bloquear el bot"):
//
//   1. Aislamiento total: aunque este archivo tenga un bug, no puede
//      afectar en absoluto a obtenerContexto/obtenerUsuario/dispatcher ni a
//      ningún paso del flujo de reservas — son dos suscripciones
//      independientes al mismo evento de Baileys, cada una con su propio
//      try/catch. Node invoca a cada listener de un EventEmitter por
//      separado; un error no capturado en uno no impide que el otro corra.
//   2. No bloqueante: este listener NUNCA se espera (no hay `await` en el
//      camino de negocio hacia este archivo) — es fire-and-forget puro,
//      así que aunque el IdentitySync tarde (varias consultas a Supabase
//      por mensaje, ver identityResolver.js), el procesamiento real del
//      mensaje (dispatcher.js) no espera por él.
//
// "El scanner es una capa de enriquecimiento" — no forma parte del pipeline
// de negocio, solo lo observa.
// ==========================================================================

const { sincronizarDesdeMensaje } = require("../funciones/usuarios/identityScanner/identitySyncMensaje");

const listeners = new Map();

function registerIdentitySync(sock, sessionId) {

    unregisterIdentitySync(sessionId);

    const listener = ({ messages }) => {

        if (!messages || messages.length === 0) return;

        for (const message of messages) {

            // Fire-and-forget: nunca se espera, nunca debe retrasar nada.
            // El try/catch de adentro de sincronizarDesdeMensaje ya cubre
            // los 2 roles por separado; este .catch() es la última red de
            // seguridad ante cualquier error verdaderamente inesperado
            // (p. ej. que el propio motor de escaneo lance una excepción
            // antes de llegar a su try/catch interno).
            sincronizarDesdeMensaje({ sock, message }).catch(err => {

                console.error(`❌ [IDENTITY SYNC] error inesperado procesando mensaje [${message?.key?.id || "?"}]:`, err?.message);

            });

        }

    };

    sock.ev.on("messages.upsert", listener);

    listeners.set(sessionId, { sock, listener });

}

function unregisterIdentitySync(sessionId) {

    const data = listeners.get(sessionId);

    if (!data) return;

    data.sock.ev.off("messages.upsert", data.listener);

    listeners.delete(sessionId);

}

module.exports = {
    registerIdentitySync,
    unregisterIdentitySync
};
