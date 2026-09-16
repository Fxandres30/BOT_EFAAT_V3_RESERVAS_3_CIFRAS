// ==========================================================================
// FUENTE ÚNICA DE VERDAD — clasifica el estado de pago REAL de un usuario
// para una "consulta de pago", a partir de los mismos datos que ya calcula
// resolverConsulta.js (total de números activos + montoTotal/montoPagado/
// montoPendiente derivados de consultarMisNumerosPorEstado + evento.valor).
//
// Nunca se duplica en el frontend: el panel de Mensajes solo CONFIGURA
// plantillas por categoría (ver frontend/services/mensajes/tiposMensaje.ts)
// — jamás decide a cuál categoría pertenece una respuesta real. Esa
// decisión ocurre siempre aquí, en el backend, antes de elegir la
// plantilla (ver calcularTipoPresentacion en backend/bot/ai/plantillaMensaje.js).
//
// Devuelve exactamente uno de:
//   "sin_pago"      -> tiene números activos (reservado/pagado), pero
//                       montoPagado = 0.
//   "pago_parcial"  -> tiene números activos, con montoPagado > 0 Y
//                       montoPendiente > 0 (algunos pagados, otros no).
//   "pago_completo" -> tiene números activos y ya pagó el total
//                       (montoPendiente = 0, montoPagado = montoTotal).
//   "sin_saldo"     -> no tiene NINGÚN número activo (total = 0): nunca
//                       reservó, o sus reservas fueron liberadas/canceladas
//                       — no existe ninguna obligación de pago vigente.
// ==========================================================================
function determinarEstadoPago({ total, montoTotal, montoPagado, montoPendiente }) {

    if (!total || total <= 0) {
        return "sin_saldo";
    }

    if (montoPagado > 0 && montoPendiente <= 0) {
        return "pago_completo";
    }

    if (montoPagado > 0 && montoPendiente > 0) {
        return "pago_parcial";
    }

    return "sin_pago";

}

module.exports = {
    determinarEstadoPago
};
