const obtenerContexto =
require("../middleware/obtenerContexto");

const {
    guardarMensajeGrupo
} = require("../funciones/mensajes/guardarMensajeGrupo");

const {
    clasificarMensaje
} = require("../funciones/mensajes/clasificarMensaje");

const eventHandler =
require("./eventHandler");

const commandHandler =
require("./commandHandler");

// FASE 3 — confirmación real de pago por sticker de administrador (ver
// AUDITORÍA sección H/I/J). Sustituye al diagnóstico temporal de la fase
// anterior (bot/funciones/pagos/depurarStickerPago.js, que sigue existiendo
// y probado, pero ya no se llama aquí para no consultar groupMetadata() ni
// resolver identidad dos veces por el mismo mensaje).
const { confirmarPagoPorSticker } =
require("../funciones/pagos/confirmarPagoPorSticker");

// FASE 1 (sticker de pago configurable desde el panel) — SIEMPRE se llama
// ANTES que confirmarPagoPorSticker. Mientras el panel dejó a este grupo
// en modo "esperando_registro" vigente, el mensaje queda consumido por el
// registro y confirmarPagoPorSticker NUNCA se ejecuta en esa misma
// pasada (regla de seguridad crítica — ver cabecera de
// registrarStickerPago.js).
const { registrarStickerPago } =
require("../funciones/pagos/registrarStickerPago");

module.exports = async ({

    sock,
    message,
    session,
    tipo

}) => {

    const inicio = Date.now();

    // Un identificador único para este mensaje
    const traceId = message.key.id;

    try {

        console.log("================================");
        console.log(`🚀 INICIO DISPATCHER [${traceId}]`);
        console.log("================================");

        console.log("1️⃣ Entró a dispatcher");

        console.time(`obtenerContexto-${traceId}`);

        const ctx = await obtenerContexto(
            sock,
            message
        );

        console.timeEnd(`obtenerContexto-${traceId}`);

        console.log("2️⃣ Contexto obtenido");

        if (!ctx) {

            console.log("⛔ ctx es null");

            return;

        }

        ctx.session = session;
        ctx.tipoConexion = tipo;

        if (ctx.chat.esGrupo) {

            console.log("3️⃣ Guardando mensaje del grupo");

            console.time(`guardarMensajeGrupo-${traceId}`);

            // Se reutiliza ctx.usuario (ya resuelto una única vez por
            // obtenerContexto → obtenerUsuario.js). guardarMensajeGrupo NO
            // vuelve a llamar a obtenerUsuarioGlobal.
            const mensaje = await guardarMensajeGrupo({

                msg: message,

                texto: ctx.texto,

                grupoId: ctx.chat.remoteJid,

                grupoNombre: null,

                usuario: ctx.usuario

            });

            console.timeEnd(`guardarMensajeGrupo-${traceId}`);

            console.log("4️⃣ Mensaje guardado");

            if (mensaje) {

                console.log("5️⃣ Clasificando mensaje");

                console.time(`clasificarMensaje-${traceId}`);

                await clasificarMensaje({

                    mensaje,

                    ctx

                });

                console.timeEnd(`clasificarMensaje-${traceId}`);

                console.log("6️⃣ Clasificación terminada");

            }

        }

        // FASE 3 — confirmación de pago por sticker de administrador. Va
        // ANTES de eventHandler a propósito: eventHandler corta temprano si
        // no hay texto (ctx.textoOriginal), y un sticker normalmente no
        // trae texto.
        //
        // FASE 1 — exclusión mutua obligatoria: si el mensaje fue consumido
        // por el registro del sticker de pago, confirmarPagoPorSticker NO
        // se ejecuta en esta misma pasada (nunca "registrar y luego
        // confirmar pago" en la misma ejecución).
        const registroSticker = await registrarStickerPago(ctx);

        if (!registroSticker?.intervino) {

            await confirmarPagoPorSticker(ctx);

        }

        console.log("7️⃣ eventHandler");

        console.time(`eventHandler-${traceId}`);

        await eventHandler(ctx);

        console.timeEnd(`eventHandler-${traceId}`);

        console.log("8️⃣ commandHandler");

        console.time(`commandHandler-${traceId}`);

        await commandHandler(ctx);

        console.timeEnd(`commandHandler-${traceId}`);

        console.log("9️⃣ FIN dispatcher");

        console.log(
            `✅ Dispatcher terminado en ${Date.now() - inicio} ms [${traceId}]`
        );

    } catch (error) {

        console.log("================================");
        console.log(`❌ ERROR EN DISPATCHER [${traceId}]`);
        console.log("================================");

        console.error(error);

        if (error?.stack) {

            console.error(error.stack);

        }

    }

};