// ==========================================================================
// PRUEBAS — operaciones por lote de Tablas («Seleccionar» → pagar, liberar,
// desbloquear; y las acciones rápidas de un número, que usan lo mismo).
//
// El módulo del panel (frontend/services/tablas/pagoLote.ts:
// clasificarOperacion + procesarOperacion) se ejecuta tal cual contra la
// ruta HTTP REAL del lote (routes/tablas.js → reservaManual.js: operarLote),
// igual que hace el navegador con operarLote: UNA solicitud por lote.
// Supabase es un doble EN MEMORIA: no toca ninguna base real ni WhatsApp.
//
// Comprueba: reservas del bot, manuales sin teléfono y anticipadas (sin
// evento) se pagan; libres, pagados y bloqueados no se pagan; éxito parcial
// con el resultado real de cada número; reintento del mismo lote sin
// duplicar (con y sin la migración 032); propietario, grupo, evento y sorteo
// intactos; liberar/anular/desbloquear con confirmación, motivo cuando toca
// y nunca sobre un número que cambió entretanto.
//
//     node backend/tests/reservas/pagoLote.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const FRONT = path.resolve(RAIZ, "../frontend");

function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

// Módulo del panel, transpilado con el TypeScript del frontend (solo tipos
// importados: no necesita nada más).
function cargarTs(rutaAbs) {
    const ts = require(path.join(FRONT, "node_modules/typescript"));
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, require);
    return modulo.exports;
}

const { clasificarOperacion, procesarOperacion } = cargarTs(path.join(FRONT, "services/tablas/pagoLote.ts"));

process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T = "5k_15k_reservas_2_cifras";
const C1 = "c1c1c1c1-0000-4000-8000-000000000001";
const C2 = "c2c2c2c2-0000-4000-8000-000000000002";
const EV_A = "e0000000-0000-4000-8000-0000000000a1";
const IDENT_ACTIVO = "identidad-activo";
const IDENT_PROGRAMADO = "identidad-programado";

const fake = crearFake();
inyectar("lib/supabase.js", fake.client);
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { throw new Error("WhatsApp no debe usarse"); } }));
fake.tokens["jwt-A"] = { id: A, email: "dueno@a.co" };

const NUMEROS = Array.from({ length: 12 }, (_, i) => String(i).padStart(2, "0"));

function sembrar() {

    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.tablasInexistentes.clear();
    fake.control.fallarTabla = null;

    fake.tablas[T] = [A, B].flatMap(u => NUMEROS.map(numero => ({ id: `${u}-${numero}`, usuario_id: u, numero, estado: "libre" })));
    const de = (u, n) => fake.tablas[T].find(f => f.usuario_id === u && f.numero === n);

    // 01: reserva del BOT (con teléfono y evento del grupo).
    Object.assign(de(A, "01"), { estado: "reservado", usuario_global_id: C1, comprador: "María Pérez", telefono: "3001112233", contacto: "3001112233", lid: "111@lid", grupo_id: "gA@g.us", grupo_nombre: "Grupo A", evento_id: EV_A, identidad_evento_real: IDENT_ACTIVO, fecha_reserva: "2026-10-23", hora_reserva: "10:00:00" });
    // 02: reserva MANUAL de un contacto solo LID (sin teléfono).
    Object.assign(de(A, "02"), { estado: "reservado", usuario_global_id: C2, comprador: "Juan", telefono: null, contacto: null, lid: "222@lid", grupo_id: "gA@g.us", grupo_nombre: "Grupo A", evento_id: EV_A, identidad_evento_real: IDENT_ACTIVO, fecha_reserva: "2026-10-23", hora_reserva: "10:05:00" });
    // 03: reserva ANTICIPADA (sorteo programado sin publicar: sin evento).
    Object.assign(de(A, "03"), { estado: "reservado", usuario_global_id: C2, comprador: "Juan", telefono: "3104445566", contacto: "3104445566", grupo_id: "gA@g.us", evento_id: null, identidad_evento_real: IDENT_PROGRAMADO, fecha_reserva: "2026-10-23", hora_reserva: "10:10:00" });
    // 04: reserva sin teléfono NI nombre (solo su identidad).
    Object.assign(de(A, "04"), { estado: "reservado", usuario_global_id: C2, comprador: null, nombre: null, telefono: null, contacto: null, evento_id: EV_A, identidad_evento_real: IDENT_ACTIVO });
    // 06: ya pagado. 07: bloqueado. 00: libre.
    Object.assign(de(A, "06"), { estado: "pagado", usuario_global_id: C1, comprador: "María Pérez", evento_id: EV_A, identidad_evento_real: IDENT_ACTIVO, fecha_pago: "2026-10-22", hora_pago: "09:00:00" });
    Object.assign(de(A, "07"), { estado: "bloqueado", temporal_por: "apartado" });
    // El mismo número de OTRO cliente, reservado: nunca se toca.
    Object.assign(de(B, "01"), { estado: "reservado", usuario_global_id: C1, comprador: "María (B)", evento_id: "ev-b", identidad_evento_real: "idB" });

    fake.tablas.eventos_bot = [{
        id: EV_A, usuario_id: A, tabla: T, activo: true, estado: "abierto", valor: "5000", cifras: 2, cantidad_numeros: 100,
        grupo_id: "gA@g.us", grupo_nombre: "Grupo A", identidad_evento_real: IDENT_ACTIVO, nombre_evento: "Chontico",
        fecha_evento: "2999-01-01", hora_cierre: "23:59", hora_fin: "23:59", creado_en: "2026-10-22T10:00:00Z"
    }];
    fake.tablas.grupos_autorizados = [{ usuario_id: A, grupo_id: "gA@g.us", activo: true }];
    fake.tablas.reservas_actividad = [];
    fake.tablas.reservas_auditoria = [];

}

const express = require("express");
const app = express();
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));
let base;

function pedir(metodo, camino, cuerpo) {
    return new Promise((resolve, reject) => {
        const datos = cuerpo !== undefined ? JSON.stringify(cuerpo) : null;
        const headers = { "x-service-token": process.env.SESSIONS_API_TOKEN, Authorization: "Bearer jwt-A" };
        if (datos) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(datos); }
        const req = http.request(base + camino, { method: metodo, headers }, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        });
        req.on("error", reject);
        if (datos) req.write(datos);
        req.end();
    });
}

// Lo mismo que pagarNumeroManual + llamar() del panel: el cuerpo del
// backend, o { ok:false, motivo, mensaje, estadoActual } si rechaza.
let llamadas = [];

function comoPanel(r) {
    if (r.status < 400 && r.json?.ok !== false) return r.json;
    return { ok: false, motivo: r.json?.motivo || `http_${r.status}`, mensaje: r.json?.mensaje || "No se pudo completar la operación.", ...(r.json?.estadoActual ? { estadoActual: r.json.estadoActual } : {}) };
}

// La solicitud única del panel (reservaManual.ts → operarLote).
async function enviar(cuerpo) {
    llamadas.push(cuerpo);
    return comoPanel(await pedir("POST", "/tablas/5000/lote", cuerpo));
}

// Con los números de otro sorteo incluidos expresamente (como la casilla del
// diálogo): esta prueba verifica el pago de todos los tipos de reserva.
const procesar = (operacion, numeros, extra = {}) => procesarOperacion({
    operacion,
    incluidos: clasificarOperacion(estadoActual(), numeros, operacion, { incluirOtroSorteo: true }).incluidos,
    enviar: extra.enviar || enviar,
    datos: extra.datos || {},
    solicitudLote: extra.solicitudLote || `lote-${operacion}`
});
// Números que la clasificación excluiría, enviados a la fuerza: decide el servidor.
const procesarForzado = (operacion, numeros) => procesarOperacion({
    operacion,
    incluidos: numeros.map(numero => ({ numero, estado: operacion === "desbloquear" ? "bloqueado" : "reservado" })),
    enviar,
    solicitudLote: `lote-forzado-${operacion}`
});

const fila = (u, n) => fake.tablas[T].find(f => f.usuario_id === u && f.numero === n);
// Lo que NO puede cambiar al pagar: todo salvo estado y fecha/hora de pago.
const asociacion = (u, n) => { const { estado, fecha_pago, hora_pago, ...resto } = fila(u, n); return JSON.stringify(resto); };
const estadoActual = (u = A) => fake.tablas[T].filter(f => f.usuario_id === u).map(f => ({
    numero: f.numero, estado: f.estado,
    ...(["reservado", "pagado"].includes(f.estado) && f.identidad_evento_real !== IDENT_ACTIVO ? { otroSorteo: true } : {})
}));

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- pruebas ---

prueba("1. clasificación: solo los reservados se envían a pagar; libre, pagado y bloqueado se excluyen con su motivo", async () => {
    sembrar();
    const { incluidos, excluidos } = clasificarOperacion(estadoActual(), ["06", "01", "00", "07", "03", "01", "99"], "pagar", { incluirOtroSorteo: true });
    assert.deepStrictEqual(incluidos.map(n => n.numero), ["01", "03"]);
    // Sin marcarlo expresamente, el 03 (anticipada de otro sorteo) queda fuera.
    assert.deepStrictEqual(clasificarOperacion(estadoActual(), ["01", "03"], "pagar").incluidos.map(n => n.numero), ["01"]);
    assert.deepStrictEqual(excluidos.map(x => x.numero), ["00", "06", "07", "99"]);
    assert.match(excluidos.find(x => x.numero === "00").motivo, /libre/);
    assert.match(excluidos.find(x => x.numero === "06").motivo, /pagado/);
    assert.match(excluidos.find(x => x.numero === "07").motivo, /bloqueado/);
});

prueba("2. lote mixto: bot, manual sin teléfono, anticipada sin evento y sin nombre -> todos pagados; propietario y sorteo intactos", async () => {
    sembrar();
    llamadas = [];
    const antes = Object.fromEntries(["01", "02", "03", "04"].map(n => [n, asociacion(A, n)]));
    const deB = JSON.stringify(fake.tablas[T].filter(f => f.usuario_id === B));

    const r = await procesar("pagar", ["01", "02", "03", "04"], { datos: { metodoPago: "Nequi", observaciones: "Lote" }, solicitudLote: "lote-1" });

    assert.deepStrictEqual([r.hechos, r.sinCambio, r.omitidos, r.errores], [4, 0, 0, 0], JSON.stringify(r.resultados));
    for (const n of ["01", "02", "03", "04"]) {
        assert.strictEqual(fila(A, n).estado, "pagado", n);
        assert.ok(fila(A, n).fecha_pago, `${n}: fecha de pago`);
        assert.strictEqual(asociacion(A, n), antes[n], `${n}: propietario, grupo, evento e identidad sin cambios`);
    }
    assert.strictEqual(fila(A, "03").evento_id, null, "la anticipada sigue sin evento");
    assert.strictEqual(fila(A, "03").identidad_evento_real, IDENT_PROGRAMADO);
    assert.strictEqual(JSON.stringify(fake.tablas[T].filter(f => f.usuario_id === B)), deB, "el otro cliente no cambia");
    assert.strictEqual(llamadas.length, 1, "UNA solicitud para los 4 números");
    assert.deepStrictEqual([llamadas[0].numeros, llamadas[0].solicitudId], [["01", "02", "03", "04"], "lote-1"]);
    assert.deepStrictEqual(llamadas[0].otrosSorteoAutorizados, ["03"], "la anticipada va autorizada expresamente");
    const actividad = fake.tablas.reservas_actividad.filter(a => a.tipo === "pagado").map(a => a.numero).sort();
    assert.deepStrictEqual(actividad, ["01", "02", "03", "04"], "una actividad de pago por número");
    const metodos = fake.tablas.reservas_auditoria.filter(a => a.accion === "pagar" && a.resultado === "ok").map(a => a.metodo_pago);
    assert.deepStrictEqual(metodos, ["Nequi", "Nequi", "Nequi", "Nequi"], "el método del lote en cada pago");
});

prueba("3. libres, pagados y bloqueados forzados al pago: el servidor no los convierte; el resto sigue", async () => {
    sembrar();
    const r = await procesarForzado("pagar", ["00", "06", "07", "01"]);

    const por = Object.fromEntries(r.resultados.map(x => [x.numero, x]));
    assert.strictEqual(fila(A, "00").estado, "libre", "un libre nunca pasa a pagado");
    assert.strictEqual(por["00"].estado, "omitido");
    assert.strictEqual(por["06"].estado, "sin_cambio");
    assert.strictEqual(fila(A, "06").fecha_pago, "2026-10-22", "el pago anterior no se reescribe");
    assert.strictEqual(fila(A, "07").estado, "bloqueado");
    assert.strictEqual(por["07"].estado, "omitido");
    assert.strictEqual(por["01"].estado, "hecho");
    assert.deepStrictEqual([r.hechos, r.sinCambio, r.omitidos, r.errores], [1, 1, 2, 0]);
});

prueba("4. fallo de red: nada se da por hecho y un reintento del mismo lote termina el trabajo", async () => {
    sembrar();
    llamadas = [];
    const sinRed = async () => ({ ok: false, motivo: "red", mensaje: "Sin conexión con el panel." });
    const r = await procesar("pagar", ["01", "02", "03"], { enviar: sinRed, solicitudLote: "lote-red" });
    assert.deepStrictEqual(r.resultados.map(x => x.estado), ["error", "error", "error"]);
    assert.match(r.resultados[1].mensaje, /Sin conexión/);
    assert.strictEqual(fila(A, "02").estado, "reservado");
    const otra = await procesar("pagar", ["01", "02", "03"], { solicitudLote: "lote-red" });
    assert.deepStrictEqual(otra.resultados.map(x => x.estado), ["hecho", "hecho", "hecho"]);
    assert.strictEqual(llamadas.length, 1, "una solicitud para los 3");
});

prueba("5. otro operador paga un número entre la selección y el envío -> «sin cambios», sin segundo pago", async () => {
    sembrar();
    const { incluidos } = clasificarOperacion(estadoActual(), ["01", "02"], "pagar");
    await pedir("POST", "/tablas/5000/numeros/01/pagar", { solicitudId: "otro-operador" });
    const horaPrimera = fila(A, "01").hora_pago;

    const r = await procesarOperacion({ operacion: "pagar", incluidos, enviar, solicitudLote: "lote-4" });
    assert.deepStrictEqual(r.resultados.map(x => x.estado), ["sin_cambio", "hecho"]);
    assert.strictEqual(fila(A, "01").hora_pago, horaPrimera);
    assert.strictEqual(fake.tablas.reservas_actividad.filter(a => a.numero === "01" && a.tipo === "pagado").length, 1);
});

prueba("6. reintento del MISMO lote (respuesta perdida): sin duplicar, con la 032 (idempotente) y sin ella", async () => {
    for (const sin032 of [false, true]) {
        sembrar();
        if (sin032) fake.control.tablasInexistentes.add("reservas_auditoria");
        const incluidos = clasificarOperacion(estadoActual(), ["01", "02"], "pagar").incluidos;
        await procesarOperacion({ operacion: "pagar", incluidos, enviar, solicitudLote: "lote-5" });
        const otra = await procesarOperacion({ operacion: "pagar", incluidos, enviar, solicitudLote: "lote-5" });
        assert.deepStrictEqual(otra.resultados.map(x => x.estado), ["sin_cambio", "sin_cambio"], `sin032=${sin032}`);
        assert.strictEqual(otra.errores, 0);
        assert.strictEqual(fake.tablas.reservas_actividad.filter(a => a.tipo === "pagado").length, 2, `un solo pago por número (sin032=${sin032})`);
    }
});

prueba("7. liberar reservados y anular pagados: confirmación siempre, motivo para el pagado; registro de cada uno", async () => {
    sembrar();
    llamadas = [];

    // Sin motivo, el pagado se rechaza en el servidor y sigue pagado; el reservado sí se libera.
    const sinMotivo = await procesar("liberar", ["01", "06"], { solicitudLote: "lib-1" });
    const por = Object.fromEntries(sinMotivo.resultados.map(x => [x.numero, x]));
    assert.strictEqual(por["01"].estado, "hecho");
    assert.strictEqual(por["06"].estado, "error");
    assert.match(por["06"].mensaje, /motivo/);
    assert.strictEqual(fila(A, "06").estado, "pagado", "sin motivo no se anula un pago");
    assert.strictEqual(fila(A, "01").estado, "libre");
    assert.strictEqual(fila(A, "01").usuario_global_id, null, "liberar borra la reserva (comportamiento del detalle)");

    const conMotivo = await procesar("liberar", ["06"], { datos: { motivo: "Pago devuelto al cliente" }, solicitudLote: "lib-2" });
    assert.deepStrictEqual(conMotivo.resultados.map(x => x.estado), ["hecho"]);
    assert.strictEqual(fila(A, "06").estado, "libre");
    assert.ok(llamadas.every(l => l.confirmar === true), "nunca sin confirmar");
    const tipos = fake.tablas.reservas_actividad.filter(a => ["01", "06"].includes(a.numero)).map(a => `${a.numero}:${a.tipo}`).sort();
    assert.deepStrictEqual(tipos, ["01:liberado", "06:cancelado"]);
});

prueba("8. desbloquear: solo bloqueados; un reservado forzado no se toca", async () => {
    sembrar();
    const { incluidos, excluidos } = clasificarOperacion(estadoActual(), ["07", "01", "00"], "desbloquear");
    assert.deepStrictEqual(incluidos.map(n => n.numero), ["07"]);
    assert.deepStrictEqual(excluidos.map(x => x.numero), ["00", "01"]);

    const r = await procesarOperacion({ operacion: "desbloquear", incluidos, enviar, solicitudLote: "des-1" });
    assert.deepStrictEqual(r.resultados.map(x => x.estado), ["hecho"]);
    assert.strictEqual(fila(A, "07").estado, "libre");

    // Forzado: se clasificó «bloqueado», pero el servidor lo tiene reservado.
    const antes = JSON.stringify(fila(A, "01"));
    const forzado = await procesarForzado("desbloquear", ["01"]);
    assert.deepStrictEqual(forzado.resultados.map(x => x.estado), ["omitido"]);
    assert.strictEqual(JSON.stringify(fila(A, "01")), antes, "una reserva nunca se libera por «desbloquear»");
});

prueba("9. liberar un número que cambió entretanto (lo pagó el bot): omitido, el pago intacto", async () => {
    sembrar();
    const { incluidos } = clasificarOperacion(estadoActual(), ["02"], "liberar");
    assert.deepStrictEqual(incluidos, [{ numero: "02", estado: "reservado" }]);
    await pedir("POST", "/tablas/5000/numeros/02/pagar", { solicitudId: "pago-del-bot" });

    const r = await procesarOperacion({ operacion: "liberar", incluidos, enviar, solicitudLote: "lib-3" });
    assert.deepStrictEqual(r.resultados.map(x => x.estado), ["omitido"]);
    assert.match(r.resultados[0].mensaje, /Cambió de estado/);
    assert.strictEqual(fila(A, "02").estado, "pagado");
});

prueba("10. lote vacío: ninguna llamada al servidor", async () => {
    sembrar();
    llamadas = [];
    const r = await procesarOperacion({ operacion: "pagar", incluidos: [], enviar, solicitudLote: "lote-6" });
    assert.deepStrictEqual([r.resultados.length, llamadas.length], [0, 0]);
});

// ------------------------------------------------------------ ejecución ---

(async () => {
    const servidor = app.listen(0);
    await new Promise(r => servidor.once("listening", r));
    base = `http://127.0.0.1:${servidor.address().port}`;

    const { log, error, warn } = console;
    let ok = 0;
    for (const p of pruebas) {
        console.log = console.error = console.warn = () => {};
        try { await p.fn(); ok++; log(`✅ ${p.n}`); }
        catch (e) { log(`❌ ${p.n}\n   ${e.stack?.split("\n").slice(0, 3).join("\n   ")}`); }
        finally { Object.assign(console, { log, error, warn }); }
    }
    console.log("============================");
    console.log(`TOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}`);
    console.log("============================");
    servidor.close();
    process.exit(ok === pruebas.length ? 0 : 1);
})();
