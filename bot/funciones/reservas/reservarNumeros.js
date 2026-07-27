const supabase = require("../../../lib/supabase");

async function reservarNumeros({

    evento,
    numeros,
    comprador,
    contacto,
    lib

}) {

    const ahora = new Date();

    const fecha = ahora.toISOString().split("T")[0];

    const hora = ahora.toLocaleTimeString("es-CO", {
        hour12: false,
        timeZone: "America/Bogota"
    });

    const { data, error } = await supabase
        .from(evento.tabla)
        .update({

            estado: "reservado",

            comprador,
            contacto,

            grupo_id: evento.grupo_id,
            grupo_nombre: evento.grupo_nombre,

            evento_id: evento.id,

            usuario_id: evento.usuario_id,
            telefono_bot: evento.telefono_bot,

            fecha_reserva: fecha,
            hora_reserva: hora,

            lib

        })
        .in("numero", numeros)
        .eq("estado", "libre")
        .select();

    if (error) {

        console.error(error);

        return [];

    }

    return data;

}

module.exports = {
    reservarNumeros
};