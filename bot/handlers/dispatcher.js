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

        console.log("3️⃣ Antes de sincronizarGrupo");

        ctx.grupo = await sincronizarGrupo({

            sock,

            grupoId: ctx.chat.remoteJid

        });

        console.log("4️⃣ Después de sincronizarGrupo");

        console.log("================================");
        console.log("📝 TEXTO ANTES DE GUARDAR");
        console.log("texto:", ctx.texto);
        console.log("textoOriginal:", ctx.textoOriginal);
        console.log("================================");

        console.log("5️⃣ Antes de guardarMensajeGrupo");

        const mensaje = await guardarMensajeGrupo({

            sock,

            msg: message,

            texto: ctx.texto,

            grupoId: ctx.chat.remoteJid,

            grupoNombre: ctx.grupo?.nombre || null

        });

        console.log("6️⃣ Después de guardarMensajeGrupo");

        if (mensaje) {

            console.log("7️⃣ Antes de clasificarMensaje");

            await clasificarMensaje({

                mensaje,

                ctx

            });

            console.log("8️⃣ Después de clasificarMensaje");

        }

    }

    console.log("9️⃣ Antes de eventHandler");

    await eventHandler(ctx);

    console.log("🔟 Después de eventHandler");

    console.log("1️⃣1️⃣ Antes de commandHandler");

    await commandHandler(ctx);

    console.log("1️⃣2️⃣ FIN dispatcher");

};