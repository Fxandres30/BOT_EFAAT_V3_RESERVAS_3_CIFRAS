const { workerEventos } = require("../workers/workerEventos");

const intervalos = new Map();

function iniciarWorkerEventos(sock) {

    if (!sock?.context?.sessionId) {

        console.log("❌ No existe sessionId para iniciar el worker.");
        return;

    }

    const sessionId = sock.context.sessionId;

    if (intervalos.has(sessionId)) {

        clearInterval(intervalos.get(sessionId));

    }

    console.log(`🕒 Worker de eventos iniciado: ${sessionId}`);

    const intervalo = setInterval(async () => {

        try {

            await workerEventos(sock);

        } catch (error) {

            console.log(`❌ Error en workerEventos (${sessionId})`);
            console.dir(error, { depth: null });

        }

    }, 30000);

    intervalos.set(sessionId, intervalo);

}

function detenerWorkerEventos(sessionId) {

    if (!intervalos.has(sessionId)) return;

    clearInterval(intervalos.get(sessionId));
    intervalos.delete(sessionId);

    console.log(`🛑 Worker detenido: ${sessionId}`);

}

module.exports = {
    iniciarWorkerEventos,
    detenerWorkerEventos
};