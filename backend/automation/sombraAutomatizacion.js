// ==========================================================================
// automation/sombraAutomatizacion.js — FASE O3: AUTOMATIZACIÓN en MODO SOMBRA
// (OPEN_MESSAGE, REMINDER_MESSAGE, UPDATE_MESSAGE, CLOSE_MESSAGE).
//
// engine.enviarMensajeProgramado sigue siendo el ÚNICO que envía. Después de
// decidir (enviar, no enviar por falta de mensajes o de variables, o fallo
// de WhatsApp) llama aquí y el orquestador central calcula por su cuenta qué
// habría enviado. Se comparan: candidatas, último uso, plantilla elegida,
// variables, texto final y resultado.
//
// ÚLTIMO USO (regla «no repetir el último»): el motor lo lee ANTES de enviar
// y, si envía, registra un uso nuevo. Para no confundirse con ese registro:
//   - la comparación usa la FOTO que el selector tomó en su momento
//     (messageSelector, opción `observar`): mismo último uso y mismo azar;
//   - además, el adaptador hace su PROPIA lectura del último uso descartando
//     el que el motor acaba de registrar, y se compara con la foto.
//
// Garantías: solo actúa con MENSAJES_ORQUESTADOR_AUTOMATIZACION = shadow (o
// active, que en O3 es SOLO sombra); el orquestador se crea SIN envíos ni
// guardián; el adaptador solo lee; nunca lanza; sin IA ni imágenes.
// ==========================================================================

"use strict";

const { crearOrquestador, comparar } = require("../shared/mensajes");
const { resolverModo, MODOS } = require("../shared/mensajes/modos");
const { huella } = require("../shared/mensajes/etapas/registro");
const { vistaPrevia } = require("./sombraInicioDia");

const ORIGEN = "automatizacion";

// Huella estable de un objeto de variables (claves ordenadas).
function huellaVariables(variables) {
    if (!variables || typeof variables !== "object") return null;
    const orden = Object.keys(variables).sort().map(k => [k, variables[k] == null ? null : String(variables[k])]);
    return huella(JSON.stringify(orden));
}

// Último mensaje usado ANTES del envío actual (solo lectura).
//   usoRegistrado=true: el motor acaba de registrar el uso de `enviadoId`;
//   se descarta ese registro y se toma el anterior.
async function leerUltimoUsoPrevio({ usuarioId, grupoId, tipo, usoRegistrado, enviadoId }) {
    const supabase = require("../lib/supabase");
    const { data, error } = await supabase
        .from("automation_message_uses")
        .select("message_id, usado_en")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .eq("tipo", tipo)
        .order("usado_en", { ascending: false })
        .limit(2);
    if (error) throw error;
    const filas = data || [];
    if (usoRegistrado && filas[0]?.message_id === enviadoId) return filas[1]?.message_id ?? null;
    return filas[0]?.message_id ?? null;
}

// Adaptador de automatización: reproduce engine.enviarMensajeProgramado.
//   candidatas  = mensajes ACTIVOS del tipo (+ categoría): propios y luego globales (misma consulta y orden)
//   selección   = azar sin repetir el último (catálogo: aleatorio_sin_repetir)
//   variables   = { ...construirVariablesDesdeEvento(evento), ...variablesExtra } (extra PISA: AU8)
//   formato     = variableResolver ({x} y {{x}}; modificadores literales: AU7; valores crudos: AU5)
//   validación  = variable faltante => no se envía (AU6)
function crearAdaptadorAutomatizacion() {
    return {
        bloquearSiFaltan: true,
        candidatas: async (solicitud) => {
            const messagesRepo = require("./repo/messages");
            const filas = await messagesRepo.obtenerMensajesActivos({ usuarioId: solicitud.usuarioId, tipo: solicitud.tipo, categoria: solicitud.contexto.categoria ?? null });
            return (filas || []).map(m => ({ id: m.id, usuario_id: m.usuario_id ?? null, contenido: m.texto, categoria: m.categoria ?? null }));
        },
        preferencias: async (solicitud) => ({ ultimoUsadoId: solicitud.contexto.ultimoUsadoLeido ?? null }),
        variables: async (solicitud) => variablesDe(solicitud.contexto),
        renderizar: (contenido, variables) => {
            const { resolverVariables } = require("./variableResolver");
            const r = resolverVariables(contenido, variables);
            return { texto: r.texto, faltantes: r.faltantes };
        }
    };
}

function variablesDe({ evento, variablesExtra }) {
    const { construirVariablesDesdeEvento } = require("./engine");
    return { ...construirVariablesDesdeEvento(evento), ...(variablesExtra || {}) };
}

const ordenados = (ids) => JSON.stringify([...(ids || [])].sort());

function motivoDiferencia({ cmp, foto, resultado, ultimoUsadoLeido, variablesCoinciden, faltantesCoinciden }) {
    if (foto && ordenados(foto.activosIds) !== ordenados(resultado.candidatas || (resultado.motivo === "sin_plantillas" ? [] : null))) return "candidatas_distintas";
    if (foto?.ultimoLeido && (foto.ultimoId ?? null) !== (ultimoUsadoLeido ?? null)) return "ultimo_uso_distinto";
    if (variablesCoinciden === false) return "variables_distintas";
    if (faltantesCoinciden === false) return "faltantes_distintas";
    const campos = cmp.diferencias.map(d => d.campo);
    if (campos.includes("envio")) return resultado.motivo ? `envio_distinto:${resultado.motivo}` : "envio_distinto";
    if (campos.includes("plantillaId")) return "plantilla_distinta";
    if (campos.includes("texto")) return "texto_distinto";
    return campos.length ? campos.join(",") : null;
}

// datos: { evento, eventSession, tipo, categoria, claveIdempotencia, tipoAccion,
//          variablesExtra, foto, variables?, usoRegistrado?, actual }
async function compararAutomatizacionEnSombra({
    evento, eventSession, tipo, categoria = null, claveIdempotencia, tipoAccion,
    variablesExtra = {}, foto = null, variables = null, usoRegistrado = false, actual,
    entorno = process.env, log = console.log
} = {}) {

    try {
        const modoConfigurado = resolverModo(ORIGEN, entorno);
        if (modoConfigurado === MODOS.OFF) return { omitida: "modo_off" };

        const usuarioId = evento?.usuario_id;
        const grupoId = evento?.grupo_id;

        // Lectura PROPIA del último uso (antes del registro del motor).
        let ultimoUsadoLeido = null;
        let errorUltimoUso = null;
        try {
            ultimoUsadoLeido = await leerUltimoUsoPrevio({ usuarioId, grupoId, tipo, usoRegistrado, enviadoId: actual?.plantillaId });
        } catch (err) {
            errorUltimoUso = err?.message || String(err);
        }

        const contexto = { evento, variablesExtra, categoria, ultimoUsadoLeido };
        const adaptador = crearAdaptadorAutomatizacion();
        const orquestador = crearOrquestador({
            adaptadores: { [ORIGEN]: adaptador },
            modo: () => MODOS.SHADOW,
            registro: { registrar: () => {} }
            // sin `envios` ni `guardian`: imposible enviar o consumir claves.
        });

        const azar = typeof foto?.azar === "number" ? foto.azar : 0;
        const resultado = await orquestador.procesar({
            origen: ORIGEN, tipo, usuarioId,
            destino: { jid: grupoId },
            claveEnvioUnico: claveIdempotencia, tipoAccion, eventSessionId: eventSession?.id,
            contexto,
            aleatorio: () => azar
        }, { modo: MODOS.SHADOW });

        const variablesOrq = variablesDe(contexto);
        const variablesCoinciden = variables ? huellaVariables(variables) === huellaVariables(variablesOrq) : null;
        const faltantesActuales = actual?.faltantes || null;
        const faltantesCoinciden = faltantesActuales ? ordenados(faltantesActuales) === ordenados(resultado.faltantes || []) : null;

        const cmp = comparar(resultado, actual);
        const motivo = motivoDiferencia({ cmp, foto, resultado, ultimoUsadoLeido, variablesCoinciden, faltantesCoinciden });

        const entrada = {
            origen: ORIGEN,
            tipo,
            modoConfigurado,
            ...(modoConfigurado === MODOS.ACTIVE ? { aviso: "active no está habilitado en O3: solo sombra" } : {}),
            usuarioId,
            grupo: huella(grupoId),
            eventSessionId: eventSession?.id ?? null,
            tipoAccion: tipoAccion ?? null,
            categoria,
            seleccion: {
                candidatasActuales: foto?.activosIds ?? null,
                candidatasOrquestador: resultado.candidatas ?? (resultado.motivo === "sin_plantillas" ? [] : null),
                ultimoUsoActual: foto?.ultimoLeido ? (foto.ultimoId ?? null) : "no_leido",
                ultimoUsoOrquestador: errorUltimoUso ? `error: ${errorUltimoUso}` : ultimoUsadoLeido,
                azar: foto?.azar ?? null
            },
            variables: {
                huellaActual: huellaVariables(variables),
                huellaOrquestador: huellaVariables(variablesOrq),
                coinciden: variablesCoinciden,
                faltantesActuales,
                faltantesOrquestador: resultado.faltantes ?? null
            },
            actual: {
                estado: actual?.estado || (actual?.enviado ? "enviado" : "no_enviado"),
                plantillaId: actual?.plantillaId ?? null,
                huellaTexto: huella(actual?.texto),
                longitud: typeof actual?.texto === "string" ? actual.texto.length : null,
                vistaPrevia: vistaPrevia(actual?.texto)
            },
            orquestador: {
                estado: resultado.estado,
                motivo: resultado.motivo || null,
                plantillaId: resultado.plantillaId ?? null,
                huellaTexto: huella(resultado.texto),
                longitud: typeof resultado.texto === "string" ? resultado.texto.length : null,
                vistaPrevia: vistaPrevia(resultado.texto)
            },
            coincide: motivo === null,
            diferencias: cmp.diferencias.map(d => d.campo),
            motivo
        };

        log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
        return entrada;

    } catch (err) {
        try { log(`[MENSAJES SOMBRA] ${JSON.stringify({ origen: ORIGEN, tipo, error: err?.message || String(err) })}`); } catch { /* nunca lanza */ }
        return { omitida: "error", error: err?.message || String(err) };
    }
}

module.exports = { crearAdaptadorAutomatizacion, compararAutomatizacionEnSombra, leerUltimoUsoPrevio, huellaVariables };
