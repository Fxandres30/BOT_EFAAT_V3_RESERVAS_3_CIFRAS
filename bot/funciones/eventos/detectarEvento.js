const { extraerEventos } = require("./extraerEvento");
const { consultarEvento } = require("./consultarEvento");
const { guardarEvento } = require("./guardarEvento");
const { obtenerConfiguracion } = require("./configEvento");

async function detectarEvento(sock, grupoId, texto) {

    console.log("==================================");
    console.log("📨 DETECTAR EVENTO");
    console.log("Grupo:", grupoId);
    console.log("Texto:");
    console.log(texto);
    console.log("==================================");

    if (!texto) {

        console.log("❌ Texto vacío");

        return;

    }

    const evento = extraerEventos(texto);

    console.log("🎯 Resultado extraerEventos:", evento);

    if (!evento) {

        console.log("❌ No es un evento");

        return;

    }

    const config = obtenerConfiguracion(evento.valor);

    console.log("⚙ Configuración:", config);

    if (!config) {

        console.log("❌ No existe configuración para:", evento.valor);

        return;

    }

    evento.tabla = config.tabla;
    evento.cifras = config.cifras;
    evento.cantidad_numeros = config.cantidad;

    console.log("🎉 Evento detectado correctamente");

    const eventoAnterior =
        await consultarEvento(grupoId);

    console.log("📋 Evento anterior:", eventoAnterior);

    const guardado = await guardarEvento({

        sock,
        grupoId,
        evento,
        eventoAnterior

    });

    console.log("💾 Resultado guardarEvento:", guardado);

}

module.exports = {
    detectarEvento
};