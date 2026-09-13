// ==========================================================================
// PRUEBAS — Fase "activar consultas de números y estado de pago".
//
// Cubre los 19 casos obligatorios del pedido (el punto 20 — "ningún test
// existente de reservas debe romperse" — se valida corriendo las suites ya
// existentes, no duplicándolas aquí):
//
//   1-2   consultarMisNumerosPorEstado separa reservado/pagado y aísla por
//         usuario (nunca mezcla otro usuario_global_id).
//   3-10  resolverConsulta("consulta_pago") — cantidad/lista/monto para
//         cada bucket (pendiente/pagado/total).
//   11-19 detectarIntencion — clasificación real (consulta_pago,
//         numero_especifico, reserva preservada, cantidad preservada).
//
// Mismo estilo que el resto del proyecto: script plano de Node (sin jest),
// fake de Supabase inyectado vía require.cache (reutiliza
// tests/identidad/fakeSupabase.js — mismo criterio "cada dominio puede
// reusar el fake existente si le alcanza", ya usado por
// tests/pagos-sticker/confirmarPagoPorSticker.test.js con su propio fake).
//
//     node backend/tests/consultas/consultasPago.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("../identidad/fakeSupabase");
const { detectarIntencion } = require("../../bot/funciones/consultas/detectarIntencion");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_CONSULTAR_MIS_NUMEROS = path.resolve(__dirname, "../../bot/funciones/consultas/consultarMisNumeros.js");
const RUTA_RESOLVER_CONSULTA = path.resolve(__dirname, "../../bot/funciones/consultas/resolverConsulta.js");

const TABLA = "reservas_test_consultas";

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    delete require.cache[RUTA_CONSULTAR_MIS_NUMEROS];
    delete require.cache[RUTA_RESOLVER_CONSULTA];

    const { consultarMisNumeros, consultarMisNumerosPorEstado } = require(RUTA_CONSULTAR_MIS_NUMEROS);
    const { resolverConsulta } = require(RUTA_RESOLVER_CONSULTA);

    return { fake, consultarMisNumeros, consultarMisNumerosPorEstado, resolverConsulta };

}

// Escenario del enunciado: 12 reservado, 27 pagado, 45 reservado, 78
// pagado (todos de cliente-1) + un número de OTRO usuario que nunca debe
// aparecer en ningún resultado de cliente-1.
function sembrarEscenario(fake) {

    fake.tablas[TABLA] = [
        { numero: "12", estado: "reservado", usuario_global_id: "cliente-1" },
        { numero: "27", estado: "pagado", usuario_global_id: "cliente-1" },
        { numero: "45", estado: "reservado", usuario_global_id: "cliente-1" },
        { numero: "78", estado: "pagado", usuario_global_id: "cliente-1" },
        { numero: "99", estado: "reservado", usuario_global_id: "cliente-2" },
        { numero: "50", estado: "libre", usuario_global_id: null }
    ];

}

const EVENTO = { id: "evento-1", tabla: TABLA, valor: 5000 };
const USUARIO = { id: "cliente-1" };

const resultados = [];

async function test(nombre, fn) {

    try {
        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.stack || err.message}`);
    }

}

async function ejecutarPruebas() {

    // ======================================================================
    // 1-2. consultarMisNumerosPorEstado: separa estados y aísla por usuario
    // ======================================================================

    await test("1. consultarMisNumerosPorEstado separa reservado/pagado correctamente", async () => {

        const { fake, consultarMisNumerosPorEstado } = cargarModulos();
        sembrarEscenario(fake);

        const resultado = await consultarMisNumerosPorEstado({ evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(resultado.total, 4);
        assert.deepStrictEqual(resultado.reservados, ["12", "45"]);
        assert.deepStrictEqual(resultado.pagados, ["27", "78"]);

    });

    await test("2. consultarMisNumerosPorEstado NUNCA devuelve números de otro usuario", async () => {

        const { fake, consultarMisNumerosPorEstado } = cargarModulos();
        sembrarEscenario(fake);

        const resultado = await consultarMisNumerosPorEstado({ evento: EVENTO, usuario: USUARIO });

        const todos = [...resultado.reservados, ...resultado.pagados];

        assert.ok(!todos.includes("99"), "el número 99 es de cliente-2, nunca debe aparecer");
        assert.ok(!todos.includes("50"), "el número 50 está libre, nunca debe aparecer como propio");

    });

    // ======================================================================
    // 3-7. resolverConsulta("consulta_pago") — cantidad y listas
    // ======================================================================

    await test("3. cantidad total (bucket=total, modo=cantidad)", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "cantidad", bucket: "total" });

        assert.strictEqual(r.cantidad, 4);

    });

    await test("4. cantidad pendiente (bucket=pendiente, modo=cantidad)", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "cantidad", bucket: "pendiente" });

        assert.strictEqual(r.cantidad, 2);
        assert.strictEqual(r.mensaje, "Tienes 2 números pendientes de pago.");

    });

    await test("5. cantidad pagada (bucket=pagado, modo=cantidad)", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "cantidad", bucket: "pagado" });

        assert.strictEqual(r.cantidad, 2);
        assert.strictEqual(r.mensaje, "Tienes 2 números pagados.");

    });

    await test("6. lista pendiente (bucket=pendiente, modo=lista)", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "lista", bucket: "pendiente" });

        assert.deepStrictEqual(r.numerosDelUsuario, ["12", "45"]);
        assert.ok(r.mensaje.includes("12") && r.mensaje.includes("45"));
        assert.ok(!r.mensaje.includes("27") && !r.mensaje.includes("78"), "no debe mezclar los ya pagados en la lista de pendientes");

    });

    await test("7. lista pagada (bucket=pagado, modo=lista)", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "lista", bucket: "pagado" });

        assert.deepStrictEqual(r.numerosDelUsuario, ["27", "78"]);
        assert.ok(!r.mensaje.includes("12") && !r.mensaje.includes("45"), "no debe mezclar los pendientes en la lista de pagados");

    });

    // ======================================================================
    // 8-10. resolverConsulta("consulta_pago") — cálculo monetario
    // ======================================================================

    await test("8. cálculo total = cantidad_total * evento.valor", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "monto", bucket: "total" });

        assert.strictEqual(r.montoTotal, 4 * 5000);
        assert.ok(r.mensaje.includes("20.000") || r.mensaje.includes("20000"));

    });

    await test("9. cálculo pagado = cantidad_pagada * evento.valor", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "monto", bucket: "pagado" });

        assert.strictEqual(r.montoPagado, 2 * 5000);
        assert.strictEqual(r.mensaje, "✅ Has pagado: $10.000.");

    });

    await test("10. cálculo pendiente = cantidad_reservada * evento.valor", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "monto", bucket: "pendiente" });

        assert.strictEqual(r.montoPendiente, 2 * 5000);
        assert.strictEqual(r.mensaje, "💰 Tienes pendiente por pagar: $10.000.");

    });

    // Sin pagos parciales: nunca debe existir un campo de "abono"/"saldo"/
    // "ledger" en el resultado — solo los 3 montos completos.
    await test("EXTRA: no existen pagos parciales — solo montoTotal/montoPagado/montoPendiente", async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenario(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", numeros: [], evento: EVENTO, usuario: USUARIO, modo: "monto", bucket: "pendiente" });

        assert.strictEqual(r.abono, undefined);
        assert.strictEqual(r.saldo, undefined);
        assert.strictEqual(r.ledger, undefined);

    });

    // ======================================================================
    // 11-13. detectarIntencion — consulta_pago (monetaria)
    // ======================================================================

    await test('11. "cuánto debo" => consulta_pago', () => {
        assert.strictEqual(detectarIntencion("cuánto debo").tipo, "consulta_pago");
    });

    await test('12. "cuánto he pagado" => consulta_pago', () => {
        assert.strictEqual(detectarIntencion("cuánto he pagado").tipo, "consulta_pago");
    });

    await test('13. "cuánto me falta" => consulta_pago', () => {
        assert.strictEqual(detectarIntencion("cuánto me falta").tipo, "consulta_pago");
    });

    // ======================================================================
    // 14-15. detectarIntencion — numero_especifico (pagué/pagado + número)
    // ======================================================================

    await test('14. "el 25 ya lo pagué" => numero_especifico', () => {
        const r = detectarIntencion("el 25 ya lo pagué");
        assert.strictEqual(r.tipo, "numero_especifico");
        assert.deepStrictEqual(r.numeros, ["25"]);
    });

    await test('15. "el 25 está pagado" => numero_especifico', () => {
        const r = detectarIntencion("el 25 está pagado");
        assert.strictEqual(r.tipo, "numero_especifico");
        assert.deepStrictEqual(r.numeros, ["25"]);
    });

    // ======================================================================
    // 16-17. detectarIntencion — reserva NUNCA se rompe
    // ======================================================================

    await test('16. "25" => reserva', () => {
        assert.strictEqual(detectarIntencion("25").tipo, "reserva");
    });

    await test('17. "me llevo el 25" => reserva', () => {
        assert.strictEqual(detectarIntencion("me llevo el 25").tipo, "reserva");
    });

    // ======================================================================
    // 18. "cuántos llevo" sigue siendo cantidad, NUNCA pago
    // ======================================================================

    await test('18. "cuántos llevo" => cantidad_reservas, NO consulta_pago', () => {
        assert.strictEqual(detectarIntencion("cuántos llevo").tipo, "cantidad_reservas");
    });

    // ======================================================================
    // 19. Mensaje combinado reserva+pago — se preserva la clasificación ya
    // definida (consulta_pago gana, igual que antes de esta fase).
    // ======================================================================

    await test('19. "me llevo el 25, cuánto debo" => consulta_pago (clasificación ya definida)', () => {
        assert.strictEqual(detectarIntencion("me llevo el 25, cuánto debo").tipo, "consulta_pago");
    });

    const fallidas = resultados.filter(r => !r.ok);

    console.log("\n============================================");
    console.log(`Pruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas.length}  |  Fallidas: ${fallidas.length}`);
    console.log("============================================\n");

    if (fallidas.length > 0) {
        process.exitCode = 1;
    }

}

ejecutarPruebas();
