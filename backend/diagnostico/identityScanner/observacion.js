// ==========================================================================
// IDENTITY SCANNER — lógica PURA de observación (sin E/S).
// ==========================================================================
// Construye, a partir de UN mensaje tal cual lo entrega Baileys
// (@whiskeysockets/baileys 7.0.0-rc14), un registro anonimizado de TODO lo
// que trae sobre la identidad del remitente. Solo lee: no modifica el
// mensaje, no consulta Supabase, no crea ni resuelve usuarios — no importa
// nada del sistema de identidad del bot (obtenerUsuarioGlobal, IdentitySync,
// reservas...). Ver scanner.js para la parte con E/S (listener + JSONL).
//
// Campos REALES de esta versión de Baileys (verificados en
// node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.js y
// lib/Types/Message.d.ts):
//   key.remoteJid          chat (privado: remitente; grupo: el grupo)
//   key.remoteJidAlt       SOLO privado: el otro lado PN/LID del remitente
//   key.remoteJidUsername  SOLO privado — AMBIGUO: Baileys lo toma de
//                          peer_recipient_username / recipient_username
//                          (por el nombre, podría ser el DESTINATARIO)
//   key.participant        SOLO grupo/broadcast: remitente real
//   key.participantAlt     SOLO grupo: el otro lado PN/LID del participant
//   key.participantUsername SOLO cuando hay participant
//   key.addressingMode     "lid" | "pn": qué hay en el campo principal
//   msg.pushName, msg.verifiedBizName
//   contextInfo.participant (autor citado — sin campo alterno),
//   contextInfo.mentionedJid
// key.senderPn / key.senderLid NO existen en esta versión: no se leen.
// ==========================================================================

const crypto = require("crypto");

// Dominios de identidad de PERSONA que reconoce Baileys 7 (isPnUser,
// isLidUser, isHostedPnUser, isHostedLidUser).
const DOMINIOS_PN = new Set(["s.whatsapp.net", "hosted"]);
const DOMINIOS_LID = new Set(["lid", "hosted.lid"]);

const CAMPOS_KEY_CONOCIDOS = new Set([
    "remoteJid", "remoteJidAlt", "remoteJidUsername", "fromMe", "id",
    "participant", "participantAlt", "participantUsername", "addressingMode",
    "server_id", "isViewOnce"
]);

// Envoltorios que contienen el mensaje real dentro de `.message`.
const ENVOLTORIOS = [
    "ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2",
    "viewOnceMessageV2Extension", "documentWithCaptionMessage", "editedMessage"
];

// Claves de contenido que NO son el tipo del mensaje.
const AUXILIARES = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);

const TIPOS_CONOCIDOS = new Set([
    "conversation", "extendedTextMessage", "imageMessage", "videoMessage",
    "audioMessage", "documentMessage", "stickerMessage", "reactionMessage",
    "protocolMessage", "contactMessage", "contactsArrayMessage",
    "locationMessage", "liveLocationMessage", "pollCreationMessage",
    "pollCreationMessageV2", "pollCreationMessageV3", "pollUpdateMessage",
    "buttonsResponseMessage", "listResponseMessage",
    "templateButtonReplyMessage", "interactiveResponseMessage", "ptvMessage",
    "groupInviteMessage", "keepInChatMessage", "pinInChatMessage",
    "eventMessage", "albumMessage", "lottieStickerMessage",
    "associatedChildMessage", "requestPhoneNumberMessage"
]);

const PATRON_JID = /^[^@\s]+@[a-z.]+$/i;

// ------------------------------------------------------------------ JIDs ---

function dominioDe(jid) {
    if (typeof jid !== "string" || !jid.includes("@")) return null;
    return jid.slice(jid.indexOf("@") + 1);
}

function clasePersona(jid) {
    const dominio = dominioDe(jid);
    if (DOMINIOS_PN.has(dominio)) return "pn";
    if (DOMINIOS_LID.has(dominio)) return "lid";
    return null;
}

function hmac(sal, valor) {
    return crypto.createHmac("sha256", String(sal)).update(String(valor)).digest("hex").slice(0, 16);
}

// JID -> { dominio, clase, h, dispositivo }. El hash usa el usuario SIN
// sufijo de dispositivo, para que "123:5@lid" y "123@lid" correlacionen.
// Los JID de grupo no son datos personales: se guardan tal cual.
function anonimizarJid(jid, sal) {

    if (typeof jid !== "string" || !jid) return null;

    const dominio = dominioDe(jid);

    if (dominio === "g.us") return { dominio, clase: "grupo", valor: jid };

    const usuario = jid.split("@")[0];
    const sinDispositivo = usuario.split(":")[0];

    return {
        dominio: dominio || "(sin dominio)",
        clase: clasePersona(jid) || "otro",
        h: hmac(sal, `${sinDispositivo}@${dominio}`),
        dispositivo: usuario.includes(":")
    };

}

function anonimizarTexto(valor, sal) {
    if (typeof valor !== "string" || !valor) return { presente: false };
    return { presente: true, h: hmac(sal, valor), longitud: valor.length };
}

// ------------------------------------------------------------ contenido ---

// Desenvuelve ephemeral/viewOnce/documentWithCaption/edited y devuelve el
// contenido real + la lista de envoltorios atravesados.
function desenvolver(message) {

    const envoltorios = [];
    let contenido = message || null;

    for (let i = 0; i < 6 && contenido; i++) {
        const envoltorio = ENVOLTORIOS.find((e) => contenido[e]);
        if (!envoltorio) break;
        envoltorios.push(envoltorio);
        contenido = contenido[envoltorio]?.message || null;
    }

    // Edición en Baileys 7: protocolMessage { type, editedMessage }.
    if (contenido?.protocolMessage?.editedMessage) {
        envoltorios.push("protocolMessage.editedMessage");
        contenido = contenido.protocolMessage.editedMessage;
    }

    return { contenido, envoltorios };

}

function tipoDeContenido(contenido) {
    const claves = Object.keys(contenido || {}).filter((k) => !AUXILIARES.has(k) && contenido[k] != null);
    return claves[0] || null;
}

// contextInfo de CUALQUIER tipo de contenido (incluye audio, que el
// obtenerContextInfo del bot no cubre).
function buscarContextInfo(contenido) {
    for (const valor of Object.values(contenido || {})) {
        if (valor && typeof valor === "object" && valor.contextInfo) return valor.contextInfo;
    }
    return null;
}

// --------------------------------------------------------------- remitente ---

function tipoChatDe(remoteJid) {
    const dominio = dominioDe(remoteJid);
    if (dominio === "g.us") return "grupo";
    if (remoteJid === "status@broadcast") return "estado";
    if (dominio === "broadcast") return "broadcast";
    if (dominio === "newsletter") return "newsletter";
    if (DOMINIOS_PN.has(dominio) || DOMINIOS_LID.has(dominio)) return "privado";
    return "desconocido";
}

// JIDs crudos del remitente (principal + alterno) — se usan SOLO en memoria
// para consultar lidMapping; nunca se escriben tal cual.
function jidsRemitente(msg) {

    const key = msg?.key || {};
    const conParticipante = !!key.participant;

    return {
        principal: (conParticipante ? key.participant : key.remoteJid) || null,
        alterno: (conParticipante ? key.participantAlt : key.remoteJidAlt) || null
    };

}

// Lo que el scanner puede afirmar con los datos del propio mensaje.
function casoIdentidad({ principal, alterno }) {
    const clases = [principal, alterno].map(clasePersona);
    const pn = clases.includes("pn");
    const lid = clases.includes("lid");
    if (pn && lid) return "PN+LID";
    if (lid) return "SOLO_LID";
    if (pn) return "SOLO_PN";
    return "NINGUNO";
}

// ---------------------------------------------------------- observación ---

function construirObservacion(msg, { sal, sessionId = null, upsertType = null, requestId = null, ahora = new Date() } = {}) {

    const key = msg?.key || {};
    const { contenido, envoltorios } = desenvolver(msg?.message);
    const tipoMensaje = tipoDeContenido(contenido);
    const contextInfo = buscarContextInfo(contenido);
    const remitente = jidsRemitente(msg);
    const tipoChat = tipoChatDe(key.remoteJid);

    const camposKeyDesconocidos = Object.keys(key).filter((k) => !CAMPOS_KEY_CONOCIDOS.has(k));
    const tiposDesconocidos = Object.keys(contenido || {}).filter((k) => !AUXILIARES.has(k) && !TIPOS_CONOCIDOS.has(k));

    return {
        ts: ahora.toISOString(),
        sessionId,
        upsertType,
        requestId: requestId ? true : false,
        mensajeId: key.id ? hmac(sal, key.id) : null,
        fromMe: !!key.fromMe,
        tipoChat,
        tipoMensaje,
        envoltorios,
        clave: {
            remoteJid: anonimizarJid(key.remoteJid, sal),
            remoteJidAlt: anonimizarJid(key.remoteJidAlt, sal),
            remoteJidUsername: anonimizarTexto(key.remoteJidUsername, sal),
            participant: anonimizarJid(key.participant, sal),
            participantAlt: anonimizarJid(key.participantAlt, sal),
            participantUsername: anonimizarTexto(key.participantUsername, sal),
            addressingMode: key.addressingMode || null
        },
        remitente: {
            principal: anonimizarJid(remitente.principal, sal),
            alterno: anonimizarJid(remitente.alterno, sal),
            // en privado el username viene de remoteJidUsername (AMBIGUO,
            // ver cabecera); en grupo, de participantUsername
            username: anonimizarTexto(key.participant ? key.participantUsername : key.remoteJidUsername, sal),
            usernameFuente: key.participant ? "participantUsername" : "remoteJidUsername (AMBIGUO)",
            caso: casoIdentidad(remitente)
        },
        pushName: anonimizarTexto(msg?.pushName, sal),
        verifiedBizName: anonimizarTexto(msg?.verifiedBizName, sal),
        citado: contextInfo ? {
            participant: anonimizarJid(contextInfo.participant, sal),
            mencionados: (contextInfo.mentionedJid || []).map((j) => anonimizarJid(j, sal)),
            conMensajeCitado: !!contextInfo.quotedMessage
        } : null,
        desconocidos: {
            camposKey: camposKeyDesconocidos,
            tiposMensaje: tiposDesconocidos
        }
    };

}

// ------------------------------------------------------------------- RAW ---

// Nombres de campo que nunca se vuelcan (material criptográfico, medios,
// URLs firmadas, miniaturas).
const RAW_OMITIR = new Set([
    "mediaKey", "fileSha256", "fileEncSha256", "directPath", "url",
    "jpegThumbnail", "thumbnailDirectPath", "thumbnailSha256",
    "thumbnailEncSha256", "streamingSidecar", "waveform", "messageSecret",
    "midQualityFileSha256", "midQualityFileEncSha256", "scansSidecar",
    "pngThumbnail", "staticUrl", "encPayload", "encIv", "axolotlSenderKeyDistributionMessage"
]);

// Texto de usuario: solo se conserva su longitud.
const RAW_TEXTO = new Set(["conversation", "text", "caption", "title", "description", "body", "selectedDisplayText", "name", "displayName", "vcard", "contentText", "footerText"]);

// Copia saneada para depurar estructuras desconocidas: JIDs y pushName
// anonimizados, texto reducido a su longitud, binarios y claves omitidos.
function sanearRaw(valor, sal, nombre = "", profundidad = 0) {

    if (profundidad > 12) return "[profundidad máxima]";
    if (valor == null) return valor;

    if (RAW_OMITIR.has(nombre)) return "[omitido]";

    if (Buffer.isBuffer(valor) || valor instanceof Uint8Array) return `[bytes ${valor.length}]`;

    if (typeof valor?.toNumber === "function" && typeof valor?.low === "number") return valor.toNumber();

    if (typeof valor === "string") {
        if (RAW_TEXTO.has(nombre)) return `[texto ${valor.length}]`;
        if (nombre === "pushName" || nombre === "verifiedBizName" || /username/i.test(nombre)) return anonimizarTexto(valor, sal);
        if (PATRON_JID.test(valor)) return anonimizarJid(valor, sal);
        if (nombre === "id" || nombre === "stanzaId") return hmac(sal, valor);
        return valor.length > 200 ? `[texto ${valor.length}]` : valor;
    }

    if (Array.isArray(valor)) return valor.map((v) => sanearRaw(v, sal, nombre, profundidad + 1));

    if (typeof valor === "object") {
        const copia = {};
        for (const [k, v] of Object.entries(valor)) copia[k] = sanearRaw(v, sal, k, profundidad + 1);
        return copia;
    }

    return valor;

}

module.exports = {
    construirObservacion,
    jidsRemitente,
    anonimizarJid,
    anonimizarTexto,
    clasePersona,
    desenvolver,
    sanearRaw,
    hmac
};
