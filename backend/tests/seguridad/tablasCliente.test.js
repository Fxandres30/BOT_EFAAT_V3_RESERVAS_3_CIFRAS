// ==========================================================================
// PRUEBAS — configuraciones de tablas por cliente (tablasCliente.js) y
// POST /tablas/inicializar.
//
//   - El precio -> tabla física sale de la configuración DEL CLIENTE
//     (tablas_cliente); sin la migración 027, sin inicializar o si la
//     lectura falla, de la base de configEvento.js. Sin usuario: null.
//   - La inicialización usa SIEMPRE el usuario del token validado y los 8
//     precios base del código; un usuario_id en el cuerpo se ignora.
//   - Errores: migración pendiente, Parte A pendiente, unicidad sobre numero.
//
// Supabase en memoria (tests/sorteos/fakeSupabaseSorteos.js) + rpc espiado.
//
//     node backend/tests/seguridad/tablasCliente.test.js
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

const fake = crearFake();
fake.tokens["jwt-A"] = A;
fake.tokens["jwt-B"] = B;

let sinTabla = false;        // tablas_cliente no existe (027 sin aplicar)
let respuestaRpc = null;     // { data, error }
const llamadasRpc = [];

const client = {
    auth: fake.client.auth,
    from(tabla) {
        if (tabla === "tablas_cliente" && sinTabla) {
            const b = { select: () => b, eq: () => b, order: () => b, then: (ok, ko) => Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.tablas_cliente' in the schema cache" } }).then(ok, ko) };
            return b;
        }
        return fake.client.from(tabla);
    },
    async rpc(nombre, args) {
        llamadasRpc.push({ nombre, args });
        return respuestaRpc;
    }
};
inyectar("lib/supabase.js", client);
inyectar("services/baileys/send.js", { sendImage: async () => {} });

const { configuracionesBase } = require("../../bot/funciones/eventos/configEvento");
const tablasCliente = require("../../bot/funciones/eventos/tablasCliente");

const express = require("express");
const app = express();
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));

let base;
function post(camino, cuerpo, token) {
    return new Promise((resolve, reject) => {
        const datos = JSON.stringify(cuerpo || {});
        const headers = { "Content-Type": "application/json", "x-service-token": process.env.SESSIONS_API_TOKEN };
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request(base + camino, { method: "POST", headers }, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        });
        req.on("error", reject);
        req.end(datos);
    });
}

const fila = (usuario, precio, tabla, activa = true) => ({ usuario_id: usuario, precio, tabla_fisica: tabla, cifras: 2, cantidad: 100, activa });

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("sin usuario o sin precio: null (falla cerrado)", async () => {
    assert.strictEqual(await tablasCliente.obtenerConfiguracionCliente(null, 5000), null);
    assert.strictEqual(await tablasCliente.obtenerConfiguracionCliente(A, "gratis"), null);
});

prueba("027 sin aplicar: la configuración base de siempre (8 precios)", async () => {
    sinTabla = true;
    try {
        assert.deepStrictEqual(await tablasCliente.listarConfiguracionesCliente(A), configuracionesBase());
        assert.deepStrictEqual(await tablasCliente.obtenerConfiguracionCliente(A, "$5.000"), { tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 });
    } finally { sinTabla = false; }
});

prueba("cliente aún sin inicializar: la base", async () => {
    fake.tablas.tablas_cliente = [fila(B, 1000, "reservas_dos_cifras")];
    assert.deepStrictEqual((await tablasCliente.listarConfiguracionesCliente(A)).map(c => c.precio), [1000, 1500, 2000, 3000, 5000, 7000, 10000, 15000]);
});

prueba("cliente con configuración: la suya (desactivada = no ofrecida; añadida = ofrecida); nunca la de otro", async () => {
    fake.tablas.tablas_cliente = [
        fila(A, 1000, "reservas_dos_cifras"),
        fila(A, 5000, "5k_15k_reservas_2_cifras", false),
        fila(A, 4000, "5k_15k_reservas_2_cifras"),
        fila(B, 5000, "reservas_dos_cifras"),
        fila(B, 9000, "reservas_dos_cifras")
    ];
    assert.deepStrictEqual(await tablasCliente.obtenerConfiguracionCliente(A, 1000), { tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 });
    assert.strictEqual(await tablasCliente.obtenerConfiguracionCliente(A, 5000), null, "desactivada");
    assert.deepStrictEqual(await tablasCliente.obtenerConfiguracionCliente(A, 4000), { tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 });
    assert.strictEqual(await tablasCliente.obtenerConfiguracionCliente(A, 9000), null, "el precio de B no existe para A");
    assert.deepStrictEqual(await tablasCliente.obtenerConfiguracionCliente(B, 5000), { tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 });
});

prueba("POST /tablas/inicializar: usuario del token y los 8 precios base; el usuario_id del cuerpo se ignora", async () => {
    llamadasRpc.length = 0;
    respuestaRpc = { data: { ok: true, configuraciones_creadas: 8, cuadriculas: [{ tabla: "reservas_dos_cifras", estado: "creada", filas: 100 }] }, error: null };
    const r = await post("/tablas/inicializar", { usuario_id: B, usuarioId: B, p_usuario: B }, "jwt-A");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.deepStrictEqual(llamadasRpc, [{ nombre: "inicializar_tablas_cliente", args: { p_usuario: A, p_configuraciones: configuracionesBase() } }]);
    assert.strictEqual(llamadasRpc[0].args.p_configuraciones.length, 8);
});

prueba("POST /tablas/inicializar sin sesión o con sesión inválida: 401 y no se llama a la base", async () => {
    llamadasRpc.length = 0;
    assert.strictEqual((await post("/tablas/inicializar", { usuario_id: A })).status, 401);
    assert.strictEqual((await post("/tablas/inicializar", {}, "jwt-falso")).status, 401);
    assert.strictEqual(llamadasRpc.length, 0);
});

prueba("errores: 027 pendiente (503), Parte A pendiente (503), unicidad sobre numero (409), otro (500)", async () => {
    const casos = [
        [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }, 503, "migracion_pendiente"],
        [{ data: { ok: false, motivo: "parte_a_pendiente" }, error: null }, 503, "parte_a_pendiente"],
        [{ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }, 409, "restriccion_unica"],
        [{ data: null, error: { code: "XX000", message: "otro" } }, 500, "error_supabase"]
    ];
    const errorOriginal = console.error;
    console.error = () => {};
    try {
        for (const [resp, status, motivo] of casos) {
            respuestaRpc = resp;
            const r = await post("/tablas/inicializar", {}, "jwt-B");
            assert.deepStrictEqual([r.status, r.json.motivo], [status, motivo]);
        }
    } finally { console.error = errorOriginal; }
});

prueba("los precios base son exactamente los del código (no se inventa ninguno)", () => {
    assert.deepStrictEqual(configuracionesBase(), [
        { precio: 1000, tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 },
        { precio: 1500, tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 },
        { precio: 2000, tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 },
        { precio: 3000, tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 },
        { precio: 5000, tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 },
        { precio: 7000, tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 },
        { precio: 10000, tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 },
        { precio: 15000, tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 }
    ]);
});

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
