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

    const inicio = Date.now();

    try {

        console.log("================================");
        console.log("🚀 INICIO DISPATCHER");
        console.log("================================");

        console.log("1️⃣ Entró a dispatcher");

        console.time("⏱ obtenerContexto");

        const ctx = await obtenerContexto(
            sock,
            message
        );

        console.timeEnd("⏱ obtenerContexto");

        console.log("2️⃣ Contexto obtenido");

        if (!ctx) {

            console.log("⛔ ctx es null");

            return;

        }

        ctx.session = session;
        ctx.tipoConexion = tipo;

        if (ctx.chat.esGrupo) {

            console.log("3️⃣ Guardando mensaje del grupo");

            console.time("⏱ guardarMensajeGrupo");

            const mensaje = await guardarMensajeGrupo({

                sock,

                msg: message,

                texto: ctx.texto,

                grupoId: ctx.chat.remoteJid,

                grupoNombre: null

            });

            console.timeEnd("⏱ guardarMensajeGrupo");

            console.log("4️⃣ Mensaje guardado");

            if (mensaje) {

                console.log("5️⃣ Clasificando mensaje");

                console.time("⏱ clasificarMensaje");

                await clasificarMensaje({

                    mensaje,

                    ctx

                });

                console.timeEnd("⏱ clasificarMensaje");

                console.log("6️⃣ Clasificación terminada");

            }

        }

        console.log("7️⃣ eventHandler");

        console.time("⏱ eventHandler");

        await eventHandler(ctx);

        console.timeEnd("⏱ eventHandler");

        console.log("8️⃣ commandHandler");

        console.time("⏱ commandHandler");

        await commandHandler(ctx);

        console.timeEnd("⏱ commandHandler");

        console.log("9️⃣ FIN dispatcher");

        console.log(
            `✅ Dispatcher terminado en ${Date.now() - inicio} ms`
        );

    } catch (error) {

        console.log("================================");
        console.log("❌ ERROR EN DISPATCHER");
        console.log("================================");

        console.error(error);

        if (error?.stack) {

            console.error(error.stack);

        }

    }

};