const supabase = require("../../../lib/supabase");

async function reservarNumeros({

    evento,
    numeros,
    usuario,
    comprador,
    contacto,
    lib

}) {

    if (!Array.isArray(numeros) || numeros.length === 0) {
        return [];
    }

    const ahora = new Date();

    const fechaReserva = ahora.toLocaleDateString("sv-SE", {
        timeZone: "America/Bogota"
    });

    const horaReserva = ahora.toLocaleTimeString("es-CO", {
        hour12: false,
        timeZone: "America/Bogota"
    });

    const telefono =
        usuario?.telefono ||
        contacto ||
        null;

    const lid =
        usuario?.lid ||
        null;

    const nombre =
        usuario?.nombre ||
        comprador ||
        null;

    const { data, error } = await supabase

        .from(evento.tabla)

        .update({

            estado: "reservado",

            comprador: nombre,

            contacto: telefono,

            usuario_global_id:
                usuario?.id || null,

            telefono,

            lid,

            nombre,

            grupo_id:
                evento.grupo_id,

            grupo_nombre:
                evento.grupo_nombre,

            evento_id:
                evento.id,

            usuario_id:
                evento.usuario_id,

            telefono_bot:
                evento.telefono_bot,

            fecha_reserva:
                fechaReserva,

            hora_reserva:
                horaReserva,

            lib

        })

        .in("numero", numeros)

        .eq("estado", "libre")

        .select();

    if (error) {

        console.error("❌ Error reservando números");
        console.error(error);

        return [];

    }

    if (!data || data.length === 0) {

        console.log("⚠ No se reservó ningún número.");

        return [];

    }

    return data;

}

module.exports = {

    reservarNumeros

};