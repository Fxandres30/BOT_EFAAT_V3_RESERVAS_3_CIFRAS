const { detectarEvento } = require("../funciones/eventos/detectarEvento");

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

    ctx.evento = await detectarEvento(ctx);

};