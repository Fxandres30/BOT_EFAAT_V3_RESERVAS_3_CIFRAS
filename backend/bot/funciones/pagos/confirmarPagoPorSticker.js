// ==========================================================================
// confirmarPagoPorSticker() — FASE 3: confirmación REAL de pago por sticker
// de administrador (ver AUDITORÍA sección H/I/J).
//
// ÚNICO objetivo de este módulo:
//
//     ADMIN + STICKER DE PAGO + CITA A UN CLIENTE  ->  reservado -> pagado
//
// Explícitamente FUERA de alcance (no lo hace ni lo hará este módulo):
// cálculo de deuda, consulta de pagos, pagos parciales, matching bancario,
// comprobantes, pagos_movimientos, nuevas tablas de pagos. Ver auditoría.
//
// Reutiliza EXACTAMENTE las piezas de la fase anterior — ninguna se
// reimplementa:
//   - extraerDatosSticker.js   (detecta sticker + hash + cita)
//   - esAdministrador.js       (rol real en vivo, sin persistencia)
//   - obtenerUsuarioGlobal.js  (identidad — único punto de resolución)
//   - consultarEvento.js       (evento activo del grupo — YA existente)
//   - marcarReservasPagadasPorAdmin.js (el único lugar que escribe
//     reservado -> pagado para este flujo)
//   - actualizarEvento.js      (recalcula reservados/pagados/libres — YA
//     existente, no se duplica el cálculo)
//   - services/baileys/send.js (envío de la respuesta al admin)
//
// Sustituye, en el pipeline en vivo (bot/handlers/dispatcher.js), al
// diagnóstico temporal de la fase anterior
// (bot/funciones/pagos/depurarStickerPago.js) — ese módulo sigue existiendo
// y probado, pero ya no se llama desde dispatcher.js, para no consultar
// groupMetadata() ni resolver identidad DOS veces por el mismo mensaje.
//
// Nunca lanza: cualquier error queda contenido aquí y solo se loguea.
// ==========================================================================

const { extraerDatosSticker } = require("../mensajes/extraerDatosSticker");
const { esAdministrador } = require("../admins/esAdministrador");

const {
    obtenerUsuarioGlobal,
    normalizarIdentificadoresDesdeJid
} = require("../usuarios/obtenerUsuarioGlobal");

const { consultarEvento } = require("../eventos/consultarEvento");
const { actualizarEvento } = require("../reservas/actualizarEvento");
const { marcarReservasPagadasPorAdmin } = require("./marcarReservasPagadasPorAdmin");
const { sendMessage } = require("../../../services/baileys/send");

// ==========================================================================
// CONFIGURACIÓN DEL STICKER DE PAGO
// ==========================================================================
// A propósito, en esta fase NO se crea una tabla nueva (pedido explícito):
// un único hash global, vía variable de entorno STICKER_PAGO_SHA256
// (hexadecimal, el mismo formato que devuelve extraerDatosSticker.js).
// Para obtenerlo: enviar el sticker candidato desde un admin en un grupo
// con el bot conectado y leer el log "[PAGO-STICKER] Sticker hash" de más
// abajo — se imprime SIEMPRE que se detecta un sticker, esté o no
// configurado/coincida o no, precisamente para poder configurarlo.
function obtenerHashStickerPagoConfigurado() {

    const valor = process.env.STICKER_PAGO_SHA256;

    return valor ? String(valor).trim().toLowerCase() : null;

}

// Nunca se loguea un JID completo — mismo criterio que el resto del bot
// (ver maskPhone en services/baileys/identidadSesion.js).
function enmascarar(jid) {

    if (!jid) return "(ninguno)";

    const [usuario, dominio] = jid.split("@");

    if (!usuario) return "(formato desconocido)";

    const visible = usuario.slice(-4);

    return `***${visible}@${dominio || "?"}`;

}

// El citado es el propio BOT -> nunca se resuelve como cliente (mismo
// criterio que la fase de diagnóstico: comparación por teléfono
// normalizado, reutilizando el único criterio del sistema). Ver limitación
// documentada: no cubre el caso en que el grupo direcciona al bot por @lid.
function esElPropioBot(quotedParticipant, telefonoSesionBot) {

    if (!quotedParticipant || !telefonoSesionBot) return false;

    const telefonoBot = normalizarIdentificadoresDesdeJid(
        `${telefonoSesionBot}@s.whatsapp.net`
    ).telefono;

    const telefonoCitado = normalizarIdentificadoresDesdeJid(quotedParticipant).telefono;

    return !!telefonoBot && !!telefonoCitado && telefonoBot === telefonoCitado;

}

async function confirmarPagoPorSticker(ctx) {

    try {

        if (!ctx?.chat?.esGrupo) return;

        if (ctx.message?.key?.fromMe) return;

        const datosSticker = extraerDatosSticker(ctx.message);

        if (!datosSticker.esSticker) return;

        console.log("================================");
        console.log("[PAGO-STICKER] Sticker recibido");
        console.log("[PAGO-STICKER] Sticker hash (fileSha256, hex):", datosSticker.fileSha256Hex || "(no disponible)");
        console.log("================================");

        // ==================================================================
        // 1. El sticker debe coincidir EXACTO con el configurado. Si no hay
        //    configuración, o no coincide: se ignora POR COMPLETO, en
        //    silencio de negocio (no se responde nada al grupo).
        // ==================================================================

        const hashConfigurado = obtenerHashStickerPagoConfigurado();

        if (!hashConfigurado) {

            console.log("[PAGO-STICKER] STICKER_PAGO_SHA256 no configurado — no se ejecuta ninguna acción.");
            return;

        }

        if (!datosSticker.fileSha256Hex || datosSticker.fileSha256Hex !== hashConfigurado) {

            console.log("[PAGO-STICKER] Hash no coincide con el sticker de pago configurado — IGNORAR.");
            return;

        }

        // ==================================================================
        // 2. Remitente y validación de administrador.
        // ==================================================================

        const remitenteJid =

            ctx.chat.participante ||
            ctx.message.key.participant ||
            ctx.message.key.participantAlt ||
            null;

        if (!remitenteJid) {

            console.log("[PAGO-STICKER] Acción: IGNORAR (no se pudo determinar el remitente).");
            return;

        }

        const { esAdministrador: esAdmin } = await esAdministrador({

            sock: ctx.sock,
            grupoId: ctx.chat.remoteJid,
            jid: remitenteJid

        });

        console.log("[PAGO-STICKER] Remitente:", enmascarar(remitenteJid), "| Es administrador:", esAdmin);

        if (!esAdmin) {

            console.log("[PAGO-STICKER] Acción: IGNORAR — remitente no es administrador.");
            return;

        }

        // ==================================================================
        // 3. La cita es OBLIGATORIA. Sin cita, no se hace nada — el cliente
        //    NUNCA se obtiene del remitente del sticker.
        // ==================================================================

        if (!datosSticker.tieneCita) {

            console.log("[PAGO-STICKER] Acción: NINGUNA — sticker de administrador sin cita.");
            return;

        }

        console.log("[PAGO-STICKER] quoted_participant:", enmascarar(datosSticker.quotedParticipant));

        // El citado es el propio bot -> nunca se resuelve como cliente.
        if (esElPropioBot(datosSticker.quotedParticipant, ctx.session?.telefono)) {

            console.log("[PAGO-STICKER] El mensaje citado es del propio BOT — no se resuelve como cliente.");
            return;

        }

        // ==================================================================
        // 4. Resolver al cliente EXCLUSIVAMENTE desde quoted_participant,
        //    reutilizando el único punto de identidad del sistema.
        // ==================================================================

        const usuarioCitado = await obtenerUsuarioGlobal({

            jid: datosSticker.quotedParticipant,
            nombre: null

        });

        if (!usuarioCitado) {

            console.log("[PAGO-STICKER] Usuario global: NO resuelto — no se modifican reservas.");
            return;

        }

        console.log("[PAGO-STICKER] Usuario global encontrado:", usuarioCitado.id);

        // ==================================================================
        // 5. Evento activo del grupo — misma fuente que usa eventHandler.js
        //    (consultarEvento.js), sin duplicar la consulta.
        // ==================================================================

        const evento = await consultarEvento(ctx.chat.remoteJid);

        if (!evento || !evento.activo) {

            console.log("[PAGO-STICKER] Sin evento activo para este grupo — no se modifican reservas.");
            return;

        }

        // ==================================================================
        // 6. Cambio real reservado -> pagado (atómico + idempotente) y
        //    respuesta al administrador.
        // ==================================================================

        const resultado = await marcarReservasPagadasPorAdmin({

            evento,
            usuario: usuarioCitado,
            realizadoPor: remitenteJid

        });

        console.log("[PAGO-STICKER] Resultado:", resultado.estado, "| filas actualizadas:", resultado.actualizadas.length);

        let texto = null;

        if (resultado.estado === "confirmado") {

            texto = "✅ Pago confirmado.";

            // Recalcula reservados/pagados/libres — mecanismo YA existente,
            // no se duplica el cálculo.
            await actualizarEvento(evento);

        } else if (resultado.estado === "ya_pagado") {

            texto = "✅ Este cliente ya estaba pagado.";

        } else if (resultado.estado === "sin_reservas") {

            texto = "⚠️ No encontré ninguna reserva pendiente para este cliente.";

        } else {

            // "error" — no se inventa un mensaje de éxito; se loguea y no se
            // responde nada al grupo para no informar algo que no ocurrió.
            console.error("[PAGO-STICKER] No se pudo completar la operación (estado=error).");
            return;

        }

        try {

            await sendMessage({

                sock: ctx.sock,
                jid: ctx.chat.remoteJid,
                text: texto,
                quoted: ctx.message

            });

        } catch (errorEnvio) {

            // El pago (si aplicó) YA quedó guardado — un fallo de envío de
            // WhatsApp nunca debe hacer parecer que la operación de datos
            // falló ni se reintenta.
            console.error("[PAGO-STICKER] Pago procesado pero falló el envío de la respuesta:", errorEnvio.message);

        }

    } catch (err) {

        console.error("❌ [PAGO-STICKER] Error confirmando pago (no afecta el resto del flujo):", err.message);

    }

}

module.exports = { confirmarPagoPorSticker };
