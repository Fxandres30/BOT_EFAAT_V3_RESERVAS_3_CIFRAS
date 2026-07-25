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

    const texto =
        normalizarMensaje(message);

    return {

        sock,

        message,

        chat,

        usuario,

        grupo,

        textoOriginal:
            texto.textoOriginal,

        texto:
            texto.texto,

        numeros:
            extraerNumeros(
                texto.texto
            )

    };

};