const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const SYSTEM_PROMPT = fs.readFileSync(
    path.join(__dirname, "prompts", "efaat.txt"),
    "utf8"
);

const MODEL = process.env.AI_MODEL || "claude-opus-5";
const TIMEOUT_MS = 8000;

let client = null;
let clienteVerificado = false;

function obtenerCliente() {

    if (clienteVerificado) {
        return client;
    }

    clienteVerificado = true;

    if (!process.env.ANTHROPIC_API_KEY) {

        console.log("⚠️ IA desactivada: falta ANTHROPIC_API_KEY en .env");

        return null;

    }

    client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
    });

    return client;

}

function conTimeout(promesa, ms) {

    return Promise.race([

        promesa,

        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error("IA: timeout")),
                ms
            )
        )

    ]);

}

// contexto: objeto plano ya sanitizado (ver bot/ai/contextBuilder.js)
// No debe contener credenciales, tokens ni datos de sesión de WhatsApp.
async function suggestReply(contexto) {

    const anthropic = obtenerCliente();

    if (!anthropic) {
        return null;
    }

    try {

        const respuesta = await conTimeout(

            anthropic.messages.create({

                model: MODEL,

                max_tokens: 300,

                system: SYSTEM_PROMPT,

                output_config: {
                    effort: "low"
                },

                messages: [
                    {
                        role: "user",
                        content: JSON.stringify(contexto)
                    }
                ]

            }),

            TIMEOUT_MS

        );

        if (respuesta.stop_reason === "refusal") {

            console.log("⚠️ IA: respuesta rechazada por políticas de seguridad");

            return null;

        }

        const bloque = respuesta.content.find(
            b => b.type === "text"
        );

        const texto = bloque?.text?.trim();

        if (!texto) {
            return null;
        }

        return { respuesta: texto };

    }

    catch (error) {

        console.log("⚠️ IA: no se pudo generar respuesta —", error.message);

        return null;

    }

}

module.exports = {
    suggestReply
};
