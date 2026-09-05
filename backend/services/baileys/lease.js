// ==========================================================================
// LEASE DISTRIBUIDO LOCAL <-> VPS para una misma sesión de WhatsApp.
//
// Coordina PROCESOS (posiblemente en máquinas distintas) que comparten la
// misma fila de Supabase "sesiones". Complementa, sin reemplazar, el lock
// intra-proceso de socket.js:
//
//   LOCAL/VPS -> LEASE DISTRIBUIDO (este archivo, vía RPC atómico en
//                Supabase, ver supabase_migrations/004_lease_sesiones.sql)
//             -> LOCK INTRA-PROCESO (socket.js: createSocket)
//             -> makeWASocket()
//
// La adquisición/renovación/liberación son operaciones ATÓMICAS del lado
// de Postgres (INSERT/UPDATE/DELETE con WHERE que se evalúa bajo el lock
// de fila) — este módulo nunca hace "select -> comprobar -> update" desde
// Node, exactamente para no reintroducir la misma clase de carrera que ya
// se corrigió a nivel intra-proceso.
// ==========================================================================

const os = require("os");
const crypto = require("crypto");

const supabase = require("../../lib/supabase");

const TTL_SEGUNDOS = Number(process.env.LEASE_TTL_SEGUNDOS) || 20;
const HEARTBEAT_MS = (Number(process.env.LEASE_HEARTBEAT_SEGUNDOS) || 7) * 1000;

// LEASE_LOCATION es solo para que los logs sean legibles ("LOCAL"/"VPS").
// La UNICIDAD real del owner_id NUNCA depende de esta etiqueta: se combina
// con hostname + pid + un uuid generado una sola vez por proceso, así que
// dos procesos con la misma etiqueta (dos VPS, o LOCAL corrido dos veces)
// jamás comparten owner_id.
const UBICACION = (process.env.LEASE_LOCATION || "LOCAL").toUpperCase();

const OWNER_ID =
    process.env.LEASE_OWNER_ID ||
    `${UBICACION}:${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;

// sessionId -> intervalId del heartbeat activo para esa sesión, en ESTE
// proceso. Como máximo un heartbeat por sessionId por proceso.
const heartbeats = new Map();

async function acquire(sessionId, ownerId = OWNER_ID, ttlSegundos = TTL_SEGUNDOS) {

    console.log(`🔐 [LEASE] intentando adquirir ${sessionId}`);

    const { data, error } = await supabase.rpc("lease_sesiones_acquire", {
        p_session_id: sessionId,
        p_owner_id: ownerId,
        p_ttl_seconds: ttlSegundos
    });

    if (error) {

        console.error(`❌ [LEASE] error adquiriendo ${sessionId}:`, error.message);

        return { adquirido: false, error };

    }

    const fila = Array.isArray(data) ? data[0] : data;

    if (!fila) {

        console.error(`❌ [LEASE] RPC de adquisición no devolvió fila para ${sessionId}`);

        return { adquirido: false };

    }

    if (fila.adquirido) {

        console.log(`🟢 [LEASE] adquirido ${sessionId} owner=${ownerId}`);

    } else {

        console.log(`⏳ [LEASE] ocupado por otro owner ${sessionId} (owner actual=${fila.owner_id}, vence=${fila.lease_until})`);

    }

    return {
        adquirido: !!fila.adquirido,
        ownerId: fila.owner_id,
        leaseUntil: fila.lease_until
    };

}

async function heartbeat(sessionId, ownerId = OWNER_ID, ttlSegundos = TTL_SEGUNDOS) {

    const { data, error } = await supabase.rpc("lease_sesiones_heartbeat", {
        p_session_id: sessionId,
        p_owner_id: ownerId,
        p_ttl_seconds: ttlSegundos
    });

    if (error) {

        console.error(`❌ [LEASE] error en heartbeat ${sessionId}:`, error.message);

        return { renovado: false, error };

    }

    const fila = Array.isArray(data) ? data[0] : data;
    const renovado = !!(fila && fila.renovado);

    if (renovado) {

        console.log(`💓 [LEASE] heartbeat ${sessionId}`);

    } else {

        console.log(`⚠️ [LEASE] ownership perdido ${sessionId}`);

    }

    return {
        renovado,
        ownerId: fila?.owner_id ?? null,
        leaseUntil: fila?.lease_until ?? null
    };

}

async function release(sessionId, ownerId = OWNER_ID) {

    const { data, error } = await supabase.rpc("lease_sesiones_release", {
        p_session_id: sessionId,
        p_owner_id: ownerId
    });

    if (error) {

        console.error(`❌ [LEASE] error liberando ${sessionId}:`, error.message);

        return { liberado: false, error };

    }

    const fila = Array.isArray(data) ? data[0] : data;
    const liberado = !!(fila && fila.liberado);

    if (liberado) {

        console.log(`🔓 [LEASE] liberado ${sessionId}`);

    }

    return { liberado };

}

// Arranca el heartbeat periódico para sessionId. onOwnershipPerdido(sessionId)
// se invoca (y el heartbeat se detiene) en cuanto una renovación falla —
// ya sea porque otro owner tomó el lease, o porque el TTL venció antes de
// que este heartbeat llegara a tiempo.
function iniciarHeartbeat(sessionId, { ownerId = OWNER_ID, ttlSegundos = TTL_SEGUNDOS, intervaloMs = HEARTBEAT_MS, onOwnershipPerdido } = {}) {

    detenerHeartbeat(sessionId);

    const id = setInterval(async () => {

        const resultado = await heartbeat(sessionId, ownerId, ttlSegundos);

        if (!resultado.renovado) {

            detenerHeartbeat(sessionId);

            if (onOwnershipPerdido) {

                try {

                    await onOwnershipPerdido(sessionId);

                } catch (err) {

                    console.error(`❌ [LEASE] error manejando pérdida de ownership de ${sessionId}:`, err.message);

                }

            }

        }

    }, intervaloMs);

    heartbeats.set(sessionId, id);

}

function detenerHeartbeat(sessionId) {

    const id = heartbeats.get(sessionId);

    if (id) {

        clearInterval(id);
        heartbeats.delete(sessionId);

    }

}

// Libera el lease y detiene el heartbeat local de esta sesión, en un solo
// paso — uso normal al desconectar definitivamente o al perder ownership.
async function soltar(sessionId, ownerId = OWNER_ID) {

    detenerHeartbeat(sessionId);

    return release(sessionId, ownerId);

}

module.exports = {
    OWNER_ID,
    TTL_SEGUNDOS,
    HEARTBEAT_MS,
    acquire,
    heartbeat,
    release,
    soltar,
    iniciarHeartbeat,
    detenerHeartbeat
};
