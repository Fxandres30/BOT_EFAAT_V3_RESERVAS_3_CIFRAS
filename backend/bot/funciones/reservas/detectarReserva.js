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
// Reacción ✅/❌ sobre el mensaje del cliente (se añade a la respuesta, no la
// cambia). Ver reaccionReserva.js.
const { decidirReaccion } = require("./reaccionReserva");
const { verificarHoraCierre } = require("../eventos/lifecycle/verificarHoraCierre");

// ¿El sorteo todavía acepta reservas? No, si ya se cerró (activo=false o
// estado "cerrado", ver cerrarEvento.js) o si ya pasó su hora de cierre:
// cuando WhatsApp no confirma el cierre del grupo, la fila sigue activo=true
// mientras el worker reintenta, y sin esta comprobación los clientes
// podían seguir reservando. Mismo criterio de hora que el worker
// (verificarHoraCierre: un sorteo de un día posterior todavía no cierra).
// "abierto=false" con activo=true NO bloquea: es una apertura fallida que
// el worker reconcilia, el sorteo sigue vigente.
function sorteoAceptaReservas(evento, ahora = new Date()) {

    if (!evento) return false;

    if (evento.activo === false || evento.estado === "cerrado") return false;

    return !verificarHoraCierre(evento, ahora);

}

async function detectarReserva({

    evento,
    texto,
    usuario,
    lib

}) {

    if (!sorteoAceptaReservas(evento)) {
        console.log("⛔ Reserva ignorada: el sorteo ya no acepta reservas (cerrado o pasada la hora de cierre).");
        return null;
    }

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

🔒 Ocupados: ${formatearListaNumeros(resultado.ocupadosPorOtros.map(n => n.numero))}`,

            reaccion: decidirReaccion({ solicitados: numeros, resultado })

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

        usuario,

        reaccion: decidirReaccion({ solicitados: numeros, resultado, reservados: reserva.map(r => r.numero) })

    };

}

module.exports = {

    detectarReserva,
    sorteoAceptaReservas

};