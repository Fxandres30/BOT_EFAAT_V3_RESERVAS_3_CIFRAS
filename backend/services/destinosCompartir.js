// ==========================================================================
// destinosCompartir.js — grupos de destino, texto e imagen del botón
// «Compartir» de una tabla (Tablas → Compartir). La imagen es la captura PNG
// del `div` de la tabla visible que manda el panel (aquí solo se valida); el
// envío es el de services/compartirTabla.js (sendImage). Aquí:
//
//   - qué grupos puede elegir el cliente: SUS grupos_autorizados activos
//     (los mismos que ofrece el formulario de sorteos, sorteos/repo.js);
//   - qué grupos eligió para esa tabla (destinos_compartir_tabla, migración
//     037: una fila por usuario_id + precio). Sin la migración la selección
//     no se guarda y el panel la pide en cada envío;
//   - qué texto acompaña a la imagen: el «Mensaje de publicación» del
//     sorteo activo (el de «Editar sorteo activo»), con sus variables; si
//     no hay ninguno guardado, el texto habitual de «Compartir».
//
// El cliente sale SIEMPRE del token (routes/tablas.js); nada de aquí envía.
// ==========================================================================

const supabase = require("../lib/supabase");
const repoSorteos = require("../sorteos/repo");
const sorteosActivos = require("../sorteos/sorteosActivos");
const { mensajePublicacion } = require("../sorteos/mensajes");
const { construirTextoCompartir } = require("./compartirTabla");

const TABLA = "destinos_compartir_tabla";
// Tabla inexistente (037 sin aplicar), en Postgres o PostgREST.
const SIN_TABLA = new Set(["42P01", "PGRST205"]);
const GRUPO = /^[0-9A-Za-z.-]{1,80}@g\.us$/;
const MAX_GRUPOS = 50;
const MAX_TEXTO = 4000;

// [{ grupo_id, nombre }] de los grupos autorizados y activos del cliente.
async function gruposDisponibles(usuarioId) {
    return repoSorteos.gruposAutorizados(usuarioId);
}

// { ok, data: string[] | null, persistencia } — null = nunca eligió.
async function obtenerDestinos(usuarioId, precio) {

    const { data, error } = await supabase.from(TABLA).select("grupos")
        .eq("usuario_id", usuarioId).eq("precio", Number(precio)).maybeSingle();

    if (error && SIN_TABLA.has(error.code)) return { ok: true, data: null, persistencia: false };
    if (error) return { ok: false, motivo: "error_supabase", error: error.message };

    return { ok: true, data: Array.isArray(data?.grupos) && data.grupos.length ? data.grupos : null, persistencia: true };

}

async function guardarDestinos(usuarioId, precio, grupos) {

    const ahora = new Date().toISOString();
    const { error } = await supabase.from(TABLA).upsert(
        { usuario_id: usuarioId, precio: Number(precio), grupos, confirmado_en: ahora, actualizado_en: ahora },
        { onConflict: "usuario_id,precio" }
    );

    if (error && SIN_TABLA.has(error.code)) return { ok: false, motivo: "migracion_pendiente", migracion: "037_destinos_compartir_tabla.sql" };
    if (error) return { ok: false, motivo: "error_supabase", error: error.message };

    return { ok: true };

}

// Lista enviada por el panel -> ids únicos con formato de grupo, o null.
function normalizarGrupos(lista) {
    if (!Array.isArray(lista)) return null;
    const ids = [...new Set(lista.map(g => String(g || "").trim()))];
    if (!ids.length || ids.length > MAX_GRUPOS || ids.some(g => !GRUPO.test(g))) return null;
    return ids;
}

// Separa los grupos que SIGUEN autorizados para este cliente de los que no
// (quitados de grupos_autorizados, desactivados o de otro cliente).
function clasificar(grupos, disponibles) {
    const nombres = new Map(disponibles.map(g => [g.grupo_id, g.nombre]));
    return {
        validos: grupos.filter(g => nombres.has(g)).map(g => ({ grupo_id: g, nombre: nombres.get(g) || null })),
        invalidos: grupos.filter(g => !nombres.has(g))
    };
}

// Captura PNG de la tabla que manda el panel (data URL base64). Devuelve el
// Buffer solo si es un PNG real (firma + cabecera IHDR), de tamaño y
// dimensiones razonables; si no, null. Nunca se interpreta otro formato.
const MAX_IMAGEN_BYTES = 3 * 1024 * 1024;
const MAX_LADO_PX = 8000;
const PREFIJO_PNG = "data:image/png;base64,";
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imagenPng(dataUrl) {

    if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIJO_PNG)) return null;

    const base64 = dataUrl.slice(PREFIJO_PNG.length);
    if (!base64 || base64.length > Math.ceil(MAX_IMAGEN_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;

    const buf = Buffer.from(base64, "base64");
    if (buf.length < 33 || buf.length > MAX_IMAGEN_BYTES) return null;
    if (!buf.subarray(0, 8).equals(FIRMA_PNG) || buf.toString("ascii", 12, 16) !== "IHDR") return null;

    const ancho = buf.readUInt32BE(16);
    const alto = buf.readUInt32BE(20);
    if (!ancho || !alto || ancho > MAX_LADO_PX || alto > MAX_LADO_PX) return null;

    return buf;

}

function textoEditado(valor) {
    if (typeof valor !== "string") return null;
    const t = valor.trim().slice(0, MAX_TEXTO);
    return t || null;
}

// Texto que acompaña a la imagen. { texto, origen: "sorteo" | "habitual" }.
async function textoParaCompartir(usuarioId, evento) {

    const activo = evento?.id ? await sorteosActivos.obtener(usuarioId, evento.id) : null;
    const s = activo?.ok ? activo.data : null;

    if (s?.publicacion) {
        const config = {
            nombre: s.nombre, hora_fin: s.hora_fin, hora_cierre: s.hora_cierre, valor: s.valor,
            premios: s.premios, cantidad_numeros: s.cantidad_numeros, mensajes: { publicacion: s.publicacion }
        };
        return { texto: mensajePublicacion(config, s.cuentas || [], { fecha: s.fecha_evento || "" }).texto, origen: "sorteo" };
    }

    return { texto: construirTextoCompartir(evento), origen: "habitual" };

}

module.exports = {
    gruposDisponibles,
    obtenerDestinos,
    guardarDestinos,
    normalizarGrupos,
    clasificar,
    imagenPng,
    textoEditado,
    textoParaCompartir,
    MAX_TEXTO
};
