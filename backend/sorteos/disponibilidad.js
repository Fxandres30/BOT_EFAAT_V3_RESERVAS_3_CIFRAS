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
//     números reservados/pagados de OTRO sorteo: nunca se reinicia sola. El
//     sorteo puede pedir el reinicio seguro (reinicioTabla.js, migración
//     030: archiva y libera, nunca toca un sorteo activo) y confirmarlo en la
//     vista previa; entonces esos números dejan de bloquear (seReiniciara).
// ==========================================================================

const supabase = require("../lib/supabase");
const { numerosEsperados } = require("../bot/funciones/eventos/sorteoReal");

async function revisarTabla({ usuarioId, tabla, cifras, cantidad, identidad, seReiniciara = false }) {

    const bloqueos = [];
    const avisos = [];

    const { data, error } = await supabase
        .from(tabla)
        .select("numero, estado, identidad_evento_real")
        .eq("usuario_id", usuarioId);

    if (error) {
        console.error("❌ [SORTEOS] no se pudo leer la tabla de números:", error.message);
        bloqueos.push("No pudimos revisar la tabla de números en este momento. Inténtalo de nuevo en unos minutos.");
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

    if (ocupadosOtro > 0 && seReiniciara) {
        avisos.push(`Al confirmar se reiniciará la tabla: ${ocupadosOtro} número(s) reservados o pagados de sorteos anteriores se archivarán (no se borran) y quedarán libres.`);
    } else if (ocupadosOtro > 0) {
        bloqueos.push(`La tabla tiene ${ocupadosOtro} número(s) reservados o pagados de otro sorteo. Edita el sorteo y elige «Reiniciar tabla antes de programar» (se archivan, no se borran; nunca se tocan los de un sorteo activo).`);
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

    // Todas las filas del grupo: con varios clientes puede haber una por
    // cliente (antes .maybeSingle() fallaba y el mensaje era confuso).
    const { data, error } = await supabase
        .from("eventos_bot")
        .select("id, usuario_id, activo, identidad_evento_real, nombre_evento, hora_fin")
        .eq("grupo_id", grupoId);

    if (error) {
        console.error("❌ [SORTEOS] no se pudo revisar el grupo:", error.message);
        return { bloqueo: "No pudimos revisar este grupo en este momento. Inténtalo de nuevo en unos minutos.", avisos: [] };
    }

    const propio = (data || []).find(f => f.usuario_id === usuarioId) || null;

    if (propio?.activo && propio.identidad_evento_real !== identidad) {
        return {
            bloqueo: `El grupo tiene un sorteo activo (${propio.nombre_evento || "sin nombre"} ${propio.hora_fin || ""}). Espera a que cierre o programa la publicación para después del cierre.`,
            avisos: [],
            eventoActual: propio
        };
    }

    // Sorteo activo de OTRO cliente en el mismo grupo: no se revela cuál.
    if ((data || []).some(f => f.usuario_id !== usuarioId && f.activo)) {
        return { bloqueo: "Otra cuenta tiene un sorteo activo en este grupo. Elige otro grupo o espera a que termine.", avisos: [], eventoActual: propio };
    }

    return { bloqueo: null, avisos: [], eventoActual: propio };

}

module.exports = {
    revisarTabla,
    revisarGrupo
};
