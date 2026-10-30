// ==========================================================================
// bloqueoActivo.js — ÚNICA comprobación de "¿esta persona está bloqueada por
// este cliente?" para el flujo de mensajes y de reservas.
//
//   - dispatcher.js: un mensaje de un bloqueado se guarda en el historial,
//     pero no llega a stickers de pago, reservas, consultas, comandos ni
//     respuestas.
//   - reservarNumeros.js: última barrera justo antes del UPDATE (bot y
//     panel); cubre un bloqueo hecho mientras la reserva estaba en curso.
//   - reservaManual.js: rechazo explícito («contacto bloqueado»).
//
// Coincidencia EXACTA por LID, JID o teléfono (el mismo teléfono normalizado
// con el que se guardó el bloqueo). Siempre por cliente (usuario_id): un
// bloqueo de A nunca afecta a B.
//
// Caché por cliente de CACHE_TTL_MS para no consultar la base en cada
// mensaje; crear/desbloquear invalidan la caché del cliente en este proceso
// (otro proceso lo ve como mucho tras el TTL). Las reservas usan fresco=true.
//
// Falla ABIERTO a propósito: si no se puede leer "bloqueados" (Supabase
// caído, migración ausente) se registra el error y NO se trata como
// bloqueado — si no, un fallo de lectura dejaría sin servicio a todos los
// participantes del cliente. Mismo criterio que compuertaIngreso.yaRegistrado.
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { normalizarJid } = require("./identidadParticipante");

const CACHE_TTL_MS = 15 * 1000;

const cache = new Map(); // usuarioId -> { hasta, filas: Promise<Array|null> }

async function leerActivos(usuarioId) {

    try {

        const { data, error } = await supabase
            .from("bloqueados")
            .select("id, telefono, lid, jid, nombre")
            .eq("usuario_id", usuarioId)
            .eq("activo", true);

        if (error) {
            if (error.code !== "42P01") console.error("⚠️ [BLOQUEO ACTIVO] no se pudo leer bloqueados (se continúa sin bloquear):", error.code || error.message);
            return null;
        }

        return Array.isArray(data) ? data : [];

    } catch (err) {

        console.error("⚠️ [BLOQUEO ACTIVO] excepción leyendo bloqueados (se continúa sin bloquear):", err?.message);
        return null;

    }

}

function activosDe(usuarioId, { fresco = false } = {}) {

    const ahora = Date.now();
    const vigente = cache.get(usuarioId);

    if (!fresco && vigente && vigente.hasta > ahora) return vigente.filas;

    const filas = leerActivos(usuarioId);

    cache.set(usuarioId, { hasta: ahora + CACHE_TTL_MS, filas });
    filas.then(f => { if (f === null && cache.get(usuarioId)?.filas === filas) cache.delete(usuarioId); });

    return filas;

}

function telefonoPlano(valor) {
    const d = String(valor || "").replace(/\D/g, "");
    return d || null;
}

function coincide(fila, { telefono, lid, jid }) {

    const ids = new Set([lid, jid].map(normalizarJid).filter(Boolean));
    const delBloqueo = [fila.lid, fila.jid].map(normalizarJid).filter(Boolean);

    if (delBloqueo.some(id => ids.has(id))) return true;

    const tel = telefonoPlano(telefono);

    return !!tel && !!fila.telefono && telefonoPlano(fila.telefono) === tel;

}

// { bloqueado: fila | null, verificado: boolean }
async function buscarBloqueo(usuarioId, { telefono = null, lid = null, jid = null } = {}, { fresco = false } = {}) {

    if (!usuarioId || (!telefono && !lid && !jid)) return { bloqueado: null, verificado: true };

    const filas = await activosDe(usuarioId, { fresco });

    if (filas === null) return { bloqueado: null, verificado: false };

    return { bloqueado: filas.find(f => coincide(f, { telefono, lid, jid })) || null, verificado: true };

}

// Autor de un mensaje ya contextualizado (obtenerContexto): usuario resuelto
// (teléfono/LID) + participante del mensaje (JID crudo).
async function bloqueoDelAutor(clienteUsuarioId, ctx) {

    if (!clienteUsuarioId || !ctx || ctx.message?.key?.fromMe) return null;

    const key = ctx.message?.key || {};
    const jid = ctx.chat?.participante || key.participant || (ctx.chat?.esPrivado ? ctx.chat?.remoteJid : null) || null;

    const { bloqueado } = await buscarBloqueo(clienteUsuarioId, {
        telefono: ctx.usuario?.telefono || null,
        lid: ctx.usuario?.lid || (String(key.participantAlt || "").endsWith("@lid") ? key.participantAlt : null),
        jid
    });

    return bloqueado;

}

function olvidarBloqueos(usuarioId) {
    if (usuarioId) cache.delete(usuarioId);
    else cache.clear();
}

module.exports = {
    CACHE_TTL_MS,
    buscarBloqueo,
    bloqueoDelAutor,
    olvidarBloqueos
};
