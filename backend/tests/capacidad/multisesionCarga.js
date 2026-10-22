// ==========================================================================
// CAPACIDAD (SIMULADA) — N clientes, cada uno con su sesión, a la vez.
//
// ⚠️ SIMULACIÓN. Sockets FALSOS (sin Baileys real ni WhatsApp), Supabase en
// memoria y workers sustituidos por contadores. Mide el coste de NUESTRO
// código de multisesión (manager real, bot/index.js real, listener de
// negocio real de messages.upsert.js, compuerta de ingreso real, leases con
// heartbeat real): NO mide la memoria/CPU de una conexión real de Baileys
// (cifrado Signal, sincronización de grupos, reconexiones de red), ni los
// límites de WhatsApp, ni la base de datos real. Para eso hace falta una
// prueba con conexiones reales en el VPS.
//
// Escalones: 2, 5, 10, 25 y, si son estables, 50 y 100. Por escalón:
//   - tiempo en conectar y activar todas las sesiones;
//   - memoria (heap y RSS) por sesión;
//   - listeners de negocio por socket (debe ser 1), sesiones registradas,
//     workers en marcha y leases con heartbeat (deben ser N);
//   - M mensajes por sesión emitidos a la vez: latencia p50/p95/máx de
//     extremo a extremo (emisión -> manejador) y retardo del event loop;
//   - errores de aislamiento (mensaje procesado con socket o dueño ajeno).
//
//     node --expose-gc backend/tests/capacidad/multisesionCarga.js [mensajesPorSesion=20] [maxSesiones=100]
// ==========================================================================

const path = require("path");
const { monitorEventLoopDelay, performance } = require("perf_hooks");

const { crearEntorno, flush, esperarHasta, acelerarTimers, restaurarTimers } = require("../sesiones/entornoFake");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (rel, exp) => { const abs = r(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

const MENSAJES_POR_SESION = Number(process.argv[2]) || 20;
const MAX_SESIONES = Number(process.argv[3]) || 100;
const ESCALONES = [2, 5, 10, 25, 50, 100].filter(n => n <= MAX_SESIONES);

function gc() { if (global.gc) { global.gc(); global.gc(); } }
const mb = (b) => (b / 1024 / 1024).toFixed(1);
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function montarBot(estado) {
    inyectar("bot/handlers/messageHandler.js", async ({ sock, session, message }) => {
        await new Promise(res => setImmediate(res));
        const t = estado.emitidos.get(message.key.id);
        estado.latencias.push(performance.now() - t.inicio);
        if (session?.sessionId !== t.sessionId || session?.usuarioId !== t.usuarioId || sock !== t.sock) estado.erroresAislamiento++;
        estado.procesados++;
    });
    const contar = (tipo) => ({
        on: (id) => { estado.workers[tipo] = (estado.workers[tipo] || new Set()); if (estado.workers[tipo].has(id)) estado.duplicados++; estado.workers[tipo].add(id); },
        off: (id) => estado.workers[tipo]?.delete(id)
    });
    const w = Object.fromEntries(["eventos", "scheduler", "inactividad", "publicador", "escaner", "identitySync"].map(t => [t, contar(t)]));
    inyectar("bot/events/identitySync.upsert.js", { registerIdentitySync: (_s, id) => w.identitySync.on(id), unregisterIdentitySync: id => w.identitySync.off(id) });
    inyectar("bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js", { iniciarWorkerEventos: s => w.eventos.on(s.context.sessionId), detenerWorkerEventos: id => w.eventos.off(id) });
    inyectar("automation/scheduler.js", { start: s => w.scheduler.on(s.context.sessionId), stop: id => w.scheduler.off(id) });
    inyectar("bot/funciones/inactividad/workerInactividad.js", { iniciarWorkerInactividad: s => w.inactividad.on(s.context.sessionId), detenerWorkerInactividad: id => w.inactividad.off(id) });
    inyectar("sorteos/publicador.js", { iniciarPublicadorSorteos: s => w.publicador.on(s.context.sessionId), detenerPublicadorSorteos: id => w.publicador.off(id) });
    inyectar("bot/funciones/usuarios/escanerIdentidadesLifecycle.js", { iniciarEscanerIdentidades: id => w.escaner.on(id), detenerEscanerIdentidades: id => w.escaner.off(id) });
    for (const m of ["bot/index.js", "bot/events/messages.upsert.js", "services/baileys/propiedadSesion.js", "bot/funciones/mensajes/compuertaIngreso.js"]) delete require.cache[r(m)];
    const iniciarBot = require(r("bot/index.js"));
    iniciarBot();
    return iniciarBot;
}

async function escalon(n) {

    gc();
    const memAntes = process.memoryUsage();

    const ids = Array.from({ length: n }, (_, i) => `s${String(i).padStart(3, "0")}`);
    const sesiones = ids.map((id, i) => ({ id, usuario_id: `cliente-${i}`, nombre: id, estado: "desconectado", activa: false, principal: false, telefono: null }));

    const estado = { emitidos: new Map(), latencias: [], procesados: 0, erroresAislamiento: 0, duplicados: 0, workers: {} };
    const { manager, lease } = crearEntorno({ sesionesIniciales: sesiones });
    const bot = montarBot(estado);

    // Conectar todas a la vez (start + open concurrentes).
    const t0 = performance.now();
    await Promise.all(ids.map(id => manager.start(id)));
    const base = new Map(ids.map(id => [id, manager.get(id).ev.listenerCount("messages.upsert")]));
    for (const id of ids) { const s = manager.get(id); s.user = { id: `${id}:1@s.whatsapp.net` }; s.ev.emit("connection.update", { connection: "open" }); }
    await esperarHasta(() => ids.every(id => manager.isActive(id)) && bot.estadoBot().sesiones.length === n, { maxVueltas: 200000, mensaje: `activar ${n} sesiones` });
    const msConectar = performance.now() - t0;

    gc();
    const memConectadas = process.memoryUsage();

    // Mensajes concurrentes de todas las sesiones a la vez.
    const loop = monitorEventLoopDelay({ resolution: 5 });
    loop.enable();
    const t1 = performance.now();
    let sec = 0;
    for (let k = 0; k < MENSAJES_POR_SESION; k++) {
        for (const [i, id] of ids.entries()) {
            const sock = manager.get(id);
            const msgId = `${id}-${++sec}`;
            estado.emitidos.set(msgId, { inicio: performance.now(), sessionId: id, usuarioId: `cliente-${i}`, sock });
            sock.ev.emit("messages.upsert", {
                type: "notify",
                messages: [{ key: { remoteJid: `grupo-${id}@g.us`, id: msgId, participant: `57${sec}@s.whatsapp.net`, fromMe: false }, message: { conversation: "dame el 05" }, messageTimestamp: Math.floor(Date.now() / 1000) + 5 }]
            });
        }
    }
    const total = n * MENSAJES_POR_SESION;
    await esperarHasta(() => estado.procesados === total, { maxVueltas: 2000000, mensaje: `procesar ${total} mensajes` });
    const msMensajes = performance.now() - t1;
    loop.disable();

    const listenersMal = ids.filter(id => manager.get(id).ev.listenerCount("messages.upsert") - base.get(id) !== 1).length;
    const workersOk = Object.values(estado.workers).every(set => set.size === n);
    const resultado = {
        sesiones: n,
        msConectar: Math.round(msConectar),
        heapMBporSesion: Number(mb((memConectadas.heapUsed - memAntes.heapUsed) / n)),
        rssMB: Number(mb(memConectadas.rss)),
        registradas: bot.estadoBot().sesiones.length,
        leasesConHeartbeat: lease.sesionesConLeasePropio().length,
        listenersIncorrectos: listenersMal,
        workersPorTipoOk: workersOk,
        workersDuplicados: estado.duplicados,
        mensajes: total,
        msgPorSeg: Math.round(total / (msMensajes / 1000)),
        latP50ms: Number(pct(estado.latencias, 0.5).toFixed(2)),
        latP95ms: Number(pct(estado.latencias, 0.95).toFixed(2)),
        latMaxMs: Number(Math.max(...estado.latencias).toFixed(2)),
        loopP99ms: Number((loop.percentile(99) / 1e6).toFixed(2)),
        erroresAislamiento: estado.erroresAislamiento
    };

    // Limpieza: parar todas (suelta leases y heartbeats) antes del siguiente escalón.
    for (const id of ids) await manager.stop(id);
    await flush(20);

    return resultado;

}

(async () => {

    const originales = {};
    for (const m of ["log", "warn", "error", "time", "timeEnd", "dir", "table"]) { originales[m] = console[m]; console[m] = () => {}; }
    acelerarTimers();

    const resultados = [];
    let estable = true;

    for (const n of ESCALONES) {
        if (!estable) break;
        let r1;
        try { r1 = await escalon(n); }
        catch (err) { r1 = { sesiones: n, error: err.message }; }
        resultados.push(r1);
        estable = !r1.error && r1.erroresAislamiento === 0 && r1.listenersIncorrectos === 0 && r1.workersPorTipoOk && r1.workersDuplicados === 0
            && r1.registradas === n && r1.leasesConHeartbeat === n;
    }

    restaurarTimers();
    Object.assign(console, originales);

    console.log(`\nCAPACIDAD SIMULADA (sockets falsos, Supabase en memoria, workers sustituidos) — ${MENSAJES_POR_SESION} mensajes por sesión, gc ${global.gc ? "sí" : "NO (usa --expose-gc)"}\n`);
    console.table(resultados);
    console.log(estable ? "\nTodos los escalones estables." : "\n⚠️ Se detuvo en el primer escalón inestable (ver tabla).");
    process.exit(estable ? 0 : 1);

})();
