// ==========================================================================
// sorteoSinNumerosLibres.js — ¿el sorteo de `evento` ya no tiene números
// libres? Lo usa detectarEvento.js para no reactivar un sorteo terminado
// cuando alguien vuelve a pegar su anuncio.
//
// Separado a propósito de consultarDisponibilidad.js (lo que se le dice al
// cliente): esa lectura muestra la cuadrícula completa, también los números
// ocupados por OTROS sorteos. Aquí se decide si ESTE sorteo terminó, y una
// tabla llena solo por otro sorteo no lo termina (sería reemplazar un sorteo
// vigente). Es exactamente el criterio de antes de la regla de veracidad:
//   lleno = ningún número libre en la cuadrícula del cliente y al menos uno
//           ocupado por este sorteo (o por una fila sin identidad, dato
//           previo a la migración 015).
//
// -> true (lleno) | false | null (no se pudo leer: no se afirma nada).
// ==========================================================================

const supabase = require("../../../../lib/supabase");
const { soloDelCliente } = require("../../reservas/filtroCliente");

async function sorteoSinNumerosLibres(evento) {

    if (!evento?.tabla) return null;

    const { data, error } = await soloDelCliente(
        supabase
            .from(evento.tabla)
            .select("numero, estado, identidad_evento_real"),
        evento
    );

    if (error) {
        console.error("⚠️ No se pudo leer la tabla para saber si el sorteo está lleno:", error.message);
        return null;
    }

    const filas = data || [];

    if (filas.some(f => f.estado === "libre")) return false;

    const identidad = evento.identidad_evento_real;

    return filas.some(f => f.estado !== "libre" &&
        (!identidad || !f.identidad_evento_real || f.identidad_evento_real === identidad));

}

module.exports = { sorteoSinNumerosLibres };
