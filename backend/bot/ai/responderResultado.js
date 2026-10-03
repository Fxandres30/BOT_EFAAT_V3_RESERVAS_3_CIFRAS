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

async function responderResultado(ctx) {

    const resultado = ctx.reserva || ctx.consulta;

    if (!resultado || typeof resultado.mensaje !== "string") {
        return;
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

            return;

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

    // Resguardo: si por cualquier motivo el tipo no fuera el de agotado, no
    // se pide ninguna plantilla (jamás las de "disponibilidad").
    const puedeUsarPlantillas = !esAgotado || tipoPresentacion === "disponibilidad_agotada";

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

                texto = resultadoPlantilla;
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

    if (!plantillaUtilizada && !esAgotado) {

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

    }

    catch (error) {

        console.log("[RESPONSE] envío con error →", error.message);

    }

}

module.exports = {
    responderResultado
};
