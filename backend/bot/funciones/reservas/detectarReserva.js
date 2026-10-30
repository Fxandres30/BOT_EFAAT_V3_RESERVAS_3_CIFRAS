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

    // No se pudo leer la tabla: nunca se afirma que están ocupados.
    if (!reservas) return errorTecnico();

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
        resultado.noDisponibles.length === 0 &&
        resultado.yaSonMios.length > 0
    ) {
        return null;
    }

    // En el orden en que el cliente los pidió (la base los devuelve en otro).
    const enOrden = (lista) => {
        const pedidos = new Set(lista.map(String));
        return numeros.filter(n => pedidos.has(n));
    };

    const ocupadosDe = (r) => [...r.ocupadosPorOtros, ...r.noDisponibles].map(n => n.numero);

    // ===============================
    // Ninguno disponible
    // ===============================
    if (resultado.disponibles.length === 0) {

        const ocupados = enOrden(ocupadosDe(resultado));

        if (ocupados.length === 0) return errorTecnico();

        return todosOcupados(ocupados, decidirReaccion({ solicitados: numeros, resultado }));

    }

    // ===============================
    // Reservar disponibles
    // ===============================
    const candidatos = enOrden(resultado.disponibles.map(n => n.numero));

    const reserva = await reservarNumeros({
        evento,
        numeros: candidatos,
        usuario,
        comprador: usuario?.nombre,
        contacto: usuario?.telefono,
        lib
    }) || [];

    // Lo reservado es lo que el UPDATE devolvió, no lo que se leyó libre:
    // otro pudo tomar un número entre la lectura y la escritura.
    const hechos = new Set(reserva.map(r => String(r.numero)));
    const perdidos = candidatos.filter(n => !hechos.has(n));

    let ocupadosEnCarrera = [];
    let clasificacion = resultado;

    if (perdidos.length) {

        const despues = await consultarReservas(evento, perdidos);
        const relectura = despues ? validarReservas(despues, usuario) : null;

        // Sin relectura, o sin reservar nada y sin que nadie los ocupara: fue
        // un fallo al guardar, no una ocupación.
        if (relectura) {
            ocupadosEnCarrera = ocupadosDe(relectura);
            clasificacion = {
                ...resultado,
                disponibles: resultado.disponibles.filter(n => hechos.has(String(n.numero))),
                ocupadosPorOtros: [...resultado.ocupadosPorOtros, ...relectura.ocupadosPorOtros],
                noDisponibles: [...resultado.noDisponibles, ...relectura.noDisponibles]
            };
        }

        if (hechos.size === 0) {

            if (ocupadosEnCarrera.length === 0) return errorTecnico();

            return todosOcupados(enOrden(ocupadosDe(clasificacion)), decidirReaccion({ solicitados: numeros, resultado: clasificacion }));

        }

    }

    await actualizarEvento(evento);

    const reservados = enOrden([...hechos]);
    const ocupados = enOrden(ocupadosDe(clasificacion));

    const parcial = ocupados.length > 0;

    let mensaje = parcial ? "⚠️ Reserva parcial.\n\n" : "✅ Reserva realizada correctamente.\n\n";

    mensaje += `🎟️ Reservados: ${formatearListaNumeros(reservados)}`;

    if (parcial) {
        mensaje += `\n\n🔒 No se reservaron porque ya están ocupados: ${formatearListaNumeros(ocupados)}\n\nElige otros números.`;
    }

    return {

        ok: true,

        reservados,

        ocupados,

        mensaje,

        usuario,

        reaccion: decidirReaccion({ solicitados: numeros, resultado: clasificacion, reservados })

    };

}

// Ninguno se pudo reservar porque están ocupados.
function todosOcupados(ocupados, reaccion) {
    return {
        ok: false,
        ocupados,
        mensaje:
`❌ No se pudo reservar: ${ocupados.length === 1 ? "ese número ya está ocupado" : "esos números ya están ocupados"}.
🔒 Ocupados: ${formatearListaNumeros(ocupados)}

Elige otros números.`,
        reaccion
    };
}

// Fallo técnico: no se sabe nada de los números, así que no se dice que
// estén ocupados ni se usan esas plantillas (responderResultado.js).
function errorTecnico() {
    return {
        ok: false,
        errorTecnico: true,
        mensaje: "❌ No fue posible procesar tu reserva. Intenta nuevamente."
    };
}

module.exports = {

    detectarReserva,
    sorteoAceptaReservas

};