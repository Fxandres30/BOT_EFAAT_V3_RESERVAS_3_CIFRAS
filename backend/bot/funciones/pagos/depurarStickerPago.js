// ==========================================================================
// depurarStickerPago() — DIAGNÓSTICO TEMPORAL DE FASE 1/2.
//
// ⚠️ Este módulo NO ejecuta ninguna acción de negocio. No confirma pagos,
// no cambia "reservado"→"pagado", no libera números, no toca
// pagos_movimientos, no envía nada a WhatsApp. Es exclusivamente un punto
// de observación para comprobar, con mensajes reales de un grupo, que el
// bot puede encadenar:
//
//     STICKER → ¿ES ADMIN? → ¿TIENE CITA? → ¿QUIÉN ES EL CITADO?
//
// Se debe retirar (o reemplazar por bot/funciones/pagos/confirmarPagoPorAdmin.js,
// todavía no construido) cuando se implemente la confirmación real — ver
// AUDITORÍA sección H/I/J, fases 3 en adelante.
//
// Reutiliza SIEMPRE infraestructura existente, tal como pidió la fase:
//   - extraerDatosSticker.js       (lectura pura del sticker/cita)
//   - esAdministrador.js           (rol real en vivo, sin persistencia)
//   - obtenerUsuarioGlobal.js      (identidad — único punto de resolución)
//
// Nunca lanza: cualquier error queda contenido aquí y solo se loguea, para
// no afectar el resto del dispatcher (eventHandler/commandHandler siguen
// corriendo igual que antes de este módulo existir).
// ==========================================================================

const { extraerDatosSticker } = require("../mensajes/extraerDatosSticker");
const { esAdministrador } = require("../admins/esAdministrador");

const {
    obtenerUsuarioGlobal,
    normalizarIdentificadoresDesdeJid
} = require("../usuarios/obtenerUsuarioGlobal");

// Nunca se loguea un JID completo (contiene el teléfono) — se recorta a los
// últimos 4 dígitos del usuario, mismo espíritu que maskPhone() en
// services/baileys/identidadSesion.js, para poder correlacionar logs sin
// publicar números completos.
function enmascarar(jid) {

    if (!jid) return "(ninguno)";

    const [usuario, dominio] = jid.split("@");

    if (!usuario) return "(formato desconocido)";

    const visible = usuario.slice(-4).padStart(usuario.length >= 4 ? 4 : usuario.length, "*");

    return `***${visible}@${dominio || "?"}`;

}

// Determina si el JID citado corresponde al propio BOT de esta sesión —
// nunca se busca ni se crea un "usuario" cliente para el bot (mismo
// criterio que bot/middleware/obtenerUsuario.js con fromMe). Se compara por
// TELÉFONO NORMALIZADO (reutilizando normalizarIdentificadoresDesdeJid, el
// único criterio del sistema) porque session.telefono se guarda con el
// prefijo de país completo (services/baileys/conectado.js) y necesita la
// misma normalización que ya aplica cualquier JID de cliente.
//
// Limitación conocida y documentada (auditoría, sección E): si el grupo
// direcciona al bot por "@lid" en vez de por teléfono, esta comparación no
// lo detecta — session.telefono no tiene un LID equivalente conocido hoy.
// No se resuelve en esta fase; solo se deja constancia.
function esElPropioBot(quotedParticipant, telefonoSesionBot) {

    if (!quotedParticipant || !telefonoSesionBot) return false;

    const telefonoBot = normalizarIdentificadoresDesdeJid(
        `${telefonoSesionBot}@s.whatsapp.net`
    ).telefono;

    const telefonoCitado = normalizarIdentificadoresDesdeJid(quotedParticipant).telefono;

    return !!telefonoBot && !!telefonoCitado && telefonoBot === telefonoCitado;

}

async function depurarStickerPago(ctx) {

    try {

        if (!ctx?.chat?.esGrupo) return;

        if (ctx.message?.key?.fromMe) return;

        const datosSticker = extraerDatosSticker(ctx.message);

        if (!datosSticker.esSticker) return;

        console.log("================================");
        console.log("[PAGO-STICKER] Sticker recibido");
        console.log("================================");

        const remitenteJid =

            ctx.chat.participante ||
            ctx.message.key.participant ||
            ctx.message.key.participantAlt ||
            null;

        console.log("[PAGO-STICKER] Remitente:", enmascarar(remitenteJid));
        console.log("[PAGO-STICKER] Sticker mimetype:", datosSticker.mimetype || "(desconocido)");
        console.log("[PAGO-STICKER] Sticker hash (fileSha256, hex):", datosSticker.fileSha256Hex || "(no disponible)");

        if (!remitenteJid) {

            console.log("[PAGO-STICKER] Acción: IGNORAR (no se pudo determinar el remitente).");
            return;

        }

        const { esAdministrador: esAdmin, rol } = await esAdministrador({

            sock: ctx.sock,
            grupoId: ctx.chat.remoteJid,
            jid: remitenteJid

        });

        console.log("[PAGO-STICKER] Es administrador:", esAdmin, rol ? `(rol: ${rol})` : "(sin rol)");

        if (!esAdmin) {

            console.log("[PAGO-STICKER] Acción: IGNORAR — remitente no es administrador. No se modifica BD.");
            return;

        }

        console.log("[PAGO-STICKER] Mensaje citado:", datosSticker.tieneCita ? "sí" : "no");

        if (!datosSticker.tieneCita) {

            console.log("[PAGO-STICKER] Acción: NINGUNA — sticker de administrador sin cita. No se modifica BD.");
            return;

        }

        console.log("[PAGO-STICKER] quoted_id:", datosSticker.quotedId);
        console.log("[PAGO-STICKER] quoted_participant:", enmascarar(datosSticker.quotedParticipant));

        if (esElPropioBot(datosSticker.quotedParticipant, ctx.session?.telefono)) {

            console.log("[PAGO-STICKER] El mensaje citado es del propio BOT — no se resuelve como cliente, no se busca reserva.");
            return;

        }

        // Misma resolución de identidad que usa TODO el resto del bot — no
        // se inventa ningún criterio nuevo (pedido explícito de esta fase).
        const usuarioCitado = await obtenerUsuarioGlobal({

            jid: datosSticker.quotedParticipant,
            nombre: null

        });

        if (!usuarioCitado) {

            console.log("[PAGO-STICKER] Usuario global: NO resuelto (sin identificador válido o conflicto de identidad).");
            console.log("[PAGO-STICKER] Acción: NINGUNA — no se puede identificar al participante citado.");
            return;

        }

        console.log("[PAGO-STICKER] Usuario global encontrado:", usuarioCitado.id);
        console.log("[PAGO-STICKER] Acción: NINGUNA todavía — fase de verificación. No se confirma pago, no se toca reservas.");

    } catch (err) {

        console.error("❌ [PAGO-STICKER] Error en diagnóstico (no afecta el resto del flujo):", err.message);

    }

}

module.exports = { depurarStickerPago };
