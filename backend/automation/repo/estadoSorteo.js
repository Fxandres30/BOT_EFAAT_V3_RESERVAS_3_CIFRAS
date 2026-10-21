// ==========================================================================
// automation/repo/estadoSorteo.js — estado REAL de un sorteo justo antes de
// enviar un recordatorio. Solo lectura.
//
// Reutiliza estadoDelSorteo() (sorteoReal.js): la MISMA lectura y
// clasificación de números que usa el cierre automático (libres,
// reservados pendientes de pago, pagados) — no hay un segundo conteo.
// Añade si el grupo está cerrado en WhatsApp (grupos.announce, que
// sincronizarGrupo.js mantiene con cada groups.update): un grupo cerrado
// antes de tiempo no recibe invitaciones a participar.
//
// La decisión de qué recordatorio corresponde la toma
// automation/eventRules.js::decidirRecordatoriosSegunEstado (pura). Vive en
// automation/repo para que scheduler.js acceda a datos solo por sus repos.
// Nunca lanza: ante cualquier error devuelve { ok: false }.
// ==========================================================================

const supabase = require("../../lib/supabase");
const { estadoDelSorteo } = require("../../bot/funciones/eventos/sorteoReal");

// Sin fila del grupo o cualquier error al leerla: no se asume cerrado (el
// estado de los números sigue decidiendo).
async function grupoCerradoEnWhatsapp(grupoId) {

    try {

        const { data, error } = await supabase
            .from("grupos")
            .select("announce")
            .eq("jid", grupoId)
            .maybeSingle();

        return !error && data?.announce === true;

    } catch {

        return false;

    }

}

async function leerEstadoParaRecordatorios(evento, grupoId) {

    try {

        const estado = await estadoDelSorteo(evento);

        if (!estado.ok) return { ok: false, error: estado.error };

        return {
            ok: true,
            total: estado.total,
            libres: estado.libres,
            reservados: estado.reservados,
            pagados: estado.pagados,
            grupoCerrado: await grupoCerradoEnWhatsapp(grupoId)
        };

    } catch (err) {

        return { ok: false, error: err?.message || String(err) };

    }

}

module.exports = {
    leerEstadoParaRecordatorios
};
