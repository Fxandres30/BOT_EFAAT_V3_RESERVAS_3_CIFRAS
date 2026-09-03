const { workerEventos } = require("../workers/workerEventos");

const intervalos = new Map();

// sessionId cuyo workerEventos sigue en curso ahora mismo. Antes, la cola
// central de IQ de grupo (groupQueue.js) puede hacer que un tick tarde más
// de 30 s (espaciado + backoff); sin esta guarda, el siguiente disparo del
// mismo setInterval podía arrancar un SEGUNDO workerEventos en paralelo
// para la misma sesión. Misma frecuencia, mismo timer, sin listeners
// nuevos — solo se omite el tick si el anterior no ha terminado.
const ejecutando = new Set();

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

        if (ejecutando.has(sessionId)) {

            console.log(`⏭️ Tick de workerEventos (${sessionId}) omitido: el anterior aún está en curso.`);
            return;

        }

        ejecutando.add(sessionId);

        try {

            await workerEventos(sock);

        } catch (error) {

            console.log(`❌ Error en workerEventos (${sessionId})`);
            console.dir(error, { depth: null });

        } finally {

            ejecutando.delete(sessionId);

        }

    }, 30000);

    intervalos.set(sessionId, intervalo);

}

function detenerWorkerEventos(sessionId) {

    if (!intervalos.has(sessionId)) return;

    clearInterval(intervalos.get(sessionId));
    intervalos.delete(sessionId);
    ejecutando.delete(sessionId);

    console.log(`🛑 Worker detenido: ${sessionId}`);

}

module.exports = {
    iniciarWorkerEventos,
    detenerWorkerEventos
};
