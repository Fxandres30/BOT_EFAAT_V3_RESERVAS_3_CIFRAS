// ==========================================================================
// sorteos/catalogoBase.js — CONFIGURACIÓN INICIAL del calendario de loterías.
//
// Fuente de verdad: el listado del administrador «Calendario y Horarios
// Sorteos de Colombia» (27 chances + 15 sorteos tradicionales). Son los mismos
// datos que carga la migración 026 en loterias_catalogo_global; la prueba
// calendarioLoterias.test.js compara ambos campo a campo.
//
// Vive también en el código porque en producción la 026 no está completa:
// sin ella el backend sembraba solo 27 nombres sin horarios. Con este módulo
// cada cliente recibe los 42 sorteos con días, horas y reglas desde el primer
// momento, y puede volver a ellos con «Restaurar».
//
// Modelo: dias (1 = lunes … 7 = domingo; un día que no está = sin sorteo),
// hora habitual, horas_por_dia (otra hora ese día, p. ej. domingo),
// regla_festivo y hora_festivo, frecuencia (semanal | mensual).
//
// Lo que el listado NO dice queda «sin_regla» (festivos no definidos): al
// programar se sugiere la hora habitual de ese día y se avisa. No se inventa.
// ==========================================================================

// [nombre, modalidad, categoria, dias, hora, horas_por_dia, regla_festivo, hora_festivo, notas, frecuencia]
const T = "tradicional";
const C = "chance";
const TODOS = [1, 2, 3, 4, 5, 6, 7];
const L_S = [1, 2, 3, 4, 5, 6];

const FILAS = [
    ["Antioqueñita", "Día", C, TODOS, "10:00", { 7: "12:00" }, "hora_especial", "12:00", "Listado: Lunes a Sábado 10:00 AM · Domingos y Días Feriados 12:00 PM"],
    ["Antioqueñita", "Tarde", C, TODOS, "16:00", {}, "hora_habitual", null, "Listado: Todos los días y Días Feriados 4:00 PM"],
    ["Dorado", "Mañana", C, L_S, "10:58", {}, "sin_regla", null, "Listado: Lunes a Sábado 10:58 AM"],
    ["Dorado", "Tarde", C, L_S, "15:28", {}, "sin_regla", null, "Listado: Lunes a Sábado 3:28 PM"],
    ["Dorado", "Noche", C, [6, 7], null, { 6: "22:15", 7: "19:25" }, "hora_especial", "19:25", "Listado: Sábado 10:15 PM · Domingos y Festivos 7:25 PM"],
    ["Fantástica", "Día", C, L_S, "12:57", {}, "sin_regla", null, "Listado: Lunes a Sábado 12:57 PM"],
    ["Fantástica", "Noche", C, L_S, "20:30", {}, "sin_regla", null, "Listado: Lunes a Sábado 8:30 PM"],
    ["El Samán de la Suerte", "", C, TODOS, "13:00", { 7: "19:00" }, "hora_especial", "19:00", "Listado: El Samán de la Suerte: Lunes a Sábado 1:00 PM · Domingos y Días Feriados 7:00 PM"],
    ["Paisita", "Día", C, TODOS, "13:00", { 7: "14:00" }, "hora_especial", "14:00", "Listado: Lunes a Sábado 1:00 PM · Domingos y Días Festivos 2:00 PM"],
    ["Paisita", "Noche", C, TODOS, "18:00", { 7: "20:00" }, "hora_especial", "20:00", "Listado: Lunes a Sábado 6:00 PM · Domingos y Días Festivos 8:00 PM"],
    ["Chontico", "Día", C, TODOS, "13:00", {}, "sin_regla", null, "Listado: Todos los días 1:00 PM"],
    ["Chontico", "Noche", C, TODOS, "19:00", { 6: "22:00", 7: "20:00" }, "hora_especial", "20:00", "Listado: Lunes a Viernes 7:00 PM · Sábado 10:00 PM · Domingos y Festivos 8:00 PM"],
    ["Pijao de Oro", "", C, TODOS, "14:00", { 6: "21:00", 7: "22:00" }, "hora_especial", "20:00", "Listado: Lunes a Viernes 2:00 PM · Sábado 9:00 PM · Domingo 10:00 PM · Días Festivos 8:00 PM"],
    ["Super Astro", "Sol", C, L_S, "14:30", {}, "sin_regla", null, "Listado: Lunes a Sábado 2:30 PM"],
    ["Super Astro", "Luna", C, TODOS, "22:30", { 7: "20:30" }, "hora_especial", "20:30", "Listado: Lunes a Sábado 10:30 PM · Domingos y Días Festivos 8:30 PM"],
    ["Sinuano", "Día", C, TODOS, "14:30", { 7: "13:00" }, "hora_especial", "13:00", "Listado: Lunes a Sábado 2:30 PM · Domingos y Días Festivos 1:00 PM"],
    ["Sinuano", "Noche", C, TODOS, "22:30", { 7: "20:30" }, "hora_especial", "20:30", "Listado: Lunes a Sábado 10:30 PM · Domingos y Días Festivos 8:30 PM"],
    ["La Caribeña", "Día", C, TODOS, "14:30", {}, "sin_regla", null, "Listado: La Caribeña Día: Todos los días 2:30 PM"],
    ["La Caribeña", "Noche", C, TODOS, "22:30", { 7: "20:30" }, "hora_especial", "20:30", "Listado: La Caribeña Noche: Lunes a Sábado 10:30 PM · Domingos y Días Festivos 8:30 PM"],
    ["Motilón", "Tarde", C, TODOS, "15:00", {}, "sin_regla", null, "Listado: Todos los días 3:00 PM"],
    ["Motilón", "Noche", C, TODOS, "21:00", {}, "sin_regla", null, "Listado: Todos los días 9:00 PM"],
    ["Cafeterito", "Tarde", C, L_S, "12:00", {}, "sin_regla", null, "Listado: Lunes a Sábado 12:00 PM"],
    ["Cafeterito", "Noche", C, TODOS, "22:00", { 6: "23:00", 7: "21:00" }, "hora_especial", "21:00", "Listado: Lunes a Viernes 10:00 PM · Sábado 11:00 PM · Domingos y Festivos 9:00 PM"],
    ["Paisa Lotto", "", C, [6], "22:00", {}, "sin_regla", null, "Listado: Sábado 10:00 PM"],
    ["La Culona", "Día", C, TODOS, "14:30", {}, "hora_habitual", null, "Listado: Todos los días incluso los días feriados 2:30 PM"],
    ["La Culona", "Noche", C, TODOS, "21:30", { 7: "20:00" }, "hora_especial", "20:00", "Listado: Lunes a Sábado 9:30 PM · Domingos y Días Festivos 8:00 PM"],
    ["SuperMillonaria", "", C, [5], "23:00", {}, "sin_regla", null, "Listado: Viernes 11:00 PM"],

    ["Lotería de Cundinamarca", "", T, [1], "22:30", {}, "sin_regla", null, "Listado: Lunes 10:30 PM"],
    ["Lotería de Tolima", "", T, [1], "23:00", {}, "sin_regla", null, "Listado: Lunes 11:00 PM"],
    ["Lotería Cruz Roja", "", T, [2], "22:30", {}, "sin_regla", null, "Listado: Martes 10:30 PM"],
    ["Lotería de Huila", "", T, [2], "22:30", {}, "sin_regla", null, "Listado: Martes 10:30 PM"],
    ["Lotería de Manizales", "", T, [3], "22:30", {}, "sin_regla", null, "Listado: Miércoles 10:30 PM"],
    ["Lotería del Meta", "", T, [3], "22:30", {}, "sin_regla", null, "Listado: Miércoles 10:30 PM"],
    ["Lotería del Valle", "", T, [3], "22:30", {}, "sin_regla", null, "Listado: Miércoles 10:30 PM"],
    ["Lotería Quindío", "", T, [4], "22:30", {}, "sin_regla", null, "Listado: Jueves 10:30 PM"],
    ["Lotería de Bogotá", "", T, [4], "22:30", {}, "sin_regla", null, "Listado: Jueves 10:30 PM"],
    ["Lotería de Santander", "", T, [5], "23:00", {}, "sin_regla", null, "Listado: Viernes 11:00 PM"],
    ["Lotería de Medellín", "", T, [5], "23:00", {}, "sin_regla", null, "Listado: Viernes 11:00 PM"],
    ["Lotería Risaralda", "", T, [5], "23:00", {}, "sin_regla", null, "Listado: Viernes 11:00 PM"],
    ["Lotería de Boyacá", "", T, [6], "22:40", {}, "sin_regla", null, "Listado: Sábado 10:40 PM"],
    ["Lotería de Cauca", "", T, [6], "21:40", {}, "sin_regla", null, "Listado: Sábado 9:40 PM"],
    ["Extra de Colombia", "Mensual", T, [6], "23:00", {}, "sin_regla", null, "Listado: Sábado 11:00 PM (mensual; el listado no indica qué sábado del mes)", "mensual"]
];

// Nombres anteriores (026 y siembra antigua) = el mismo sorteo. Así un
// calendario con «Caribeña Día» no recibe además un «La Caribeña Día».
const ALIAS = new Map([["caribeña", "la caribeña"], ["samán de la suerte", "el samán de la suerte"]]);
const nombreCanonico = (n) => {
    const x = String(n || "").trim().toLocaleLowerCase("es");
    return ALIAS.get(x) || x;
};
const claveDe = (f) => `${nombreCanonico(f.nombre)}|${String(f.modalidad || "").trim().toLocaleLowerCase("es")}`;

const CATALOGO_BASE = Object.freeze(FILAS.map(([nombre, modalidad, categoria, dias, hora, porDia, regla, horaFestivo, notas, frecuencia = "semanal"]) => Object.freeze({
    nombre,
    modalidad,
    categoria,
    dias: [...dias],
    hora,
    horas_por_dia: Object.fromEntries(Object.entries(porDia).map(([d, h]) => [String(d), h])),
    regla_festivo: regla,
    hora_festivo: horaFestivo,
    notas,
    frecuencia
})));

const POR_CLAVE = new Map(CATALOGO_BASE.map(f => [claveDe(f), f]));

// Copia editable (nunca el objeto congelado) de una entrada base.
function copiaBase(f) {
    return { ...f, dias: [...f.dias], horas_por_dia: { ...f.horas_por_dia } };
}

const baseDe = (fila) => {
    const f = POR_CLAVE.get(claveDe(fila));
    return f ? copiaBase(f) : null;
};

// Texto con el que la siembra ANTIGUA (sin la 026) creaba las 27 filas vacías.
// Una fila con esta nota y sin ningún dato es una siembra que el cliente nunca
// tocó: se puede completar con la configuración inicial sin pisar nada suyo.
const NOTA_SIEMBRA_ANTIGUA = "Horario pendiente de configurar.";

module.exports = { CATALOGO_BASE, NOTA_SIEMBRA_ANTIGUA, claveDe, baseDe, copiaBase };
