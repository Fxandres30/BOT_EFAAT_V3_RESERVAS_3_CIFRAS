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