// ==========================================================================
// Reglas de ESTADO de los destinos y de la programación (F4-G, 06/11/2026).
//
// Las comparten la publicación (sorteos/publicador.js) y la recuperación de
// publicaciones interrumpidas (sorteos/recuperacionPublicacion.js). Se
// movieron del publicador sin cambios; el publicador las sigue exportando.
// ==========================================================================

"use strict";

const repo = require("./repo");

// Intentos automáticos de un destino antes de pasar a revisión manual.
const MAX_INTENTOS_AUTOMATICOS = 5;

// Grupo que todavía no puede publicarse (sorteo activo propio u otra cuenta
// en el grupo): sigue «pendiente», sin gastar intentos, con este prefijo en
// ultimo_error para explicarlo.
const EN_ESPERA = "En espera: ";

// Sin reintento automático pendiente, el mensaje no puede prometerlo.
const sinPromesaDeReintento = (texto) => String(texto || "").replace(/[.;]?\s*se reintentará\.?/gi, ".");

// SORTEO INSTANTÁNEO (config.publicacion_inmediata): se publica solo cuando el
// administrador lo pide; el ciclo automático no lo toma. Un destino que falla
// o tendría que esperar queda en error (requiere_revision) con el motivo real,
// y se reintenta solo ese destino, a mano.
const esInstantaneo = (sorteo) => sorteo?.config?.publicacion_inmediata === true;

function resultadoInstantaneo(cambios) {
    if (cambios.estado === "fallido") {
        return { ...cambios, estado: "requiere_revision", ultimo_error: sinPromesaDeReintento(cambios.ultimo_error) };
    }
    if (cambios.estado === "pendiente") {
        const { intentos: _intentos, ...resto } = cambios;
        const motivo = String(cambios.ultimo_error || "").replace(EN_ESPERA, "").split(" Debe resolverse antes")[0];
        return { ...resto, estado: "requiere_revision", ultimo_error: `No se publicó en este momento: ${motivo} Cuando se resuelva, pulsa «Reintentar» en este destino.` };
    }
    return cambios;
}

// Estado final de la programación según sus destinos (solo si ya no queda
// nada en marcha). Condicionado a que siga «publicando».
async function finalizarSorteo(usuarioId, sorteoId) {

    const grupos = await repo.gruposDelSorteo(usuarioId, sorteoId);
    if (!grupos.ok) return;

    const lista = grupos.data;
    const enCurso = lista.some(g => g.estado === "pendiente" || g.estado === "publicando" ||
        (g.estado === "fallido" && (Number(g.intentos) || 0) < MAX_INTENTOS_AUTOMATICOS));

    if (enCurso) return;

    const vivos = lista.filter(g => g.estado !== "cancelado");
    const publicados = vivos.filter(g => g.estado === "publicado").length;

    const estado = vivos.length === 0 ? "cancelado"
        : publicados === vivos.length ? "publicado"
            : publicados > 0 ? "publicado_parcial"
                : "fallido";

    await repo.actualizarSorteoSi(usuarioId, sorteoId, { estados: ["publicando"] }, { estado });

}

module.exports = { MAX_INTENTOS_AUTOMATICOS, EN_ESPERA, sinPromesaDeReintento, esInstantaneo, resultadoInstantaneo, finalizarSorteo };
