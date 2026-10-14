// ==========================================================================
// middleware/tokenServicio.js — protege /sessions/* con un token compartido
// entre servidores (BANN apps/api y las rutas proxy del panel Next).
//
// El token vive SOLO en variables de entorno de servidor:
//   - este backend:      SESSIONS_API_TOKEN
//   - BANN apps/api:      WA_API_TOKEN
//   - panel Next (proxy): BOT_API_TOKEN   (sin prefijo NEXT_PUBLIC_: nunca
//                                           llega al navegador)
// Se envía en el header `x-service-token`.
//
// Falla cerrado: si SESSIONS_API_TOKEN no está configurado, /sessions/*
// responde 503 en vez de quedar abierto. Nunca se loguea el token.
// ==========================================================================

const crypto = require("crypto");

function digest(valor) {

    return crypto.createHash("sha256").update(String(valor)).digest();

}

function exigirTokenServicio(req, res, next) {

    const esperado = process.env.SESSIONS_API_TOKEN;

    if (!esperado) {

        // Afecta a TODAS las rutas que usan este middleware (/sessions,
        // /sorteos, /contactos, /bloqueados, /tablas/compartir). Solución:
        // definir SESSIONS_API_TOKEN en el entorno del backend con el mismo
        // valor que BOT_API_TOKEN del panel (comprobar sin mostrarlo:
        // node scripts/verificarTokenServicio.js).
        console.error(`❌ [AUTH SERVICIO] SESSIONS_API_TOKEN no está configurado en el backend: ${req.method} ${req.originalUrl} responde 503. Defínelo (= BOT_API_TOKEN del panel) y reinicia con --update-env.`);

        return res.status(503).json({
            success: false,
            code: "TOKEN_SERVICIO_NO_CONFIGURADO",
            error: "El backend no tiene configurado el token de servicio."
        });

    }

    const recibido = req.get("x-service-token") || "";

    // Comparación en tiempo constante sobre digests de igual longitud.
    const valido = recibido.length > 0 &&
        crypto.timingSafeEqual(digest(recibido), digest(esperado));

    if (!valido) {

        return res.status(401).json({
            success: false,
            code: "NO_AUTORIZADO",
            error: "Token de servicio ausente o inválido."
        });

    }

    next();

}

module.exports = { exigirTokenServicio };
