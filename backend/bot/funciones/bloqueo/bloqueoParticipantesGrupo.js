// ==========================================================================
// BLOQUEO AUTOMÁTICO — expulsión inmediata de bloqueados al entrar a un
// grupo.
// ==========================================================================
// Disparador: bot/events/groups.js, "group-participants.update" con
// action === "add" — para CADA participante del propio payload del evento
// (data.participants, ya con id/lid/phoneNumber — ver GroupParticipant de
// Baileys). Deliberadamente NO usa groupMetadata()/escanearGrupo() (que
// pasan por la cola de IQ con espaciado de 1200ms+): el requisito es
// expulsar INMEDIATAMENTE, sin esperar al escáner de identidades ni a
// ningún mensaje/reserva.
//
// Resolución de identidad: reutiliza normalizarIdentificadoresDesdeJid()
// (el ÚNICO criterio del sistema para derivar teléfono/LID de un JID) y
// resolverIdentidadExistente() (solo lectura, sin escribir "usuarios") de
// obtenerUsuarioGlobal.js — NO se reimplementa una segunda normalización.
//
// Deduplicación: si el mismo participante entra varias veces en pocos
// segundos (reintentos de WhatsApp, eventos duplicados), solo se procesa
// una vez por participante+grupo dentro de la ventana — evita expulsiones
// repetidas innecesarias sin bloquear un reingreso real posterior.
// ==========================================================================

const {
    buscarBloqueoActivo,
    registrarIntento
} = require("./bloqueadosRepo");

const {
    groupParticipantsUpdate
} = require("../../../services/baileys/groupQueue");

const {
    normalizarIdentificadoresDesdeJid,
    resolverIdentidadExistente
} = require("../usuarios/obtenerUsuarioGlobal");

const supabase = require("../../../lib/supabase");

const VENTANA_DEDUPE_MS = 8000;
const procesadosRecientemente = new Map(); // "grupoId::jid" -> timeoutId

function marcarProcesado(clave) {

    const timeoutId = setTimeout(() => {
        procesadosRecientemente.delete(clave);
    }, VENTANA_DEDUPE_MS);

    if (typeof timeoutId.unref === "function") timeoutId.unref();

    procesadosRecientemente.set(clave, timeoutId);

}

function yaProcesadoRecientemente(clave) {
    return procesadosRecientemente.has(clave);
}

// Solo para pruebas: limpia el estado de deduplicación entre casos.
function _limpiarLocksParaPruebas() {

    for (const timeoutId of procesadosRecientemente.values()) clearTimeout(timeoutId);
    procesadosRecientemente.clear();

}

// ==========================================================================
// extraerCandidatos(participante) — acepta tanto el objeto GroupParticipant
// real de Baileys ({ id, lid, phoneNumber, ... }) como un JID crudo en
// string (formatos aceptados explícitamente por el requisito).
// ==========================================================================
function extraerCandidatos(participante) {

    if (!participante) return { jid: null, telefono: null, lid: null };

    const esObjeto = typeof participante === "object";

    const jid = esObjeto ? (participante.id || participante.jid || null) : String(participante);

    let telefono = null;
    let lid = esObjeto ? (participante.lid || null) : null;

    if (esObjeto && participante.phoneNumber) {

        const derivado = normalizarIdentificadoresDesdeJid(participante.phoneNumber);
        telefono = derivado.telefono;

    }

    if (jid) {

        const derivadoDeJid = normalizarIdentificadoresDesdeJid(jid);

        telefono = telefono || derivadoDeJid.telefono;
        lid = lid || derivadoDeJid.lid;

    }

    return { jid, telefono, lid };

}

// Best-effort: nombre del grupo ya cacheado en "grupos" (sincronizarGrupo.js)
// — puramente informativo para el incidente, nunca bloquea ni retrasa la
// expulsión si falla o tarda.
async function obtenerNombreGrupoCacheado(grupoId) {

    try {

        const { data } = await supabase
            .from("grupos")
            .select("nombre")
            .eq("jid", grupoId)
            .maybeSingle();

        return data?.nombre || null;

    } catch {

        return null;

    }

}

// ==========================================================================
// procesarIngresoParticipante(sock, grupoId, participante)
// ==========================================================================
// Devuelve { evaluado, bloqueado, expulsado, error } — siempre resuelve,
// nunca lanza (mismo criterio "fire and forget" que el resto de
// disparadores del evento group-participants.update, ver
// bot/events/groups.js).
// ==========================================================================
async function procesarIngresoParticipante(sock, grupoId, participante) {

    const { jid, telefono, lid } = extraerCandidatos(participante);

    if (!grupoId || !jid) {
        return { evaluado: false, motivo: "sin_identidad" };
    }

    const usuarioIdTenant = sock?.context?.usuarioId || null;

    if (!usuarioIdTenant) {
        return { evaluado: false, motivo: "sin_tenant" };
    }

    const claveDedupe = `${grupoId}::${jid}`;

    if (yaProcesadoRecientemente(claveDedupe)) {
        return { evaluado: false, motivo: "duplicado" };
    }

    marcarProcesado(claveDedupe);

    try {

        // Cruce de solo lectura contra "usuarios": si el evento solo trajo
        // LID pero el teléfono de esa misma persona ya se conoce (o
        // viceversa), permite emparejar un bloqueo registrado por el OTRO
        // identificador. Nunca escribe nada, nunca crea usuario.
        let telefonoResuelto = telefono;
        let lidResuelto = lid;

        if (telefono || lid) {

            const { conflicto, usuario } = await resolverIdentidadExistente({ telefono, lid });

            if (!conflicto && usuario) {

                telefonoResuelto = telefonoResuelto || usuario.telefono || null;
                lidResuelto = lidResuelto || usuario.lid || null;

            }

        }

        const { bloqueado } = await buscarBloqueoActivo(usuarioIdTenant, {
            telefono: telefonoResuelto,
            lid: lidResuelto,
            jid
        });

        if (!bloqueado) {
            return { evaluado: true, bloqueado: false };
        }

        console.warn(`🚫 [BLOQUEO] participante bloqueado detectado entrando a ${grupoId}: ${jid}`);

        const grupoNombre = await obtenerNombreGrupoCacheado(grupoId);

        try {

            await groupParticipantsUpdate(sock, grupoId, [jid], "remove");

            await registrarIntento({
                bloqueadoId: bloqueado.id,
                usuarioId: usuarioIdTenant,
                grupoId,
                grupoNombre,
                resultado: "expulsado"
            });

            console.log(`✅ [BLOQUEO] expulsado de ${grupoId}: ${jid}`);

            return { evaluado: true, bloqueado: true, expulsado: true };

        } catch (err) {

            // El bloqueo interno permanece activo aunque la expulsión
            // falle — requisito explícito. Solo se registra el incidente.
            await registrarIntento({
                bloqueadoId: bloqueado.id,
                usuarioId: usuarioIdTenant,
                grupoId,
                grupoNombre,
                resultado: "error",
                error: err?.message || String(err)
            });

            console.error(`❌ [BLOQUEO] no se pudo expulsar a ${jid} de ${grupoId}:`, err?.message);

            return { evaluado: true, bloqueado: true, expulsado: false, error: err?.message };

        }

    } catch (err) {

        console.error("❌ [BLOQUEO] error procesando participante entrante:", err?.message);
        return { evaluado: false, motivo: "error_interno", error: err?.message };

    }

}

module.exports = {
    procesarIngresoParticipante,
    extraerCandidatos,
    _limpiarLocksParaPruebas
};
