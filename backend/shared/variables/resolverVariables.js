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

// Recibe la DEFINICIÓN completa (no solo la clave) para poder distinguir
// una variable de concordancia DINÁMICA (creada desde el panel —
// variables_globales, ver catalogoVariables.js::normalizarVariableDinamica)
// de las 15 ESTÁTICAS de siempre. Si no existe definición dinámica para
// esa clave, se conserva el fallback actual sin ningún cambio de
// comportamiento (gramatica.js sigue siendo la fuente de las 15 fijas).
function resolverValorGramatical(definicion, conjunto, contextoGlobal) {

    const relevantes = obtenerGramatica().calcularNumerosRelevantes(contextoGlobal.ctx || {}, contextoGlobal.resultado);

    // ---- Variable de concordancia DINÁMICA (variables_globales) ----
    // No participa en la mecánica de "por conjunto" (_reservados/_ocupados/
    // _disponibles) en esta fase: resolverClaveCanonica() solo reconoce ese
    // sufijo para las claves listadas en GRAMATICA_KEYS (las 15 estáticas),
    // así que una dinámica nunca llega aquí con `conjunto` distinto de null.
    if (definicion.dinamica) {

        const esSingular = Number(relevantes.cantidadNumeros) === 1;

        return valorSeguro(esSingular ? definicion.singular : definicion.plural);

    }

    const claveBase = definicion.key;

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

// Aplica un modificador de texto opcional ("{{variable|modificador}}") al
// valor YA resuelto — nunca antes: nunca cambia CUÁL variable se resuelve,
// solo transforma el texto resultante. Un modificador desconocido se
// ignora (se deja el valor tal cual) en vez de romper el mensaje. Nunca se
// crean variables nuevas para mayúsculas/minúsculas (p. ej. NO existe
// "disponibles_mayuscula") — este es el único mecanismo para eso.
function aplicarModificadorTexto(valor, modificador) {

    if (!modificador || typeof valor !== "string" || valor === "") {
        return valor;
    }

    switch (modificador) {

        case "lower": return valor.toLowerCase();

        case "upper": return valor.toUpperCase();

        case "capitalize": return valor.charAt(0).toUpperCase() + valor.slice(1).toLowerCase();

        case "title": return valor.replace(/\S+/g, (palabra) =>
            palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase()
        );

        default: return valor;

    }

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
            // Único caso con formato propio (grilla de 3 filas, ver
            // gramatica.js::formatearGrillaNumeros) — calcularNumerosRelevantes
            // solo llena numerosDisponibles cuando tipo==="disponibilidad"
            // (ver gramatica.js), así que este cambio de formato no afecta
            // ningún otro tipo de respuesta (reservados/ocupados/solicitados
            // siguen usando formatearListaNumeros, sin cambios).
            const r = obtenerGramatica().calcularNumerosRelevantes(ctx || {}, resultado);
            return obtenerGramatica().formatearGrillaNumeros(r.numerosDisponibles);
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

// resolverVariable(nombreEscrito, contextoGlobal, catalogoExtra?) -> string,
// NUNCA undefined/null/"[object Object]". nombreEscrito puede ser la clave
// canónica, un alias, o una forma sufijada de gramática
// ("ocupado_ocupados_ocupados"). Si no es una variable conocida, o si el
// contexto no cumple requires[], devuelve "". catalogoExtra (opcional) son
// las variables dinámicas del usuario (variables_globales, ya normalizadas)
// — si se omite, el comportamiento es idéntico al de siempre.
function resolverVariable(nombreEscrito, contextoGlobal, catalogoExtra) {

    const info = catalogo.resolverClaveCanonica(nombreEscrito, catalogoExtra);

    if (!info) {
        return "";
    }

    const { definicion, esGramaticaPorConjunto, conjunto } = info;

    if (definicion.type === "concordancia" || esGramaticaPorConjunto) {
        return resolverValorGramatical(definicion, esGramaticaPorConjunto ? conjunto : null, contextoGlobal);
    }

    // Variable de tipo "texto" DINÁMICA (variables_globales): un valor fijo
    // configurado desde el panel, sin requires[] que comprobar (siempre
    // disponible, igual que cualquier dato constante).
    if (definicion.dinamica && definicion.type === "texto") {
        return valorSeguro(definicion.valor);
    }

    if (!contextoTieneRequisitos(contextoGlobal, definicion.requires)) {
        return "";
    }

    return resolverValorBase(definicion.key, contextoGlobal);

}

// Resuelve TODAS las variables "NUEVA" del catálogo (las huérfanas
// conectadas en fases anteriores, MÁS las dinámicas de variables_globales
// que listarCatalogo() ya agrega con estado "NUEVA" — ver
// catalogoVariables.js::normalizarVariableDinamica) contra un contexto ya
// construido — pensado para que plantillaMensaje.js::construirVariables()
// las incorpore sin duplicar su propia lógica existente para las
// variables "EXISTENTE".
function resolverVariablesOrfanas(contextoGlobal, catalogoExtra) {

    const resultado = {};

    for (const variable of catalogo.listarCatalogo(catalogoExtra)) {

        if (variable.estado === "NUEVA") {
            resultado[variable.key] = resolverVariable(variable.key, contextoGlobal, catalogoExtra);
        }

    }

    return resultado;

}

// resolverTexto(texto, contextoGlobal, catalogoExtra?) -> string —
// sustituye cada {{variable}} o {{variable|modificador}} del texto
// llamando a resolverVariable() (misma resolución, mismos alias, mismo
// "nunca inventa") y aplicando el modificador de texto si se escribió uno
// (ver aplicarModificadorTexto) — sin necesitar un objeto de variables
// pre-armado. Punto de entrada genérico para cualquier llamador nuevo
// (p. ej. Inicio del día, en automation/) que solo tiene un texto de
// plantilla y un contexto — no es un motor nuevo, es este mismo resolver
// aplicado a una cadena completa en vez de a una sola clave.
function resolverTexto(texto, contextoGlobal, catalogoExtra) {

    if (typeof texto !== "string" || !texto.trim()) {
        return "";
    }

    return texto.replace(/\{\{\s*(\w+)(?:\|(\w+))?\s*\}\}/g, (_match, nombre, modificador) =>
        aplicarModificadorTexto(resolverVariable(nombre, contextoGlobal, catalogoExtra), modificador)
    );

}

module.exports = {
    resolverVariable,
    resolverVariablesOrfanas,
    aplicarModificadorTexto,
    resolverTexto,
    formatearMoneda
};
