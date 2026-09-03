const supabase = require("../../../lib/supabase");

// READ-ONLY. Devuelve la estructura real completa (sin truncar ni inventar
// límites): números disponibles y ocupados, siempre separados. No filtra
// por evento_id: igual criterio que actualizarEvento.js (que tampoco lo
// hace) para contar libres/reservados/pagados de evento.tabla.
async function consultarDisponibilidad({ evento }) {

    if (!evento?.tabla) {
        return { numerosDisponibles: [], numerosOcupados: [] };
    }

    const { data, error } = await supabase
        .from(evento.tabla)
        .select("numero, estado")
        .order("numero", { ascending: true });

    if (error) {

        console.log("❌ Error consultando disponibilidad:", error.message);

        return { numerosDisponibles: [], numerosOcupados: [] };

    }

    const filas = data || [];

    const numerosDisponibles = filas
        .filter(r => r.estado === "libre")
        .map(r => r.numero);

    const numerosOcupados = filas
        .filter(r => r.estado !== "libre")
        .map(r => r.numero);

    return { numerosDisponibles, numerosOcupados };

}

module.exports = {
    consultarDisponibilidad
};
