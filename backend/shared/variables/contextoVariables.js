// ==========================================================================
// CONTEXTO GLOBAL — normaliza ctx/resultado (ya construidos por
// eventHandler.js/resolverConsulta.js/detectarReserva.js) en la forma
// estable que el resolver global necesita. NO vuelve a calcular nada, NO
// llama a Supabase: solo LEE lo que el BOT ya resolvió antes de llegar
// aquí (mismo principio que contextBuilder.js, que ya arma el contexto de
// Gemini a partir de las mismas fuentes).
// ==========================================================================

// "Hay estado de pago" = el resultado (o alguna faceta dentro de
// resultado.resultados[], caso "multiple") ya fue resuelto por
// construirFacetaEstadoNumeros() — una consulta_pago en cualquiera de sus
// modos (lista/cantidad/monto/resumen), o un mis_numeros/mis_reservas en
// solitario, que ahora también trae el desglose pagados/pendientes (modo
// "resumen"). La faceta mis_numeros DENTRO de un "multiple" es una lista
// plana (modo "lista") y no cuenta.
function esFacetaDePago(r) {

    if (!r) return false;

    if (r.tipo === "consulta_pago") {
        return ["monto", "lista", "cantidad", "resumen"].includes(r.modo);
    }

    return (r.tipo === "mis_numeros" || r.tipo === "mis_reservas") && r.modo === "resumen";

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
