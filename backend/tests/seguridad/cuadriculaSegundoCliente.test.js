// ==========================================================================
// PRUEBAS — "/tablas/5000 muestra el evento activo de B, pero la cuadrícula
// sale vacía y pide reiniciar".
//
// Caso reproducido: el bot creó el evento de B (precio 5000 -> tabla física
// 5k_15k_reservas_2_cifras con la configuración base), pero B no tiene
// ninguna fila en esa tabla: su inicialización (POST /tablas/inicializar ->
// inicializar_tablas_cliente, migración 027) falla en silencio mientras la
// 027 no está aplicada, y aunque lo estuviera, UNIQUE(numero) (falta la 033)
// impide un segundo 00-99. El panel lo mostraba como "tabla vacía, pulsa
// Reiniciar".
//
// POST /tablas/:precio/preparar (rutas y servicios REALES; Supabase en
// memoria con la RPC de la 027 simulada en sus tres situaciones):
//   - 027 pendiente / 033 pendiente / Parte A pendiente -> motivo claro, nada
//     escrito, la cuadrícula de A intacta;
//   - con 027 + 033: B recibe su 00-99 en las 2 tablas físicas; A intacta;
//   - idempotente, nunca completa ni reinicia una cuadrícula existente;
//   - un error de lectura no se presenta como "vacía";
//   - reservar y pagar el 13 de B no cambia el 13 de A.
//
//     node backend/tests/seguridad/cuadriculaSegundoCliente.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const inyectar = (rel, exp) => { const abs = path.join(RAIZ, rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const T2 = "reservas_dos_cifras";
const EV_A = "e0000000-0000-4000-8000-0000000000a1";
const EV_B = "e0000000-0000-4000-8000-0000000000b1";
const C_A = "c1c1c1c1-0000-4000-8000-000000000001";
const C_B = "c3c3c3c3-0000-4000-8000-000000000003";

const fake = crearFake();
fake.tokens["jwt-A"] = { id: A, email: "dueno@a.co" };
fake.tokens["jwt-B"] = { id: B, email: "dueno@b.co" };

// ------------------------------------------ RPC de la 027 (simulada) ---
// "sin_027": la función no existe (PGRST202).
// "sin_033": existe, pero UNIQUE(numero) choca con el 00-99 de A (23505,
//            la función se revierte entera).
// "sin_parte_a": la propia función devuelve parte_a_pendiente.
// "lista": 027 + 033 + Parte A — inserta 00-99 del cliente donde no tenga
//          ninguna fila; nunca toca una cuadrícula existente.
let modoRpc = "sin_027";
const llamadasRpc = [];

async function rpc(nombre, args) {

    llamadasRpc.push({ nombre, args });

    if (nombre !== "inicializar_tablas_cliente") return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    if (modoRpc === "sin_027") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.inicializar_tablas_cliente" } };
    if (modoRpc === "sin_parte_a") return { data: { ok: false, motivo: "parte_a_pendiente" }, error: null };

    const usuario = args.p_usuario;
    const tablas = [...new Set(args.p_configuraciones.map(c => c.tabla))].sort();

    if (modoRpc === "sin_033") {
        const choca = tablas.some(t => (fake.tablas[t] || []).some(f => f.usuario_id !== usuario));
        if (choca) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${T5K}_numero_key"` } };
    }

    fake.tablas.tablas_cliente = fake.tablas.tablas_cliente || [];
    for (const c of args.p_configuraciones) {
        if (!fake.tablas.tablas_cliente.some(f => f.usuario_id === usuario && f.precio === c.precio)) {
            fake.tablas.tablas_cliente.push({ usuario_id: usuario, precio: c.precio, tabla_fisica: c.tabla, cifras: c.cifras, cantidad: c.cantidad, activa: true });
        }
    }

    const cuadriculas = [];
    for (const t of tablas) {
        fake.tablas[t] = fake.tablas[t] || [];
        const filas = fake.tablas[t].filter(f => f.usuario_id === usuario).length;
        if (filas === 0) {
            for (let i = 0; i < 100; i++) fake.tablas[t].push({ id: `${usuario}-${t}-${i}`, usuario_id: usuario, numero: String(i).padStart(2, "0"), estado: "libre" });
            cuadriculas.push({ tabla: t, estado: "creada", filas: 100 });
        } else {
            cuadriculas.push({ tabla: t, estado: filas === 100 ? "existente" : "incompleta", filas });
        }
    }

    return { data: { ok: true, configuraciones_creadas: args.p_configuraciones.length, cuadriculas }, error: null };

}

inyectar("lib/supabase.js", new Proxy(fake.client, { get: (obj, prop) => (prop === "rpc" ? rpc : obj[prop]) }));
let envios = 0;
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { envios++; throw new Error("WhatsApp no debe usarse"); } }));

// ------------------------------------------------------------- datos ---

function sembrar() {

    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.tablasInexistentes.clear();
    fake.control.fallarTabla = null;
    llamadasRpc.length = 0;

    // A: la cuenta principal, con sus cuadrículas completas y reservas reales.
    const cuadricula = (usuario, tabla) => Array.from({ length: 100 }, (_, i) => ({ id: `${usuario}-${tabla}-${i}`, usuario_id: usuario, numero: String(i).padStart(2, "0"), estado: "libre" }));
    fake.tablas[T5K] = cuadricula(A, T5K);
    fake.tablas[T2] = cuadricula(A, T2);
    Object.assign(fake.tablas[T5K][13], { estado: "reservado", comprador: "Juan de A", telefono: "3104445566", usuario_global_id: C_A, evento_id: EV_A, identidad_evento_real: "idA", fecha_reserva: "2026-10-22", hora_reserva: "09:00:00" });
    Object.assign(fake.tablas[T5K][14], { estado: "pagado", comprador: "Juan de A", telefono: "3104445566", usuario_global_id: C_A, evento_id: EV_A, identidad_evento_real: "idA", fecha_pago: "2026-10-22", hora_pago: "09:30:00" });

    // A sin filas en tablas_cliente (usa la base); 027 "sin aplicar" = la
    // tabla no existe.
    fake.control.tablasInexistentes.add("tablas_cliente");

    const evento = (id, usuario, grupo, identidad) => ({
        id, usuario_id: usuario, tabla: T5K, activo: true, estado: "abierto", valor: 5000, cifras: 2,
        grupo_id: grupo, grupo_nombre: `Grupo de ${usuario === A ? "A" : "B"}`, identidad_evento_real: identidad,
        nombre_evento: "Lotería de Bogotá", fecha_evento: "2999-01-01", hora_cierre: "22:26", hora_fin: "22:30",
        telefono_bot: "573000000000", creado_en: "2026-10-22T10:00:00Z"
    });

    // El evento activo de B que se ve en /tablas/5000.
    fake.tablas.eventos_bot = [evento(EV_A, A, "gA@g.us", "idA"), evento(EV_B, B, "gB@g.us", "idB")];
    fake.tablas.grupos_autorizados = [
        { usuario_id: A, grupo_id: "gA@g.us", activo: true },
        { usuario_id: B, grupo_id: "gB@g.us", activo: true }
    ];
    fake.tablas.usuarios = [
        { id: C_A, nombre: "Juan de A", telefono: "3104445566", lid: null },
        { id: C_B, nombre: "Pedro de B", telefono: "3207778899", lid: null }
    ];
    fake.tablas.contactos_tenant = [
        { usuario_id: A, usuario_global_id: C_A, ultimo_visto_en: "2026-10-22T09:00:00Z" },
        { usuario_id: B, usuario_global_id: C_B, ultimo_visto_en: "2026-10-22T09:00:00Z" }
    ];
    fake.tablas.mensajes_grupos_sorteos = [];
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

function pedir(metodo, camino, { token, cuerpo } = {}) {
    return new Promise((resolve, reject) => {
        const datos = JSON.stringify(cuerpo || {});
        const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos), "x-service-token": process.env.SESSIONS_API_TOKEN };
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request(base + camino, { method: metodo, headers }, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        });
        req.on("error", reject);
        req.end(datos);
    });
}

const preparar = (token, precio = 5000, cuerpo) => pedir("POST", `/tablas/${precio}/preparar`, { token, cuerpo });
const filasDe = (usuario, tabla = T5K) => (fake.tablas[tabla] || []).filter(f => f.usuario_id === usuario);
const foto = (usuario) => JSON.stringify([filasDe(usuario, T5K), filasDe(usuario, T2)]);
const fila = (usuario, numero) => filasDe(usuario).find(f => f.numero === numero);

async function silencio(fn) {
    const original = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = original; }
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ----------------------------------------------------------- pruebas ---

prueba("caso reproducido: B tiene evento activo a $5000 y 0 filas; con la 027 sin aplicar -> 503 migracion_pendiente (no 'vacía'), nada escrito, A intacta", async () => {
    sembrar();
    modoRpc = "sin_027";
    const antesA = foto(A);
    assert.strictEqual(fake.tablas.eventos_bot.find(e => e.usuario_id === B).activo, true);
    assert.strictEqual(filasDe(B).length, 0);

    const r = await silencio(() => preparar("jwt-B"));
    assert.strictEqual(r.status, 503, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.ok, r.json.motivo, r.json.estado, r.json.filas, r.json.tabla], [false, "migracion_pendiente", "vacia", 0, T5K]);
    assert.strictEqual(filasDe(B).length + filasDe(B, T2).length, 0);
    assert.strictEqual(foto(A), antesA);
});

prueba("027 aplicada pero sin la 033 (UNIQUE(numero)): 409 restriccion_unica; la función se revierte entera y A queda intacta", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "sin_033";
    const antesA = foto(A);
    const r = await silencio(() => preparar("jwt-B"));
    assert.strictEqual(r.status, 409, JSON.stringify(r.json));
    assert.strictEqual(r.json.motivo, "restriccion_unica");
    assert.strictEqual(filasDe(B).length + filasDe(B, T2).length, 0);
    assert.strictEqual(foto(A), antesA);
});

prueba("sin la Parte A: 503 parte_a_pendiente; nada escrito", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "sin_parte_a";
    const r = await silencio(() => preparar("jwt-B"));
    assert.deepStrictEqual([r.status, r.json.motivo], [503, "parte_a_pendiente"]);
    assert.strictEqual(filasDe(B).length, 0);
});

prueba("con 027 + 033 + Parte A: B recibe su 00-99 en las 2 tablas físicas (mismos números que A) y A queda idéntica", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "lista";
    const antesA = foto(A);
    const r = await preparar("jwt-B");
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.ok, r.json.estado, r.json.filas, r.json.esperadas, r.json.tabla], [true, "completa", 100, 100, T5K]);
    const esperados = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
    assert.deepStrictEqual(filasDe(B).map(f => f.numero), esperados);
    assert.deepStrictEqual(filasDe(B, T2).map(f => f.numero), esperados);
    assert.ok(filasDe(B).every(f => f.estado === "libre" && f.usuario_id === B));
    assert.strictEqual(foto(A), antesA, "las filas, reservas y pagos de A no cambian");
    assert.deepStrictEqual(llamadasRpc.map(c => c.args.p_usuario), [B], "inicializa solo al cliente del token");
});

prueba("idempotente: con la cuadrícula ya creada no vuelve a inicializar ni duplica", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "lista";
    await preparar("jwt-B");
    llamadasRpc.length = 0;
    const r = await preparar("jwt-B");
    assert.deepStrictEqual([r.status, r.json.estado, r.json.filas], [200, "completa", 100]);
    assert.strictEqual(llamadasRpc.length, 0);
    assert.strictEqual(filasDe(B).length, 100);
});

prueba("el cliente A (cuadrícula existente): completa, sin llamar a la inicialización y sin tocar nada", async () => {
    sembrar();
    modoRpc = "lista";
    const antesA = foto(A);
    const r = await preparar("jwt-A");
    assert.deepStrictEqual([r.status, r.json.ok, r.json.estado, r.json.filas], [200, true, "completa", 100]);
    assert.strictEqual(llamadasRpc.length, 0);
    assert.strictEqual(foto(A), antesA);
});

prueba("cuadrícula incompleta: se informa (40 de 100) y no se completa, reinicia ni borra", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "lista";
    for (let i = 0; i < 40; i++) fake.tablas[T5K].push({ id: `B-${i}`, usuario_id: B, numero: String(i).padStart(2, "0"), estado: i === 3 ? "reservado" : "libre" });
    const antesB = JSON.stringify(filasDe(B));
    const r = await preparar("jwt-B");
    assert.deepStrictEqual([r.status, r.json.estado, r.json.filas, r.json.esperadas], [200, "incompleta", 40, 100]);
    assert.strictEqual(llamadasRpc.length, 0);
    assert.strictEqual(JSON.stringify(filasDe(B)), antesB);
});

prueba("error leyendo la tabla física (RLS, permisos, esquema): 500 error_lectura, nunca 'vacía' ni inicialización", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "lista";
    fake.control.fallarTabla = T5K;
    const r = await silencio(() => preparar("jwt-B"));
    assert.strictEqual(r.status, 500);
    assert.strictEqual(r.json.motivo, "error_lectura");
    assert.ok(!("estado" in r.json));
    assert.strictEqual(llamadasRpc.length, 0);
});

prueba("el cliente sale del token: sin sesión 401; un usuario en el cuerpo se ignora; precio no configurado 404", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "lista";
    assert.strictEqual((await preparar(null)).status, 401);
    assert.strictEqual((await preparar("jwt-falso")).status, 401);
    const r = await preparar("jwt-A", 5000, { usuarioId: B, usuario_id: B, p_usuario: B });
    assert.strictEqual(r.json.filas, 100);
    assert.strictEqual(filasDe(B).length, 0, "no se inicializa a B desde la sesión de A");
    assert.strictEqual((await preparar("jwt-B", 4321)).status, 404);
    assert.strictEqual((await pedir("POST", "/tablas/abc/preparar", { token: "jwt-B" })).status, 400);
});

prueba("reservar y pagar el 13 de B no modifica el 13 (reservado) ni ningún número de A", async () => {
    sembrar();
    fake.control.tablasInexistentes.delete("tablas_cliente");
    modoRpc = "lista";
    await preparar("jwt-B");
    const antesA = foto(A);
    const trece = JSON.stringify(fila(A, "13"));

    const rv = await pedir("POST", "/tablas/5000/numeros/13/reservar", { token: "jwt-B", cuerpo: { contactoId: C_B, eventoId: EV_B, motivo: "Pidió por audio", solicitudId: "b-13" } });
    assert.strictEqual(rv.status, 200, JSON.stringify(rv.json));
    assert.strictEqual(fila(B, "13").estado, "reservado");
    assert.strictEqual(fila(B, "13").usuario_global_id, C_B);

    const pg = await pedir("POST", "/tablas/5000/numeros/13/pagar", { token: "jwt-B", cuerpo: { metodoPago: "Nequi", solicitudId: "b-13-pago" } });
    assert.strictEqual(pg.status, 200, JSON.stringify(pg.json));
    assert.strictEqual(fila(B, "13").estado, "pagado");

    assert.strictEqual(JSON.stringify(fila(A, "13")), trece, "el 13 de A sigue reservado a Juan, sin cambios");
    assert.strictEqual(foto(A), antesA);
    assert.strictEqual(envios, 0);
});

// --------------------------------------------------------- ejecución ---

const servidor = app.listen(0, "127.0.0.1", async () => {
    base = `http://127.0.0.1:${servidor.address().port}`;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    servidor.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
});
