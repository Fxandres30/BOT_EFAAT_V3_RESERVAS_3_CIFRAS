function extraerNumeros(texto = "") {

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
        .replace(/ponme\s*el/gi, " ")
        .replace(/[^0-9\s-]/g, " ");

    // ==========================
    // Extraer números
    // ==========================

    const encontrados =
        texto.match(/\b\d{1,2}\b/g) || [];

    // ==========================
    // Formatear
    // ==========================

    const numeros = [
        ...new Set(
            encontrados
                .map(n => parseInt(n, 10))
                .filter(n => n >= 0 && n <= 99)
                .map(n => n.toString().padStart(2, "0"))
        )
    ];

    return numeros;

}

module.exports = {
    extraerNumeros
};