// ==========================================================================
// sorteos/disponibilidad.js — comprobaciones previas a publicar un sorteo
// programado. Solo lectura. Devuelven BLOQUEOS (impiden publicar) y AVISOS
// (se muestran en la vista previa; no impiden).
//
// Reglas que protegen sorteos activos y pagos:
//   - Un grupo con un sorteo ACTIVO distinto nunca se reemplaza (hoy cada
//     grupo tiene una sola fila en eventos_bot: publicar encima dejaría
//     huérfanas las reservas del sorteo activo).
//   - La tabla de números del cliente debe existir completa y no tener
//     números reservados/pagados de OTRO sorteo: nunca se reinicia sola (eso
//     borraría el historial de ese sorteo); el administrador la reinicia
//     desde Tablas si corresponde.
// ==========================================================================

const supabase = require("../lib/supabase");
const { numerosEsperados } = require("../bot/funciones/eventos/sorteoReal");

async function revisarTabla({ usuarioId, tabla, cifras, cantidad, identidad }) {

    const bloqueos = [];
    const avisos = [];

    const { data, error } = await supabase
        .from(tabla)
        .select("numero, estado, identidad_evento_real")
        .eq("usuario_id", usuarioId);

    if (error) {
        bloqueos.push(`No se pudo leer la tabla de números (${error.message}).`);
        return { bloqueos, avisos, resumen: null };
    }

    const esperados = new Set(numerosEsperados({ cifras, cantidad_numeros: cantidad }));
    const presentes = new Set((data || []).map(f => String(f.numero)).filter(n => esperados.has(n)));

    const ocupadosOtro = (data || []).filter(f =>
        (f.estado === "reservado" || f.estado === "pagado") && f.identidad_evento_real !== identidad
    ).length;

    const retenidos = (data || []).filter(f => f.estado === "bloqueado" || f.estado === "en_proceso").length;

    if (presentes.size < esperados.size) {
        bloqueos.push(`La tabla de números está incompleta (${presentes.size}/${esperados.size}). Créala o reiníciala desde Tablas.`);
    }

    if (ocupadosOtro > 0) {
        bloqueos.push(`La tabla tiene ${ocupadosOtro} número(s) reservados o pagados de otro sorteo. Reiníciala desde Tablas antes de publicar.`);
    }

    if (retenidos > 0) {
        avisos.push(`Hay ${retenidos} número(s) bloqueados o en proceso: no se pueden vender y el sorteo no se cerrará por pagos mientras sigan así.`);
    }

    return {
        bloqueos,
        avisos,
        resumen: { esperados: esperados.size, presentes: presentes.size, ocupadosOtroSorteo: ocupadosOtro, retenidos }
    };

}

// Grupo: debe estar autorizado por este cliente y no tener otro sorteo activo.
async function revisarGrupo({ usuarioId, grupoId, identidad, autorizados }) {

    if (!autorizados.has(grupoId)) {
        return { bloqueo: "El grupo no está autorizado para este usuario.", avisos: [] };
    }

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("id, usuario_id, activo, identidad_evento_real, nombre_evento, hora_fin")
        .eq("grupo_id", grupoId)
        .maybeSingle();

    if (error) return { bloqueo: `No se pudo revisar el grupo (${error.message}).`, avisos: [] };

    if (data?.activo && data.identidad_evento_real !== identidad) {
        return {
            bloqueo: `El grupo tiene un sorteo activo (${data.nombre_evento || "sin nombre"} ${data.hora_fin || ""}). Espera a que cierre.`,
            avisos: [],
            eventoActual: data
        };
    }

    return { bloqueo: null, avisos: [], eventoActual: data || null };

}

module.exports = {
    revisarTabla,
    revisarGrupo
};
