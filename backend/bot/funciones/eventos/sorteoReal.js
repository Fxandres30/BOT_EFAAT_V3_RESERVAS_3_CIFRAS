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
// usuario, ver frontend/services/tablas/reiniciarTabla.ts.
//
// UNA TABLA = UN SORTEO (31/10/2026): todo número de la cuadrícula del
// tenant pertenece al sorteo de esa tabla, se reservara desde el panel,
// desde WhatsApp, desde otro grupo, «sin sorteo» o en un ciclo anterior
// conservado. identidad_evento_real, evento_id y grupo_id de la fila son
// historia/auditoría: nunca separan números de la misma tabla. Antes se
// comparaba la identidad y un número reservado a mano «sin sorteo» o
// conservado de otro ciclo quedaba como «ocupado por otro sorteo»: no
// contaba en reservados/pagados ni dejaba cerrar el sorteo por pagos.
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

    // Motor único de rifas (12/11/2026): los números del sorteo son los de
    // SU rifa (eventos_bot.tabla_id), la misma fuente que Reservas. Sin rifa
    // no se lee nada (ok=false: nunca se cierra ni se recuerda con la tabla
    // de otro sorteo). La cuadrícula antigua solo con MOTOR_RIFAS=legado.
    if (require("../../../rifas/motor").motorNuevo()) {
        if (!evento?.usuario_id) return { ok: false, error: "evento sin dueño", filas: [] };
        const lectura = await require("../../../rifas/numerosSorteo").leerFilas(evento.usuario_id, evento);
        if (!lectura.ok) return { ok: false, error: lectura.error || lectura.motivo, filas: [] };
        return { ok: true, filas: lectura.filas, sinIdentidad: false };
    }

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

// Clasifica cada número ÚNICO de la tabla del sorteo (todas sus filas son
// del sorteo, ver arriba).
//   pagado      -> todas sus filas 'pagado' (duplicados inconsistentes
//                  nunca cuentan como pagados).
//   reservado   -> alguna fila en 'reservado'.
//   en_proceso / bloqueado -> estado físico de la cuadrícula del tenant.
//   sin_registro -> el número no tiene fila en la cuadrícula: no se puede
//                  reservar, así que nunca se cuenta como libre.
//   libre       -> el resto.
function clasificarNumeros(evento, filas) {

    const esperados = numerosEsperados(evento);
    const porNumero = new Map(esperados.map(n => [n, []]));

    for (const fila of filas) {
        const lista = porNumero.get(String(fila.numero));
        if (lista) lista.push(fila);
    }

    const clasificacion = new Map();

    for (const [numero, filasNumero] of porNumero) {

        const estados = new Set(filasNumero.map(f => f.estado));

        let clase;

        if (filasNumero.length === 0) clase = "sin_registro";
        else if (estados.size === 1 && estados.has("pagado")) clase = "pagado";
        else if (estados.has("reservado")) clase = "reservado";
        else if (estados.has("en_proceso")) clase = "en_proceso";
        else if (estados.has("bloqueado")) clase = "bloqueado";
        else clase = "libre";

        clasificacion.set(numero, clase);

    }

    return clasificacion;

}

function resumir(evento, clasificacion) {

    const conteo = { pagado: 0, reservado: 0, en_proceso: 0, bloqueado: 0, sin_registro: 0, libre: 0 };

    for (const clase of clasificacion.values()) conteo[clase] = (conteo[clase] || 0) + 1;

    const total = clasificacion.size;

    return {
        total,
        pagados: conteo.pagado,
        reservados: conteo.reservado,
        enProceso: conteo.en_proceso,
        bloqueados: conteo.bloqueado,
        sinRegistro: conteo.sin_registro,
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

    const clasificacion = clasificarNumeros(evento, lectura.filas);

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
