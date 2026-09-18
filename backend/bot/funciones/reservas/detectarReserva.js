const { validarTextoReserva } = require("./validarTextoReserva");
const { extraerNumeros, validarFormatoNumero } = require("./extraerNumeros");
const { consultarReservas } = require("./consultarReservas");
const { validarReservas } = require("./validarReservas");
const { reservarNumeros } = require("./reservarNumeros");
const { actualizarEvento } = require("./actualizarEvento");
// SOLO presentación: mismo formateador central de listas de números que ya
// usan plantillaMensaje.js y resolverConsulta.js ("( 27 )" / "( 27 - 45 )").
// No decide ni cambia nada de negocio — únicamente da forma al texto de
// "mensaje" que ya se construía aquí.
const { formatearListaNumeros } = require("../../ai/gramatica");

async function detectarReserva({

    evento,
    texto,
    usuario,
    lib

}) {

    if (!validarTextoReserva(texto)) {
        return null;
    }

    // La cantidad de cifras la decide la configuración real del evento
    // (eventos_bot.cifras). Si no viene, extraerNumeros usa 2 por defecto
    // (comportamiento previo).
    const numerosExtraidos = extraerNumeros(texto, evento?.cifras);

    // Defensa en profundidad (auditoría "reservas por número de cifras"):
    // no confiar en que extraerNumeros() sea la única puerta de entrada.
    // Cualquier candidato cuyo formato textual no tenga EXACTAMENTE las
    // cifras configuradas ("5" en un evento de 2 cifras) se descarta aquí
    // también, antes de consultar/escribir Supabase.
    const numeros = numerosExtraidos.filter(n => validarFormatoNumero(n, evento?.cifras));

    if (!numeros.length) {
        return null;
    }

    const reservas = await consultarReservas(evento, numeros);

    const resultado = validarReservas(

        reservas,

        usuario

    );

    // ===============================
    // Todos ya son míos
    // ===============================

    if (

        resultado.disponibles.length === 0 &&

        resultado.ocupadosPorOtros.length === 0 &&

        resultado.yaSonMios.length > 0

    ) {

        return null;

    }

    // ===============================
    // Todos ocupados
    // ===============================

    if (

        resultado.disponibles.length === 0 &&

        resultado.ocupadosPorOtros.length > 0

    ) {

        return {

            ok: false,

            mensaje:
`❌ Los números solicitados ya están ocupados.

🔒 Ocupados: ${formatearListaNumeros(resultado.ocupadosPorOtros.map(n => n.numero))}`

        };

    }

    // ===============================
    // Reservar disponibles
    // ===============================

    const reservados =
        resultado.disponibles.map(n => n.numero);

    const reserva = await reservarNumeros({

        evento,

        numeros: reservados,

        usuario,

        comprador: usuario?.nombre,

        contacto: usuario?.telefono,

        lib

    });

    if (!reserva || reserva.length === 0) {

        return {

            ok: false,

            mensaje:
"❌ No fue posible realizar la reserva. Intenta nuevamente."

        };

    }

    await actualizarEvento(evento);

    const ocupados =
        resultado.ocupadosPorOtros.map(n => n.numero);

    let mensaje = "✅ Reserva realizada correctamente.\n\n";

    mensaje += `🎟️ Reservados: ${formatearListaNumeros(reservados)}`;

    if (ocupados.length) {

        mensaje += `\n\n⚠️ Ya estaban ocupados: ${formatearListaNumeros(ocupados)}`;

    }

    return {

        ok: true,

        reservados,

        ocupados,

        mensaje,

        usuario

    };

}

module.exports = {

    detectarReserva

};