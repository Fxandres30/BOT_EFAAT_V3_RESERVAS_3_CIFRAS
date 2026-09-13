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
// Reutiliza EXACTAMENTE las piezas de las fases anteriores — ninguna se
// reimplementa:
//   - extraerDatosSticker.js   (detecta sticker + hash + cita)
//   - esAdministrador.js       (rol real en vivo, sin persistencia)
//   - obtenerUsuarioGlobal.js  (identidad — único punto de resolución)
//   - consultarEvento.js       (evento activo del grupo — YA existente)
//   - marcarReservasPagadasPorAdmin.js (el único lugar que escribe
//     reservado -> pagado para este flujo)
//   - actualizarEvento.js      (recalcula reservados/pagados/libres — YA
//     existente, no se duplica el cálculo)
//   - configuracionStickerPago.js (FASE 1 — hash autorizado por
//     usuario_id+grupo_id, en Supabase; ya NO se lee STICKER_PAGO_SHA256)
//
// Sustituye, en el pipeline en vivo (bot/handlers/dispatcher.js), al
// diagnóstico temporal de la fase anterior
// (bot/funciones/pagos/depurarStickerPago.js) — ese módulo sigue existiendo
// y probado, pero ya no se llama desde dispatcher.js, para no consultar
// groupMetadata() ni resolver identidad DOS veces por el mismo mensaje.
//
// dispatcher.js SIEMPRE llama primero a registrarStickerPago.js — este
// módulo solo se ejecuta cuando ese devuelve intervino:false (ver la
// cabecera de registrarStickerPago.js para la regla de seguridad completa).
//
// REGLA DE NEGOCIO (silencio del sticker): este flujo NUNCA envía un
// mensaje de WhatsApp como consecuencia del sticker — ni al confirmar,
// ni al detectar "ya estaba pagado", ni al no encontrar reservas. Procesa
// la base de datos en silencio, sin importar cuántos números actualizó (0,
// 1 o varios). services/baileys/send.js deliberadamente NO se importa
// aquí — si algún día hace falta notificar, debe ser un mecanismo
// explícito y separado, nunca reintroducir esta llamada.
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
const { enmascararJid: enmascarar } = require("../../utils/enmascararJid");

// FASE 1 (configuración desde el panel) + corrección arquitectónica
// (predeterminado/específico): el hash autorizado ya NO viene de
// STICKER_PAGO_SHA256 (variable de entorno) — viene de Supabase, resuelto
// por resolverStickerPago() (única función de resolución: específico del
// grupo primero, predeterminado del tenant como respaldo — ver
// bot/funciones/pagos/configuracionStickerPago.js). Esta lógica de
// prioridad NUNCA se duplica aquí.
const { resolverStickerPago } = require("./configuracionStickerPago");

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

        // A propósito, NO se descarta fromMe=true aquí: el remitente del
        // sticker puede ser el mismo número conectado como bot (setups
        // donde el admin real usa esa misma cuenta de WhatsApp). Esto NO
        // trata al bot como cliente: la identidad de CLIENTE solo se
        // resuelve del participante CITADO (quoted_participant, más
        // abajo), nunca del remitente del sticker — y esElPropioBot() ya
        // impide resolver al bot como cliente si es justo a él a quien se
        // cita. fromMe sigue aplicando sin cambios en
        // obtenerUsuario.js/obtenerUsuarioGlobal.js.
        const datosSticker = extraerDatosSticker(ctx.message);

        if (!datosSticker.esSticker) return;

        console.log("================================");
        console.log("[PAGO-STICKER] Sticker recibido");
        console.log("[PAGO-STICKER] Sticker hash (fileSha256, hex):", datosSticker.fileSha256Hex || "(no disponible)");
        console.log("================================");

        // ==================================================================
        // 1. El sticker debe coincidir EXACTO con el resuelto para ESTE
        //    (usuario_id, grupo_id): específico del grupo si existe, si no
        //    el predeterminado del tenant — nunca el de otro grupo, nunca
        //    el de otro tenant, sin fallback de ningún otro tipo. Sin
        //    ninguno de los dos: falla cerrado, no se ejecuta nada.
        // ==================================================================

        const usuarioIdTenant = ctx.session?.usuarioId || null;
        const grupoIdActual = ctx.chat.remoteJid;

        const resuelto = await resolverStickerPago({

            usuarioId: usuarioIdTenant,
            grupoId: grupoIdActual

        });

        if (!resuelto) {

            console.log("[PAGO-STICKER] Sin sticker de pago configurado (ni específico ni predeterminado) — no se ejecuta ninguna acción.");
            return;

        }

        console.log(`[PAGO-STICKER] Sticker configurado resuelto: nivel=${resuelto.nivel}`);

        if (!datosSticker.fileSha256Hex || datosSticker.fileSha256Hex !== resuelto.hash) {

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
        // 6. Cambio real reservado -> pagado (atómico + idempotente).
        //    SILENCIOSO por regla de negocio: nunca se envía nada a
        //    WhatsApp como consecuencia de esto, sin importar el
        //    resultado (confirmado / ya_pagado / sin_reservas / error) ni
        //    cuántas filas se actualizaron.
        // ==================================================================

        const resultado = await marcarReservasPagadasPorAdmin({

            evento,
            usuario: usuarioCitado,
            realizadoPor: remitenteJid

        });

        console.log("[PAGO-STICKER] Resultado:", resultado.estado, "| filas actualizadas:", resultado.actualizadas.length);

        if (resultado.estado === "confirmado") {

            // Recalcula reservados/pagados/libres — mecanismo YA existente,
            // no se duplica el cálculo.
            await actualizarEvento(evento);

        } else if (resultado.estado === "error") {

            console.error("[PAGO-STICKER] No se pudo completar la operación (estado=error).");

        }

        // "ya_pagado" y "sin_reservas" no requieren ninguna acción
        // adicional — ya quedaron reflejados en el log de arriba.

    } catch (err) {

        console.error("❌ [PAGO-STICKER] Error confirmando pago (no afecta el resto del flujo):", err.message);

    }

}

module.exports = { confirmarPagoPorSticker };
