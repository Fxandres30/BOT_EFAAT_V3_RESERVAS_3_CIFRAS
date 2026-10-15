// ==========================================================================
// reconciliarApertura.js — reintento de apertura de UN grupo de WhatsApp
// para la reconciliación del worker de eventos (eventos con abierto=false).
//
// Problema que corrige: si WhatsApp rechazaba la apertura con
// "not-authorized", el evento seguía con abierto=false y el worker volvía a
// llamar a groupSettingUpdate cada 30 s hasta la hora de cierre, aunque el
// grupo ya estuviera abierto o el bot no tuviera permisos.
//
// Política:
//   - Apertura confirmada                  -> "abierto" (como siempre).
//   - Rechazo de permisos (not-authorized / forbidden): se consulta el
//     estado REAL con groupMetadata (misma cola IQ, mismo timeout):
//       · announce === false (abierto)     -> "ya_abierto": el llamador
//         sincroniza abierto=true sin más llamadas.
//       · cerrado o estado no confirmado   -> espera creciente por grupo
//         (1, 2, 4, 8 min… tope 15 min) y un diagnóstico claro. NUNCA se
//         bloquea para siempre: al vencer la espera se vuelve a intentar,
//         así que si alguien da permisos al bot el grupo se abre solo.
//       · error de groupMetadata           -> no se asume nada: no se toca
//         el estado del evento, se aplica la misma espera.
//   - rate-overlimit u otro error          -> "fallido" sin espera nueva:
//     el próximo ciclo reintenta, exactamente como antes.
//   - Un grupo con una operación en curso no recibe una segunda ("en_curso").
//
// El estado es de este proceso (en memoria): tras un reinicio el primer
// ciclo vuelve a intentar una vez y recupera la espera si sigue fallando.
// ==========================================================================

const { groupMetadata } = require("../../../../services/baileys/groupQueue");
const { abrirGrupoDetallado } = require("./abrirGrupo");

const ESPERA_BASE_MS = 60 * 1000;
const ESPERA_MAXIMA_MS = 15 * 60 * 1000;

// grupoId -> { intentos, siguienteIntentoEn, motivo }
const esperas = new Map();
// grupoId en vuelo (evita dos aperturas simultáneas del mismo grupo).
const enCurso = new Set();

function esRechazoDePermisos(error) {

    if (!error) return false;

    const codigo = error.data ?? error.output?.statusCode;
    if (codigo === 401 || codigo === 403) return true;

    const texto = String(error.message || "").toLowerCase();

    return texto.includes("not-authorized") || texto.includes("forbidden");

}

// "1203…@g.us" -> nunca el JID completo en el log.
function grupoCorto(grupoId) {
    return String(grupoId || "").replace(/^(\d{4})\d+/, "$1…");
}

function usuarioDeJid(jid) {
    return String(jid || "").split("@")[0].split(":")[0];
}

// true / false si el bot aparece entre los participantes; null si no se
// puede saber (cuenta del bot desconocida o ausente de la lista).
function botEsAdministrador(sock, metadata) {

    const propios = new Set([sock?.user?.id, sock?.user?.lid, sock?.user?.phoneNumber]
        .filter(Boolean)
        .map(usuarioDeJid));

    if (!propios.size || !Array.isArray(metadata?.participants)) return null;

    const bot = metadata.participants.find(p =>
        [p.id, p.lid, p.phoneNumber].filter(Boolean).some(j => propios.has(usuarioDeJid(j)))
    );

    if (!bot) return null;

    return bot.admin === "admin" || bot.admin === "superadmin";

}

async function consultarEstadoGrupo(sock, grupoId) {

    try {

        const metadata = await groupMetadata(sock, grupoId);

        return {
            ok: true,
            announce: typeof metadata?.announce === "boolean" ? metadata.announce : null,
            botAdmin: botEsAdministrador(sock, metadata)
        };

    } catch (error) {

        return { ok: false, error: error?.message || String(error) };

    }

}

function esperaRestante(grupoId, ahora = Date.now()) {

    const e = esperas.get(grupoId);

    return e ? Math.max(0, e.siguienteIntentoEn - ahora) : 0;

}

function registrarEspera(grupoId, motivo, ahora = Date.now()) {

    const intentos = (esperas.get(grupoId)?.intentos || 0) + 1;
    const espera = Math.min(ESPERA_BASE_MS * 2 ** (intentos - 1), ESPERA_MAXIMA_MS);

    esperas.set(grupoId, { intentos, siguienteIntentoEn: ahora + espera, motivo });

    return espera;

}

async function reconciliarAperturaGrupo({ sock, grupoId, ahora = Date.now() }) {

    if (enCurso.has(grupoId)) return { resultado: "en_curso" };

    const espera = esperaRestante(grupoId, ahora);

    if (espera > 0) return { resultado: "en_espera", esperaMs: espera, motivo: esperas.get(grupoId).motivo };

    enCurso.add(grupoId);

    try {

        const apertura = await abrirGrupoDetallado({ sock, grupoId });

        if (apertura.ok) {
            esperas.delete(grupoId);
            return { resultado: "abierto" };
        }

        if (!esRechazoDePermisos(apertura.error)) {
            // rate-overlimit (reintentos de la cola agotados), socket no
            // vigente, timeout…: el próximo ciclo reintenta, como siempre.
            return { resultado: "fallido", error: apertura.error?.message || String(apertura.error) };
        }

        const estado = await consultarEstadoGrupo(sock, grupoId);

        if (estado.ok && estado.announce === false) {
            esperas.delete(grupoId);
            console.log(`🔓 [APERTURA] Grupo ${grupoCorto(grupoId)}: WhatsApp rechazó la apertura (${apertura.error?.message}), pero groupMetadata confirma que el grupo YA está abierto — se sincroniza el evento sin volver a intentarlo.`);
            return { resultado: "ya_abierto" };
        }

        let diagnostico;

        if (!estado.ok) {
            diagnostico = `no se pudo consultar el estado real del grupo (${estado.error}); no se asume nada y el evento no se modifica`;
        } else if (estado.announce === true && estado.botAdmin === false) {
            diagnostico = "groupMetadata confirma que el grupo está cerrado y que la cuenta del bot NO es administradora";
        } else if (estado.announce === true && estado.botAdmin === true) {
            diagnostico = "groupMetadata indica que el grupo está cerrado y que la cuenta del bot SÍ es administradora; WhatsApp rechazó igualmente la apertura";
        } else {
            diagnostico = `estado real no confirmado (announce=${estado.announce}, bot administrador=${estado.botAdmin ?? "desconocido"})`;
        }

        const ms = registrarEspera(grupoId, diagnostico, ahora);
        const intentos = esperas.get(grupoId).intentos;

        console.warn(`⛔ [APERTURA] Grupo ${grupoCorto(grupoId)}: WhatsApp rechazó la apertura (${apertura.error?.message}). ${diagnostico}. Intento ${intentos}; el próximo será en ${Math.round(ms / 1000)} s (no cada 30 s).`);

        return { resultado: "sin_permisos", diagnostico, esperaMs: ms, estado };

    } finally {

        enCurso.delete(grupoId);

    }

}

function _reiniciar() {
    esperas.clear();
    enCurso.clear();
}

module.exports = {
    reconciliarAperturaGrupo,
    consultarEstadoGrupo,
    esRechazoDePermisos,
    botEsAdministrador,
    esperaRestante,
    _reiniciar
};
