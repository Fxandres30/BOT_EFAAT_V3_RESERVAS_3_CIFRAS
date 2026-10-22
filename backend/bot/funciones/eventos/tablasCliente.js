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

    if (!usuarioId) return [];

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
        if (!faltaMigracion(error)) console.error("⚠️ [TABLAS CLIENTE] no se pudo leer la configuración (se usa la base):", error.code || error.message);
        return configuracionesBase();
    }

    // Sin filas: aún no inicializado (primer acceso pendiente).
    if (!data || data.length === 0) return configuracionesBase();

    return data
        .filter(f => f.activa !== false)
        .map(f => ({ precio: Number(f.precio), tabla: f.tabla_fisica, cifras: f.cifras, cantidad: f.cantidad }));

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

module.exports = {
    listarConfiguracionesCliente,
    obtenerConfiguracionCliente,
    inicializarCliente
};
