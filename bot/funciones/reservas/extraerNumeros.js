function extraerNumeros(texto = "") {

    const encontrados = texto.match(/\b\d{1,2}\b/g) || [];

    const numeros = [
        ...new Set(
            encontrados.map(n => n.padStart(2, "0"))
        )
    ];

    return numeros;

}

module.exports = {
    extraerNumeros
};