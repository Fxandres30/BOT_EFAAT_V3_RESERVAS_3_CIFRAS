// ==========================================================================
// middleware/autorizacionSesiones.js — una sesión de WhatsApp solo la puede
// manejar SU dueño.
//
// Se usa DESPUÉS de autenticarUsuario (req.usuarioId sale del token de
// Supabase, nunca del navegador). Una sesión ajena responde 404, como si no
// existiera: no se revela que existe.
// ==========================================================================

const supabase = require("../lib/supabase");

async function perteneceAlUsuario(sessionId, usuarioId) {

    if (!sessionId || !usuarioId) return false;

    const { data, error } = await supabase
        .from("sesiones")
        .select("usuario_id")
        .eq("id", sessionId)
        .maybeSingle();

    return !error && !!data && data.usuario_id === usuarioId;

}

function noEncontrada(res) {
    return res.status(404).json({ success: false, error: "Sesión no encontrada." });
}

// La sesión indicada en la petición (body.sessionId o params.id) es del usuario.
function exigirSesionPropia(leerSessionId) {
    return async (req, res, next) => {
        try {
            const sessionId = leerSessionId(req);
            if (!sessionId) return res.status(400).json({ success: false, error: "Falta sessionId." });
            if (!(await perteneceAlUsuario(String(sessionId), req.usuarioId))) return noEncontrada(res);
            return next();
        } catch (err) {
            console.error("❌ [AUTH SESIONES]", err?.message);
            return noEncontrada(res);
        }
    };
}

// La sesión ACTIVA del proceso es del usuario (rutas /active/*). Si no hay
// sesión activa, el controlador responde como siempre.
function exigirActivaPropia({ sinActivaComoVacio = false } = {}) {
    return async (req, res, next) => {
        try {
            const manager = require("../services/baileys/manager");
            const activa = manager.getActiveSession();
            if (!activa) return next();
            if (await perteneceAlUsuario(activa, req.usuarioId)) return next();
            // La sesión activa es de OTRO cliente: para este usuario es como
            // si no hubiera ninguna (nunca se devuelve la fila ajena).
            if (sinActivaComoVacio) return res.json(null);
            return noEncontrada(res);
        } catch (err) {
            console.error("❌ [AUTH SESIONES]", err?.message);
            return noEncontrada(res);
        }
    };
}

module.exports = {
    perteneceAlUsuario,
    exigirSesionPropia,
    exigirActivaPropia
};
