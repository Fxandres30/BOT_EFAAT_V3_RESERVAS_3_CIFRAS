// ==========================================================================
// registrarStickerPago() — FASE 1 (sticker de pago configurable desde el
// panel). Captura el fileSha256 de un sticker ÚNICAMENTE mientras el panel
// dejó a (usuario_id, grupo_id) en modo "esperando_registro" vigente.
//
// ==========================================================================
// SEGURIDAD CRÍTICA (regla obligatoria del pedido)
// ==========================================================================
// Mientras esperando_registro=true y vigente para (usuario_id, grupo_id),
// el mensaje se CONSUME POR COMPLETO aquí — nunca continúa hacia
// confirmarPagoPorSticker.js, sin importar si el sticker es el correcto,
// si cita a un cliente con una reserva real, o si el remitente termina NO
// siendo administrador. "Vigente" es la única condición que decide si este
// módulo interviene; el resultado de la validación de admin/hash decide
// solo si se GUARDA algo, nunca si se deja pasar el mensaje al flujo de
// pago.
//
// dispatcher.js implementa la exclusión mutua así:
//
//     const registro = await registrarStickerPago(ctx);
//     if (!registro.intervino) {
//         await confirmarPagoPorSticker(ctx);
//     }
//
// Reutiliza EXACTAMENTE las piezas ya existentes — ninguna se reimplementa:
//   - extraerDatosSticker.js       (detecta sticker + hash)
//   - esAdministrador.js           (rol real en vivo — NUNCA se duplica)
//   - configuracionStickerPago.js  (única persistencia de esta fase)
//
// Nunca lanza: cualquier error se trata como "el mensaje SÍ fue tocado por
// el registro" (falla cerrado hacia el lado seguro — ver más abajo).
// ==========================================================================

const { extraerDatosSticker } = require("../mensajes/extraerDatosSticker");
const { esAdministrador } = require("../admins/esAdministrador");
const { enmascararJid } = require("../../utils/enmascararJid");

const {
    obtenerConfiguracion,
    registroVigente,
    guardarStickerCapturado,
    desactivarModoRegistro
} = require("./configuracionStickerPago");

// Devuelve SIEMPRE { intervino: boolean }.
async function registrarStickerPago(ctx) {

    try {

        if (!ctx?.chat?.esGrupo) return { intervino: false };

        if (ctx.message?.key?.fromMe) return { intervino: false };

        const datosSticker = extraerDatosSticker(ctx.message);

        if (!datosSticker.esSticker) return { intervino: false };

        const usuarioId = ctx.session?.usuarioId || null;
        const grupoId = ctx.chat.remoteJid || null;

        if (!usuarioId || !grupoId) return { intervino: false };

        const config = await obtenerConfiguracion({ usuarioId, grupoId });

        if (!config || config.esperando_registro !== true) {

            // Nunca hubo (o ya no hay) intención de registro para este
            // grupo/tenant — el mensaje no tiene nada que ver con esta
            // fase, sigue de largo hacia confirmarPagoPorSticker.js.
            return { intervino: false };

        }

        if (!registroVigente(config)) {

            // Vencido: se trata como NO ACTIVO. Limpieza best-effort para
            // que el panel no se quede mostrando "esperando" indefinidamente
            // — condicionada a (usuario_id, grupo_id) exactos, nunca afecta
            // otra configuración.
            try {

                await desactivarModoRegistro({ usuarioId, grupoId });

            } catch (errorLimpieza) {

                console.error("⚠ [STICKER-REGISTRO] No se pudo limpiar el registro vencido:", errorLimpieza.message);

            }

            console.log("[STICKER-REGISTRO] Registro vencido — se trata como no activo, no interviene.");

            return { intervino: false };

        }

        // ==================================================================
        // A partir de aquí el mensaje queda CONSUMIDO por el registro pase
        // lo que pase — el flujo TERMINA en este módulo (regla de seguridad).
        // ==================================================================

        console.log("================================");
        console.log("[STICKER-REGISTRO] Sticker recibido durante modo de registro");
        console.log("================================");

        const remitenteJid =

            ctx.chat.participante ||
            ctx.message.key.participant ||
            ctx.message.key.participantAlt ||
            null;

        if (!remitenteJid) {

            console.log("[STICKER-REGISTRO] No se pudo determinar el remitente — no se guarda nada.");
            return { intervino: true };

        }

        const { esAdministrador: esAdmin } = await esAdministrador({

            sock: ctx.sock,
            grupoId,
            jid: remitenteJid

        });

        console.log("[STICKER-REGISTRO] Remitente:", enmascararJid(remitenteJid), "| Es administrador:", esAdmin);

        if (!esAdmin) {

            console.log("[STICKER-REGISTRO] Remitente no es administrador — el registro sigue esperando, no se guarda nada.");
            return { intervino: true };

        }

        if (!datosSticker.fileSha256Hex) {

            console.log("[STICKER-REGISTRO] No se pudo obtener el hash del sticker — no se guarda nada.");
            return { intervino: true };

        }

        const resultado = await guardarStickerCapturado({

            usuarioId,
            grupoId,
            stickerSha256: datosSticker.fileSha256Hex,
            registradoPor: remitenteJid

        });

        if (resultado.ok) {

            console.log("[STICKER-REGISTRO] Sticker de pago registrado correctamente.");

        } else {

            console.log(`[STICKER-REGISTRO] No se guardó (${resultado.motivo || resultado.error}).`);

        }

        return { intervino: true };

    } catch (err) {

        console.error("❌ [STICKER-REGISTRO] Error inesperado:", err.message);

        // Ante un error inesperado (p. ej. falla de Supabase a mitad de
        // camino) es más seguro asumir que el mensaje YA fue tocado por el
        // registro y NO dejarlo caer al flujo de pago — el peor caso
        // posible es que el sticker no quede registrado y haya que
        // reintentarlo; nunca que se ejecute una confirmación de pago sin
        // querer por culpa de un error transitorio de esta fase.
        return { intervino: true };

    }

}

module.exports = { registrarStickerPago };
