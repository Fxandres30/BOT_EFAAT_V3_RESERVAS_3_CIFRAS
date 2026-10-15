// ==========================================================================
// PRUEBAS — reconciliación de apertura de grupos (eventos con abierto=false).
//
// Antes: si WhatsApp respondía "not-authorized" al abrir, el worker volvía a
// llamar a groupSettingUpdate cada 30 s hasta la hora de cierre. Ahora se
// consulta el estado real (groupMetadata, misma cola IQ) y se aplica una
// espera por grupo; un sorteo en varios grupos y dos filas del mismo grupo
// comparten una sola operación.
//
// Reales: workerEventos.js, reconciliarApertura.js, abrirGrupo.js,
// cerrarGrupo.js, cerrarEvento.js, procesarSorteo.js, sorteoReal.js,
// groupQueue.js, verificarHoraCierre.js.
// Simulados: Supabase (memoria) y el socket de WhatsApp (nunca real).
//
//     node backend/tests/eventos/aperturaGrupos.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.GROUP_QUEUE_BACKOFF_MS = "1";
process.env.GROUP_QUEUE_BACKOFF_MAX_MS = "2";

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// ------------------------------------------------------------- Supabase ---

const TABLA = "5k_15k_reservas_2_cifras";
const db = { eventos_bot: [], [TABLA]: [] };
const escrituras = [];

const fakeSupabase = {
    from(tabla) {
        const filtros = [];
        let op = "select";
        let payload = null;
        const b = {
            select() { return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            limit() { return b; },
            update(x) { op = "update"; payload = x; return b; },
            then(ok, ko) { return Promise.resolve().then(ejecutar).then(ok, ko); }
        };
        function ejecutar() {
            const filas = db[tabla] || (db[tabla] = []);
            const res = filas.filter(f => filtros.every(([c, v]) => f[c] === v));
            if (op === "update") {
                res.forEach(f => Object.assign(f, payload));
                escrituras.push({ tabla, filtros: [...filtros], payload });
            }
            return { data: res.map(f => ({ ...f })), error: null };
        }
        return b;
    }
};

require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: fakeSupabase };

const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const apertura = require(r("bot/funciones/eventos/grupos/reconciliarApertura.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));

// ----------------------------------------------------------------- datos ---

const TENANT = "tenant-1";
const BOT_PN = "573001112222";
const BOT_LID = "99887766";

function evento(id, grupo, extra = {}) {
    return {
        id, grupo_id: grupo, usuario_id: TENANT, tabla: TABLA, cifras: 2,
        cantidad_numeros: 100, identidad_evento_real: "sorteo-1", nombre_evento: "Manizales",
        activo: true, abierto: false, estado: "abierto", hora_cierre: null,
        reservados: 0, pagados: 0, pendientes: 0, libres: 100,
        ...extra
    };
}

// Tabla con un número libre: el sorteo nunca se cierra "por pagos".
function escenario(eventos) {
    db.eventos_bot = eventos;
    db[TABLA] = Array.from({ length: 100 }, (_, i) => ({
        numero: String(i).padStart(2, "0"), estado: i === 0 ? "libre" : "pagado", usuario_id: TENANT,
        identidad_evento_real: i === 0 ? null : "sorteo-1", evento_id: null
    }));
    escrituras.length = 0;
    apertura._reiniciar();
}

const errorWhatsApp = (texto, codigo) => Object.assign(new Error(texto), { data: codigo });

// abrir(grupoId) / metadata(grupoId): funciones que deciden la respuesta.
function crearSock({ abrir = () => {}, metadata = () => ({ announce: true, participants: [] }), sessionId = "s1" } = {}) {
    const llamadas = [];
    return {
        llamadas,
        sock: {
            context: { sessionId, usuarioId: TENANT },
            user: { id: `${BOT_PN}:5@s.whatsapp.net`, lid: `${BOT_LID}:5@lid` },
            groupSettingUpdate: async (grupoId, ajuste) => {
                llamadas.push({ op: ajuste, grupoId });
                await new Promise(res => setTimeout(res, 2));
                if (ajuste === "not_announcement") return abrir(grupoId);
            },
            groupMetadata: async (grupoId) => {
                llamadas.push({ op: "metadata", grupoId });
                return metadata(grupoId);
            },
            sendMessage: async () => {}
        }
    };
}

const aperturas = (llamadas) => llamadas.filter(l => l.op === "not_announcement");
const consultas = (llamadas) => llamadas.filter(l => l.op === "metadata");
const fila = (id) => db.eventos_bot.find(e => e.id === id);
// Escrituras de eventos_bot que tocan "abierto" (los contadores del sorteo
// los sincroniza procesarSorteo en cada ciclo, como siempre).
const escriturasApertura = () => escrituras.filter(e => e.tabla === "eventos_bot" && "abierto" in e.payload).map(e => e.payload);

// Reloj controlado para las esperas por grupo.
const dateNowOriginal = Date.now;
let desfaseMs = 0;
Date.now = () => dateNowOriginal() + desfaseMs;
const avanzar = (ms) => { desfaseMs += ms; };

const sinPermisos = () => { throw errorWhatsApp("not-authorized", 401); };
const cerradoSinAdmin = () => ({
    announce: true,
    participants: [
        { id: `${BOT_LID}@lid`, phoneNumber: `${BOT_PN}@s.whatsapp.net`, admin: null },
        { id: "11111@lid", admin: "superadmin" }
    ]
});

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. apertura exitosa: una llamada por grupo y abierto=true (comportamiento de siempre)", async () => {
    escenario([evento("e1", "A@g.us"), evento("e2", "B@g.us")]);
    const { sock, llamadas } = crearSock();
    await workerEventos(sock);
    assert.deepStrictEqual(aperturas(llamadas).map(l => l.grupoId).sort(), ["A@g.us", "B@g.us"]);
    // Las únicas groupMetadata son las del escáner de identidades que ya corría
    // tras cada apertura confirmada (una por grupo); la reconciliación no consulta.
    assert.strictEqual(consultas(llamadas).length, 2, "solo el escáner de siempre, una por grupo");
    assert.strictEqual(fila("e1").abierto, true);
    assert.strictEqual(fila("e2").abierto, true);
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 2, "un evento ya abierto no se vuelve a abrir");
});

prueba("2. not-authorized + groupMetadata confirma grupo abierto: sincroniza y no vuelve a intentarlo", async () => {
    escenario([evento("e1", "A@g.us")]);
    const { sock, llamadas } = crearSock({ abrir: sinPermisos, metadata: () => ({ announce: false, participants: [] }) });
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 1);
    // 1 consulta del estado real (+ la del escáner de siempre, que tiene su
    // propio límite de frecuencia por grupo).
    assert.ok(consultas(llamadas).length >= 1, "se consulta el estado real");
    assert.strictEqual(fila("e1").abierto, true, "abierto=true sincronizado con el estado real");
    assert.deepStrictEqual(escriturasApertura(), [{ abierto: true }], "misma escritura de siempre");
    for (let i = 0; i < 5; i++) await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 1, "ninguna apertura innecesaria después");
});

prueba("3. not-authorized + grupo cerrado y bot NO administrador: no repite cada 30 s; espera creciente; se recupera al dar permisos", async () => {
    escenario([evento("e1", "A@g.us")]);
    let permisos = false;
    const { sock, llamadas } = crearSock({
        abrir: () => { if (!permisos) sinPermisos(); },
        metadata: cerradoSinAdmin
    });
    const avisos = [];
    const warn = console.warn;
    console.warn = (m) => avisos.push(String(m));
    try {
        await workerEventos(sock);
    } finally {
        console.warn = warn;
    }
    assert.strictEqual(aperturas(llamadas).length, 1);
    assert.ok(avisos.some(a => /cerrado y que la cuenta del bot NO es administradora/.test(a) && /60 s/.test(a)), avisos.join("\n"));
    assert.ok(avisos.every(a => !a.includes(BOT_PN) && !a.includes(BOT_LID)), "el diagnóstico no imprime la cuenta del bot");
    assert.strictEqual(fila("e1").abierto, false, "no se marca abierto sin evidencia");

    // 10 ciclos de 30 s = 5 min de reloj simulado.
    let llamadasPorCiclo = [];
    for (let i = 0; i < 10; i++) {
        avanzar(30 * 1000);
        const antes = aperturas(llamadas).length;
        await workerEventos(sock);
        llamadasPorCiclo.push(aperturas(llamadas).length - antes);
    }
    // Esperas 1 min, 2 min, 4 min -> intentos en t≈60 s y t≈180 s (no 10).
    assert.strictEqual(aperturas(llamadas).length, 3, `intentos: ${llamadasPorCiclo.join(",")}`);
    assert.ok(apertura.esperaRestante("A@g.us") > 0);

    // Alguien da permisos al bot: al vencer la espera, el grupo se abre solo.
    permisos = true;
    avanzar(4 * 60 * 1000);
    await workerEventos(sock);
    assert.strictEqual(fila("e1").abierto, true, "la recuperación no queda bloqueada");
    assert.strictEqual(apertura.esperaRestante("A@g.us"), 0, "la espera se limpia tras abrir");
});

prueba("4. rate-overlimit: la cola reintenta y, agotado, el próximo ciclo vuelve a intentar (comportamiento de siempre)", async () => {
    escenario([evento("e1", "A@g.us")]);
    const { sock, llamadas } = crearSock({ abrir: () => { throw errorWhatsApp("rate-overlimit", 429); } });
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 5, "1 intento + 4 reintentos de la cola");
    assert.strictEqual(consultas(llamadas).length, 0, "rate-overlimit no consulta el estado");
    assert.strictEqual(fila("e1").abierto, false);
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 10, "sin espera por grupo: se reintenta en el ciclo siguiente");
});

prueba("5. error de groupMetadata: no asume abierto ni cambia el evento; aplica la espera", async () => {
    escenario([evento("e1", "A@g.us")]);
    const { sock, llamadas } = crearSock({ abrir: sinPermisos, metadata: () => { throw new Error("timeout simulado"); } });
    await workerEventos(sock);
    assert.strictEqual(fila("e1").abierto, false);
    assert.strictEqual(escriturasApertura().length, 0, "ninguna escritura de apertura sin evidencia");
    avanzar(30 * 1000);
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 1, "no repite a los 30 s");
});

prueba("5b. not-authorized + bot SÍ admin o estado sin datos: tampoco asume abierto", async () => {
    escenario([evento("e1", "A@g.us"), evento("e2", "B@g.us")]);
    const { sock } = crearSock({
        abrir: sinPermisos,
        metadata: (g) => g === "A@g.us"
            ? { announce: true, participants: [{ id: `${BOT_PN}@s.whatsapp.net`, admin: "admin" }] }
            : { participants: [] }
    });
    await workerEventos(sock);
    assert.strictEqual(fila("e1").abierto, false);
    assert.strictEqual(fila("e2").abierto, false);
    assert.ok(apertura.esperaRestante("A@g.us") > 0 && apertura.esperaRestante("B@g.us") > 0);
});

prueba("6. cierre automático intacto: un evento vencido no se reabre y se cierra a su hora; uno no vencido sigue activo", async () => {
    escenario([
        evento("e1", "A@g.us", { hora_cierre: "00:00", identidad_evento_real: "vencido" }),
        evento("e2", "B@g.us", { hora_cierre: "23:59", identidad_evento_real: "futuro", abierto: true })
    ]);
    const { sock, llamadas } = crearSock({ abrir: sinPermisos, metadata: cerradoSinAdmin });
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 0, "no se intenta abrir un evento vencido");
    assert.deepStrictEqual(llamadas.filter(l => l.op === "announcement").map(l => l.grupoId), ["A@g.us"]);
    assert.strictEqual(fila("e1").activo, false);
    assert.strictEqual(fila("e1").estado, "cerrado");
    assert.strictEqual(fila("e2").activo, true, "el de las 23:59 no se cierra antes de su hora");
});

prueba("7. dos eventos del mismo grupo: UNA apertura y ambos sincronizados", async () => {
    escenario([
        evento("e1", "A@g.us", { identidad_evento_real: "sorteo-1" }),
        evento("e2", "A@g.us", { identidad_evento_real: "sorteo-2" })
    ]);
    const { sock, llamadas } = crearSock();
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 1);
    assert.strictEqual(fila("e1").abierto, true);
    assert.strictEqual(fila("e2").abierto, true);
});

prueba("7b. dos workers a la vez sobre el mismo grupo: no hay dos aperturas simultáneas", async () => {
    escenario([evento("e1", "A@g.us")]);
    const uno = crearSock({ sessionId: "s1" });
    const dos = crearSock({ sessionId: "s2" });
    await Promise.all([workerEventos(uno.sock), workerEventos(dos.sock)]);
    assert.strictEqual(aperturas(uno.llamadas).length + aperturas(dos.llamadas).length, 1);
    assert.strictEqual(fila("e1").abierto, true);
});

prueba("8. sorteo en 3 grupos con not-authorized en uno: los otros se abren; solo el rechazado espera", async () => {
    escenario([evento("e1", "A@g.us"), evento("e2", "B@g.us"), evento("e3", "C@g.us")]);
    const { sock, llamadas } = crearSock({ abrir: (g) => { if (g === "B@g.us") sinPermisos(); }, metadata: cerradoSinAdmin });
    await workerEventos(sock);
    assert.deepStrictEqual(["e1", "e2", "e3"].map(id => fila(id).abierto), [true, false, true]);
    avanzar(30 * 1000);
    await workerEventos(sock);
    assert.strictEqual(aperturas(llamadas).length, 3, "B no se repite a los 30 s y A/C ya están abiertos");
});

prueba("9. otro cliente: sus eventos no se tocan", async () => {
    escenario([evento("e1", "A@g.us", { usuario_id: "otro-tenant" })]);
    const { sock, llamadas } = crearSock();
    await workerEventos(sock);
    assert.strictEqual(llamadas.length, 0);
    assert.strictEqual(fila("e1").abierto, false);
});

prueba("10. abrirGrupo conserva su contrato booleano (detección y publicador)", async () => {
    apertura._reiniciar();
    assert.strictEqual(await abrirGrupo({ sock: crearSock().sock, grupoId: "A@g.us" }), true);
    assert.strictEqual(await abrirGrupo({ sock: crearSock({ abrir: sinPermisos }).sock, grupoId: "A@g.us" }), false);
});

prueba("11. clasificación: not-authorized/forbidden son permisos; rate-overlimit y timeout no", () => {
    assert.ok(apertura.esRechazoDePermisos(errorWhatsApp("not-authorized", 401)));
    assert.ok(apertura.esRechazoDePermisos(errorWhatsApp("forbidden", 403)));
    assert.ok(!apertura.esRechazoDePermisos(errorWhatsApp("rate-overlimit", 429)));
    assert.ok(!apertura.esRechazoDePermisos(new Error("GROUP_QUEUE_TIMEOUT: la operación superó 20000 ms sin resolver")));
    assert.ok(!apertura.esRechazoDePermisos(Object.assign(new Error("SOCKET_NO_VIGENTE: x"), { code: "SOCKET_NO_VIGENTE" })));
});

prueba("12. bot administrador: se reconoce por LID o por teléfono; desconocido -> null", () => {
    const sock = crearSock().sock;
    assert.strictEqual(apertura.botEsAdministrador(sock, { participants: [{ id: `${BOT_LID}@lid`, admin: "admin" }] }), true);
    assert.strictEqual(apertura.botEsAdministrador(sock, { participants: [{ id: "x@lid", phoneNumber: `${BOT_PN}@s.whatsapp.net`, admin: null }] }), false);
    assert.strictEqual(apertura.botEsAdministrador(sock, { participants: [{ id: "otro@lid", admin: "admin" }] }), null);
    assert.strictEqual(apertura.botEsAdministrador({}, { participants: [] }), null);
});

// ------------------------------------------------------------- ejecutar ---

(async () => {

    const salida = (m) => process.stdout.write(m + "\n");
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) {
        originales[m] = console[m];
        console[m] = () => {};
    }

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        desfaseMs = 0;
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
    Date.now = dateNowOriginal;

    salida("\n============================");
    salida(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    salida("============================");

    process.exit(falla ? 1 : 0);

})();
