// ==========================================================================
// resolverIdentidadMensaje(msg) — FUNCIÓN CENTRAL única para resolver la
// identidad del remitente de UN mensaje entrante de Baileys (auditoría de
// mensajes entrantes, 2026-09).
// ==========================================================================
// PURA — no toca Supabase, no crea/actualiza nada. Solo EXTRAE y CLASIFICA
// lo que Baileys ya entregó en `msg`. La persistencia sigue siendo
// exclusivamente responsabilidad de obtenerUsuarioGlobal.js (bot/middleware/
// obtenerUsuario.js la invoca después de llamar a esta función — ver ese
// archivo).
//
// Reutiliza el motor de extracción YA existente del IdentityScanner
// (recorrerObjeto + normalizarCandidatos, vía escanearObjeto) — el mismo
// que ya usan identitySyncMensaje.js y escanerIdentidades.js. NO reimplementa
// ninguna regla de clasificación LID/PN: eso sigue viviendo únicamente en
// identityScanner/clasificarJidEncontrado.js.
//
// CAMPOS REALES DE BAILEYS QUE ESTA FUNCIÓN CONSIDERA (verificado contra
// @whiskeysockets/baileys 7.0.0-rc14 instalado —
// node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.js):
//
//   message.key.remoteJid       -> el CHAT. En privado: el jid propio del
//                                   remitente (PN o LID, según cómo direccione
//                                   WhatsApp esa conversación). En grupo: el
//                                   jid del GRUPO — nunca el de una persona.
//   message.key.remoteJidAlt    -> SOLO se rellena en chats PRIVADOS — el
//                                   otro lado del par PN/LID del MISMO
//                                   remitente que remoteJid (nunca en grupo).
//   message.key.participant     -> SOLO tiene sentido en GRUPOS — el
//                                   remitente real dentro del grupo.
//   message.key.participantAlt  -> SOLO se rellena en GRUPOS — el otro lado
//                                   del par PN/LID del MISMO participant.
//   message.pushName            -> nombre que la propia persona configuró en
//                                   WhatsApp (top-level del mensaje, no de key).
//
//   message.key.senderPn / message.key.senderLid -> NO EXISTEN como tales en
//   esta versión de Baileys (verificado: no aparecen en Message.d.ts ni en
//   decode-wa-message.js). El dato equivalente que WhatsApp sí envía
//   (atributos XML "participant_pn"/"sender_pn" o "participant_lid"/
//   "sender_lid") ya lo resuelve Baileys internamente dentro de
//   participantAlt/remoteJidAlt (ver extractAddressingContext() en ese mismo
//   archivo) — por eso esta función NO los trata como una fuente aparte: ya
//   están cubiertos. Se conservan como `null` en el resultado de diagnóstico
//   para que el log sea honesto sobre qué campos entrega Baileys hoy.
//
// Regla dura de identidad, SIN CAMBIOS respecto al resto del sistema: un
// JID terminado en "@lid" JAMÁS se convierte en teléfono, y viceversa —lo
// decide clasificarJidEncontrado.js con los helpers oficiales de Baileys
// (isLidUser/isPnUser), nunca por posición de campo.
//
// NO INVENTA TELÉFONOS (regla explícita de esta auditoría): si ningún
// candidato de tipo "phone" aparece en todo el mensaje, `telefono` queda
// `null` y `fuenteIdentidad` queda `"unavailable"` — nunca se deriva un
// teléfono a partir de un LID.
// ==========================================================================

// Se requieren las fuentes directas (recorrerObjeto + normalizarCandidatos)
// en vez de "./index" a propósito: index.js también requiere este archivo
// para reexportarlo (ver su cabecera) — requerir "./index" desde aquí
// crearía una dependencia circular (Node devolvería un exports a medio
// construir según el orden de carga, dejando escanearObjeto undefined de
// forma intermitente). recorrerObjeto/normalizarCandidatos no dependen de
// index.js, así que no hay ciclo por este camino.
const { recorrerObjeto } = require("./recorrerObjeto");
const { normalizarCandidatos } = require("./normalizarCandidatos");

function escanearObjeto(objeto, { fuenteBase = "" } = {}) {

    return normalizarCandidatos(recorrerObjeto(objeto, { fuenteBase }));

}

function elegirTelefono(candidatos) {

    const telefonos = candidatos.filter((c) => c.tipo === "phone");

    const valido = telefonos.find((c) => c.valido);
    if (valido) return valido;

    // Ninguno con formato colombiano válido -- se usa el primero tal cual
    // (mismo criterio de permisividad que ya usaba obtenerUsuarioGlobal.js
    // ::normalizarIdentificadoresDesdeJid antes de esta capa: mejor guardar
    // un teléfono con formato inusual que perder la identidad completa).
    return telefonos[0] || null;

}

function resolverIdentidadMensaje(msg) {

    const key = msg?.key || {};

    const chatJid = key.remoteJid || null;
    const participantJid = key.participant || null;

    const esGrupo = !!chatJid && chatJid.endsWith("@g.us");
    const esBroadcast = !!chatJid && (chatJid === "status@broadcast" || chatJid.endsWith("@broadcast"));
    const tipoChat = esGrupo ? "grupo" : esBroadcast ? "broadcast" : chatJid ? "privado" : "desconocido";

    // Recorrido recursivo COMPLETO de `key` -- no asume nombres de campo,
    // encuentra CUALQUIER JID reconocible que Baileys haya puesto ahí hoy
    // (participant, participantAlt, remoteJid, remoteJidAlt...) o que
    // agregue en el futuro, sin tener que tocar este archivo.
    const hallazgo = escanearObjeto({ key }, { fuenteBase: "message" });

    const candidatoTelefono = elegirTelefono(hallazgo.candidatos);
    const lid = hallazgo.lids[0] || null;

    // El JID "principal" del remitente tal cual lo identifica Baileys, ANTES
    // de resolver PN/LID/alt -- en grupo es participant; en privado/otro es
    // el propio chatJid (coincide con el remitente cuando no es un grupo).
    const jid = participantJid || chatJid || null;

    const telefono = candidatoTelefono ? candidatoTelefono.valor : null;
    const fuenteIdentidad = candidatoTelefono ? candidatoTelefono.source : "unavailable";

    let tipoIdentificador = "desconocido";

    if (telefono) tipoIdentificador = "PN";
    else if (lid) tipoIdentificador = "LID";
    else if (jid) tipoIdentificador = "JID";

    if (hallazgo.lids.length > 1) {

        console.warn(`⚠️ [resolverIdentidadMensaje] más de un LID distinto en el mismo mensaje — se usa el primero. Todos: ${hallazgo.lids.join(", ")}`);

    }

    return {

        // Shape pedido en la auditoría (jid/lid/phone/pushName/chatJid/
        // participantJid/isGroup/identitySource) con nombres en español,
        // consistentes con el resto del proyecto (obtenerUsuarioGlobal.js
        // usa `telefono`/`lid`/`nombre`, ctx.chat usa `esGrupo`, etc.):
        jid,
        lid,
        telefono,                 // == "phone" pedido
        pushName: msg?.pushName || null,
        chatJid,
        participantJid,
        esGrupo,                  // == "isGroup" pedido
        fuenteIdentidad,          // == "identitySource" pedido — de dónde salió `telefono`, o "unavailable"

        // Datos adicionales para el log de diagnóstico (sección 2 del pedido):
        esBroadcast,
        tipoChat,
        tipoIdentificador,        // 'PN' | 'LID' | 'JID' | 'desconocido'
        remoteJidAlt: key.remoteJidAlt || null,
        participantAlt: key.participantAlt || null,
        addressingMode: key.addressingMode || null,

        // Campos pedidos explícitamente en el diagnóstico que ESTA versión
        // de Baileys no expone como tales (ver cabecera) -- se dejan en
        // null a propósito, nunca inventados ni mapeados desde otro campo.
        senderPn: key.senderPn || null,
        senderLid: key.senderLid || null,

        // Todos los candidatos crudos encontrados (para el dump de
        // diagnóstico) — nunca se pierde evidencia de qué se encontró y en
        // qué campo, aunque solo uno se haya usado como `telefono`.
        candidatos: hallazgo.candidatos

    };

}

module.exports = { resolverIdentidadMensaje };
