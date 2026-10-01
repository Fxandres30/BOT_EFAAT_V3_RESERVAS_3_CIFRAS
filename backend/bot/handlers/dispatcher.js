const obtenerContexto =
require("../middleware/obtenerContexto");

const {
    guardarMensajeGrupo,
    MENSAJE_DUPLICADO
} = require("../funciones/mensajes/guardarMensajeGrupo");

// Compuerta de ingreso: "¿ya procesado?" persistente y corte de mensajes
// históricos antes del negocio. Ver compuertaIngreso.js.
const compuertaIngreso =
require("../funciones/mensajes/compuertaIngreso");

// Regla absoluta ❌: se lee en el contenido ORIGINAL (antes de normalizar).
const { contieneCruz } =
require("../funciones/mensajes/mensajeConCruz");

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
// Eco de un mensaje que envió ESTE programa (send.js): se registra, pero
// nunca vuelve a procesarse como entrada de usuario. Lo escrito a mano
// desde el teléfono del bot (fromMe, id no registrado) sigue igual.
const { fueEnviadoPorPrograma } =
require("../utils/mensajesEnviados");

// Diagnóstico del ciclo de vida (Paso 0) — solo observa.
const cicloMensaje = require("../../diagnostico/cicloMensaje");

module.exports = async ({

    sock,
    message,
    session,
    tipo,
    // Decisión de la compuerta de ingreso (messages.upsert.js). Si no
    // viene, se trata como mensaje nuevo (comportamiento previo).
    ingreso

}) => {

    const inicio = Date.now();

    // Un identificador único para este mensaje
    const traceId = message.key.id;

    try {

        console.log("================================");
        console.log(`🚀 INICIO DISPATCHER [${traceId}]`);
        console.log("================================");

        console.log("1️⃣ Entró a dispatcher");

        cicloMensaje.etapa("dispatcher");

        // ¿YA PROCESADO? — persistente: si este mensaje (grupo + key.id) ya
        // tiene fila en mensajes_grupos_sorteos, ya pasó por el bot en esta
        // u otra sesión, antes o después de un reinicio. Cero acciones y
        // sin segunda fila de historial.
        const identidad = compuertaIngreso.identidadMensaje(message);

        if (identidad?.esGrupo && await compuertaIngreso.yaRegistrado(identidad)) {

            console.log(`⏭️ [COMPUERTA] mensaje ya registrado/procesado anteriormente — descartado [${traceId}]`);

            cicloMensaje.etapa("compuerta", { DECISION: "DESCARTADO_YA_PROCESADO" });

            return;

        }

        // ❌ en el contenido original -> se registra en el historial y no
        // se procesa ni se responde (ver mensajeConCruz.js). Se lee aquí,
        // antes de obtenerContexto/normalizarTexto, que eliminan emojis.
        const conCruz = contieneCruz(message);

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

        const esSalidaDelPrograma =
            !!message.key.fromMe && fueEnviadoPorPrograma(message.key.id);

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

            // Otra entrega del mismo mensaje lo reclamó primero (índice
            // único de la migración 021): ya está en proceso o procesado.
            if (mensaje === MENSAJE_DUPLICADO) {

                console.log(`⏭️ [COMPUERTA] el mensaje ya fue reclamado por otra entrega — descartado [${traceId}]`);

                cicloMensaje.etapa("compuerta", { DECISION: "DESCARTADO_YA_PROCESADO" });

                return;

            }

            console.log("4️⃣ Mensaje guardado");

            // Un mensaje histórico queda en el historial, pero no se
            // clasifica para ningún worker de negocio.
            if (mensaje && !esSalidaDelPrograma && !ingreso?.historico && !conCruz) {

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

        // ¿HISTÓRICO/RECUPERADO? — ya existía antes de que esta sesión
        // empezara a procesar (offline, reenvío, timestamp anterior): queda
        // registrado arriba como historial, pero NO llega a stickers de
        // pago, eventos, reservas, respuestas ni comandos.
        if (ingreso?.historico) {

            console.log(`🕰️ [COMPUERTA] mensaje histórico (${ingreso.motivo}) — solo historial, sin acciones [${traceId}]`);

            cicloMensaje.etapa("compuerta", { DECISION: "SOLO_HISTORIAL", MOTIVO: ingreso.motivo });

            return;

        }

        // ❌ — ni stickers de pago, ni eventos, ni reservas, ni consultas,
        // ni respuestas. Solo quedó registrado arriba (historial).
        if (conCruz) {

            console.log(`❎ [AVISO ❌] mensaje con ❌ — solo historial, no se procesa ni se responde [${traceId}]`);

            cicloMensaje.etapa("compuerta", { DECISION: "SOLO_HISTORIAL", MOTIVO: "CONTIENE_EMOJI_X" });

            return;

        }

        // Respuesta enviada por el propio programa: ya quedó registrada
        // arriba; no se clasifica ni entra a stickers/eventos/reservas.
        if (esSalidaDelPrograma) {

            console.log(`↩️ Mensaje enviado por el programa, solo registrado [${traceId}]`);

            return;

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