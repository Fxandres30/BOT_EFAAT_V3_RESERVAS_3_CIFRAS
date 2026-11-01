// ==========================================================================
// PRUEBAS DE INTEGRACIÓN — pago de reservas «externas» (1/11/2026).
//
// REGLA: una reserva válida (estado 'reservado' en la cuadrícula del
// cliente) se marca pagada desde el panel venga de donde venga: WhatsApp de
// OTRO grupo, otro evento_id, otra identidad (ciclo anterior), reserva
// manual «sin sorteo» o anticipada de un sorteo programado. El pago no
// cambia su identidad histórica y el recaudo cuenta en la tabla real.
//
// ERROR ORIGINAL reproducido: sin sorteo activo del precio, el pago por
// LOTE las omitía como «Es de otro sorteo: no se tocó» (otro_sorteo) y el
// panel ni siquiera las enviaba salvo casilla expresa, mientras el pago de
// UN número sí funcionaba.
//
// No basta con «ok»: cada caso comprueba la fila guardada, los contadores
// del sorteo, el recaudo con la función REAL del panel
// (frontend/services/tablas/resumenTabla.ts) y el saldo del cliente con la
// respuesta REAL de «¿qué debo?» (resolverConsulta.js).
//
// Rutas y servicio REALES (routes/tablas.js -> reservaManual.js) sobre
// Supabase en memoria; flujo del panel con pagoLote.ts/seleccionTabla.ts
// REALES transpilados con el TypeScript del frontend. Sin WhatsApp.
//
//     node backend/tests/reservas/pagoReservasExternas.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const FRONT = path.resolve(RAIZ, "../frontend");
const inyectar = (rel, exp) => { const abs = path.join(RAIZ, rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

// ---------------------------------------------------- módulos del panel ---
const ts = require(path.join(FRONT, "node_modules/typescript"));
function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const requerir = (id) => id.startsWith(".") ? cargarTs(path.resolve(path.dirname(rutaAbs), `${id}.ts`)) : require(id);
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}
const { calcularResumenTabla } = cargarTs(path.join(FRONT, "services/tablas/resumenTabla.ts"));
const { clasificarOperacion, cuerpoDelLote } = cargarTs(path.join(FRONT, "services/tablas/pagoLote.ts"));
const { esDeOtroSorteo } = cargarTs(path.join(FRONT, "services/tablas/seleccionTabla.ts"));

// ------------------------------------------------------------- entorno ---
const fake = crearFake();
inyectar("lib/supabase.js", fake.client);
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { throw new Error("WhatsApp no debe usarse"); } }));

const { resolverConsulta } = require(path.join(RAIZ, "bot/funciones/consultas/resolverConsulta.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";   // cliente (tenant) dueño de la tabla
const B = "bbbbbbbb-0000-4000-8000-00000000000b";   // otro tenant, misma tabla física
const T = "5k_15k_reservas_2_cifras";
const PRECIO = 5000;
const C1 = "c1c1c1c1-0000-4000-8000-000000000001";  // comprador de las reservas externas
const C2 = "c2c2c2c2-0000-4000-8000-000000000002";  // otro comprador
const EV = "e0000000-0000-4000-8000-0000000000a1";  // sorteo activo, grupo g1
const EV_G2 = "e0000000-0000-4000-8000-0000000000a2"; // fila de OTRO sorteo en g2
fake.tokens["jwt-A"] = { id: A, email: "dueno@a.co" };

const NUMEROS = Array.from({ length: 30 }, (_, i) => String(i).padStart(2, "0"));
const fila = (u, n) => fake.tablas[T].find(f => f.usuario_id === u && f.numero === n);

// Las cinco procedencias del error original (todas de C1, todas 'reservado').
const EXTERNAS = {
    "10": { grupo_id: "g2@g.us", grupo_nombre: "Grupo 2", evento_id: EV_G2, identidad_evento_real: "id-otro-sorteo", origen: "WhatsApp de otro grupo / otro sorteo" },
    "11": { grupo_id: null, grupo_nombre: null, evento_id: null, identidad_evento_real: null, origen: "manual «sin sorteo»" },
    "12": { grupo_id: "g1@g.us", grupo_nombre: "Grupo 1", evento_id: null, identidad_evento_real: "id-programado", origen: "anticipada de un programado" },
    "13": { grupo_id: "g1@g.us", grupo_nombre: "Grupo 1", evento_id: "e-viejo", identidad_evento_real: "id-ciclo-anterior", origen: "ciclo anterior conservado" },
    "14": { grupo_id: "g3@g.us", grupo_nombre: "Grupo 3", evento_id: "e-g3", identidad_evento_real: null, origen: "otro grupo sin identidad" }
};
const LISTA = Object.keys(EXTERNAS);

function sembrar({ conSorteoActivo = true } = {}) {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.fallarTabla = null;
    fake.control.antesDeEscribir = null;
    fake.tablas[T] = [A, B].flatMap(u => NUMEROS.map(numero => ({ id: `${u}-${numero}`, usuario_id: u, numero, estado: "libre" })));
    for (const [n, origen] of Object.entries(EXTERNAS)) {
        const { origen: _o, ...cols } = origen;
        Object.assign(fila(A, n), { estado: "reservado", usuario_global_id: C1, comprador: "María", telefono: "3001112233", contacto: "3001112233", fecha_reserva: "2026-10-30", hora_reserva: "09:00:00", ...cols });
    }
    // Ya pagado de antes (cuenta en el recaudo) y una reserva de OTRO comprador.
    Object.assign(fila(A, "20"), { estado: "pagado", usuario_global_id: C2, comprador: "Juan", telefono: "3104445566", identidad_evento_real: "id-activo", evento_id: EV, grupo_id: "g1@g.us", fecha_pago: "2026-10-31", hora_pago: "10:00:00" });
    Object.assign(fila(A, "21"), { estado: "reservado", usuario_global_id: C2, comprador: "Juan", telefono: "3104445566", identidad_evento_real: "id-activo", evento_id: EV, grupo_id: "g1@g.us" });
    // El mismo número en la cuadrícula de OTRO tenant: nunca se toca.
    Object.assign(fila(B, "10"), { estado: "reservado", usuario_global_id: C1, telefono: "3001112233" });
    const evento = (id, grupo, identidad, extra = {}) => ({
        id, usuario_id: A, tabla: T, activo: true, estado: "abierto", valor: String(PRECIO), cifras: 2, cantidad_numeros: 30,
        grupo_id: grupo, grupo_nombre: grupo, identidad_evento_real: identidad, nombre_evento: "Cauca",
        fecha_evento: "2999-01-01", hora_cierre: "23:59", hora_fin: "23:59", creado_en: "2026-11-01T10:00:00Z",
        reservados: 0, pagados: 0, pendientes: 0, libres: 0, ...extra
    });
    fake.tablas.eventos_bot = [
        evento(EV, "g1@g.us", "id-activo", conSorteoActivo ? {} : { activo: false, estado: "cerrado", cierre_estado: "cerrado" }),
        evento(EV_G2, "g2@g.us", "id-otro-sorteo", { activo: false, estado: "cerrado", cierre_estado: "cerrado", creado_en: "2026-10-30T10:00:00Z" })
    ];
    fake.tablas.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: A, grupo_id: "g2@g.us", activo: true }];
    fake.tablas.usuarios = [{ id: C1, nombre: "María", telefono: "3001112233", lid: null }, { id: C2, nombre: "Juan", telefono: "3104445566", lid: null }];
    fake.tablas.contactos_tenant = [];
    fake.tablas.reservas_actividad = [];
    fake.tablas.reservas_auditoria = [];
    require("../../services/reservaManual").olvidarDirectorio();
    require("../../bot/funciones/grupos/politicaGrupos").olvidarAutorizacion();
}

const express = require("express");
const app = express();
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));
let base;

function pedir(ruta, cuerpo) {
    return new Promise((resolve, reject) => {
        const datos = JSON.stringify(cuerpo);
        const req = http.request(base + ruta, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos), "x-service-token": process.env.SESSIONS_API_TOKEN, Authorization: "Bearer jwt-A" }
        }, res => { let d = ""; res.on("data", c => { d += c; }); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") })); });
        req.on("error", reject);
        req.write(datos);
        req.end();
    });
}

const pagarUno = (numero, solicitudId) => pedir(`/tablas/${PRECIO}/numeros/${numero}/pagar`, { metodoPago: "Nequi", solicitudId });

// El panel: estado de cada número tal como lo ve TablaPrecioView (otroSorteo
// = ocupado sin sorteo activo del precio), clasificación y cuerpo del lote.
function lotePanel(numeros, solicitudId) {
    const activo = fake.tablas.eventos_bot.find(e => e.usuario_id === A && e.activo && Number(e.valor) === PRECIO) || null;
    const seleccionables = fake.tablas[T].filter(f => f.usuario_id === A).map(f => ({
        numero: f.numero, estado: f.estado, ...(esDeOtroSorteo(f, activo) ? { otroSorteo: true } : {})
    }));
    const { incluidos, excluidos } = clasificarOperacion(seleccionables, numeros, "pagar");   // sin casilla alguna
    return { incluidos, excluidos, envio: pedir(`/tablas/${PRECIO}/lote`, cuerpoDelLote("pagar", incluidos, { metodoPago: "Efectivo" }, solicitudId)) };
}

// Lo que el pago NUNCA puede cambiar (todo salvo estado y fecha/hora de pago).
const origen = (n) => { const { estado, fecha_pago, hora_pago, ...resto } = fila(A, n); return JSON.stringify(resto); };
const recaudo = () => {
    const activo = fake.tablas.eventos_bot.find(e => e.usuario_id === A && e.activo) || null;
    return calcularResumenTabla(fake.tablas[T].filter(f => f.usuario_id === A).map(f => ({ estado: f.estado })), PRECIO, activo);
};
const saldo = async () => resolverConsulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente", evento: fake.tablas.eventos_bot.find(e => e.id === EV), usuario: { id: C1, telefono: "3001112233" } });

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- pruebas ---

prueba("0. punto de partida: «¿qué debo?» de María lista sus 5 reservas externas ($25.000) y el recaudo solo el pagado de antes", async () => {
    sembrar();
    const s = await saldo();
    assert.deepStrictEqual(s.reservados.slice().sort(), LISTA);
    assert.strictEqual(s.montoPendiente, 25000);
    assert.deepStrictEqual([recaudo().pagados, recaudo().recaudo], [1, 5000]);
});

prueba("1. ERROR ORIGINAL (sin sorteo activo del precio): el lote del panel paga las 5 externas — antes «otro_sorteo», no se tocaban", async () => {
    sembrar({ conSorteoActivo: false });
    const antes = Object.fromEntries(LISTA.map(n => [n, origen(n)]));
    const { incluidos, excluidos, envio } = lotePanel(LISTA, "lote-sin-sorteo");
    assert.deepStrictEqual(incluidos.map(n => n.numero), LISTA, "el panel las incluye sin casilla expresa");
    assert.deepStrictEqual(excluidos, []);
    const r = await envio;
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.hechos, r.json.omitidos, r.json.errores], [5, 0, 0], JSON.stringify(r.json.resultados));
    assert.ok(!r.json.resultados.some(x => x.codigo === "otro_sorteo"));
    for (const n of LISTA) {
        assert.strictEqual(fila(A, n).estado, "pagado", `${n} (${EXTERNAS[n].origen}) guardado como pagado`);
        assert.ok(fila(A, n).fecha_pago && fila(A, n).hora_pago, `${n}: fecha y hora de pago`);
        assert.strictEqual(origen(n), antes[n], `${n}: identidad histórica intacta`);
    }
    assert.deepStrictEqual(fake.tablas.reservas_actividad.filter(a => a.tipo === "pagado").map(a => a.numero).sort(), LISTA, "una actividad de pago por número");
    assert.strictEqual((await saldo()).montoPendiente, 0, "el saldo de María queda en $0");
});

prueba("2. con sorteo activo: pago INDIVIDUAL de cada externa -> guardado, contadores del sorteo y recaudo al día tras cada pago", async () => {
    sembrar();
    for (const [i, n] of LISTA.entries()) {
        const antes = origen(n);
        const r = await pagarUno(n, `uno-${n}`);
        assert.strictEqual(r.status, 200, `${n} (${EXTERNAS[n].origen}): ${JSON.stringify(r.json)}`);
        assert.strictEqual(fila(A, n).estado, "pagado", n);
        assert.strictEqual(origen(n), antes, `${n}: origen intacto`);
        const ev = fake.tablas.eventos_bot.find(e => e.id === EV);
        assert.strictEqual(ev.pagados, i + 2, `${n}: contador de pagados del sorteo (incluye el pagado de antes)`);
        assert.strictEqual(recaudo().recaudo, (i + 2) * PRECIO, `${n}: recaudo del panel`);
    }
    const s = await saldo();
    assert.deepStrictEqual([s.reservados, s.montoPendiente, s.estadoPago], [[], 0, "pago_completo"], "María al día");
    assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === EV_G2).pagados, 0, "el sorteo cerrado de g2 no recibe el recaudo: cuenta la TABLA del sorteo activo");
});

prueba("3. con sorteo activo: pago por LOTE de las 5 externas desde el panel -> recaudo $30.000 en la tabla real, contadores y saldo", async () => {
    sembrar();
    const { envio } = lotePanel(LISTA, "lote-activo");
    const r = await envio;
    assert.strictEqual(r.json.hechos, 5, JSON.stringify(r.json.resultados));
    assert.ok(LISTA.every(n => fila(A, n).estado === "pagado"));
    const ev = fake.tablas.eventos_bot.find(e => e.id === EV);
    assert.deepStrictEqual([ev.pagados, ev.reservados], [6, 1], "6 pagados (5 + el de antes), 1 reservado (Juan)");
    assert.deepStrictEqual([recaudo().pagados, recaudo().recaudo], [6, 30000]);
    assert.strictEqual((await saldo()).montoPendiente, 0);
});

prueba("4. pago parcial: pagar 2 de 5 deja el saldo exacto ($15.000) y el recaudo sube solo por lo pagado", async () => {
    sembrar();
    await pagarUno("10", "p-10");
    const r = await lotePanel(["11"], "p-11").envio;
    assert.strictEqual(r.json.hechos, 1);
    const s = await saldo();
    assert.deepStrictEqual([s.reservados.slice().sort(), s.montoPendiente, s.estadoPago], [["12", "13", "14"], 15000, "pago_parcial"]);
    assert.strictEqual(recaudo().recaudo, 3 * PRECIO);
});

prueba("5. protección contra duplicados: repetir el lote y el pago individual no duplica pagos, actividad ni recaudo", async () => {
    sembrar();
    await lotePanel(LISTA, "dup-1").envio;
    const foto = JSON.stringify([fake.tablas[T], fake.tablas.reservas_actividad.length]);
    // El panel ya no los volvería a enviar (están pagados): se fuerza al servidor.
    assert.deepStrictEqual(lotePanel(LISTA, "dup-panel").incluidos, [], "el panel excluye los ya pagados");
    const otra = await pedir(`/tablas/${PRECIO}/lote`, { accion: "pagar", numeros: LISTA, solicitudId: "dup-2" });
    assert.deepStrictEqual([otra.json.hechos, otra.json.sinCambio], [0, 5]);
    const reintento = await pedir(`/tablas/${PRECIO}/lote`, { accion: "pagar", numeros: LISTA, solicitudId: "dup-1" });
    assert.strictEqual(reintento.json.hechos, 0, "reintentar el MISMO lote no duplica");
    const uno = await pagarUno("10", "dup-uno");
    assert.strictEqual(uno.json.ok, false, "un número ya pagado no se vuelve a pagar");
    assert.strictEqual(JSON.stringify([fake.tablas[T], fake.tablas.reservas_actividad.length]), foto);
    assert.strictEqual(recaudo().recaudo, 6 * PRECIO);
});

prueba("6. dos lotes simultáneos con los mismos números: cada pago se registra UNA vez", async () => {
    sembrar();
    const [r1, r2] = await Promise.all([lotePanel(LISTA, "c-1").envio, lotePanel(LISTA, "c-2").envio]);
    assert.strictEqual(r1.json.hechos + r2.json.hechos, 5);
    assert.deepStrictEqual(fake.tablas.reservas_actividad.filter(a => a.tipo === "pagado").map(a => a.numero).sort(), LISTA);
});

prueba("7. protección contra usuarios equivocados: la cuadrícula de otro tenant y los no reservados nunca se pagan", async () => {
    sembrar({ conSorteoActivo: false });
    Object.assign(fila(A, "15"), { estado: "bloqueado" });
    const otroTenant = JSON.stringify(fake.tablas[T].filter(f => f.usuario_id === B));
    const r = await pedir(`/tablas/${PRECIO}/lote`, { accion: "pagar", numeros: ["10", "15", "16", "29"], solicitudId: "x" });
    const por = Object.fromEntries(r.json.resultados.map(x => [x.numero, x.estado]));
    assert.deepStrictEqual(por, { "10": "hecho", "15": "omitido", "16": "omitido", "29": "omitido" });
    assert.deepStrictEqual(["15", "16", "29"].map(n => fila(A, n).estado), ["bloqueado", "libre", "libre"], "un libre o bloqueado nunca pasa a pagado");
    assert.strictEqual(JSON.stringify(fake.tablas[T].filter(f => f.usuario_id === B)), otroTenant, "el 10 del otro tenant sigue reservado");
});

prueba("8. liberar (destructivo) conserva su protección: sin sorteo activo, un número de otro sorteo solo se libera si se incluye expresamente", async () => {
    sembrar({ conSorteoActivo: false });
    const antes = JSON.stringify(fila(A, "10"));
    const sin = await pedir(`/tablas/${PRECIO}/lote`, { accion: "liberar", confirmar: true, numeros: [{ numero: "10", estado: "reservado" }], solicitudId: "l1" });
    assert.strictEqual(sin.json.resultados[0].codigo, "otro_sorteo");
    assert.strictEqual(JSON.stringify(fila(A, "10")), antes);
    const activo = null;
    const seleccionables = fake.tablas[T].filter(f => f.usuario_id === A).map(f => ({ numero: f.numero, estado: f.estado, ...(esDeOtroSorteo(f, activo) ? { otroSorteo: true } : {}) }));
    assert.deepStrictEqual(clasificarOperacion(seleccionables, ["10"], "liberar").incluidos, [], "en el panel, liberar sigue pidiendo la casilla");
});

(async () => {
    const servidor = app.listen(0);
    await new Promise(r => servidor.once("listening", r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    const log = console.log, dir = console.dir, err = console.error;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        console.log = () => {}; console.dir = () => {}; console.error = () => {};
        try { await fn(); Object.assign(console, { log, dir, error: err }); ok++; console.log(`✅ ${n}`); }
        catch (e) { Object.assign(console, { log, dir, error: err }); falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    servidor.close();
    console.log(`\nPruebas: ${ok + falla}  |  OK: ${ok}  |  Fallidas: ${falla}`);
    process.exit(falla ? 1 : 0);
})();
