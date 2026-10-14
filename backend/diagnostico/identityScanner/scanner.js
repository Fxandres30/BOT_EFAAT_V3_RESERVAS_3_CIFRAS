// ==========================================================================
// IDENTITY SCANNER ÚNICO — observador PASIVO del tráfico real de Baileys.
// ==========================================================================
// Sustituye al antiguo proyecto separado BOT_Escaner_1.0 (otra sesión de
// WhatsApp que ESCRIBÍA en la tabla "usuarios"). Este scanner, en cambio:
//
//   - usa los MISMOS sockets del bot (ninguna sesión ni proceso nuevo);
//   - SOLO observa: nunca crea/actualiza usuarios, reservas ni pagos, nunca
//     toca Supabase, nunca modifica el mensaje ni el flujo del bot;
//   - escribe únicamente JSONL en backend/reportes_identidad/ (ignorado por
//     git), con los identificadores ANONIMIZADOS (HMAC con sal local);
//   - consulta lidMapping SOLO con getPNForLID (lectura de caché/almacén
//     local). getLIDForPN NO se usa: en Baileys 7.0.0-rc14, ante una caché
//     vacía hace una consulta USync a WhatsApp y ESCRIBE el resultado en la
//     sesión (lib/Signal/lid-mapping.js) — no es de solo lectura.
//
// Activación: IDENTITY_SCANNER=true (si no, no registra ningún listener).
// RAW:        IDENTITY_SCANNER_RAW=true agrega una copia SANEADA del mensaje.
// Sal:        IDENTITY_SCANNER_SALT o, si no existe, una sal aleatoria
//             persistida en reportes_identidad/.identity_scanner_salt (así
//             el mismo identificador da el mismo hash entre reinicios).
// ==========================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { construirObservacion, jidsRemitente, clasePersona, anonimizarJid, sanearRaw } = require("./observacion");

// IDENTITY_SCANNER_DIR solo para pruebas; por defecto reportes_identidad/.
function directorio() {
    return process.env.IDENTITY_SCANNER_DIR || path.resolve(__dirname, "../../reportes_identidad");
}
const TIEMPO_MAX_MAPPING_MS = 1500;

function activo() {
    return process.env.IDENTITY_SCANNER === "true";
}

function rawActivo() {
    return process.env.IDENTITY_SCANNER_RAW === "true";
}

let sal = null;

function obtenerSal() {

    if (sal) return sal;

    if (process.env.IDENTITY_SCANNER_SALT) {
        sal = process.env.IDENTITY_SCANNER_SALT;
        return sal;
    }

    const archivo = path.join(directorio(), ".identity_scanner_salt");

    try {
        sal = fs.readFileSync(archivo, "utf8").trim();
    } catch (_) {
        sal = crypto.randomBytes(32).toString("hex");
        fs.mkdirSync(directorio(), { recursive: true });
        fs.writeFileSync(archivo, sal, { mode: 0o600 });
    }

    return sal;

}

function archivoDelDia(ahora) {
    return path.join(directorio(), `identity_scanner_${ahora.toISOString().slice(0, 10)}.jsonl`);
}

// Solo lectura: getPNForLID (caché + almacén local de la sesión).
async function consultarMapping(sock, jidsCrudos, salActual) {

    const store = sock?.signalRepository?.lidMapping;

    const resultado = {
        disponible: !!(store && typeof store.getPNForLID === "function"),
        pnParaLid: [],
        lidParaPn: "no consultado — getLIDForPN hace USync a WhatsApp y escribe en la sesión (no es de solo lectura)"
    };

    if (!resultado.disponible) return resultado;

    for (const lid of jidsCrudos.filter((j) => clasePersona(j) === "lid")) {

        try {

            const pn = await Promise.race([
                store.getPNForLID(lid),
                new Promise((resolver) => setTimeout(() => resolver("__timeout__"), TIEMPO_MAX_MAPPING_MS))
            ]);

            resultado.pnParaLid.push({
                lid: anonimizarJid(lid, salActual),
                pn: pn === "__timeout__" ? "timeout" : anonimizarJid(pn, salActual)
            });

        } catch (err) {

            resultado.pnParaLid.push({ lid: anonimizarJid(lid, salActual), pn: "error", motivo: err?.message || String(err) });

        }

    }

    return resultado;

}

async function escribir(registro, ahora) {

    await fs.promises.mkdir(directorio(), { recursive: true });

    await fs.promises.appendFile(archivoDelDia(ahora), JSON.stringify(registro) + "\n");

}

async function observarMensaje(sock, sessionId, msg, { type, requestId }) {

    const ahora = new Date();
    const salActual = obtenerSal();

    const registro = construirObservacion(msg, { sal: salActual, sessionId, upsertType: type, requestId, ahora });

    const { principal, alterno } = jidsRemitente(msg);
    registro.lidMapping = await consultarMapping(sock, [principal, alterno].filter(Boolean), salActual);

    if (rawActivo()) {
        registro.raw = sanearRaw(msg, salActual);
    }

    await escribir(registro, ahora);

}

const observados = new WeakSet();

// Se llama UNA vez por socket, al crearlo (services/baileys/socket.js).
// Desactivado -> no registra nada.
function observarSocket(sock, sessionId) {

    if (!activo() || !sock?.ev || observados.has(sock)) return;

    observados.add(sock);

    sock.ev.on("messages.upsert", ({ messages, type, requestId } = {}) => {

        for (const msg of messages || []) {

            observarMensaje(sock, sessionId, msg, { type, requestId }).catch((err) => {
                console.error("⚠️ [IDENTITY SCANNER] no se pudo registrar una observación (ignorado):", err?.message);
            });

        }

    });

    console.log(`🔬 [IDENTITY SCANNER] observando sesión ${sessionId}${rawActivo() ? " (RAW activo)" : ""} → ${directorio()}`);

}

module.exports = {
    activo,
    observarSocket,
    // para pruebas
    _consultarMapping: consultarMapping,
    _observarMensaje: observarMensaje
};
