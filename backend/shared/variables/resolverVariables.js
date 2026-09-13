// ==========================================================================
// RESOLVER GLOBAL — conecta VARIABLE -> CONTEXTO -> FUENTE REAL -> FORMATO.
//
// No reimplementa lógica de negocio: delega en gramatica.js (concordancia/
// listas) y lee campos que resolverConsulta.js / plantillaMensaje.js ya
// calculan. Nunca llama a Supabase — si el dato no vino ya en el contexto,
// la variable resuelve a "" (nunca undefined/null/[object Object], nunca
// inventa un valor).
//
// Frontera arquitectónica (ver auditoría): gramatica.js y formatHora.js
// viven bajo bot/, y automation/ tiene prohibido importar nada bajo bot/
// (mismo límite ya documentado en automation/tablaInicial.js). Por eso
// estas dos dependencias se cargan de forma PEREZOSA (solo la primera vez
// que una variable que realmente las necesita se resuelve, nunca al
// cargar este módulo) — así, un llamador de automation/ (p. ej. Inicio
// del día, que solo resuelve evento/premio) puede usar este MISMO
// resolver global sin que bot/ai/gramatica.js llegue a cargarse nunca en
// ese proceso. Si algún día automation/ resuelve una variable de
// concordancia/hora, sí violaría el límite — eso debe evitarse en el
// llamador, no aquí.
// ==========================================================================

let _gramatica = null;
function obtenerGramatica() {
    if (!_gramatica) _gramatica = require("../../bot/ai/gramatica");
    return _gramatica;
}

let _formatHora12 = null;
function obtenerFormatHora12() {
    if (!_formatHora12) _formatHora12 = require("../../bot/utils/formatHora").formatHora12;
    return _formatHora12;
}

const catalogo = require("./catalogoVariables");
const { contextoTieneRequisitos } = require("./contextoVariables");

function formatearMoneda(valor) {

    const n = Number(valor) || 0;

    return `$${n.toLocaleString("es-CO")}`;

}

function valorSeguro(valor) {

    return valor !== undefined && valor !== null && valor !== "" ? String(valor) : "";

}

// Busca el primer resultado (el propio, o dentro de resultado.resultados[]
// en el caso "multiple") que cumpla el predicado — solo LEE datos ya
// calculados por resolverConsulta.js, nunca combina/recalcula montos o
// listas por su cuenta.
function buscarEnResultados(resultado, predicado) {

    if (!resultado) {
        return null;
    }

    if (predicado(resultado)) {
        return resultado;
    }

    if (Array.isArray(resultado.resultados)) {
        return resultado.resultados.find(predicado) || null;
    }

    return null;

}

function resolverValorGramatical(claveBase, conjunto, contextoGlobal) {

    const relevantes = obtenerGramatica().calcularNumerosRelevantes(contextoGlobal.ctx || {}, contextoGlobal.resultado);

    if (conjunto) {

        const cantidadesPorConjunto = {
            reservados: relevantes.cantidadReservados,
            ocupados: relevantes.cantidadOcupados,
            disponibles: relevantes.cantidadDisponibles
        };

        const formas = obtenerGramatica().construirVariablesPorConjunto({ [conjunto]: cantidadesPorConjunto[conjunto] });

        return valorSeguro(formas[`${claveBase}_${conjunto}`]);

    }

    // "tu_numero_tus_numeros" es de PROPIEDAD (cantidadPropiedad); el
    // resto de pares son neutros y usan cantidadNumeros — mismo criterio
    // que ya aplica plantillaMensaje.js::construirVariables.
    const cantidad = claveBase === "tu_numero_tus_numeros"
        ? relevantes.cantidadPropiedad
        : relevantes.cantidadNumeros;

    const formas = obtenerGramatica().construirVariablesGramaticales(cantidad);

    return valorSeguro(formas[claveBase]);

}

function resolverValorBase(key, contextoGlobal) {

    const { usuario, evento, resultado, ctx } = contextoGlobal;

    switch (key) {

        case "cliente": return valorSeguro(usuario?.nombre);

        case "telefono": return valorSeguro(usuario?.telefono);

        case "evento": return valorSeguro(evento?.nombre_evento);

        case "premio": return valorSeguro(evento?.premios?.[0]?.premio);

        case "fecha": return valorSeguro(evento?.fecha_evento);

        case "hora": return evento?.hora_fin ? valorSeguro(obtenerFormatHora12()(evento.hora_fin)) : "";

        // Mismo dato real que "hora" (cierre del evento) pero sin el
        // formateo 12h — así lo consume hoy automation/engine.js.
        case "hora_cierre": return valorSeguro(evento?.hora_cierre ?? evento?.hora_fin);

        case "precio": return valorSeguro(evento?.valor);

        case "cantidad": return valorSeguro(resultado?.cantidad);

        case "numeros_solicitados": {
            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return obtenerGramatica().formatearListaNumeros(r.numerosSolicitados);
        }

        case "numeros_reservados": {
            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return obtenerGramatica().formatearListaNumeros(r.numerosReservados);
        }

        case "numeros_ocupados": {
            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return obtenerGramatica().formatearListaNumeros(r.numerosOcupados);
        }

        case "numeros_disponibles": {
            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return obtenerGramatica().formatearListaNumeros(r.numerosDisponibles);
        }

        case "cantidad_reservados": {
            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return valorSeguro(r.cantidadReservados);
        }

        case "cantidad_ocupados": {
            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return valorSeguro(r.cantidadOcupados);
        }

        case "cantidad_disponibles": {

            // Sin reserva/consulta en curso (p. ej. un anuncio de tabla
            // bare como compartirTabla.js), el conteo por gramática
            // siempre da 0 (no hay ningún resultado de disponibilidad que
            // leer) — eso sería un "0" incorrecto, no un vacío honesto.
            // evento.libres ya es el conteo real y vigente (el mismo que
            // guardarEvento.js mantiene) — se usa como fuente directa aquí.
            if (!ctx?.reserva && !ctx?.consulta && evento?.libres != null) {
                return valorSeguro(evento.libres);
            }

            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return valorSeguro(r.cantidadDisponibles);

        }

        // ---- Variables "huérfanas" conectadas en esta fase (Paso 5) ----
        // Todas leen campos que construirFacetaEstadoNumeros() ya calcula
        // en resolverConsulta.js (consulta_pago / multiple) o que
        // consultarMisNumeros.js ya calcula (mis_numeros/mis_reservas) —
        // ninguna vuelve a calcular un monto o una lista por su cuenta.

        case "numeros_pagados": {
            const f = buscarEnResultados(resultado, r => Array.isArray(r.pagados));
            return f ? obtenerGramatica().formatearListaNumeros(f.pagados) : "";
        }

        case "numeros_pendientes": {
            const f = buscarEnResultados(resultado, r => r.modo === "lista" && Array.isArray(r.reservados));
            return f ? obtenerGramatica().formatearListaNumeros(f.reservados) : "";
        }

        case "numeros_totales_cliente": {
            const f = buscarEnResultados(resultado, r => Array.isArray(r.numerosDelUsuario));
            return f ? obtenerGramatica().formatearListaNumeros(f.numerosDelUsuario) : "";
        }

        case "cantidad_pagados": {
            const lista = buscarEnResultados(resultado, r => r.modo === "lista" && Array.isArray(r.pagados));
            if (lista) return valorSeguro(lista.pagados.length);
            const directa = buscarEnResultados(resultado, r => r.modo === "cantidad" && r.bucket === "pagado");
            return directa ? valorSeguro(directa.cantidad) : "";
        }

        case "cantidad_pendientes": {
            const lista = buscarEnResultados(resultado, r => r.modo === "lista" && Array.isArray(r.reservados));
            if (lista) return valorSeguro(lista.reservados.length);
            const directa = buscarEnResultados(resultado, r => r.modo === "cantidad" && r.bucket === "pendiente");
            return directa ? valorSeguro(directa.cantidad) : "";
        }

        case "monto_total": {
            const f = buscarEnResultados(resultado, r => r.modo === "monto");
            return f ? formatearMoneda(f.montoTotal) : "";
        }

        case "monto_pagado": {
            const f = buscarEnResultados(resultado, r => r.modo === "monto");
            return f ? formatearMoneda(f.montoPagado) : "";
        }

        case "monto_pendiente": {
            const f = buscarEnResultados(resultado, r => r.modo === "monto");
            return f ? formatearMoneda(f.montoPendiente) : "";
        }

        default: return "";

    }

}

// resolverVariable(nombreEscrito, contextoGlobal) -> string, NUNCA
// undefined/null/"[object Object]". nombreEscrito puede ser la clave
// canónica, un alias, o una forma sufijada de gramática
// ("ocupado_ocupados_ocupados"). Si no es una variable conocida, o si el
// contexto no cumple requires[], devuelve "".
function resolverVariable(nombreEscrito, contextoGlobal) {

    const info = catalogo.resolverClaveCanonica(nombreEscrito);

    if (!info) {
        return "";
    }

    const { definicion, esGramaticaPorConjunto, conjunto } = info;

    if (definicion.type === "concordancia" || esGramaticaPorConjunto) {
        return resolverValorGramatical(definicion.key, esGramaticaPorConjunto ? conjunto : null, contextoGlobal);
    }

    if (!contextoTieneRequisitos(contextoGlobal, definicion.requires)) {
        return "";
    }

    return resolverValorBase(definicion.key, contextoGlobal);

}

// Resuelve TODAS las variables "NUEVA" del catálogo (las huérfanas
// conectadas en esta fase) contra un contexto ya construido — pensado para
// que plantillaMensaje.js::construirVariables() las incorpore sin
// duplicar su propia lógica existente para las variables "EXISTENTE".
function resolverVariablesOrfanas(contextoGlobal) {

    const resultado = {};

    for (const variable of catalogo.listarCatalogo()) {

        if (variable.estado === "NUEVA") {
            resultado[variable.key] = resolverVariable(variable.key, contextoGlobal);
        }

    }

    return resultado;

}

// resolverTexto(texto, contextoGlobal) -> string — sustituye cada
// {{variable}} del texto llamando a resolverVariable() (misma resolución,
// mismos alias, mismo "nunca inventa"), sin necesitar un objeto de
// variables pre-armado. Punto de entrada genérico para cualquier llamador
// nuevo (p. ej. Inicio del día, en automation/) que solo tiene un texto de
// plantilla y un contexto — no es un motor nuevo, es este mismo resolver
// aplicado a una cadena completa en vez de a una sola clave.
function resolverTexto(texto, contextoGlobal) {

    if (typeof texto !== "string" || !texto.trim()) {
        return "";
    }

    return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, nombre) => resolverVariable(nombre, contextoGlobal));

}

module.exports = {
    resolverVariable,
    resolverVariablesOrfanas,
    resolverTexto,
    formatearMoneda
};
