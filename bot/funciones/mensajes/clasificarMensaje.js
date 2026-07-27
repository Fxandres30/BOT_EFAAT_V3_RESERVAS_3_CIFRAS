const supabase =
require("../../../lib/supabase");

async function clasificarMensaje({

    mensaje,

    ctx

}) {

    let accion = "ninguna";

    let worker = null;

    let estado = "completado";

    const texto =
        (ctx.chat.texto || "")
            .trim()
            .toLowerCase();

    // ==========================
    // Reserva
    // ==========================

    if (/^\d+(?:\s+\d+)*$/.test(texto)) {

        accion = "reserva";

        worker = "reserva";

        estado = "pendiente";

    }

    // ==========================
    // Pago
    // ==========================

    else if (

        texto.includes("pagu") ||

        texto.includes("transfer") ||

        texto.includes("comprobante") ||

        texto.includes("consign")

    ) {

        accion = "pago";

        worker = "pago";

        estado = "pendiente";

    }

    // ==========================
    // Consulta
    // ==========================

    else if (

        texto.startsWith("tabla") ||

        texto.startsWith("saldo") ||

        texto.startsWith("lista")

    ) {

        accion = "consulta";

        worker = "consulta";

        estado = "pendiente";

    }

    // ==========================
    // Comando
    // ==========================

    else if (

        texto.startsWith("/") ||

        texto.startsWith(".")

    ) {

        accion = "comando";

        worker = "comando";

        estado = "pendiente";

    }

    // ==========================
    // Actualizar BD
    // ==========================

    const { error } = await supabase

        .from("mensajes_grupos_sorteos")

        .update({

            accion,

            worker,

            estado,

            clasificado: true

        })

        .eq("id", mensaje.id);

    if (error) {

        console.log(
            "❌ Error clasificando mensaje:",
            error.message
        );

        return;

    }

    console.log(
        `🧠 ${mensaje.id} -> ${accion}`
    );

}

module.exports = {

    clasificarMensaje

};