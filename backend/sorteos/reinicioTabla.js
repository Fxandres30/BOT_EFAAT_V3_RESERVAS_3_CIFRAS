// ==========================================================================
// sorteos/reinicioTabla.js — reinicio OPCIONAL y seguro de la tabla de
// números al programar un sorteo (migración 030: reiniciar_tabla_cliente).
//
// Nunca automático: el sorteo lo pide (config.tabla.reiniciar) y el usuario
// lo confirma en la vista previa con la huella de lo que vio. Toda la
// decisión y la escritura ocurren en la base, en UNA transacción y solo
// sobre las filas del cliente del token: nada se borra (lo liberado queda en
// reservas_archivo) y nunca se tocan pagos ni reservas de un sorteo activo.
// ==========================================================================

const supabase = require("../lib/supabase");

const SIN_MIGRACION = new Set(["42883", "42P01", "PGRST202", "PGRST205"]);

const NOMBRE_CLASE = {
    protegido_activo: "del sorteo activo",
    protegido_sin_sorteo: "que no se pueden atribuir con seguridad a un sorteo terminado",
    protegido_en_proceso: "con pago en proceso",
    protegido_desconocido: "en un estado desconocido"
};

function describirGrupo(g) {
    const partes = [];
    if (g.pagados) partes.push(`${g.pagados} pagado(s)`);
    if (g.reservados) partes.push(`${g.reservados} reservado(s)`);
    if (g.otros) partes.push(`${g.otros} en otro estado`);
    return partes.join(", ") || "0";
}

// Resumen legible de lo que se liberaría y de lo que lo impide.
function explicarReinicio(r) {

    const grupos = r?.por_sorteo || [];

    const seLiberarian = grupos
        .filter(g => g.clase === "liberable")
        .map(g => `${describirGrupo(g)} — ${g.nombre_evento ? `sorteo «${g.nombre_evento}»` : "sin sorteo asociado"}`);

    const bloqueos = grupos
        .filter(g => String(g.clase).startsWith("protegido"))
        .map(g => `${describirGrupo(g)} ${NOMBRE_CLASE[g.clase] || "protegidos"}${g.nombre_evento ? ` «${g.nombre_evento}»` : ""}`);

    // Bloqueados a mano que se conservan (no se liberan sin elegirlo).
    const conservados = grupos.filter(g => g.clase === "conservado").reduce((n, g) => n + (g.otros || 0), 0);
    const seConservan = conservados ? [`${conservados} número(s) bloqueados a mano se conservan tal cual.`] : [];

    return { seLiberarian, bloqueos, seConservan };

}

// sorteo: { id, tabla, liberarBloqueados } (o la fila del sorteo, con config).
async function llamar(usuarioId, sorteo, { huella = null, aplicar }) {

    const liberarBloqueados = sorteo.liberarBloqueados ?? sorteo.config?.tabla?.liberar_bloqueados === true;

    const { data, error } = await supabase.rpc("reiniciar_tabla_cliente", {
        p_usuario: usuarioId,
        p_tabla: sorteo.tabla,
        p_huella: huella,
        p_sorteo: sorteo.id || null,
        p_aplicar: aplicar,
        p_liberar_bloqueados: liberarBloqueados === true
    });

    if (error) {
        if (SIN_MIGRACION.has(error.code)) return { ok: false, motivo: "migracion_pendiente", migracion: "030_reinicio_tabla_seguro.sql" };
        console.error("❌ [SORTEOS] error en el reinicio de la tabla:", error.code || error.message);
        return { ok: false, motivo: "error_supabase" };
    }

    return { ok: true, data };

}

// Vista previa: qué se liberaría y si es posible. Solo lectura.
async function revisarReinicio(usuarioId, sorteo) {

    const r = await llamar(usuarioId, sorteo, { aplicar: false });
    if (!r.ok) return r;

    const { seLiberarian, bloqueos, seConservan } = explicarReinicio(r.data);

    return {
        ok: true,
        data: {
            posible: r.data.ok === true,
            huella: r.data.huella,
            liberables: r.data.liberables || 0,
            protegidos: r.data.protegidos || 0,
            conservados: r.data.conservados || 0,
            liberar_bloqueados: sorteo.config?.tabla?.liberar_bloqueados === true,
            se_liberarian: seLiberarian,
            se_conservan: seConservan,
            bloqueos
        }
    };

}

// Aplica el reinicio SOLO si la tabla sigue igual que en la vista previa.
async function aplicarReinicio(usuarioId, sorteo, huella) {

    if (!huella) return { ok: false, motivo: "confirmacion_requerida" };

    const r = await llamar(usuarioId, sorteo, { huella, aplicar: true });
    if (!r.ok) return r;

    if (r.data.ok !== true) {
        const { bloqueos } = explicarReinicio(r.data);
        return { ok: false, motivo: r.data.motivo === "tabla_cambio" ? "tabla_cambio" : "reinicio_bloqueado", bloqueos };
    }

    return { ok: true, data: { archivados: r.data.archivados || 0 } };

}

module.exports = {
    revisarReinicio,
    aplicarReinicio,
    explicarReinicio
};
