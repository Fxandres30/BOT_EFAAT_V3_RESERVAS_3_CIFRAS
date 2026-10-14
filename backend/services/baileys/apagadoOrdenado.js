// ==========================================================================
// apagadoOrdenado.js — al detener el proceso (PM2 envía SIGINT; también
// SIGTERM), suelta los leases de las sesiones que tenía ESTE proceso.
//
// CORRECCIÓN: antes el proceso moría sin liberar sus leases. El proceso nuevo
// arrancaba antes de que vencieran (TTL 20 s), los veía "ocupados por otra
// instancia" y no creaba los sockets: el bot quedaba sin escuchar hasta
// reconectar a mano.
//
// Seguridad:
//   - Nunca hace logout: las credenciales de WhatsApp no se tocan.
//   - Saca cada socket del Map ANTES de cerrarlo: el guard de estados.js
//     ignora el "close" de un socket que ya no está en el Map, así NO se
//     escribe "desconectado" en Supabase y la sesión se restaura al arrancar.
//   - Tope de tiempo (1,4 s) inferior al kill_timeout por defecto de PM2.
// ==========================================================================

const TOPE_MS = 1400;

function instalarApagadoOrdenado({ manager, lease, salir = (codigo) => process.exit(codigo) } = {}) {

    let apagando = false;

    async function apagar(senal) {

        if (apagando) return;
        apagando = true;

        const sesiones = lease.sesionesConLeasePropio();
        console.log(`🛑 [APAGADO] ${senal}: soltando ${sesiones.length} lease(s) sin cerrar sesión de WhatsApp...`);

        const tope = setTimeout(() => salir(0), TOPE_MS);
        if (typeof tope.unref === "function") tope.unref();

        try {

            await Promise.all(sesiones.map(async (sessionId) => {

                const sock = manager.get(sessionId);

                if (sock && manager.sockets.get(sessionId) === sock) manager.sockets.delete(sessionId);

                try { if (sock && typeof sock.end === "function") sock.end(undefined); } catch { /* el proceso termina igual */ }

                try { await lease.soltar(sessionId); } catch (err) { console.error(`⚠️ [APAGADO] no se pudo soltar el lease de ${sessionId}:`, err?.message); }

            }));

        } finally {

            clearTimeout(tope);
            salir(0);

        }

    }

    process.on("SIGINT", () => apagar("SIGINT"));
    process.on("SIGTERM", () => apagar("SIGTERM"));

    return { apagar };

}

module.exports = { instalarApagadoOrdenado };
