// Pruebas de consistencia BD <-> WhatsApp para apertura/cierre de grupos.
// Usa el CÓDIGO REAL (cerrarEvento, workerEventos, detectarEvento) con
// lib/supabase y el socket STUBEADOS en memoria. No toca nada real.
// Ejecutar: node bot/funciones/eventos/_test_consistencia_grupos.js

process.env.GROUP_QUEUE_DELAY_MS = "2";
process.env.GROUP_QUEUE_BACKOFF_MS = "2";
process.env.GROUP_QUEUE_BACKOFF_MAX_MS = "20";
process.env.GROUP_QUEUE_MAX_RETRIES = "5";

const path = require("path");
const backend = "c:/Users/PC/BOT_EFAAT_V3/backend";
const stub = (rel, exports) => {
    const p = require.resolve(path.join(backend, rel));
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

// ---------------- estado en memoria ----------------
let TABLA = [];             // filas de eventos_bot
const supabasePath = require.resolve(path.join(backend, "lib/supabase.js"));
// Inyección de fallos controlada para CASO 9 (doble fallo en la escritura
// de abierto=false). Vacía por defecto: no afecta a ningún otro caso.
const fallosUpdateAbiertoFalse = { pendientes: 0 };

function builder() {
    const st = { table: null, op: "select", filters: {} };
    const api = {
        from(t) { st.table = t; return api; },
        select() { st.op = "select"; return api; },
        update(v) { st.op = "update"; st.vals = v; return api; },
        insert(v) { st.op = "insert"; st.vals = v; return api; },
        eq(k, v) { st.filters[k] = v; return api; },
        in(k, v) { st.filters[k] = v; return api; },
        maybeSingle() { return res(); },
        single() { return res(); },
        then(r, j) { return res().then(r, j); }
    };
    function res() {
        if (st.table !== "eventos_bot") return Promise.resolve({ data: null, error: null });
        if (st.op === "select") {
            let rows = TABLA.slice();
            for (const [k, v] of Object.entries(st.filters)) rows = rows.filter(r => r[k] === v);
            return Promise.resolve({ data: rows.map(r => ({ ...r })), error: null });
        }
        if (st.op === "update") {
            if (st.vals && st.vals.abierto === false && fallosUpdateAbiertoFalse.pendientes > 0) {
                fallosUpdateAbiertoFalse.pendientes--;
                return Promise.resolve({ data: null, error: { message: "fallo transitorio simulado" } });
            }
            TABLA.filter(r => Object.entries(st.filters).every(([k, v]) => r[k] === v))
                .forEach(r => Object.assign(r, st.vals));
            return Promise.resolve({ data: null, error: null });
        }
        if (st.op === "insert") {
            const row = { id: `EVT-${TABLA.length + 1}`, ...st.vals };
            TABLA.push(row);
            return Promise.resolve({ data: [ { ...row } ], error: null });
        }
        return Promise.resolve({ data: null, error: null });
    }
    return api;
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { from: (t) => builder().from(t) } };

// ---------------- stub de verificarHoraCierre (para CASO 10) ----------------
// Por defecto delega en la lógica REAL (no afecta a ningún caso existente).
// Solo CASO 10 arma una secuencia de valores para un evento puntual, para
// simular con precisión el cruce de la hora de cierre mientras se espera
// turno en la cola, sin depender del reloj real.
const verificarHoraCierrePath = require.resolve(path.join(backend, "bot/funciones/eventos/lifecycle/verificarHoraCierre.js"));
const secuenciasHoraCierre = new Map(); // eventoId -> array de valores a devolver en orden
function verificarHoraCierreReal(evento) {
    if (!evento || !evento.hora_cierre) return false;
    const ahora = new Date();
    const horaActual = ahora.getHours() * 60 + ahora.getMinutes();
    const [h, m] = evento.hora_cierre.split(":").map(Number);
    return horaActual >= (h * 60 + m);
}
require.cache[verificarHoraCierrePath] = {
    id: verificarHoraCierrePath, filename: verificarHoraCierrePath, loaded: true,
    exports: {
        verificarHoraCierre: (evento) => {
            const secuencia = secuenciasHoraCierre.get(evento?.id);
            if (secuencia && secuencia.length) return secuencia.shift();
            return verificarHoraCierreReal(evento);
        }
    }
};

// ---------------- socket falso programable ----------------
function makeSock(policy) {
    return {
        context: { sessionId: "S1", nombreSesion: "S", telefono: "573000000000", estado: "conectado" },
        async groupSettingUpdate(grupoId, ajuste) { return policy(grupoId, ajuste); },
        async groupMetadata(grupoId) { return { id: grupoId, subject: "Grupo " + grupoId, participants: [] }; }
    };
}
const rateErr = () => { const e = new Error("rate-overlimit"); e.data = 429; return e; };

let ok = 0, fail = 0;
const A = (c, m) => { c ? (ok++, console.log("  ✅", m)) : (fail++, console.log("  ❌", m)); };
const quiet = async fn => { const l = console.log, e = console.error, d = console.dir; console.log = console.error = console.dir = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.dir = d; } };

// ---------------- código real ----------------
const { cerrarEvento } = require(path.join(backend, "bot/funciones/eventos/lifecycle/cerrarEvento"));
const { workerEventos } = require(path.join(backend, "bot/funciones/eventos/workers/workerEventos"));

(async () => {

    // ============================================================
    // CASO 4: cerrarEvento con fallo de WhatsApp
    // ============================================================
    console.log("\n=== CASO 4: cerrarEvento con WhatsApp caído ===");
    {
        TABLA = [{ id: "EVT-1", grupo_id: "G1@g.us", tabla: "t1", activo: true, abierto: true, estado: "abierto", hora_cierre: "00:01", cantidad_numeros: 100 }];
        const sockCaido = makeSock(() => { throw rateErr(); });

        const r = await quiet(() => cerrarEvento({ sock: sockCaido, evento: { ...TABLA[0] }, motivo: "hora" }));
        const ev = TABLA[0];

        A(r === false, "cerrarEvento devuelve false cuando WhatsApp no confirma");
        A(ev.activo === true, "el evento SIGUE activo=true (no se marcó falsamente cerrado)");
        A(ev.estado === "abierto", "estado NO pasó a 'cerrado'");

        // siguiente tick del worker: ¿lo encuentra y reintenta?
        let intentos = 0;
        const sockRecupera = makeSock(() => { intentos++; if (intentos <= 1) throw rateErr(); return { success: true }; });
        await quiet(() => workerEventos(sockRecupera));

        A(TABLA[0].activo === false, "el worker VUELVE a encontrar el evento y lo cierra en el siguiente ciclo");
        A(TABLA[0].estado === "cerrado", "estado='cerrado' solo tras confirmar WhatsApp");
    }

    // ============================================================
    // CASO 5: apertura con fallo -> no se reporta éxito
    // ============================================================
    console.log("\n=== CASO 5: apertura con WhatsApp caído (vía detectarEvento) ===");
    {
        // Se stubea SOLO el parseo/persistencia previa; el branch de
        // apertura fallida que se prueba es el REAL de detectarEvento.
        stub("bot/funciones/eventos/extraerEvento", { extraerEvento: () => ({ nombre: "X", hora: "20:00", horaCierre: "20:30", valor: 1000, premios: [] }) });
        stub("bot/funciones/eventos/configEvento", { obtenerConfiguracion: () => ({ tabla: "t", cifras: 2, cantidad: 100 }) });
        stub("bot/funciones/eventos/consultarEvento", { consultarEvento: async () => null });
        stub("bot/funciones/eventos/guardarEvento", { guardarEvento: async () => { TABLA.push({ id: "EVT-OPEN", grupo_id: "GO@g.us", activo: true, abierto: true, estado: "abierto", hora_cierre: "20:30" }); return { ...TABLA[TABLA.length - 1] }; } });

        TABLA = [];
        const { detectarEvento } = require(path.join(backend, "bot/funciones/eventos/detectarEvento"));
        const sockCaido = makeSock(() => { throw rateErr(); });

        const ctx = { sock: sockCaido, grupo: { remoteJid: "GO@g.us" }, chat: { remoteJid: "GO@g.us" }, textoOriginal: "sorteo x" };
        const ev = await quiet(() => detectarEvento(ctx));

        A(!!ev, "detectarEvento NO rompe el flujo: devuelve el evento igual");
        A(ev.abierto === false, "el evento devuelto trae abierto=false (apertura NO reportada como exitosa)");
        A(TABLA[0].abierto === false, "en la BD quedó abierto=false para que el worker reintente");

        // worker reconcilia la apertura cuando WhatsApp se recupera
        const sockOk = makeSock(() => ({ success: true }));
        await quiet(() => workerEventos(sockOk));
        A(TABLA[0].abierto === true, "el worker reconcilia: abre el grupo y marca abierto=true");
    }

    // ============================================================
    // CRITERIO DE ÉXITO: 5 grupos, rate-limit tras 2, recupera -> 5/5
    // ============================================================
    console.log("\n=== ÉXITO: 5 eventos a cerrar, rate-limit tras 2, recupera ===");
    {
        TABLA = [1, 2, 3, 4, 5].map(n => ({ id: `E${n}`, grupo_id: `G${n}@g.us`, tabla: `t${n}`, activo: true, abierto: true, estado: "abierto", hora_cierre: "00:01", cantidad_numeros: 100 }));
        let n = 0;
        const recuperaEn = Date.now() + 60;
        const sock = makeSock(() => {
            n++;
            if (n > 2 && Date.now() < recuperaEn) throw rateErr();
            return { success: true };
        });
        await quiet(() => workerEventos(sock));

        const cerrados = TABLA.filter(e => e.activo === false && e.estado === "cerrado");
        A(cerrados.length === 5, `5/5 eventos cerrados en BD (obtenido ${cerrados.length})`);
        A(TABLA.every(e => e.activo === false), "ningún evento quedó activo=true colgado");
    }

    // ============================================================
    // CASO 3 (end-to-end): G3 falla definitivo, el resto se cierra
    // ============================================================
    console.log("\n=== CASO 3 e2e: G3 error permanente no rate-limit ===");
    {
        TABLA = [1, 2, 3, 4, 5].map(n => ({ id: `C${n}`, grupo_id: `G${n}@g.us`, tabla: `t${n}`, activo: true, abierto: true, estado: "abierto", hora_cierre: "00:01", cantidad_numeros: 100 }));
        const sock = makeSock((g) => { if (g === "G3@g.us") { const e = new Error("forbidden"); e.data = 403; throw e; } return { success: true }; });
        await quiet(() => workerEventos(sock));

        const byId = Object.fromEntries(TABLA.map(e => [e.id, e]));
        A(byId["C1"].activo === false && byId["C2"].activo === false, "C1 y C2 cerrados");
        A(byId["C3"].activo === true, "C3 sigue activo=true (fallo real -> reintentable, NO se pierde)");
        A(byId["C4"].activo === false && byId["C5"].activo === false, "C4 y C5 cerrados (el fallo de C3 no los mató)");
    }

    // ============================================================
    // CASO 8: regresión del camino feliz
    // ============================================================
    console.log("\n=== CASO 8: regresión camino feliz ===");
    {
        TABLA = [
            { id: "R1", grupo_id: "G1@g.us", tabla: "t1", activo: true, abierto: true, estado: "abierto", hora_cierre: "00:01", cantidad_numeros: 100 },
            { id: "R2", grupo_id: "G2@g.us", tabla: "t2", activo: true, abierto: true, estado: "abierto", hora_cierre: "23:59", cantidad_numeros: 100 } // no vencido
        ];
        const sock = makeSock(() => ({ success: true }));
        await quiet(() => workerEventos(sock));
        A(TABLA.find(e => e.id === "R1").activo === false, "R1 (vencido) se cierra normalmente");
        A(TABLA.find(e => e.id === "R2").activo === true, "R2 (no vencido) NO se toca");
        A(TABLA.find(e => e.id === "R2").abierto === true, "R2 sigue abierto=true");
    }

    // ============================================================
    // CASO 9 (Corrección 3): doble fallo en apertura -> reintento acotado
    // ============================================================
    console.log("\n=== CASO 9: WhatsApp falla + Supabase falla 2 veces al registrar abierto=false ===");
    {
        stub("bot/funciones/eventos/extraerEvento", { extraerEvento: () => ({ nombre: "X", hora: "20:00", horaCierre: "20:30", valor: 1000, premios: [] }) });
        stub("bot/funciones/eventos/configEvento", { obtenerConfiguracion: () => ({ tabla: "t", cifras: 2, cantidad: 100 }) });
        stub("bot/funciones/eventos/consultarEvento", { consultarEvento: async () => null });
        stub("bot/funciones/eventos/guardarEvento", { guardarEvento: async () => { TABLA.push({ id: "EVT-9", grupo_id: "G9@g.us", activo: true, abierto: true, estado: "abierto", hora_cierre: "20:30" }); return { ...TABLA[TABLA.length - 1] }; } });

        TABLA = [];
        fallosUpdateAbiertoFalse.pendientes = 2; // los 2 primeros intentos fallan, el 3º (último) funciona

        const { detectarEvento } = require(path.join(backend, "bot/funciones/eventos/detectarEvento"));
        const sockCaido = makeSock(() => { throw rateErr(); });
        const ctx = { sock: sockCaido, grupo: { remoteJid: "G9@g.us" }, chat: { remoteJid: "G9@g.us" }, textoOriginal: "sorteo x" };

        const ev = await quiet(() => detectarEvento(ctx));

        A(!!ev, "detectarEvento no rompe el flujo aunque Supabase falle al registrar el fallo");
        A(ev.abierto === false, "el evento devuelto igual trae abierto=false (el reintento acotado lo consiguió al 3er intento)");
        A(TABLA[0].abierto === false, "en la BD terminó abierto=false pese a 2 fallos transitorios de Supabase");
        A(fallosUpdateAbiertoFalse.pendientes === 0, "se consumieron exactamente los 2 fallos simulados (3 intentos en total)");
    }

    console.log("\n=== CASO 9b: mismo escenario pero Supabase falla las 3 veces (agota reintentos) ===");
    {
        TABLA = [];
        fallosUpdateAbiertoFalse.pendientes = 3; // agota los 3 intentos del reintento acotado

        const { detectarEvento } = require(path.join(backend, "bot/funciones/eventos/detectarEvento"));
        const sockCaido = makeSock(() => { throw rateErr(); });
        const ctx = { sock: sockCaido, grupo: { remoteJid: "G9@g.us" }, chat: { remoteJid: "G9@g.us" }, textoOriginal: "sorteo x" };

        const ev = await quiet(() => detectarEvento(ctx));

        A(!!ev, "detectarEvento sigue sin romperse aunque se agoten los 3 reintentos");
        A(TABLA[0].abierto === true, "caso límite documentado: si WhatsApp Y los 3 reintentos de Supabase fallan, abierto queda true (ventana ya angosta con 3 intentos)");
        fallosUpdateAbiertoFalse.pendientes = 0;
    }

    // ============================================================
    // CASO 10 (Corrección 4): evita abrir+cerrar en el mismo tick
    // ============================================================
    console.log("\n=== CASO 10: la hora de cierre se cruza mientras se espera turno en la cola ===");
    {
        TABLA = [{ id: "OPENCLOSE-1", grupo_id: "GOC@g.us", tabla: "t", activo: true, abierto: false, estado: "abierto", hora_cierre: "00:01", cantidad_numeros: 100 }];

        // 1ª llamada (bloque A, chequeo previo a abrir): NO vencido todavía.
        // 2ª llamada (bloque A, re-chequeo tras abrirGrupo): YA vencido.
        // 3ª+ llamada (evaluarEvento, bloque de cierre): sigue vencido.
        secuenciasHoraCierre.set("OPENCLOSE-1", [false, true, true, true]);

        const sock = makeSock(() => ({ success: true }));
        const logs = [];
        const origLog = console.log;
        console.log = (...a) => { logs.push(a.join(" ")); };
        await workerEventos(sock);
        console.log = origLog;

        A(!logs.some(l => l.includes("🔓 Reconciliado")), "NO se marcó abierto=true (se evitó abrir+cerrar en el mismo tick)");
        A(logs.some(l => l.includes("ya venció mientras esperaba")), "quedó registrado en el log por qué se omitió la apertura");
        A(TABLA[0].abierto === false, "abierto nunca pasó por true dentro del tick");
        A(TABLA[0].activo === false, "el cierre normal (sin cambios) igual cerró el evento en el mismo tick");

        secuenciasHoraCierre.delete("OPENCLOSE-1");
    }

    // ============================================================
    // CASO 11 (Corrección 1): iniciarWorkerEventos no solapa ejecuciones
    // ============================================================
    console.log("\n=== CASO 11: el tick del worker no se solapa consigo mismo ===");
    {
        const workerEventosPath = require.resolve(path.join(backend, "bot/funciones/eventos/workers/workerEventos.js"));
        let enCurso = 0, maxEnCurso = 0, llamadas = 0;
        require.cache[workerEventosPath] = {
            id: workerEventosPath, filename: workerEventosPath, loaded: true,
            exports: {
                workerEventos: async () => {
                    llamadas++;
                    enCurso++;
                    maxEnCurso = Math.max(maxEnCurso, enCurso);
                    await new Promise(r => setTimeout(r, 30)); // simula un tick lento (cola con muchos grupos)
                    enCurso--;
                }
            }
        };

        // Capturar el callback del setInterval REAL de iniciarWorkerEventos,
        // sin esperar 30 s de verdad.
        const _setInterval = global.setInterval;
        let tickFn = null;
        global.setInterval = (fn) => { tickFn = fn; return 999999; };

        const { iniciarWorkerEventos } = require(path.join(backend, "bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js"));
        iniciarWorkerEventos({ context: { sessionId: "SOLAPE-TEST" } });

        global.setInterval = _setInterval;

        A(typeof tickFn === "function", "iniciarWorkerEventos programó el tick con el setInterval existente (no se creó uno nuevo)");

        const logs2 = [];
        const origLog2 = console.log;
        console.log = (...a) => { logs2.push(a.join(" ")); };

        // Disparar el tick 2 veces seguidas SIN esperar (simula que el
        // intervalo real de 30s vuelve a disparar mientras el anterior
        // sigue en curso), y una 3ª vez después de que el primero termine.
        const p1 = tickFn();
        const p2 = tickFn();
        await new Promise(r => setTimeout(r, 45)); // dejar terminar p1
        const p3 = tickFn();
        await Promise.all([p1, p2, p3]);

        console.log = origLog2;

        A(maxEnCurso === 1, `nunca hubo dos workerEventos ejecutándose a la vez (máximo observado: ${maxEnCurso})`);
        A(llamadas === 2, `el tick solapado se omitió: 2 ejecuciones reales de 3 disparos (obtenido ${llamadas})`);
        A(logs2.some(l => l.includes("omitido")), "quedó registrado en el log que se omitió el tick solapado");
    }

    console.log(`\n============================\nTOTAL ${ok + fail}  ✅ ${ok}  ❌ ${fail}\n============================`);
    process.exit(fail ? 1 : 0);

})();
