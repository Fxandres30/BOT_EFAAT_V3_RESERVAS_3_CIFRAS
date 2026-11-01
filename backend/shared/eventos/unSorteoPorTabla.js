// ==========================================================================
// unSorteoPorTabla.js — UNA TABLA = UN SORTEO ACTIVO (decisión del 31/10).
//
// Publicar otro sorteo (desde el panel o con un anuncio en WhatsApp) en una
// tabla física que ya tiene uno activo REEMPLAZA al anterior en TODOS sus
// grupos: sus filas de eventos_bot se cierran como «sustituido» (sin mensaje
// de cierre; sus reservas y pagos se conservan con su identidad y, al ser la
// misma tabla, cuentan en el sorteo nuevo). Nunca se toca la cuenta de otro
// cliente ni el grupo de WhatsApp.
//
// El cierre va ANTES de activar el nuevo (la migración 043 rechaza dos
// sorteos activos en la misma tabla) y se deshace si el nuevo no se pudo
// guardar, para que la tabla nunca quede sin sorteo por un fallo.
//
// Recibe el cliente de Supabase (el publicador inyecta el suyo).
// ==========================================================================

const { finDelEvento } = require("./estadosGestion");

const COLUMNAS_SIN_CIERRE = new Set(["42703", "PGRST204"]);

// Filas ACTIVAS de OTROS sorteos del cliente en esa tabla física, en
// cualquier grupo. `excepto`: ids que no cuentan (la fila que se guarda).
async function sorteosQueOcupanLaTabla(supabase, { usuarioId, tabla, identidad, excepto = [] }) {

    if (!usuarioId || !tabla) return { ok: true, filas: [] };

    const { data, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("tabla", tabla).eq("activo", true);

    if (error) return { ok: false, error };

    return {
        ok: true,
        filas: (data || []).filter(f => !finDelEvento(f) && f.identidad_evento_real !== identidad && !excepto.includes(f.id))
    };

}

// Filas completas por id, solo del cliente (para poder deshacer el cierre).
async function filasPorId(supabase, usuarioId, ids) {
    if (!ids.length) return { ok: true, filas: [] };
    const { data, error } = await supabase.from("eventos_bot").select("*").eq("usuario_id", usuarioId).in("id", ids);
    if (error) return { ok: false, error };
    return { ok: true, filas: data || [] };
}

// Cierra como «sustituido» cada fila todavía activa (condicionado a
// activo=true). -> { ok, cerradas: [fila tal como estaba] }. Si una falla,
// deshace las anteriores y devuelve ok=false: o se cierran todas o ninguna.
async function reemplazarAnteriores(supabase, { usuarioId, filas, motivo, ahora = new Date() }) {

    const cerradas = [];
    const instante = ahora.toISOString();

    for (const f of filas) {

        if (f.usuario_id && f.usuario_id !== usuarioId) continue;

        const cambios = { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: motivo, cerrado_en: instante, actualizado_en: instante };

        let { data, error } = await supabase.from("eventos_bot").update(cambios)
            .eq("usuario_id", usuarioId).eq("id", f.id).eq("activo", true).select("id");

        // Sin las columnas de cierre por grupo (023).
        if (error && COLUMNAS_SIN_CIERRE.has(error.code)) {
            ({ data, error } = await supabase.from("eventos_bot").update({ activo: false, estado: "cerrado", actualizado_en: instante })
                .eq("usuario_id", usuarioId).eq("id", f.id).eq("activo", true).select("id"));
        }

        if (error) {
            await revertirReemplazo(supabase, { usuarioId, cerradas, motivo });
            return { ok: false, error, cerradas: [] };
        }

        if (data?.length) cerradas.push(f);

    }

    if (cerradas.length) {
        console.log(`🔁 [UNA TABLA = UN SORTEO] ${cerradas.length} fila(s) del sorteo anterior cerradas como sustituidas (${motivo}); reservas y pagos intactos.`);
    }

    return { ok: true, cerradas };

}

// Deshace un reemplazo cuyo sorteo nuevo no se pudo guardar. Solo restaura
// las filas que siguen cerradas por ESTE reemplazo (mismo cierre_motivo):
// nunca reabre algo que otra acción cerró después.
async function revertirReemplazo(supabase, { usuarioId, cerradas, motivo }) {

    for (const f of cerradas) {
        const restaurar = {
            activo: f.activo, estado: f.estado,
            cierre_estado: f.cierre_estado ?? null, cierre_motivo: f.cierre_motivo ?? null, cerrado_en: f.cerrado_en ?? null,
            actualizado_en: new Date().toISOString()
        };
        const { error } = await supabase.from("eventos_bot").update(restaurar)
            .eq("usuario_id", usuarioId).eq("id", f.id).eq("cierre_motivo", motivo);
        if (error) console.error(`❌ [UNA TABLA = UN SORTEO] no se pudo deshacer el cierre de ${f.id}:`, error.message);
    }

    if (cerradas.length) console.log(`↩️ [UNA TABLA = UN SORTEO] el sorteo nuevo no se guardó: ${cerradas.length} fila(s) del anterior vuelven a estar activas.`);

}

// La base rechazó la escritura por la 043 (otro sorteo activo en la tabla).
const esTablaOcupada = (error) => error?.code === "23P01" && /un_sorteo_activo_por_tabla/.test(String(error?.message || ""));

module.exports = { sorteosQueOcupanLaTabla, filasPorId, reemplazarAnteriores, revertirReemplazo, esTablaOcupada };
