function normalizarTexto(texto = "") {

    return texto
        .toString()
        .toLowerCase()

        // quitar tildes
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")

        // quitar emojis
        .replace(
            /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu,
            ""
        )

        // caracteres raros → espacio
        .replace(/[^a-z0-9\s]/g, " ")

        // espacios múltiples
        .replace(/\s+/g, " ")

        .trim();

}

module.exports = {

    normalizarTexto

};