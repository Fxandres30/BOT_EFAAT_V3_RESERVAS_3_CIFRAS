// ==========================================================================
// unSorteoPorPrecio.js — UN SORTEO ACTIVO POR PRECIO Y CLIENTE (decisión
// definitiva del 01/11).
//
// Cada precio es una configuración independiente: un sorteo de $10.000 y uno
// de $3.000 pueden estar activos a la vez, aunque hoy compartan la tabla
// física (configEvento.js). Un sorteo nuevo del MISMO precio y el mismo
// cliente REEMPLAZA al anterior en TODOS sus grupos: sus filas de eventos_bot
// se cierran como «sustituido» (sin mensaje de cierre; sus reservas y pagos se
// conservan con su identidad). Nunca se toca la cuenta de otro cliente ni el
// grupo de WhatsApp.
//
// (Que en un MISMO grupo solo haya un sorteo vigente, de cualquier precio, es
// otra regla: el bot atiende un sorteo por grupo. La aplican el publicador y
// el detector cerrando el anterior solo en ese grupo.)
//
// El cierre va ANTES de activar el nuevo (la migración 043 rechaza dos
// sorteos activos del mismo precio) y se deshace si el nuevo no se pudo
// guardar, para que el precio nunca quede sin sorteo por un fallo.
//
// Recibe el cliente de Supabase (el publicador inyecta el suyo).
// ==========================================================================

const { finDelEvento } = require("./estadosGestion");

const COLUMNAS_SIN_CIERRE = new Set(["42703", "PGRST204"]);

// Precio normalizado (solo dígitos), igual que la 043 y que digitos() del
// panel: "3000", 3000 y "$3.000" son el mismo precio.
function precioDe(valor) {
    const n = Number(String(valor ?? "").replace(/[^0-9]/g, ""));
    return n > 0 ? n : null;
}

// Filas ACTIVAS de OTROS sorteos del cliente con ese precio, en cualquier
// grupo. `excepto`: ids que no cuentan (la fila que se guarda).
async function sorteosActivosDelPrecio(supabase, { usuarioId, valor, identidad, excepto = [] }) {

    const precio = precioDe(valor);
    if (!usuarioId || !precio) return { ok: true, filas: [] };

    const { data, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("activo", true);

    if (error) return { ok: false, error };

    return {
        ok: true,
        filas: (data || []).filter(f =>
            !finDelEvento(f) && precioDe(f.valor) === precio && f.identidad_evento_real !== identidad && !excepto.includes(f.id))
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
async function reemplazarAnteriores(supabase, { usuarioId, filas, motivo, ahora = new Date(), modalidad = "sustitucion_precio" }) {

    // Escritura y respaldo sin la 023: los del orquestador central del cierre
    // (F3-C), condicionados a activo=true como siempre. El algoritmo (qué
    // filas, todo o nada, deshacer) no cambia.
    const { escribirFin, registrarHistorialEvento } = require("../../bot/funciones/eventos/lifecycle/cerrarEvento");

    const cerradas = [];
    const instante = ahora.toISOString();

    for (const f of filas) {

        if (f.usuario_id && f.usuario_id !== usuarioId) continue;

        const cambios = { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: motivo, cerrado_en: instante, actualizado_en: instante };

        const { escrita, error } = await escribirFin(supabase, { fila: f, cambios, requiere: "activa", usuarioId });

        if (error) {
            await revertirReemplazo(supabase, { usuarioId, cerradas, motivo, modalidad });
            return { ok: false, error, cerradas: [] };
        }

        if (escrita) {
            cerradas.push(f);
            await registrarHistorialEvento(supabase, { usuarioId, eventoId: f.id, identidad: f.identidad_evento_real, grupoId: f.grupo_id, modalidad, actor: "sistema", motivo, resultado: "ok", detalle: { fin: "cerrado", todo_o_nada: true } });
        }

    }

    if (cerradas.length) {
        console.log(`🔁 [UN SORTEO POR PRECIO] ${cerradas.length} fila(s) del sorteo anterior cerradas como sustituidas (${motivo}); reservas y pagos intactos.`);
    }

    return { ok: true, cerradas, modalidad };

}

// Deshace un reemplazo cuyo sorteo nuevo no se pudo guardar. Solo restaura
// las filas que siguen cerradas por ESTE reemplazo (mismo cierre_motivo):
// nunca reabre algo que otra acción cerró después.
//
// Endurecimiento F3: la escritura vive en el orquestador
// (cerrarEvento.deshacerSustitucion), que además la deja en el historial.
async function revertirReemplazo(supabase, { usuarioId, cerradas, motivo, modalidad = "sustitucion_precio" }) {

    const { deshacerSustitucion } = require("../../bot/funciones/eventos/lifecycle/cerrarEvento");
    await deshacerSustitucion({ db: supabase, usuarioId, filas: cerradas, motivo, modalidad });

    if (cerradas.length) console.log(`↩️ [UN SORTEO POR PRECIO] el sorteo nuevo no se guardó: ${cerradas.length} fila(s) del anterior vuelven a estar activas.`);

}

// La base rechazó la escritura por la 043 (otro sorteo activo de ese precio).
const esPrecioOcupado = (error) => error?.code === "23P01" && /un_sorteo_activo_por_precio/.test(String(error?.message || ""));

module.exports = { precioDe, sorteosActivosDelPrecio, filasPorId, reemplazarAnteriores, revertirReemplazo, esPrecioOcupado };
