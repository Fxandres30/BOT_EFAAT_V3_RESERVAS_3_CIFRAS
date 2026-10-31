// ==========================================================================
// sorteos/reservasAnticipadas.js — reservas hechas desde el panel ANTES de
// que un sorteo programado se publique.
//
// Se guardan en la tabla física del sorteo (sorteo.tabla) con SU identidad
// (sorteo.identidad_evento_real) y sin evento_id: todavía no existe su fila
// en eventos_bot y nunca se crea una ficticia. Al publicar, el publicador
// crea la fila con esa misma identidad y todo lo que trabaja por identidad
// (disponibilidad, pagos, contadores, cierre) las reconoce.
//
// Como la identidad todavía no está activa en eventos_bot, la 030 las
// clasificaría como «liberables»: cualquier reinicio de la tabla debe
// comprobar antes anticipadasEnTabla() y no tocar nada si hay alguna.
//
// Solo es anticipada mientras su sorteo NO tenga evento: en cuanto existe
// una fila de eventos_bot con su identidad (publicado, aunque el sorteo
// programado quedara en 'fallido'), son reservas de un sorteo publicado.
// ==========================================================================

const supabase = require("../lib/supabase");
const { fechaSorteoDe, instanteBogota } = require("./validar");

// Sorteos que todavía no se publicaron: sus reservas no tienen sorteo
// activo que las proteja.
const ESTADOS_SIN_PUBLICAR = ["borrador", "programado", "publicando", "fallido"];

// «Reiniciar la tabla antes de publicar» elegido y todavía sin hacer (D2).
function reinicioPendiente(config) {
    const t = config?.tabla || {};
    return t.reiniciar === true && !t.reiniciado_en;
}

// Identidades que YA tienen evento (eventos_bot) del cliente: su sorteo se
// publicó (aunque fuera a mano o a medias, y quizá ya cerró). Un sorteo
// programado que quedó en 'fallido' o 'publicando' con evento no tiene
// reservas anticipadas: sus reservas son de un sorteo publicado. null si no
// se pudo leer (quien llama falla cerrado).
async function identidadesConEvento(usuarioId, identidades) {
    if (!identidades.length) return new Set();
    const { data, error } = await supabase.from("eventos_bot")
        .select("identidad_evento_real")
        .eq("usuario_id", usuarioId)
        .in("identidad_evento_real", identidades);
    if (error) return null;
    return new Set((data || []).map(e => e.identidad_evento_real));
}

// Quita de la lista los sorteos cuya identidad ya tiene evento.
async function sinEvento(usuarioId, sorteos) {
    const conEvento = await identidadesConEvento(usuarioId, [...new Set(sorteos.map(s => s.identidad_evento_real).filter(Boolean))]);
    if (!conEvento) return { ok: false };
    return { ok: true, data: sorteos.filter(s => !conEvento.has(s.identidad_evento_real)) };
}

// Sorteos programados del cliente que nunca llegaron a publicarse (estado
// sin publicar y sin ningún evento con su identidad).
async function sorteosSinPublicar(usuarioId) {

    const { data, error } = await supabase.from("sorteos_programados")
        .select("id, estado, tabla, identidad_evento_real, config")
        .eq("usuario_id", usuarioId)
        .in("estado", ESTADOS_SIN_PUBLICAR);

    if (error) return { ok: false, error };

    return sinEvento(usuarioId, data || []);

}

// Números no libres de la tabla que pertenecen a sorteos sin publicar del
// cliente. sorteos: lista ya leída (p. ej. un solo sorteo); si se omite, se
// leen todos los sin publicar.
// { ok, total, porSorteo: [{ sorteoId, nombre, identidad, cantidad, reservados, pagados, otros }] }
async function anticipadasEnTabla(usuarioId, tabla, { sorteos = null } = {}) {

    if (!usuarioId || !tabla) return { ok: false };

    const lista = sorteos ? await sinEvento(usuarioId, sorteos) : await sorteosSinPublicar(usuarioId);
    if (!lista.ok) return { ok: false };

    const porIdentidad = new Map(lista.data.filter(s => s.identidad_evento_real).map(s => [s.identidad_evento_real, s]));
    if (!porIdentidad.size) return { ok: true, total: 0, porSorteo: [] };

    const { data, error } = await supabase.from(tabla)
        .select("numero, estado, identidad_evento_real")
        .eq("usuario_id", usuarioId)
        .in("identidad_evento_real", [...porIdentidad.keys()])
        .neq("estado", "libre");

    if (error) return { ok: false };

    const cuenta = new Map();
    for (const f of data || []) {
        const c = cuenta.get(f.identidad_evento_real) || { cantidad: 0, reservados: 0, pagados: 0, otros: 0 };
        c.cantidad++;
        if (f.estado === "reservado") c.reservados++; else if (f.estado === "pagado") c.pagados++; else c.otros++;
        cuenta.set(f.identidad_evento_real, c);
    }

    const porSorteo = [...cuenta].map(([identidad, c]) => {
        const s = porIdentidad.get(identidad);
        return { sorteoId: s.id, nombre: s.config?.nombre || null, identidad, ...c };
    });

    return { ok: true, total: porSorteo.reduce((n, s) => n + s.cantidad, 0), porSorteo };

}

// Reservas anticipadas de UN sorteo (en su tabla).
function anticipadasDelSorteo(usuarioId, sorteo) {
    return anticipadasEnTabla(usuarioId, sorteo.tabla, { sorteos: [sorteo] });
}

function describirAnticipadas(r) {
    const detalle = r.porSorteo.map(s => `«${s.nombre || "sin nombre"}»: ${s.cantidad}`).join("; ");
    return `${r.total} reserva(s) anticipada(s) de sorteos programados sin publicar (${detalle})`;
}

// Sorteos programados de ESTA tabla y precio que podrían recibir reservas
// anticipadas, con el motivo cuando no (para explicarlo en el panel). Solo
// confirmados en su versión vigente (D1). La hora de cierre no lo excluye:
// el estado del sorteo no decide si el propietario puede reservar.
async function sorteosParaReservar(usuarioId, { tabla, precio, ahora = new Date() }) {

    const { data, error } = await supabase.from("sorteos_programados")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("estado", "programado")
        .eq("tabla", tabla);

    if (error) return { ok: false, error };

    const resultado = [];

    for (const s of data || []) {

        if (Number(s.config?.valor) !== precio) continue;

        const fecha = fechaSorteoDe(s.config, s.publicar_en);
        const cierre = s.config?.hora_cierre ? instanteBogota(fecha, s.config.hora_cierre) : null;

        const { data: grupos, error: errorGrupos } = await supabase.from("sorteos_programados_grupos")
            .select("grupo_id, grupo_nombre, estado")
            .eq("usuario_id", usuarioId).eq("sorteo_id", s.id);

        if (errorGrupos) return { ok: false, error: errorGrupos };

        const motivo = s.confirmado_version !== s.version
            ? "La versión actual del sorteo no está confirmada."
            : reinicioPendiente(s.config)
                ? "Este sorteo reiniciará la tabla al publicarse: no admite reservas anticipadas."
                : null;

        resultado.push({
            sorteo: s,
            fecha,
            cierre,
            grupos: (grupos || []).filter(g => g.estado !== "cancelado"),
            aceptaReservas: !motivo,
            motivo
        });

    }

    return { ok: true, data: resultado };

}

module.exports = {
    ESTADOS_SIN_PUBLICAR,
    reinicioPendiente,
    sorteosSinPublicar,
    anticipadasEnTabla,
    anticipadasDelSorteo,
    describirAnticipadas,
    sorteosParaReservar
};
