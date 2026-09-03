// Fase 6 — utilidad GENÉRICA de coincidencia aproximada (tolerante a
// errores de tecleo comunes: transposición de letras adyacentes, letra de
// más, letra de menos, letra cambiada). NO es una lista de errores
// hardcodeados: es un algoritmo (distancia de edición, variante
// Damerau-Levenshtein restringida) que compara cada palabra del mensaje
// contra la palabra clave esperada.
//
// Se usa siempre sobre texto YA normalizado (ver normalizarTexto.js:
// minúsculas, sin tildes, sin signos). Esto es solo para EMPAREJAR
// palabras clave dentro de la detección de intención — nunca decide
// negocio, nunca reemplaza normalizarTexto.js.

// Distancia de edición entre dos palabras, contando la transposición de
// dos letras adyacentes como UN solo error (el error de tecleo más común:
// "tnego" en vez de "tengo", "nuemros" en vez de "numeros").
function distancia(a, b) {

    const la = a.length;
    const lb = b.length;

    if (la === 0) return lb;
    if (lb === 0) return la;

    const d = [];

    for (let i = 0; i <= la; i++) d[i] = [i];
    for (let j = 0; j <= lb; j++) d[0][j] = j;

    for (let i = 1; i <= la; i++) {

        for (let j = 1; j <= lb; j++) {

            const costoSustitucion = a[i - 1] === b[j - 1] ? 0 : 1;

            d[i][j] = Math.min(

                d[i - 1][j] + 1,        // borrado
                d[i][j - 1] + 1,        // inserción
                d[i - 1][j - 1] + costoSustitucion // sustitución

            );

            if (

                i > 1 && j > 1 &&
                a[i - 1] === b[j - 2] &&
                a[i - 2] === b[j - 1]

            ) {

                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + costoSustitucion);

            }

        }

    }

    return d[la][lb];

}

// Tolerancia proporcional al tamaño de la palabra clave: palabras cortas
// (<=4) exigen coincidencia exacta — a esa longitud, un solo error ya
// puede convertir una palabra común en otra distinta (p. ej. "hola" a
// distancia 1 de "hora"), así que se prioriza evitar falsos positivos
// sobre tolerar errores; la mayoría de palabras del dominio (5-8)
// toleran 1 error de tecleo — suficiente para transposiciones/letra de
// más/de menos ("nuemros"↔"numeros", "tnego"↔"tengo"); solo palabras muy
// largas (9+) toleran 2, porque a esa longitud dos palabras del dominio
// ya no se confunden entre sí.
function toleranciaPara(palabra) {

    if (palabra.length <= 4) return 0;
    if (palabra.length <= 8) return 1;

    return 2;

}

function coincideAprox(token, palabraClave) {

    if (token === palabraClave) {
        return true;
    }

    const tolerancia = toleranciaPara(palabraClave);

    if (tolerancia === 0) {
        return false;
    }

    if (Math.abs(token.length - palabraClave.length) > tolerancia) {
        return false;
    }

    return distancia(token, palabraClave) <= tolerancia;

}

function contienePalabra(tokens, palabraClave) {

    return tokens.some(t => coincideAprox(t, palabraClave));

}

function contieneAlguna(tokens, palabrasClave) {

    return palabrasClave.some(p => contienePalabra(tokens, p));

}

// Busca una FRASE (varias palabras, en orden, contiguas) dentro de los
// tokens del mensaje, tolerando errores leves en cada palabra de la frase.
function contieneFrase(tokens, frase) {

    const palabras = frase.split(" ");

    for (let i = 0; i + palabras.length <= tokens.length; i++) {

        let coincide = true;

        for (let j = 0; j < palabras.length; j++) {

            if (!coincideAprox(tokens[i + j], palabras[j])) {

                coincide = false;
                break;

            }

        }

        if (coincide) {
            return true;
        }

    }

    return false;

}

function contieneAlgunaFrase(tokens, frases) {

    return frases.some(f => contieneFrase(tokens, f));

}

module.exports = {
    distancia,
    coincideAprox,
    contienePalabra,
    contieneAlguna,
    contieneFrase,
    contieneAlgunaFrase
};
