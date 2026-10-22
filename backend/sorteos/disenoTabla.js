// ==========================================================================
// sorteos/disenoTabla.js — estilo de la tabla de números de un sorteo
// programado. PURO (sin Supabase).
//
// El sorteo guarda una COPIA del diseño elegido (como cuentas_snapshot): la
// vista previa pinta exactamente esa copia, y el publicador la deja como
// diseño activo de la tabla de ese precio (tabla_configuracion_visual) antes
// de publicar, que es lo que pinta la imagen que se comparte por WhatsApp
// (/tablas/imprimir). Editarlo después en Tablas no cambia este sorteo.
//
// Solo se acepta la forma conocida de TablaDisenoConfig
// (frontend/components/tablas/disenoTypes.ts): colores #hex o rgb(a) y
// tamaños en rangos razonables. Nunca se guarda JSON arbitrario.
// ==========================================================================

const ORIGENES = new Set(["actual", "biblioteca", "preset"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;

const RANGOS = {
    "numbers.size": [10, 48],
    "numbers.weight": [300, 900],
    "grid.radius": [0, 40],
    "grid.spacing": [0, 40],
    "grid.borderWidth": [0, 8]
};

function color(v) {
    return typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : null;
}

function numero(v, [min, max]) {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function celda(c) {
    if (!c || typeof c !== "object") return null;
    const r = { bg: color(c.bg), border: color(c.border), text: color(c.text) };
    return r.bg && r.border && r.text ? r : null;
}

// Config completa y válida, o null.
function normalizarConfigDiseno(c) {

    if (!c || typeof c !== "object") return null;

    const theme = c.theme && typeof c.theme === "object" ? {
        pageBg: color(c.theme.pageBg),
        tableBg: color(c.theme.tableBg),
        text: color(c.theme.text),
        border: color(c.theme.border),
        accent: color(c.theme.accent)
    } : null;

    const cells = c.cells && typeof c.cells === "object" ? {
        available: celda(c.cells.available),
        reserved: celda(c.cells.reserved),
        pagado: celda(c.cells.pagado)
    } : null;

    const numbers = c.numbers && typeof c.numbers === "object" ? {
        size: numero(c.numbers.size, RANGOS["numbers.size"]),
        weight: numero(c.numbers.weight, RANGOS["numbers.weight"])
    } : null;

    const grid = c.grid && typeof c.grid === "object" ? {
        radius: numero(c.grid.radius, RANGOS["grid.radius"]),
        spacing: numero(c.grid.spacing, RANGOS["grid.spacing"]),
        borderWidth: numero(c.grid.borderWidth, RANGOS["grid.borderWidth"])
    } : null;

    const completo = theme && Object.values(theme).every(Boolean)
        && cells && Object.values(cells).every(Boolean)
        && numbers && Object.values(numbers).every(v => v !== null)
        && grid && Object.values(grid).every(v => v !== null);

    return completo ? { theme, cells, numbers, grid } : null;

}

// Elección enviada por el panel -> { eleccion, errores }. Por defecto
// "actual" (el diseño que la tabla de ese precio ya tiene): compatible con
// los sorteos anteriores, que no traen diseño.
//   actual      -> el servicio copia tabla_configuracion_visual (o ninguno)
//   biblioteca  -> el servicio copia tabla_disenos[diseno_id] DEL USUARIO
//   preset      -> config enviada (estilos predefinidos del panel), validada aquí
function normalizarEleccionDiseno(entrada) {

    const errores = [];

    if (!entrada || typeof entrada !== "object") {
        return { eleccion: { origen: "actual", diseno_id: null, nombre: null, config: null }, errores };
    }

    const origen = ORIGENES.has(entrada.origen) ? entrada.origen : "actual";
    const nombre = entrada.nombre ? String(entrada.nombre).trim().slice(0, 60) : null;
    let disenoId = null;
    let config = null;

    if (origen === "biblioteca") {
        disenoId = String(entrada.diseno_id || "");
        if (!UUID.test(disenoId)) errores.push({ campo: "diseno", mensaje: "Elige un diseño de tu biblioteca." });
    }

    if (origen === "preset") {
        config = normalizarConfigDiseno(entrada.config);
        if (!config) errores.push({ campo: "diseno", mensaje: "El estilo elegido no es válido." });
    }

    return { eleccion: { origen, diseno_id: disenoId, nombre, config }, errores };

}

module.exports = {
    normalizarConfigDiseno,
    normalizarEleccionDiseno
};
