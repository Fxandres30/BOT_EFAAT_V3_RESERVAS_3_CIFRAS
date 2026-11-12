// ==========================================================================
// rifas/numerosSorteo.js — FUENTE ÚNICA de los números de un sorteo para
// todo lo que no es el bot: vista previa, imagen (publicar, Compartir,
// imprimir), disponibilidad antes de publicar, reservas anticipadas,
// reinicio, conteos de «Sorteos en curso» y administración.
//
// Auditoría 12/11/2026: estos módulos leían la cuadrícula física antigua
// (reservas_dos_cifras, compartida por varios precios y filtrada SOLO por
// usuario_id) mientras Reservas y el bot leen numeros_rifa por tabla_id. Un
// sorteo de $2.000 mostraba los 72 números de un sorteo cerrado de $1.000.
//
// Regla: con el motor de rifas (MOTOR_RIFAS=nuevo, producción) los números
// de un sorteo son los de SU rifa: numeros_rifa con usuario_id + tabla_id.
// Sin tabla_id no se lee NADA (falla cerrado: nunca se adivina la rifa por
// el precio ni por el cliente). La cuadrícula antigua solo se lee con
// MOTOR_RIFAS=legado, la vuelta atrás de emergencia (el mismo interruptor
// que usa el bot: nunca dos motores a la vez).
//
// `fuente` = { tablaId, tabla } — se obtiene con fuenteDe(sorteo | evento):
//   tablaId: la rifa (sorteos_programados.tabla_id / eventos_bot.tabla_id);
//   tabla:   la cuadrícula antigua (solo motor legado).
// ==========================================================================

const { motorNuevo } = require("./motor");
const { esUuid, aTexto } = require("./formato");

// Perezoso: las pruebas inyectan su cliente en require.cache.
const db = () => require("../lib/supabase");

const PAGINA = 1000;

// Rifa y cuadrícula de un sorteo programado, una fila de eventos_bot o una
// fuente ya construida. Un texto suelto es una cuadrícula antigua.
function fuenteDe(x) {
    if (!x) return { tablaId: null, tabla: null };
    if (typeof x === "string") return { tablaId: null, tabla: x };
    return {
        tablaId: x.tablaId ?? x.tabla_id ?? null,
        tabla: (typeof x.tabla === "string" ? x.tabla : null)
    };
}

// ¿Se puede leer algo con esta fuente en el motor actual?
function legible(fuente) {
    const f = fuenteDe(fuente);
    return motorNuevo() ? esUuid(f.tablaId) : Boolean(f.tabla);
}

const sinRifa = () => ({ code: "SIN_RIFA", message: "El sorteo no tiene una rifa asignada (tabla_id): no se leen números de ninguna otra tabla." });

// Consulta de lectura sobre los números del sorteo, ya limitada al cliente
// y a SU rifa. El llamador añade sus filtros (.in, .neq, .eq…). null si la
// fuente no identifica una rifa (motor nuevo) o una cuadrícula (legado).
// Columnas comunes a las dos tablas: numero, estado, identidad_evento_real,
// evento_id, nombre_evento, grupo_id, comprador, telefono, usuario_global_id.
function consulta(usuarioId, fuente, columnas) {
    const f = fuenteDe(fuente);
    if (!usuarioId) return null;
    if (motorNuevo()) {
        if (!esUuid(f.tablaId)) return null;
        return db().from("numeros_rifa").select(columnas).eq("usuario_id", usuarioId).eq("tabla_id", f.tablaId);
    }
    if (!f.tabla) return null;
    return db().from(f.tabla).select(columnas).eq("usuario_id", usuarioId);
}

// Ejecuta una consulta() leyendo todas las páginas (una rifa puede tener
// más de 1000 números). construir() devuelve la consulta YA filtrada.
// -> { data, error } como supabase-js.
async function todasLasPaginas(construir) {
    const filas = [];
    for (let desde = 0; ; desde += PAGINA) {
        const q = construir();
        if (!q) return { data: null, error: sinRifa() };
        const { data, error } = await q.range(desde, desde + PAGINA - 1);
        if (error) return { data: null, error };
        filas.push(...(data || []));
        if (!data || data.length < PAGINA) break;
    }
    return { data: filas, error: null };
}

// Rifa de la fuente (motor nuevo). null si no existe para ese cliente.
async function rifaDe(usuarioId, fuente) {
    const f = fuenteDe(fuente);
    if (!esUuid(usuarioId) || !esUuid(f.tablaId)) return null;
    const { data, error } = await db().from("tablas_rifas").select("*")
        .eq("usuario_id", usuarioId).eq("id", f.tablaId).maybeSingle();
    if (error) throw new Error(`[RIFAS] rifa ${f.tablaId}: ${error.message}`);
    return data || null;
}

// Números del sorteo con el número como TEXTO de la cuadrícula ("07").
// -> { ok: true, filas, rifa } | { ok: false, motivo, error }
//    filas: [{ numero, estado, identidad_evento_real, evento_id, nombre_evento }]
async function leerFilas(usuarioId, fuente) {

    const f = fuenteDe(fuente);
    const columnas = "numero, estado, identidad_evento_real, evento_id, nombre_evento";

    if (motorNuevo()) {
        if (!esUuid(f.tablaId)) return { ok: false, motivo: "sin_rifa", error: sinRifa().message };
        let rifa;
        try {
            rifa = await rifaDe(usuarioId, f);
        } catch (e) {
            return { ok: false, motivo: "error_supabase", error: e.message };
        }
        if (!rifa) return { ok: false, motivo: "rifa_no_encontrada", error: "La rifa del sorteo no existe en esta cuenta." };
        const { data, error } = await todasLasPaginas(() => consulta(usuarioId, f, columnas)?.order("numero", { ascending: true }));
        if (error) return { ok: false, motivo: "error_supabase", error: error.message };
        return {
            ok: true,
            rifa,
            filas: data.map(r => ({ ...r, numero: aTexto(r.numero, rifa.cifras) }))
        };
    }

    // Motor legado (vuelta atrás): la misma lectura de siempre, una consulta.
    if (!f.tabla) return { ok: false, motivo: "sin_tabla", error: "El sorteo no tiene tabla de números." };
    const { data, error } = await consulta(usuarioId, f, columnas);
    if (error) return { ok: false, motivo: "error_supabase", error: error.message };
    // Orden por número (antes lo hacía .order("numero") de la imagen; aquí en
    // memoria para que vista previa e imagen salgan idénticas).
    const filas = (data || []).map(r => ({ ...r, numero: String(r.numero) }));
    filas.sort((a, b) => (a.numero.length - b.numero.length) || (a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0));
    return { ok: true, rifa: null, filas };

}

// Lo que pinta la IMAGEN (y la vista previa): solo número y estado.
// numerosPagados ⊂ numerosOcupados. Lanza si no se puede leer: nunca se
// genera una imagen con una tabla que no es la del sorteo.
function resumenImagen(filas) {
    return {
        numerosDisponibles: filas.filter(r => r.estado === "libre").map(r => r.numero),
        numerosOcupados: filas.filter(r => r.estado !== "libre").map(r => r.numero),
        numerosPagados: filas.filter(r => r.estado === "pagado").map(r => r.numero)
    };
}

async function numerosImagen(usuarioId, fuente) {
    const r = await leerFilas(usuarioId, fuente);
    if (!r.ok) {
        const e = new Error(r.error || r.motivo);
        e.code = r.motivo;
        throw e;
    }
    return { ...resumenImagen(r.filas), rifa: r.rifa };
}

module.exports = { fuenteDe, legible, consulta, todasLasPaginas, rifaDe, leerFilas, resumenImagen, numerosImagen };
