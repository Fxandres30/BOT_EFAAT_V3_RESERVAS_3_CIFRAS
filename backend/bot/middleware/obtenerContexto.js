const obtenerChat =
require("./obtenerChat");

const obtenerUsuario =
require("./obtenerUsuario");

const obtenerGrupo =
require("./obtenerGrupo");

const normalizarMensaje =
require("./normalizarMensaje");

const extraerNumeros =
require("./extraerNumeros");

// Diagnóstico de mensajes entrantes (auditoría 2026-09) — activable con
// DEBUG_INCOMING_MESSAGES=true, no hace nada si está apagado (ver ese
// archivo). Solo logs internos, nunca cambia el resultado del contexto.
const {
    logMensajeEntrante,
    logDumpRaw
} = require("../funciones/mensajes/diagnosticoMensajeEntrante");

module.exports = async (
    sock,
    message
) => {

    const chat =
        obtenerChat(message);

    logMensajeEntrante(message, chat);
    logDumpRaw(message);

    const usuario =
        await obtenerUsuario({

            chat,

            message,

            session: sock.context

        });

    const grupo =
        await obtenerGrupo(chat);

    const resultadoTexto =
        normalizarMensaje(message);

    return {

        sock,

        message,

        chat,

        usuario,

        grupo,

        textoOriginal:
            resultadoTexto.textoOriginal || null,

        texto:
            resultadoTexto.texto || null,

        numeros:
            extraerNumeros(
                resultadoTexto.texto || ""
            )

    };

};