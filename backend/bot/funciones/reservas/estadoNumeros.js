// ==========================================================================
// estadoNumeros.js — ÚNICA regla del estado REAL de un número de la
// cuadrícula del cliente, visto por un cliente (usuario) en un sorteo
// (evento). Puro: no lee ni escribe Supabase.
//
// Regla de veracidad (30/10/2026): si un número está ocupado, está ocupado,
// sea del sorteo actual, de otro sorteo, de otro grupo o de otra identidad.
// La identidad del sorteo solo decide si un número ocupado es PROPIO (del
// cliente en ESTE sorteo); nunca lo oculta ni lo vuelve libre. Las
// escrituras (UPDATE condicionados a estado + soloDelCliente) siguen siendo
// las que deciden qué se puede tocar: esta clasificación no da permisos.
//
// Clases (cada número pedido termina en una sola):
//   libre        -> fila 'libre': se puede intentar reservar.
//   propio       -> reservado/pagado por este cliente en ESTE sorteo.
//   ocupado      -> reservado/pagado por otra persona, o por el mismo
//                   cliente en OTRO sorteo (en este no está disponible).
//   bloqueado    -> fila 'bloqueado'.
//   en_proceso   -> fila 'en_proceso' (también con la retención vencida:
//                   en la base sigue retenido y nadie puede reservarlo).
//   sin_registro -> el número no tiene fila en la cuadrícula (integridad).
//   duplicado    -> el número tiene varias filas (integridad).
//   desconocido  -> estado que la regla no contempla (integridad).
// Los errores de lectura y de escritura los decide el llamador: aquí no
// llega ninguna fila que no se haya leído.
// ==========================================================================

const { reservaPerteneceAUsuario } = require("../usuarios/obtenerUsuarioGlobal");

const CLASES = ["libre", "propio", "ocupado", "bloqueado", "en_proceso", "sin_registro", "duplicado", "desconocido"];

// ¿La fila está ocupada por un sorteo distinto al del evento? Sin identidad
// en el evento o en la fila (dato previo a la migración 015) no se puede
// afirmar que sea de otro sorteo. consultarReservas.js ya marca deOtroSorteo
// con este mismo criterio.
function esDeOtroSorteo(fila, evento) {
    if (fila?.deOtroSorteo === true) return true;
    const identidad = evento?.identidad_evento_real;
    return Boolean(identidad && fila?.identidad_evento_real && fila.identidad_evento_real !== identidad);
}

// Clase de UNA fila (null/undefined = el número no tiene fila).
function clasificarFila(fila, { evento, usuario } = {}) {

    if (!fila) return "sin_registro";

    switch (fila.estado) {
        case "libre":
            return "libre";
        case "reservado":
        case "pagado":
            if (esDeOtroSorteo(fila, evento)) return "ocupado";
            return reservaPerteneceAUsuario(fila, usuario) ? "propio" : "ocupado";
        case "bloqueado":
            return "bloqueado";
        case "en_proceso":
            return "en_proceso";
        default:
            return "desconocido";
    }

}

// ¿Es del mismo cliente pero de OTRO sorteo? (para explicarlo en la
// consulta de un número; en la reserva cuenta como ocupado).
function esPropioDeOtroSorteo(fila, { evento, usuario } = {}) {
    return Boolean(fila && (fila.estado === "reservado" || fila.estado === "pagado") &&
        esDeOtroSorteo(fila, evento) && reservaPerteneceAUsuario(fila, usuario));
}

// Clase de cada número pedido, con las filas leídas de la cuadrícula.
// Devuelve un Map numero -> clase con TODOS los números pedidos, en el
// orden pedido (las filas pueden venir en cualquier orden).
function clasificarSolicitud({ numeros, filas, evento, usuario }) {

    const porNumero = new Map((numeros || []).map(n => [String(n), []]));

    for (const fila of filas || []) {
        porNumero.get(String(fila.numero))?.push(fila);
    }

    const clases = new Map();

    for (const [numero, lista] of porNumero) {
        clases.set(numero, lista.length > 1 ? "duplicado" : clasificarFila(lista[0], { evento, usuario }));
    }

    return clases;

}

module.exports = {
    CLASES,
    esDeOtroSorteo,
    clasificarFila,
    esPropioDeOtroSorteo,
    clasificarSolicitud
};
