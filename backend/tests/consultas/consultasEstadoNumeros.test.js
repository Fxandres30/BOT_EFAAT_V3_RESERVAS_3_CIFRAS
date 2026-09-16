// ==========================================================================
// PRUEBAS — Fase "consultas de estado de números sin contradicciones".
//
// Cubre lo que consultasPago.test.js (fase anterior) NO cubría:
//   1. Las frases NUEVAS de esta fase (cuáles/cuántos pagados/pendientes,
//      cuánto es todo).
//   2. Las 5 consultas COMBINADAS pedidas explícitamente.
//   3. El escenario EXACTO de la contradicción real reportada (una
//      consulta decía "pagado", otra "reservado", para el mismo cliente) —
//      demuestra que ahora es imposible.
//   4. Que la fuente de datos para una consulta combinada es UNA SOLA
//      lectura (nunca dos que puedan divergir).
//
// Mismo estilo que el resto del proyecto: script plano de Node (sin jest),
// fake de Supabase inyectado vía require.cache (reutiliza
// tests/identidad/fakeSupabase.js).
//
//     node backend/tests/consultas/consultasEstadoNumeros.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("../identidad/fakeSupabase");
const { detectarIntencion } = require("../../bot/funciones/consultas/detectarIntencion");
const { calcularTipoPresentacion } = require("../../bot/ai/plantillaMensaje");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_CONSULTAR_MIS_NUMEROS = path.resolve(__dirname, "../../bot/funciones/consultas/consultarMisNumeros.js");
const RUTA_RESOLVER_CONSULTA = path.resolve(__dirname, "../../bot/funciones/consultas/resolverConsulta.js");

const TABLA = "reservas_test_estado_numeros";

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

    const { resolverConsulta } = require(RUTA_RESOLVER_CONSULTA);

    return { fake, resolverConsulta };

}

// Escenario del enunciado: 12 reservado, 27 pagado, 45 reservado, 78
// pagado — todos de cliente-1.
function sembrarEscenarioMixto(fake) {

    fake.tablas[TABLA] = [
        { numero: "12", estado: "reservado", usuario_global_id: "cliente-1" },
        { numero: "27", estado: "pagado", usuario_global_id: "cliente-1" },
        { numero: "45", estado: "reservado", usuario_global_id: "cliente-1" },
        { numero: "78", estado: "pagado", usuario_global_id: "cliente-1" }
    ];

}

// Escenario de la CONTRADICCIÓN REAL reportada: un cliente con TODOS sus
// números ya pagados (0 pendientes).
function sembrarEscenarioTotalmentePagado(fake) {

    fake.tablas[TABLA] = [
        { numero: "10", estado: "pagado", usuario_global_id: "cliente-1" },
        { numero: "20", estado: "pagado", usuario_global_id: "cliente-1" }
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
    // Frases nuevas — clasificación (detectarIntencion, sin Supabase)
    // ======================================================================

    await test('"cuáles están pagados" => consulta_pago (lista, pagado)', () => {
        const r = detectarIntencion("cuáles están pagados");
        assert.strictEqual(r.tipo, "consulta_pago");
        assert.strictEqual(r.modo, "lista");
        assert.strictEqual(r.bucket, "pagado");
    });

    await test('"cuáles están pendientes" => consulta_pago (lista, pendiente)', () => {
        const r = detectarIntencion("cuáles están pendientes");
        assert.strictEqual(r.tipo, "consulta_pago");
        assert.strictEqual(r.modo, "lista");
        assert.strictEqual(r.bucket, "pendiente");
    });

    await test('"cuántos están pagados" => consulta_pago (cantidad, pagado)', () => {
        const r = detectarIntencion("cuántos están pagados");
        assert.strictEqual(r.tipo, "consulta_pago");
        assert.strictEqual(r.modo, "cantidad");
        assert.strictEqual(r.bucket, "pagado");
    });

    await test('"cuántos están pendientes" => consulta_pago (cantidad, pendiente)', () => {
        const r = detectarIntencion("cuántos están pendientes");
        assert.strictEqual(r.tipo, "consulta_pago");
        assert.strictEqual(r.modo, "cantidad");
        assert.strictEqual(r.bucket, "pendiente");
    });

    await test('"cuánto es todo" => consulta_pago (monto, total)', () => {
        const r = detectarIntencion("cuánto es todo");
        assert.strictEqual(r.tipo, "consulta_pago");
        assert.strictEqual(r.modo, "monto");
        assert.strictEqual(r.bucket, "total");
    });

    // ======================================================================
    // Frases nuevas — resolución real (con datos)
    // ======================================================================

    await test('resolverConsulta: "cuáles están pagados" devuelve SOLO los pagados', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", modo: "lista", bucket: "pagado", evento: EVENTO, usuario: USUARIO });

        assert.deepStrictEqual(r.numerosDelUsuario, ["27", "78"]);

    });

    await test('resolverConsulta: "cuántos están pendientes" cuenta SOLO los pendientes', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", modo: "cantidad", bucket: "pendiente", evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(r.cantidad, 2);

    });

    await test('resolverConsulta: "cuánto es todo" = total_numeros * valor', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const r = await resolverConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "total", evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(r.montoTotal, 4 * 5000);

    });

    // ======================================================================
    // LA CONTRADICCIÓN REAL — debe quedar IMPOSIBLE
    // ======================================================================

    await test('CONTRADICCIÓN IMPOSIBLE: cliente totalmente pagado -> "mis números" NUNCA dice "reservado"', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioTotalmentePagado(fake);

        const misNumeros = await resolverConsulta({ tipo: "mis_numeros", evento: EVENTO, usuario: USUARIO });

        assert.ok(!/reservad/i.test(misNumeros.mensaje), `"mis_numeros" no debe afirmar "reservado" — obtuvo: "${misNumeros.mensaje}"`);

    });

    await test('CONTRADICCIÓN IMPOSIBLE: mismo cliente, "cuánto debo" dice 0 pendiente Y "cuánto he pagado" dice el total completo', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioTotalmentePagado(fake);

        const cuantoDebo = await resolverConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "pendiente", evento: EVENTO, usuario: USUARIO });
        const cuantoPagado = await resolverConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "pagado", evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(cuantoDebo.montoPendiente, 0);
        assert.strictEqual(cuantoDebo.estadoPago, "pago_completo");
        // "pago_completo" nunca reutiliza el texto genérico de sin_pago/
        // sin_saldo ("No tienes ningún pago pendiente.") — confirma
        // explícitamente que el pago está completo (ver auditoría
        // "consulta de pago contextual").
        assert.strictEqual(cuantoDebo.mensaje, "✅ Ya pagaste el total. No tienes ningún saldo pendiente.");

        assert.strictEqual(cuantoPagado.montoPagado, 2 * 5000);
        assert.ok(cuantoPagado.mensaje.includes("10.000"));

        // Invariante matemática que hace la contradicción imposible por
        // construcción: pagado + pendiente SIEMPRE es el total.
        assert.strictEqual(cuantoDebo.montoPendiente + cuantoPagado.montoPagado, cuantoPagado.montoTotal);

    });

    // ======================================================================
    // "CONSULTA DE PAGO CONTEXTUAL" — calcularTipoPresentacion reparte
    // consulta_pago en 4 categorías reales según estadoPago, NUNCA una
    // plantilla universal (ver backend/bot/ai/plantillaMensaje.js +
    // backend/shared/pagos/determinarEstadoPago.js).
    // ======================================================================

    await test('tipo_respuesta = "consulta_pago_pago_parcial" cuando pagado>0 y pendiente>0', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const resultado = await resolverConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "pendiente", evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(resultado.estadoPago, "pago_parcial");
        assert.strictEqual(calcularTipoPresentacion({ consulta: resultado }, resultado), "consulta_pago_pago_parcial");

    });

    await test('tipo_respuesta = "consulta_pago_pago_completo" cuando ya pagó el total', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioTotalmentePagado(fake);

        const resultado = await resolverConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "pendiente", evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(resultado.estadoPago, "pago_completo");
        assert.strictEqual(calcularTipoPresentacion({ consulta: resultado }, resultado), "consulta_pago_pago_completo");

    });

    await test('tipo_respuesta = "consulta_pago_sin_pago" cuando no ha pagado nada', async () => {

        const { fake, resolverConsulta } = cargarModulos();

        fake.tablas[TABLA] = [
            { numero: "10", estado: "reservado", usuario_global_id: "cliente-1" },
            { numero: "20", estado: "reservado", usuario_global_id: "cliente-1" }
        ];

        const resultado = await resolverConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "pendiente", evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(resultado.estadoPago, "sin_pago");
        assert.strictEqual(calcularTipoPresentacion({ consulta: resultado }, resultado), "consulta_pago_sin_pago");

    });

    await test('tipo_respuesta = "consulta_pago_sin_saldo" cuando no tiene ninguna reserva activa', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        fake.tablas[TABLA] = [];

        const resultado = await resolverConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "pendiente", evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(resultado.estadoPago, "sin_saldo");
        assert.strictEqual(calcularTipoPresentacion({ consulta: resultado }, resultado), "consulta_pago_sin_saldo");

    });

    await test('"multiple" (consulta combinada) NUNCA se reparte por estadoPago — conserva tipo_respuesta="multiple"', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const intencion = detectarIntencion("mis números y cuánto debo");
        const resultado = await resolverConsulta({ tipo: "multiple", intenciones: intencion.intenciones, evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(calcularTipoPresentacion({ consulta: resultado }, resultado), "multiple");

    });

    // ======================================================================
    // Las 5 CONSULTAS COMBINADAS pedidas explícitamente
    // ======================================================================

    await test('COMBINADA 1: "mis números y cuánto debo"', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const intencion = detectarIntencion("mis números y cuánto debo");
        assert.strictEqual(intencion.tipo, "multiple");
        assert.strictEqual(intencion.intenciones.length, 2);

        const r = await resolverConsulta({ tipo: "multiple", intenciones: intencion.intenciones, evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(r.resultados.length, 2);
        assert.strictEqual(r.resultados[0].tipo, "mis_numeros");
        assert.strictEqual(r.resultados[1].tipo, "consulta_pago");
        assert.strictEqual(r.resultados[1].bucket, "pendiente");
        assert.strictEqual(r.resultados[1].montoPendiente, 2 * 5000);
        assert.ok(!/reservad/i.test(r.resultados[0].mensaje));

    });

    await test('COMBINADA 2: "cuáles son mis números y cuáles ya pagué"', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const intencion = detectarIntencion("cuáles son mis números y cuáles ya pagué");
        assert.strictEqual(intencion.tipo, "multiple");

        const r = await resolverConsulta({ tipo: "multiple", intenciones: intencion.intenciones, evento: EVENTO, usuario: USUARIO });

        const facetaMisNumeros = r.resultados.find(x => x.tipo === "mis_numeros");
        const facetaPagados = r.resultados.find(x => x.bucket === "pagado");

        assert.deepStrictEqual(facetaMisNumeros.numerosDelUsuario, ["12", "27", "45", "78"]);
        assert.deepStrictEqual(facetaPagados.numerosDelUsuario, ["27", "78"]);

    });

    await test('COMBINADA 3: "mis números, cuánto he pagado y cuánto me falta" (3 partes)', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const intencion = detectarIntencion("mis números, cuánto he pagado y cuánto me falta");
        assert.strictEqual(intencion.tipo, "multiple");
        assert.strictEqual(intencion.intenciones.length, 3);

        const r = await resolverConsulta({ tipo: "multiple", intenciones: intencion.intenciones, evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(r.resultados.length, 3);

        const pagado = r.resultados.find(x => x.bucket === "pagado");
        const pendiente = r.resultados.find(x => x.bucket === "pendiente");

        assert.strictEqual(pagado.montoPagado, 2 * 5000);
        assert.strictEqual(pendiente.montoPendiente, 2 * 5000);

    });

    await test('COMBINADA 4: "cuáles tengo y cuánto es todo"', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const intencion = detectarIntencion("cuáles tengo y cuánto es todo");
        assert.strictEqual(intencion.tipo, "multiple");

        const r = await resolverConsulta({ tipo: "multiple", intenciones: intencion.intenciones, evento: EVENTO, usuario: USUARIO });

        const facetaTotal = r.resultados.find(x => x.bucket === "total" && x.modo === "monto");

        assert.strictEqual(facetaTotal.montoTotal, 4 * 5000);

    });

    await test('COMBINADA 5: "hola mis números y qué debo" (relleno conversacional ignorado)', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const intencion = detectarIntencion("hola mis números y qué debo");
        assert.strictEqual(intencion.tipo, "multiple");

        const r = await resolverConsulta({ tipo: "multiple", intenciones: intencion.intenciones, evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(r.resultados.length, 2);
        assert.strictEqual(r.resultados[0].tipo, "mis_numeros");
        assert.strictEqual(r.resultados[1].tipo, "consulta_pago");

    });

    // ======================================================================
    // Una sola lectura de Supabase para toda la consulta combinada
    // ======================================================================

    await test('UNA SOLA LECTURA: la consulta combinada consulta Supabase una única vez', async () => {

        const { fake, resolverConsulta } = cargarModulos();
        sembrarEscenarioMixto(fake);

        const intencion = detectarIntencion("mis números, cuánto he pagado y cuánto me falta");

        await resolverConsulta({ tipo: "multiple", intenciones: intencion.intenciones, evento: EVENTO, usuario: USUARIO });

        assert.strictEqual(fake.llamadas[TABLA]?.select, 1, "debe hacerse UNA sola lectura, nunca una por sub-intención");

    });

    // ======================================================================
    // Aislamiento: no se combinan tipos ajenos (reserva intacta)
    // ======================================================================

    await test('"quiero el 12 y el 45" sigue siendo UNA sola reserva (nunca se combina)', () => {

        const r = detectarIntencion("quiero el 12 y el 45");

        assert.strictEqual(r.tipo, "reserva");
        assert.deepStrictEqual(r.numeros, ["12", "45"]);

    });

    await test('segmentar sin conectores no cambia nada ("mis números" solo)', () => {

        const r = detectarIntencion("mis números");

        assert.strictEqual(r.tipo, "mis_numeros");
        assert.strictEqual(r.intenciones, undefined);

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
