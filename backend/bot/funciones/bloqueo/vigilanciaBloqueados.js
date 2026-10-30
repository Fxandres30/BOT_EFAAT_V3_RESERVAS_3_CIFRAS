// ==========================================================================
// vigilanciaBloqueados.js — vigilancia permanente de los bloqueados de UN
// cliente en sus grupos autorizados.
//
// El evento group-participants.update (bloqueoParticipantesGrupo.js) expulsa
// al instante a quien reingresa, pero un evento se pierde si la sesión
// estaba caída o reconectando. Esta revisión periódica (la llama
// workerExpulsiones.js cada BLOQUEO_VIGILANCIA_INTERVALO_MS) lo cubre:
//
//   1. crea las tareas que falten (bloqueos anteriores a la 040, grupos
//      autorizados después del bloqueo) — el motor las procesará;
//   2. lee los participantes REALES de todos los grupos de la cuenta con UNA
//      sola IQ (groupFetchAllParticipating, por la cola de la sesión);
//   3. si un bloqueado aparece (identificación sin dudas,
//      identidadParticipante.js) en un grupo autorizado cuya tarea estaba
//      resuelta, la tarea vuelve a "pendiente" (origen "reingreso");
//   4. si reabrió alguna, ejecuta el motor único (procesarExpulsion.js), que
//      vuelve a leer el grupo, revisa permisos, expulsa y verifica.
//
// No expulsa por sí misma ni decide nada que el motor no vuelva a comprobar.
// Solo actúa con el WhatsApp activo DEL MISMO cliente y solo sobre sus
// grupos autorizados.
// ==========================================================================

const repo = require("./expulsionesRepo");
const identidad = require("./identidadParticipante");
const { procesarPendientesDe, socketDelCliente } = require("./procesarExpulsion");

function dependenciasReales() {

    const groupQueue = require("../../../services/baileys/groupQueue");
    const propiedadSesion = require("../../../services/baileys/propiedadSesion");
    const { listarBloqueados } = require("./bloqueadosRepo");

    return {
        repo,
        listarBloqueados,
        puedeActuar: sock => propiedadSesion.puedeActuar(sock),
        groupFetchAllParticipating: groupQueue.groupFetchAllParticipating,
        procesar: procesarPendientesDe,
        motor: null, // dependencias del motor: las reales
        ahora: () => new Date()
    };

}

// Devuelve { ok, motivo?, activos, revisados, presentes, reabiertas, creadas? }.
// ok=false con motivo "whatsapp" significa que la lectura falló: el worker
// espaciará la próxima revisión.
async function vigilarCliente(usuarioId, { sock, config, deps = null } = {}) {

    const d = deps || dependenciasReales();

    if (!usuarioId) return { ok: false, motivo: "sin_usuario" };

    const lista = await d.listarBloqueados(usuarioId);
    if (!lista.ok) return { ok: false, motivo: lista.motivo || "error_supabase" };

    const activos = (lista.bloqueados || []).filter(b => b.activo && b.usuario_id === usuarioId);

    if (activos.length === 0) return { ok: true, activos: 0, revisados: 0, presentes: 0, reabiertas: 0 };

    const asegurado = await d.repo.asegurarTareasDeActivos(usuarioId, activos, { ahora: d.ahora() });
    if (!asegurado.ok) return { ok: false, motivo: asegurado.motivo || "error_supabase", activos: activos.length };

    const autorizados = new Set(asegurado.grupos.map(g => g.grupo_id));

    if (autorizados.size === 0) return { ok: true, activos: activos.length, revisados: 0, presentes: 0, reabiertas: 0 };

    if (!socketDelCliente(sock, usuarioId, d)) return { ok: false, motivo: "sin_sesion", activos: activos.length };

    let mapa;

    try {
        mapa = await d.groupFetchAllParticipating(sock);
    } catch (err) {
        return { ok: false, motivo: "whatsapp", error: err?.message || String(err), activos: activos.length };
    }

    const tareas = await d.repo.listarDeCliente(usuarioId);
    if (!tareas.ok) return { ok: false, motivo: tareas.motivo || "error_supabase", activos: activos.length };

    const tareaDe = new Map(tareas.tareas.map(t => [`${t.bloqueado_id}::${t.grupo_id}`, t]));
    const excluir = identidad.idsDeCuenta(sock);

    let revisados = 0;
    let presentes = 0;
    let reabiertas = 0;

    for (const [grupoId, metadata] of Object.entries(mapa || {})) {

        // Solo grupos autorizados de ESTE cliente; nunca otro grupo en el
        // que la cuenta también esté.
        if (!autorizados.has(grupoId)) continue;

        const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];
        if (participantes.length === 0) continue;

        revisados++;

        for (const b of activos) {

            const loc = identidad.localizarParticipante(participantes, b, { excluir });

            // Ausente, ambiguo o no verificable: nada que reabrir (el motor
            // ya registró lo ambiguo cuando procesó la tarea).
            if (loc.estado !== "encontrado") continue;

            presentes++;

            const tarea = tareaDe.get(`${b.id}::${grupoId}`);

            // Pendiente, en curso o con un error en reintento: ya está en
            // manos del motor. Sin tarea (la acaba de crear el upsert de
            // arriba con otra lectura): la procesa la siguiente pasada.
            if (!tarea || !repo.REABRIBLES.includes(tarea.estado)) continue;

            const r = await d.repo.reabrirPorPresencia(tarea, { ahora: d.ahora() });

            if (r.ok && r.reabierta) {
                reabiertas++;
                console.warn(`🚫 [VIGILANCIA] bloqueado ${b.id} de nuevo en ${grupoId} (${tarea.estado} → pendiente)`);
            }

        }

    }

    if (reabiertas > 0) {
        const corrida = await d.procesar(usuarioId, { sock, config, deps: d.motor });
        if (corrida?.encolado && corrida.promesa) await corrida.promesa;
    }

    return { ok: true, activos: activos.length, revisados, presentes, reabiertas };

}

module.exports = {
    vigilarCliente
};
