const { validarTextoReserva } = require("./validarTextoReserva");
const { extraerNumeros } = require("./extraerNumeros");
const { consultarReservas } = require("./consultarReservas");
const { validarReservas } = require("./validarReservas");
const { reservarNumeros } = require("./reservarNumeros");
const { actualizarEvento } = require("./actualizarEvento");

async function detectarReserva({

    evento,
    texto,
    usuario,
    lib

}) {

    if (!validarTextoReserva(texto)) {
        return null;
    }

    const numeros = extraerNumeros(texto);

    if (!numeros.length) {
        return null;
    }

    const reservas = await consultarReservas(evento, numeros);

    const resultado = validarReservas(

        reservas,

        usuario?.telefono,

        lib

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

🔒 Ocupados: ${resultado.ocupadosPorOtros.map(n => n.numero).join(", ")}`

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

    mensaje += `🎟️ Reservados: ${reservados.join(", ")}`;

    if (ocupados.length) {

        mensaje += `\n\n⚠️ Ya estaban ocupados: ${ocupados.join(", ")}`;

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