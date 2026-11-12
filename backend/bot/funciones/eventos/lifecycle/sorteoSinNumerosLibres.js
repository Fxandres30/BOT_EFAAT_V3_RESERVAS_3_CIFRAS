// ==========================================================================
// sorteoSinNumerosLibres.js — ¿el sorteo de `evento` ya no tiene números
// libres? Lo usa detectarEvento.js para no reactivar un sorteo terminado
// cuando alguien vuelve a pegar su anuncio.
//
// Separado a propósito de consultarDisponibilidad.js (lo que se le dice al
// cliente): esa lectura muestra la cuadrícula completa, también los números
// ocupados. Aquí se decide si ESTE sorteo terminó. UNA TABLA = UN SORTEO
// (31/10/2026): todo número de la cuadrícula del cliente es de su sorteo,
// sin mirar identidad, evento ni grupo de la fila:
//   lleno = ningún número libre en la cuadrícula del cliente y al menos uno
//           ocupado.
//
// -> true (lleno) | false | null (no se pudo leer: no se afirma nada).
// ==========================================================================

const supabase = require("../../../../lib/supabase");
const { soloDelCliente } = require("../../reservas/filtroCliente");

async function sorteoSinNumerosLibres(evento) {

    // Motor nuevo: la rifa del sorteo (evento.tabla_id). Sin rifa: no se afirma nada.
    if (require("../../../../rifas/motor").motorNuevo()) {
        const filas = await require("../../../../rifas/bot").leerFilas(evento);
        if (filas === null) return null;
        if (filas.some(f => f.estado === "libre")) return false;
        return filas.some(f => f.estado !== "libre");
    }

    if (!evento?.tabla) return null;

    const { data, error } = await soloDelCliente(
        supabase
            .from(evento.tabla)
            .select("numero, estado"),
        evento
    );

    if (error) {
        console.error("⚠️ No se pudo leer la tabla para saber si el sorteo está lleno:", error.message);
        return null;
    }

    const filas = data || [];

    if (filas.some(f => f.estado === "libre")) return false;

    return filas.some(f => f.estado !== "libre");

}

module.exports = { sorteoSinNumerosLibres };
