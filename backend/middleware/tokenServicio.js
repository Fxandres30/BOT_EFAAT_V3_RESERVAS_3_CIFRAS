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
// Si SESSIONS_API_TOKEN falta, se usa el BOT_API_TOKEN del panel desplegado
// en la MISMA máquina (carpeta ../frontend del repositorio): es el mismo
// secreto compartido y así no hay que copiarlo a mano.
//
// Falla cerrado: si no hay token en ningún lado, responde 503 en vez de
// quedar abierto. Nunca se loguea el token.
// ==========================================================================

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ARCHIVOS_PANEL = [".env.production.local", ".env.local", ".env.production", ".env"];
let dirPanel = path.join(__dirname, "..", "..", "frontend");

let descubierto;   // undefined = sin buscar; null = no encontrado

function digest(valor) {

    return crypto.createHash("sha256").update(String(valor)).digest();

}

// BOT_API_TOKEN del archivo de entorno del panel, o null.
function tokenDelPanel(dir = dirPanel) {

    for (const nombre of ARCHIVOS_PANEL) {

        let texto;
        try { texto = fs.readFileSync(path.join(dir, nombre), "utf8"); } catch { continue; }

        const m = texto.match(/^\s*BOT_API_TOKEN\s*=\s*(.+?)\s*$/m);
        const valor = m ? m[1].replace(/^(['"])(.*)\1$/, "$2") : "";

        if (valor) return { valor, origen: `frontend/${nombre}` };

    }

    return null;

}

function tokenEsperado() {

    if (process.env.SESSIONS_API_TOKEN) return process.env.SESSIONS_API_TOKEN;

    if (descubierto === undefined) {
        const t = tokenDelPanel();
        descubierto = t ? t.valor : null;
        if (t) console.warn(`⚠️ [AUTH SERVICIO] SESSIONS_API_TOKEN no está en el entorno del backend: se usa BOT_API_TOKEN de ${t.origen} (mismo servidor). Recomendado: definirlo también en backend/.env.`);
    }

    return descubierto;

}

function exigirTokenServicio(req, res, next) {

    const esperado = tokenEsperado();

    if (!esperado) {

        // Afecta a TODAS las rutas que usan este middleware (/sessions,
        // /sorteos, /contactos, /bloqueados, /tablas/compartir).
        console.error(`❌ [AUTH SERVICIO] Sin token de servicio: ni SESSIONS_API_TOKEN en el backend ni BOT_API_TOKEN en el panel de este servidor. ${req.method} ${req.originalUrl} responde 503. Ver docs/activacion/TOKEN_SERVICIO.md.`);

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

        // Nunca se loguea el token: solo si llegó o no.
        console.warn(`⚠️ [AUTH SERVICIO] ${req.method} ${req.originalUrl} → 401: token de servicio ${recibido ? "distinto al del backend" : "ausente"}.`);

        return res.status(401).json({
            success: false,
            code: "NO_AUTORIZADO",
            error: "Token de servicio ausente o inválido."
        });

    }

    next();

}

// Pruebas: otra carpeta de panel y volver a buscar en la próxima petición.
function _configurarPrueba({ dir } = {}) {
    if (dir) dirPanel = dir;
    descubierto = undefined;
}

module.exports = { exigirTokenServicio, tokenDelPanel, _configurarPrueba };
