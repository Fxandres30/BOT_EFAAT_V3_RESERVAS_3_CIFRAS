const supabase = require("../../../lib/supabase");
const { soloDelCliente } = require("../reservas/filtroCliente");

// READ-ONLY. Devuelve la estructura real completa (sin truncar ni inventar
// límites): números disponibles y ocupados, siempre separados.
//
// Regla de veracidad (30/10/2026): es la cuadrícula del CLIENTE tal como
// está. Un número ocupado lo está aunque sea de otro sorteo, de otro grupo o
// de otra identidad: antes se excluían de la lista los ocupados de un sorteo
// distinto, y una tabla llena por otro sorteo no se veía agotada. Solo es
// disponible lo que está 'libre'; bloqueado y en proceso también ocupan.
//
// Ante un error de lectura (o un evento sin tabla) devuelve errorLectura:
// true. Las listas vacías NO significan «no quedan números»: el llamador
// responde con un mensaje técnico, nunca con un dato.
//
// Esta lectura NO decide si un sorteo terminó: eso es
// eventos/lifecycle/sorteoSinNumerosLibres.js, que mira su propio sorteo.
async function consultarDisponibilidad({ evento }) {

    if (!evento?.tabla) {
        return { numerosDisponibles: [], numerosOcupados: [], errorLectura: true };
    }

    const { data, error } = await soloDelCliente(
        supabase
            .from(evento.tabla)
            .select("numero, estado")
            .order("numero", { ascending: true }),
        evento
    );

    if (error) {

        console.log("❌ Error consultando disponibilidad:", error.message);

        return { numerosDisponibles: [], numerosOcupados: [], errorLectura: true };

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
