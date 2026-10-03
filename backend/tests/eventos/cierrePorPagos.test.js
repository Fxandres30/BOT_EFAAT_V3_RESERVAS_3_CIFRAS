// ==========================================================================
// PRUEBAS — cierre inmediato cuando TODOS los números del evento están
// pagados (estado = 'pagado' en la tabla física del sorteo).
//
// Reales: lifecycle/verificarTodosPagados.js, evaluarEvento.js,
// procesarEvento.js, cerrarEvento.js, verificarHoraCierre.js,
// grupos/cerrarGrupo.js, services/baileys/groupQueue.js.
// Simulados: Supabase (tabla física + eventos_bot en memoria) y el socket
// de WhatsApp (confirma o falla el cierre). Nunca toca WhatsApp ni
// Supabase reales.
//
//     node backend/tests/eventos/cierrePorPagos.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// ------------------------------------------------------------- Supabase ---

const TABLA = "5k_15k_reservas_2_cifras";
const db = { eventos_bot: [], [TABLA]: [] };

const fakeSupabase = {
    from(tabla) {
        const filtros = [];
        let operacion = "select";
        let cambios = null;
        let contar = false;
        const b = {
            select(_c, opciones) { if (opciones?.count) contar = true; return b; },
            update(x) { operacion = "update"; cambios = x; return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            then(ok, ko) {
                const filas = (db[tabla] || []).filter(f => filtros.every(([c, v]) => f[c] === v));
                let res;
                if (operacion === "update") {
                    filas.forEach(f => Object.assign(f, cambios));
                    res = { data: null, error: null };
                } else {
                    res = contar ? { count: filas.length, error: null } : { data: filas, error: null };
                }
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: fakeSupabase };

const { evaluarEvento } = require(r("bot/funciones/eventos/lifecycle/evaluarEvento.js"));
const { procesarEvento } = require(r("bot/funciones/eventos/lifecycle/procesarEvento.js"));

// ----------------------------------------------------------------- datos ---

const IDENTIDAD = "sorteo-medellin-2026-10-02";

function crearEvento(extra = {}) {
    const evento = {
        id: "ev-1", grupo_id: "g1@g.us", usuario_id: "tenant-1", tabla: TABLA,
        cantidad_numeros: 100, identidad_evento_real: IDENTIDAD,
        activo: true, abierto: true, estado: "abierto",
        hora_cierre: null,   // sin hora de cierre: se aísla la condición de pagos
        ...extra
    };
    db.eventos_bot = [evento];
    return evento;
}

// estados: array de 100 estados ("pagado" | "reservado" | "libre")
function tabla(estados, identidad = IDENTIDAD) {
    db[TABLA] = estados.map((estado, i) => ({
        numero: String(i).padStart(2, "0"),
        estado,
        identidad_evento_real: estado === "libre" ? null : identidad,
        evento_id: "ev-1"
    }));
}

const n = (cant, estado) => Array(cant).fill(estado);

function crearSock({ falla = false } = {}) {
    const llamadas = [];
    return {
        llamadas,
        sock: {
            context: { sessionId: "s1" },
            groupSettingUpdate: async (grupoId, ajuste) => {
                llamadas.push({ grupoId, ajuste });
                if (falla) throw new Error("WhatsApp no confirmó el cierre (simulado)");
            }
        }
    };
}

const fila = () => db.eventos_bot[0];

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. 100/100 pagados -> cierra: cierra el grupo y marca activo=false, abierto=false, estado='cerrado'", async () => {

    const evento = crearEvento();
    tabla(n(100, "pagado"));
    const { sock, llamadas } = crearSock();

    assert.deepStrictEqual((await evaluarEvento(evento)).motivo, "pagados");

    const cerrado = await procesarEvento({ sock, evento });

    assert.strictEqual(cerrado, true);
    assert.deepStrictEqual(llamadas, [{ grupoId: "g1@g.us", ajuste: "announcement" }], "cerrarGrupo() existente, una vez");
    assert.strictEqual(fila().activo, false);
    assert.strictEqual(fila().abierto, false);
    assert.strictEqual(fila().estado, "cerrado");

});

prueba("2. 99/100 pagados -> no cierra por pagos", async () => {

    const evento = crearEvento();
    tabla([...n(99, "pagado"), "reservado"]);
    const { sock, llamadas } = crearSock();

    assert.strictEqual((await evaluarEvento(evento)).accion, "continuar");
    await procesarEvento({ sock, evento });

    assert.strictEqual(llamadas.length, 0);
    assert.strictEqual(fila().activo, true);

});

prueba("3. 98 pagados + 2 reservados -> no cierra por pagos", async () => {

    const evento = crearEvento();
    tabla([...n(98, "pagado"), ...n(2, "reservado")]);
    const { sock, llamadas } = crearSock();

    await procesarEvento({ sock, evento });

    assert.strictEqual(llamadas.length, 0);
    assert.strictEqual(fila().estado, "abierto");

});

prueba("4. 99 pagados + 1 libre -> no cierra", async () => {

    const evento = crearEvento();
    tabla([...n(99, "pagado"), "libre"]);
    const { sock, llamadas } = crearSock();

    await procesarEvento({ sock, evento });

    assert.strictEqual(llamadas.length, 0);
    assert.strictEqual(fila().activo, true);

});

prueba("4b. pagados reales del evento: 100 pagados de OTRO sorteo en la misma tabla física no cuentan", async () => {

    const evento = crearEvento();
    tabla(n(100, "pagado"), "otro-sorteo");
    const { sock, llamadas } = crearSock();

    await procesarEvento({ sock, evento });

    assert.strictEqual(llamadas.length, 0);
    assert.strictEqual(fila().activo, true);

});

prueba("5. si cerrarGrupo() falla -> NO se marca el evento como cerrado", async () => {

    const evento = crearEvento();
    tabla(n(100, "pagado"));
    const { sock, llamadas } = crearSock({ falla: true });

    const cerrado = await procesarEvento({ sock, evento });

    assert.strictEqual(llamadas.length, 1, "intentó cerrar el grupo");
    assert.strictEqual(fila().activo, true, "sigue activo para reintentar en el próximo ciclo");
    assert.strictEqual(fila().abierto, true);
    assert.strictEqual(fila().estado, "abierto");
    assert.strictEqual(cerrado, true, "procesarEvento solo informa que se intentó el cierre (sin cambios)");

});

prueba("5b. reintento: el worker real (workerEventos) reintenta en el siguiente ciclo y cierra cuando WhatsApp confirma", async () => {

    // workerEventos real: lee de eventos_bot los activos y llama a
    // procesarEvento (mismo camino que corre cada 30 s en producción).
    const RUTA_ESCANER = r("bot/funciones/usuarios/escanerIdentidadesLifecycle.js");
    require.cache[RUTA_ESCANER] = { id: RUTA_ESCANER, filename: RUTA_ESCANER, loaded: true, exports: { escanearGrupo: async () => null } };
    const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));

    crearEvento();
    tabla(n(100, "pagado"));

    const caido = crearSock({ falla: true });
    await workerEventos(caido.sock);
    assert.strictEqual(caido.llamadas.length, 1, "1er ciclo: intenta cerrar");
    assert.strictEqual(fila().activo, true, "1er ciclo: WhatsApp falla -> sigue activo");
    assert.strictEqual(fila().estado, "abierto");

    const sano = crearSock();
    await workerEventos(sano.sock);
    assert.strictEqual(sano.llamadas.length, 1, "2º ciclo: reintenta");
    assert.strictEqual(fila().activo, false, "2º ciclo: WhatsApp confirma -> cerrado");
    assert.strictEqual(fila().abierto, false);
    assert.strictEqual(fila().estado, "cerrado");

    const despues = crearSock();
    await workerEventos(despues.sock);
    assert.strictEqual(despues.llamadas.length, 0, "3er ciclo: ya no hay nada que cerrar");

});

prueba("6a. la hora de cierre sigue igual: verificarHoraCierre.js idéntico a HEAD", async () => {

    const actual = fs.readFileSync(r("bot/funciones/eventos/lifecycle/verificarHoraCierre.js"), "utf8").replace(/\r\n/g, "\n");
    const head = execSync("git show HEAD:backend/bot/funciones/eventos/lifecycle/verificarHoraCierre.js", { cwd: RAIZ, encoding: "utf8" }).replace(/\r\n/g, "\n");
    assert.strictEqual(actual, head);

});

prueba("6b. la hora de cierre sigue cerrando igual (hora vencida, 0 pagados -> motivo 'hora'), y tiene prioridad", async () => {

    const evento = crearEvento({ hora_cierre: "00:00" });   // siempre vencida
    tabla(n(100, "libre"));
    const { sock, llamadas } = crearSock();

    assert.strictEqual((await evaluarEvento(evento)).motivo, "hora");
    await procesarEvento({ sock, evento });

    assert.strictEqual(llamadas.length, 1);
    assert.strictEqual(fila().estado, "cerrado");

    const otro = crearEvento({ hora_cierre: "00:00" });
    tabla(n(100, "pagado"));
    assert.strictEqual((await evaluarEvento(otro)).motivo, "hora", "con ambas condiciones, la hora se evalúa primero (como siempre)");

});

prueba("6c. evento ya inactivo -> no se evalúa ni se cierra de nuevo", async () => {

    const evento = crearEvento({ activo: false, estado: "cerrado" });
    tabla(n(100, "pagado"));
    const { sock, llamadas } = crearSock();

    assert.strictEqual(await evaluarEvento(evento), null);
    await procesarEvento({ sock, evento });
    assert.strictEqual(llamadas.length, 0);

});

(async () => {

    const salida = (t) => process.stdout.write(t + "\n");
    const originales = {};
    for (const m of ["log", "dir", "error", "warn"]) {
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
