const { extraerEventos } = require("./extraerEvento");
const { consultarEvento } = require("./consultarEvento");
const { guardarEvento } = require("./guardarEvento");
const { obtenerConfiguracion } = require("./configEvento");

async function detectarEvento(
    sock,
    grupoId,
    texto
) {

    if (!texto)
        return;

    const evento = extraerEventos(texto);

    if (!evento) {

        console.log("❌ No es un evento");

        return;

    }

    const config = obtenerConfiguracion(evento.valor);

    if (!config) {

        console.log("❌ No existe configuración para:", evento.valor);

        return;

    }

    evento.tabla = config.tabla;

    evento.cifras = config.cifras;

    evento.cantidad_numeros = config.cantidad;

    console.log("🎉 Evento detectado");

    const eventoAnterior =
        await consultarEvento(grupoId);

    await guardarEvento({

        sock,

        grupoId,

        evento,

        eventoAnterior

    });

}

module.exports = {
    detectarEvento
};