const supabase = require("../../lib/supabase");

const procesarReserva =
require("../services/reservas/procesarReserva");

async function reservaWorker() {

    console.log("🚀 Worker de reservas iniciado");

    setInterval(async () => {

        try {

            const { data, error } = await supabase

                .from("mensajes_grupos_sorteos")

                .select("*")

                .eq("worker", "reserva")

                .eq("estado", "pendiente")

                .limit(20);

            if (error) {

                console.log(error);

                return;

            }

            if (!data?.length)
                return;

            for (const mensaje of data) {

                try {

                    await procesarReserva(mensaje);

                }

                catch (err) {

                    console.log(err);

                }

            }

        }

        catch (err) {

            console.log(err);

        }

    }, 1000);

}

module.exports = {

    reservaWorker

};