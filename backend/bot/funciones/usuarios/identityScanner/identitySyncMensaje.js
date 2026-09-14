// ==========================================================================
// IdentitySync — escaneo EN VIVO de un mensaje de messages.upsert.
// ==========================================================================
// Capa de ENRIQUECIMIENTO, independiente del flujo de negocio real de
// reservas. NO sustituye ni modifica bot/middleware/obtenerUsuario.js (que
// sigue siendo, sin ningún cambio, quien resuelve ctx.usuario para
// reservas/consultas — ver regla arquitectónica de identidad). Este módulo
// es un SEGUNDO consumidor de identityScanner + identityResolver, no un
// segundo sistema de identidad: reutiliza exactamente el mismo motor de
// extracción (escanearObjeto) y exactamente el mismo resolver
// (resolverIdentidad) que ya usa escanerIdentidades.js.
//
// A diferencia de obtenerUsuario.js (que solo mira
// participant/participantAlt/remoteJid), aquí se recorre el mensaje
// COMPLETO — sección 4 de la auditoría: "no asumir que key, participant,
// participantAlt, participantPn, remoteJid, remoteJidAlt, contextInfo,
// mentionedJid, sender... existen; el scanner recursivo es la capa que los
// descubre".
//
// Dos "personas" distintas pueden aparecer en un mismo mensaje — el
// REMITENTE y (si el mensaje cita a alguien) el AUTOR CITADO — y NUNCA se
// mezclan en una sola resolución (eso causaría fusionar identidades de dos
// personas distintas). Las personas etiquetadas en contextInfo.mentionedJid
// se registran en el log (visibilidad) pero, en esta fase, no disparan una
// resolución propia por cada una — ver comentario en sincronizarDesdeMensaje.
// ==========================================================================

const { escanearObjeto } = require("./index");
const { resolverIdentidad } = require("./identityResolver");
const { obtenerContextInfo } = require("../../../utils/obtenerContextInfo");
const { enmascararJid } = require("../../../utils/enmascararJid");

// Mismo criterio de exclusión del propio BOT que ya usa el escaneo de
// grupos (escanerIdentidades.js) — reutilizado, no reimplementado. Hace
// falta aquí porque el AUTOR CITADO (rol 2 más abajo) puede ser el propio
// bot (alguien responde a un mensaje que el bot mismo envió) sin que el
// mensaje ACTUAL sea fromMe — ese caso no lo cubre el bloqueo de fromMe.
const {
    extraerIdentidadDelBot,
    esIdentidadDelBot
} = require("../escanerIdentidades");

// ==========================================================================
// Log condensado (sección 11): SOLO se imprime si pasó algo (identidad
// nueva, enriquecida, o conflicto). Si el remitente ya era conocido y no
// trajo nada nuevo (el caso normal de la mayoría de los mensajes), no se
// imprime nada — "no llenar el log si no apareció ningún identificador
// nuevo".
// ==========================================================================
function loguearResultado({ rol, grupoJid, participanteJid, telefonos, lids, r }) {

    if (r.conflicto) {

        console.warn([
            "⚠️ IDENTITY CONFLICT",
            `Rol: ${rol}`,
            `Grupo: ${grupoJid || "(privado)"}`,
            `LID: ${r.lidUsado || "(ninguno)"}`,
            `Phone: ${r.telefonoUsado || "(ninguno)"}`,
            "(detalle completo del conflicto arriba, vía obtenerUsuarioGlobal)"
        ].join("\n"));

        return;

    }

    if (!r.esNuevo && !r.fueEnriquecido) return; // nada nuevo -> silencio

    const lineas = [
        "🧠 IDENTITY SYNC",
        "Evento: message",
        `Rol: ${rol}`,
        `Grupo: ${grupoJid || "(privado)"}`,
        `Participante: ${enmascararJid(participanteJid)}`,
        "",
        "Encontrados:"
    ];

    if (telefonos.length) lineas.push(`📱 phone: ${telefonos.join(", ")}`);
    if (lids.length) lineas.push(`🆔 lid: ${lids.join(", ")}`);

    lineas.push("", "Resultado:");
    lineas.push(r.esNuevo ? "✅ identidad nueva creada" : "✅ identidad existente enriquecida");

    console.log(lineas.join("\n"));

}

// ==========================================================================
// sincronizarDesdeMensaje({ sock, message }) — punto de entrada único de
// esta capa. SIEMPRE debe llamarse envuelto en try/catch por quien la
// invoque (ver bot/events/identitySync.upsert.js) — pero, además, esta
// función también se blinda a sí misma: un fallo en cualquiera de las 2
// resoluciones (o en el escaneo) nunca debe impedir la otra, ni propagarse
// hacia arriba. `sock` es opcional (si falta, simplemente no se puede
// excluir al bot del rol "citado" — ver más abajo — pero el resto sigue
// funcionando igual).
// ==========================================================================
async function sincronizarDesdeMensaje({ sock, message }) {

    if (!message?.key || message.key.fromMe) return; // el bot nunca es un cliente (misma regla de siempre)

    const grupoJid = message.key.remoteJid?.endsWith("@g.us") ? message.key.remoteJid : null;

    const identidadBot = sock ? extraerIdentidadDelBot(sock) : null;

    // ---- ROL 1: remitente real del mensaje ----
    // Se recorre SOLO `key` (más `participant`/`sender` de nivel superior,
    // que algunas formas de Baileys usan como respaldo — ver
    // guardarMensajeGrupo.js::jidUsuario) — nunca `message.message` (el
    // contenido), que es donde vive contextInfo/mentionedJid de OTRAS
    // personas. Combinar key.participant + key.participantAlt aquí es
    // correcto porque Baileys documenta que son el MISMO remitente en dos
    // formas (LID/PN) — no dos personas distintas. (message.key.fromMe ya
    // descartó arriba el caso normal de que el remitente sea el propio
    // bot — este bloque no necesita repetir esa comprobación.)
    try {

        const resultado = escanearObjeto(
            { key: message.key, participant: message.participant, sender: message.sender },
            { fuenteBase: "message" }
        );

        if (resultado.telefonos.length || resultado.lids.length) {

            const r = await resolverIdentidad({

                telefonos: resultado.telefonos,
                lids: resultado.lids,
                candidatos: resultado.candidatos,
                nombre: message.pushName || null,
                fromMe: false

            });

            loguearResultado({
                rol: "remitente",
                grupoJid,
                participanteJid: message.key.participant || message.key.remoteJid,
                telefonos: resultado.telefonos,
                lids: resultado.lids,
                r
            });

        }

    } catch (err) {

        console.error("❌ [IDENTITY SYNC] error sincronizando remitente:", err?.message);

    }

    // ---- ROL 2: autor del mensaje CITADO (si lo hay) — persona DISTINTA ----
    // Solo contextInfo.participant (el autor citado) — deliberadamente NO
    // se resuelve cada entrada de contextInfo.mentionedJid como identidad
    // propia en esta fase: son varias personas a la vez sin ningún otro
    // dato para emparejar (ni teléfono, ni nombre), y resolverlas una por
    // una en cada mensaje que mencione a varias personas sería costoso para
    // un beneficio incierto. Quedan visibles en el escaneo (candidatos con
    // source "contextInfo.mentionedJid[...]") para cuando se decida
    // extender esto — no se pierden, solo no generan una escritura todavía.
    //
    // A diferencia del remitente, AQUÍ SÍ hace falta excluir explícitamente
    // al propio bot: alguien puede citar un mensaje que el BOT envió, sin
    // que el mensaje ACTUAL sea fromMe — ese caso no lo cubre el chequeo de
    // arriba.
    try {

        const contextInfo = obtenerContextInfo(message);
        const citadoJid = contextInfo?.participant || null;

        if (citadoJid) {

            const resultado = escanearObjeto({ participant: citadoJid }, { fuenteBase: "contextInfo.participant" });

            // Se clasifica citadoJid con el MISMO motor (puede venir en
            // formato @lid o @s.whatsapp.net según el modo de
            // direccionamiento) antes de comparar contra la identidad del
            // bot — nunca se asume de antemano cuál de los dos es.
            const candidatoCitado = { lid: resultado.lids[0] || null, telefono: resultado.telefonos[0] || null };
            const esCitadoElBot = identidadBot && esIdentidadDelBot(candidatoCitado, identidadBot);

            if (!esCitadoElBot && (resultado.telefonos.length || resultado.lids.length)) {

                const r = await resolverIdentidad({

                    telefonos: resultado.telefonos,
                    lids: resultado.lids,
                    candidatos: resultado.candidatos,
                    nombre: null, // no hay pushName del autor citado
                    fromMe: false

                });

                loguearResultado({
                    rol: "citado",
                    grupoJid,
                    participanteJid: citadoJid,
                    telefonos: resultado.telefonos,
                    lids: resultado.lids,
                    r
                });

            }

        }

    } catch (err) {

        console.error("❌ [IDENTITY SYNC] error sincronizando autor citado:", err?.message);

    }

}

module.exports = { sincronizarDesdeMensaje };
