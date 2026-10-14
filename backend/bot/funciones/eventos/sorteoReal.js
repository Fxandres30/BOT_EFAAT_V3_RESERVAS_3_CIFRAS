// ==========================================================================
// sorteoReal.js — estado de UN sorteo lógico a partir de SU tabla real.
//
// Regla de negocio:
//   - Un sorteo puede publicarse en varios grupos (una fila de eventos_bot
//     por grupo), pero todas comparten identidad_evento_real y UNA sola
//     tabla de números (p. ej. 00-99).
//   - Nunca se cuentan 100 números por grupo ni se suman los contadores de
//     las filas de eventos_bot: se lee la tabla real UNA vez y se clasifica
//     cada número ÚNICO.
//   - Un sorteo está COMPLETO solo si TODOS sus números (00..99) están
//     'pagado'. libre, reservado, bloqueado y en_proceso no cuentan.
//
// "Tabla real del sorteo" = filas de evento.tabla del tenant
// (usuario_id = evento.usuario_id) — la cuadrícula que el panel crea por
// usuario, ver frontend/services/tablas/reiniciarTabla.ts — restringidas a
// la identidad del sorteo cuando se habla de reservas/pagos. Un número que
// otro sorteo tiene ocupado no es "pagado" de este.
// ==========================================================================

const supabase = require("../../../lib/supabase");

const ESTADOS_NO_PAGADOS = ["libre", "reservado", "bloqueado", "en_proceso"];

// Números esperados del sorteo con sus ceros iniciales: 2 cifras -> 00..99.
function numerosEsperados({ cifras, cantidad_numeros }) {

    const cantidad = Number(cantidad_numeros) || 0;
    const ancho = Number(cifras) || String(Math.max(cantidad - 1, 0)).length;

    return Array.from({ length: cantidad }, (_, i) => String(i).padStart(ancho, "0"));

}

// Clave del sorteo lógico: tenant + identidad. Sin identidad (fila previa a
// la migración 015) cada fila es su propio sorteo, como antes.
function claveSorteo(evento) {

    if (!evento) return null;

    return evento.identidad_evento_real
        ? `${evento.usuario_id || ""}::${evento.identidad_evento_real}`
        : `evento::${evento.id}`;

}

// Lee la tabla real UNA vez. Devuelve { ok, filas } con numero, estado e
// identidad de cada fila de la cuadrícula del tenant.
async function leerTablaDelSorteo(evento) {

    if (!evento?.tabla) return { ok: false, error: "evento sin tabla", filas: [] };

    const construir = (conIdentidad) => {

        let query = supabase
            .from(evento.tabla)
            .select(conIdentidad ? "numero, estado, identidad_evento_real, evento_id" : "numero, estado, evento_id");

        if (evento.usuario_id) {
            query = query.eq("usuario_id", evento.usuario_id);
        } else if (conIdentidad && evento.identidad_evento_real) {
            query = query.eq("identidad_evento_real", evento.identidad_evento_real);
        } else {
            query = query.eq("evento_id", evento.id);
        }

        return query;

    };

    let { data, error } = await construir(true);

    // Red de seguridad de despliegue (mismo criterio que reservarNumeros.js):
    // sin la columna identidad_evento_real (migración 015 sin aplicar) se
    // identifica el sorteo por evento_id, como antes de esa migración.
    let sinIdentidad = false;

    if (error?.code === "42703") {
        ({ data, error } = await construir(false));
        sinIdentidad = true;
    }

    if (error) return { ok: false, error: error.message, filas: [] };

    return { ok: true, filas: data || [], sinIdentidad };

}

// ¿Esta fila pertenece a este sorteo? Por identidad; sin identidad en el
// evento (dato previo a 015) o sin la columna, por evento_id como antes.
function filaDelSorteo(fila, evento, sinIdentidad = false) {

    return evento.identidad_evento_real && !sinIdentidad
        ? fila.identidad_evento_real === evento.identidad_evento_real
        : fila.evento_id === evento.id;

}

// Clasifica cada número ÚNICO del sorteo.
//   pagado      -> tiene fila 'pagado' de ESTE sorteo y ninguna fila de este
//                  sorteo en otro estado (duplicados inconsistentes nunca
//                  cuentan como pagados).
//   reservado   -> alguna fila de este sorteo en 'reservado'.
//   en_proceso / bloqueado -> estado físico de la cuadrícula del tenant.
//   ocupado_otro_sorteo -> reservado/pagado por OTRA identidad.
//   libre       -> el resto.
function clasificarNumeros(evento, filas, sinIdentidad = false) {

    const esperados = numerosEsperados(evento);
    const porNumero = new Map(esperados.map(n => [n, []]));

    for (const fila of filas) {
        const lista = porNumero.get(String(fila.numero));
        if (lista) lista.push(fila);
    }

    const clasificacion = new Map();

    for (const [numero, filasNumero] of porNumero) {

        const propias = filasNumero.filter(f => filaDelSorteo(f, evento, sinIdentidad));
        const estadosPropios = new Set(propias.map(f => f.estado));
        const estadosFisicos = new Set(filasNumero.map(f => f.estado));

        let clase;

        if (estadosPropios.size === 1 && estadosPropios.has("pagado")) clase = "pagado";
        else if (estadosPropios.has("reservado")) clase = "reservado";
        else if (estadosFisicos.has("en_proceso")) clase = "en_proceso";
        else if (estadosFisicos.has("bloqueado")) clase = "bloqueado";
        else if (filasNumero.some(f => !filaDelSorteo(f, evento, sinIdentidad) && (f.estado === "reservado" || f.estado === "pagado"))) clase = "ocupado_otro_sorteo";
        else clase = "libre";

        clasificacion.set(numero, clase);

    }

    return clasificacion;

}

function resumir(evento, clasificacion) {

    const conteo = { pagado: 0, reservado: 0, en_proceso: 0, bloqueado: 0, ocupado_otro_sorteo: 0, libre: 0 };

    for (const clase of clasificacion.values()) conteo[clase] = (conteo[clase] || 0) + 1;

    const total = clasificacion.size;

    return {
        total,
        pagados: conteo.pagado,
        reservados: conteo.reservado,
        enProceso: conteo.en_proceso,
        bloqueados: conteo.bloqueado,
        ocupadosOtroSorteo: conteo.ocupado_otro_sorteo,
        libres: conteo.libre,
        // Completo SOLO con todos los números únicos pagados (y al menos uno).
        completo: total > 0 && conteo.pagado === total
    };

}

// Punto de entrada: estado del sorteo lógico de `evento` (cualquiera de sus
// filas de eventos_bot sirve: todas comparten tabla e identidad).
async function estadoDelSorteo(evento) {

    const lectura = await leerTablaDelSorteo(evento);

    if (!lectura.ok) return { ok: false, error: lectura.error, completo: false };

    const clasificacion = clasificarNumeros(evento, lectura.filas, lectura.sinIdentidad);

    return { ok: true, ...resumir(evento, clasificacion), clasificacion };

}

module.exports = {
    ESTADOS_NO_PAGADOS,
    numerosEsperados,
    claveSorteo,
    leerTablaDelSorteo,
    clasificarNumeros,
    resumir,
    estadoDelSorteo
};
