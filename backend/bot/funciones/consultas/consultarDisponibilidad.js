const supabase = require("../../../lib/supabase");

// READ-ONLY. Devuelve la estructura real completa (sin truncar ni inventar
// límites): números disponibles y ocupados, siempre separados. Aísla del
// mismo sorteo real (identidad_evento_real, independiente del grupo) frente
// a otros eventos/tenants que compartan la misma tabla física por rango de
// precio (ver identidadEventoReal.js) — un número LIBRE siempre se ve, y una
// fila sin identidad todavía (dato previo a esta migración) nunca se oculta,
// solo se EXCLUYE lo ya reservado/pagado por un evento distinto.
async function consultarDisponibilidad({ evento }) {

    if (!evento?.tabla) {
        return { numerosDisponibles: [], numerosOcupados: [] };
    }

    let query = supabase
        .from(evento.tabla)
        .select("numero, estado")
        .order("numero", { ascending: true });

    if (evento.identidad_evento_real) {
        query = query.or(
            `identidad_evento_real.eq.${evento.identidad_evento_real},identidad_evento_real.is.null,estado.eq.libre`
        );
    }

    const { data, error } = await query;

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
