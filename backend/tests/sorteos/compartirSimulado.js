// ==========================================================================
// compartirSimulado.js — dependencias de «Compartir» para las pruebas del
// publicador de sorteos programados.
//
// El publicador comparte con las funciones REALES de «Compartir»
// (destinosCompartir.textoParaCompartir y compartirTabla.compartirEnGrupos,
// con su ExecutionGuard). Aquí solo se simulan:
//   - la captura de la imagen (Puppeteer): un PNG fijo;
//   - el socket de WhatsApp: cada imagen enviada se entrega a `enviar()`
//     como { jid, text: caption, image } — el mismo registro que las
//     pruebas ya usaban para sendMessage, así un `sendMessage` que falla en
//     una prueba sigue haciendo fallar el envío del anuncio.
//
// Se carga después de que cada prueba sustituya lib/supabase.js.
// ==========================================================================

const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const PNG_SIMULADO = Buffer.from("\x89PNG-simulado", "binary");

// obtenerEnvio(): la función de envío vigente de la prueba (p. ej. () =>
// d.sendMessage), leída en cada llamada para respetar las sustituciones.
function depsCompartir(obtenerEnvio) {

    const { compartirEnGrupos } = require(path.join(RAIZ, "services/compartirTabla.js"));
    const { textoParaCompartir } = require(path.join(RAIZ, "services/destinosCompartir.js"));

    return {
        capturarImagen: async () => PNG_SIMULADO,
        textoParaCompartir,
        compartirEnGrupos: (args) => compartirEnGrupos({
            ...args,
            sock: {
                ...args.sock,
                sendMessage: async (jid, contenido) => obtenerEnvio()({ sock: args.sock, jid, text: contenido.caption, image: contenido.image })
            }
        })
    };

}

module.exports = { depsCompartir, PNG_SIMULADO };
