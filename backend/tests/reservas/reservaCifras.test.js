// ==========================================================================
// PRUEBAS — Auditoría "reservas por número de cifras" (defensa en
// profundidad end-to-end, hasta la escritura real en Supabase).
//
// extraerNumeros.test.js ya cubre la extracción de texto. Este archivo
// cubre las DOS capas siguientes con datos reales simulados:
//
//   1. detectarReserva.js  -> nunca consulta/reserva un número cuyo
//      formato no tenga EXACTAMENTE las cifras del evento.
//   2. reservarNumeros.js  -> aunque a esta función le llegue un número
//      inválido "por cualquier motivo" (bypass hipotético de las capas
//      anteriores), el UPDATE a Supabase JAMÁS lo incluye.
//
// Mismo estilo que el resto del proyecto: script plano de Node (sin
// jest), fake de Supabase inyectado vía require.cache.
//
//     node backend/tests/reservas/reservaCifras.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("../identidad/fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_RESERVAR_NUMEROS = path.resolve(__dirname, "../../bot/funciones/reservas/reservarNumeros.js");
const RUTA_DETECTAR_RESERVA = path.resolve(__dirname, "../../bot/funciones/reservas/detectarReserva.js");

const TABLA = "reservas_test_cifras";

function cargarModulos(fake) {

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    delete require.cache[RUTA_RESERVAR_NUMEROS];
    delete require.cache[RUTA_DETECTAR_RESERVA];

    return {
        reservarNumeros: require(RUTA_RESERVAR_NUMEROS).reservarNumeros,
        detectarReserva: require(RUTA_DETECTAR_RESERVA).detectarReserva
    };

}

const EVENTO = { id: "evento-1", tabla: TABLA, valor: 5000, cifras: 2, grupo_id: "g1", usuario_id: "u1" };
const USUARIO = { id: "cliente-1", nombre: "Cliente Uno", telefono: "3000000000", lid: null };

function sembrar(fake) {

    fake.tablas[TABLA] = [
        { numero: "05", estado: "libre", usuario_global_id: null },
        { numero: "25", estado: "libre", usuario_global_id: null },
        { numero: "99", estado: "libre", usuario_global_id: null }
    ];

}

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
    // CAPA 1 — detectarReserva.js: nunca consulta/reserva formato inválido
    // ======================================================================

    await test("detectarReserva('5') -> null (una cifra, evento de 2 cifras)", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { detectarReserva } = cargarModulos(fake);

        const resultado = await detectarReserva({ evento: EVENTO, texto: "5", usuario: USUARIO, lib: null });

        assert.strictEqual(resultado, null);
        assert.strictEqual(fake.llamadas[TABLA]?.select ?? 0, 0, "NUNCA debe llegar a consultar Supabase con un formato inválido");

    });

    await test("detectarReserva('100') -> null (tres cifras, evento de 2 cifras)", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { detectarReserva } = cargarModulos(fake);

        const resultado = await detectarReserva({ evento: EVENTO, texto: "100", usuario: USUARIO, lib: null });

        assert.strictEqual(resultado, null);
        assert.strictEqual(fake.llamadas[TABLA]?.select ?? 0, 0);

    });

    await test("detectarReserva('05') SÍ reserva de verdad (formato válido, sin cambios)", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { detectarReserva } = cargarModulos(fake);

        const resultado = await detectarReserva({ evento: EVENTO, texto: "05", usuario: USUARIO, lib: null });

        assert.strictEqual(resultado?.ok, true);
        assert.deepStrictEqual(resultado.reservados, ["05"]);

        const fila = fake.tablas[TABLA].find(f => f.numero === "05");
        assert.strictEqual(fila.estado, "reservado");

    });

    await test("detectarReserva('5 25') -> reserva SOLO el 25, '5' nunca se reserva ni se fusiona con '05'", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { detectarReserva } = cargarModulos(fake);

        const resultado = await detectarReserva({ evento: EVENTO, texto: "5 25", usuario: USUARIO, lib: null });

        assert.strictEqual(resultado?.ok, true);
        assert.deepStrictEqual(resultado.reservados, ["25"]);

        const fila05 = fake.tablas[TABLA].find(f => f.numero === "05");
        assert.strictEqual(fila05.estado, "libre", "'05' NUNCA debe tocarse cuando el cliente escribió '5', no '05'");

    });

    // ======================================================================
    // CAPA 2 — reservarNumeros.js: última barrera antes del UPDATE real,
    // incluso si algo "por cualquier motivo" le pasa un número inválido.
    // ======================================================================

    await test("reservarNumeros({numeros:['5']}) -> [] y NUNCA hace el UPDATE en Supabase", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { reservarNumeros } = cargarModulos(fake);

        const resultado = await reservarNumeros({
            evento: EVENTO,
            numeros: ["5"],
            usuario: USUARIO,
            comprador: USUARIO.nombre,
            contacto: USUARIO.telefono,
            lib: null
        });

        assert.deepStrictEqual(resultado, []);
        assert.strictEqual(fake.llamadas[TABLA]?.update ?? 0, 0, "un número con formato inválido NUNCA debe generar un UPDATE real");

        // La tabla queda exactamente igual que antes (nada se tocó).
        assert.strictEqual(fake.tablas[TABLA].every(f => f.estado === "libre"), true);

    });

    await test("reservarNumeros({numeros:['5','25']}) -> SOLO reserva el 25 (el '5' se filtra antes del UPDATE)", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { reservarNumeros } = cargarModulos(fake);

        const resultado = await reservarNumeros({
            evento: EVENTO,
            numeros: ["5", "25"],
            usuario: USUARIO,
            comprador: USUARIO.nombre,
            contacto: USUARIO.telefono,
            lib: null
        });

        assert.strictEqual(resultado.length, 1);
        assert.strictEqual(resultado[0].numero, "25");

        const fila25 = fake.tablas[TABLA].find(f => f.numero === "25");
        assert.strictEqual(fila25.estado, "reservado");

    });

    await test("reservarNumeros({numeros:['100']}) -> [] (tres cifras, nunca llega al UPDATE)", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { reservarNumeros } = cargarModulos(fake);

        const resultado = await reservarNumeros({
            evento: EVENTO,
            numeros: ["100"],
            usuario: USUARIO,
            comprador: USUARIO.nombre,
            contacto: USUARIO.telefono,
            lib: null
        });

        assert.deepStrictEqual(resultado, []);
        assert.strictEqual(fake.llamadas[TABLA]?.update ?? 0, 0);

    });

    await test("reservarNumeros({numeros:['25']}) SIGUE reservando normalmente (formato válido, sin regresión)", async () => {

        const fake = crearFakeSupabase();
        sembrar(fake);
        const { reservarNumeros } = cargarModulos(fake);

        const resultado = await reservarNumeros({
            evento: EVENTO,
            numeros: ["25"],
            usuario: USUARIO,
            comprador: USUARIO.nombre,
            contacto: USUARIO.telefono,
            lib: null
        });

        assert.strictEqual(resultado.length, 1);
        assert.strictEqual(resultado[0].numero, "25");
        assert.strictEqual(fake.llamadas[TABLA]?.update ?? 0, 1);

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
