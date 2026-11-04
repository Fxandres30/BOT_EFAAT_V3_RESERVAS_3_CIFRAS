// ==========================================================================
// PRUEBAS — Modalidad del sorteo (instantáneo / programado) en el BACKEND.
//
//   1. Instantáneo: se crea sin fecha ni hora de publicación y se guarda
//      como instantáneo (persiste al volver a leerlo).
//   2. Programado: sigue exigiendo fecha y hora de publicación futura.
//   3. Ningún valor por defecto convierte uno en otro (campo ausente =
//      programado, que exige publicar_en; nunca instantáneo «por omisión»).
//   4. Editar NUNCA cambia la modalidad guardada, la envíe o no el panel.
//   5. Crear/editar no tocan reservas, pagos ni eventos.
//
// Reales: sorteos/{servicio,validar,repo}.js. Simulado: Supabase (memoria).
// Ningún envío ni escritura real.
//
//     node backend/tests/sorteos/modalidadSorteo.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    }
};

const servicio = require(r("sorteos/servicio.js"));

// 22/10, 10:00 de Colombia; el sorteo se juega hoy a las 22:30.
const AHORA = new Date("2026-10-22T15:00:00Z");
servicio._reloj.ahora = () => AHORA;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: A, grupo_id: "g2@g.us", activo: true }];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: i < 3 ? "pagado" : i < 6 ? "reservado" : "libre", usuario_id: A }));
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Antioqueñita Día",
        hora_fin: "22:30",
        valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" },
        recordatorios: [],
        ...extra
    };
}

const INSTANTANEO = { publicacion_inmediata: true };
const PROGRAMADO = { publicacion_inmediata: false, publicar_en: "2026-10-22T20:00:00Z" };

async function silencio(fn) {
    const { log, table, dir, warn, error } = console;
    console.log = console.table = console.dir = console.warn = console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error }); }
}

const crear = (datos) => silencio(() => servicio.crearSorteo(A, datos));
const reservas = () => JSON.stringify(fake.tablas[T5K].filter(f => f.estado !== "libre"));

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("1. Instantáneo: se crea SIN fecha ni hora de publicación y persiste como instantáneo", async () => {
    escenario();
    const c = await crear(entrada(INSTANTANEO));
    assert.ok(c.ok, JSON.stringify(c));
    assert.strictEqual(c.data.config.publicacion_inmediata, true);
    assert.strictEqual(c.data.estado, "borrador", "crear no publica");
    // «Recargar»: la fila guardada conserva la modalidad.
    const fila = fake.tablas.sorteos_programados.find(s => s.id === c.data.id);
    assert.strictEqual(fila.config.publicacion_inmediata, true);
    const v = await silencio(() => servicio.vistaPrevia(A, c.data.id));
    assert.ok(v.ok && v.data.publicacion_inmediata === true, JSON.stringify(v));
});

prueba("2. Programado: exige fecha y hora de publicación (y futura); persiste como programado", async () => {
    escenario();
    const sin = await crear(entrada({ publicacion_inmediata: false }));
    assert.strictEqual(sin.ok, false);
    assert.ok(sin.errores.some(e => e.campo === "publicar_en"), JSON.stringify(sin.errores));
    const pasada = await crear(entrada({ publicacion_inmediata: false, publicar_en: AHORA.toISOString() }));
    assert.strictEqual(pasada.ok, false);
    const c = await crear(entrada(PROGRAMADO));
    assert.ok(c.ok, JSON.stringify(c));
    assert.strictEqual(c.data.config.publicacion_inmediata, false);
    assert.strictEqual(new Date(c.data.publicar_en).toISOString(), "2026-10-22T20:00:00.000Z");
    const v = await silencio(() => servicio.vistaPrevia(A, c.data.id));
    assert.ok(v.ok && v.data.publicacion_inmediata === false, JSON.stringify(v));
});

prueba("3. Sin modalidad indicada no se crea un instantáneo por omisión", async () => {
    escenario();
    const sinCampo = await crear(entrada());
    assert.strictEqual(sinCampo.ok, false, "sin publicar_en ni publicacion_inmediata no se guarda");
    assert.ok(sinCampo.errores.some(e => e.campo === "publicar_en"));
    // Un valor «verdadero» que no sea exactamente true tampoco lo convierte.
    const texto = await crear(entrada({ publicacion_inmediata: "true" }));
    assert.strictEqual(texto.ok, false);
    assert.strictEqual((fake.tablas.sorteos_programados || []).length, 0);
});

prueba("4. Editar un INSTANTÁNEO no lo vuelve programado (aunque se envíe false o se omita)", async () => {
    escenario();
    const c = await crear(entrada(INSTANTANEO));
    assert.ok(c.ok, JSON.stringify(c));
    const e1 = await silencio(() => servicio.editar(A, c.data.id, entrada({ publicacion_inmediata: false, valor: 3000, nombre: "Nombre nuevo", version: c.data.version })));
    assert.ok(e1.ok, JSON.stringify(e1));
    assert.strictEqual(e1.data.config.publicacion_inmediata, true);
    assert.strictEqual(e1.data.config.nombre, "Nombre nuevo");
    const e2 = await silencio(() => servicio.editar(A, c.data.id, entrada({ version: e1.data.version })));
    assert.ok(e2.ok, JSON.stringify(e2));
    assert.strictEqual(e2.data.config.publicacion_inmediata, true);
});

prueba("5. Editar un PROGRAMADO no lo vuelve instantáneo y sigue exigiendo su publicación", async () => {
    escenario();
    const c = await crear(entrada(PROGRAMADO));
    assert.ok(c.ok, JSON.stringify(c));
    const e1 = await silencio(() => servicio.editar(A, c.data.id, entrada({ ...PROGRAMADO, publicacion_inmediata: true, publicar_en: "2026-10-22T21:00:00Z", version: c.data.version })));
    assert.ok(e1.ok, JSON.stringify(e1));
    assert.strictEqual(e1.data.config.publicacion_inmediata, false);
    assert.strictEqual(new Date(e1.data.publicar_en).toISOString(), "2026-10-22T21:00:00.000Z");
    // Pedir «instantáneo» sin fecha de publicación: se rechaza (sigue siendo programado).
    const e2 = await silencio(() => servicio.editar(A, c.data.id, entrada({ publicacion_inmediata: true, version: e1.data.version })));
    assert.strictEqual(e2.ok, false);
    assert.ok(e2.errores.some(x => x.campo === "publicar_en"), JSON.stringify(e2.errores));
    const fila = fake.tablas.sorteos_programados.find(s => s.id === c.data.id);
    assert.strictEqual(fila.config.publicacion_inmediata, false);
});

prueba("6. Crear y editar en ambas modalidades no tocan reservas, pagos ni eventos", async () => {
    escenario();
    const antes = reservas();
    const i = await crear(entrada(INSTANTANEO));
    const p = await crear(entrada({ ...PROGRAMADO, grupos: ["g2@g.us"], nombre: "Otro" }));
    assert.ok(i.ok && p.ok);
    await silencio(() => servicio.editar(A, i.data.id, entrada({ version: i.data.version })));
    await silencio(() => servicio.editar(A, p.data.id, entrada({ ...PROGRAMADO, grupos: ["g2@g.us"], nombre: "Otro", version: p.data.version })));
    assert.strictEqual(reservas(), antes);
    assert.strictEqual(fake.tablas.eventos_bot.length, 0);
});


(async () => {
    let ok = 0;
    for (const p of pruebas) {
        try { await p.fn(); ok++; console.log(`✅ ${p.n}`); }
        catch (e) { console.log(`❌ ${p.n}\n   ${e.stack?.split("\n").slice(0, 3).join("\n   ")}`); }
    }
    console.log("============================");
    console.log(`TOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}`);
    console.log("============================");
    process.exit(ok === pruebas.length ? 0 : 1);
})();
