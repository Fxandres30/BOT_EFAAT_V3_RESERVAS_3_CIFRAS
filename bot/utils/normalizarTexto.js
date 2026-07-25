function normalizarTexto(texto = "") {

    if (texto == null) {
        return "";
    }

    return texto
        .toString()
        .toLowerCase()

        // Quitar tildes
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")

        // Quitar emojis
        .replace(
            /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu,
            ""
        )

        // Mantener letras, números y algunos caracteres útiles
        .replace(/[^a-z0-9\s:/$.-]/g, " ")

        // Eliminar espacios repetidos
        .replace(/\s+/g, " ")

        .trim();

}

module.exports = {
    normalizarTexto
};