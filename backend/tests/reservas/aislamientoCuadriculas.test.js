// ==========================================================================
// PRUEBAS — cuadrículas de DOS clientes en la MISMA tabla física.
//
// Las tablas físicas (reservas_dos_cifras, 5k_15k_reservas_2_cifras) son
// compartidas: cada cliente tiene su cuadrícula 00-99 aislada por usuario_id
// (filtroCliente.js). Aquí: la del cliente PRINCIPAL (la cuenta actual) y la
// de un cliente nuevo B, con los mismos números.
//
//   - reservar, disponibilidad, consultar número, consultar reservas,
//     "mis números" y pago por sticker solo tocan la cuadrícula del dueño
//     del evento;
//   - un evento SIN usuario_id se rechaza: no se lee ni se escribe nada
//     (antes salía sin filtro y tocaba ambas cuadrículas).
//
// Funciones REALES del bot; Supabase en memoria (tests/identidad/fakeSupabase.js).
//
//     node backend/tests/reservas/aislamientoCuadriculas.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFakeSupabase } = require("../identidad/fakeSupabase");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const fake = crearFakeSupabase();
const rutaSupabase = r("lib/supabase.js");
require.cache[rutaSupabase] = { id: rutaSupabase, filename: rutaSupabase, loaded: true, exports: fake.client };

const { reservarNumeros } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const { consultarReservas } = require(r("bot/funciones/reservas/consultarReservas.js"));
const { consultarDisponibilidad } = require(r("bot/funciones/consultas/consultarDisponibilidad.js"));
const { consultarNumero } = require(r("bot/funciones/consultas/consultarNumero.js"));
const { consultarMisNumeros } = require(r("bot/funciones/consultas/consultarMisNumeros.js"));
const { marcarReservasPagadasPorAdmin } = require(r("bot/funciones/pagos/marcarReservasPagadasPorAdmin.js"));
const { soloDelCliente, SIN_PROPIETARIO } = require(r("bot/funciones/reservas/filtroCliente.js"));

const TABLA = "5k_15k_reservas_2_cifras";
const PRINCIPAL = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
const COMPRADOR = { id: "comprador-1", nombre: "Ana", telefono: "3001112222", lid: "ana@lid" };

const EVENTO_PRINCIPAL = { id: "ev-p", usuario_id: PRINCIPAL, tabla: TABLA, cifras: 2, identidad_evento_real: "sorteo-p", grupo_id: "gp@g.us", nombre_evento: "Sorteo P" };
const EVENTO_B = { id: "ev-b", usuario_id: B, tabla: TABLA, cifras: 2, identidad_evento_real: "sorteo-b", grupo_id: "gb@g.us", nombre_evento: "Sorteo B" };

// Las dos cuadrículas, con los MISMOS números.
function sembrar() {
    fake.tablas[TABLA] = [PRINCIPAL, B].flatMap(dueno => NUMEROS.map(numero => ({
        usuario_id: dueno, numero, estado: "libre", usuario_global_id: null, identidad_evento_real: null, evento_id: null
    })));
    fake.tablas.reservas_actividad = [];
}

const filaDe = (dueno, numero) => fake.tablas[TABLA].find(f => f.usuario_id === dueno && f.numero === numero);
const instantanea = (dueno) => JSON.stringify(fake.tablas[TABLA].filter(f => f.usuario_id === dueno));

const reservar = (evento, numeros) => reservarNumeros({
    evento, numeros, usuario: COMPRADOR, comprador: COMPRADOR.nombre, contacto: COMPRADOR.telefono, lib: COMPRADOR.lid
});

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("reservar en el sorteo de B solo toma números de la cuadrícula de B", async () => {
    sembrar();
    const antes = instantanea(PRINCIPAL);
    const hechos = await reservar(EVENTO_B, ["05", "12"]);
    assert.deepStrictEqual(hechos.map(f => f.numero).sort(), ["05", "12"]);
    assert.ok(hechos.every(f => f.usuario_id === B));
    assert.strictEqual(filaDe(B, "05").estado, "reservado");
    assert.strictEqual(instantanea(PRINCIPAL), antes, "la cuadrícula principal no cambia ni un campo");
});

prueba("el mismo número puede estar reservado en una cuadrícula y libre en la otra", async () => {
    sembrar();
    await reservar(EVENTO_PRINCIPAL, ["05"]);
    assert.strictEqual(filaDe(PRINCIPAL, "05").estado, "reservado");
    assert.strictEqual(filaDe(B, "05").estado, "libre");
    const deB = await reservar(EVENTO_B, ["05"]);
    assert.strictEqual(deB.length, 1, "B puede reservar su propio 05");
    assert.strictEqual(filaDe(PRINCIPAL, "05").usuario_global_id, COMPRADOR.id);
});

prueba("disponibilidad: cada sorteo ve solo sus 100 números", async () => {
    sembrar();
    await reservar(EVENTO_PRINCIPAL, ["01", "02", "03"]);
    const p = await consultarDisponibilidad({ evento: EVENTO_PRINCIPAL });
    const b = await consultarDisponibilidad({ evento: EVENTO_B });
    assert.strictEqual(p.numerosDisponibles.length + p.numerosOcupados.length, 100);
    assert.deepStrictEqual(p.numerosOcupados, ["01", "02", "03"]);
    assert.strictEqual(b.numerosDisponibles.length, 100);
    assert.deepStrictEqual(b.numerosOcupados, []);
});

prueba("consultar número y consultar reservas: sin filas de la otra cuadrícula", async () => {
    sembrar();
    await reservar(EVENTO_PRINCIPAL, ["07"]);
    const enB = await consultarNumero({ evento: EVENTO_B, usuario: COMPRADOR, numero: "07" });
    assert.notStrictEqual(enB?.estadoReal, "reservado_por_usuario", "en B el 07 no es del comprador");
    const filas = await consultarReservas(EVENTO_B, ["07"]);
    assert.ok(filas.length === 1 && filas[0].usuario_id === B && filas[0].estado === "libre");
});

prueba("«mis números»: el comprador solo ve lo reservado en el sorteo consultado", async () => {
    sembrar();
    await reservar(EVENTO_PRINCIPAL, ["10", "11"]);
    await reservar(EVENTO_B, ["40"]);
    const enP = await consultarMisNumeros({ evento: EVENTO_PRINCIPAL, usuario: COMPRADOR });
    const enB = await consultarMisNumeros({ evento: EVENTO_B, usuario: COMPRADOR });
    assert.deepStrictEqual(enP.map(String).sort(), ["10", "11"]);
    assert.deepStrictEqual(enB.map(String), ["40"]);
});

prueba("pago por sticker en B: solo paga en la cuadrícula de B (lectura y actualización filtradas)", async () => {
    sembrar();
    await reservar(EVENTO_PRINCIPAL, ["20"]);
    await reservar(EVENTO_B, ["21"]);
    // Peor caso: misma identidad de sorteo en ambas cuadrículas.
    for (const f of fake.tablas[TABLA]) if (f.estado === "reservado") f.identidad_evento_real = "misma";
    const antes = instantanea(PRINCIPAL);
    const r1 = await marcarReservasPagadasPorAdmin({ evento: { ...EVENTO_B, identidad_evento_real: "misma" }, usuario: COMPRADOR, realizadoPor: "admin" });
    assert.deepStrictEqual(r1.actualizadas.map(f => f.numero), ["21"]);
    assert.strictEqual(filaDe(B, "21").estado, "pagado");
    assert.strictEqual(instantanea(PRINCIPAL), antes, "el 20 de la cuenta principal sigue reservado");
});

prueba("evento SIN usuario_id: reservar, consultar y pagar se rechazan sin tocar nada", async () => {
    sembrar();
    await reservar(EVENTO_PRINCIPAL, ["30"]);
    const todo = JSON.stringify(fake.tablas[TABLA]);
    const huerfano = { ...EVENTO_PRINCIPAL, usuario_id: null };
    const errorOriginal = console.error;
    console.error = () => {};
    try {
        assert.deepStrictEqual(await reservar(huerfano, ["31", "32"]), []);
        assert.strictEqual(await consultarReservas(huerfano, ["30"]), null, "rechazada: no se confunde con «sin filas»");
        const disp = await consultarDisponibilidad({ evento: huerfano });
        // Rechazada = no se pudo leer: se marca como error, nunca como «sin números».
        assert.deepStrictEqual(disp, { numerosDisponibles: [], numerosOcupados: [], errorLectura: true });
        assert.deepStrictEqual(await consultarMisNumeros({ evento: huerfano, usuario: COMPRADOR }), []);
        assert.deepStrictEqual(await consultarNumero({ evento: huerfano, usuario: COMPRADOR, numero: "30" }), { numero: "30", estadoReal: "error_lectura" });
        const pago = await marcarReservasPagadasPorAdmin({ evento: huerfano, usuario: COMPRADOR, realizadoPor: "admin" });
        assert.strictEqual(pago.estado, "error");
    } finally {
        console.error = errorOriginal;
    }
    assert.strictEqual(JSON.stringify(fake.tablas[TABLA]), todo, "ninguna fila cambió");
});

prueba("soloDelCliente sin dueño: la consulta no se envía y responde SIN_PROPIETARIO en cualquier cadena", async () => {
    let enviada = false;
    const consulta = { eq() { enviada = true; return this; }, then() { enviada = true; } };
    const errorOriginal = console.error;
    console.error = () => {};
    const rechazada = soloDelCliente(consulta, { id: "x" });
    console.error = errorOriginal;
    const { data, error } = await rechazada.select().or("a.eq.1").order("numero").maybeSingle();
    assert.strictEqual(data, null);
    assert.strictEqual(error.code, SIN_PROPIETARIO);
    assert.strictEqual(enviada, false);
});

(async () => {
    let fallos = 0;
    const log = console.log;
    for (const { nombre, fn } of pruebas) {
        console.log = () => {};
        try { await fn(); console.log = log; console.log("✅", nombre); }
        catch (e) { console.log = log; fallos++; console.log("❌", nombre, "\n   ", e.message); }
    }
    console.log(`\n============================\nTOTAL: ${pruebas.length}  ✅ PASA: ${pruebas.length - fallos}  ❌ FALLA: ${fallos}\n============================`);
    process.exit(fallos ? 1 : 0);
})();
