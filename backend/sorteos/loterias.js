// ==========================================================================
// sorteos/loterias.js — Calendario de loterías (migración 025).
//
// Un catálogo POR CLIENTE, compartido por todos sus sorteos. Cada función
// recibe el usuarioId del TOKEN y filtra por él: una lotería ajena se
// comporta como inexistente.
//
// Catálogo inicial: SOLO nombres (los que dio el administrador). Sin horas,
// días ni reglas de festivos: no se inventan; se completan desde el panel.
// ==========================================================================

const supabase = require("../lib/supabase");
const { horarioPara } = require("./calendario");

const TABLA = "loterias_catalogo";
const COLUMNAS = "id, nombre, modalidad, categoria, dias, hora, horas_por_dia, regla_festivo, hora_festivo, notas, activo, creado_en, actualizado_en";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const CATEGORIAS = new Set(["chance", "tradicional"]);
const REGLAS_FESTIVO = new Set(["sin_regla", "no_se_juega", "hora_habitual", "hora_especial"]);

// [nombre, modalidad] — chances del listado del administrador.
const CATALOGO_INICIAL = [
    ["Antioqueñita", "Día"], ["Antioqueñita", "Tarde"],
    ["Dorado", "Mañana"], ["Dorado", "Tarde"], ["Dorado", "Noche"],
    ["Fantástica", "Día"], ["Fantástica", "Noche"],
    ["Samán de la Suerte", ""],
    ["Paisita", "Día"], ["Paisita", "Noche"],
    ["Chontico", "Día"], ["Chontico", "Noche"],
    ["Pijao de Oro", ""],
    ["Super Astro", "Sol"], ["Super Astro", "Luna"],
    ["Sinuano", "Día"], ["Sinuano", "Noche"],
    ["Caribeña", "Día"], ["Caribeña", "Noche"],
    ["Motilón", "Tarde"], ["Motilón", "Noche"],
    ["Cafeterito", "Tarde"], ["Cafeterito", "Noche"],
    ["Paisa Lotto", ""],
    ["La Culona", "Día"], ["La Culona", "Noche"],
    ["SuperMillonaria", ""]
].map(([nombre, modalidad]) => ({ nombre, modalidad, categoria: "chance" }));

function resultado(data, error) {
    if (!error) return { ok: true, data };
    const faltaTabla = error.code === "42P01" || error.code === "PGRST205";
    return {
        ok: false,
        motivo: faltaTabla ? "migracion_pendiente" : error.code === "23505" ? "nombre_duplicado" : "error_supabase",
        ...(faltaTabla ? { migracion: "025" } : {}),
        error: error.message
    };
}

const hhmm = (h) => (h ? String(h).slice(0, 5) : null);

// Postgres devuelve time como "14:30:00": el panel trabaja con "HH:MM".
function normalizar(f) {
    if (!f) return f;
    const porDia = {};
    for (const [d, h] of Object.entries(f.horas_por_dia || {})) porDia[d] = hhmm(h);
    return {
        ...f,
        dias: (f.dias || []).map(Number).sort(),
        hora: hhmm(f.hora),
        hora_festivo: hhmm(f.hora_festivo),
        horas_por_dia: porDia,
        etiqueta: f.modalidad ? `${f.nombre} ${f.modalidad}` : f.nombre
    };
}

function validar(entrada = {}, { parcial = false } = {}) {

    const errores = [];
    const datos = {};
    const tiene = (k) => !parcial || Object.prototype.hasOwnProperty.call(entrada, k);
    const hora = (v) => (v === null || v === undefined || v === "" ? null : String(v).trim());

    if (tiene("nombre")) {
        datos.nombre = String(entrada.nombre ?? "").trim().slice(0, 60);
        if (!datos.nombre) errores.push({ campo: "nombre", mensaje: "Indica el nombre de la lotería." });
    }
    if (tiene("modalidad")) datos.modalidad = String(entrada.modalidad ?? "").trim().slice(0, 30);
    if (tiene("categoria")) {
        datos.categoria = String(entrada.categoria ?? "chance");
        if (!CATEGORIAS.has(datos.categoria)) errores.push({ campo: "categoria", mensaje: "Categoría inválida." });
    }
    if (tiene("dias")) {
        const dias = Array.isArray(entrada.dias) ? [...new Set(entrada.dias.map(Number))].sort() : [];
        if (dias.some(d => !Number.isInteger(d) || d < 1 || d > 7)) errores.push({ campo: "dias", mensaje: "Días inválidos." });
        datos.dias = dias;
    }
    if (tiene("hora")) {
        datos.hora = hora(entrada.hora);
        if (datos.hora && !HORA.test(datos.hora)) errores.push({ campo: "hora", mensaje: "Hora inválida (HH:MM, 24 h)." });
    }
    if (tiene("horas_por_dia")) {
        const porDia = {};
        for (const [d, h] of Object.entries(entrada.horas_por_dia || {})) {
            const v = hora(h);
            if (!v) continue;
            if (!/^[1-7]$/.test(d) || !HORA.test(v)) errores.push({ campo: "horas_por_dia", mensaje: "Hora por día inválida." });
            else porDia[d] = v.slice(0, 5);
        }
        datos.horas_por_dia = porDia;
    }
    if (tiene("regla_festivo")) {
        datos.regla_festivo = String(entrada.regla_festivo ?? "sin_regla");
        if (!REGLAS_FESTIVO.has(datos.regla_festivo)) errores.push({ campo: "regla_festivo", mensaje: "Regla de festivos inválida." });
    }
    if (tiene("hora_festivo")) {
        datos.hora_festivo = hora(entrada.hora_festivo);
        if (datos.hora_festivo && !HORA.test(datos.hora_festivo)) errores.push({ campo: "hora_festivo", mensaje: "Hora de festivo inválida." });
    }
    if (datos.regla_festivo === "hora_especial" && !datos.hora_festivo && !parcial) {
        errores.push({ campo: "hora_festivo", mensaje: "La regla «hora especial» necesita la hora de los festivos." });
    }
    if (tiene("notas")) datos.notas = String(entrada.notas ?? "").trim().slice(0, 500) || null;
    if (tiene("activo")) datos.activo = entrada.activo !== false;

    return { errores, datos };

}

async function sembrarSiVacio(usuarioId) {

    const { count, error } = await supabase.from(TABLA).select("id", { count: "exact", head: true }).eq("usuario_id", usuarioId);
    if (error) return resultado(null, error);
    if (count) return { ok: true, data: false };

    const filas = CATALOGO_INICIAL.map(f => ({ ...f, usuario_id: usuarioId, notas: "Horario pendiente de configurar." }));
    const { error: errorInsert } = await supabase.from(TABLA).insert(filas);
    // 23505: otra petición simultánea ya lo sembró.
    if (errorInsert && errorInsert.code !== "23505") return resultado(null, errorInsert);
    return { ok: true, data: true };

}

async function listar(usuarioId) {

    const siembra = await sembrarSiVacio(usuarioId);
    if (!siembra.ok) return siembra;

    const { data, error } = await supabase
        .from(TABLA)
        .select(COLUMNAS)
        .eq("usuario_id", usuarioId)
        .order("nombre", { ascending: true });

    if (error) return resultado(null, error);

    const orden = (f) => `${f.categoria}|${f.nombre}|${f.modalidad}`;
    return { ok: true, data: (data || []).map(normalizar).sort((a, b) => orden(a).localeCompare(orden(b), "es")) };

}

async function obtener(usuarioId, id) {

    if (!UUID.test(id || "")) return { ok: false, motivo: "no_encontrado" };

    const { data, error } = await supabase.from(TABLA).select(COLUMNAS).eq("usuario_id", usuarioId).eq("id", id).maybeSingle();
    if (error) return resultado(null, error);
    if (!data) return { ok: false, motivo: "no_encontrado" };
    return { ok: true, data: normalizar(data) };

}

async function crear(usuarioId, entrada) {

    const { errores, datos } = validar(entrada);
    if (errores.length) return { ok: false, motivo: "validacion", errores };

    const { data, error } = await supabase.from(TABLA).insert({ ...datos, usuario_id: usuarioId }).select(COLUMNAS).single();
    const r = resultado(data, error);
    return r.ok ? { ok: true, data: normalizar(data) } : r;

}

async function actualizar(usuarioId, id, entrada) {

    const actual = await obtener(usuarioId, id);
    if (!actual.ok) return actual;

    const { errores, datos } = validar(entrada, { parcial: true });
    const regla = datos.regla_festivo ?? actual.data.regla_festivo;
    const horaFestivo = "hora_festivo" in datos ? datos.hora_festivo : actual.data.hora_festivo;
    if (regla === "hora_especial" && !horaFestivo) errores.push({ campo: "hora_festivo", mensaje: "La regla «hora especial» necesita la hora de los festivos." });
    if (errores.length) return { ok: false, motivo: "validacion", errores };

    const { data, error } = await supabase
        .from(TABLA)
        .update({ ...datos, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId)
        .eq("id", id)
        .select(COLUMNAS)
        .maybeSingle();

    const r = resultado(data, error);
    if (!r.ok) return r;
    if (!data) return { ok: false, motivo: "no_encontrado" };
    return { ok: true, data: normalizar(data) };

}

async function horario(usuarioId, id, fecha) {

    const loteria = await obtener(usuarioId, id);
    if (!loteria.ok) return loteria;

    const r = horarioPara(loteria.data, String(fecha || ""));
    return r.ok ? { ok: true, data: { ...r.data, loteria: loteria.data.etiqueta } } : r;

}

module.exports = {
    CATALOGO_INICIAL,
    listar,
    obtener,
    crear,
    actualizar,
    horario
};
