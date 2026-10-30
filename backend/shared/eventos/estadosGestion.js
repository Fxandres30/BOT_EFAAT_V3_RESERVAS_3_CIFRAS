// ==========================================================================
// estadosGestion.js — cómo terminó la vigencia de una fila de eventos_bot
// cuando NO fue el cierre normal del sorteo (hora o todo pagado).
//
// Todas estas filas quedan con activo=false, así que el worker de eventos,
// las reservas, los recordatorios y la reconciliación de apertura ya no las
// tocan. Lo que cambia es el AVISO y la DEUDA:
//
//   desactivado  el administrador lo apagó (en un grupo o en todos). Sin
//                aviso de cierre. Sus pagos pendientes siguen siendo deuda.
//   cancelado    el sorteo no se juega. Sin aviso de cierre y sin deuda: un
//                número reservado de un sorteo cancelado no se cobra.
//   eliminado    eliminación LÓGICA desde el panel: se oculta, nunca se
//                borran sus reservas, pagos ni historial. Sin deuda.
//   sustituido   otro sorteo pasó a ser el vigente del grupo (anuncio nuevo
//                o publicación programada). Sin aviso de cierre; su deuda
//                sigue.
//
// Se guarda en `estado` y también en `cierre_motivo` con el prefijo
// "panel:" (o "sustituido"): así se reconoce aunque una base antigua tuviera
// una restricción sobre los valores de `estado` (ver gestionEventos.js).
// ==========================================================================

const ESTADOS_GESTION = ["desactivado", "cancelado", "eliminado"];
const SIN_DEUDA = new Set(["cancelado", "eliminado"]);

function motivoGestion(evento) {

    if (!evento) return null;

    if (ESTADOS_GESTION.includes(evento.estado)) return evento.estado;

    const motivo = String(evento.cierre_motivo || "");

    if (motivo.startsWith("panel:")) {
        const m = motivo.slice("panel:".length).split(/[\s:]/)[0];
        if (ESTADOS_GESTION.includes(m)) return m;
    }

    if (motivo.startsWith("sustituido")) return "sustituido";

    return null;

}

// ¿Su fin NO debe anunciarse con el mensaje de cierre?
function cierreSilencioso(evento) {
    return motivoGestion(evento) !== null;
}

// ¿Sus números reservados dejan de ser deuda del cliente?
function sinDeuda(evento) {
    return SIN_DEUDA.has(motivoGestion(evento));
}

function eliminado(evento) {
    return motivoGestion(evento) === "eliminado";
}

// ¿La vigencia de esta fila terminó? Devuelve cómo ("cerrado", "cancelado",
// "desactivado", "eliminado", "sustituido") o null si sigue vigente. Una
// sincronización de datos o un reintento nunca revierten este final: solo
// «Reabrir» (gestionEventos.js), que además limpia cierre_estado. Por eso
// cierre_estado="cerrado" cuenta aunque activo=true: es una fila que un
// reintento antiguo reactivó después de cerrarla.
function finDelEvento(evento) {

    if (!evento) return null;

    return motivoGestion(evento)
        || (evento.activo === false || evento.estado === "cerrado" || evento.cierre_estado === "cerrado" ? "cerrado" : null);

}

module.exports = { ESTADOS_GESTION, motivoGestion, cierreSilencioso, sinDeuda, eliminado, finDelEvento };
