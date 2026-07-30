const supabase = require("../../../../lib/supabase");
const { procesarEvento } = require("../lifecycle/procesarEvento");

async function workerEventos(sock) {

    const { data: eventos, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("activo", true);

    if (error) {

        console.log("❌ Error obteniendo eventos");
        console.dir(error, { depth: null });
        return;

    }

    if (!eventos || eventos.length === 0) {

        return;

    }

    console.log(`📋 Eventos activos: ${eventos.length}`);

    for (const evento of eventos) {

        await procesarEvento({

            sock,
            evento

        });

    }

}

module.exports = {
    workerEventos
};