const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const SYSTEM_PROMPT = fs.readFileSync(
    path.join(__dirname, "prompts", "efaat.txt"),
    "utf8"
);

const MODEL = process.env.AI_MODEL || "gemini-flash-lite-latest";
const TIMEOUT_MS = 12000;

let client = null;
let clienteVerificado = false;

function obtenerCliente() {

    if (clienteVerificado) {
        return client;
    }

    clienteVerificado = true;

    if (!process.env.GEMINI_API_KEY) {

        console.log("⚠️ IA desactivada: falta GEMINI_API_KEY en .env");

        return null;

    }

    client = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
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

    const gemini = obtenerCliente();

    if (!gemini) {
        return null;
    }

    try {

        const respuesta = await conTimeout(

            gemini.models.generateContent({

                model: MODEL,

                contents: JSON.stringify(contexto),

                config: {

                    systemInstruction: SYSTEM_PROMPT,

                    maxOutputTokens: 300

                }

            }),

            TIMEOUT_MS

        );

        const texto = respuesta?.text?.trim();

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
