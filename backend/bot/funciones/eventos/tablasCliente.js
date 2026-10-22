// ==========================================================================
// tablasCliente.js — qué precios ofrece CADA cliente y en qué tabla física
// vive cada uno (tablas_cliente, migración 027), e inicialización del
// cliente en su primer acceso.
//
// Las tablas físicas son compartidas: el aislamiento entre clientes lo da
// usuario_id (filtroCliente.js en el bot, RLS de la Parte A en la base), no
// esta configuración. Por eso, si tablas_cliente todavía no existe (027 sin
// aplicar), el cliente aún no está inicializado o la lectura falla, se usa
// la configuración base de configEvento.js — el comportamiento de siempre —
// en vez de dejar de reconocer anuncios. Sin usuarioId: null (falla cerrado).
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { obtenerConfiguracion, configuracionesBase } = require("./configEvento");

// Tabla o función inexistente (Postgres o caché de esquema de PostgREST).
const CODIGOS_SIN_MIGRACION = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

function faltaMigracion(error) {
    return !!error && CODIGOS_SIN_MIGRACION.has(error.code);
}

function precioDe(valor) {
    const precio = Number(String(valor ?? "").replace(/[^\d]/g, ""));
    return precio > 0 ? precio : null;
}

// Configuraciones ACTIVAS del cliente: [{ precio, tabla, cifras, cantidad }].
async function listarConfiguracionesCliente(usuarioId) {

    return (await leerConfiguraciones(usuarioId)).lista;

}

// Igual, y de dónde salen: "cliente" (tablas_cliente), "base_sin_migracion"
// (027 sin aplicar), "base_sin_inicializar" (027 aplicada, cliente sin
// filas) o "base_error" (no se pudo leer).
async function leerConfiguraciones(usuarioId) {

    if (!usuarioId) return { lista: [], origen: null };

    let data, error;

    try {
        ({ data, error } = await supabase
            .from("tablas_cliente")
            .select("precio, tabla_fisica, cifras, cantidad, activa")
            .eq("usuario_id", usuarioId)
            .order("precio", { ascending: true }));
    } catch (e) {
        error = { message: e?.message || String(e) };
    }

    if (error) {
        const sinMigracion = faltaMigracion(error);
        if (!sinMigracion) console.error("⚠️ [TABLAS CLIENTE] no se pudo leer la configuración (se usa la base):", error.code || error.message);
        return { lista: configuracionesBase(), origen: sinMigracion ? "base_sin_migracion" : "base_error" };
    }

    // Sin filas: aún no inicializado (primer acceso pendiente).
    if (!data || data.length === 0) return { lista: configuracionesBase(), origen: "base_sin_inicializar" };

    return {
        lista: data
            .filter(f => f.activa !== false)
            .map(f => ({ precio: Number(f.precio), tabla: f.tabla_fisica, cifras: f.cifras, cantidad: f.cantidad })),
        origen: "cliente"
    };

}

// Misma forma que configEvento.obtenerConfiguracion: { tabla, cifras, cantidad } | null.
async function obtenerConfiguracionCliente(usuarioId, valor) {

    const precio = precioDe(valor);

    if (!usuarioId || !precio) return null;

    const lista = await listarConfiguracionesCliente(usuarioId);
    const c = lista.find(x => x.precio === precio);

    return c ? { tabla: c.tabla, cifras: c.cifras, cantidad: c.cantidad } : null;

}

// Primer acceso del cliente: sus configuraciones (los precios base del
// código) y su cuadrícula 00-99 en cada tabla física, de forma idempotente
// (inicializar_tablas_cliente, migración 027). usuarioId SIEMPRE sale del
// token validado por el llamador (routes/tablas.js), nunca del navegador.
async function inicializarCliente(usuarioId) {

    if (!usuarioId) return { ok: false, motivo: "sin_usuario" };

    const { data, error } = await supabase.rpc("inicializar_tablas_cliente", {
        p_usuario: usuarioId,
        p_configuraciones: configuracionesBase()
    });

    if (error) {
        if (faltaMigracion(error)) return { ok: false, motivo: "migracion_pendiente", migracion: "027_tablas_cliente.sql" };
        // Unicidad sobre numero en la tabla física (diagnóstico D17): la
        // función se revierte entera y no toca ninguna cuadrícula.
        if (error.code === "23505") return { ok: false, motivo: "restriccion_unica" };
        console.error("❌ [TABLAS CLIENTE] error inicializando:", error.code || error.message);
        return { ok: false, motivo: "error_supabase" };
    }

    if (!data?.ok) return { ok: false, motivo: data?.motivo || "error_supabase" };

    const incompletas = (data.cuadriculas || []).filter(c => c.estado === "incompleta");
    if (incompletas.length) {
        console.warn("⚠️ [TABLAS CLIENTE] cuadrícula incompleta (no se toca):", incompletas.map(c => `${c.tabla}=${c.filas}`).join(", "));
    }

    return { ok: true, data };

}

// Estado REAL de la cuadrícula del cliente para un precio, contado con el
// rol del backend (sin RLS de por medio): así el panel distingue "el cliente
// no tiene filas" de "tiene filas pero su sesión no puede leerlas". Solo
// lee; nunca crea, completa ni reinicia.
//   { ok: true, precio, tabla, esperadas, filas, estado: "vacia" | "completa" | "incompleta" | "excedida", configuracion }
//   { ok: false, motivo: "sin_usuario" | "tabla_no_configurada" | "error_lectura", codigo? }
async function estadoCuadricula(usuarioId, valor) {

    const precio = precioDe(valor);

    if (!usuarioId) return { ok: false, motivo: "sin_usuario" };
    if (!precio) return { ok: false, motivo: "tabla_no_configurada" };

    const { lista, origen } = await leerConfiguraciones(usuarioId);
    const c = lista.find(x => x.precio === precio);

    if (!c) return { ok: false, motivo: "tabla_no_configurada" };

    let count, error;

    try {
        ({ count, error } = await supabase
            .from(c.tabla)
            .select("numero", { count: "exact", head: true })
            .eq("usuario_id", usuarioId));
    } catch (e) {
        error = { message: e?.message || String(e) };
    }

    if (error || typeof count !== "number") {
        console.error("❌ [TABLAS CLIENTE] no se pudo contar la cuadrícula:", error?.code || error?.message || "sin conteo");
        return { ok: false, motivo: "error_lectura", ...(error?.code ? { codigo: error.code } : {}) };
    }

    const estado =
        count === 0 ? "vacia" :
        count === c.cantidad ? "completa" :
        count < c.cantidad ? "incompleta" : "excedida";

    return { ok: true, precio, tabla: c.tabla, esperadas: c.cantidad, filas: count, estado, configuracion: origen };

}

// Deja lista la cuadrícula del cliente para un precio, SIN riesgo para
// nadie: si ya tiene filas (completa, incompleta o de más) no se toca; si
// no tiene ninguna, se pide la inicialización idempotente (027), que solo
// inserta 00-99 del cliente cuando la base lo permite (Parte A + 033) y
// nunca toca otra cuadrícula. Ante cualquier impedimento devuelve el motivo
// real; nunca reinicia ni borra.
async function prepararCuadricula(usuarioId, valor) {

    const antes = await estadoCuadricula(usuarioId, valor);

    if (!antes.ok || antes.estado !== "vacia") return antes;

    const r = await inicializarCliente(usuarioId);

    if (!r.ok) {
        return { ...antes, ok: false, motivo: r.motivo, ...(r.migracion ? { migracion: r.migracion } : {}) };
    }

    return estadoCuadricula(usuarioId, valor);

}

module.exports = {
    listarConfiguracionesCliente,
    obtenerConfiguracionCliente,
    inicializarCliente,
    estadoCuadricula,
    prepararCuadricula
};
