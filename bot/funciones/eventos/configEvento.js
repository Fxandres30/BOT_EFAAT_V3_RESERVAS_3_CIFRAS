const EVENTOS = {

    1000: {
        tabla: "reservas_1000",
        cifras: 2,
        cantidad: 100
    },

    1500: {
        tabla: "reservas_1500",
        cifras: 2,
        cantidad: 100
    },

    2000: {
        tabla: "reservas_2000",
        cifras: 2,
        cantidad: 100
    },

    5000: {
        tabla: "reservas_5000",
        cifras: 2,
        cantidad: 100
    },

    30000: {
        tabla: "reservas_30000",
        cifras: 3,
        cantidad: 1000
    }

};

function obtenerConfiguracion(valor) {

    if (!valor) return null;

    const numero = parseInt(
        valor.toString().replace(/\D/g, "")
    );

    return EVENTOS[numero] || null;

}

module.exports = {
    obtenerConfiguracion
};