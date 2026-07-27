const obtenerContexto =
require("../middleware/obtenerContexto");

const {
    guardarMensajeGrupo
} = require("../funciones/mensajes/guardarMensajeGrupo");

const {
    clasificarMensaje
} = require("../funciones/mensajes/clasificarMensaje");

const {
    sincronizarGrupo
} = require("../funciones/grupos/sincronizarGrupo");

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

    const ctx = await obtenerContexto(
        sock,
        message
    );

    if (!ctx)
        return;

    ctx.session = session;
    ctx.tipoConexion = tipo;

    // ==========================
    // Flujo de grupos
    // ==========================

    if (ctx.chat.esGrupo) {

        ctx.grupo = await sincronizarGrupo({

            sock,

            grupoId: ctx.chat.remoteJid

        });

        // Puedes dejar estos logs mientras haces pruebas
        console.log("================================");
        console.log("📝 TEXTO ANTES DE GUARDAR");
        console.log("texto:", ctx.texto);
        console.log("textoOriginal:", ctx.textoOriginal);
        console.log("================================");

        const mensaje = await guardarMensajeGrupo({

            sock,

            msg: message,

            texto: ctx.texto,

            grupoId: ctx.chat.remoteJid,

            grupoNombre: ctx.grupo?.nombre || null

        });

        if (mensaje) {

            await clasificarMensaje({

                mensaje,

                ctx

            });

        }

    }

    // ==========================
    // Eventos
    // ==========================

    await eventHandler(ctx);

    // ==========================
    // Comandos
    // ==========================

    await commandHandler(ctx);

};