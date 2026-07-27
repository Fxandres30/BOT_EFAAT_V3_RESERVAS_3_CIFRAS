const { extraerEvento } = require("./extraerEvento");
const { consultarEvento } = require("./consultarEvento");
const { guardarEvento } = require("./guardarEvento");
const { obtenerConfiguracion } = require("./configEvento");

async function detectarEvento(ctx) {

    try {

        const { sock, grupo, textoOriginal } = ctx;

        const grupoId =
            grupo?.remoteJid ||
            ctx.chat.remoteJid;

        console.log("==================================");
        console.log("📨 DETECTAR EVENTO");
        console.log("Grupo:", grupoId);
        console.log("==================================");

        if (!textoOriginal?.trim()) {

            console.log("❌ Texto vacío");
            return null;

        }

        const evento = extraerEvento(textoOriginal);

        if (!evento) {

            console.log("❌ No es un evento");
            return null;

        }

        console.log("🎯 Evento detectado");

        console.table({

            nombre: evento.nombre,
            hora: evento.hora,
            valor: evento.valor,
            premios: evento.premios.length

        });

        const config = obtenerConfiguracion(evento.valor);

        if (!config) {

            console.log("❌ No existe configuración para:", evento.valor);
            return null;

        }

        console.table(config);

        const eventoCompleto = {

            ...evento,

            tabla: config.tabla,
            cifras: config.cifras,
            cantidad_numeros: config.cantidad

        };

        const eventoAnterior = await consultarEvento(grupoId);

        console.log(
            "📋 Evento anterior:",
            eventoAnterior
                ? `${eventoAnterior.nombre_evento} (${eventoAnterior.hora_fin})`
                : "No existe"
        );

        // ===============================
        // GUARDAR EVENTO
        // ===============================

        const eventoGuardado = await guardarEvento({

            sock,
            grupoId,
            evento: eventoCompleto,
            eventoAnterior

        });

        if (!eventoGuardado) {

            console.log("❌ No se pudo guardar el evento");
            return null;

        }

        console.log("✅ Evento guardado correctamente");

        return eventoGuardado;

    } catch (error) {

        console.error("❌ Error detectando evento");
        console.error(error);

        return null;

    }

}

module.exports = {
    detectarEvento
};