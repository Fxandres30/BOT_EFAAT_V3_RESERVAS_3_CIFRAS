// ============================================================
// COLA DE OPERACIONES IQ DE GRUPO (WhatsApp / Baileys)
// ============================================================
//
// Motivo: groupSettingUpdate() y groupMetadata() son peticiones IQ sobre
// el WebSocket de WhatsApp. WhatsApp las limita muy agresivamente: unas
// pocas seguidas -> "rate-overlimit". Antes, abrir/cerrar N grupos de un
// evento (o sincronizar varios grupos) lanzaba una ráfaga y a partir de
// ~2 fallaba, sin reintento -> BD y WhatsApp quedaban divergentes.
//
// Esta cola SOLO cubre operaciones IQ de grupo. NO es una cola de
// mensajes (el espaciado de mensajes de texto sigue en services/baileys/
// send.js, sin cambios).
//
// Garantías:
//   1. Concurrencia 1  -> nunca hay dos IQ de grupo en vuelo a la vez.
//   2. Espaciado       -> pausa fija entre operaciones distintas.
//   3. FIFO            -> se ejecutan en orden de llegada.
//   4. rate-overlimit  -> backoff exponencial + reintentos limitados; la
//                         operación NO se pierde. Si se agotan, el error
//                         real se propaga al caller (no se oculta).
//   5. Error normal    -> se propaga inmediatamente (sin reintentar).
//   6. Timeout         -> si una operación no resuelve ni rechaza dentro
//                         de GROUP_QUEUE_TIMEOUT_MS, se rechaza (no se
//                         reintenta como rate-overlimit) y la cola sigue
//                         con la siguiente operación.
//
// Configurable por entorno (valores conservadores por defecto; los de
// delay/retry/backoff NO cambiaron respecto a la fase anterior):
//   GROUP_QUEUE_DELAY_MS        (1200)  espaciado entre operaciones
//   GROUP_QUEUE_MAX_RETRIES     (4)     reintentos ante rate-overlimit
//   GROUP_QUEUE_BACKOFF_MS      (2000)  backoff base (x2 por intento)
//   GROUP_QUEUE_BACKOFF_MAX_MS  (30000) tope del backoff
//   GROUP_QUEUE_TIMEOUT_MS      (20000) tope de espera por operación (NUEVO)

const cfg = {
    delayMs: () => num(process.env.GROUP_QUEUE_DELAY_MS, 1200),
    maxReintentos: () => num(process.env.GROUP_QUEUE_MAX_RETRIES, 4),
    backoffBaseMs: () => num(process.env.GROUP_QUEUE_BACKOFF_MS, 2000),
    backoffMaxMs: () => num(process.env.GROUP_QUEUE_BACKOFF_MAX_MS, 30000),
    timeoutMs: () => num(process.env.GROUP_QUEUE_TIMEOUT_MS, 20000)
};

function num(v, def) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : def;
}

function dormir(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Identifica de forma robusta el rate-limit de WhatsApp/Baileys.
// Compatible con el criterio previo de sincronizarGrupo.js
// (err.message.includes("rate-overlimit")).
function esRateOverlimit(err) {

    if (!err) return false;

    if (err.data === 429 || err.data === "rate-overlimit") return true;

    const code = err.output?.statusCode ?? err.statusCode ?? err.code;
    if (code === 429 || code === "429") return true;

    const txt = [
        err.message,
        err.output?.payload?.message,
        err.output?.payload?.error,
        typeof err.reason === "string" ? err.reason : null
    ].filter(Boolean).join(" ").toLowerCase();

    return txt.includes("rate-overlimit")
        || txt.includes("rate overlimit")
        || txt.includes("too many requests");
}

function backoffPara(intento) {
    const base = cfg.backoffBaseMs();
    const espera = base * Math.pow(2, Math.max(0, intento - 1));
    return Math.min(espera, cfg.backoffMaxMs());
}

// Techo de espera por intento de operación. Si sock.groupSettingUpdate()/
// groupMetadata() nunca resolviera ni rechazara (p. ej. IQ colgada sin que
// Baileys la rechace), esto evita que `procesando` quede en true para
// siempre y bloquee TODA la cola. NO cancela la operación real (no es
// posible en JS) — solo deja de esperarla y libera la cola; si la
// operación real resuelve más tarde, su resultado simplemente se ignora.
// Un timeout NUNCA se trata como rate-overlimit (mensaje propio, no
// confundible con "rate-overlimit"): se reintenta solo si la causa real
// del error es explícitamente rate-overlimit.
function conTimeout(promesa, ms) {

    if (!ms || ms <= 0) return promesa;

    let idTimeout;

    const timeout = new Promise((_, reject) => {

        idTimeout = setTimeout(() => {

            const err = new Error(`GROUP_QUEUE_TIMEOUT: la operación superó ${ms} ms sin resolver`);
            err.isTimeout = true;

            reject(err);

        }, ms);

    });

    return Promise.race([promesa, timeout]).finally(() => clearTimeout(idTimeout));

}

// ---- estado de la cola (un único proceso, en memoria) ----
const cola = [];
let procesando = false;

function encolar(operacion, meta = {}) {

    return new Promise((resolve, reject) => {

        cola.push({ operacion, meta, resolve, reject, intentos: 0 });

        arrancar();

    });

}

async function arrancar() {

    if (procesando) return;

    procesando = true;

    try {

        while (cola.length > 0) {

            // FIFO: se mira el primero, no se saca hasta resolver/rechazar.
            const item = cola[0];

            let completado = true;

            try {

                const resultado = await conTimeout(item.operacion(), cfg.timeoutMs());

                item.resolve(resultado);

            } catch (err) {

                if (esRateOverlimit(err) && item.intentos < cfg.maxReintentos()) {

                    item.intentos += 1;

                    const espera = backoffPara(item.intentos);

                    console.log(`[GROUP-QUEUE] rate-overlimit en ${item.meta.desc || "op"}${item.meta.grupoId ? " (" + item.meta.grupoId + ")" : ""} — reintento ${item.intentos}/${cfg.maxReintentos()} en ${espera} ms`);

                    completado = false;

                    await dormir(espera);

                } else {

                    // Error real (no rate-limit) o reintentos agotados: se
                    // propaga tal cual. NO se oculta.
                    item.reject(err);

                }

            }

            if (completado) {

                cola.shift();

                if (cola.length > 0) {
                    await dormir(cfg.delayMs());
                }

            }

        }

    } finally {

        procesando = false;

    }

    // Por si algo entró justo al vaciar la cola.
    if (cola.length > 0) {
        arrancar();
    }

}

// ---- envoltorios de las operaciones IQ de grupo ----

function groupSettingUpdate(sock, grupoId, ajuste) {

    return encolar(
        () => sock.groupSettingUpdate(grupoId, ajuste),
        { desc: `groupSettingUpdate(${ajuste})`, grupoId }
    );

}

function groupMetadata(sock, grupoId) {

    return encolar(
        () => sock.groupMetadata(grupoId),
        { desc: "groupMetadata", grupoId }
    );

}

// Solo para pruebas: estado interno de la cola.
function _estado() {
    return { enCola: cola.length, procesando };
}

module.exports = {
    groupSettingUpdate,
    groupMetadata,
    esRateOverlimit,
    _estado
};
