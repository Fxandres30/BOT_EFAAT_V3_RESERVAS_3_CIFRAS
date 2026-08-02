const supabase = require("../../../../lib/supabase");
const { procesarEvento } = require("../lifecycle/procesarEvento");

async function workerEventos(sock) {

    try {

        const { data: eventos, error } = await supabase
            .from("eventos_bot")
            .select("*")
            .eq("activo", true);

        if (error) {

            console.error("❌ Error obteniendo eventos");
            console.error(error);

            return;

        }

        if (!eventos || eventos.length === 0) {

            return;

        }

        // Procesar eventos sin imprimir logs cada minuto
        for (const evento of eventos) {

            try {

                await procesarEvento({
                    sock,
                    evento
                });

            } catch (error) {

                console.error(`❌ Error procesando evento ${evento.id}`);
                console.error(error);

            }

        }

    } catch (error) {

        console.error("❌ Error en workerEventos");
        console.error(error);

    }

}

module.exports = {
    workerEventos
};