const { validarTextoReserva } = require("./validarTextoReserva");
const { extraerNumeros, validarFormatoNumero } = require("./extraerNumeros");
const { consultarReservas } = require("./consultarReservas");
const { clasificarSolicitud } = require("./estadoNumeros");
const { reservarNumerosDetallado } = require("./reservarNumeros");
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

// Resultado final de cada número pedido (uno y solo uno por número):
//   reservado    -> el UPDATE lo devolvió: quedó reservado para el cliente.
//   ocupado      -> otra persona, otro sorteo o tomado durante la operación.
//   propio       -> ya era del cliente en este sorteo.
//   bloqueado / en_proceso.
//   sin_registro / duplicado / desconocido -> no disponible (integridad).
//   no_guardado  -> estaba libre pero no se pudo guardar ni confirmar
//                   (error de escritura o de relectura). Nunca se presenta
//                   como ocupado ni como reservado.
const LISTAS = {
    reservados: ["reservado"],
    ocupados: ["ocupado"],
    yaTuyos: ["propio"],
    bloqueados: ["bloqueado"],
    enProceso: ["en_proceso"],
    noDisponibles: ["sin_registro", "duplicado", "desconocido"],
    noGuardados: ["no_guardado"]
};

const CLASES_FINALES = new Set(Object.values(LISTAS).flat());

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

    const filas = await consultarReservas(evento, numeros);

    // No se pudo leer la tabla: nunca se afirma que están ocupados.
    if (!filas) return errorTecnico();

    const clases = clasificarSolicitud({ numeros, filas, evento, usuario });

    const integridad = numeros.filter(n => LISTAS.noDisponibles.includes(clases.get(n)));
    if (integridad.length) {
        console.warn(`⚠️ [RESERVAS] números sin una fila válida en ${evento.tabla} (cliente ${evento.usuario_id}): ${integridad.map(n => `${n}=${clases.get(n)}`).join(", ")}`);
    }

    // ===============================
    // Reservar los libres
    // ===============================
    const libres = numeros.filter(n => clases.get(n) === "libre");
    const hechos = new Set();

    if (libres.length) {

        const escritura = await reservarNumerosDetallado({
            evento,
            numeros: libres,
            usuario,
            comprador: usuario?.nombre,
            contacto: usuario?.telefono,
            lib
        });

        // Contacto bloqueado por el cliente (bloqueo hecho mientras la reserva
        // estaba en curso; el dispatcher ya descarta sus mensajes): no se
        // reservó nada y a un bloqueado no se le responde.
        if (escritura.contactoBloqueado) return null;

        // Lo reservado es lo que el UPDATE devolvió, no lo que se leyó libre:
        // otro pudo tomar un número entre la lectura y la escritura.
        for (const fila of escritura.filas) hechos.add(String(fila.numero));
        for (const n of hechos) clases.set(n, "reservado");

        const perdidos = libres.filter(n => !hechos.has(n));

        if (perdidos.length) {

            // Se relee para decir la verdad de cada uno. Si sigue libre (falló
            // la escritura) o no se pudo releer, NO quedó reservado y tampoco
            // se sabe que esté ocupado.
            const despues = await consultarReservas(evento, perdidos);
            const relectura = despues ? clasificarSolicitud({ numeros: perdidos, filas: despues, evento, usuario }) : null;

            for (const n of perdidos) {
                const clase = relectura?.get(n);
                clases.set(n, !clase || clase === "libre" ? "no_guardado" : clase);
            }

        }

    }

    // Ningún número puede quedar sin clasificación final.
    for (const n of numeros) {
        if (!CLASES_FINALES.has(clases.get(n))) {
            console.error(`❌ [RESERVAS] número ${n} sin clasificación final (${clases.get(n)}): se informa como no reservado.`);
            clases.set(n, "no_guardado");
        }
    }

    // En el orden en que el cliente los pidió (la base los devuelve en otro).
    const lista = (nombre) => numeros.filter(n => LISTAS[nombre].includes(clases.get(n)));

    const r = Object.fromEntries(Object.keys(LISTAS).map(nombre => [nombre, lista(nombre)]));

    // Todo falló al guardar o al confirmar: mismo mensaje técnico de siempre.
    if (r.noGuardados.length === numeros.length) return errorTecnico();

    if (r.reservados.length) await actualizarEvento(evento);

    const reaccion = decidirReaccion({
        solicitados: numeros,
        resultado: {
            disponibles: libres.map(numero => ({ numero })),
            ocupadosPorOtros: r.ocupados.map(numero => ({ numero }))
        },
        reservados: r.reservados
    });

    // Las plantillas del panel solo saben decir «reservados» y «ocupados».
    // Lo que ya era del cliente se añade después de la plantilla
    // (textoAdicional); cualquier otro estado (bloqueado, en proceso, no
    // disponible, no guardado) solo lo cuenta bien el mensaje fijo, que
    // enumera cada número. Sin reservados ni ocupados no hay plantilla que
    // aplique.
    const otrosEstados = r.bloqueados.length + r.enProceso.length + r.noDisponibles.length + r.noGuardados.length;
    const soloMensajeFijo = otrosEstados > 0 || (r.reservados.length === 0 && r.ocupados.length === 0);

    return {

        ok: r.reservados.length > 0,

        ...r,

        mensaje: construirMensaje(r, numeros.length),

        ...(r.reservados.length ? { usuario } : {}),

        reaccion,

        soloMensajeFijo,

        textoAdicional: r.yaTuyos.length ? lineaYaTuyos(r.yaTuyos) : ""

    };

}

const enSingular = (lista) => lista.length === 1;

function lineaYaTuyos(lista) {
    return `✅ Ya ${enSingular(lista) ? "es tuyo" : "son tuyos"}: ${formatearListaNumeros(lista)}`;
}

// Mensaje fijo: TODOS los números pedidos, cada uno en su grupo real.
function construirMensaje(r, total) {

    const partes = [];

    if (r.reservados.length) {

        const completa = r.reservados.length + r.yaTuyos.length === total;

        partes.push(`${completa ? "✅ Reserva realizada correctamente." : "⚠️ Reserva parcial."}\n\n🎟️ Reservados: ${formatearListaNumeros(r.reservados)}`);

        if (r.ocupados.length) {
            partes.push(`🔒 No se reservaron porque ya están ocupados: ${formatearListaNumeros(r.ocupados)}`);
        }

    } else if (r.ocupados.length) {

        partes.push(`❌ No se pudo reservar: ${enSingular(r.ocupados) ? "ese número ya está ocupado" : "esos números ya están ocupados"}.\n🔒 Ocupados: ${formatearListaNumeros(r.ocupados)}`);

    }

    if (r.yaTuyos.length) partes.push(lineaYaTuyos(r.yaTuyos));

    if (r.bloqueados.length) {
        const uno = enSingular(r.bloqueados);
        partes.push(`⛔ ${uno ? "Está bloqueado" : "Están bloqueados"} y no se ${uno ? "puede" : "pueden"} reservar por ahora: ${formatearListaNumeros(r.bloqueados)}`);
    }

    if (r.enProceso.length) {
        const uno = enSingular(r.enProceso);
        partes.push(`⏳ ${uno ? "Está" : "Están"} en proceso y no se ${uno ? "puede" : "pueden"} reservar por ahora: ${formatearListaNumeros(r.enProceso)}`);
    }

    if (r.noDisponibles.length) {
        partes.push(`🚫 No ${enSingular(r.noDisponibles) ? "está disponible" : "están disponibles"}: ${formatearListaNumeros(r.noDisponibles)}`);
    }

    if (r.noGuardados.length) {
        const uno = enSingular(r.noGuardados);
        partes.push(`⚠️ No se ${uno ? "pudo" : "pudieron"} reservar por un problema técnico: ${formatearListaNumeros(r.noGuardados)}. Intenta de nuevo con ${uno ? "ese número" : "esos números"}.`);
    }

    if (r.ocupados.length + r.bloqueados.length + r.enProceso.length + r.noDisponibles.length > 0) {
        partes.push("Elige otros números.");
    }

    return partes.join("\n\n");

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
