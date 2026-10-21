const { detectarEvento } = require("../funciones/eventos/detectarEvento");
const { detectarReserva } = require("../funciones/reservas/detectarReserva");
const { reaccionarAlMensaje } = require("../funciones/reservas/reaccionReserva");
const { consultarEvento } = require("../funciones/eventos/consultarEvento");
const { detectarIntencion } = require("../funciones/consultas/detectarIntencion");
const { resolverConsulta } = require("../funciones/consultas/resolverConsulta");
const { responderResultado } = require("../ai/responderResultado");
const { estaRespuestaHabilitada } = require("../ai/configMensajes");
const { obtenerContenido } = require("../middleware/normalizarMensaje");
const { esCuentaIgnorada } = require("../funciones/mensajes/cuentasIgnoradas");
const controlDisponibilidad = require("../funciones/consultas/controlDisponibilidad");

// Imagen, video o documento (con o sin pie de foto), también dentro de
// envoltorios efímeros / "ver una vez" / documento con pie.
function esMensajeConArchivo(message) {
    const contenido = obtenerContenido(message?.message);
    return !!(contenido?.imageMessage || contenido?.videoMessage || contenido?.documentMessage);
}
const { enmascararJid } = require("../utils/enmascararJid");

// Diagnóstico del ciclo de vida (Paso 0) — solo observa.
const cicloMensaje = require("../../diagnostico/cicloMensaje");

// Interruptor previo a la consulta. "consulta_pago" ya no es un tipo del
// panel (se reparte en consulta_pago_sin_pago/_pago_parcial/
// _pago_completo/_sin_saldo según el estado REAL, que solo se conoce tras
// leer los números): su interruptor lo aplica responderResultado() con esa
// clave por estado. Comprobar aquí la clave antigua podía silenciar todas
// las consultas de pago por una fila heredada que el panel ya no muestra.
async function interruptorPrevioHabilitado(usuarioId, tipo) {

    if (tipo === "consulta_pago") {
        return true;
    }

    return estaRespuestaHabilitada(usuarioId, tipo);

}

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

    // Sin datos personales en claro: id interno del usuario y JID enmascarados.
    console.log("👤 [MENSAJE GRUPO]", {
        usuarioId: ctx.usuario?.id ?? null,
        participant: enmascararJid(ctx.message.key.participant),
        grupo: enmascararJid(ctx.message.key.remoteJid)
    });

    ctx.evento = await detectarEvento(ctx);

    cicloMensaje.etapa("detectarEvento", { EVENTO_DETECTADO_EN_ESTE_MENSAJE: !!ctx.evento });

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

    // Foto / video / documento (p. ej. un comprobante con pie de foto): ya
    // quedó registrado y pudo anunciar un sorteo (detectarEvento, arriba),
    // pero su pie de foto NUNCA se interpreta como reserva ni consulta.
    if (esMensajeConArchivo(ctx.message)) {
        console.log("📎 Mensaje con archivo — no se evalúa como reserva ni consulta.");
        return;
    }

    // Avisos de las cuentas operativas indicadas (decisión D2): no son
    // pedidos de clientes.
    if (esCuentaIgnorada({ message: ctx.message, usuario: ctx.usuario })) {
        console.log("⏭️ Cuenta ignorada para reservas/consultas — mensaje solo registrado.");
        return;
    }

    // ==========================================
    // FASE 4.1: motor de intenciones (determinístico, sin IA)
    // ==========================================

    const intencion = detectarIntencion(ctx.textoOriginal, ctx.evento?.cifras);

    console.log("🧭 Intención detectada:", intencion.tipo);

    cicloMensaje.etapa("detectarIntencion", { INTENCION: intencion.tipo });

    if (intencion.tipo === "ninguna") {
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

        cicloMensaje.etapa("detectarReserva");

        console.log("==================================");
        console.log("📦 Resultado reserva");
        console.dir(resultado, { depth: null });
        console.log("==================================");

        const respondido = await responderResultado(ctx);

        // ✅/❌ sobre el mensaje del cliente, DESPUÉS de la respuesta de
        // siempre y solo si esa respuesta salió (si el tipo está desactivado
        // el bot sigue en silencio). Nunca lanza.
        if (respondido && resultado?.reaccion) {
            await reaccionarAlMensaje({ ctx, emoji: resultado.reaccion });
        }

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

    // Fase "consultas combinadas": "mis números y cuánto debo" trae varias
    // sub-intenciones (ver detectarIntencion.js). Cada una respeta SU
    // PROPIO interruptor de tipo — si el tenant desactivó "mis_numeros",
    // la combinada responde solo la parte habilitada; si ninguna sigue
    // habilitada, silencio total (mismo criterio que el resto de tipos,
    // sin excepción nueva). La parte de pago no tiene interruptor previo
    // (ver interruptorPrevioHabilitado); la respuesta combinada respeta el
    // interruptor "multiple" en responderResultado().
    if (intencion.tipo === "multiple") {

        const subIntencionesHabilitadas = [];

        for (const sub of intencion.intenciones) {

            const habilitadaSub = await interruptorPrevioHabilitado(usuarioId, sub.tipo);

            if (habilitadaSub) {
                subIntencionesHabilitadas.push(sub);
            }

        }

        if (subIntencionesHabilitadas.length === 0) {

            console.log("🔇 Todas las sub-intenciones de la consulta combinada están desactivadas — silencio, sin consultar Supabase.");

            return;

        }

        const resultadoCombinado = await resolverConsulta({

            tipo: "multiple",
            intenciones: subIntencionesHabilitadas,
            evento: ctx.evento,
            usuario: ctx.usuario

        });

        ctx.consulta = resultadoCombinado;

        console.log("==================================");
        console.log("🔎 Resultado consulta combinada:", subIntencionesHabilitadas.map(s => s.tipo));
        console.dir(resultadoCombinado, { depth: null });
        console.log("==================================");

        await responderResultado(ctx);

        return;

    }

    const habilitada = await interruptorPrevioHabilitado(usuarioId, intencion.tipo);

    if (!habilitada) {

        console.log(`🔇 Tipo de respuesta "${intencion.tipo}" desactivado — silencio, sin consultar Supabase.`);

        return;

    }

    // Disponibilidad: una sola respuesta por ráfaga ("tabla", "actualiza",
    // dos clientes a la vez...) — ver controlDisponibilidad.js. La tabla
    // siempre se lee fresca de Supabase cuando sí se responde.
    if (intencion.tipo === "disponibilidad") {

        const turno = {
            grupoId: ctx.chat.remoteJid,
            usuarioId: ctx.usuario?.id || null
        };

        const permiso = controlDisponibilidad.solicitarTurno(turno);

        if (!permiso.permitido) {

            console.log(`⏭️ [DISPONIBILIDAD] pedido omitido (${permiso.motivo}) — la tabla vigente ya se envió o se está enviando.`);
            cicloMensaje.etapa("disponibilidad", { DECISION: "OMITIDA", MOTIVO: permiso.motivo });

            return;

        }

        let enviado = false;

        try {

            ctx.consulta = await resolverConsulta({

                tipo: intencion.tipo,
                numeros: intencion.numeros,
                evento: ctx.evento,
                usuario: ctx.usuario

            });

            console.log("==================================");
            console.log("🔎 Resultado consulta:", intencion.tipo);
            console.dir(ctx.consulta, { depth: null });
            console.log("==================================");

            enviado = await responderResultado(ctx) === true;

        } finally {

            controlDisponibilidad.finalizarTurno({ ...turno, enviado, token: permiso.token });

        }

        return;

    }

    const resultadoConsulta = await resolverConsulta({

        tipo: intencion.tipo,

        numeros: intencion.numeros,

        evento: ctx.evento,

        usuario: ctx.usuario,

        // Solo consulta_pago los usa (modo: lista/cantidad/monto; bucket:
        // pendiente/pagado/total) — el resto de tipos los ignora sin
        // efecto, ver resolverConsulta.js.
        modo: intencion.modo,

        bucket: intencion.bucket

    });

    ctx.consulta = resultadoConsulta;

    console.log("==================================");
    console.log("🔎 Resultado consulta:", intencion.tipo);
    console.dir(resultadoConsulta, { depth: null });
    console.log("==================================");

    await responderResultado(ctx);

};