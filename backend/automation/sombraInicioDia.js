// ==========================================================================
// automation/sombraInicioDia.js — FASE O2: Inicio del día en MODO SOMBRA.
//
// El scheduler sigue siendo el ÚNICO que envía. Después de su envío (o de su
// decisión de no enviar), llama aquí para que el orquestador central
// (shared/mensajes) calcule, por su cuenta, qué habría enviado, y se compare.
//
// Garantías:
//   - Solo actúa si MENSAJES_ORQUESTADOR_INICIO_DIA = shadow (o active, que
//     en O2 se trata igual: SOLO sombra). Sin la variable: no hace nada, ni
//     siquiera lee.
//   - El orquestador se crea SIN funciones de envío y SIN guardián: enviar o
//     consumir una clave es estructuralmente imposible desde aquí.
//   - El adaptador solo LEE (las mismas plantillas que el motor actual) y da
//     formato con el MISMO resolvedor; no hay IA ni imágenes en este tipo.
//   - Nunca lanza.
//
// Comparación: una línea «[MENSAJES SOMBRA]» con JSON. Sin teléfonos: el
// grupo va como huella; los textos como huella + longitud + vista previa
// corta con cualquier secuencia larga de dígitos tapada.
// ==========================================================================

"use strict";

const { crearOrquestador, comparar } = require("../shared/mensajes");
const { resolverModo, MODOS } = require("../shared/mensajes/modos");
const { huella } = require("../shared/mensajes/etapas/registro");
const { construirContextoGlobal } = require("../shared/variables/contextoVariables");
const { resolverTexto } = require("../shared/variables/resolverVariables");

const ORIGEN = "inicio_dia";
const TIPO = "inicio_dia";

// Adaptador de Inicio del día: reproduce el motor actual (scheduler.js).
//   candidatas  = plantillas_mensaje del cliente, tipo inicio_dia, habilitadas (misma consulta)
//   selección   = azar simple del catálogo (ignora interruptor y modo del panel, como hoy: ID4)
//   formato     = resolverTexto + contexto global SIN evento (líneas vacías incluidas: ID5)
//   respaldo    = ninguno (sin plantillas no se envía: ID3)
function crearAdaptadorInicioDia({ repo }) {
    return {
        candidatas: async (solicitud) => {
            const filas = await repo.obtenerPlantillasHabilitadas(solicitud.usuarioId, TIPO);
            return (filas || []).map(p => ({ ...p, usuario_id: p.usuario_id ?? solicitud.usuarioId }));
        },
        renderizar: (contenido) => resolverTexto(contenido, construirContextoGlobal({}))
    };
}

// Vista previa sin datos sensibles: corta y con las secuencias largas de
// dígitos (teléfonos, cuentas) tapadas.
function vistaPrevia(texto, max = 120) {
    if (typeof texto !== "string") return null;
    const tapado = texto.replace(/\d[\d\s.\-]{5,}\d/g, "•••");
    return tapado.length > max ? `${tapado.slice(0, max)}…` : tapado;
}

function motivoDiferencia(cmp, candidatasActuales, candidatasOrquestador, resultado) {
    const campos = cmp.diferencias.map(d => d.campo);
    if (!campos.length) return null;
    const mismasCandidatas = JSON.stringify([...(candidatasActuales || [])].sort()) === JSON.stringify([...(candidatasOrquestador || [])].sort());
    if (!mismasCandidatas) return "candidatas_distintas";
    if (campos.includes("envio")) return resultado?.motivo ? `envio_distinto:${resultado.motivo}` : "envio_distinto";
    if (campos.includes("plantillaId")) return "plantilla_distinta";
    if (campos.includes("texto")) return "texto_distinto";
    return campos.join(",");
}

// actual: { enviado: boolean (decidió enviar), texto?, plantillaId?, estado? }
// -> la entrada registrada, o { omitida: motivo }
async function compararInicioDiaEnSombra({
    usuarioId, grupoId, fecha, azar = 0, candidatasActuales = [], actual,
    entorno = process.env, repo = null, log = console.log
} = {}) {

    try {
        const modoConfigurado = resolverModo(ORIGEN, entorno);
        if (modoConfigurado === MODOS.OFF) return { omitida: "modo_off" };

        const orquestador = crearOrquestador({
            adaptadores: { [ORIGEN]: crearAdaptadorInicioDia({ repo: repo || require("./repo/plantillasMensaje") }) },
            modo: () => MODOS.SHADOW,
            registro: { registrar: () => {} }
            // sin `envios` ni `guardian`: imposible enviar o consumir claves.
        });

        const resultado = await orquestador.procesar({
            origen: ORIGEN, tipo: TIPO, usuarioId,
            destino: { jid: grupoId },
            claveEnvioUnico: `${grupoId}:DAILY_START_MESSAGE:${fecha}`,
            aleatorio: () => azar
        }, { modo: MODOS.SHADOW });

        const cmp = comparar(resultado, actual);
        const entrada = {
            origen: ORIGEN,
            tipo: TIPO,
            modoConfigurado,
            ...(modoConfigurado === MODOS.ACTIVE ? { aviso: "active no está habilitado en O2: solo sombra" } : {}),
            usuarioId,
            grupo: huella(grupoId),
            fecha,
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
            coincide: cmp.coincide,
            diferencias: cmp.diferencias.map(d => d.campo),
            motivo: motivoDiferencia(cmp, candidatasActuales, resultado.candidatas, resultado)
        };

        log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
        return entrada;

    } catch (err) {
        try { log(`[MENSAJES SOMBRA] ${JSON.stringify({ origen: ORIGEN, error: err?.message || String(err) })}`); } catch { /* nunca lanza */ }
        return { omitida: "error", error: err?.message || String(err) };
    }
}

module.exports = { crearAdaptadorInicioDia, compararInicioDiaEnSombra, vistaPrevia };
