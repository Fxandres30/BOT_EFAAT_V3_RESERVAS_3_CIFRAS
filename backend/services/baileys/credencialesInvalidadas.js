// ==========================================================================
// credencialesInvalidadas.js — aparta las credenciales de WhatsApp que
// WhatsApp ya invalidó (401 / loggedOut: dispositivo eliminado desde el
// teléfono, `device_removed`, o logout del propio panel).
//
// Problema: socket.js arranca con auth/<sessionId> si existe. Con
// credenciales ya rechazadas, «Conectar» volvía a intentar con ellas y
// recibía otro 401 en vez de mostrar un QR nuevo: la única salida era
// eliminar la sesión.
//
// Solución: mover la carpeta a auth/_invalidadas/<sessionId>-<fecha>. NO se
// borra nada (se puede revisar o recuperar a mano); el próximo «Conectar»
// arranca sin credenciales y WhatsApp entrega un QR nuevo. Ningún código
// enumera auth/, así que la subcarpeta no se confunde con una sesión.
//
// Nunca lanza, nunca lee ni registra el contenido de las credenciales.
// ==========================================================================

const fs = require("fs");
const path = require("path");

// Misma carpeta que socket.js (useMultiFileAuthState) y
// sessionsAdminController.js.
const AUTH_ROOT = path.resolve(__dirname, "../../auth");
const CARPETA_INVALIDADAS = "_invalidadas";

// Los ids reales de sesión son UUID (sesiones.id). Cualquier otro valor no
// se toca: la ruta nunca sale de auth/<uuid>.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function archivarCredencialesInvalidadas(sessionId, { raiz = AUTH_ROOT, ahora = new Date() } = {}) {

    try {

        if (!UUID.test(String(sessionId || ""))) {
            return { archivada: false, motivo: "ruta_invalida" };
        }

        const carpeta = path.join(raiz, String(sessionId));

        // Defensa en profundidad: la ruta debe quedar exactamente en
        // <raiz>/<sessionId>.
        if (path.relative(raiz, carpeta) !== String(sessionId)) {
            return { archivada: false, motivo: "ruta_invalida" };
        }

        if (!fs.existsSync(carpeta)) {
            return { archivada: false, motivo: "sin_credenciales" };
        }

        const destinoDir = path.join(raiz, CARPETA_INVALIDADAS);

        await fs.promises.mkdir(destinoDir, { recursive: true });

        const destino = path.join(destinoDir, `${sessionId}-${ahora.toISOString().replace(/[:.]/g, "-")}`);

        await fs.promises.rename(carpeta, destino);

        return { archivada: true };

    } catch (err) {

        return { archivada: false, motivo: "error", error: err?.code || err?.message || String(err) };

    }

}

module.exports = {
    archivarCredencialesInvalidadas,
    CARPETA_INVALIDADAS,
    AUTH_ROOT
};
