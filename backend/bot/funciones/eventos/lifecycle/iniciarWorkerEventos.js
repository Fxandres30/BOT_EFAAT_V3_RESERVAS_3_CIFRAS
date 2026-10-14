const { workerEventos } = require("../workers/workerEventos");

// Diagnóstico del ciclo de vida (Paso 0) — solo observa.
const cicloMensaje = require("../../../../diagnostico/cicloMensaje");

// Fase 1 — el worker nunca trabaja con un socket que ya no es el vigente,
// open, de la sesión activa (ver propiedadSesion.js).
const propiedadSesion = require("../../../../services/baileys/propiedadSesion");

const intervalos = new Map();

// sessionId cuyo workerEventos sigue en curso ahora mismo. Antes, la cola
// central de IQ de grupo (groupQueue.js) puede hacer que un tick tarde más
// de 30 s (espaciado + backoff); sin esta guarda, el siguiente disparo del
// mismo setInterval podía arrancar un SEGUNDO workerEventos en paralelo
// para la misma sesión. Misma frecuencia, mismo timer, sin listeners
// nuevos — solo se omite el tick si el anterior no ha terminado.
// sessionId → { desde, ciclo } del tick en curso.
const ejecutando = new Map();

// Señal de salud para el panel (services/baileys/salud.js).
const salud = require("../../../../services/baileys/salud");

// Un tick que no termina en este tiempo (promesa colgada en red) bloquearía
// el worker para siempre en silencio. Pasado el tope se libera la guarda y
// el siguiente disparo vuelve a trabajar; las acciones del worker (abrir y
// cerrar grupos, contadores) comprueban el estado antes de actuar.
const TICK_COLGADO_MS = 5 * 60 * 1000;
let siguienteCiclo = 0;

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

    salud.marcarTickWorker(sessionId, "arranque");

    const intervalo = setInterval(async () => {

        const enCurso = ejecutando.get(sessionId);

        if (enCurso && Date.now() - enCurso.desde < TICK_COLGADO_MS) {

            console.log(`⏭️ Tick de workerEventos (${sessionId}) omitido: el anterior aún está en curso.`);
            return;

        }

        if (enCurso) {

            console.log(`⚠️ Tick de workerEventos (${sessionId}) colgado más de ${TICK_COLGADO_MS / 60000} min: se libera la guarda.`);
            salud.marcarRecuperacion(sessionId, "tick del worker de eventos colgado: guarda liberada");

        }

        if (!propiedadSesion.puedeActuar(sock)) {

            console.log(`⏭️ Tick de workerEventos (${sessionId}) omitido: su socket ya no es el socket activo/open.`);
            return;

        }

        const ciclo = ++siguienteCiclo;

        ejecutando.set(sessionId, { desde: Date.now(), ciclo });

        cicloMensaje.tickWorker("workerEventos", sock);

        salud.marcarTickWorker(sessionId, "inicio");

        try {

            await workerEventos(sock);

        } catch (error) {

            console.log(`❌ Error en workerEventos (${sessionId})`);
            console.dir(error, { depth: null });

        } finally {

            // Solo libera SU guarda: un tick colgado que termina tarde no
            // borra la del tick que lo reemplazó.
            if (ejecutando.get(sessionId)?.ciclo === ciclo) ejecutando.delete(sessionId);

            salud.marcarTickWorker(sessionId, "fin");

        }

    }, 30000);

    intervalos.set(sessionId, intervalo);

}

function detenerWorkerEventos(sessionId) {

    if (!intervalos.has(sessionId)) return;

    clearInterval(intervalos.get(sessionId));
    intervalos.delete(sessionId);
    ejecutando.delete(sessionId);

    salud.marcarTickWorker(sessionId, "detenido");

    console.log(`🛑 Worker detenido: ${sessionId}`);

}

module.exports = {
    iniciarWorkerEventos,
    detenerWorkerEventos
};
