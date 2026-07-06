import { obtenerNumerosValidos } from "../../utils/eventoUtils.js";

export async function notificarEvento(sock, evento) {

    const numeros = obtenerNumerosValidos();

    if (!numeros.length) return;

    const mensaje = `🎯 *EVENTO DETECTADO*

📍 Grupo: ${evento.grupo_id}

🎯 *${evento.nombre_evento}*

🕐 Hora: ${evento.hora_fin}
⏳ Cierre: ${evento.hora_cierre}

💰 Valor: $${evento.valor}

🏆 Premios:
${evento.premios?.length
    ? evento.premios.map(p => `• ${p}`).join("\n")
    : "No definidos"}

━━━━━━━━━━━━━━━━━━`;

    for (const numero of numeros) {

        try {

            await sock.sendMessage(numero, {
                text: mensaje
            });

        } catch (err) {

            console.log(
                `❌ Error notificando a ${numero}:`,
                err.message
            );

        }

    }

    console.log("📲 Evento notificado");

}