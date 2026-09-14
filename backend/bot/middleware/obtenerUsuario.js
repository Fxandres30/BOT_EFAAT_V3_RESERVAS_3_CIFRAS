const {
    obtenerUsuarioGlobal,
    buscarPorCampo
} = require("../funciones/usuarios/obtenerUsuarioGlobal");

// FUENTE ÚNICA de resolución de identidad para un mensaje entrante —
// auditoría de mensajes entrantes, 2026-09. Antes esta lógica vivía inline
// aquí mismo (escanearObjeto + elegirTelefono); se extrajo a
// identityScanner/resolverIdentidadMensaje.js para que sea una función
// central reutilizable/testeable por separado, sin duplicar el motor de
// extracción (escanearObjeto) que ya usan identitySyncMensaje.js y
// escanerIdentidades.js. Este middleware sigue siendo el ÚNICO lugar del
// pipeline de mensaje entrante que llama a obtenerUsuarioGlobal.
const { resolverIdentidadMensaje } = require("../funciones/usuarios/identityScanner/resolverIdentidadMensaje");

// Diagnóstico de mensajes entrantes — activable con
// DEBUG_INCOMING_MESSAGES=true (ver bot/utils/debugIncomingMessages.js).
// Con el flag apagado, estas llamadas no hacen nada (ni loguean, ni tocan
// Supabase de más) — ver el "antes" defensivo más abajo.
const {
    logIdentidadResuelta,
    logPersistencia,
    logErrorPersistencia
} = require("../funciones/mensajes/diagnosticoMensajeEntrante");
const { debugMensajesActivo } = require("../utils/debugIncomingMessages");

// ==========================================================================
// Identificadores disponibles en Baileys (@whiskeysockets/baileys ^7.0.0-rc14
// — verificado en node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.js)
// ==========================================================================
//  - message.key.participant    → JID del remitente real dentro de un grupo.
//  - message.key.participantAlt → JID alterno del MISMO remitente (grupo).
//  - message.key.remoteJid      → JID del chat (privado: el remitente;
//                                  grupo: el grupo, NO la persona).
//  - message.key.remoteJidAlt   → JID alterno del MISMO remitente (privado).
//  - sock.user.id                → identidad del propio bot. Nunca un cliente.
//
// Ver identityScanner/resolverIdentidadMensaje.js para el detalle completo
// (incluye por qué "senderPn"/"senderLid" NO son campos reales de esta
// versión de Baileys).
//
// Regla dura de identidad, sin cambios: un JID terminado en "@lid" JAMÁS se
// convierte en teléfono. NUNCA se inventa un teléfono a partir de un LID.
// ==========================================================================

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
    // Resolución ÚNICA de identidad para este mensaje — vía la función
    // central (ver cabecera). Nadie más en el pipeline de un mensaje
    // entrante debe volver a resolver esto: deben reutilizar ctx.usuario.
    // ==========================================

    const identidad = resolverIdentidadMensaje(ctx.message);

    logIdentidadResuelta(identidad);

    if (!identidad.telefono && !identidad.lid) {

        console.log("⚠ No se pudo determinar el JID del usuario.");

        logPersistencia({ antes: null, despues: null, accion: "NO PERSISTIDO" });

        return null;

    }

    // "antes" — SOLO cuando el diagnóstico está activo (una consulta extra
    // de solo lectura, evitable en el camino normal de producción). No
    // decide nada del negocio: es únicamente para poder loguear
    // CREADO/ACTUALIZADO/SIN CAMBIOS con el estado real anterior.
    let antes = null;

    if (debugMensajesActivo()) {

        try {

            if (identidad.lid) {

                const resultado = await buscarPorCampo("lid", identidad.lid);
                if (resultado.estado === "encontrado") antes = resultado.usuario;

            }

            if (!antes && identidad.telefono) {

                const resultado = await buscarPorCampo("telefono", identidad.telefono);
                if (resultado.estado === "encontrado") antes = resultado.usuario;

            }

        } catch (err) {

            // El snapshot "antes" es solo diagnóstico -- si falla, no debe
            // impedir la resolución real de identidad de abajo.
            console.error("❌ [DIAGNÓSTICO PERSISTENCIA] error leyendo snapshot 'antes':", err?.message);

        }

    }

    // Tenant real de esta sesión — ctx.session ES sock.context (ver
    // bot/middleware/obtenerContexto.js: `obtenerUsuario({chat, message,
    // session: sock.context})`), armado a partir de sesiones.usuario_id al
    // conectar (services/baileys/socket.js). Nunca se deriva de otra forma;
    // si faltara, simplemente no se registra la relación tenant/contacto
    // (ver obtenerUsuarioGlobal.js::registrarContactoTenant) y la
    // resolución de identidad real sigue funcionando igual.
    const usuario = await obtenerUsuarioGlobal({

        telefono: identidad.telefono,
        lid: identidad.lid,
        nombre: identidad.pushName,
        usuarioIdTenant: ctx.session?.usuarioId || null,
        origenContacto: "mensaje"

    });

    if (debugMensajesActivo()) {

        if (!usuario) {

            logPersistencia({ antes, despues: null, accion: "NO PERSISTIDO" });

            logErrorPersistencia({
                tabla: "usuarios",
                campo: "lid/telefono",
                error: "obtenerUsuarioGlobal devolvió null (conflicto de identidad o error de Supabase — ver el log de obtenerUsuarioGlobal.js justo arriba)"
            });

        } else if (!antes) {

            logPersistencia({ antes, despues: usuario, accion: "CREADO" });

        } else {

            const cambio =
                antes.telefono !== usuario.telefono ||
                antes.lid !== usuario.lid ||
                antes.nombre !== usuario.nombre;

            logPersistencia({ antes, despues: usuario, accion: cambio ? "ACTUALIZADO" : "SIN CAMBIOS" });

        }

    }

    return usuario;

};
