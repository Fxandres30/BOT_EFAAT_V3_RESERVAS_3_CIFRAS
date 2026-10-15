// ==========================================================================
// middleware/autenticacionUsuario.js — identidad REAL del cliente que llama.
//
// Las rutas del panel multiusuario (sorteos, plantillas, cuentas de pago)
// NUNCA confían en un usuarioId enviado por el navegador. Exigen DOS cosas:
//
//   1. x-service-token (middleware/tokenServicio.js): la petición viene de
//      las rutas de servidor del panel Next, no de cualquiera que alcance el
//      puerto del backend.
//   2. Authorization: Bearer <access_token de Supabase>: el token de sesión
//      del usuario que inició sesión en el panel. Se valida contra Supabase
//      Auth (supabase.auth.getUser) y el usuario sale DE AHÍ: req.usuarioId.
//
// Falla cerrado: sin token válido -> 401, sin consultar nada más.
// ==========================================================================

const supabase = require("../lib/supabase");
const { exigirTokenServicio } = require("./tokenServicio");

function extraerBearer(req) {

    const cabecera = req.get("authorization") || "";
    const m = cabecera.match(/^Bearer\s+(\S+)$/i);

    return m ? m[1] : null;

}

async function autenticarUsuario(req, res, next) {

    const token = extraerBearer(req);

    if (!token) {
        console.warn(`⚠️ [AUTH USUARIO] ${req.method} ${req.originalUrl} → 401: petición sin sesión de usuario.`);
        return res.status(401).json({ ok: false, motivo: "sin_sesion", error: "Falta la sesión del usuario." });
    }

    try {

        const { data, error } = await supabase.auth.getUser(token);

        if (error || !data?.user?.id) {
            console.warn(`⚠️ [AUTH USUARIO] ${req.method} ${req.originalUrl} → 401: sesión rechazada por Supabase Auth.`);
            return res.status(401).json({ ok: false, motivo: "sesion_invalida", error: "La sesión no es válida o expiró." });
        }

        req.usuarioId = data.user.id;

        return next();

    } catch (err) {

        console.error("❌ [AUTH USUARIO] error validando la sesión:", err?.message);
        return res.status(401).json({ ok: false, motivo: "sesion_invalida", error: "No se pudo validar la sesión." });

    }

}

// Cadena completa para las rutas del panel: servicio + usuario.
const exigirUsuario = [exigirTokenServicio, autenticarUsuario];

module.exports = {
    autenticarUsuario,
    exigirUsuario
};
