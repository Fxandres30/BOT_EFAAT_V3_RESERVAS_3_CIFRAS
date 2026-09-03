const supabase = require("../../../../lib/supabase");
const { cerrarGrupo } = require("../grupos/cerrarGrupo");

async function cerrarEvento({

    sock,
    evento,
    motivo

}) {

    if (!evento) return false;

    if (!evento.activo) return true;

    // ============================================================
    // 1. CERRAR EL GRUPO EN WHATSAPP PRIMERO
    // ============================================================
    // Antes se marcaba el evento como cerrado en Supabase ANTES de
    // confirmar WhatsApp. Si WhatsApp devolvía rate-overlimit, la BD
    // quedaba en "cerrado", el worker ya no encontraba el evento
    // (activo=false) y nunca reintentaba -> BD y WhatsApp divergentes
    // para siempre.
    //
    // Ahora: si WhatsApp NO confirma el cierre, NO se toca el evento.
    // Sigue con activo=true y el worker lo reintenta en el próximo ciclo
    // (cerrarGrupo/groupSettingUpdate es idempotente).

    let grupoCerrado = false;

    try {

        grupoCerrado = await cerrarGrupo({
            sock,
            grupoId: evento.grupo_id
        });

    } catch (error) {

        console.log("❌ Error cerrando grupo");
        console.dir(error, { depth: null });

        grupoCerrado = false;

    }

    if (!grupoCerrado) {

        console.log(`⏳ Evento ${evento.id}: WhatsApp no confirmó el cierre del grupo — NO se marca cerrado, se reintentará en el próximo ciclo (activo=true).`);

        return false;

    }

    // ============================================================
    // 2. GRUPO CONFIRMADO CERRADO -> PERSISTIR EL ESTADO
    // ============================================================

    const { error } = await supabase
        .from("eventos_bot")
        .update({

            activo: false,
            abierto: false,
            estado: "cerrado",
            actualizado_en: new Date().toISOString()

        })
        .eq("id", evento.id);

    if (error) {

        console.log("❌ Error cerrando evento");
        console.dir(error, { depth: null });

        return false;

    }

    console.log(`🔒 Evento ${evento.id} cerrado (${motivo})`);

    return true;

}

module.exports = {
    cerrarEvento
};
