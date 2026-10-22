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

// Rutas /active/*: la sesión activa DEL USUARIO DEL TOKEN (multisesión,
// 2026-10-21). Antes era la única activa del proceso, comprobando que fuera
// suya; ahora cada cliente tiene la suya y nunca se ve ni usa la de otro.
// Deja en req.sesionActivaPropia { sessionId, sock } (sock: solo si está
// open) o null; sin activa, el controlador responde como siempre.
// sinActivaComoVacio se mantiene por compatibilidad de la firma.
function exigirActivaPropia({ sinActivaComoVacio = false } = {}) {
    return (req, res, next) => {
        try {
            const manager = require("../services/baileys/manager");
            const sessionId = manager.getSesionActivaDe(req.usuarioId);
            req.sesionActivaPropia = sessionId
                ? { sessionId, sock: manager.getSocketActivoDe(req.usuarioId) }
                : null;
            return next();
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
