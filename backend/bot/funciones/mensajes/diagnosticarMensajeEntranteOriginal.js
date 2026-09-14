// ==========================================================================
// diagnosticarMensajeEntranteOriginal(msg) — DIAGNÓSTICO PURO DE
// OBSERVABILIDAD (2026-09). Muestra en consola EXACTAMENTE lo que
// WhatsApp/Baileys entregó en `msg`, tal cual llegó, ANTES de que
// normalizarMensaje/obtenerUsuario/obtenerContexto/identityScanner/
// resolverIdentidadMensaje o cualquier otra parte del bot lo toque.
// ==========================================================================
// REGLA ABSOLUTA DE ESTE ARCHIVO: NO RESOLVER NADA.
//
//   - NO consulta Supabase.
//   - NO consulta ni importa identityScanner/resolverIdentidadMensaje.
//   - NO convierte un LID en teléfono, ni "hace matemáticas" con el LID.
//   - NO decide cuál es "el" identificador correcto — solo reporta,
//     campo por campo, presente/ausente/vacío, exactamente como llegó.
//   - NO modifica `msg` en ningún momento (ni siquiera para depurar: la
//     sección RAW trabaja sobre una COPIA, ver sanitizarMensajeParaDebug).
//   - NO altera el flujo: nunca lanza, nunca retorna algo que el llamador
//     deba usar — es una función de efecto secundario puro (console.log)
//     protegida por su propio try/catch.
//
// Activado/desactivado con DEBUG_INCOMING_MESSAGES=true — se reutiliza el
// MISMO interruptor único que ya existe (bot/utils/debugIncomingMessages.js,
// auditoría de mensajes entrantes anterior) en vez de crear una segunda
// variable de entorno. Con el flag apagado, esta función retorna de
// inmediato: cero console.log, cero costo de construir el diagnóstico.
// ==========================================================================

const { debugMensajesActivo } = require("../../utils/debugIncomingMessages");
const { obtenerContextInfo } = require("../../utils/obtenerContextInfo");

// ==========================================================================
// Redacción de RAW — nombres de campo (no valores) que, si aparecieran en
// cualquier profundidad del objeto, se reemplazan por "[REDACTED]". `msg`
// (un WAMessage ya decodificado que Baileys entrega a los listeners) NO
// contiene material criptográfico normalmente — las claves viven aparte, en
// el auth state (useMultiFileAuthState), que nunca llega a este objeto —
// pero se redacta de todas formas como defensa en profundidad, por si algún
// campo futuro de Baileys lo incluyera.
// ==========================================================================
const PATRONES_SENSIBLES = [
    "privkey", "private_key",
    "rootkey", "root_key",
    "chainkey", "chain_key",
    "sessionkey", "session_key",
    "identitykey", "identity_key",
    "signedidentitykey", "signedprekey", "prekey",
    "noisekey", "signingkey", "enckey", "mackey",
    "authstate", "auth_state", "creds", "credential",
    "token", "cookie", "password", "secret"
];

function nombreEsSensible(nombreCampo) {

    const normalizado = String(nombreCampo).toLowerCase();

    return PATRONES_SENSIBLES.some((patron) => normalizado.includes(patron));

}

const LIMITE_RAW_CHARS = 4000;

// Copia SEGURA de `msg` para logging — nunca toca el original. Redacta por
// NOMBRE de campo (no adivina por contenido) y resume binarios/Long.js en
// vez de volcarlos completos.
function sanitizarMensajeParaDebug(msg) {

    try {

        const texto = JSON.stringify(msg, function (clave, valor) {

            if (clave && nombreEsSensible(clave)) {
                return "[REDACTED]";
            }

            if (Buffer.isBuffer(valor) || valor instanceof Uint8Array) {
                return `<binario ${valor.length} bytes>`;
            }

            // JSON.stringify llama a .toJSON() de un Buffer ANTES de pasarlo
            // al replacer (lo convierte a {type:"Buffer", data:[...]} por su
            // cuenta) -- para cuando este replacer lo ve, ya no es un Buffer
            // real. Se detecta esa forma también, para no terminar
            // igual volcando el arreglo de bytes completo.
            if (valor && valor.type === "Buffer" && Array.isArray(valor.data)) {
                return `<binario ${valor.data.length} bytes>`;
            }

            if (valor && typeof valor.toNumber === "function" && typeof valor.low === "number") {
                // Long.js (protobuf 64-bit, p. ej. messageTimestamp).
                return valor.toNumber();
            }

            return valor;

        }, 2);

        if (!texto) return "(vacío)";

        return texto.length > LIMITE_RAW_CHARS
            ? `${texto.slice(0, LIMITE_RAW_CHARS)}\n... [truncado, ${texto.length} caracteres totales]`
            : texto;

    } catch (err) {

        return `(no se pudo serializar de forma segura: ${err?.message})`;

    }

}

// ==========================================================================
// Helpers de presencia — NUNCA imprimir "undefined" a secas.
// ==========================================================================
function marcarPresencia(valor) {

    if (valor === undefined || valor === null) return "❌ AUSENTE";
    if (typeof valor === "string" && valor.trim() === "") return "⚠️ PRESENTE PERO VACÍO";

    return `✅ ${valor}`;

}

function siNo(valor) {
    return valor ? "SÍ" : "NO";
}

// ==========================================================================
// Clasificación DIRECTA de un JID por su dominio — NO es el motor de
// identityScanner (clasificarJidEncontrado.js): a propósito es una copia
// mínima, aislada, de una sola regla (endsWith), para que este diagnóstico
// no dependa de (ni se confunda con) el módulo de resolución de identidad.
// Esto es observación, no resolución.
// ==========================================================================
function esPN(jid) {
    return typeof jid === "string" && jid.endsWith("@s.whatsapp.net");
}

function esLID(jid) {
    return typeof jid === "string" && jid.endsWith("@lid");
}

// Revisa los 4 campos de identidad, EN ESTE ORDEN, y devuelve el primero
// que matchea el tipo pedido -- nunca "resuelve" ni combina campos, solo
// reporta cuál de los que llegaron tiene esa forma.
function buscarPrimeraFuente(key, clasificador) {

    const CAMPOS_EN_ORDEN = ["participant", "participantAlt", "remoteJid", "remoteJidAlt"];

    for (const campo of CAMPOS_EN_ORDEN) {

        if (clasificador(key[campo])) return { campo, valor: key[campo] };

    }

    return null;

}

function tipoDeChat(remoteJid) {

    if (!remoteJid) return "DESCONOCIDO";
    if (remoteJid.endsWith("@g.us")) return "GRUPO";
    if (remoteJid === "status@broadcast" || remoteJid.endsWith("@broadcast")) return "BROADCAST";
    if (remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@lid")) return "PRIVADO";

    return "DESCONOCIDO";

}

// ==========================================================================
// diagnosticarMensajeEntranteOriginal(msg) — punto de entrada único.
// ==========================================================================
function diagnosticarMensajeEntranteOriginal(msg) {

    if (!debugMensajesActivo()) return;

    try {

        const key = msg?.key || {};
        const chat = tipoDeChat(key.remoteJid);

        const fuentePN = buscarPrimeraFuente(key, esPN);
        const fuenteLID = buscarPrimeraFuente(key, esLID);

        const contenido = msg?.message || {};
        const clavesMensaje = Object.keys(contenido);
        const tipoPrincipal = clavesMensaje.find((k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage") || clavesMensaje[0] || null;
        const clavesInternas = tipoPrincipal && contenido[tipoPrincipal] && typeof contenido[tipoPrincipal] === "object"
            ? Object.keys(contenido[tipoPrincipal])
            : [];

        const contextInfo = obtenerContextInfo(msg);

        console.log("");
        console.log("============================================================");
        console.log("🔎 DIAGNÓSTICO ORIGINAL — MENSAJE ENTRANTE");
        console.log("============================================================");

        console.log("");
        console.log("🆔 MESSAGE KEY");
        console.log(JSON.stringify({

            id: key.id,
            remoteJid: key.remoteJid,
            fromMe: key.fromMe,
            participant: key.participant,
            participantAlt: key.participantAlt,
            remoteJidAlt: key.remoteJidAlt,
            addressingMode: key.addressingMode

        }, null, 2));

        console.log("");
        console.log("👤 IDENTIDAD");
        console.log("");
        console.log(`remoteJid:\n${marcarPresencia(key.remoteJid)}`);
        console.log("");
        console.log(`remoteJidAlt:\n${marcarPresencia(key.remoteJidAlt)}`);
        console.log("");
        console.log(`participant:\n${marcarPresencia(key.participant)}`);
        console.log("");
        console.log(`participantAlt:\n${marcarPresencia(key.participantAlt)}`);
        console.log("");
        // No existen como tales en la versión de Baileys instalada (verificado
        // contra decode-wa-message.js) -- se leen igual, tal cual, por si
        // algún día aparecen; hoy siempre reportarán AUSENTE, honestamente.
        console.log(`senderPn:\n${marcarPresencia(key.senderPn)}`);
        console.log("");
        console.log(`senderLid:\n${marcarPresencia(key.senderLid)}`);
        console.log("");
        console.log(`addressingMode:\n${marcarPresencia(key.addressingMode)}`);
        console.log("");
        console.log(`pushName:\n${marcarPresencia(msg?.pushName)}`);
        console.log("");
        console.log(`verifiedBizName:\n${marcarPresencia(msg?.verifiedBizName)}`);
        console.log("");
        console.log(`chat type:\n${chat}`);

        console.log("");
        console.log("📱 POSIBLES IDENTIFICADORES");
        console.log("");
        console.log(`PN encontrado:\n${siNo(!!fuentePN)}`);
        console.log("");
        console.log(`LID encontrado:\n${siNo(!!fuenteLID)}`);
        console.log("");
        console.log(`PN:\n${fuentePN ? fuentePN.valor : "(ninguno)"}`);
        console.log("");
        console.log(`LID:\n${fuenteLID ? fuenteLID.valor : "(ninguno)"}`);
        console.log("");
        console.log(`Fuente del PN:\n${fuentePN ? fuentePN.campo : "ninguna"}`);
        console.log("");
        console.log(`Fuente del LID:\n${fuenteLID ? fuenteLID.campo : "ninguna"}`);

        console.log("");
        console.log("💬 MENSAJE");
        console.log("");
        console.log(`Tipo:\n${tipoPrincipal || "(sin contenido / solo protocolo)"}`);
        console.log("");
        console.log(`Texto (conversation):\n${marcarPresencia(contenido.conversation)}`);
        console.log("");
        console.log(`Caption (imageMessage/videoMessage/documentMessage):\n${marcarPresencia(
            contenido.imageMessage?.caption ?? contenido.videoMessage?.caption ?? contenido.documentMessage?.caption
        )}`);
        console.log("");
        console.log(`ContextInfo:\n${siNo(!!contextInfo)}`);
        console.log("");
        console.log(`quotedMessage:\n${siNo(!!contextInfo?.quotedMessage)}`);
        console.log("");
        console.log(`quotedParticipant:\n${marcarPresencia(contextInfo?.participant)}`);
        console.log("");
        console.log(`mentionedJid:\n${contextInfo?.mentionedJid?.length ? JSON.stringify(contextInfo.mentionedJid) : "❌ AUSENTE"}`);
        console.log("");
        console.log(`forwarded (isForwarded):\n${siNo(!!contextInfo?.isForwarded)}`);
        console.log("");
        console.log(`ephemeral (ephemeralMessage):\n${siNo(!!contenido.ephemeralMessage)}`);
        console.log("");
        console.log(`viewOnce (viewOnceMessage/V2/V2Extension):\n${siNo(!!(contenido.viewOnceMessage || contenido.viewOnceMessageV2 || contenido.viewOnceMessageV2Extension))}`);

        console.log("");
        console.log("📦 ESTRUCTURA DEL MENSAJE");
        console.log("");
        console.log("message keys:");
        console.log(JSON.stringify(clavesMensaje, null, 2));

        if (tipoPrincipal && clavesInternas.length) {

            console.log("");
            console.log(`claves internas de "${tipoPrincipal}":`);
            console.log(JSON.stringify(clavesInternas, null, 2));

        }

        if (chat === "GRUPO") {

            console.log("");
            console.log("🏠 GRUPO");
            console.log(`remoteJid: ${marcarPresencia(key.remoteJid)}`);
            console.log("");
            console.log("👤 REMITENTE");
            console.log(`participant: ${marcarPresencia(key.participant)}`);
            console.log("");
            console.log("👤 REMITENTE ALTERNATIVO");
            console.log(`participantAlt: ${marcarPresencia(key.participantAlt)}`);
            console.log("");
            console.log("📱 PN ALTERNATIVO");
            console.log(esPN(key.participantAlt) ? key.participantAlt : "❌ AUSENTE");

        } else {

            console.log("");
            console.log("🏠 CHAT PRIVADO");
            console.log(`remoteJid: ${marcarPresencia(key.remoteJid)}`);
            console.log(`remoteJidAlt: ${marcarPresencia(key.remoteJidAlt)}`);
            console.log(`participant: ${marcarPresencia(key.participant)}`);
            console.log(`participantAlt: ${marcarPresencia(key.participantAlt)}`);
            console.log(`addressingMode: ${marcarPresencia(key.addressingMode)}`);

        }

        console.log("");
        console.log("------------------------------------------------------------");
        console.log("📱 IDENTIDAD RECIBIDA DIRECTAMENTE DE WHATSAPP/BAILEYS");
        console.log("------------------------------------------------------------");
        console.log("");
        console.log(`remoteJid:\n${marcarPresencia(key.remoteJid)}`);
        console.log("");
        console.log(`remoteJidAlt:\n${marcarPresencia(key.remoteJidAlt)}`);
        console.log("");
        console.log(`participant:\n${marcarPresencia(key.participant)}`);
        console.log("");
        console.log(`participantAlt:\n${marcarPresencia(key.participantAlt)}`);
        console.log("");
        console.log(`addressingMode:\n${marcarPresencia(key.addressingMode)}`);
        console.log("");

        if (fuentePN) {

            console.log("PN detectado: ✅ SÍ");
            console.log(`PN: ${fuentePN.valor}`);
            console.log(`Fuente: ${fuentePN.campo}`);

        } else {

            console.log("PN detectado: ❌ NO DISPONIBLE");

        }

        console.log("");

        if (fuenteLID) {

            console.log("LID detectado: ✅ SÍ");
            console.log(`LID: ${fuenteLID.valor}`);
            console.log(`Fuente: ${fuenteLID.campo}`);

        } else {

            console.log("LID detectado: ❌ NO DISPONIBLE");

        }

        console.log("");
        console.log("📦 RAW MESSAGE (SANITIZED)");
        console.log(sanitizarMensajeParaDebug(msg));

        console.log("");
        console.log("============================================================");
        console.log("📊 RESUMEN IDENTIDAD RECIBIDA");
        console.log("============================================================");
        console.log(`Tipo chat: ${chat}`);
        console.log("");
        console.log(`fromMe: ${!!key.fromMe}`);
        console.log("");
        console.log(`remoteJid: ${key.remoteJid ? "✅" : "❌"}`);
        console.log(`remoteJidAlt: ${key.remoteJidAlt ? "✅" : "❌"}`);
        console.log("");
        console.log(`participant: ${key.participant ? "✅" : "❌"}`);
        console.log(`participantAlt: ${key.participantAlt ? "✅" : "❌"}`);
        console.log("");
        console.log(`LID recibido: ${fuenteLID ? "✅" : "❌"}`);
        console.log(`PN recibido: ${fuentePN ? "✅" : "❌"}`);
        console.log("");
        console.log("📱 ¿WhatsApp/Baileys entregó teléfono en este mensaje?");

        if (fuentePN) {

            console.log("✅ SÍ");
            console.log("");
            console.log(`Fuente:\n${fuentePN.campo}`);

        } else {

            console.log("❌ NO");

        }

        console.log("============================================================");
        console.log("");

    } catch (err) {

        // Nunca debe romper el procesamiento real del mensaje -- solo se
        // reporta el fallo del propio diagnóstico y se continúa.
        console.error("❌ [DIAGNÓSTICO ORIGINAL] error generando el diagnóstico (no afecta el procesamiento real):", err?.message);

    }

}

module.exports = {
    diagnosticarMensajeEntranteOriginal,
    sanitizarMensajeParaDebug
};
