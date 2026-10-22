const LOTERIAS = [

    "antioqueñita día",
    "antioqueñita tarde",

    "sinuano dia",
    "sinuano noche",

    "paisita día",
    "paisita noche",

    "chontico día",
    "chontico noche",

    "lotería boyacá",
    "loteria boyaca",

    "cafetero noche",

    "caribeña día",
    "caribeña noche",

    "super astro sol",
    "super astro luna",

    "dorado mañana",
    "dorado tarde",
    "dorado noche",

    "astro sol",
    "astro luna",

    "chance millonario"

];

// Loterías tradicionales: un nombre canónico y la parte que las distingue
// (sin tildes, en minúsculas). Se reconocen con "lotería"/"lot." delante y
// con o sin "de"/"del"/"de la": "LOTERÍA DE BOGOTÁ", "Loteria Bogota",
// "Lot. de Bogotá" -> "Lotería de Bogotá". Así el mismo sorteo anunciado con
// dos formatos distintos tiene el mismo nombre (y la misma identidad).
// Boyacá sigue en LOTERIAS (arriba) para no cambiar el nombre que ya
// producía.
const LOTERIAS_TRADICIONALES = [

    { nombre: "Lotería de Bogotá", clave: "bogota" },
    { nombre: "Lotería de Medellín", clave: "medellin" },
    { nombre: "Lotería de Cundinamarca", clave: "cundinamarca" },
    { nombre: "Lotería del Tolima", clave: "tolima" },
    { nombre: "Lotería de la Cruz Roja", clave: "cruz roja" },
    { nombre: "Lotería del Huila", clave: "huila" },
    { nombre: "Lotería del Valle", clave: "valle" },
    { nombre: "Lotería de Manizales", clave: "manizales" },
    { nombre: "Lotería del Meta", clave: "meta" },
    { nombre: "Lotería del Quindío", clave: "quindio" },
    { nombre: "Lotería de Risaralda", clave: "risaralda" },
    { nombre: "Lotería de Santander", clave: "santander" },
    { nombre: "Lotería del Cauca", clave: "cauca" }

].map(l => ({
    ...l,
    patron: new RegExp(`\\blot(?:eria)?\\.?\\s+(?:de\\s+la\\s+|del\\s+|de\\s+)?${l.clave.replace(/ /g, "\\s+")}\\b`)
}));

module.exports = {

    LOTERIAS,

    LOTERIAS_TRADICIONALES

};