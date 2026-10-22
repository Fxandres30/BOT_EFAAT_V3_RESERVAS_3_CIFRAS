// ==========================================================================
// GET /sessions/salud — estado REAL de las sesiones del usuario (panel
// /sesiones). Solo lectura: sesiones + sesiones_lease del usuario y la
// memoria de este proceso (services/baileys/salud.js). Nunca escribe.
//
// El usuario sale del token (autenticarUsuario): solo ve SUS sesiones.
// Del lease solo se expone la ubicación (LOCAL/VPS), nunca hostname/pid.
// ==========================================================================

const supabase = require("../../lib/supabase");
const manager = require("../../services/baileys/manager");
const cicloSocket = require("../../services/baileys/cicloSocket");
const lease = require("../../services/baileys/lease");
const salud = require("../../services/baileys/salud");

function ubicacion(ownerId) {
    return String(ownerId || "").split(":")[0] || null;
}

async function saludSesiones(req, res) {

    try {

        const { data: sesiones, error } = await supabase
            .from("sesiones")
            .select("id, nombre, estado, activa")
            .eq("usuario_id", req.usuarioId);

        if (error) throw error;

        const ids = (sesiones || []).map(s => s.id);
        let leases = [];

        if (ids.length) {
            const r = await supabase
                .from("sesiones_lease")
                .select("session_id, owner_id, lease_until")
                .in("session_id", ids);
            // Sin la tabla de leases se evalúa igual (sin conflicto_lease).
            leases = r.error ? [] : (r.data || []);
        }

        const ahora = Date.now();

        const resultado = (sesiones || []).map(s => {

            const filaLease = leases.find(l => l.session_id === s.id) || null;
            const sock = manager.has(s.id) ? manager.get(s.id) : null;

            const evaluacion = salud.evaluar({
                sessionId: s.id,
                sock,
                abierto: !!sock && cicloSocket.estaAbierto(sock),
                // Activa de SU cliente (multisesión: una por cliente).
                activa: manager.isActive(s.id),
                lease: filaLease,
                leasePropio: !!filaLease && filaLease.owner_id === lease.OWNER_ID,
                estadoLeasePropio: lease.estadoLease(s.id),
                estadoSupabase: s.estado,
                ahora
            });

            return {
                sessionId: s.id,
                nombre: s.nombre,
                estadoGuardado: s.estado,
                activaGuardada: !!s.activa,
                lease: filaLease ? {
                    ubicacion: ubicacion(filaLease.owner_id),
                    propio: filaLease.owner_id === lease.OWNER_ID,
                    vigente: new Date(filaLease.lease_until).getTime() > ahora,
                    venceEn: filaLease.lease_until
                } : null,
                ...evaluacion
            };

        });

        res.set("Cache-Control", "no-store");
        res.json({ ok: true, instancia: ubicacion(lease.OWNER_ID), generadoEn: new Date(ahora).toISOString(), sesiones: resultado });

    } catch (err) {

        console.error("❌ [SALUD] error en GET /sessions/salud:", err?.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

}

module.exports = { saludSesiones };
