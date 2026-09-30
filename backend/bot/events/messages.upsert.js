const messageHandler = require("../handlers/messageHandler");

// Diagnóstico PURO de observabilidad (2026-09) — lee `message` tal cual lo
// entrega Baileys, en el punto MÁS TEMPRANO posible (aquí mismo, dentro del
// listener real de messages.upsert), antes de cualquier otra función del
// bot. Solo observa: nunca modifica `message`, nunca resuelve identidad,
// nunca toca Supabase, nunca cambia el flujo — ver su cabecera para el
// detalle completo. Activado con DEBUG_INCOMING_MESSAGES=true (si está
// apagado, no hace absolutamente nada).
const { diagnosticarMensajeEntranteOriginal } = require("../funciones/mensajes/diagnosticarMensajeEntranteOriginal");

const { enmascararJid } = require("../utils/enmascararJid");
const { maskPhone } = require("../../services/baileys/identidadSesion");

// Diagnóstico del ciclo de vida (Paso 0) — solo observa, inactivo salvo
// DEBUG_MESSAGE_LIFECYCLE=true. Ver diagnostico/cicloMensaje.js.
const cicloMensaje = require("../../diagnostico/cicloMensaje");

// Compuerta de ingreso — identidad estable, duplicados y mensajes
// históricos/recuperados, decidido ANTES del negocio. Ver su cabecera.
const compuertaIngreso = require("../funciones/mensajes/compuertaIngreso");

const listeners = new Map();

function registerMessages(sock, sessionId) {

    unregisterMessages(sessionId);

    const context = sock.context || {};

    // Inicio real de la sesión para el negocio: todo mensaje que ya
    // existía antes de este momento es pasado (ver compuertaIngreso).
    const inicioProcesamientoMs = Date.now();

    const listener = async ({ messages, type, requestId }) => {

        console.log("================================");
        console.log("📨 MESSAGES.UPSERT");
        console.log("TYPE:", type);
        console.log("MENSAJES:", messages?.length || 0);
        console.log("================================");

        if (!messages || messages.length === 0) {
            return;
        }

        for (const message of messages) {

            // Diagnóstico ANTES de cualquier otra cosa — incluso antes del
            // "if (!message.message) continue" de abajo, para poder ver
            // también los mensajes que el bot descarta sin procesar.
            // Envuelto en su propio try/catch internamente: esta llamada
            // nunca puede alterar ni interrumpir el `for` real.
            diagnosticarMensajeEntranteOriginal(message);

            try {

                if (!message.message) {

                    console.log("⏭️ Mensaje vacío, ignorado");

                    continue;

                }

                const traceId = message.key.id;

                // Mismo mensaje entregado dos veces a este proceso (en vuelo
                // o ya decidido): se descarta antes de tocar nada.
                const identidad = compuertaIngreso.identidadMensaje(message);

                if (identidad && !compuertaIngreso.tomarEnMemoria(identidad.clave)) {

                    console.log(`⏭️ [COMPUERTA] mensaje duplicado (ya visto por este proceso), descartado [${traceId}]`);

                    continue;

                }

                const ingreso = compuertaIngreso.clasificarIngreso({

                    message,

                    type,

                    requestId,

                    inicioProcesamientoMs

                });

                const remoto = message.key.remoteJid;

                let tipo = "PRIVADO";

                if (remoto.endsWith("@g.us"))
                    tipo = "GRUPO";

                else if (remoto === "status@broadcast")
                    tipo = "ESTADO";

                else if (remoto.endsWith("@newsletter"))
                    tipo = "NEWSLETTER";

                console.log(`📩 [${tipo}] ${enmascararJid(remoto)} | ${traceId}`);

                console.log(`➡️ ANTES messageHandler [${traceId}]`);

                console.time(`messageHandler-${traceId}`);

                try {

                    await cicloMensaje.ejecutarConTraza(

                        { sock, message, listener: "messages.upsert (negocio)" },

                        () => messageHandler({

                            sock,

                            session: context,

                            message,

                            tipo,

                            ingreso

                        })

                    );

                } finally {

                    if (identidad) compuertaIngreso.liberarEnMemoria(identidad.clave);

                }

                console.timeEnd(`messageHandler-${traceId}`);

                console.log(`✅ DESPUÉS messageHandler [${traceId}]`);

            }

            catch (err) {

                console.error(`❌ Error procesando mensaje [${message.key.id}]`);

                console.error(err);

            }

        }

    };

    sock.ev.on("messages.upsert", listener);

    listeners.set(sessionId, {
        sock,
        listener
    });

    cicloMensaje.marcarListenerNegocio(sock, true);

    console.log(`
═══════════════════════════════════════

🤖 BOT ESCUCHANDO

📱 Número : ${maskPhone(context.telefono) || "Desconocido"}

🆔 Sesión : ${sessionId}

👤 Usuario : ${context.usuarioId || "Sin usuario"}

📡 Listener registrado correctamente

═══════════════════════════════════════
`);

}

function unregisterMessages(sessionId) {

    const data = listeners.get(sessionId);

    if (!data)
        return;

    console.log(`🗑️ Eliminando listener: ${sessionId}`);

    data.sock.ev.off(
        "messages.upsert",
        data.listener
    );

    listeners.delete(sessionId);

    cicloMensaje.marcarListenerNegocio(data.sock, false);

}

module.exports = {

    registerMessages,

    unregisterMessages

};