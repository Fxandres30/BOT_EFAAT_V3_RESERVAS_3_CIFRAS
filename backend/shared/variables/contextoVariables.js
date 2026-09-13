// ==========================================================================
// CONTEXTO GLOBAL — normaliza ctx/resultado (ya construidos por
// eventHandler.js/resolverConsulta.js/detectarReserva.js) en la forma
// estable que el resolver global necesita. NO vuelve a calcular nada, NO
// llama a Supabase: solo LEE lo que el BOT ya resolvió antes de llegar
// aquí (mismo principio que contextBuilder.js, que ya arma el contexto de
// Gemini a partir de las mismas fuentes).
// ==========================================================================

// "Hay estado de pago" = el resultado (o alguna faceta dentro de
// resultado.resultados[], caso "multiple") es una consulta_pago ya
// resuelta por construirFacetaEstadoNumeros() — en cualquiera de sus tres
// modos (lista/cantidad/monto). Un mis_numeros/mis_reservas plano NO
// cuenta aquí (no trae desglose pagados/pendientes), aunque
// numeros_totales_cliente sí pueda resolver desde ahí igualmente (esa
// variable no exige "estado_pago" en su requires[], solo usuario+evento).
function esFacetaDePago(r) {
    return !!r && r.tipo === "consulta_pago" && ["monto", "lista", "cantidad"].includes(r.modo);
}

function tieneEstadoPago(resultado) {

    if (!resultado) return false;

    if (esFacetaDePago(resultado)) return true;

    if (Array.isArray(resultado.resultados)) {
        return resultado.resultados.some(esFacetaDePago);
    }

    return false;

}

// construirContextoGlobal(ctx) -> contexto normalizado + banderas de
// disponibilidad usadas por requires[] (ver catalogoVariables.js).
function construirContextoGlobal(ctx) {

    const resultado = ctx?.reserva || ctx?.consulta || null;

    const disponible = {

        usuario: !!ctx?.usuario,
        evento: !!ctx?.evento,
        reserva: !!ctx?.reserva,
        consulta: !!ctx?.consulta,
        estado_pago: tieneEstadoPago(resultado)

    };

    return {
        ctx: ctx || null,
        usuario: ctx?.usuario || null,
        evento: ctx?.evento || null,
        reserva: ctx?.reserva || null,
        consulta: ctx?.consulta || null,
        resultado,
        disponible
    };

}

// Verifica requires[] de una variable contra las banderas ya calculadas.
// Todos los requires deben cumplirse (AND) — ninguno es opcional.
function contextoTieneRequisitos(contextoGlobal, requires) {

    if (!requires || requires.length === 0) {
        return true;
    }

    return requires.every(req => contextoGlobal?.disponible?.[req] === true);

}

module.exports = {
    construirContextoGlobal,
    contextoTieneRequisitos
};
