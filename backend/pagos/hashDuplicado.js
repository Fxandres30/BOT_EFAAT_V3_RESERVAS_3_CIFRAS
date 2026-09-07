// ==========================================================================
// Hash determinista de deduplicación para pagos_movimientos.
//
// Campos que forman el hash (en este orden):
//   usuario_id, proveedor (normalizado), valor, fecha_hora_movimiento
//   (redondeada al minuto), referencia (normalizada), remitente_cuenta
//   (normalizada).
//
// LIMITACIONES DOCUMENTADAS (P1 — no es una estrategia perfecta a propósito,
// ver README de backend/pagos/):
//
//   - Si `referencia` viene vacía (algunos bancos no la incluyen en la
//     notificación), el hash cae a proveedor+valor+minuto+remitente_cuenta.
//     Esto puede producir un FALSO POSITIVO de duplicado si dos movimientos
//     REALES y distintos, del mismo proveedor, mismo valor, mismo
//     remitente y en el mismo minuto, llegan sin referencia. Es un
//     compromiso aceptado para P1; P2/P3 podrán sumar más señales
//     (texto_original completo, ventana de tiempo más fina, número de
//     transacción interno del proveedor si se logra extraer, etc.).
//   - Redondear al minuto (en vez de exigir el segundo exacto) es
//     intencional: tolera pequeñas diferencias de cómo Android serializa
//     el timestamp de la notificación entre reintentos del mismo evento.
//   - El hash es determinista y NO usa texto_original completo a propósito
//     (dos notificaciones del mismo movimiento pueden traer texto
//     ligeramente distinto entre reintentos/actualizaciones del sistema
//     operativo).
// ==========================================================================

const crypto = require("crypto");

function normalizarFechaHoraAlMinuto(fechaHoraISO) {

    const fecha = new Date(fechaHoraISO);

    fecha.setSeconds(0, 0);

    return fecha.toISOString();

}

function normalizarTexto(valor) {

    if (!valor) return "";

    return String(valor).trim().toLowerCase();

}

function calcularHashDuplicado({
    usuarioId,
    proveedor,
    valor,
    fechaHoraMovimiento,
    referencia,
    remitenteCuenta
}) {

    const partes = [
        usuarioId,
        normalizarTexto(proveedor),
        Number(valor).toFixed(2),
        normalizarFechaHoraAlMinuto(fechaHoraMovimiento),
        normalizarTexto(referencia),
        normalizarTexto(remitenteCuenta)
    ];

    return crypto
        .createHash("sha256")
        .update(partes.join("|"))
        .digest("hex");

}

module.exports = {
    calcularHashDuplicado,
    normalizarFechaHoraAlMinuto,
    normalizarTexto
};
