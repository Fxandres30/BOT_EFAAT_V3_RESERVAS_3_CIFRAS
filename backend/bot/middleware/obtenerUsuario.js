const {
    obtenerUsuarioGlobal
} = require("../funciones/usuarios/obtenerUsuarioGlobal");

// Motor de extracción del IdentityScanner — puro, sin Supabase (recorre el
// objeto y clasifica JIDs con los helpers oficiales de Baileys). Se
// reutiliza SOLO la extracción/clasificación aquí, no resolverIdentidad()
// completo: ese resolver está pensado para el observador en segundo plano
// (identitySyncMensaje.js) y el escaneo periódico de grupos
// (escanerIdentidades.js), donde el costo extra de canonicalizar el LID
// contra Supabase (varias consultas más) es aceptable porque no bloquean
// nada. Este middleware corre en el camino síncrono de CADA mensaje y
// decide si se puede reservar — se mantiene en una sola resolución vía
// obtenerUsuarioGlobal (mismo costo de Supabase que antes: 1
// SELECT + 1 INSERT/UPDATE), solo que ahora eligiendo el candidato entre
// TODOS los JIDs que trae el mensaje, no solo el primero.
const { escanearObjeto } = require("../funciones/usuarios/identityScanner");

// ==========================================================================
// Identificadores disponibles en Baileys (@whiskeysockets/baileys ^7.0.0-rc14
// — verificado en node_modules/@whiskeysockets/baileys/lib/Types/Message.d.ts)
// ==========================================================================
//  - message.key.participant    → JID del remitente real dentro de un grupo.
//                                  Puede terminar en "@lid" o en
//                                  "@s.whatsapp.net" según el modo de
//                                  direccionamiento de ese chat/remitente.
//  - message.key.participantAlt → JID alterno del MISMO remitente (el otro
//                                  lado del par LID/PN) cuando Baileys lo
//                                  expone — el mismo remitente, no otra
//                                  persona.
//  - message.key.remoteJid      → JID del chat. En privado coincide con el
//                                  remitente; en grupo es el JID del grupo
//                                  (NO de la persona).
//  - sock.user.id                → identidad del propio bot. Válida
//                                  ÚNICAMENTE para decidir que un mensaje es
//                                  fromMe; JAMÁS se usa para identificar a un
//                                  cliente.
//
// CORRECCIÓN (auditoría "kellyJ🥰" / compradores_semanales.whatsapp=null,
// 2026-09): antes esta función tomaba el PRIMER JID no-nulo de la cadena
// participant/participantAlt/remoteJid y lo mandaba, solo, a
// obtenerUsuarioGlobal(jid). Un JID solo puede terminar en un dominio a la
// vez — si "participant" venía en "@lid", el teléfono que Baileys entregaba
// EN EL MISMO MENSAJE dentro de "participantAlt" se descartaba sin
// mirarlo, y la reserva quedaba guardada sin teléfono aunque estuviera ahí.
// Ahora se recorre `key` COMPLETO con el mismo motor que ya usa
// identitySyncMensaje.js (escanearObjeto + resolverIdentidad de
// identityScanner/, ver esos archivos) para que AMBOS lados del par LID/PN
// se consideren como candidatos, nunca solo el primero que aparezca.
//
// Regla dura de identidad, sin cambios: un JID terminado en "@lid" JAMÁS se
// convierte en teléfono. Esa clasificación ocurre en
// identityScanner/clasificarJidEncontrado.js, con los mismos helpers
// oficiales de Baileys (isLidUser/isPnUser) que ya usaba
// obtenerUsuarioGlobal — no es un criterio nuevo, es el mismo aplicado a
// más de un candidato a la vez.
// ==========================================================================

// Elige el mejor candidato de teléfono entre TODOS los JIDs encontrados:
// preferir uno con formato colombiano válido (10 dígitos, empieza en 3 —
// mismo criterio que normalizarCandidatos.js), pero si ninguno lo tiene,
// usar el primero tal cual — igual de permisivo que el criterio que ya
// usaba obtenerUsuarioGlobal.js::normalizarIdentificadoresDesdeJid (nunca
// validó formato). No se descarta un teléfono real solo porque no calce
// con el patrón típico: es mejor guardarlo que perder la identidad entera.
function elegirTelefono(candidatos) {

    const telefonos = candidatos.filter(c => c.tipo === "phone");

    const valido = telefonos.find(c => c.valido);
    if (valido) return valido.valor;

    return telefonos[0]?.valor || null;

}

module.exports = async function (ctx) {

    // ==========================================
    // BLOQUEO fromMe: el bot no es un cliente.
    // ==========================================
    // Un mensaje fromMe=true NUNCA debe crear, actualizar ni resolver una
    // identidad de cliente. Antes, este middleware calculaba un JID a partir
    // de sock.user.id para mensajes propios y lo mandaba a
    // obtenerUsuarioGlobal(), que terminaba creando (o "encontrando" por
    // colisión mal manejada) filas fantasma en "usuarios" — el origen de los
    // 474 duplicados con teléfono del propio bot. Se corta aquí, antes de
    // cualquier resolución.

    if (ctx.message.key.fromMe) {

        console.log("⏭️ obtenerUsuario: fromMe=true — no se resuelve identidad de cliente.");

        return null;

    }

    // ==========================================
    // Verificación temprana: sin NINGÚN JID disponible (ni participant, ni
    // participantAlt, ni remoteJid) no hay nada que escanear — mismo
    // criterio defensivo que antes, evita construir/recorrer el objeto
    // cuando ya se sabe que no hay nada.
    // ==========================================

    const hayAlgunJid = !!(
        ctx.chat?.participante ||
        ctx.message.key.participant ||
        ctx.message.key.participantAlt ||
        ctx.chat?.remoteJid
    );

    if (!hayAlgunJid) {

        console.log("⚠ No se pudo determinar el JID del usuario.");

        return null;

    }

    // ==========================================
    // Recorre `key` COMPLETO (participant + participantAlt + remoteJid, lo
    // que exista) — ningún candidato se descarta por aparecer segundo.
    // `ctx.chat.participante` no hace falta escanearlo aparte: es
    // literalmente `message.key.participant` (ver obtenerChat.js), ya
    // cubierto al recorrer `key`.
    // ==========================================

    const hallazgo = escanearObjeto(
        { key: ctx.message.key },
        { fuenteBase: "message" }
    );

    const telefono = elegirTelefono(hallazgo.candidatos);
    const lid = hallazgo.lids[0] || null;

    if (hallazgo.lids.length > 1) {

        console.warn(`⚠️ [obtenerUsuario] más de un LID distinto encontrado en el mismo mensaje — se usa el primero. Todos: ${hallazgo.lids.join(", ")}`);

    }

    // ==========================================
    // Resolución ÚNICA de identidad para este mensaje. Nadie más en el
    // pipeline de un mensaje entrante debe volver a llamar a
    // obtenerUsuarioGlobal — deben reutilizar ctx.usuario.
    // ==========================================

    // Tenant real de esta sesión — ctx.session ES sock.context (ver
    // bot/middleware/obtenerContexto.js: `obtenerUsuario({chat, message,
    // session: sock.context})`), armado a partir de sesiones.usuario_id al
    // conectar (services/baileys/socket.js). Nunca se deriva de otra forma;
    // si faltara, simplemente no se registra la relación tenant/contacto
    // (ver obtenerUsuarioGlobal.js::registrarContactoTenant) y la
    // resolución de identidad real sigue funcionando igual.
    return await obtenerUsuarioGlobal({

        telefono,
        lid,
        nombre: ctx.message.pushName || null,
        usuarioIdTenant: ctx.session?.usuarioId || null,
        origenContacto: "mensaje"

    });

};
