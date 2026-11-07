// ==========================================================================
// services/sombraCompartir.js — FASE O5: «COMPARTIR TABLA» y PUBLICACIÓN DEL
// SORTEO en MODO SOMBRA.
//
// compartirEnGrupos (services/compartirTabla.js) sigue siendo el ÚNICO que
// genera la imagen y envía. Lo usan «Compartir» del panel, la tabla inicial
// de la automatización, el anuncio de un sorteo (publicación programada,
// instantánea y activación desde el panel). Al terminar el reparto llama aquí
// y el orquestador decide por su cuenta el TEXTO que habría acompañado a la
// imagen, leyendo la fuente única del anuncio (destinosCompartir.
// textoParaCompartir: copia guardada del sorteo, mensaje del panel o texto
// habitual). Se compara con el pie que se envió.
//
// Tipo: solicitudes «sorteo-<id>-publicacion-<n>» (anuncio.js) = publicación
// del sorteo (origen «sorteo», MENSAJES_ORQUESTADOR_SORTEO); el resto =
// «Compartir» (origen «compartir», MENSAJES_ORQUESTADOR_COMPARTIR).
//
// La sombra NO genera la imagen (el orquestador no la pide en sombra), no
// abre Chromium, no envía, no recalcula claves (recibe las que el motor usó:
// la de la llamada manual lleva un UUID nuevo en cada pulsación), no escribe.
// Nunca lanza. Sin la variable: no hace nada, ni siquiera lee.
// ==========================================================================

"use strict";

const { crearOrquestador, comparar, catalogo } = require("../shared/mensajes");
const { resolverModo, MODOS } = require("../shared/mensajes/modos");
const { huella } = require("../shared/mensajes/etapas/registro");
const { vistaPrevia } = require("../automation/sombraInicioDia");

function tipoDeLaSolicitud(solicitudId) {
    return /^sorteo-.+-publicacion-\d+$/.test(String(solicitudId || "")) ? "sorteo_publicacion" : "compartir_tabla";
}

// Adaptador del anuncio: la fuente única del texto (solo lectura).
function crearAdaptadorAnuncio() {
    return {
        variables: async (s) => {
            const { textoParaCompartir } = require("./destinosCompartir");
            const anuncio = await textoParaCompartir(s.usuarioId, s.contexto.evento);
            s.contexto.anuncio = anuncio;
            return { anuncio };
        },
        renderizar: (_contenido, variables) => (variables.anuncio?.ok ? (variables.anuncio.texto ?? "") : null)
    };
}

function resumenGrupos(resultados) {
    const cuenta = {};
    for (const r of resultados || []) cuenta[r.estado] = (cuenta[r.estado] || 0) + 1;
    return cuenta;
}

async function compararCompartirEnSombra({
    evento, sock, grupos = [], caption = "", solicitudId = null, idempotencia = null,
    resultados = [], clavesUsadas = {}, entorno = process.env, log = console.log
} = {}) {

    const tipo = tipoDeLaSolicitud(solicitudId);
    const origen = catalogo.obtenerTipo(tipo).origen;

    try {
        const modoConfigurado = resolverModo(origen, entorno);
        if (modoConfigurado === MODOS.OFF) return { omitida: "modo_off" };

        const usuarioId = evento?.usuario_id;
        const adaptador = crearAdaptadorAnuncio();
        const orquestador = crearOrquestador({
            adaptadores: { [origen]: adaptador },
            modo: () => MODOS.SHADOW,
            registro: { registrar: () => {} }
            // sin `envios` ni `guardian`: imposible enviar o consumir claves.
        });

        const contexto = { evento, anuncio: null };
        const resultado = await orquestador.procesar({
            origen, tipo, usuarioId,
            sesion: { sock },
            destino: { jid: grupos[0]?.grupo_id },
            textoAprobado: "",
            claveEnvioUnico: clavesUsadas[grupos[0]?.grupo_id] || null,
            tipoAccion: idempotencia?.tipoAccion || "TABLA_COMPARTIR",
            contexto
            // sin `imagen`: en sombra nunca se genera.
        }, { modo: MODOS.SHADOW });

        const cmp = comparar(resultado, { enviado: true, texto: caption ?? "" });
        const campos = cmp.diferencias.map(d => d.campo);
        let motivo = null;
        if (resultado.estado === "error") motivo = `error_orquestador:${resultado.motivo}`;
        else if (contexto.anuncio && contexto.anuncio.ok === false) motivo = `anuncio_no_disponible:${contexto.anuncio.motivo}`;
        else if (campos.includes("envio")) motivo = resultado.motivo ? `envio_distinto:${resultado.motivo}` : "envio_distinto";
        else if (campos.includes("texto")) motivo = "texto_distinto";

        const entrada = {
            origen, tipo, modoConfigurado,
            ...(modoConfigurado === MODOS.ACTIVE ? { aviso: "active no está habilitado en O5: solo sombra" } : {}),
            usuarioId,
            precio: Number(evento?.valor) || null,
            grupos: {
                total: grupos.length,
                estados: resumenGrupos(resultados),
                claves: grupos.map(g => huella(clavesUsadas[g.grupo_id] || null))
            },
            fuenteTexto: contexto.anuncio ? { origen: contexto.anuncio.origen, fuente: contexto.anuncio.fuente, activo: contexto.anuncio.activo, revision: contexto.anuncio.revision ?? null } : null,
            imagenGeneradaEnSombra: false,
            actual: { huellaTexto: huella(caption), longitud: typeof caption === "string" ? caption.length : null, vistaPrevia: vistaPrevia(caption) },
            orquestador: { estado: resultado.estado, motivo: resultado.motivo || null, huellaTexto: huella(resultado.texto), longitud: typeof resultado.texto === "string" ? resultado.texto.length : null, vistaPrevia: vistaPrevia(resultado.texto) },
            coincide: motivo === null,
            diferencias: campos,
            motivo
        };

        log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
        return entrada;

    } catch (err) {
        try { log(`[MENSAJES SOMBRA] ${JSON.stringify({ origen, tipo, error: err?.message || String(err) })}`); } catch { /* nunca lanza */ }
        return { omitida: "error", error: err?.message || String(err) };
    }
}

module.exports = { compararCompartirEnSombra, crearAdaptadorAnuncio, tipoDeLaSolicitud };
