// Generaliza responderReserva.js (Fase 2) para servir tanto ctx.reserva como
// ctx.consulta con el mismo mecanismo: BOT ya calculó el resultado real,
// esta función SOLO redacta (plantilla seleccionada o Gemini) y envía
// (Baileys); nunca decide ni modifica el negocio.
//
// Fase 5.4: por cada tipo puede haber muchas plantillas HABILITADAS (ya no
// "una activa"); un modo de selección aparte decide cuál se usa en cada
// respuesta (fijo / aleatorio / rotación). Orden de prioridad:
//   1. Config + plantillas habilitadas -> seleccionarPlantilla() elige una -> sustitución determinística (sin IA).
//   2. Sin config / sin habilitadas / selección fallida -> Gemini redacta desde el resultado real (igual que antes de esta fase).
//   3. Si todo falla -> resultado.mensaje (mensaje fijo, siempre disponible).
const { construirContextoReserva } = require("./contextBuilder");
const { suggestReply } = require("./aiService");
const { sendMessage } = require("../../services/baileys/send");
const { obtenerConfigSeleccion, obtenerPlantillasHabilitadas, actualizarRotacion, estaRespuestaHabilitada } = require("./configMensajes");
const { seleccionarPlantilla } = require("./seleccionarPlantilla");
const { construirVariables, aplicarPlantilla, calcularTipoPresentacion } = require("./plantillaMensaje");
const { obtenerVariablesActivas } = require("../../shared/variables/variablesGlobalesRepo");
const { normalizarVariableDinamica } = require("../../shared/variables/catalogoVariables");

// ¿La plantilla lista los números disponibles? ({{numeros_disponibles}},
// con o sin modificador). Solo se usa para excluir esas plantillas cuando
// el sorteo está agotado.
function usaListaDeDisponibles(contenido) {
    return /\{\{\s*numeros_disponibles\b/.test(contenido || "");
}

// ¿La plantilla muestra un importe? Sin precio configurado en el evento,
// esas plantillas dirían "Debes  de un total de ." — no participan.
function usaMontos(contenido) {
    return /\{\{\s*(monto_total|monto_pagado|monto_pendiente|pago_pendiente)\b/.test(contenido || "");
}

// Consultas de números/estado de pago del cliente: la respuesta sale SOLO
// de plantillas del panel o del mensaje fijo de resolverConsulta.js (datos
// reales pagado/pendiente). Nunca Gemini — podía contradecir el estado
// real (afirmar o negar pagos, o "no tienes números" por una cantidad mal
// leída).
const TIPOS_SIN_IA = new Set(["mis_numeros", "mis_reservas", "cantidad_reservas", "consulta_pago", "multiple"]);

// Regla de veracidad (30/10/2026): el estado de un número nunca lo
// interpreta Gemini. Reservas, disponibilidad y consulta de un número salen
// de una plantilla del panel o del mensaje fijo que ya enumera cada número.
const TIPOS_ESTADO_NUMEROS = new Set(["disponibilidad", "numero_especifico"]);

// Devuelve true si el mensaje se envió, false si no (sin resultado,
// tipo desactivado o error de envío). Los llamadores que no lo necesitan
// pueden ignorarlo.
async function responderResultado(ctx) {

    const resultado = ctx.reserva || ctx.consulta;

    if (!resultado || typeof resultado.mensaje !== "string") {
        return false;
    }

    // Respuesta fija actual = fallback obligatorio si todo lo demás falla.
    let texto = resultado.mensaje;
    let iaUtilizada = false;
    let plantillaUtilizada = false;
    let plantillaId = null;

    const tipoPresentacion = calcularTipoPresentacion(ctx, resultado);
    const usuarioId = ctx.session?.usuarioId || null;

    // Fase 5.5: interruptor por tipo de respuesta. El BOT YA ejecutó la
    // operación real (reserva real en Supabase, o consulta ya resuelta)
    // antes de llegar aquí — eso nunca se bloquea. Lo único que decide
    // este interruptor es si se envía el MENSAJE de este tipo. Para
    // reservas, este es el primer punto donde se conoce el tipo real
    // (reserva_completa/reserva_parcial/numero_ocupado/todos_ocupados),
    // porque depende del resultado de la reserva ya ejecutada. Para
    // consultas, ya se comprobó antes en eventHandler.js (evitando la
    // consulta de solo lectura); esta segunda comprobación es la misma
    // fuente de verdad y no cuesta una consulta extra cuando ya se
    // desactivó arriba (esa rama nunca llega hasta aquí).
    if (tipoPresentacion) {

        const habilitada = await estaRespuestaHabilitada(usuarioId, tipoPresentacion);

        if (!habilitada) {

            console.log("[RESPONSE] tipo de respuesta desactivado, silencio →", tipoPresentacion);

            return false;

        }

    }

    // Config. de selección + plantillas habilitadas (Fase 5.4) + variables
    // globales dinámicas del usuario (Fase "Variables Globales") — todo
    // solo lectura, opcional. Si no hay nada configurado, no hay plantillas
    // habilitadas, no hay variables dinámicas, o Supabase falla en
    // cualquiera de las tres, el comportamiento es exactamente el mismo que
    // antes de esta fase (obtenerVariablesActivas ya es best-effort: nunca
    // lanza, nunca bloquea el envío del mensaje).
    // AGOTADO (resolverConsulta: 0 disponibles y la tabla sí tiene números
    // ocupados/reservados/pagados). tipoPresentacion ya es
    // "disponibilidad_agotada" (calcularTipoPresentacion): se usan SOLO las
    // plantillas de agotado del usuario, con el mismo selector de siempre
    // (fijo/aleatorio/rotación) — nunca las de "disponibilidad", escritas
    // para listar números. Nunca Gemini (podría redactar una lista o decir
    // que hay números). Sin plantilla válida -> resultado.mensaje (mensaje
    // fijo de agotado, resolverConsulta.js).
    const esAgotado = resultado.agotado === true;
    const esConsultaDeEstado = !ctx.reserva && TIPOS_SIN_IA.has(resultado.tipo);
    // Fallo técnico de la reserva: solo el mensaje fijo. Ni plantillas ni
    // Gemini, que podrían decir que los números están ocupados.
    const esErrorTecnico = resultado.errorTecnico === true;
    // Estados que ninguna plantilla sabe decir (bloqueado, en proceso, no
    // disponible, no guardado...): solo el mensaje fijo, que los enumera.
    const soloMensajeFijo = resultado.soloMensajeFijo === true;
    const sinIA = Boolean(ctx.reserva) || TIPOS_ESTADO_NUMEROS.has(resultado.tipo);

    // Resguardo: si por cualquier motivo el tipo no fuera el de agotado, no
    // se pide ninguna plantilla (jamás las de "disponibilidad").
    // Las plantillas consulta_pago_<estado> son la presentación de UNA sola
    // respuesta: la de pago (lo pendiente o "estás al día", modo
    // "resumen"). Las preguntas puntuales de la misma familia ("¿cuáles
    // están pagados?", "¿cuántos debo?", "¿cuánto he pagado?") responden
    // con su mensaje fijo: una plantilla de estado no contesta eso.
    const esPreguntaPuntualDePago = resultado.tipo === "consulta_pago" && resultado.modo !== "resumen";

    // Pendientes en OTROS sorteos del cliente (resolverConsulta.js). Una
    // plantilla de "pago completo"/"sin saldo" diría "no debes nada": con
    // deuda en otro sorteo se usa el mensaje fijo, que dice ambas cosas. En
    // las demás, el detalle se añade después del texto de la plantilla.
    const textoOtros = resultado.tipo === "consulta_pago" ? (resultado.textoOtrosPendientes || "") : "";
    const plantillaContradiria = Boolean(textoOtros) &&
        (resultado.estadoPago === "pago_completo" || resultado.estadoPago === "sin_saldo");

    // Lo que la plantilla no menciona y sí es cierto (p. ej. «Ya es tuyo: 12»
    // en una reserva): va después de su texto.
    const anexo = [textoOtros, resultado.textoAdicional || ""].filter(Boolean).join("\n\n");

    const puedeUsarPlantillas = (!esAgotado || tipoPresentacion === "disponibilidad_agotada") && !esPreguntaPuntualDePago && !plantillaContradiria && !esErrorTecnico && !soloMensajeFijo && Boolean(tipoPresentacion);

    let config = null;
    let habilitadas = [];
    let variablesDinamicas = [];

    if (puedeUsarPlantillas) {

        [config, habilitadas, variablesDinamicas] = await Promise.all([
            obtenerConfigSeleccion(tipoPresentacion, usuarioId),
            obtenerPlantillasHabilitadas(tipoPresentacion, usuarioId),
            obtenerVariablesActivas(usuarioId)
        ]);

        // Una plantilla de agotado que (por error) lista
        // {{numeros_disponibles}} enviaría una lista vacía: no participa.
        if (esAgotado) {
            habilitadas = (habilitadas || []).filter(p => !usaListaDeDisponibles(p?.contenido));
        }

        if (esConsultaDeEstado && !(Number(ctx.evento?.valor) > 0)) {
            habilitadas = (habilitadas || []).filter(p => !usaMontos(p?.contenido));
        }

        const catalogoExtra = variablesDinamicas
            .map(normalizarVariableDinamica)
            .filter(Boolean);

        const { plantilla, nuevoIndiceRotacion } = seleccionarPlantilla(config, habilitadas);

        if (plantilla?.contenido) {

            const variables = construirVariables(ctx, resultado, catalogoExtra);

            const resultadoPlantilla = aplicarPlantilla(
                plantilla.contenido,
                variables,
                plantilla.variables || {},
                catalogoExtra
            );

            if (resultadoPlantilla) {

                texto = anexo ? `${resultadoPlantilla}\n\n${anexo}` : resultadoPlantilla;
                plantillaUtilizada = true;
                plantillaId = plantilla.id;

                if (nuevoIndiceRotacion !== null && config?.id) {

                    await actualizarRotacion(config.id, nuevoIndiceRotacion);

                }

            }

        }

    }

    if (esAgotado && !plantillaUtilizada) {

        console.log("[RESPONSE] disponibilidad agotada sin plantilla de agotado válida — mensaje fijo de agotado (sin IA)");

    }

    if (esConsultaDeEstado && !plantillaUtilizada) {

        console.log("[RESPONSE] consulta de números/pago sin plantilla — mensaje fijo con estados reales (sin IA)");

    }

    if (!plantillaUtilizada && sinIA) {

        console.log("[RESPONSE] estado de números sin plantilla aplicable — mensaje fijo con cada número (sin IA)");

    }

    if (!plantillaUtilizada && !esAgotado && !esConsultaDeEstado && !esErrorTecnico && !sinIA) {

        try {

            const contexto = construirContextoReserva(ctx);

            const sugerencia = await suggestReply(contexto);

            if (sugerencia?.respuesta) {

                texto = sugerencia.respuesta;
                iaUtilizada = true;

            }

        }

        catch (error) {

            console.log("⚠️ Fallback a respuesta fija (error inesperado en IA):", error.message);

        }

    }

    const sessionId = ctx.session?.sessionId || null;
    const quotedMessageId = ctx.message?.key?.id || null;

    console.log("[RESPONSE]", {
        remoteJid: ctx.chat.remoteJid,
        fromMe: ctx.message.key.fromMe,
        sessionId,
        quotedMessageId,
        tipo: resultado.tipo || null,
        tipoPresentacion,
        modoSeleccion: config?.modo_seleccion || null,
        plantillaId,
        resultadoOk: resultado.ok ?? null,
        plantillaUtilizada,
        iaUtilizada,
        fallbackUtilizado: !plantillaUtilizada && !iaUtilizada
    });

    try {

        await sendMessage({

            sock: ctx.sock,
            jid: ctx.chat.remoteJid,
            text: texto,
            quoted: ctx.message

        });

        console.log("[RESPONSE] envío exitoso →", ctx.chat.remoteJid);

        return true;

    }

    catch (error) {

        console.log("[RESPONSE] envío con error →", error.message);

        return false;

    }

}

module.exports = {
    responderResultado
};
