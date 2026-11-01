// ==========================================================================
// DIAGNÓSTICO — dos sorteos SIMULTÁNEOS de precios distintos que comparten
// la tabla física (1/11/2026). Regla: cada precio es su propio sorteo; nunca
// comparten números, recaudo, contadores ni estadísticas.
//
//   Sorteo A: $3.000 en g1.   Sorteo B: $10.000 en g2.
//   Los dos precios usan HOY 5k_15k_reservas_2_cifras, con UNA fila por
//   (usuario_id, numero): el 07 de A y el 07 de B son la MISMA fila.
//
// Cada verificación recorre el código REAL (reservar, pagar, contadores,
// recaudo del panel, «¿qué debo?», cierre, reemplazo, listado del panel)
// sobre Supabase en memoria. Las que dependen de separar las cuadrículas
// están marcadas `arquitectura: true`: HOY fallan y así lo informa la
// prueba (no rompe la regresión). Cualquier OTRA falla sí la rompe.
//
//     node backend/tests/reservas/aislamientoPorPrecio.test.js
//     ESTRICTO=1 node ...   -> exige todas (usar tras separar las cuadrículas)
//     TABLA_POR_PRECIO=1 ESTRICTO=1 node ...
//         -> simula la alternativa B SIN cambiar código: $10.000 con su propia
//            tabla física, asignada solo con tablas_cliente.
//
// Informe: docs/activacion/AISLAMIENTO_POR_PRECIO.md
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const FRONT = path.resolve(RAIZ, "../frontend");
const r = (p) => path.join(RAIZ, p);
const inyectar = (rel, exp) => { require.cache[r(rel)] = { id: r(rel), filename: r(rel), loaded: true, exports: exp }; };

const fake = crearFake();
inyectar("lib/supabase.js", { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) }, rpc: async () => ({ data: null, error: { code: "PGRST202" } }) });
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { throw new Error("WhatsApp no debe usarse"); } }));
const cierresWhatsapp = [];
inyectar("bot/funciones/eventos/grupos/cerrarGrupo.js", { cerrarGrupo: async () => true, cerrarGrupoDetallado: async ({ grupoId }) => { cierresWhatsapp.push(grupoId); return { ok: true }; } });

// Panel: función REAL del recaudo, transpilada con el TypeScript del frontend.
const ts = require(path.join(FRONT, "node_modules/typescript"));
function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const m = { exports: {} };
    new Function("module", "exports", "require", outputText)(m, m.exports, (id) => require(id));
    return m.exports;
}
const { calcularResumenTabla } = cargarTs(path.join(FRONT, "services/tablas/resumenTabla.ts"));

const { reservarNumeros } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const reservaManual = require(r("services/reservaManual.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));
const { procesarSorteo } = require(r("bot/funciones/eventos/lifecycle/procesarSorteo.js"));
const sorteosActivos = require(r("sorteos/sorteosActivos.js"));
const { sorteosActivosDelPrecio } = require(r("shared/eventos/unSorteoPorPrecio.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T = "5k_15k_reservas_2_cifras";
const POR_PRECIO = process.env.TABLA_POR_PRECIO === "1";
const T10 = POR_PRECIO ? "10k_reservas_2_cifras" : T;   // tabla del precio de B
const tablaDe = (precio) => (precio === 10000 ? T10 : T);
const C1 = { id: "c1c1c1c1-0000-4000-8000-000000000001", telefono: "3001112233" };
const C2 = { id: "c2c2c2c2-0000-4000-8000-000000000002", telefono: "3104445566" };

const evento = (id, grupo, identidad, valor, extra = {}) => ({
    id, usuario_id: A, grupo_id: grupo, grupo_nombre: grupo, activo: true, abierto: true, estado: "abierto", identidad_evento_real: identidad,
    nombre_evento: `Sorteo $${valor}`, hora_fin: "22:30", hora_cierre: "22:00", fecha_evento: "2999-01-01",
    valor: String(valor), tabla: T, cifras: 2, cantidad_numeros: 100, reservados: 0, pagados: 0, pendientes: 0, libres: 100,
    creado_en: "2026-11-01T10:00:00Z", ...extra
});

function sembrar() {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    for (const t of new Set([T, T10])) fake.tablas[t] = Array.from({ length: 100 }, (_, i) => ({ id: `${t}-${i}`, usuario_id: A, numero: String(i).padStart(2, "0"), estado: "libre" }));
    fake.tablas.eventos_bot = [evento("ev-a", "g1@g.us", "sorteo-a", 3000), evento("ev-b", "g2@g.us", "sorteo-b", 10000, { tabla: T10 })];
    fake.tablas.tablas_cliente = [3000, 10000].map(precio => ({ usuario_id: A, precio, tabla_fisica: tablaDe(precio), cifras: 2, cantidad: 100, activa: true }));
    fake.tablas.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: A, grupo_id: "g2@g.us", activo: true }];
    fake.tablas.usuarios = [{ id: C1.id, telefono: C1.telefono, nombre: "María" }, { id: C2.id, telefono: C2.telefono, nombre: "Juan" }];
    fake.tablas.reservas_actividad = [];
    fake.tablas.reservas_auditoria = [];
    cierresWhatsapp.length = 0;
    reservaManual.olvidarDirectorio();
}

const ev = (id) => fake.tablas.eventos_bot.find(e => e.id === id);
const fila = (n) => fake.tablas[T].find(f => f.numero === n);
// Como useTablaPrecio: la cuadrícula de la tabla del precio, del cliente.
const resumen = (precio, idActivo) => calcularResumenTabla(fake.tablas[tablaDe(precio)].map(f => ({ estado: f.estado })), precio, ev(idActivo));
const OPERADOR = { id: "op", email: "admin@a.co" };

// Escenario base: A vende 07 (pagado) y 08 (reservado) a María. B no vende nada.
async function ventasDeA() {
    sembrar();
    await reservarNumeros({ evento: ev("ev-a"), numeros: ["07", "08"], usuario: C1, comprador: "María", contacto: C1.telefono });
    const p = await reservaManual.pagarManual({ usuarioId: A, operador: OPERADOR, precio: 3000, numero: "07", solicitudId: "pago-a-07" });
    assert.ok(p.ok, JSON.stringify(p));
    await actualizarEvento(ev("ev-a"));
}

const verificaciones = [];
const verificar = (n, arquitectura, fn) => verificaciones.push({ n, arquitectura, fn });

verificar("1. El recaudo de A no incluye pagos de B (y viceversa)", true, async () => {
    await ventasDeA();
    assert.strictEqual(resumen(3000, "ev-a").recaudo, 3000, "A: un pagado × $3.000");
    assert.strictEqual(resumen(10000, "ev-b").recaudo, 0, `B no vendió nada: su recaudo debe ser $0 (hoy el panel muestra $${resumen(10000, "ev-b").recaudo})`);
});

verificar("2. Contadores independientes (eventos_bot, los que ve el panel)", true, async () => {
    await ventasDeA();
    await actualizarEvento(ev("ev-b"));
    assert.deepStrictEqual([ev("ev-a").pagados, ev("ev-a").reservados], [1, 1], "A");
    assert.deepStrictEqual([ev("ev-b").pagados, ev("ev-b").reservados], [0, 0], `B (hoy: ${ev("ev-b").pagados} pagados, ${ev("ev-b").reservados} reservados)`);
});

verificar("3. Porcentajes de avance independientes", true, async () => {
    await ventasDeA();
    assert.strictEqual(resumen(3000, "ev-a").ocupacion, 2, "A: 2 de 100");
    assert.strictEqual(resumen(10000, "ev-b").ocupacion, 0, `B: 0% (hoy ${resumen(10000, "ev-b").ocupacion}%)`);
});

verificar("4a. Las reservas de A conservan su sorteo (identidad y evento)", false, async () => {
    await ventasDeA();
    assert.deepStrictEqual([fila("07").identidad_evento_real, fila("07").evento_id, fila("08").identidad_evento_real], ["sorteo-a", "ev-a", "sorteo-a"]);
});

verificar("4b. Cada sorteo tiene su propia cuadrícula: el 07 de B está libre aunque el 07 de A esté pagado", true, async () => {
    await ventasDeA();
    const filas = await reservarNumeros({ evento: ev("ev-b"), numeros: ["07"], usuario: C2, comprador: "Juan", contacto: C2.telefono });
    assert.strictEqual(filas.length, 1, "Juan debería poder reservar el 07 de $10.000 (hoy: ocupado por el 07 de $3.000)");
});

verificar("4c. «¿Qué debo?» en el grupo de B no cobra las reservas de A al precio de B", true, async () => {
    await ventasDeA();
    const enB = await resolverConsulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente", evento: ev("ev-b"), usuario: C1 });
    assert.deepStrictEqual([enB.reservados, enB.montoPendiente], [[], 0], `hoy: ${JSON.stringify(enB.reservados)} por $${enB.montoPendiente}`);
});

verificar("5a. Los pagos no se duplican (pagar dos veces el mismo número)", false, async () => {
    await ventasDeA();
    const otra = await reservaManual.pagarManual({ usuarioId: A, operador: OPERADOR, precio: 3000, numero: "07", solicitudId: "pago-a-07-bis" });
    assert.strictEqual(otra.ok, false);
    assert.strictEqual(fake.tablas.reservas_actividad.filter(a => a.tipo === "pagado" && a.numero === "07").length, 1);
});

verificar("5b. Los pagos no se mezclan: pagar desde la tabla de $10.000 no toca una reserva de $3.000", true, async () => {
    await ventasDeA();
    const r = await reservaManual.operarLote({ accion: "pagar", usuarioId: A, operador: OPERADOR, precio: 10000, numeros: ["08"], solicitudId: "lote-b" });
    assert.strictEqual(fila("08").estado, "reservado", `el 08 es de $3.000; hoy el lote de $10.000 lo marca ${fila("08").estado} (${JSON.stringify(r.resultados)})`);
});

verificar("6a. Cerrar A (por hora) no cierra B", false, async () => {
    await ventasDeA();
    Object.assign(ev("ev-a"), { fecha_evento: "2026-10-31" });
    const res = await procesarSorteo({ sock: {}, filas: [ev("ev-a")], todas: fake.tablas.eventos_bot, ahora: Date.now() });
    assert.strictEqual(res.motivo, "hora");
    assert.strictEqual(ev("ev-a").activo, false);
    assert.strictEqual(ev("ev-b").activo, true);
    assert.deepStrictEqual(cierresWhatsapp, ["g1@g.us"], "solo el grupo de A");
});

verificar("6b. Que A venda TODO no cierra B «por todos pagados»", true, async () => {
    await ventasDeA();
    fake.tablas[T].forEach(f => Object.assign(f, { estado: "pagado", identidad_evento_real: "sorteo-a", evento_id: "ev-a" }));
    const res = await procesarSorteo({ sock: {}, filas: [ev("ev-b")], todas: fake.tablas.eventos_bot, ahora: Date.now() });
    assert.strictEqual(ev("ev-b").activo, true, `B no vendió nada; hoy se cierra por «${res.motivo}»`);
});

verificar("7. Reemplazar A (otro sorteo de $3.000) no afecta a B", false, async () => {
    sembrar();
    const ocupan = await sorteosActivosDelPrecio({ from: (t) => fake.client.from(t) }, { usuarioId: A, valor: 3000, identidad: "sorteo-a-nuevo" });
    assert.ok(ocupan.ok);
    assert.deepStrictEqual(ocupan.filas.map(f => f.id), ["ev-a"], "solo el sorteo del mismo precio se reemplazaría");
});

verificar("8. El listado de sorteos activos del panel muestra los valores de cada uno", true, async () => {
    await ventasDeA();
    const l = await sorteosActivos.listar(A);
    assert.ok(l.ok, JSON.stringify(l));
    const de = (precio) => l.data.find(s => Number(String(s.valor).replace(/\D/g, "")) === precio);
    assert.deepStrictEqual([de(3000).pagados, de(3000).reservados], [1, 1], "A");
    assert.deepStrictEqual([de(10000).pagados, de(10000).reservados], [0, 0], `B (hoy: ${de(10000).pagados} pagados, ${de(10000).reservados} reservados)`);
});

(async () => {
    const estricto = process.env.ESTRICTO === "1";
    const log = { ...console };
    let inesperadas = 0, conocidas = 0, ok = 0;
    for (const { n, arquitectura, fn } of verificaciones) {
        for (const m of ["log", "warn", "error", "dir", "table"]) console[m] = () => {};
        let error = null;
        try { await fn(); } catch (e) { error = e; }
        Object.assign(console, log);
        if (!error) { ok++; console.log(`✅ ${n}${arquitectura ? "  (ya independiente)" : ""}`); continue; }
        if (arquitectura && !estricto) { conocidas++; console.log(`⚠️  ${n}\n     FALLA HOY (cuadrícula compartida): ${error.message.split("\n")[0]}`); continue; }
        inesperadas++;
        console.log(`❌ ${n}\n     ${error.message.split("\n")[0]}`);
    }
    if (POR_PRECIO) console.log("\n(simulación: $10.000 con su propia tabla física, solo con tablas_cliente)");
    console.log(`\nVerificaciones: ${verificaciones.length}  |  OK: ${ok}  |  Fallan por la cuadrícula compartida: ${conocidas}  |  Fallas inesperadas: ${inesperadas}`);
    process.exit(inesperadas ? 1 : 0);
})();
