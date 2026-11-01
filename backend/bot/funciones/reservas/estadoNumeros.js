// ==========================================================================
// estadoNumeros.js — ÚNICA regla del estado REAL de un número de la
// cuadrícula del cliente, visto por un cliente (usuario) en un sorteo
// (evento). Puro: no lee ni escribe Supabase.
//
// Regla de veracidad (30/10/2026): si un número está ocupado, está ocupado,
// sea del sorteo actual, de otro sorteo, de otro grupo o de otra identidad.
// Las escrituras (UPDATE condicionados a estado + soloDelCliente) siguen
// siendo las que deciden qué se puede tocar: esta clasificación no da
// permisos.
//
// UNA TABLA = UN SORTEO (31/10/2026): la cuadrícula del cliente es la del
// sorteo, así que un número suyo en esta tabla es suyo en este sorteo,
// lo reservara por otro grupo, a mano desde el panel o con otra identidad
// guardada en la fila (identidad_evento_real/evento_id son historia, no
// pertenencia). Antes se comparaba la identidad y esos números salían
// «ocupados» para su propio dueño.
//
// Clases (cada número pedido termina en una sola):
//   libre        -> fila 'libre': se puede intentar reservar.
//   propio       -> reservado/pagado por este cliente en esta tabla.
//   ocupado      -> reservado/pagado por otra persona.
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

// Clase de UNA fila (null/undefined = el número no tiene fila).
function clasificarFila(fila, { usuario } = {}) {

    if (!fila) return "sin_registro";

    switch (fila.estado) {
        case "libre":
            return "libre";
        case "reservado":
        case "pagado":
            return reservaPerteneceAUsuario(fila, usuario) ? "propio" : "ocupado";
        case "bloqueado":
            return "bloqueado";
        case "en_proceso":
            return "en_proceso";
        default:
            return "desconocido";
    }

}

// Clase de cada número pedido, con las filas leídas de la cuadrícula.
// Devuelve un Map numero -> clase con TODOS los números pedidos, en el
// orden pedido (las filas pueden venir en cualquier orden).
function clasificarSolicitud({ numeros, filas, usuario }) {

    const porNumero = new Map((numeros || []).map(n => [String(n), []]));

    for (const fila of filas || []) {
        porNumero.get(String(fila.numero))?.push(fila);
    }

    const clases = new Map();

    for (const [numero, lista] of porNumero) {
        clases.set(numero, lista.length > 1 ? "duplicado" : clasificarFila(lista[0], { usuario }));
    }

    return clases;

}

module.exports = {
    CLASES,
    clasificarFila,
    clasificarSolicitud
};
