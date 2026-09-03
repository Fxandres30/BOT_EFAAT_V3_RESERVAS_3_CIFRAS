const { detectarEvento } = require("../funciones/eventos/detectarEvento");
const { detectarReserva } = require("../funciones/reservas/detectarReserva");
const { consultarEvento } = require("../funciones/eventos/consultarEvento");
const { detectarIntencion } = require("../funciones/consultas/detectarIntencion");
const { resolverConsulta } = require("../funciones/consultas/resolverConsulta");
const { responderResultado } = require("../ai/responderResultado");
const { estaRespuestaHabilitada } = require("../ai/configMensajes");

module.exports = async (ctx) => {

    if (!ctx.chat.esGrupo) {

        ctx.evento = null;

        return;

    }

    console.log("==================================");
    console.log("📩 Tipo de mensaje:");
    console.log(Object.keys(ctx.message.message || {}));
    console.log("📤 fromMe:", ctx.message.key.fromMe);
    console.log("📄 Texto detectado:");
    console.log(ctx.textoOriginal || "(vacío)");
    console.log("==================================");

    if (!ctx.textoOriginal) {

        ctx.evento = null;

        return;

    }

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

    if (!ctx.evento)
        return;

    // ==========================================
    // Validar usuario
    // ==========================================

    if (!ctx.usuario) {

        console.log("❌ No existe ctx.usuario");

        return;

    }

    console.log("==================================");
    console.log("👤 Usuario enviado a reserva");
    console.dir(ctx.usuario, { depth: null });
    console.log("==================================");

    if (ctx.message.key.fromMe) {
        console.log("⏭️ Mensaje propio del bot (fromMe) — no se procesa como reserva.");
        return;
    }

    // ==========================================
    // FASE 4.1: motor de intenciones (determinístico, sin IA)
    // ==========================================

    const intencion = detectarIntencion(ctx.textoOriginal);

    console.log("🧭 Intención detectada:", intencion.tipo);

    if (intencion.tipo === "ninguna") {
        return;
    }

    if (intencion.tipo === "consulta_pago") {

        console.log("💰 Consulta de pago reconocida, no implementada todavía — silencio.");

        return;

    }

    if (intencion.tipo === "reserva") {

        const resultado = await detectarReserva({

            evento: ctx.evento,

            texto: ctx.textoOriginal,

            usuario: ctx.usuario,

            lib: ctx.usuario.lid

        });

        ctx.reserva = resultado;

        console.log("==================================");
        console.log("📦 Resultado reserva");
        console.dir(resultado, { depth: null });
        console.log("==================================");

        await responderResultado(ctx);

        return;

    }

    // Intención de consulta (mis_numeros, mis_reservas, cantidad_reservas,
    // numero_especifico, disponibilidad, info_evento) — solo lectura.
    //
    // Fase 5.5: el interruptor por tipo se comprueba AQUÍ, antes de
    // ejecutar resolverConsulta() — así, si el tipo está desactivado, no
    // se hace ninguna consulta de negocio innecesaria (ni se llama a
    // Gemini ni se envía WhatsApp). Esto NUNCA aplica a reservas: la
    // reserva real siempre se ejecuta (ver bloque "reserva" arriba); el
    // interruptor de reservas se evalúa más adelante, dentro de
    // responderResultado(), una vez se sabe el resultado real.
    const usuarioId = ctx.session?.usuarioId || null;
    const habilitada = await estaRespuestaHabilitada(usuarioId, intencion.tipo);

    if (!habilitada) {

        console.log(`🔇 Tipo de respuesta "${intencion.tipo}" desactivado — silencio, sin consultar Supabase.`);

        return;

    }

    const resultadoConsulta = await resolverConsulta({

        tipo: intencion.tipo,

        numeros: intencion.numeros,

        evento: ctx.evento,

        usuario: ctx.usuario

    });

    ctx.consulta = resultadoConsulta;

    console.log("==================================");
    console.log("🔎 Resultado consulta:", intencion.tipo);
    console.dir(resultadoConsulta, { depth: null });
    console.log("==================================");

    await responderResultado(ctx);

};