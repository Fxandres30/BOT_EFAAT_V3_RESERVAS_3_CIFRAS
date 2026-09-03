// Pruebas de la cola de operaciones IQ de grupo. Sin Supabase ni Baileys
// reales: se le pasan funciones-operación controladas.
// Ejecutar: node services/baileys/_test_groupQueue.js

process.env.GROUP_QUEUE_DELAY_MS = "5";
process.env.GROUP_QUEUE_BACKOFF_MS = "5";
process.env.GROUP_QUEUE_BACKOFF_MAX_MS = "40";
process.env.GROUP_QUEUE_MAX_RETRIES = "6";

const { groupSettingUpdate, _estado } = require("./groupQueue");

let ok = 0, fail = 0;
const A = (c, m) => { c ? (ok++, console.log("✅", m)) : (fail++, console.log("❌", m)); };

// Socket falso con comportamiento programable por grupo.
function makeSock(handler) {
    let enVuelo = 0;
    let maxEnVuelo = 0;
    const orden = [];
    return {
        _maxEnVuelo: () => maxEnVuelo,
        _orden: () => orden,
        async groupSettingUpdate(grupoId, ajuste) {
            enVuelo++;
            maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
            try {
                await new Promise(r => setTimeout(r, 3));
                const res = await handler(grupoId, ajuste);
                orden.push(grupoId);
                return res;
            } finally {
                enVuelo--;
            }
        }
    };
}

const G = ["G1@g.us", "G2@g.us", "G3@g.us", "G4@g.us", "G5@g.us"];

(async () => {

    // ===== CASO 1: WhatsApp acepta todos -> 5/5 =====
    console.log("\n=== CASO 1: 5 grupos, todos OK ===");
    {
        const sock = makeSock(async () => ({ success: true }));
        const res = await Promise.allSettled(G.map(g => groupSettingUpdate(sock, g, "announcement")));
        A(res.every(r => r.status === "fulfilled"), "5/5 resueltos OK");
        A(sock._maxEnVuelo() === 1, "concurrencia 1 (nunca 2 IQ a la vez)");
        A(JSON.stringify(sock._orden()) === JSON.stringify(G), "FIFO: orden de ejecución == orden de llegada");
    }

    // ===== CASO 2: rate-overlimit tras 2, luego se recupera =====
    console.log("\n=== CASO 2: rate-overlimit tras 2, recupera -> 5/5 ===");
    {
        let n = 0;
        let ventanaLimite = true;
        // Los 2 primeros IQ pasan; a partir del 3º devuelve rate-overlimit
        // hasta que "se recupera" a los 250ms.
        setTimeout(() => { ventanaLimite = false; }, 250);
        const sock = makeSock(async (g) => {
            n++;
            if (n > 2 && ventanaLimite) {
                const e = new Error("rate-overlimit"); e.data = 429; throw e;
            }
            return { success: true };
        });
        const t0 = Date.now();
        const res = await Promise.allSettled(G.map(g => groupSettingUpdate(sock, g, "announcement")));
        A(res.every(r => r.status === "fulfilled"), "5/5 terminan OK tras esperar+reintentar");
        A(sock._orden().length === 5, "los 5 grupos se ejecutaron realmente");
        A(Date.now() - t0 >= 200, "hubo espera real (backoff) antes de completar");
        A(sock._maxEnVuelo() === 1, "concurrencia 1 durante los reintentos");
    }

    // ===== CASO 3: el grupo 3 falla definitivamente (no rate-limit) =====
    console.log("\n=== CASO 3: G3 falla definitivo, G4/G5 continúan ===");
    {
        const sock = makeSock(async (g) => {
            if (g === "G3@g.us") {
                const e = new Error("not-authorized"); e.data = 403; throw e;
            }
            return { success: true };
        });
        const res = await Promise.allSettled(G.map(g => groupSettingUpdate(sock, g, "announcement")));
        const byG = Object.fromEntries(G.map((g, i) => [g, res[i].status]));
        A(byG["G1@g.us"] === "fulfilled", "G1 OK");
        A(byG["G2@g.us"] === "fulfilled", "G2 OK");
        A(byG["G3@g.us"] === "rejected", "G3 FAILED (error real propagado, no oculto)");
        A(byG["G4@g.us"] === "fulfilled", "G4 OK (un fallo NO mata los siguientes)");
        A(byG["G5@g.us"] === "fulfilled", "G5 OK");
        A(res[2].reason && /not-authorized/.test(res[2].reason.message), "el error de G3 llega tal cual al caller");
    }

    // ===== CASO 6: muchas solicitudes simultáneas -> concurrencia 1 =====
    console.log("\n=== CASO 6: 20 solicitudes simultáneas ===");
    {
        const sock = makeSock(async () => ({ success: true }));
        const muchas = Array.from({ length: 20 }, (_, i) => `X${i}@g.us`);
        const res = await Promise.allSettled(muchas.map(g => groupSettingUpdate(sock, g, "announcement")));
        A(res.every(r => r.status === "fulfilled"), "20/20 OK");
        A(sock._maxEnVuelo() === 1, "concurrencia 1 con 20 en paralelo");
        A(JSON.stringify(sock._orden()) === JSON.stringify(muchas), "FIFO con 20 simultáneas");
        A(_estado().enCola === 0 && _estado().procesando === false, "cola vacía y en reposo al terminar");
    }

    // ===== CASO 7: una operación que NUNCA resuelve ni rechaza (cuelgue) =====
    console.log("\n=== CASO 7: operación colgada -> timeout, la cola continúa ===");
    {
        process.env.GROUP_QUEUE_TIMEOUT_MS = "30"; // corto, solo para esta prueba

        let rateLimitLogueado = false;
        const origLog = console.log;
        console.log = (...a) => { if (String(a[0]).includes("rate-overlimit")) rateLimitLogueado = true; origLog(...a); };

        const sock = makeSock(async (g) => {
            if (g === "GCOLGADO@g.us") {
                return new Promise(() => {}); // nunca resuelve ni rechaza
            }
            return { success: true };
        });

        const t0 = Date.now();
        const res = await Promise.allSettled([
            groupSettingUpdate(sock, "GA@g.us", "announcement"),
            groupSettingUpdate(sock, "GCOLGADO@g.us", "announcement"),
            groupSettingUpdate(sock, "GB@g.us", "announcement"),
            groupSettingUpdate(sock, "GC@g.us", "announcement")
        ]);
        const dt = Date.now() - t0;

        console.log = origLog;

        A(res[0].status === "fulfilled", "GA (antes de la colgada) OK");
        A(res[1].status === "rejected", "GCOLGADO rechazada por timeout, no queda pendiente para siempre");
        A(/GROUP_QUEUE_TIMEOUT/.test(res[1].reason?.message || ""), "el motivo del rechazo identifica que fue timeout");
        A(res[2].status === "fulfilled" && res[3].status === "fulfilled", "GB y GC (después de la colgada) SÍ se procesan — la cola continúa");
        A(!rateLimitLogueado, "el timeout NO se trató como rate-overlimit (no hubo reintento)");
        A(dt < 500, `la espera fue acotada al timeout configurado, no indefinida (${dt} ms)`);
        A(_estado().procesando === false, "procesando quedó liberado (no se bloqueó la cola)");

        // La cola debe seguir funcionando con normalidad después del cuelgue.
        const post = await groupSettingUpdate(sock, "GD@g.us", "announcement");
        A(post && post.success === true, "tras el cuelgue, la cola sigue aceptando y resolviendo operaciones nuevas");

        delete process.env.GROUP_QUEUE_TIMEOUT_MS; // vuelve al default (20000) para el resto del proceso
    }

    console.log(`\n============================\nTOTAL ${ok + fail}  ✅ ${ok}  ❌ ${fail}\n============================`);
    process.exit(fail ? 1 : 0);

})();
