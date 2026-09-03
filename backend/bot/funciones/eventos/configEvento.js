const CONFIG_EVENTOS = {

    1000: {
        tabla: "reservas_dos_cifras",
        cifras: 2,
        cantidad: 100
    },

    1500: {
        tabla: "reservas_dos_cifras",
        cifras: 2,
        cantidad: 100
    },

    2000: {
        tabla: "reservas_dos_cifras",
        cifras: 2,
        cantidad: 100
    },

    3000: {
        tabla: "5k_15k_reservas_2_cifras",
        cifras: 2,
        cantidad: 100
    },

    5000: {
        tabla: "5k_15k_reservas_2_cifras",
        cifras: 2,
        cantidad: 100
    },

    10000: {
        tabla: "5k_15k_reservas_2_cifras",
        cifras: 2,
        cantidad: 100
    },

    15000: {
        tabla: "5k_15k_reservas_2_cifras",
        cifras: 2,
        cantidad: 100
    }

};

function obtenerConfiguracion(valor) {

    if (!valor)
        return null;

    const limpio = Number(
        valor
            .toString()
            .replace(/[^\d]/g, "")
    );

    return CONFIG_EVENTOS[limpio] || null;

}

module.exports = {
    obtenerConfiguracion
};