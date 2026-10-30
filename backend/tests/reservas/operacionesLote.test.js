// ==========================================================================
// PRUEBAS — operaciones por lote de Tablas (POST /tablas/:precio/lote): una
// solicitud y una escritura para varios números, con las reglas de un número.
//
//   - Reservar / pagar / liberar: un solo UPDATE y un insert de actividad y
//     de auditoría; contacto, grupo y sorteo correctos.
//   - Resultados parciales con el motivo de cada número.
//   - Concurrencia: dos lotes solapados, y un número tomado entre la lectura
//     y el UPDATE; ningún número se reserva dos veces.
//   - Reintento del mismo lote: no duplica.
//   - Otro sorteo y otro cliente: nunca se tocan sin autorización expresa.
//   - Pago: el disparador de compradores aborta la sentencia entera si una
//     fila no tiene teléfono; los demás pagos no se pierden.
//
// Ruta y servicio REALES sobre Supabase en memoria. Sin WhatsApp.
//
//     node backend/tests/reservas/operacionesLote.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T = "5k_15k_reservas_2_cifras";
const C1 = "c1c1c1c1-0000-4000-8000-000000000001";
const C2 = "c2c2c2c2-0000-4000-8000-000000000002";
const EV = "e0000000-0000-4000-8000-0000000000a1";
const EV2 = "e0000000-0000-4000-8000-0000000000a2";
const SIN_TELEFONO = new Set();

const fake = crearFake();

// Como Postgres: si el disparador falla en UNA fila, la sentencia entera se
// aborta y ninguna cambia.
function conDisparador(tabla, b) {
    const q = {};
    const envuelto = new Proxy(b, {
        get(t, k) {
            if (k === "then") {
                return (ok, ko) => {
                    if (tabla === T && q.pago && (q.numeros || []).some(n => SIN_TELEFONO.has(n))) {
                        return Promise.resolve({ data: null, error: { code: "23502", message: 'null value in column "whatsapp" of relation "compradores_semanales"' } }).then(ok, ko);
                    }
                    return t.then(ok, ko);
                };
            }
            const v = t[k];
            if (typeof v !== "function") return v;
            return (...a) => {
                if (k === "update" && a[0]?.estado === "pagado") q.pago = true;
                if (k === "in" && a[0] === "numero") q.numeros = a[1];
                const r = v.apply(t, a);
                return r === t ? envuelto : r;
            };
        }
    });
    return envuelto;
}

inyectar("lib/supabase.js", { ...fake.client, from: (t) => conDisparador(t, fake.client.from(t)) });
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { throw new Error("WhatsApp no debe usarse"); } }));

fake.tokens["jwt-A"] = { id: A, email: "dueno@a.co" };
fake.tokens["jwt-B"] = { id: B, email: "dueno@b.co" };

const NUMEROS = Array.from({ length: 30 }, (_, i) => String(i).padStart(2, "0"));
const fila = (u, n) => fake.tablas[T].find(f => f.usuario_id === u && f.numero === n);
const ocupar = (u, n, extra = {}) => Object.assign(fila(u, n), {
    estado: "reservado", usuario_global_id: C2, comprador: "Juan", telefono: "3104445566", contacto: "3104445566",
    grupo_id: "g1@g.us", evento_id: EV, identidad_evento_real: "idA", fecha_reserva: "2026-10-22", hora_reserva: "08:00:00", ...extra
});

function sembrar() {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.fallarTabla = null;
    fake.control.antesDeEscribir = null;
    fake.control.llamadas.length = 0;
    SIN_TELEFONO.clear();
    fake.tablas[T] = [A, B].flatMap(u => NUMEROS.map(numero => ({ id: `${u}-${numero}`, usuario_id: u, numero, estado: "libre" })));
    const evento = (id, usuario, grupo, identidad, extra = {}) => ({
        id, usuario_id: usuario, tabla: T, activo: true, estado: "abierto", valor: "5000", cifras: 2, cantidad_numeros: 30,
        grupo_id: grupo, grupo_nombre: `Grupo ${grupo}`, identidad_evento_real: identidad, nombre_evento: "Chontico",
        fecha_evento: "2999-01-01", hora_cierre: "23:59", hora_fin: "23:59", telefono_bot: "573000000000", creado_en: "2026-10-22T10:00:00Z", ...extra
    });
    fake.tablas.eventos_bot = [evento(EV, A, "g1@g.us", "idA"), evento(EV2, A, "g2@g.us", "idA"), evento("e0000000-0000-4000-8000-0000000000b1", B, "gb@g.us", "idB")];
    fake.tablas.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: A, grupo_id: "g2@g.us", activo: true }, { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    fake.tablas.usuarios = [{ id: C1, nombre: "María", telefono: "3001112233", lid: null }, { id: C2, nombre: "Juan", telefono: "3104445566", lid: null }];
    fake.tablas.contactos_tenant = [{ usuario_id: A, usuario_global_id: C1, ultimo_visto_en: "2026-10-22T09:00:00Z" }, { usuario_id: A, usuario_global_id: C2, ultimo_visto_en: "2026-10-22T09:00:00Z" }];
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

function pedir(cuerpo, { token = "jwt-A", servicio = true, ruta = "/tablas/5000/lote" } = {}) {
    return new Promise((resolve, reject) => {
        const datos = JSON.stringify(cuerpo);
        const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) };
        if (servicio) headers["x-service-token"] = process.env.SESSIONS_API_TOKEN;
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request(base + ruta, { method: "POST", headers }, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        });
        req.on("error", reject);
        req.write(datos);
        req.end();
    });
}

const RESERVA = { accion: "reservar", contactoId: C1, eventoId: EV, motivo: "Reserva por llamada", solicitudId: "lote-1" };
const estados = (r) => Object.fromEntries(r.json.resultados.map(x => [x.numero, x.estado]));
const escrituras = (t, op) => fake.control.llamadas.filter(l => l.tabla === t && l.op === op).length;
const auditoria = () => fake.tablas.reservas_auditoria;
const foto = (u, numeros) => JSON.stringify(numeros.map(n => ({ ...fila(u, n) })));

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("reservar 20: una sola escritura en la tabla, contacto, grupo y sorteo correctos; una auditoría por número", async () => {
    sembrar();
    const lista = NUMEROS.slice(0, 20);
    const r = await pedir({ ...RESERVA, numeros: lista });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.hechos, r.json.omitidos, r.json.errores], [20, 0, 0]);
    assert.strictEqual(escrituras(T, "update"), 1, "un solo UPDATE aunque sean 20 números");
    assert.strictEqual(escrituras("reservas_actividad", "insert"), 1);
    assert.strictEqual(escrituras("reservas_auditoria", "insert"), 1);
    for (const n of lista) {
        const f = fila(A, n);
        assert.deepStrictEqual([f.estado, f.usuario_global_id, f.evento_id, f.identidad_evento_real, f.grupo_id], ["reservado", C1, EV, "idA", "g1@g.us"], n);
    }
    assert.strictEqual(auditoria().filter(a => a.accion === "reservar" && a.resultado === "ok").length, 20);
    assert.ok(auditoria().every(a => a.operador_email === "dueno@a.co" && a.motivo === "Reserva por llamada"));
    assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === EV).reservados, 20, "contadores del sorteo al día");
    assert.strictEqual(fila(B, "00").estado, "libre", "la cuadrícula de otro cliente no se toca");
});

prueba("resultado parcial: ocupados, pagados e inexistentes se informan y los libres se reservan", async () => {
    sembrar();
    ocupar(A, "02");
    ocupar(A, "03", { estado: "pagado" });
    Object.assign(fila(A, "04"), { estado: "bloqueado" });
    const antes = foto(A, ["02", "03", "04"]);
    const r = await pedir({ ...RESERVA, numeros: ["00", "01", "02", "03", "04", "77"] });
    assert.deepStrictEqual(estados(r), { "00": "hecho", "01": "hecho", "02": "omitido", "03": "omitido", "04": "omitido", "77": "error" });
    assert.match(r.json.resultados.find(x => x.numero === "03").mensaje, /está pagado/);
    assert.strictEqual(r.json.resultados.find(x => x.numero === "77").codigo, "numero_inexistente");
    assert.strictEqual(foto(A, ["02", "03", "04"]), antes);
    assert.strictEqual(auditoria().filter(a => a.resultado === "rechazado" && a.codigo === "no_disponible").length, 3, "los rechazos quedan auditados");
});

prueba("carrera: un número tomado entre la lectura y el UPDATE se informa y no se pisa", async () => {
    sembrar();
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== T) return;
        fake.control.antesDeEscribir = null;
        ocupar(A, "02");
    };
    const r = await pedir({ ...RESERVA, numeros: ["01", "02", "03"] });
    assert.deepStrictEqual(estados(r), { "01": "hecho", "02": "omitido", "03": "hecho" });
    assert.match(r.json.resultados.find(x => x.numero === "02").mensaje, /Ya no estaba libre \(ahora está reservado\)/);
    assert.strictEqual(fila(A, "02").usuario_global_id, C2, "sigue siendo de quien lo tomó primero");
});

prueba("concurrencia: dos lotes simultáneos que se solapan; cada número queda con un solo dueño", async () => {
    sembrar();
    const [r1, r2] = await Promise.all([
        pedir({ ...RESERVA, numeros: ["10", "11", "12", "13"], contactoId: C1, solicitudId: "x1" }),
        pedir({ ...RESERVA, numeros: ["12", "13", "14", "15"], contactoId: C2, eventoId: EV2, solicitudId: "x2" })
    ]);
    const ok = auditoria().filter(a => a.accion === "reservar" && a.resultado === "ok");
    assert.deepStrictEqual(ok.map(a => a.numero).sort(), ["10", "11", "12", "13", "14", "15"], "cada número reservado UNA vez");
    assert.strictEqual(r1.json.hechos + r2.json.hechos, 6);
    assert.strictEqual(r1.json.omitidos + r2.json.omitidos, 2, "los dos solapados se informan al que perdió");
    for (const n of ["12", "13"]) {
        const dueno = fila(A, n).usuario_global_id;
        const ganador = dueno === C1 ? r1 : r2;
        assert.strictEqual(estados(ganador)[n], "hecho", n);
    }
});

prueba("reintento del mismo lote: lo ya reservado vuelve «sin cambio» y nada se duplica", async () => {
    sembrar();
    await pedir({ ...RESERVA, numeros: ["00", "01"] });
    const r = await pedir({ ...RESERVA, numeros: ["00", "01", "02"] });
    assert.deepStrictEqual(estados(r), { "00": "sin_cambio", "01": "sin_cambio", "02": "hecho" });
    assert.strictEqual(auditoria().filter(a => a.resultado === "ok").length, 3);
});

prueba("rechazos generales: sorteo cerrado, sin motivo, contacto ajeno o lote inválido no tocan nada", async () => {
    sembrar();
    fake.tablas.eventos_bot.filter(e => e.usuario_id === A).forEach(e => { e.hora_cierre = "00:00"; e.fecha_evento = "2000-01-01"; });
    const cerrado = await pedir({ ...RESERVA, numeros: ["00", "01"] });
    assert.strictEqual(cerrado.json.motivo, "sorteo_cerrado");
    assert.strictEqual(auditoria().filter(a => a.codigo === "sorteo_cerrado").length, 2, "auditado por número");
    sembrar();
    assert.strictEqual((await pedir({ ...RESERVA, numeros: ["00"], motivo: "" })).json.motivo, "falta_motivo");
    assert.strictEqual((await pedir({ ...RESERVA, numeros: ["00"], contactoId: "c9c9c9c9-0000-4000-8000-000000000009" })).json.motivo, "contacto_no_existe");
    assert.strictEqual((await pedir({ ...RESERVA, numeros: [] })).json.motivo, "sin_numeros");
    assert.strictEqual((await pedir({ ...RESERVA, numeros: ["1'; drop"] })).json.motivo, "numero_invalido");
    assert.strictEqual((await pedir({ ...RESERVA, numeros: Array.from({ length: 1001 }, (_, i) => String(i)) })).json.motivo, "lote_grande");
    assert.strictEqual((await pedir({ accion: "borrar", numeros: ["00"] })).json.motivo, "accion_invalida");
    assert.ok(fake.tablas[T].every(f => f.estado === "libre"));
});

prueba("seguridad: sin sesión no entra y el cliente sale del token, no del cuerpo", async () => {
    sembrar();
    assert.strictEqual((await pedir({ ...RESERVA, numeros: ["00"] }, { token: null })).status, 401);
    assert.strictEqual((await pedir({ ...RESERVA, numeros: ["00"] }, { servicio: false })).status, 401);
    await pedir({ ...RESERVA, numeros: ["00"], usuarioId: B });
    assert.strictEqual(fila(A, "00").estado, "reservado");
    assert.strictEqual(fila(B, "00").estado, "libre");
    // El evento de A no sirve para la cuadrícula de B.
    const r = await pedir({ ...RESERVA, numeros: ["01"] }, { token: "jwt-B" });
    assert.ok(!r.json.ok, JSON.stringify(r.json));
    assert.strictEqual(fila(B, "01").estado, "libre");
});

prueba("pagar 10: una sola escritura; ya pagado «sin cambio», no reservado omitido; sin tocar propietario ni sorteo", async () => {
    sembrar();
    const lista = NUMEROS.slice(0, 10);
    lista.forEach(n => ocupar(A, n));
    ocupar(A, "10", { estado: "pagado", fecha_pago: "2026-10-01" });
    const r = await pedir({ accion: "pagar", numeros: [...lista, "10", "20"], metodoPago: "Nequi", observaciones: "ref", solicitudId: "p1" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.hechos, r.json.sinCambio, r.json.omitidos], [10, 1, 1]);
    assert.strictEqual(escrituras(T, "update"), 1);
    assert.strictEqual(escrituras("reservas_actividad", "insert"), 1);
    assert.strictEqual(fila(A, "10").fecha_pago, "2026-10-01", "el pagado no se reescribe");
    assert.strictEqual(fila(A, "20").estado, "libre", "un libre nunca pasa a pagado");
    for (const n of lista) {
        const f = fila(A, n);
        assert.deepStrictEqual([f.estado, f.usuario_global_id, f.evento_id, f.identidad_evento_real], ["pagado", C2, EV, "idA"], n);
    }
    assert.ok(auditoria().filter(a => a.accion === "pagar" && a.resultado === "ok").every(a => a.metodo_pago === "Nequi" && a.observaciones === "ref"));
    assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === EV).pagados, 11, "los 10 de ahora + el que ya estaba pagado");
});

prueba("pago sin teléfono: el disparador aborta la sentencia, pero los demás pagos no se pierden", async () => {
    sembrar();
    ["00", "01", "02"].forEach(n => ocupar(A, n));
    SIN_TELEFONO.add("01");
    const r = await pedir({ accion: "pagar", numeros: ["00", "01", "02"], solicitudId: "p2" });
    assert.deepStrictEqual(estados(r), { "00": "hecho", "01": "error", "02": "hecho" });
    assert.strictEqual(r.json.resultados.find(x => x.numero === "01").codigo, "pago_sin_telefono");
    assert.strictEqual(fila(A, "01").estado, "reservado");
    assert.deepStrictEqual([fila(A, "00").estado, fila(A, "02").estado], ["pagado", "pagado"]);
    assert.strictEqual(auditoria().filter(a => a.resultado === "error" && a.codigo === "pago_sin_telefono").length, 1);
});

prueba("otro sorteo: pagar y liberar no lo tocan salvo autorización expresa de ese número", async () => {
    sembrar();
    ocupar(A, "00");
    ocupar(A, "01", { evento_id: "ev-viejo", identidad_evento_real: "viejo" });
    const antes = foto(A, ["01"]);
    const p = await pedir({ accion: "pagar", numeros: ["00", "01"], solicitudId: "p3" });
    assert.deepStrictEqual(estados(p), { "00": "hecho", "01": "omitido" });
    assert.strictEqual(p.json.resultados.find(x => x.numero === "01").codigo, "otro_sorteo");
    const l = await pedir({ accion: "liberar", confirmar: true, numeros: [{ numero: "01", estado: "reservado" }], solicitudId: "l3" });
    assert.strictEqual(estados(l)["01"], "omitido");
    assert.strictEqual(foto(A, ["01"]), antes, "intacto");
    const a = await pedir({ accion: "pagar", numeros: ["01"], otrosSorteoAutorizados: ["01"], solicitudId: "p4" });
    assert.strictEqual(estados(a)["01"], "hecho", "el administrador decide");
    assert.strictEqual(fila(A, "01").identidad_evento_real, "viejo", "sigue en su sorteo");
});

prueba("un sorteo en varios grupos es UN sorteo: un número reservado en otro grupo no cuenta como ajeno", async () => {
    sembrar();
    ocupar(A, "00", { evento_id: EV2, grupo_id: "g2@g.us" });
    assert.strictEqual(estados(await pedir({ accion: "pagar", numeros: ["00"], solicitudId: "p5" }))["00"], "hecho");
});

prueba("liberar y desbloquear: estado confirmado, un UPDATE por estado, anular pago exige motivo", async () => {
    sembrar();
    ["00", "01"].forEach(n => ocupar(A, n));
    ocupar(A, "02", { estado: "pagado" });
    Object.assign(fila(A, "03"), { estado: "bloqueado", temporal_por: "a mano" });
    ocupar(A, "04");                               // el panel lo vio reservado…
    fila(A, "04").estado = "pagado";               // …pero entretanto se pagó
    const sinMotivo = await pedir({ accion: "liberar", confirmar: true, solicitudId: "l1", numeros: [{ numero: "02", estado: "pagado" }] });
    assert.strictEqual(sinMotivo.json.resultados[0].codigo, "falta_motivo");
    assert.strictEqual(fila(A, "02").estado, "pagado");
    fake.control.llamadas.length = 0;
    const r = await pedir({
        accion: "liberar", confirmar: true, motivo: "Cliente desistió", solicitudId: "l2",
        numeros: [{ numero: "00", estado: "reservado" }, { numero: "01", estado: "reservado" }, { numero: "02", estado: "pagado" }, { numero: "03", estado: "bloqueado" }, { numero: "04", estado: "reservado" }, { numero: "05", estado: "libre" }]
    });
    assert.deepStrictEqual(estados(r), { "00": "hecho", "01": "hecho", "02": "hecho", "03": "hecho", "04": "omitido", "05": "sin_cambio" });
    assert.match(r.json.resultados.find(x => x.numero === "04").mensaje, /ahora está pagado/);
    assert.strictEqual(fila(A, "04").estado, "pagado", "un pago nuevo no se borra");
    assert.strictEqual(escrituras(T, "update"), 3, "uno por estado: reservado, pagado y bloqueado");
    assert.ok(["00", "01", "02", "03"].every(n => fila(A, n).estado === "libre" && !fila(A, n).comprador));
    assert.deepStrictEqual(fake.tablas.reservas_actividad.map(a => a.tipo).sort(), ["cancelado", "liberado", "liberado", "liberado"]);
    assert.strictEqual(auditoria().find(a => a.numero === "03" && a.resultado === "ok").accion, "desbloquear");
    assert.strictEqual((await pedir({ accion: "liberar", numeros: [{ numero: "06", estado: "libre" }] })).json.motivo, "falta_confirmacion");
});

(async () => {
    const servidor = app.listen(0);
    await new Promise(r => servidor.once("listening", r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.stack); }
    }
    servidor.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
