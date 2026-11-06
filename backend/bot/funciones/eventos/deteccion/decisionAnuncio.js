// ==========================================================================
// REGLAS PROPIAS del anuncio de WhatsApp (F4-E): antes de activar nada, qué
// significa ESTE anuncio en ESTE grupo. Sin cambios respecto a las de
// siempre; solo se movieron desde detectarEvento.js:
//   - identidad del sorteo anunciado (continuación de un sorteo vigente, o
//     la de siempre con la fecha del anuncio);
//   - re-anuncio de un sorteo ya cerrado o lleno: no se reactiva;
//   - sorteo programado desde el panel activo en el grupo: un re-anuncio no
//     lo toca; otro sorteo solo si lo publica el bot o un administrador;
//   - qué fila se guarda (la misma, la del sorteo anunciado o una nueva) y
//     qué sorteo del grupo se sustituye.
// Solo LEE. -> { terminar: valorDevuelto } | { activar: { … } }
// ==========================================================================

"use strict";

const { esMismoSorteo, fechaSorteoAnunciado, buscarSorteoVigente, crearIdentidadEventoReal } = require("../identidadEventoReal");
const { finDelEvento } = require("../../../../shared/eventos/estadosGestion");
const { estadoTerminado, sorteoTieneNumeros } = require("./sorteoAnterior");
const { remitenteAutorizado } = require("./remitente");

// deps: db, consultarEvento, consultarEventoDelSorteo,
//       esEventoDeSorteoProgramado, sorteoSinNumerosLibres
async function decidirAnuncio({ ctx, grupoId, duenoSesion, eventoCompleto, deps }) {

    const eventoAnterior = await deps.consultarEvento(grupoId, duenoSesion);

    console.log("📋 Evento anterior:", eventoAnterior ? `${eventoAnterior.nombre_evento} (${eventoAnterior.hora_fin})` : "No existe");

    // Hoy, o mañana si se anuncia de noche una hora que ya pasó (ver
    // fechaSorteoAnunciado). Se calcula una sola vez para todo el flujo.
    const fechaSorteo = fechaSorteoAnunciado(eventoCompleto.hora, eventoCompleto.horaCierre);

    // Sorteo ACTIVO del que este anuncio es continuación (en este u otro
    // grupo): identidad estable durante todo su ciclo de vida.
    let sorteoVigente = null;
    try {
        sorteoVigente = await buscarSorteoVigente({
            supabase: deps.db,
            usuarioId: duenoSesion,
            nombre: eventoCompleto.nombre,
            hora: eventoCompleto.hora,
            valor: eventoCompleto.valor,
            grupoId,
            hoy: fechaSorteo
        });
    } catch (err) {
        console.error("⚠️ No se pudo buscar el sorteo vigente (se usa la identidad de siempre):", err?.message);
    }

    const datosAnunciados = { usuario_id: duenoSesion, nombre_evento: eventoCompleto.nombre, hora_fin: eventoCompleto.hora, valor: eventoCompleto.valor, fecha_evento: fechaSorteo };

    // RE-ANUNCIO DE UN SORTEO YA LLENO/CERRADO: si es el MISMO sorteo real que
    // el evento de este grupo y ya terminó, no es un sorteo nuevo: no se
    // reactiva, no se crea ciclo y no se abre el grupo.
    if (eventoAnterior && (esMismoSorteo(eventoAnterior, datosAnunciados) || (sorteoVigente && eventoAnterior.identidad_evento_real === sorteoVigente.identidad_evento_real))) {
        const terminado = await estadoTerminado(eventoAnterior, deps);
        if (terminado) {
            console.log(`⏭️ Re-anuncio del mismo sorteo ya ${terminado} (${eventoAnterior.nombre_evento} ${eventoAnterior.hora_fin}) — no se reactiva ni se abre el grupo.`);
            return { terminar: eventoAnterior };
        }
    }

    // Identidad del sorteo que anuncia ESTE mensaje (la misma que calculará
    // guardarEvento).
    const identidadAnunciada = sorteoVigente?.identidad_evento_real || crearIdentidadEventoReal({
        ...datosAnunciados,
        fecha_evento: sorteoVigente?.fecha_evento || fechaSorteo
    });

    const otroSorteo = Boolean(eventoAnterior) && eventoAnterior.identidad_evento_real !== identidadAnunciada && !esMismoSorteo(eventoAnterior, datosAnunciados);

    // SORTEO PROGRAMADO DESDE EL PANEL, ACTIVO: un anuncio del MISMO sorteo es
    // un re-anuncio (no lo reemplaza ni lo reabre). Uno de OTRO sorteo es una
    // decisión explícita del administrador: prevalece si lo publica la cuenta
    // del bot o un administrador del grupo.
    if (eventoAnterior?.activo && await deps.esEventoDeSorteoProgramado(eventoAnterior)) {
        if (!otroSorteo || !(await remitenteAutorizado(ctx, grupoId))) {
            console.log(`⏭️ Anuncio detectado en un grupo con un sorteo programado activo (${eventoAnterior.nombre_evento} ${eventoAnterior.hora_fin}) — no se reemplaza${otroSorteo ? " (no lo publicó un administrador)" : ""}.`);
            return { terminar: eventoAnterior };
        }
        console.log(`🔁 Anuncio de OTRO sorteo publicado por un administrador en un grupo con un sorteo programado activo — se sustituye en este grupo.`);
    }

    // ¿Qué fila se guarda?
    //   - Mismo sorteo (re-anuncio): su fila, como siempre.
    //   - Otro sorteo y el anterior todavía SIN números (detección equivocada
    //     que se corrige con un anuncio nuevo): se corrige la misma fila.
    //   - Otro sorteo y el anterior CON reservas/pagos o ya terminado: fila
    //     NUEVA. La del anterior se conserva y, si seguía activo, se cierra en
    //     este grupo. Nunca se reasignan sus reservas al sorteo nuevo.
    let filaAGuardar = eventoAnterior;
    let sustituir = null;

    if (otroSorteo) {
        let filaDelSorteo = null;
        try {
            const previa = await deps.consultarEventoDelSorteo(grupoId, duenoSesion, identidadAnunciada);
            filaDelSorteo = previa?.ok ? previa.data : null;
        } catch {
            filaDelSorteo = null;
        }

        // Re-anuncio de un sorteo que este grupo ya terminó: no se reactiva.
        if (finDelEvento(filaDelSorteo)) {
            console.log(`⏭️ Re-anuncio de un sorteo ya ${finDelEvento(filaDelSorteo)} en este grupo (${filaDelSorteo.nombre_evento} ${filaDelSorteo.hora_fin}) — no se reactiva.`);
            return { terminar: eventoAnterior };
        }

        if (filaDelSorteo) {
            filaAGuardar = filaDelSorteo;
            if (eventoAnterior.activo && eventoAnterior.id !== filaDelSorteo.id) sustituir = eventoAnterior;
        } else if (eventoAnterior.activo && !(await sorteoTieneNumeros(eventoAnterior, deps))) {
            console.log(`✏️ Corrección del sorteo del grupo (${eventoAnterior.nombre_evento} ${eventoAnterior.hora_fin} → ${eventoCompleto.nombre} ${eventoCompleto.hora}): todavía no tenía números, se corrige la misma fila.`);
        } else {
            filaAGuardar = null;
            if (eventoAnterior.activo) sustituir = eventoAnterior;
        }
    }

    return { activar: { eventoAnterior, sorteoVigente, fechaSorteo, identidadAnunciada, filaAGuardar, sustituir } };
}

module.exports = { decidirAnuncio };
