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

module.exports = async (
    sock,
    message
) => {

    const chat =
        obtenerChat(message);

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