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
//
// Las consultas del cliente («¿qué debo?», «mis números») ya no usan esta
// deuda (31/10/2026): solo cuenta la tabla con un sorteo VIGENTE
// (consultarMisNumeros.js::sorteoVigente). Un sorteo terminado de cualquier
// forma nunca se presenta como obligación actual.
// ==========================================================================

const ESTADOS_GESTION = ["desactivado", "cancelado", "eliminado"];
const SIN_DEUDA = new Set(["cancelado", "eliminado"]);

// Prefijo de la normalización (F3): una fila activo=true que YA había
// terminado se repara poniendo activo=false y anteponiendo este prefijo al
// motivo que tenía. El motivo original se sigue interpretando igual (un
// «panel:cancelado» normalizado sigue sin deuda) y el fin es silencioso.
const PREFIJO_NORMALIZADO = "normalizado: ";

function motivoGestion(evento) {

    if (!evento) return null;

    if (ESTADOS_GESTION.includes(evento.estado)) return evento.estado;

    let motivo = String(evento.cierre_motivo || "");
    if (motivo.startsWith(PREFIJO_NORMALIZADO)) motivo = motivo.slice(PREFIJO_NORMALIZADO.length);

    if (motivo.startsWith("panel:")) {
        const m = motivo.slice("panel:".length).split(/[\s:]/)[0];
        if (ESTADOS_GESTION.includes(m)) return m;
    }

    if (motivo.startsWith("sustituido")) return "sustituido";

    return null;

}

// ¿Su fin NO debe anunciarse con el mensaje de cierre? Tampoco un cierre
// RECUPERADO (procesarSorteo.js): su hora pasó un día anterior con el proceso
// desconectado, y el aviso llegaría tarde, quizá en medio del sorteo nuevo.
// Una fila NORMALIZADA (F3) tampoco: ya había terminado; anunciarlo ahora
// sería un aviso tardío.
function cierreSilencioso(evento) {
    const motivo = String(evento?.cierre_motivo || "");
    return motivoGestion(evento) !== null || motivo.includes("recuperado:") || motivo.startsWith(PREFIJO_NORMALIZADO);
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

// ==========================================================================
// FUENTE ÚNICA DEL ESTADO DE UN SORTEO EN SU GRUPO (F2, 06/11/2026).
//
// Una fila de eventos_bot reparte su estado en cinco columnas: activo,
// abierto, estado, cierre_estado y cierre_motivo. Antes cada módulo las
// combinaba a su manera y había cuatro criterios distintos de «sigue en
// curso» (docs/arquitectura/ESTADO_SORTEOS.md). Aquí viven TODOS, con su
// nombre, para que ninguno se vuelva a escribir a mano:
//
//   vigente / estadoEnGrupo   CRITERIO CANÓNICO: activo === true y su
//                             vigencia no terminó (finDelEvento). Es el que
//                             ya usaban las reservas del grupo, el cierre y
//                             el pago por sticker.
//   abiertoPorEstado          criterio B, ANTERIOR: activo distinto de false
//                             y estado distinto de "cerrado" (no mira
//                             cierre_estado ni los motivos de gestión).
//   enCursoPorActivo /        criterio C, ANTERIOR: solo la columna activo.
//   estadoEnGrupoPorActivo
//
// Los criterios anteriores se conservan A PROPÓSITO: sus consumidores no se
// pueden pasar al canónico sin cambiar lo que ve o permite el usuario en
// las filas contradictorias (contradicciones(), abajo). Pasarlos es una
// decisión pendiente de autorización, no un detalle técnico.
//
// `abierto` (el grupo de WhatsApp quedó abierto) NO forma parte del estado
// del sorteo: abierto=false con activo=true es una apertura fallida que el
// worker reconcilia; el sorteo sigue vigente.
// ==========================================================================

// ¿El sorteo sigue en curso en este grupo? (canónico)
function vigente(evento) {
    return evento?.activo === true && finDelEvento(evento) === null;
}

// "en_curso" o cómo terminó ("cerrado", "desactivado", "cancelado",
// "eliminado", "sustituido"). null sin fila. Una fila sin valor en activo
// (registros anteriores a que la columna fuera obligatoria) y sin otro dato
// de cierre no está en curso: cuenta como "cerrado". (canónico)
function estadoEnGrupo(evento) {
    if (!evento) return null;
    return vigente(evento) ? "en_curso" : (finDelEvento(evento) || "cerrado");
}

// Combinaciones en las que los criterios discrepan. Lista vacía = la fila
// se interpreta igual con cualquier criterio.
//   activo_sin_valor   activo no es ni true ni false (NULL histórico).
//   activo_terminado   activo=true pero la vigencia terminó (un reintento
//                      antiguo la reactivó, o quedó con estado/cierre_estado
//                      "cerrado" o con un motivo de gestión). Riesgo C3.
function contradicciones(evento) {
    if (!evento) return [];
    const lista = [];
    if (evento.activo !== true && evento.activo !== false) lista.push("activo_sin_valor");
    if (evento.activo === true && finDelEvento(evento) !== null) lista.push("activo_terminado");
    return lista;
}

// Criterio B (anterior): «abierto mientras no esté cerrado». Lo usan
// sorteosActivos.js y administracion.js (y, con la misma expresión escrita a
// mano, detectarReserva y detectarEvento, que F2 no toca). Requiere fila.
function abiertoPorEstado(evento) {
    return evento.activo !== false && evento.estado !== "cerrado";
}

// Criterio C (anterior): solo la columna activo. Lo usa gestionEventos.js.
function enCursoPorActivo(evento) {
    return Boolean(evento?.activo);
}

function estadoEnGrupoPorActivo(evento) {
    return enCursoPorActivo(evento) ? "en_curso" : (motivoGestion(evento) || "cerrado");
}

// ==========================================================================
// PERMISO DE RESERVAS (F3-E, 06/11/2026): independiente del ESTADO.
// eventos_bot.reservas_modo (migración 047; NULL o sin columna = segun_estado)
// lo decide el administrador. Ninguna automatización lo cambia.
//   segun_estado  acepta si el sorteo está vigente y no pasó su hora de
//                 cierre (lo de siempre; regla 1 de F2)
//   permitidas    acepta aunque el sorteo esté cerrado o haya pasado su hora
//   desactivadas  rechaza aunque esté abierto
// Un sorteo cancelado, eliminado o sustituido NUNCA acepta reservas nuevas.
// Las demás protecciones (grupo autorizado, contacto bloqueado, formato,
// disponibilidad) las sigue aplicando cada canal, sea cual sea el permiso.
// ==========================================================================
const MODOS_RESERVA = Object.freeze(["segun_estado", "permitidas", "desactivadas"]);
const FINES_SIN_RESERVAS = new Set(["cancelado", "eliminado", "sustituido"]);

function modoReservas(evento) {
    return MODOS_RESERVA.includes(evento?.reservas_modo) ? evento.reservas_modo : "segun_estado";
}

// cierrePasado: si ya pasó la hora de cierre de reservas (lo calcula el
// llamador con verificarHoraCierre). -> { permitido, motivo, modo }
function puedeReservar({ evento, cierrePasado = false }) {
    if (!evento) return { permitido: false, motivo: "sin_sorteo", modo: "segun_estado" };
    const modo = modoReservas(evento);
    const fin = finDelEvento(evento);
    if (FINES_SIN_RESERVAS.has(fin)) return { permitido: false, motivo: `sorteo_${fin}`, modo };
    if (modo === "desactivadas") return { permitido: false, motivo: "reservas_desactivadas", modo };
    if (modo === "permitidas") return { permitido: true, motivo: vigente(evento) && !cierrePasado ? null : "sorteo_cerrado_permitido", modo };
    if (!vigente(evento)) return { permitido: false, motivo: "sorteo_cerrado", modo };
    if (cierrePasado) return { permitido: false, motivo: "cierre_pasado", modo };
    return { permitido: true, motivo: null, modo };
}

module.exports = {
    MODOS_RESERVA, modoReservas, puedeReservar,
    ESTADOS_GESTION, PREFIJO_NORMALIZADO, motivoGestion, cierreSilencioso, sinDeuda, eliminado, finDelEvento,
    vigente, estadoEnGrupo, contradicciones,
    abiertoPorEstado, enCursoPorActivo, estadoEnGrupoPorActivo
};
