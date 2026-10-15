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
const GLOBAL = "loterias_catalogo_global";            // migración 026
const OFRECIDAS = "loterias_catalogo_ofrecidas";        // migración 026
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

const faltaTabla = (error) => error?.code === "42P01" || error?.code === "PGRST205";

function resultado(data, error) {
    if (!error) return { ok: true, data };
    const sinTabla = faltaTabla(error);
    const motivo = sinTabla ? "migracion_pendiente" : error.code === "23505" ? "nombre_duplicado" : "error_supabase";
    // Error real al log del servidor (código y mensaje de la base; sin datos
    // de clientes). Al panel solo llega el motivo.
    if (motivo !== "nombre_duplicado") console.error(`❌ [LOTERIAS] ${motivo}: ${error.code || "sin código"} ${error.message || ""}`.trim());
    return {
        ok: false,
        motivo,
        ...(sinTabla ? { migracion: "025" } : {}),
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

// Sin la migración 026: catálogo inicial del código si el calendario está
// vacío (comportamiento anterior).
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

// Con la migración 026: SINCRONIZACIÓN SEGURA con el catálogo global. Cada
// vez que el cliente abre su calendario se le copian solo las entradas
// globales que NUNCA se le ofrecieron (la primera vez: todas). Queda
// registrado qué se le ofreció, así:
//   - lo que editó no se sobrescribe (nunca se actualizan sus copias);
//   - lo que eliminó no vuelve (ya consta como ofrecido);
//   - una entrada global nueva le llega una vez, salvo que ya tenga una
//     propia con el mismo nombre y modalidad (entonces solo se marca).
const claveDe = (f) => `${String(f.nombre || "").toLocaleLowerCase("es")}|${String(f.modalidad || "").toLocaleLowerCase("es")}`;
const CAMPOS_COPIA = ["nombre", "modalidad", "categoria", "dias", "hora", "horas_por_dia", "regla_festivo", "hora_festivo", "notas"];

async function copiarEntradas(filas) {

    const { error } = await supabase.from(TABLA).upsert(filas, { onConflict: "usuario_id,origen_global_id", ignoreDuplicates: true });
    if (!error) return { ok: true };
    if (error.code !== "23505") return resultado(null, error);

    // Choque por nombre (el cliente creó una igual en paralelo): una a una.
    for (const fila of filas) {
        const r = await supabase.from(TABLA).upsert([fila], { onConflict: "usuario_id,origen_global_id", ignoreDuplicates: true });
        if (r.error && r.error.code !== "23505") return resultado(null, r.error);
    }
    return { ok: true };

}

async function sincronizarDesdeGlobal(usuarioId) {

    const global = await supabase.from(GLOBAL).select(`id, ${CAMPOS_COPIA.join(", ")}`).eq("activo", true);
    if (global.error) return faltaTabla(global.error) ? sembrarSiVacio(usuarioId) : resultado(null, global.error);

    const ofrecidas = await supabase.from(OFRECIDAS).select("global_id").eq("usuario_id", usuarioId);
    if (ofrecidas.error) return faltaTabla(ofrecidas.error) ? sembrarSiVacio(usuarioId) : resultado(null, ofrecidas.error);

    const yaOfrecidas = new Set((ofrecidas.data || []).map(o => o.global_id));
    const nuevas = (global.data || []).filter(g => !yaOfrecidas.has(g.id));
    if (!nuevas.length) return { ok: true, data: 0 };

    const propias = await supabase.from(TABLA).select("nombre, modalidad, origen_global_id").eq("usuario_id", usuarioId);
    if (propias.error) return resultado(null, propias.error);

    const yaTiene = new Set((propias.data || []).map(claveDe));
    const yaCopiadas = new Set((propias.data || []).map(f => f.origen_global_id).filter(Boolean));

    const filas = nuevas
        .filter(g => !yaCopiadas.has(g.id) && !yaTiene.has(claveDe(g)))
        .map(g => ({ usuario_id: usuarioId, origen_global_id: g.id, activo: true, ...Object.fromEntries(CAMPOS_COPIA.map(c => [c, g[c]])) }));

    if (filas.length) {
        const copia = await copiarEntradas(filas);
        if (!copia.ok) return copia;
    }

    const marcas = nuevas.map(g => ({ usuario_id: usuarioId, global_id: g.id }));
    const { error } = await supabase.from(OFRECIDAS).upsert(marcas, { onConflict: "usuario_id,global_id", ignoreDuplicates: true });
    if (error) return resultado(null, error);

    return { ok: true, data: filas.length };

}

async function listar(usuarioId) {

    const siembra = await sincronizarDesdeGlobal(usuarioId);
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

// Elimina una entrada del calendario DEL CLIENTE (nunca la del catálogo
// global ni la de otro cliente). Los sorteos que la usaban conservan su copia
// del nombre.
async function eliminar(usuarioId, id) {

    if (!UUID.test(id || "")) return { ok: false, motivo: "no_encontrado" };

    const { data, error } = await supabase.from(TABLA).delete().eq("usuario_id", usuarioId).eq("id", id).select("id");
    if (error) return resultado(null, error);
    if (!data || !data.length) return { ok: false, motivo: "no_encontrado" };
    return { ok: true, data: { id } };

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
    eliminar,
    horario
};
