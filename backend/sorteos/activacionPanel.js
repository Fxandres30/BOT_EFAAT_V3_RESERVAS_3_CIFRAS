// ==========================================================================
// ENTRADA DEL PANEL al núcleo de activación (F4-E, 06/11/2026).
//
// publicador.publicarEnGrupo comprueba lo propio de la publicación (día
// programado, cierre, conflictos del grupo, tabla, evento no terminado) y
// llama aquí (publicarDestino). Este módulo:
//   - publica UNA vez el sorteo en el grupo entre programaciones (K3,
//     publicacionPorGrupo.js, F4-F);
//   - obtiene la imagen y relee el evento (la captura tarda);
//   - prepara los datos del panel para el núcleo (perfil, evento a guardar,
//     motivo de los reemplazos);
//   - invoca el núcleo (bot/funciones/eventos/lifecycle/activarEvento.js);
//   - traduce su resultado a los cambios del destino (sorteos_programados_
//     grupos), con los mismos estados y mensajes de siempre.
// ==========================================================================

"use strict";

const { activarEnGrupo, entradaDelPanel } = require("../bot/funciones/eventos/lifecycle/activarEvento");
const { finDelEvento } = require("../shared/eventos/estadosGestion");
const publicacionPorGrupo = require("./publicacionPorGrupo");

const ERROR_IMAGEN = "No se pudo generar la imagen de la tabla";

const COMO_TERMINO = {
    cerrado: "ya está cerrado",
    cancelado: "fue cancelado",
    desactivado: "fue desactivado",
    eliminado: "fue eliminado",
    sustituido: "fue sustituido por otro sorteo"
};

// El evento del sorteo en el grupo ya terminó: no se publica ni se reactiva.
function eventoTerminado(fin) {
    const siguiente = fin === "eliminado"
        ? "Para volver a publicarlo, programa un sorteo con otra fecha, hora o valor."
        : "Para continuar, reábrelo en Eventos y pulsa «Reintentar».";
    return { estado: "requiere_revision", ultimo_error: `El sorteo de este grupo ${COMO_TERMINO[fin]}: no se publicó ni se reactivó. ${siguiente}` };
}

// Resultado del núcleo -> cambios del destino.
function cambiosDelDestino(r, { sorteo, ahora }) {
    const base = r.evento ? { evento_bot_id: r.evento.id } : {};
    switch (r.resultado) {
        case "activado":
            return { ...base, estado: "publicado", version_publicada: sorteo.version, publicado_en: ahora.toISOString(), ultimo_error: null };
        case "precio_sin_revisar":
            return { estado: "fallido", ultimo_error: "No se pudo revisar el sorteo anterior de este precio; no se publicó. Se reintentará." };
        case "precio_sin_reemplazar":
            return { estado: "fallido", ultimo_error: `No se pudo reemplazar el sorteo anterior (${r.error?.message || "error"}); no se publicó. Se reintentará.` };
        case "sin_guardar":
            return { estado: "fallido", ultimo_error: "No se pudo guardar el evento; se reintentará." };
        case "activacion_en_curso":
            // F4-F (C2): otra operación está creando la fila de este sorteo en
            // el grupo y no terminó a tiempo: el siguiente intento la adopta.
            return { estado: "fallido", ultimo_error: "Otra operación está activando este sorteo en el grupo; se reintentará." };
        case "sin_texto":
            return { ...base, estado: "fallido", ultimo_error: "No se pudo preparar el texto del anuncio del sorteo; no se envió nada. Se reintentará." };
        case "sin_apertura":
            return { ...base, estado: "fallido", ultimo_error: "WhatsApp no confirmó la apertura del grupo: no se envió el anuncio. Se reintentará." };
        case "anuncio_rechazado":
            // Rechazado antes de enviar (sin sesión, imagen inválida...).
            return { ...base, estado: "fallido", ultimo_error: `No se envió el anuncio (${r.envio.motivo}); se reintentará.` };
        case "anuncio_sin_registro":
            // El registro de idempotencia no se pudo crear: NO se envió.
            return { ...base, estado: "fallido", ultimo_error: "No se pudo registrar el envío; se reintentará." };
        case "anuncio_incierto":
            // Falló el envío, o un intento anterior quedó a medias: no se
            // sabe con certeza si llegó. Nunca se reenvía solo.
            return {
                ...base,
                estado: "requiere_revision",
                ultimo_error: r.envio.motivo === "fallo_ejecucion"
                    ? `El anuncio no se pudo enviar: ${r.envio.error}`
                    : `Estado del anuncio incierto (${r.envio.motivo}); revisa el grupo antes de reintentar.`
            };
        default:
            throw new Error(`activacionPanel: resultado inesperado del núcleo: ${r.resultado}`);
    }
}

// -> los cambios del destino ({ estado, ultimo_error, evento_bot_id, … }).
async function activarDestino({ sock, sorteo, grupo, eventoAnterior = null, delGrupo = [], imagen, fechaSorteo, ahora, deps, solicitado = false }) {
    const config = sorteo.config;
    const r = await activarEnGrupo({
        entrada: entradaDelPanel({ sorteo, grupo, solicitado }),
        sock,
        usuarioId: sorteo.usuario_id,
        grupoId: grupo.grupo_id,
        valor: config.valor,
        identidad: sorteo.identidad_evento_real,
        excepto: eventoAnterior?.id || null,
        motivoReemplazo: `sustituido por el sorteo ${config.nombre || ""} ${config.hora_fin || ""}`.trim(),
        datosEvento: {
            sock,
            grupoId: grupo.grupo_id,
            evento: {
                nombre: config.nombre,
                hora: config.hora_fin,
                horaCierre: config.hora_cierre,
                valor: config.valor,
                premios: config.premios || [],
                tabla: sorteo.tabla,
                // Rifa elegida para el sorteo (051; null en el motor legado).
                tabla_id: sorteo.tabla_id ?? null,
                cifras: sorteo.cifras,
                cantidad_numeros: sorteo.cantidad_numeros
            },
            eventoAnterior,
            sorteoVigente: { identidad_evento_real: sorteo.identidad_evento_real, fecha_evento: fechaSorteo, tabla_id: sorteo.tabla_id ?? null }
        },
        sorteo, grupo, delGrupo, imagen, ahora,
        deps: {
            db: deps.supabase,
            guardarEvento: deps.guardarEvento,
            actualizarEvento: deps.actualizarEvento,
            textoParaCompartir: deps.textoParaCompartir,
            abrirGrupo: deps.abrirGrupo,
            compartirEnGrupos: deps.compartirEnGrupos,
            consultarEventoDelSorteo: deps.consultarEventoDelSorteo || require("../bot/funciones/eventos/consultarEvento").consultarEventoDelSorteo,
            motor: deps.motorEventos || require("../automation/motorEventos")
        }
    });
    return cambiosDelDestino(r, { sorteo, ahora });
}

// La imagen es obligatoria y va ANTES de crear o tocar el evento: si no se
// puede generar, no se escribe nada. Lo que publica «Compartir» para este
// sorteo: la tabla del precio con el diseño guardado en el sorteo.
// -> { imagen } | { cambios }
async function imagenDelSorteo({ sorteo, deps }) {
    const config = sorteo.config;
    let imagen;
    try {
        // F4-G: imagen de la tabla de ESTE momento (capturaProgramada.js):
        // la del panel si la acaba de capturar con la misma huella; si no
        // (p. ej. un programado a su hora), el mismo capturarTabla en
        // Chromium headless. Nunca una imagen antigua.
        imagen = await deps.capturarImagen(Number(config.valor), sorteo.usuario_id, null, { sorteoId: sorteo.id, sorteo, captura: config.captura, disenoSorteo: config.diseno || null });
    } catch (err) {
        // La imagen guardada no vale (no existe o la tabla cambió): repetir no
        // lo arregla; el administrador vuelve a capturar con «Reintentar».
        if (err?.revision) {
            return { cambios: { estado: "requiere_revision", ultimo_error: `${ERROR_IMAGEN}: ${err.message} No se envió nada.` } };
        }
        // Falta configuración: repetir daría el mismo error. Lo arregla una
        // persona y luego pide el reintento.
        if (err?.configuracion) {
            return { cambios: { estado: "requiere_revision", ultimo_error: `${ERROR_IMAGEN} por la configuración del servidor: ${err.message} No se envió nada. Cuando esté corregida, pulsa «Reintentar».` } };
        }
        return { cambios: { estado: "fallido", ultimo_error: `${ERROR_IMAGEN} (${err?.message || err}); no se envió nada. Se reintentará.` } };
    }
    if (!Buffer.isBuffer(imagen) || !imagen.length) {
        return { cambios: { estado: "fallido", ultimo_error: `${ERROR_IMAGEN} (no se obtuvo un PNG válido); no se envió nada. Se reintentará.` } };
    }
    return { imagen };
}

// ==========================================================================
// publicarDestino: imagen → relectura → activación, UNA vez por sorteo y
// grupo entre programaciones (K3). -> los cambios del destino.
//   buscarEventoDelSorteo  consultarEventoDelSorteo (del publicador)
//   esperar(motivo)        cambios de un destino «en espera» (del publicador)
// ==========================================================================
async function publicarDestino({ sock, sorteo, grupo, delGrupo = [], fechaSorteo, ahora, deps, solicitado = false, buscarEventoDelSorteo, esperar }) {
    const usuarioId = sorteo.usuario_id;
    const grupoId = grupo.grupo_id;

    return publicacionPorGrupo.publicarUnaVez({
        db: deps.supabase, usuarioId, grupoId, identidad: sorteo.identidad_evento_real, sorteoId: sorteo.id, version: sorteo.version, esperar,
        publicar: async () => {
            const img = await imagenDelSorteo({ sorteo, deps });
            if (img.cambios) return img.cambios;

            // La captura tarda: el evento se vuelve a leer justo antes de
            // escribir, por si el administrador lo cerró entretanto.
            const releido = await buscarEventoDelSorteo(grupoId, usuarioId, sorteo.identidad_evento_real);
            if (!releido.ok) return { estado: "fallido", ultimo_error: "No se pudo comprobar el evento del grupo; se reintentará." };
            if (finDelEvento(releido.data)) return eventoTerminado(finDelEvento(releido.data));

            return activarDestino({ sock, sorteo, grupo, eventoAnterior: releido.data, delGrupo, imagen: img.imagen, fechaSorteo, ahora, deps, solicitado });
        }
    });
}

module.exports = { publicarDestino, activarDestino, cambiosDelDestino, eventoTerminado, ERROR_IMAGEN };
