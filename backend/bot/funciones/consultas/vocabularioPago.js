// ==========================================================================
// vocabularioPago.js — ÚNICA lista de palabras de pago/deuda que usan
// detectarIntencion.js y pedidoTabla.js.
//
// Coincidencia EXACTA a propósito (nunca distancia de edición): a 1 error,
// "pagar" choca con "pasar", "pagado" con "pasado" y "pagos" con "pasos" —
// mensajes reales del grupo ("me pasas la tabla", "el sorteo pasado") que
// no tienen nada que ver con pagos. Los errores de escritura habituales se
// listan explícitos ("page", "devo") en vez de tolerarse por algoritmo.
//
// Se trabaja sobre tokens YA normalizados (normalizarTexto.js: minúsculas,
// sin tildes, sin signos), así "pagué" llega como "pague".
// ==========================================================================

// Errores de escritura habituales -> forma canónica. Se aplica solo a los
// tokens que se comparan contra el vocabulario de pago/estado (nunca
// cambia el texto que reciben reserva/disponibilidad).
const VARIANTES = {
    devo: "debo",
    deve: "debe",
    debooo: "debo",
    deboo: "debo",
    page: "pague",
    pagu: "pague",
    pagw: "pague",
    pqgue: "pague",
    q: "que",
    k: "que",
    ke: "que",
    qe: "que",
    qu: "que",
    cuato: "cuanto",
    cuantoo: "cuanto",
    cunto: "cuanto",
    cnto: "cuanto"
};

// Verbos/estado de ACCIÓN de pago. "cancelar" en Colombia es PAGAR
// ("ya cancelé el 25" = "ya pagué el 25"), nunca una reserva nueva.
const PALABRAS_ACCION_PAGO = new Set([
    "pago", "pagos", "paga", "pagar", "pague", "pagado", "pagados", "pagada", "pagadas",
    "pagaste", "pagamos", "pagarle", "pagarte", "pagarles",
    "cancele", "cancelo", "cancelar", "cancelado", "cancelados", "cancelada", "canceladas", "cancelaste"
]);

// Deuda ("¿qué debo?", "¿debo algo?").
const PALABRAS_DEUDA = new Set(["debo", "debe", "debemos"]);

function canonizarTokens(tokens) {
    return tokens.map(t => VARIANTES[t] || t);
}

function contieneAccionPago(tokens) {
    return tokens.some(t => PALABRAS_ACCION_PAGO.has(t));
}

function contieneDeuda(tokens) {
    return tokens.some(t => PALABRAS_DEUDA.has(t));
}

module.exports = {
    canonizarTokens,
    contieneAccionPago,
    contieneDeuda,
    PALABRAS_ACCION_PAGO,
    PALABRAS_DEUDA
};
