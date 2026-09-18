// Extrae los números que un cliente pide reservar/consultar en su mensaje.
//
// La CANTIDAD DE CIFRAS del sorteo la decide la configuración real del
// evento (eventos_bot.cifras, que viene de configEvento.js), NO se asume.
// El parámetro `cifras` es opcional y por defecto 2 — así todos los
// puntos del código que todavía no pasan la config del evento mantienen
// exactamente el comportamiento anterior (universo 00–99).
//
//   evento de 1 cifra  -> universo 0–9,   forma "5"
//   evento de 2 cifras -> universo 00–99, forma "05"
//   evento de 3 cifras -> universo 000–999, forma "005"
//
// Auditoría "reservas por número de cifras": el mensaje debe traer
// EXACTAMENTE `cifras` dígitos escritos para que cuente como número de la
// dinámica — NUNCA se completa con ceros a la izquierda un número más
// corto de lo escrito ("5" en un evento de 2 cifras NO es "05": son datos
// distintos, y solo el segundo es válido). Antes de esta corrección el
// patrón aceptaba de 1 a `cifras` dígitos y luego rellenaba con
// padStart(), lo que convertía "5" en "05" silenciosamente y dejaba
// reservar con un formato que el cliente nunca escribió.
//
// La reserva/consulta física sigue el flujo existente sin cambios: este
// módulo solo se asegura de que el valor correcto llegue a ese flujo.
function extraerNumeros(texto = "", cifras = 2) {

    const n =
        Number.isInteger(cifras) && cifras >= 1 && cifras <= 4
            ? cifras
            : 2;

    const maximo = Math.pow(10, n) - 1;

    texto = texto.toLowerCase();

    // ==========================
    // Normalizar separadores
    // ==========================

    texto = texto
        .replace(/[_*,;/]+/g, " ")
        .replace(/\s+y\s+/g, " ")
        .replace(/dame\s*el/gi, " ")
        .replace(/dameel/gi, " ")
        .replace(/quiero\s*el/gi, " ")
        .replace(/quieroel/gi, " ")
        .replace(/me\s*das\s*el/gi, " ")
        .replace(/anota\s*el/gi, " ")
        .replace(/aparta\s*el/gi, " ")
        .replace(/reserva\s*el/gi, " ")
        .replace(/ponme\s*el/gi, " ");

    // ==========================
    // "O" mal escrita como cero inicial
    // ==========================
    // SOLO cuando la(s) "o" están al PRINCIPIO de un candidato numérico
    // (frontera de palabra + dígitos justo después) Y ocupan exactamente
    // posiciones de cero inicial dentro del universo del evento (o's +
    // dígitos <= cifras). Nunca un reemplazo global de "o" -> "0":
    //   "O1"  -> "01"   (evento de 2 cifras)
    //   "O12" -> "o12"  -> el strip la quita como ruido -> "12"
    //   "hola" / "pedro" / "evento o" -> intactos
    texto = texto.replace(/\bo+\d{1,4}\b/gi, (token) => {

        const ceros = (token.match(/^o+/i) || [""])[0].length;
        const digitos = token.length - ceros;

        if (ceros + digitos <= n) {
            return "0".repeat(ceros) + token.slice(ceros);
        }

        return token;

    });

    // ==========================
    // Quitar todo lo que no sea dígito / espacio / guion
    // ==========================

    texto = texto.replace(/[^0-9\s-]/g, " ");

    // ==========================
    // Extraer números (EXACTAMENTE `n` dígitos, según la config del
    // evento) — nunca menos. Un token de menos de `n` dígitos ("5" en un
    // evento de 2 cifras) no es un candidato válido y se ignora, igual
    // que ya se ignoraba uno de más de `n` dígitos (un teléfono, una
    // cédula): ambos casos son "el cliente no escribió el formato exacto
    // de la dinámica".
    // ==========================

    const patron = new RegExp(`\\b\\d{${n}}\\b`, "g");

    const encontrados = texto.match(patron) || [];

    // ==========================
    // Deduplicar (la forma ya es la canónica: siempre trae `n` dígitos)
    // ==========================

    const numeros = [
        ...new Set(
            encontrados
                .filter(x => parseInt(x, 10) <= maximo)
        )
    ];

    return numeros;

}

// Valida que un número YA EXTRAÍDO (o cualquier string que vaya a usarse
// como número de la dinámica) tenga el formato EXACTO de la configuración
// actual — ni menos dígitos ("5" para un evento de 2 cifras) ni más
// ("100"). Es la MISMA regla que aplica extraerNumeros() de aquí arriba,
// expuesta aparte para poder usarse como segunda/tercera capa de defensa
// justo antes de tocar Supabase (ver detectarReserva.js y
// reservarNumeros.js) sin depender de que la extracción del texto sea la
// única puerta de entrada.
function validarFormatoNumero(numero, cifras = 2) {

    const n =
        Number.isInteger(cifras) && cifras >= 1 && cifras <= 4
            ? cifras
            : 2;

    return typeof numero === "string" && new RegExp(`^\\d{${n}}$`).test(numero);

}

module.exports = {
    extraerNumeros,
    validarFormatoNumero
};
