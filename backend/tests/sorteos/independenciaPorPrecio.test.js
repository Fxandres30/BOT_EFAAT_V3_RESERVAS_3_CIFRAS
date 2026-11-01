// ==========================================================================
// PRUEBAS — INDEPENDENCIA DE NÚMEROS, PAGOS Y RECAUDO POR PRECIO (regla del
// 01/11: «cada precio tiene su propia cuadrícula lógica 00-99»).
//
// ESTADO ESPERADO HOY: las pruebas 2 y 3 FALLAN a propósito. Los precios
// $3.000–$15.000 comparten la tabla física 5k_15k_reservas_2_cifras (y
// $1.000–$2.000 reservas_dos_cifras), con UNA fila por (usuario_id, numero):
// el 07 de $3.000 y el 07 de $10.000 son la misma fila, y los contadores del
// sorteo activo se leen por tabla. Pasarán cuando cada precio tenga su propia
// cuadrícula (decisión de arquitectura pendiente: ver
// docs/activacion/UN_SORTEO_ACTIVO_POR_PRECIO.md). No se corrige aquí: exige
// migración y transición de datos.
//
//     node backend/tests/sorteos/independenciaPorPrecio.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) }, rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }
};

const servicio = require(r("sorteos/servicio.js"));
const { obtenerConfiguracion } = require(r("bot/funciones/eventos/configEvento.js"));

servicio._reloj.ahora = () => new Date("2026-10-22T13:00:00Z");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";

const evento = (id, grupo, identidad, valor) => ({
    id, usuario_id: A, grupo_id: grupo, activo: true, abierto: true, estado: "abierto", identidad_evento_real: identidad,
    nombre_evento: `Sorteo $${valor}`, hora_fin: "22:30", hora_cierre: "22:00", fecha_evento: "2026-10-22",
    valor, tabla: T5K, cifras: 2, cantidad_numeros: 100, premios: [], creado_en: "2026-10-22T12:00:00Z"
});

// $3.000 en g1 con 07 pagado y 08 reservado; $10.000 en g2 sin números.
function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    t.eventos_bot = [evento("ev-tres", "g1@g.us", "tres-mil", 3000), evento("ev-diez", "g2@g.us", "diez-mil", 10000)];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    Object.assign(t[T5K][7], { estado: "pagado", identidad_evento_real: "tres-mil", evento_id: "ev-tres" });
    Object.assign(t[T5K][8], { estado: "reservado", identidad_evento_real: "tres-mil", evento_id: "ev-tres" });
}

const silenciar = async (fn) => { const c = { ...console }; for (const m of ["log", "warn", "error", "table", "dir"]) console[m] = () => {}; try { return await fn(); } finally { Object.assign(console, c); } };
const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn: () => silenciar(fn) });

prueba("0. (dato) $3.000 y $10.000 usan HOY la misma tabla física", async () => {
    assert.strictEqual(obtenerConfiguracion(3000).tabla, obtenerConfiguracion(10000).tabla);
});

prueba("1. Los dos sorteos (de precios distintos) están activos a la vez", async () => {
    escenario();
    const lista = await servicio.activos.listar(A);
    assert.ok(lista.ok, JSON.stringify(lista));
    assert.deepStrictEqual(lista.data.map(s => s.valor).sort((x, y) => x - y), [3000, 10000]);
});

prueba("2. Pagos y reservas independientes: el de $10.000 (sin números) no cuenta los del de $3.000", async () => {
    escenario();
    const diez = (await servicio.activos.obtener(A, "ev-diez")).data;
    const tres = (await servicio.activos.obtener(A, "ev-tres")).data;
    assert.deepStrictEqual([tres.reservados, tres.pagados], [1, 1], "el de $3.000 tiene 1 reservado y 1 pagado");
    assert.deepStrictEqual([diez.reservados, diez.pagados], [0, 0], `el de $10.000 no debería tener ninguno (cuenta ${diez.reservados} reservado(s) y ${diez.pagados} pagado(s) del de $3.000)`);
});

prueba("3. Cuadrícula independiente: el 07 está libre para el sorteo de $10.000 aunque esté pagado en el de $3.000", async () => {
    escenario();
    const filas07 = fake.tablas[T5K].filter(f => f.usuario_id === A && f.numero === "07");
    assert.strictEqual(filas07.length, 2, `debería haber un 07 por precio; hay ${filas07.length} fila(s) para los dos precios`);
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
