module.exports = function (texto = "") {

    const encontrados =
        texto.match(/\b\d{2}\b/g);

    if (!encontrados)
        return [];

    return [...new Set(encontrados)];

};