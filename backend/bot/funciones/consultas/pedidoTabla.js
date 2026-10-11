// ==========================================================================
// pedidoTabla.js — reconoce los pedidos CORTOS/INFORMALES de la tabla de
// números disponibles ("actualiza", "tabla", "actualiza x fa", "¿hay
// números?", "números xfa", "disponibles"...).
//
// Solo decide si el texto es un pedido de tabla. Quien lo llama
// (detectarIntencion.js) lo traduce a la intención "disponibilidad" que YA
// existe, así que la respuesta sale por el flujo real de siempre
// (resolverConsulta -> consultarDisponibilidad -> responderResultado): misma
// tabla del evento, mismas plantillas, mismo interruptor del panel. No hay
// una segunda implementación de la consulta.
//
// Reglas de seguridad (orden de evaluación):
//   1. Con un número concreto en el mensaje NUNCA es pedido de tabla: ese
//      texto sigue siendo reserva / numero_especifico como hasta ahora
//      ("la tabla 25", "actualiza el 25" no cambian de comportamiento).
//   2. Palabras de pago, comprobante o resultado del sorteo lo descartan
//      ("ya pagué, actualiza", "actualicen el resultado").
//   3. Posesión ("mis", "tengo", "mío") lo descarta: "actualiza mis
//      números" sigue siendo mis_numeros.
//   4. Formas de 1ª persona de un ANUNCIO ("actualizo tabla en un
//      momento", "actualizando...") no son pedidos: suelen escribirlas los
//      administradores antes de publicar la tabla.
//
// Se trabaja siempre sobre tokens YA normalizados (normalizarTexto.js:
// minúsculas, sin tildes, sin emojis, sin signos).
// ==========================================================================

const { coincideAprox } = require("../../utils/coincidenciaAproximada");

// ------------------------------------------------------------ vocabulario ---

// "actualiza", "actualizar", "actualicen", "actualizame", "me actualizas",
// "actualizada", "actualisa"... por raíz; los errores de tecleo cercanos
// ("acualiza", "actulaiza") por distancia de edición.
const RAICES_ACTUALIZAR = ["actualiz", "actualic", "actualis"];
const FORMAS_ACTUALIZAR = ["actualiza", "actualizar", "actualicen"];

// Anuncios de quien publica la tabla, no pedidos.
const ACTUALIZAR_ANUNCIO = new Set(["actualizo", "actualizando", "actualice", "actualise"]);

// "tabla", "tablas", "tablita", "tablitas", "tablota" y errores comunes.
// Sin distancia de edición a propósito: a 1 error, "tabla" choca con
// "habla"/"bala"/"tala".
const TABLA_EXACTAS = new Set(["tabla", "tablas", "tablita", "tablitas", "tablota", "tbla", "tabal", "tavla", "tabls"]);
const REGEX_TABLA = /^t+a+b+l+a+s?$/;

// Sustantivo "número(s)" y diminutivos.
const NUMERO_EXACTAS = new Set(["num", "nums", "nros", "nro", "numerito", "numeritos"]);
const NUMERO_FORMAS = ["numero", "numeros", "numeritos"];

// Una sola palabra que ya es un pedido completo.
const DISPONIBLES_SOLAS = ["disponibles", "disponible"];

// Relleno de cortesía / artículos: "números xfa", "los números porfa".
const RELLENO = new Set([
    "el", "la", "los", "las", "de", "del", "a", "al", "me", "nos", "y", "ya", "todos", "toditos",
    "x", "fa", "xfa", "xf", "porfa", "porfis", "porfavor", "por", "favor", "pf", "pls", "plis", "please",
    "gracias", "grax", "graciass", "mil", "bendiciones", "dios", "bendiga",
    "hola", "buenas", "buenos", "dias", "tardes", "noches",
    "amiga", "amigo", "amigos", "familia", "bro", "hermano", "hermana", "veci", "vecina", "vecino"
]);

// Pago / comprobante — nunca se responde con la tabla.
const EXCLUSION_PAGO = [
    "pago", "pagar", "pague", "pagado", "pagos", "debo", "debe",
    "comprobante", "comprobantes", "transferencia", "transferi", "consigne", "consignacion",
    "nequi", "daviplata", "abono", "abone"
];

// Resultado del sorteo — nunca se responde con la tabla.
// "premio(s)": "tabla de premios" pregunta por los premios, no por los
// números libres.
const EXCLUSION_RESULTADO = ["resultado", "resultados", "gano", "gane", "ganador", "ganadora", "ganadores", "salio", "jugo", "cayo", "premio", "premios"];

// Posesión — "actualiza mis números" pregunta por lo suyo (mis_numeros).
const EXCLUSION_POSESION = new Set(["mis", "mio", "mios", "mia", "mias", "tengo"]);

const NEGACIONES = new Set(["no", "sin", "nada"]);

// "ya está actualizada la tabla", "quedó actualizada": afirmación de quien
// publica. "tabla actualizada" a secas sigue siendo pedido (requisito).
const PARTICIPIOS_ACTUALIZADA = new Set(["actualizada", "actualizado", "actualizadas", "actualizados"]);
const MARCAS_AFIRMACION = new Set(["ya", "esta", "quedo", "queda", "acabo"]);

// Precios / denominaciones de tabla: "10k", "10.000", "5 mil", "$3000".
// extraerNumeros() (sin modificar) puede leer "10k" o "10.000" como el
// número 10; dentro de un pedido de tabla eso no es una reserva.
const REGEX_PRECIOS = [
    /\$\s*\d[\d.,]*/g,
    /\b\d{1,3}(?:[.,]\d{3})+\b/g,
    /\b\d+\s*(?:k|mil|lucas|barras)\b/gi,
    /\b\d{4,}\b/g
];

function quitarPrecios(texto) {
    return REGEX_PRECIOS.reduce((t, re) => t.replace(re, " "), String(texto || ""));
}

// ---------------------------------------------------------------- helpers ---

function esActualizar(token) {

    if (RAICES_ACTUALIZAR.some(r => token.startsWith(r))) return true;

    return FORMAS_ACTUALIZAR.some(f => coincideAprox(token, f));

}

function esTabla(token) {
    return TABLA_EXACTAS.has(token) || REGEX_TABLA.test(token);
}

function esNumeroPalabra(token) {
    return NUMERO_EXACTAS.has(token) || NUMERO_FORMAS.some(f => coincideAprox(token, f));
}

function contieneAprox(tokens, lista) {
    return tokens.some(t => lista.some(p => coincideAprox(t, p)));
}

// "ya no hay números", "no hay números por ahora" (afirmación de un aviso,
// sin signo de pregunta) — mismo criterio que esAvisoSinDisponibilidad de
// detectarIntencion.js: con "?"/"¿" vuelve a ser pregunta.
function esAvisoSinNumeros(textoOriginal, tokens) {

    if (/[?¿]/.test(textoOriginal || "")) return false;

    const i = tokens.indexOf("hay");

    if (i < 0) return false;

    return tokens.slice(Math.max(0, i - 2), i).some(t => NEGACIONES.has(t));

}

// --------------------------------------------------------------- público ---

// esPedidoDeTabla(textoOriginal, tokens, numeros) -> { esPedido, regla }
//
// `tokens`: palabras de normalizarTexto(textoOriginal); `numeros`: los
// números concretos que ya extrajo extraerNumeros().
function esPedidoDeTabla(textoOriginal, tokensNormalizados = [], numeros = []) {

    // normalizarTexto() conserva ". : / $ -" (útiles para horas y montos);
    // aquí estorban: "actualizando..." debe compararse como "actualizando".
    const tokens = tokensNormalizados
        .map(t => t.replace(/[.:/$-]+/g, ""))
        .filter(Boolean);

    if (!tokens.length) return { esPedido: false, regla: "vacio" };

    if (numeros.length > 0) return { esPedido: false, regla: "trae_numero" };

    if (contieneAprox(tokens, EXCLUSION_PAGO)) return { esPedido: false, regla: "pago" };

    if (contieneAprox(tokens, EXCLUSION_RESULTADO)) return { esPedido: false, regla: "resultado" };

    if (tokens.some(t => EXCLUSION_POSESION.has(t))) return { esPedido: false, regla: "posesion" };

    if (tokens.some(t => ACTUALIZAR_ANUNCIO.has(t))) return { esPedido: false, regla: "anuncio" };

    if (!/[?¿]/.test(textoOriginal || "") && tokens.some(t => PARTICIPIOS_ACTUALIZADA.has(t)) && tokens.some(t => MARCAS_AFIRMACION.has(t))) {
        return { esPedido: false, regla: "anuncio" };
    }

    // "no actualicen", "no actualices todavía" — orden de NO hacerlo.
    if (tokens.some((t, i) => esActualizar(t) && i > 0 && NEGACIONES.has(tokens[i - 1]))) {
        return { esPedido: false, regla: "negacion" };
    }

    if (tokens.some(esActualizar)) return { esPedido: true, regla: "actualizar" };

    if (tokens.some(esTabla)) return { esPedido: true, regla: "tabla" };

    if (tokens.length === 1 && DISPONIBLES_SOLAS.some(p => coincideAprox(tokens[0], p))) {
        return { esPedido: true, regla: "disponibles" };
    }

    const tieneNumeroPalabra = tokens.some(esNumeroPalabra);

    if (tieneNumeroPalabra && tokens.includes("hay")) {

        if (esAvisoSinNumeros(textoOriginal, tokens)) return { esPedido: false, regla: "aviso_sin_numeros" };

        return { esPedido: true, regla: "hay_numeros" };

    }

    // "números xfa", "los numeritos porfa", "Números?" — el sustantivo y
    // nada más que relleno de cortesía.
    if (tieneNumeroPalabra && tokens.every(t => esNumeroPalabra(t) || RELLENO.has(t))) {
        return { esPedido: true, regla: "numeros_cortesia" };
    }

    return { esPedido: false, regla: "sin_coincidencia" };

}

module.exports = {
    esPedidoDeTabla,
    quitarPrecios
};
