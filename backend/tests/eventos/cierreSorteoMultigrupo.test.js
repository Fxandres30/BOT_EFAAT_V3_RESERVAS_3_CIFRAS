// ==========================================================================
// PRUEBAS — cierre automático de un sorteo publicado en VARIOS grupos.
//
// Regla: una sola tabla de números por sorteo (00-99), compartida por todos
// sus grupos; se comprueba UNA vez que todos los números únicos estén
// 'pagado'; entonces se cierran TODOS los grupos del sorteo, cada uno con su
// propio estado, reintentos y errores.
//
// Reales: workerEventos.js, procesarSorteo.js, sorteoReal.js,
// verificarTodosPagados.js, cerrarEvento.js, cerrarGrupo.js, groupQueue.js,
// actualizarEvento.js, identidadEventoReal.js, guardarEvento.js.
// Simulados: Supabase (memoria) y el socket de WhatsApp (nunca real). No se
// envía ningún mensaje ni se cierra ningún grupo real.
//
//     node backend/tests/eventos/cierreSorteoMultigrupo.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.GROUP_QUEUE_BACKOFF_MS = "1";
process.env.GROUP_QUEUE_BACKOFF_MAX_MS = "2";

const assert = require("assert");
// Suite anterior a la política de grupos autorizados (ver el ayudante).
require("../utils/politicaGruposPermisiva");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// ------------------------------------------------------------- Supabase ---

const TABLA = "5k_15k_reservas_2_cifras";
const db = { eventos_bot: [], [TABLA]: [] };
const control = { lecturasTabla: 0, sinColumnasCierre: false, falloLecturaTabla: false };

let secuencia = 0;

const fakeSupabase = {
    from(tabla) {
        const filtros = [];
        let op = "select";
        let payload = null;
        let unico = null;
        let limite = null;
        const b = {
            select() { return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            limit(n) { limite = n; return b; },
            single() { unico = "single"; return b; },
            maybeSingle() { unico = "maybe"; return b; },
            insert(x) { op = "insert"; payload = x; return b; },
            update(x) { op = "update"; payload = x; return b; },
            then(ok, ko) { return Promise.resolve().then(ejecutar).then(ok, ko); }
        };
        function ejecutar() {
            const filas = db[tabla] || (db[tabla] = []);
            if (op === "insert") {
                const nueva = { id: `nuevo-${++secuencia}`, ...payload };
                filas.push(nueva);
                return { data: [nueva], error: null };
            }
            if (tabla === TABLA && op === "select") {
                control.lecturasTabla++;
                if (control.falloLecturaTabla) return { data: null, error: { message: "fallo simulado de lectura" } };
            }
            if (op === "update" && tabla === "eventos_bot" && control.sinColumnasCierre &&
                Object.keys(payload).some(k => k.startsWith("cierre_") || k === "cerrado_en")) {
                return { data: null, error: { code: "42703", message: "column does not exist" } };
            }
            let res = filas.filter(f => filtros.every(([c, v]) => f[c] === v));
            if (op === "update") res.forEach(f => Object.assign(f, payload));
            if (limite != null) res = res.slice(0, limite);
            const copia = res.map(f => ({ ...f }));
            if (unico === "single") return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: { code: "PGRST116" } };
            if (unico === "maybe") return { data: copia[0] || null, error: null };
            return { data: copia, error: null };
        }
        return b;
    }
};

require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: fakeSupabase };

const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const { verificarTodosPagados } = require(r("bot/funciones/eventos/lifecycle/verificarTodosPagados.js"));
const { estadoDelSorteo } = require(r("bot/funciones/eventos/sorteoReal.js"));
const { buscarSorteoVigente, fechaEventoHoy } = require(r("bot/funciones/eventos/identidadEventoReal.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));

// ----------------------------------------------------------------- datos ---

const TENANT = "tenant-1";
const ID = "sorteo-manizales";
const GRUPOS = ["A@g.us", "B@g.us", "C@g.us"];

function evento(grupo, extra = {}) {
    return {
        id: `ev-${grupo[0]}`, grupo_id: grupo, usuario_id: TENANT, tabla: TABLA, cifras: 2,
        cantidad_numeros: 100, identidad_evento_real: ID, nombre_evento: "Manizales",
        activo: true, abierto: true, estado: "abierto", hora_cierre: null,
        reservados: 0, pagados: 0, pendientes: 0, libres: 100,
        ...extra
    };
}

// Una sola cuadrícula 00-99 del tenant; las reservas se hicieron desde los
// tres grupos (evento_id distinto), todas del mismo sorteo (misma identidad).
function tabla(estadoDe) {
    db[TABLA] = Array.from({ length: 100 }, (_, i) => {
        const estado = estadoDe(i);
        return {
            numero: String(i).padStart(2, "0"), estado, usuario_id: TENANT,
            identidad_evento_real: estado === "libre" ? null : ID,
            evento_id: estado === "libre" ? null : `ev-${GRUPOS[i % 3][0]}`
        };
    });
}

function escenario({ estadoDe = () => "pagado", eventos = GRUPOS.map(g => evento(g)) } = {}) {
    db.eventos_bot = eventos;
    tabla(estadoDe);
    control.lecturasTabla = 0;
    control.sinColumnasCierre = false;
    control.falloLecturaTabla = false;
}

function crearSock({ fallan = new Set(), tenant = TENANT } = {}) {
    const cierres = [];
    const mensajes = [];
    return {
        cierres,
        mensajes,
        sock: {
            context: { sessionId: "s1", usuarioId: tenant },
            groupSettingUpdate: async (grupoId, ajuste) => {
                cierres.push({ grupoId, ajuste });
                if (fallan.has(grupoId)) throw new Error("not-authorized (simulado)");
            },
            // Si el cierre enviara mensajes, se verían aquí.
            sendMessage: async (...args) => { mensajes.push(args); }
        }
    };
}

const fila = (grupo) => db.eventos_bot.find(e => e.grupo_id === grupo);

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. 100 números en 3 grupos = UNA tabla: se lee una sola vez y cierra los 3 grupos", async () => {
    escenario();
    const { sock, cierres } = crearSock();
    await workerEventos(sock);
    assert.strictEqual(control.lecturasTabla, 1, "la tabla real se lee UNA vez por sorteo, no por grupo");
    assert.deepStrictEqual(cierres.map(c => c.grupoId).sort(), GRUPOS);
    assert.ok(cierres.every(c => c.ajuste === "announcement"));
    for (const g of GRUPOS) {
        assert.strictEqual(fila(g).activo, false);
        assert.strictEqual(fila(g).abierto, false);
        assert.strictEqual(fila(g).estado, "cerrado");
        assert.strictEqual(fila(g).cierre_estado, "cerrado");
        assert.ok(/pagados/.test(fila(g).cierre_motivo));
    }
});

prueba("2. 99 pagados -> NO cierra; los 3 grupos muestran 99 (no 297: no se suman)", async () => {
    escenario({ estadoDe: i => (i === 42 ? "reservado" : "pagado") });
    const { sock, cierres } = crearSock();
    await workerEventos(sock);
    assert.strictEqual(cierres.length, 0);
    for (const g of GRUPOS) {
        assert.strictEqual(fila(g).activo, true);
        assert.strictEqual(fila(g).pagados, 99);
        assert.strictEqual(fila(g).reservados, 1);
    }
});

prueba("3. los pagos se acumulan en la única tabla y cierra exactamente al pagar el último", async () => {
    escenario({ estadoDe: () => "reservado" });
    const { sock, cierres } = crearSock();
    for (let i = 0; i < 100; i++) {
        db[TABLA][i].estado = "pagado";
        await workerEventos(sock);
        if (i < 99) {
            assert.strictEqual(cierres.length, 0, `cerró con ${i + 1} pagados`);
            assert.strictEqual(fila("B@g.us").pagados, i + 1);
        }
    }
    assert.strictEqual(cierres.length, 3, "al pagar el número 100 se cierran los 3 grupos");
});

prueba("4. un mismo número NO cuenta dos veces: 100 filas pagadas pero '05' duplicado y sin '99' -> no cierra", async () => {
    escenario();
    db[TABLA][99] = { ...db[TABLA][5] }; // '05' dos veces, '99' no existe
    assert.strictEqual((await estadoDelSorteo(evento("A@g.us"))).pagados, 99);
    assert.strictEqual(await verificarTodosPagados(evento("A@g.us")), false);
    // Duplicado inconsistente (una fila pagada, otra reservada) tampoco cuenta.
    escenario();
    db[TABLA].push({ ...db[TABLA][7], estado: "reservado" });
    assert.strictEqual(await verificarTodosPagados(evento("A@g.us")), false);
});

prueba("5. libre / reservado / bloqueado / en_proceso NUNCA cuentan como pagados", async () => {
    for (const estado of ["libre", "reservado", "bloqueado", "en_proceso"]) {
        escenario({ estadoDe: i => (i === 0 ? estado : "pagado") });
        assert.strictEqual(await verificarTodosPagados(evento("A@g.us")), false, estado);
        const { sock, cierres } = crearSock();
        await workerEventos(sock);
        assert.strictEqual(cierres.length, 0, `${estado}: no debe cerrar`);
    }
});

prueba("6. pagado por OTRO sorteo (otra identidad) no cuenta para este", async () => {
    escenario();
    db[TABLA][10].identidad_evento_real = "otro-sorteo";
    assert.strictEqual(await verificarTodosPagados(evento("A@g.us")), false);
});

prueba("7. un grupo FALLA: los otros se cierran, el fallido queda activo con su error, sin mensajes", async () => {
    escenario();
    const { sock, cierres, mensajes } = crearSock({ fallan: new Set(["B@g.us"]) });
    await workerEventos(sock);
    assert.strictEqual(fila("A@g.us").activo, false);
    assert.strictEqual(fila("C@g.us").activo, false);
    assert.strictEqual(fila("B@g.us").activo, true, "el grupo que falló NO se marca cerrado");
    assert.strictEqual(fila("B@g.us").cierre_estado, "fallido");
    assert.strictEqual(fila("B@g.us").cierre_intentos, 1);
    assert.ok(/not-authorized/.test(fila("B@g.us").cierre_ultimo_error));
    assert.strictEqual(mensajes.length, 0, "el cierre no envía mensajes");
    assert.strictEqual(cierres.length, 3);
});

prueba("8. reintento seguro: solo se reintenta el grupo fallido, nunca los ya cerrados", async () => {
    escenario();
    const fallan = new Set(["B@g.us"]);
    const s1 = crearSock({ fallan });
    await workerEventos(s1.sock);
    const s2 = crearSock();
    await workerEventos(s2.sock);
    assert.deepStrictEqual(s2.cierres.map(c => c.grupoId), ["B@g.us"], "A y C ya cerrados no se vuelven a tocar");
    assert.strictEqual(fila("B@g.us").activo, false);
    assert.strictEqual(fila("B@g.us").cierre_estado, "cerrado");
    const s3 = crearSock();
    await workerEventos(s3.sock);
    assert.strictEqual(s3.cierres.length, 0, "sorteo ya cerrado: cero acciones");
});

prueba("9. espera creciente: tras 3 fallos el grupo espera antes de reintentar (no satura la cola)", async () => {
    escenario({ eventos: [evento("B@g.us")] });
    const fallan = new Set(["B@g.us"]);
    for (let i = 0; i < 3; i++) await workerEventos(crearSock({ fallan }).sock);
    assert.strictEqual(fila("B@g.us").cierre_intentos, 3);
    const s4 = crearSock({ fallan });
    await workerEventos(s4.sock);
    assert.strictEqual(s4.cierres.length, 0, "4º ciclo inmediato: en espera");
    fila("B@g.us").cierre_ultimo_intento_en = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const s5 = crearSock();
    await workerEventos(s5.sock);
    assert.strictEqual(s5.cierres.length, 1);
    assert.strictEqual(fila("B@g.us").activo, false);
});

prueba("10. aislamiento: el socket de un cliente nunca evalúa ni cierra sorteos de otro", async () => {
    escenario({ eventos: [evento("A@g.us"), evento("X@g.us", { id: "ev-X", usuario_id: "tenant-2" })] });
    db[TABLA].forEach(f => { f.usuario_id = "tenant-2"; });
    const { sock, cierres } = crearSock({ tenant: TENANT });
    await workerEventos(sock);
    assert.ok(!cierres.some(c => c.grupoId === "X@g.us"), "no toca el grupo de tenant-2");
    assert.strictEqual(fila("X@g.us").activo, true);
    assert.strictEqual(fila("A@g.us").activo, true, "la tabla de tenant-1 está vacía: su sorteo no está completo");
});

prueba("11. sin la migración 023 (columnas de cierre inexistentes) el cierre funciona igual", async () => {
    escenario();
    control.sinColumnasCierre = true;
    const { sock } = crearSock({ fallan: new Set(["C@g.us"]) });
    await workerEventos(sock);
    assert.strictEqual(fila("A@g.us").activo, false);
    assert.strictEqual(fila("A@g.us").estado, "cerrado");
    assert.strictEqual(fila("A@g.us").cierre_estado, undefined);
    assert.strictEqual(fila("C@g.us").activo, true);
});

prueba("12. error leyendo la tabla -> nunca se cierra por pagos", async () => {
    escenario();
    control.falloLecturaTabla = true;
    const { sock, cierres } = crearSock();
    await workerEventos(sock);
    assert.strictEqual(cierres.length, 0);
    assert.ok(GRUPOS.every(g => fila(g).activo));
});

prueba("13. hora de cierre de cualquier grupo cierra el sorteo en todos sus grupos (criterio de siempre)", async () => {
    escenario({ estadoDe: () => "reservado", eventos: [evento("A@g.us", { hora_cierre: "00:00" }), evento("B@g.us"), evento("C@g.us")] });
    const { sock, cierres } = crearSock();
    await workerEventos(sock);
    assert.strictEqual(cierres.length, 3);
    assert.ok(GRUPOS.every(g => /hora/.test(fila(g).cierre_motivo)));
});

prueba("14. evento antiguo sin identidad: cada fila es su propio sorteo (comportamiento previo)", async () => {
    escenario({ eventos: [evento("A@g.us", { identidad_evento_real: null }), evento("B@g.us", { identidad_evento_real: null })] });
    db[TABLA].forEach(f => { f.identidad_evento_real = null; f.evento_id = "ev-A"; });
    const { sock, cierres } = crearSock();
    await workerEventos(sock);
    assert.deepStrictEqual(cierres.map(c => c.grupoId), ["A@g.us"], "solo A tenía sus 100 números pagados");
});

prueba("15. identidad estable: un re-anuncio del sorteo ACTIVO adopta su identidad (mismo día o sin hora de cierre)", async () => {
    const hoy = fechaEventoHoy();
    const ayer = new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 10);
    const base = { usuario_id: TENANT, activo: true, nombre_evento: "Manizales", hora_fin: "22:30", valor: "5000" };
    const buscar = (grupoId = "N@g.us") => buscarSorteoVigente({ supabase: fakeSupabase, usuarioId: TENANT, nombre: "Manizales", hora: "22:30", valor: "$5.000", grupoId, hoy });

    db.eventos_bot = [{ id: "v1", grupo_id: "A@g.us", identidad_evento_real: "ID-HOY", fecha_evento: hoy, hora_cierre: "22:26", creado_en: "2026-01-01", ...base }];
    assert.strictEqual((await buscar()).identidad_evento_real, "ID-HOY", "mismo día: adopta");

    db.eventos_bot = [{ id: "v2", grupo_id: "A@g.us", identidad_evento_real: "ID-AYER", fecha_evento: ayer, hora_cierre: "22:26", ...base }];
    assert.strictEqual(await buscar(), null, "de ayer con hora de cierre (cierre fallido): NO adopta, nueva edición");

    db.eventos_bot = [{ id: "v3", grupo_id: "A@g.us", identidad_evento_real: "ID-SIN-HORA", fecha_evento: ayer, hora_cierre: null, ...base }];
    assert.strictEqual((await buscar()).identidad_evento_real, "ID-SIN-HORA", "sin hora de cierre sigue vigente: adopta");

    db.eventos_bot = [{ id: "v4", grupo_id: "A@g.us", identidad_evento_real: "ID-X", fecha_evento: hoy, ...base, valor: "10000" }];
    assert.strictEqual(await buscar(), null, "otro valor: nunca se fusiona");

    db.eventos_bot = [{ id: "v5", grupo_id: "A@g.us", identidad_evento_real: "ID-T2", fecha_evento: hoy, ...base, usuario_id: "tenant-2" }];
    assert.strictEqual(await buscar(), null, "otro tenant: nunca");

    db.eventos_bot = [{ id: "v6", grupo_id: "A@g.us", identidad_evento_real: "ID-INACTIVO", fecha_evento: hoy, ...base, activo: false }];
    assert.strictEqual(await buscar(), null, "sorteo cerrado: no se continúa");
});

prueba("16. guardarEvento conserva identidad y fecha del sorteo vigente (no parte sus reservas en dos)", async () => {
    db.eventos_bot = [];
    const sock = { context: { usuarioId: TENANT, sessionId: "s1" }, groupMetadata: async () => ({ subject: "Grupo N", participants: [] }) };
    const guardado = await guardarEvento({
        sock, grupoId: "N@g.us",
        evento: { nombre: "Manizales", hora: "22:30", horaCierre: null, valor: "5000", premios: [], tabla: TABLA, cifras: 2, cantidad_numeros: 100 },
        eventoAnterior: null,
        sorteoVigente: { identidad_evento_real: "ID-VIGENTE", fecha_evento: "2026-10-01" }
    });
    assert.strictEqual(guardado.identidad_evento_real, "ID-VIGENTE");
    assert.strictEqual(guardado.fecha_evento, "2026-10-01");
    const nuevo = await guardarEvento({
        sock, grupoId: "M@g.us",
        evento: { nombre: "Manizales", hora: "22:30", horaCierre: null, valor: "5000", premios: [], tabla: TABLA, cifras: 2, cantidad_numeros: 100 },
        eventoAnterior: null
    });
    assert.notStrictEqual(nuevo.identidad_evento_real, "ID-VIGENTE", "sin sorteo vigente: identidad de siempre");
});

// ---------------------------------------------------------------- runner ---

(async () => {

    const salida = (t) => process.stdout.write(t + "\n");
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) {
        originales[m] = console[m];
        console[m] = () => {};
    }

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            salida(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            salida(`❌ ${nombre}`);
            salida(String(err && err.stack || err));
        }
    }

    Object.assign(console, originales);

    salida("\n============================");
    salida(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    salida("============================");

    process.exit(falla ? 1 : 0);

})();
