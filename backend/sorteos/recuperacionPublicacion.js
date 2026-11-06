// ==========================================================================
// RECUPERACIÓN DE PUBLICACIONES INTERRUMPIDAS (F4-G, 06/11/2026).
//
// Antes vivía en el publicador (recuperarAtascados). Un destino que sigue
// «publicando» más de UMBRALES.PUBLICACION_ATASCADA_MS es de un proceso que
// murió: lo que se hace lo decide el REGISTRO de su anuncio (automation/
// recuperacion.estadoDelEnvio), nunca solo el tiempo:
//
//   confirmado   el anuncio llegó: «publicado» y el evento pasa por el motor
//                central con la hora REAL del anuncio. Nada se reenvía.
//   incierto     la caída fue DURANTE el envío: revisión manual (nunca se
//                reenvía solo; WhatsApp no permite comprobarlo).
//   fallido      el envío falló: revisión manual (como siempre).
//   no_iniciado  nada salió: un intento fallido más (el programado se
//                reintenta solo; el instantáneo queda para «Reintentar»).
//
// K3 (F4-G): ese resultado CONOCIDO se entrega a publicacionPorGrupo.
// publicarUnaVez sin enviar nada. Así el reclamo PUBLICAR_SORTEO queda
// coherente con lo que pasó:
//   - era suyo (lo dejó «en curso» la caída) → lo retoma y lo cierra con el
//     resultado: ok si llegó (queda como propietaria); error si no o es
//     incierto (otras programaciones del mismo sorteo ESPERAN: un anuncio
//     incierto nunca se repite desde otra);
//   - es de otra programación que ya publicó → ADOPTA su publicación.
// Cada cambio va condicionado a que el destino siga «publicando» (nunca pisa
// a otro proceso ni a una cancelación). Nunca lanza.
// ==========================================================================

"use strict";

const repo = require("./repo");
const { finDelEvento } = require("../shared/eventos/estadosGestion");
const { UMBRALES, ENVIO, estadoDelEnvio } = require("../automation/recuperacion");
const estado = require("./estadoPublicacion");
const publicacionPorGrupo = require("./publicacionPorGrupo");

const claveAnuncio = (sorteo, grupo) =>
    `TABLA_COMPARTIR:${sorteo.usuario_id}:${Number(sorteo.config?.valor)}:sorteo-${sorteo.id}-publicacion-${Number(grupo.reintentos_manuales) || 0}:${grupo.grupo_id}`;

const INCIERTO = "El servidor se reinició mientras se enviaba el anuncio a este grupo: no se sabe si llegó. No se reenvía solo para no duplicarlo. Revisa el grupo en WhatsApp: si el anuncio no está, pulsa «Reintentar».";

// Lo que se sabe del destino por el registro de su anuncio.
// -> { cambios, evento } | null (no se pudo leer: se deja para el siguiente ciclo)
async function resultadoConocido({ sorteo, grupo, registro, ahora, buscarEvento }) {
    const envio = estadoDelEnvio(registro);

    if (envio === ENVIO.CONFIRMADO) {
        const ev = await buscarEvento(grupo.grupo_id, sorteo.usuario_id, sorteo.identidad_evento_real);
        if (!ev.ok) return null;
        return {
            evento: ev.data,
            cambios: {
                estado: "publicado",
                version_publicada: sorteo.version,
                publicado_en: registro.actualizado_en || registro.ejecutado_en || ahora.toISOString(),
                ultimo_error: null,
                ...(ev.data?.id ? { evento_bot_id: ev.data.id } : {})
            }
        };
    }

    if (envio === ENVIO.FALLIDO) {
        return { evento: null, cambios: { estado: "requiere_revision", ultimo_error: `El anuncio no se pudo enviar: ${registro.detalle?.mensaje || "error de WhatsApp"}` } };
    }

    if (envio === ENVIO.INCIERTO) return { evento: null, cambios: { estado: "requiere_revision", ultimo_error: INCIERTO } };

    // NO_INICIADO: nada salió; es un intento fallido más, como cualquier otro.
    let cambios = { estado: "fallido", ultimo_error: "El servidor se reinició antes de enviar el anuncio; no se envió nada. Se reintentará." };
    if (estado.esInstantaneo(sorteo)) cambios = estado.resultadoInstantaneo(cambios);
    else if ((Number(grupo.intentos) || 0) >= estado.MAX_INTENTOS_AUTOMATICOS) {
        cambios = { estado: "requiere_revision", ultimo_error: estado.sinPromesaDeReintento(cambios.ultimo_error) };
    }
    return { evento: null, cambios };
}

// Destino «en espera» porque otra programación del mismo sorteo tiene la
// publicación de este grupo (K3). Si el reclamo lo tiene ahora OTRO proceso de
// esta MISMA programación (otra recuperación a la vez), no se toca: null.
function esperarA(sorteo) {
    return (motivo, { dueno } = {}) => {
        if (dueno === sorteo.id) return null;
        const cambios = { estado: "pendiente", ultimo_error: `${estado.EN_ESPERA}${motivo}` };
        return estado.esInstantaneo(sorteo) ? estado.resultadoInstantaneo(cambios) : cambios;
    };
}

async function recuperarAtascados({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    const informe = [];

    try {

        const umbral = new Date(ahora.getTime() - UMBRALES.PUBLICACION_ATASCADA_MS).toISOString();
        const { data: atascados, error } = await deps.supabase.from("sorteos_programados_grupos").select("*")
            .eq("usuario_id", usuarioId).eq("estado", "publicando").lt("actualizado_en", umbral);
        if (error || !atascados?.length) return { ok: !error, informe };

        const obtenerPorClave = deps.obtenerPorClave || require("../automation/executionGuard").obtenerPorClave;
        const buscarEvento = deps.consultarEventoDelSorteo || require("../bot/funciones/eventos/consultarEvento").consultarEventoDelSorteo;
        const sorteosTocados = new Set();

        for (const grupo of atascados) {

            const s = await repo.obtenerSorteo(usuarioId, grupo.sorteo_id);
            if (!s.ok) continue;
            const sorteo = s.data;

            let registro;
            try { registro = await obtenerPorClave(claveAnuncio(sorteo, grupo)); } catch { continue; }

            const conocido = await resultadoConocido({ sorteo, grupo, registro, ahora, buscarEvento });
            if (!conocido) continue;

            // K3: el resultado conocido cierra (o adopta) el reclamo de la
            // publicación del grupo, sin enviar nada.
            const cambios = await publicacionPorGrupo.publicarUnaVez({
                db: deps.supabase, usuarioId, grupoId: grupo.grupo_id, identidad: sorteo.identidad_evento_real,
                sorteoId: sorteo.id, version: sorteo.version, esperar: esperarA(sorteo),
                publicar: async () => conocido.cambios
            });
            if (cambios == null) continue; // lo está cerrando otro proceso de esta programación
            const propia = cambios === conocido.cambios;

            const marcado = await repo.marcarGrupoSi(usuarioId, grupo.id, ["publicando"], cambios);
            if (!marcado.ok || marcado.data === false) continue;
            sorteosTocados.add(sorteo.id);
            informe.push({ sorteo: sorteo.id, grupo: grupo.grupo_id, estado: cambios.estado, anuncio: registro?.estado || "sin_registro", propia });

            // El anuncio llegó y la publicación es SUYA: el evento pasa por el
            // motor central con la hora real del anuncio. Solo si sigue activo.
            // Si adoptó la de otra, el ciclo es de esa publicación.
            const evento = conocido.evento;
            if (propia && evento?.activo === true && !finDelEvento(evento)) {
                const motor = deps.motorEventos || require("../automation/motorEventos");
                await motor.procesarEventoPublicado({ evento, sock, ahora, tablaPublicada: true, momento: cambios.publicado_en });
            }

        }

        for (const id of sorteosTocados) await estado.finalizarSorteo(usuarioId, id);

        return { ok: true, informe };

    } catch (err) {

        console.error("❌ [SORTEOS] error recuperando publicaciones interrumpidas:", err?.message);
        return { ok: false, informe };

    }

}

module.exports = { recuperarAtascados, claveAnuncio, INCIERTO };
