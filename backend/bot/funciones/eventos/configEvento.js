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

// Nombres únicos de TODAS las tablas físicas de reservas conocidas (varios
// precios comparten la misma tabla física — ver CONFIG_EVENTOS arriba).
// Única fuente de verdad para "qué tablas dinámicas existen" — quien
// necesite recorrerlas todas (p. ej. contactos.js, para agregar reservas
// por cliente) debe usar esto en vez de hardcodear la lista aparte.
function obtenerTablasConocidas() {

    return [...new Set(Object.values(CONFIG_EVENTOS).map(c => c.tabla))];

}

module.exports = {
    obtenerConfiguracion,
    obtenerTablasConocidas
};