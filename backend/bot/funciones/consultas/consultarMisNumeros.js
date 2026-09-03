const supabase = require("../../../lib/supabase");

// READ-ONLY. Usa usuario_global_id, el mismo identificador de dueño que
// reservarNumeros.js ya escribe en cada reserva (no se inventa ningún
// criterio nuevo de propiedad). No filtra por evento_id: igual que
// consultarReservas.js y actualizarEvento.js, trata evento.tabla completa
// como el estado vigente (el cierre de evento no resetea las filas).
async function consultarMisNumeros({ evento, usuario }) {

    if (!evento?.tabla || !usuario?.id) {
        return [];
    }

    const { data, error } = await supabase
        .from(evento.tabla)
        .select("numero, estado")
        .eq("usuario_global_id", usuario.id)
        .neq("estado", "libre")
        .order("numero", { ascending: true });

    if (error) {

        console.log("❌ Error consultando mis números:", error.message);

        return [];

    }

    return (data || []).map(r => r.numero);

}

module.exports = {
    consultarMisNumeros
};
