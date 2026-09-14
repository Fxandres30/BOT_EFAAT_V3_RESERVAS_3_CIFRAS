// ==========================================================================
// Diagnóstico de mensajes entrantes (auditoría 2026-09) — SOLO logs
// internos. Nunca envía nada a WhatsApp, nunca expone datos a un usuario,
// nunca cambia el resultado del procesamiento del mensaje (ver regla de
// privacidad/seguridad de la auditoría).
// ==========================================================================
// Activado/desactivado con DEBUG_INCOMING_MESSAGES=true (ver
// bot/utils/debugIncomingMessages.js — único punto de lectura de esa
// variable). Con el flag apagado (por defecto), estas funciones no hacen
// absolutamente nada: ni un console.log, ni el costo de construir el objeto
// de diagnóstico — para no llenar producción de dumps permanentemente.
//
// Todo el archivo está pensado para NUNCA poder romper el procesamiento
// real de un mensaje: cada función envuelve su propio trabajo en try/catch
// y, ante cualquier fallo (p. ej. un campo inesperado, un Buffer raro),
// solo loguea el error del propio diagnóstico y sigue.
// ==========================================================================

const { debugMensajesActivo } = require("../../utils/debugIncomingMessages");
const normalizarMensaje = require("../../middleware/normalizarMensaje");
const { resolverIdentidadMensaje } = require("../usuarios/identityScanner/resolverIdentidadMensaje");

// Tamaño máximo del dump RAW (caracteres) — un mensaje con media puede traer
// miniaturas/Buffers grandes; se trunca para no inundar los logs aunque el
// diagnóstico esté activo.
const LIMITE_RAW_CHARS = 4000;

// Serializa cualquier objeto de Baileys de forma seguridad: Buffers/
// Uint8Array se resumen (nunca se vuelcan bytes completos), objetos tipo
// Long (protobuf de 64 bits, p. ej. messageTimestamp/fileLength) se
// convierten a número/string, y cualquier error de serialización se
// contiene sin romper el log.
function serializarRawSeguro(valor) {

    try {

        const texto = JSON.stringify(valor, (_clave, val) => {

            if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
                return `<binario ${val.length} bytes>`;
            }

            if (val && typeof val.toNumber === "function" && typeof val.low === "number") {
                // Long.js (protobuf 64-bit) -- mismo duck-typing que ya usa
                // guardarMensajeGrupo.js con messageTimestamp/fileLength.
                return val.toNumber();
            }

            return val;

        }, 2);

        if (!texto) return "(vacío)";

        return texto.length > LIMITE_RAW_CHARS
            ? `${texto.slice(0, LIMITE_RAW_CHARS)}\n... [truncado, ${texto.length} caracteres totales]`
            : texto;

    } catch (err) {

        return `(no se pudo serializar el RAW: ${err?.message})`;

    }

}

// ==========================================================================
// logMensajeEntrante(message, chat) — bloque "=== MENSAJE ENTRANTE ===".
// `chat` es el resultado YA calculado de obtenerChat.js (no se recalcula
// aquí, se reutiliza).
// ==========================================================================
function logMensajeEntrante(message, chat) {

    if (!debugMensajesActivo()) return;

    try {

        const key = message?.key || {};

        const contenido = normalizarMensaje.obtenerContenido(message?.message) || {};
        const tipoMensaje = Object.keys(contenido)[0] || "(sin contenido / solo protocolo)";

        const resultadoTexto = normalizarMensaje(message);

        const tipoChat =
            !key.remoteJid ? "otro" :
            key.remoteJid.endsWith("@g.us") ? "grupo" :
            key.remoteJid === "status@broadcast" || key.remoteJid.endsWith("@broadcast") ? "broadcast" :
            (key.remoteJid.endsWith("@s.whatsapp.net") || key.remoteJid.endsWith("@lid")) ? "privado" :
            "otro";

        console.log([

            "",
            "=== MENSAJE ENTRANTE ===",
            `Fecha/hora: ${new Date().toISOString()}`,
            `message.id: ${key.id || "(sin id)"}`,
            `message.key.remoteJid: ${key.remoteJid || "(ninguno)"}`,
            `message.key.fromMe: ${!!key.fromMe}`,
            `message.key.participant: ${key.participant || "(ninguno — normal en privado)"}`,
            `message.key.senderPn: ${key.senderPn ?? "(no existe este campo en esta versión de Baileys)"}`,
            `message.key.senderLid: ${key.senderLid ?? "(no existe este campo en esta versión de Baileys)"}`,
            `message.key.remoteJidAlt: ${key.remoteJidAlt || "(ninguno)"}`,
            `message.key.participantAlt: ${key.participantAlt || "(ninguno)"}`,
            `message.pushName: ${message?.pushName || "(ninguno)"}`,
            "",
            `Tipo de chat: ${tipoChat}`,
            `Tipo de mensaje (Baileys): ${tipoMensaje}`,
            `Texto detectado: ${resultadoTexto.textoOriginal ? JSON.stringify(resultadoTexto.textoOriginal) : "(sin texto)"}`,
            "",
            chat?.esGrupo
                ? [
                    "Identificadores (grupo):",
                    `  remoteJid (grupo): ${key.remoteJid}`,
                    `  participant: ${key.participant || "(ninguno)"}`,
                    `  participantAlt: ${key.participantAlt || "(ninguno)"}`,
                    `  addressingMode: ${key.addressingMode || "(desconocido)"}`
                  ].join("\n")
                : [
                    "Identificadores (privado):",
                    `  remoteJid: ${key.remoteJid || "(ninguno)"}`,
                    `  remoteJidAlt: ${key.remoteJidAlt || "(ninguno)"}`,
                    `  addressingMode: ${key.addressingMode || "(desconocido)"}`
                  ].join("\n"),
            "=========================",
            ""

        ].join("\n"));

    } catch (err) {

        console.error("❌ [DIAGNÓSTICO MENSAJE ENTRANTE] error generando el log (no afecta el procesamiento real):", err?.message);

    }

}

// ==========================================================================
// logDumpRaw(message) — dump RAW completo, SOLO cuando el diagnóstico está
// activo. Separado de logMensajeEntrante() a propósito: el resumen de
// arriba es siempre legible; el RAW es deliberadamente más pesado y solo
// tiene sentido para investigar un campo puntual.
// ==========================================================================
function logDumpRaw(message) {

    if (!debugMensajesActivo()) return;

    try {

        console.log("--- RAW (message.key) ---");
        console.log(serializarRawSeguro(message?.key));

        console.log("--- RAW (message.message, tipo de contenido) ---");
        console.log(serializarRawSeguro(message?.message));

    } catch (err) {

        console.error("❌ [DIAGNÓSTICO MENSAJE ENTRANTE] error generando el dump RAW (no afecta el procesamiento real):", err?.message);

    }

}

// ==========================================================================
// logIdentidadResuelta(identidad) — bloque "=== IDENTIDAD RESUELTA ===",
// a partir del resultado de resolverIdentidadMensaje().
// ==========================================================================
function logIdentidadResuelta(identidad) {

    if (!debugMensajesActivo()) return;

    try {

        console.log([

            "=== IDENTIDAD RESUELTA ===",
            `jid: ${identidad.jid || "(ninguno)"}`,
            `lid: ${identidad.lid || "(ninguno)"}`,
            `phone (telefono): ${identidad.telefono || "null"}`,
            `pushName: ${identidad.pushName || "(ninguno)"}`,
            `chatJid: ${identidad.chatJid || "(ninguno)"}`,
            `participantJid: ${identidad.participantJid || "(ninguno — privado)"}`,
            `isGroup (esGrupo): ${identidad.esGrupo}`,
            `identitySource (fuenteIdentidad): ${identidad.fuenteIdentidad}`,
            `tipoIdentificador: ${identidad.tipoIdentificador}`,
            "==========================="

        ].join("\n"));

    } catch (err) {

        console.error("❌ [DIAGNÓSTICO IDENTIDAD] error generando el log (no afecta el procesamiento real):", err?.message);

    }

}

// ==========================================================================
// logPersistencia({ antes, despues, accion }) — bloque "=== PERSISTENCIA
// ===". `antes`/`despues` son filas de "usuarios" (o null) — nunca se
// vuelve a consultar Supabase aquí, se reciben ya resueltas por el llamador
// (obtenerUsuario.js), que es quien de verdad sabe el estado real.
// ==========================================================================
function logPersistencia({ antes, despues, accion }) {

    if (!debugMensajesActivo()) return;

    try {

        console.log([

            "=== PERSISTENCIA ===",
            `usuario encontrado: ${antes ? "sí" : "no"}`,
            `usuario_id: ${despues?.id || antes?.id || "(ninguno)"}`,
            `teléfono anterior: ${antes?.telefono || "null"}`,
            `teléfono nuevo: ${despues?.telefono || "null"}`,
            `jid anterior: ${antes?.lid || antes?.telefono || "null"}`,
            `jid nuevo: ${despues?.lid || despues?.telefono || "null"}`,
            `lid anterior: ${antes?.lid || "null"}`,
            `lid nuevo: ${despues?.lid || "null"}`,
            "",
            `acción: ${accion}`,
            "====================="

        ].join("\n"));

    } catch (err) {

        console.error("❌ [DIAGNÓSTICO PERSISTENCIA] error generando el log (no afecta el procesamiento real):", err?.message);

    }

}

// ==========================================================================
// logErrorPersistencia({ tabla, campo, error }) — "ERROR DE PERSISTENCIA".
// Se llama SIEMPRE (no depende del flag de debug) — un error real de
// escritura en Supabase debe quedar visible en logs normales, no solo en
// modo diagnóstico. El detalle EXTRA (candidatos crudos, dump) sí queda
// reservado al modo debug.
// ==========================================================================
function logErrorPersistencia({ tabla, campo, error }) {

    console.error([

        "🚨 ERROR DE PERSISTENCIA",
        `tabla: ${tabla || "(desconocida)"}`,
        `campo: ${campo || "(desconocido)"}`,
        `error: ${error?.message || error || "(sin mensaje)"}`,
        `stack: ${error?.stack || "(sin stack)"}`

    ].join("\n"));

}

module.exports = {
    logMensajeEntrante,
    logDumpRaw,
    logIdentidadResuelta,
    logPersistencia,
    logErrorPersistencia
};
