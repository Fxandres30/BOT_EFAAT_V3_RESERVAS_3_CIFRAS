// FUENTE ÚNICA DE VERDAD para singular/plural en toda la capa de
// presentación (plantillas de mensajes y contexto enviado a Gemini).
// Ningún otro archivo debe implementar su propia rama singular/plural:
// todos deben llamar a construirVariablesGramaticales() con una cantidad
// YA CALCULADA por el BOT (nunca decide ni inventa esa cantidad).
//
// Regla fija (irrenunciable):
//   cantidad === 1        -> SINGULAR
//   cantidad === 0 o >= 2 -> PLURAL
// (en español, "cero" concuerda en plural: "no tienes números", "0
// números disponibles" — por eso cero se agrupa con el plural, no con el
// singular).
function construirVariablesGramaticales(cantidad) {

    const n = Number(cantidad);
    const singular = Number.isFinite(n) && n === 1;

    return singular ? {

        tu_numero_tus_numeros: "tu número",
        el_numero_los_numeros: "el número",
        ese_esos: "ese número",
        esta_estan: "está",
        estaba_estaban: "estaba",
        es_son: "es",
        reservado_reservados: "reservado",
        ocupado_ocupados: "ocupado",
        disponible_disponibles: "disponible",
        numero_numeros: "número",
        // Fase 2 — agregadas al auditar las 36 plantillas "requiere
        // revisión": cada una resuelve una concordancia real encontrada en
        // plantillas existentes, no una variable especulativa.
        quedo_quedaron: "quedó",
        queda_quedan: "queda",
        tuyo_tuyos: "tuyo",
        libre_libres: "libre",
        su_numero_sus_numeros: "su número"

    } : {

        tu_numero_tus_numeros: "tus números",
        el_numero_los_numeros: "los números",
        ese_esos: "esos números",
        esta_estan: "están",
        estaba_estaban: "estaban",
        es_son: "son",
        reservado_reservados: "reservados",
        ocupado_ocupados: "ocupados",
        disponible_disponibles: "disponibles",
        numero_numeros: "números",
        quedo_quedaron: "quedaron",
        queda_quedan: "quedan",
        tuyo_tuyos: "tuyos",
        libre_libres: "libres",
        su_numero_sus_numeros: "sus números"

    };

}

// Fase 2 — cantidades INDEPENDIENTES por conjunto (reservados / ocupados /
// disponibles). reserva_parcial es el caso real que lo exige: una misma
// respuesta habla de DOS listas con cantidades que pueden no coincidir
// ("1 número reservado y 2 números ocupados"), y ninguna de las 15 variables
// de arriba puede concordar con dos cantidades a la vez bajo un solo nombre.
//
// Esta función NO agrega vocabulario nuevo: reutiliza exactamente
// construirVariablesGramaticales() (la única fuente de las formas) y solo
// le pone un sufijo "_<conjunto>" a cada clave, para poder pedir "la forma
// de esta palabra, pero de la lista de ocupados" sin un ternario por
// archivo. Es mecánico a propósito — sin excepciones por palabra — para
// que no haga falta lógica repartida cuando aparezca un cuarto conjunto.
//
// Ejemplo: construirVariablesPorConjunto({ ocupados: 2 }) ->
//   { numero_numeros_ocupados: "números", ocupado_ocupados_ocupados: "ocupados", ... }
function construirVariablesPorConjunto(cantidadesPorConjunto) {

    const resultado = {};

    for (const conjunto of Object.keys(cantidadesPorConjunto || {})) {

        const cantidad = cantidadesPorConjunto[conjunto];

        if (cantidad === undefined || cantidad === null) {
            continue;
        }

        const formas = construirVariablesGramaticales(cantidad);

        for (const clave of Object.keys(formas)) {
            resultado[`${clave}_${conjunto}`] = formas[clave];
        }

    }

    return resultado;

}

// FORMATO ÚNICO Y OBLIGATORIO para presentar cualquier lista de números en
// las plantillas: "( 27 )" para uno solo, "( 27 - 45 - 60 )" para varios.
// Fuente única de verdad — ninguna plantilla, ni resolverConsulta.js, ni
// ningún otro archivo debe formatear una lista de números de otra manera
// (nunca coma, nunca "/", nunca corchetes). Un arreglo vacío se presenta
// como cadena vacía (no hay lista que mostrar), igual que el
// comportamiento anterior basado en join().
function formatearListaNumeros(numeros) {

    const lista = Array.isArray(numeros) ? numeros : [];

    if (lista.length === 0) {
        return "";
    }

    return `( ${lista.join(" - ")} )`;

}

// Cuántas columnas usar según la CANTIDAD TOTAL de números (mensaje
// "Disponibles" — corrección 2026-09-13, reemplaza el diseño anterior de
// "siempre 3 filas"). Las filas CRECEN según la cantidad: esto solo decide
// el ANCHO de cada fila, nunca cuántas filas hay en total ni cuántos
// números se muestran.
//
//   > 60 disponibles -> 4 por fila
//   40-60 disponibles -> 3 por fila
//   < 40 disponibles  -> 3 por fila mientras sea visualmente adecuado,
//                        bajando a 2 (pocos) o 1 (uno solo) para que la
//                        última fila nunca quede casi vacía.
function determinarColumnasGrilla(total) {

    if (total > 60) return 4;
    if (total >= 7) return 3;
    if (total >= 2) return 2;
    return 1;

}

// Organiza una lista de números en una grilla con 🍀 delante de cada uno,
// mostrando SIEMPRE todos los números recibidos (la cantidad de FILAS
// crece según la cantidad total — el ancho de fila lo decide
// determinarColumnasGrilla(), nunca un límite de filas). Usado SOLO para
// numeros_disponibles (ver catalogoVariables.js/resolverVariables.js):
// formatearListaNumeros (arriba) sigue siendo el formato "( 01 - 02 )" para
// todo lo demás (reservados/ocupados/solicitados), sin cambios.
//
// Única fuente de verdad: consultarDisponibilidad() ya entrega el array
// real, sin duplicados, ordenado — pero esta función NUNCA confía
// ciegamente en eso: normaliza (quita valores vacíos), elimina duplicados
// y ordena NUMÉRICAMENTE ella misma antes de construir el texto, para que
// "datos duplicados" o "datos desordenados" en la entrada nunca produzcan
// un número repetido ni fuera de orden en la salida. No inventa ni
// descarta ningún número real: unique()+sort() nunca cambian CUÁLES
// números hay, solo su orden y unicidad.
function formatearGrillaNumeros(numeros) {

    const crudos = Array.isArray(numeros) ? numeros : [];

    const unicos = [...new Set(crudos.filter(n => n !== null && n !== undefined && n !== ""))];

    unicos.sort((a, b) => Number(a) - Number(b));

    if (unicos.length === 0) {
        return "";
    }

    const columnas = determinarColumnasGrilla(unicos.length);

    const filas = [];

    for (let i = 0; i < unicos.length; i += columnas) {
        filas.push(unicos.slice(i, i + columnas));
    }

    return filas
        .map(fila => fila.map(n => `🍀 ${n}`).join("     "))
        .join("\n");

}

// Capitaliza la primera letra — usado para iniciar frase con una variable
// de gramática ("tu número" -> "Tu número") sin duplicar el diccionario.
function capitalizar(texto) {

    if (typeof texto !== "string" || !texto) {
        return texto;
    }

    return texto.charAt(0).toUpperCase() + texto.slice(1);

}

// Única fuente de verdad para "cuántos números están involucrados en esta
// respuesta". Reutilizada tanto por plantillaMensaje.js (variables de
// plantilla) como por contextBuilder.js (contexto real que recibe
// Gemini) — así ambos caminos de redacción parten exactamente del mismo
// número, y Gemini nunca puede inventar ni corregir por su cuenta una
// cantidad distinta a la que el BOT ya calculó.
//
// cantidadPropiedad: cantidad de números "del cliente" (para "tu número" /
// "tus números" — no aplica a números de otros, p.ej. disponibilidad).
// cantidadNumeros: cantidad general de números de los que habla la
// respuesta (incluye disponibilidad, donde no hay dueño).
const { extraerNumeros } = require("../funciones/reservas/extraerNumeros");

function calcularNumerosRelevantes(ctx, resultado) {

    const tipo = ctx?.reserva ? null : (resultado?.tipo || null);

    let numerosSolicitados = [];
    let numerosReservados = [];
    let numerosOcupados = [];
    let numerosDisponibles = [];

    if (ctx?.reserva) {

        numerosSolicitados = extraerNumeros(ctx.textoOriginal || "", ctx?.evento?.cifras);
        numerosReservados = resultado?.reservados || [];

        // Cuando la reserva falló (ok:false), detectarReserva.js NO
        // devuelve "ocupados" (solo {ok:false, mensaje}) — pero por cómo
        // ya clasifica calcularTipoPresentacion ese resultado
        // (numero_ocupado/todos_ocupados = ok:false), TODOS los
        // solicitados son, por definición de ese tipo, los que están
        // ocupados. Sin esta inferencia, numerosOcupados quedaría vacío y
        // {{ocupado_ocupados}} no tendría de dónde sacar la cantidad real
        // en esos dos tipos. No es un dato nuevo: es el mismo que ya usa
        // cantidadPropiedad (vía numerosSolicitados) para esos tipos.
        numerosOcupados = resultado?.ocupados
            || (resultado?.ok === false ? numerosSolicitados : []);

    } else if (tipo === "mis_numeros" || tipo === "mis_reservas") {

        numerosReservados = resultado?.numerosDelUsuario || [];

    } else if (tipo === "numero_especifico") {

        numerosSolicitados = resultado?.numero ? [resultado.numero] : [];

    } else if (tipo === "disponibilidad") {

        numerosDisponibles = resultado?.numerosDisponibles || [];
        numerosOcupados = resultado?.numerosOcupados || [];

    }

    // "cantidad_reservas" no trae listas de números (resolverConsulta.js
    // solo devuelve un escalar "cantidad") — sin esta rama, cualquier
    // plantilla de este tipo que use {{numero_numeros}} / {{reservado_reservados}}
    // caería siempre al 0 por defecto (plural), sin importar la cantidad
    // real. Es el único tipo cuya cantidad no se deriva de un arreglo.
    const cantidadDirecta = tipo === "cantidad_reservas"
        ? Number(resultado?.cantidad) || 0
        : null;

    const cantidadPropiedad = cantidadDirecta !== null
        ? cantidadDirecta
        : (numerosReservados.length > 0 ? numerosReservados.length : numerosSolicitados.length);

    const cantidadNumeros = cantidadDirecta !== null
        ? cantidadDirecta
        : (cantidadPropiedad > 0 ? cantidadPropiedad : numerosDisponibles.length);

    // Fase 2 — cantidades INDEPENDIENTES por conjunto. A diferencia de
    // cantidadPropiedad/cantidadNumeros (pensadas para "de qué habla
    // principalmente la respuesta"), estas NUNCA se mezclan entre sí: la
    // cantidad de numeros_reservados no determina la concordancia de
    // numeros_ocupados, ni viceversa. reserva_parcial es el caso real
    // donde ambas cantidades conviven en el mismo mensaje y pueden diferir.
    const cantidadReservados = cantidadDirecta !== null ? cantidadDirecta : numerosReservados.length;
    const cantidadOcupados = numerosOcupados.length;
    const cantidadDisponibles = numerosDisponibles.length;

    return {
        numerosSolicitados,
        numerosReservados,
        numerosOcupados,
        numerosDisponibles,
        cantidadPropiedad,
        cantidadNumeros,
        cantidadReservados,
        cantidadOcupados,
        cantidadDisponibles
    };

}

module.exports = {
    construirVariablesGramaticales,
    construirVariablesPorConjunto,
    calcularNumerosRelevantes,
    formatearListaNumeros,
    formatearGrillaNumeros,
    determinarColumnasGrilla,
    capitalizar
};
