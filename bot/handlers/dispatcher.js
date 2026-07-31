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

module.exports = async ({

    sock,
    message,
    session,
    tipo

}) => {

    console.log("1️⃣ Entró a dispatcher");

    const ctx = await obtenerContexto(
        sock,
        message
    );

    console.log("2️⃣ Contexto obtenido");

    if (!ctx) {

        console.log("⛔ ctx es null");
        return;

    }

    ctx.session = session;
    ctx.tipoConexion = tipo;

    if (ctx.chat.esGrupo) {

        console.log("3️⃣ Guardando mensaje del grupo");

        const mensaje = await guardarMensajeGrupo({

            sock,

            msg: message,

            texto: ctx.texto,

            grupoId: ctx.chat.remoteJid,

            grupoNombre: null

        });

        console.log("4️⃣ Mensaje guardado");

        if (mensaje) {

            console.log("5️⃣ Clasificando mensaje");

            await clasificarMensaje({

                mensaje,

                ctx

            });

            console.log("6️⃣ Clasificación terminada");

        }

    }

    console.log("7️⃣ eventHandler");

    await eventHandler(ctx);

    console.log("8️⃣ commandHandler");

    await commandHandler(ctx);

    console.log("9️⃣ FIN dispatcher");

};