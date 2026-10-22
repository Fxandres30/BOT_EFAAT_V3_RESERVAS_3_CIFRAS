// ==========================================================================
// PRUEBAS — Aislamiento de sesiones entre clientes y ciclo de vida seguro.
//
//   1. Failover (manager real, WhatsApp simulado): cuando la sesión activa
//      cae o se detiene, el BOT solo pasa a otra sesión del MISMO dueño
//      (la preferida de ese dueño primero); nunca al WhatsApp de otro
//      cliente; si no se conoce el dueño, no hay failover.
//   2. 401 / device_removed: las credenciales invalidadas se apartan (no se
//      borran) y se cortan las escrituras del socket que cae; otros cierres
//      (440, 408) no las tocan.
//   3. archivarCredencialesInvalidadas: solo mueve auth/<uuid> dentro de
//      una carpeta temporal de prueba; ids no UUID o rutas raras -> nada.
//   4. Eliminar desde el panel (controlador real): detiene la sesión, corta
//      escrituras, borra la fila y usa el usuario del token — nunca el que
//      manda el navegador; sesión ajena -> 404 sin detener nada.
//
// Nada real: Supabase en memoria, Baileys simulado, carpetas temporales.
// Ningún id de prueba coincide con una carpeta real de credenciales.
//
//     node backend/tests/sesiones/aislamientoSesiones.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const RUTA_CREDENCIALES = path.join(RAIZ, "services/baileys/credencialesInvalidadas.js");

// Espía del archivado de credenciales para las pruebas con el manager real
// (desconectado.js lo requiere; así nunca toca auth/ real).
const archivados = [];
const credencialesReal = require(RUTA_CREDENCIALES);
require.cache[RUTA_CREDENCIALES] = {
    id: RUTA_CREDENCIALES, filename: RUTA_CREDENCIALES, loaded: true,
    exports: { ...credencialesReal, archivarCredencialesInvalidadas: async (id) => { archivados.push(id); return { archivada: true }; } }
};

const { crearEntorno, flush, esperarHasta, acelerarTimers, restaurarTimers } = require("./entornoFake");

const salida = (t) => process.stdout.write(t + "\n");

let ok = 0;
let falla = 0;

async function test(nombre, fn) {
    try {
        await fn();
        ok++;
        salida(`✅ ${nombre}`);
    } catch (err) {
        falla++;
        salida(`❌ ${nombre}\n   ${err.message}`);
    }
}

function sesion(id, usuario_id, extra = {}) {
    return { id, usuario_id, nombre: `Sesion ${id}`, estado: "desconectado", activa: false, principal: false, telefono: null, ...extra };
}

function emitir(sock, connection, statusCode) {
    sock.ev.emit("connection.update", connection === "open"
        ? { connection: "open" }
        : { connection: "close", lastDisconnect: { error: { output: { statusCode } } } });
}

// Arranca y abre las sesiones en orden; la primera queda activa. Espera a
// que TERMINE la evaluación de conexión de cada una (conectado.js ->
// manager.evaluarConexion): así cada caso mide el failover y no una
// evaluación atrasada de otra sesión que llega después del cierre.
async function conectar(manager, ids) {
    const evaluaciones = [];
    const original = manager.evaluarConexion.bind(manager);
    manager.evaluarConexion = (id) => {
        const p = original(id);
        evaluaciones.push(p);
        return p;
    };
    for (const id of ids) {
        await manager.start(id);
        const sock = manager.get(id);
        sock.user = { id: `${id}:1@s.whatsapp.net` };
        emitir(sock, "open");
        await esperarHasta(() => evaluaciones.length === ids.indexOf(id) + 1, { maxVueltas: 20000, mensaje: `evaluación de ${id}` });
        await Promise.all(evaluaciones);
    }
    manager.evaluarConexion = original;
    await esperarHasta(() => manager.getActiveSession() === ids[0], { mensaje: `${ids[0]} debería quedar activa` });
}

const CLIENTE_1 = "cliente-1";
const CLIENTE_2 = "cliente-2";

(async () => {

    // Silencio de logs del bot durante las pruebas (se restaura al final) y
    // esperas internas del manager (conectado.js: 1 s) aceleradas, como en
    // el resto de pruebas de sesiones.
    const originales = {};
    for (const m of ["log", "warn", "error", "time", "timeEnd", "dir", "table"]) { originales[m] = console[m]; console[m] = () => {}; }
    acelerarTimers();

    // -------------------------------------------------- 1. failover ---

    await test("failover: la activa del cliente 1 cae (401) y solo hay otra sesión del cliente 2 -> NO pasa a la ajena", async () => {
        const { manager } = crearEntorno({ sesionesIniciales: [sesion("A", CLIENTE_1), sesion("B", CLIENTE_2)] });
        await conectar(manager, ["A", "B"]);
        emitir(manager.get("A"), "close", 401);
        await flush(40);
        // Multisesión: B ya era la activa DE SU cliente y lo sigue siendo;
        // el cliente 1 queda sin sesión (nunca pasa a usar la de B).
        assert.strictEqual(manager.getSesionActivaDe(CLIENTE_1), null, "nunca el WhatsApp de otro cliente");
        assert.strictEqual(manager.getSesionActivaDe(CLIENTE_2), "B", "el cliente 2 no se ve afectado");
    });

    await test("failover: pasa a otra sesión del MISMO cliente aunque otra ajena sea «preferida»", async () => {
        const { manager } = crearEntorno({ sesionesIniciales: [sesion("A", CLIENTE_1), sesion("B", CLIENTE_2, { principal: true }), sesion("C", CLIENTE_1)] });
        await conectar(manager, ["A", "B", "C"]);
        emitir(manager.get("A"), "close", 401);
        await esperarHasta(() => manager.getSesionActivaDe(CLIENTE_1) === "C", { mensaje: "debería pasar a C (del mismo cliente)" });
        assert.strictEqual(manager.getSesionActivaDe(CLIENTE_2), "B");
    });

    await test("failover: entre varias propias, elige la preferida de ese cliente", async () => {
        const { manager } = crearEntorno({ sesionesIniciales: [sesion("A", CLIENTE_1), sesion("C", CLIENTE_1), sesion("D", CLIENTE_1, { principal: true }), sesion("B", CLIENTE_2, { principal: true })] });
        await conectar(manager, ["A", "C", "D", "B"]);
        emitir(manager.get("A"), "close", 401);
        await esperarHasta(() => manager.getSesionActivaDe(CLIENTE_1) === "D", { mensaje: "debería pasar a D (preferida del cliente 1)" });
        assert.strictEqual(manager.getSesionActivaDe(CLIENTE_2), "B");
    });

    await test("failover: desconexión manual de la activa (panel) tampoco pasa a la sesión de otro cliente", async () => {
        const { manager } = crearEntorno({ sesionesIniciales: [sesion("A", CLIENTE_1), sesion("B", CLIENTE_2)] });
        await conectar(manager, ["A", "B"]);
        await manager.stop("A");
        await flush(20);
        assert.strictEqual(manager.getSesionActivaDe(CLIENTE_1), null);
        assert.strictEqual(manager.getSesionActivaDe(CLIENTE_2), "B");
    });

    await test("failover: si no se conoce el dueño de la sesión que cae (fila borrada) -> sin failover", async () => {
        const { manager, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion("A", CLIENTE_1), sesion("C", CLIENTE_1)] });
        await conectar(manager, ["A", "C"]);
        const filas = fakeSupabase._filas();
        filas.splice(filas.findIndex(f => f.id === "A"), 1);
        assert.strictEqual(await manager.selectFailoverSession({ excluir: "A" }), null);
    });

    // ---------------------------------------- 2. 401 / device_removed ---

    await test("401 (device_removed): credenciales apartadas y escrituras cortadas; la sesión queda desconectada", async () => {
        archivados.length = 0;
        const { manager, fakeSupabase } = crearEntorno({ sesionesIniciales: [sesion("A", CLIENTE_1)] });
        await conectar(manager, ["A"]);
        const sock = manager.get("A");
        assert.ok(sock.ev.listenerCount("creds.update") > 0, "el socket guarda credenciales mientras vive");
        emitir(sock, "close", 401);
        await flush(40);
        assert.deepStrictEqual(archivados, ["A"]);
        assert.strictEqual(sock.ev.listenerCount("creds.update"), 0, "sin escrituras tardías sobre la carpeta apartada");
        assert.strictEqual(fakeSupabase._obtenerSesion("A").estado, "desconectado");
        assert.strictEqual(manager.get("A"), undefined);
    });

    for (const [codigo, nombre] of [[440, "conexión reemplazada"], [408, "pérdida de conexión"]]) {
        await test(`${codigo} (${nombre}): las credenciales NO se tocan`, async () => {
            archivados.length = 0;
            const { manager } = crearEntorno({ sesionesIniciales: [sesion("A", CLIENTE_1)] });
            await conectar(manager, ["A"]);
            emitir(manager.get("A"), "close", codigo);
            await flush(40);
            assert.deepStrictEqual(archivados, []);
        });
    }

    // ----------------------------------- 3. archivado en carpeta temporal ---

    const ID = "33333333-0000-4000-8000-000000000003";
    const { archivarCredencialesInvalidadas } = credencialesReal;

    await test("archivar: mueve auth/<uuid> a _invalidadas/<uuid>-<fecha> sin perder archivos", async () => {
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "efaat-auth-"));
        fs.mkdirSync(path.join(raiz, ID));
        fs.writeFileSync(path.join(raiz, ID, "creds.json"), "{}");
        const r = await archivarCredencialesInvalidadas(ID, { raiz, ahora: new Date("2026-10-21T15:00:00Z") });
        assert.deepStrictEqual(r, { archivada: true });
        assert.ok(!fs.existsSync(path.join(raiz, ID)), "la carpeta original ya no existe");
        assert.ok(fs.existsSync(path.join(raiz, "_invalidadas", `${ID}-2026-10-21T15-00-00-000Z`, "creds.json")), "el contenido se conserva");
    });

    await test("archivar: sin carpeta -> sin_credenciales; id no UUID o con ruta -> ruta_invalida (nada se toca)", async () => {
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "efaat-auth-"));
        fs.mkdirSync(path.join(raiz, "A"));
        assert.strictEqual((await archivarCredencialesInvalidadas(ID, { raiz })).motivo, "sin_credenciales");
        for (const id of ["A", "../A", "_invalidadas", "", null]) {
            assert.strictEqual((await archivarCredencialesInvalidadas(id, { raiz })).motivo, "ruta_invalida", String(id));
        }
        assert.ok(fs.existsSync(path.join(raiz, "A")));
    });

    // ------------------------------- 4. eliminar desde el panel (real) ---

    await test("eliminar: controlador real — detiene la sesión, corta escrituras, borra la fila; usuario del token", async () => {
        const SES = "44444444-0000-4000-8000-000000000004";
        const DUENIO = "aaaaaaaa-0000-4000-8000-00000000000a";
        const OTRO = "bbbbbbbb-0000-4000-8000-00000000000b";
        const filas = [{ id: SES, usuario_id: DUENIO, nombre: "x", estado: "conectado" }];
        const borrados = [];
        const supabaseFalso = {
            from(tabla) {
                const filtros = [];
                let modo = "select";
                const b = {
                    select() { return b; },
                    delete() { modo = "delete"; return b; },
                    eq(c, v) { filtros.push([c, v]); return b; },
                    in() { return b; },
                    maybeSingle() { return Promise.resolve({ data: filas.find(f => filtros.every(([c, v]) => f[c] === v)) || null, error: null }); },
                    then(okFn, ko) {
                        if (modo === "delete") {
                            const i = filas.findIndex(f => filtros.every(([c, v]) => f[c] === v));
                            if (i >= 0) borrados.push(filas.splice(i, 1)[0]);
                        }
                        return Promise.resolve({ data: tabla === "sesiones_lease" ? [] : null, error: null }).then(okFn, ko);
                    }
                };
                return b;
            }
        };
        const detenidas = [];
        const sock = { ev: { removeAllListeners: (e) => detenidas.push(`sin-${e}`) } };
        const inyectar = (rel, exp) => { const abs = path.join(RAIZ, rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };
        inyectar("lib/supabase.js", supabaseFalso);
        inyectar("services/baileys/manager.js", { get: () => sock, stop: async (id) => detenidas.push(`stop-${id}`) });
        process.env.SESSIONS_DELETE_GRACE_MS = "1";
        delete require.cache[path.join(RAIZ, "bot/controllers/sessionsAdminController.js")];
        delete require.cache[path.join(RAIZ, "services/baileys/lease.js")];
        const admin = require(path.join(RAIZ, "bot/controllers/sessionsAdminController.js"));

        const responder = () => { const r = { status: 200, cuerpo: null }; return Object.assign(r, { res: { status(s) { r.status = s; return this; }, json(c) { r.cuerpo = c; return this; } } }); };

        // Otro usuario (token) intentando con usuarioId del dueño en la URL: 404, nada se detiene.
        const ajeno = responder();
        await admin.eliminar({ params: { id: SES }, query: { usuarioId: DUENIO }, body: {}, usuarioId: OTRO }, ajeno.res);
        assert.strictEqual(ajeno.status, 404);
        assert.deepStrictEqual(detenidas, []);

        // El dueño (token), aunque la URL diga otro usuario: se elimina la suya.
        const propio = responder();
        await admin.eliminar({ params: { id: SES }, query: { usuarioId: OTRO }, body: {}, usuarioId: DUENIO }, propio.res);
        assert.strictEqual(propio.status, 200, JSON.stringify(propio.cuerpo));
        assert.deepStrictEqual(detenidas, [`stop-${SES}`, "sin-creds.update"]);
        assert.strictEqual(borrados.length, 1);
        assert.strictEqual(borrados[0].id, SES);
    });

    restaurarTimers();
    Object.assign(console, originales);

    salida(`\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);

    process.exit(falla > 0 ? 1 : 0);

})();
