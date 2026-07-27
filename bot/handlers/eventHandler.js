const { detectarEvento } = require("../funciones/eventos/detectarEvento");
const { detectarReserva } = require("../funciones/reservas/detectarReserva");
const { consultarEvento } = require("../funciones/eventos/consultarEvento");

module.exports = async (ctx) => {

    if (!ctx.chat.esGrupo) {
        ctx.evento = null;
        return;
    }

    console.log("==================================");
    console.log("📩 Tipo de mensaje:");
    console.log(Object.keys(ctx.message.message));
    console.log("📤 fromMe:", ctx.message.key.fromMe);
    console.log("📄 Texto detectado:");
    console.log(ctx.textoOriginal || "(vacío)");
    console.log("==================================");

    if (!ctx.textoOriginal) {
        ctx.evento = null;
        return;
    }

    // 👇 AGREGAR ESTO
    console.log("==================================");
    console.log("👤 USUARIO ACTUAL");
    console.dir(ctx.usuario, { depth: null });
    console.log("==================================");

    console.log("==================================");
    console.log("📱 PARTICIPANT:", ctx.message.key.participant);
    console.log("🏠 REMOTE JID:", ctx.message.key.remoteJid);
    console.log("==================================");

    ctx.evento = await detectarEvento(ctx);

    if (!ctx.evento) {

        const grupoId =
            ctx.grupo?.remoteJid ||
            ctx.chat.remoteJid;

        ctx.evento = await consultarEvento(grupoId);

    }

    if (ctx.evento) {

        const resultado = await detectarReserva({

            evento: ctx.evento,
            texto: ctx.textoOriginal,
            nombre: ctx.usuario.nombre,
            telefono: ctx.usuario.telefono,
            lib: ctx.usuario.lid

        });

        ctx.reserva = resultado;

        console.log("📦 Resultado reserva:");
        console.dir(resultado, { depth: null });

    }

};