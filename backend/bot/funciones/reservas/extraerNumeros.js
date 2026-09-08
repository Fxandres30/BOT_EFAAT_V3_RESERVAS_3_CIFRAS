// Extrae los números que un cliente pide reservar/consultar en su mensaje.
//
// La CANTIDAD DE CIFRAS del sorteo la decide la configuración real del
// evento (eventos_bot.cifras, que viene de configEvento.js), NO se asume.
// El parámetro `cifras` es opcional y por defecto 2 — así todos los
// puntos del código que todavía no pasan la config del evento mantienen
// exactamente el comportamiento anterior (universo 00–99, forma canónica
// de 2 dígitos).
//
//   evento de 1 cifra  -> universo 0–9,   forma "1"
//   evento de 2 cifras -> universo 00–99, forma "01"
//   evento de 3 cifras -> universo 000–999, forma "001"
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
    // Extraer números (hasta `n` dígitos, según la config del evento)
    // ==========================

    const patron = new RegExp(`\\b\\d{1,${n}}\\b`, "g");

    const encontrados = texto.match(patron) || [];

    // ==========================
    // Formatear a la forma canónica del universo configurado
    // ==========================

    const numeros = [
        ...new Set(
            encontrados
                .map(x => parseInt(x, 10))
                .filter(x => x >= 0 && x <= maximo)
                .map(x => x.toString().padStart(n, "0"))
        )
    ];

    return numeros;

}

module.exports = {
    extraerNumeros
};
