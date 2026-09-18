// Script de verificación END-TO-END (temporal, no forma parte del flujo de
// producción) — Continuación de auditoría "pago vs consulta vs reserva".
//
// Simula el pipeline real detectarIntencion -> resolverConsulta ->
// calcularTipoPresentacion (los mismos módulos que usa eventHandler.js /
// responderResultado.js) contra una tabla de reservas fake, para verificar
// el MENSAJE FINAL que el bot enviaría, no solo la clasificación de
// intención.
//
//   node backend/_e2e_auditoria_pago.js
const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./tests/identidad/fakeSupabase");
const { detectarIntencion } = require("./bot/funciones/consultas/detectarIntencion");

const RUTA_SUPABASE = path.resolve(__dirname, "./lib/supabase.js");
const RUTA_CONSULTAR_MIS_NUMEROS = path.resolve(__dirname, "./bot/funciones/consultas/consultarMisNumeros.js");
const RUTA_RESOLVER_CONSULTA = path.resolve(__dirname, "./bot/funciones/consultas/resolverConsulta.js");
const RUTA_CONSULTAR_NUMERO = path.resolve(__dirname, "./bot/funciones/consultas/consultarNumero.js");

const TABLA = "reservas_test_e2e";

function cargarModulos(fake) {

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    delete require.cache[RUTA_CONSULTAR_MIS_NUMEROS];
    delete require.cache[RUTA_RESOLVER_CONSULTA];
    delete require.cache[RUTA_CONSULTAR_NUMERO];

    const { resolverConsulta } = require(RUTA_RESOLVER_CONSULTA);
    return { resolverConsulta };

}

const EVENTO = { id: "evento-1", tabla: TABLA, valor: 5000, cifras: 2 };
const USUARIO = { id: "cliente-1" };

// Escenario mixto: 12 y 45 reservados (pendientes de pago), 27 y 78 pagados
// -- todos del mismo cliente.
function sembrar(fake) {

    fake.tablas[TABLA] = [
        { numero: "12", estado: "reservado", usuario_global_id: "cliente-1" },
        { numero: "27", estado: "pagado", usuario_global_id: "cliente-1" },
        { numero: "45", estado: "reservado", usuario_global_id: "cliente-1" },
        { numero: "78", estado: "pagado", usuario_global_id: "cliente-1" }
    ];

}

const resultados = [];

async function ejecutar(nombre, msg, opciones = {}) {

    const fake = crearFakeSupabase();
    sembrar(fake);
    const { resolverConsulta } = cargarModulos(fake);

    const intencion = detectarIntencion(msg, EVENTO.cifras);

    let mensajeFinal = null;
    let flujo = "(silencio / sin flujo de consulta)";

    if (intencion.tipo === "reserva") {

        flujo = "RESERVA (detectarReserva.js escribiría en Supabase)";
        mensajeFinal = "(no se ejecuta detectarReserva en este script — solo se verifica que NO cae aquí quien no debería)";

    } else if (intencion.tipo && intencion.tipo !== "ninguna" && intencion.tipo !== "multiple") {

        flujo = `resolverConsulta("${intencion.tipo}")`;

        const consulta = await resolverConsulta({
            tipo: intencion.tipo,
            numeros: intencion.numeros,
            evento: EVENTO,
            usuario: USUARIO,
            modo: intencion.modo,
            bucket: intencion.bucket
        });

        mensajeFinal = consulta?.mensaje ?? "(resolverConsulta devolvió null)";

    }

    const fila = { msg, tipo: intencion.tipo, flujo, mensajeFinal };
    resultados.push(fila);

    console.log(`\n"${msg}"`);
    console.log(`  intención : ${intencion.tipo}` + (intencion.numeros?.length ? ` (numeros=${JSON.stringify(intencion.numeros)})` : ""));
    console.log(`  flujo     : ${flujo}`);
    console.log(`  mensaje   : ${mensajeFinal}`);

    return fila;

}

async function ejecutarConNumeroPagado(nombre, msg) {

    // Mismo escenario, pero el número 25 en particular YA está pagado --
    // para ver la respuesta real de numero_especifico en ese caso.
    const fake = crearFakeSupabase();
    fake.tablas[TABLA] = [
        { numero: "25", estado: "pagado", usuario_global_id: "cliente-1" }
    ];
    const { resolverConsulta } = cargarModulos(fake);

    const intencion = detectarIntencion(msg, EVENTO.cifras);

    const consulta = await resolverConsulta({
        tipo: intencion.tipo,
        numeros: intencion.numeros,
        evento: EVENTO,
        usuario: USUARIO,
        modo: intencion.modo,
        bucket: intencion.bucket
    });

    console.log(`\n"${msg}"  [con 25 YA PAGADO en la tabla]`);
    console.log(`  intención : ${intencion.tipo}`);
    console.log(`  mensaje   : ${consulta?.mensaje}`);

    return { tipo: intencion.tipo, mensaje: consulta?.mensaje };

}

async function ejecutarConNumeroPendiente(nombre, msg) {

    // Mismo mensaje, pero el número 25 SIGUE pendiente (reservado, no
    // pagado) -- para comprobar que el bot NUNCA le confirma un pago que
    // no existe en la base de datos real, sin importar lo que el cliente
    // afirme en el texto.
    const fake = crearFakeSupabase();
    fake.tablas[TABLA] = [
        { numero: "25", estado: "reservado", usuario_global_id: "cliente-1" }
    ];
    const { resolverConsulta } = cargarModulos(fake);

    const intencion = detectarIntencion(msg, EVENTO.cifras);

    const consulta = await resolverConsulta({
        tipo: intencion.tipo,
        numeros: intencion.numeros,
        evento: EVENTO,
        usuario: USUARIO,
        modo: intencion.modo,
        bucket: intencion.bucket
    });

    console.log(`\n"${msg}"  [con 25 AÚN PENDIENTE en la tabla]`);
    console.log(`  intención : ${intencion.tipo}`);
    console.log(`  mensaje   : ${consulta?.mensaje}`);

    return { tipo: intencion.tipo, mensaje: consulta?.mensaje };

}

async function main() {

    console.log("======================================================");
    console.log("PUNTO 1 — 'pago mis números' end-to-end (con datos mixtos)");
    console.log("======================================================");

    const r1 = await ejecutar("pago mis números", "pago mis números");

    assert.strictEqual(r1.tipo, "consulta_pago");
    assert.ok(!/estos son|tus números son|tu reserva es|qué números tienes/i.test(r1.mensajeFinal),
        `"pago mis números" NO debe sonar a "estos son tus números...": obtuvo "${r1.mensajeFinal}"`);
    console.log("  ✅ NO es una respuesta de tipo 'mis_numeros'");

    console.log("\n======================================================");
    console.log("PUNTO 2 — 'estos son mis números pagados' y variantes");
    console.log("======================================================");

    const variantesPunto2 = [
        "estos son mis números pagados",
        "mis números ya están pagados",
        "mis números están pagados",
        "ya están pagados",
        "mis números pagados",
        "estos son los números que pagué",
        "estos son mis números que ya pagué",
        "estos son mis numeros pagados",
        "mis numeros ya estan pagados",
        "mis numeros estan pagados",
        "ya estan pagados"
    ];

    for (const msg of variantesPunto2) {

        const r = await ejecutar("punto2", msg);
        assert.notStrictEqual(r.tipo, "mis_numeros", `"${msg}" NO debe terminar en mis_numeros`);

    }

    console.log("\n======================================================");
    console.log("PUNTO 3 — 'ya pagué el 25' vs '¿el 25 está pagado?' vs 'pago el 25'");
    console.log("======================================================");

    for (const msg of [
        "¿el 25 ya está pagado?",
        "¿el 25 está pagado?",
        "el 25 ya lo pagué",
        "ya pagué el 25",
        "pagué el 25",
        "quiero pagar el 25",
        "pago el 25"
    ]) {

        const intencion = detectarIntencion(msg, EVENTO.cifras);
        assert.strictEqual(intencion.tipo, "numero_especifico",
            `"${msg}" debería resolver el ESTADO REAL del número 25 (numero_especifico), obtuvo ${intencion.tipo}`);
        assert.notStrictEqual(intencion.tipo, "reserva", `"${msg}" jamás debe ser reserva`);

    }

    console.log("Con el 25 YA PAGADO en la tabla:");
    for (const msg of ["¿el 25 está pagado?", "ya pagué el 25", "pago el 25", "quiero pagar el 25"]) {
        const r = await ejecutarConNumeroPagado("pagado", msg);
        assert.ok(/pagado/i.test(r.mensaje), `mensaje debería confirmar que el 25 está pagado: "${r.mensaje}"`);
    }

    console.log("\nCon el 25 AÚN PENDIENTE en la tabla (el cliente afirma haber pagado, pero NO hay sticker/admin que lo confirme):");
    for (const msg of ["ya pagué el 25", "pagué el 25", "pago el 25"]) {
        const r = await ejecutarConNumeroPendiente("pendiente", msg);
        assert.ok(/reservado/i.test(r.mensaje) && !/ya está pagado/i.test(r.mensaje),
            `el bot NO debe confirmar un pago que no existe en la base real: "${r.mensaje}"`);
    }
    console.log("  ✅ El bot nunca 'le cree' al texto del cliente — siempre responde el estado REAL de Supabase.");

    console.log("\n======================================================");
    console.log("PUNTO 4 — REGLA ABSOLUTA: ningún mensaje de pago cae en reserva");
    console.log("======================================================");

    const mensajesPago = [
        "pago el 25",
        "pagar el 25",
        "voy a pagar el 25",
        "quiero pagar el 25",
        "ya pagué el 25",
        "pagué el 25",
        "el 25 ya lo pagué",
        "el 25 está pagado",
        "estos son mis números pagados"
    ];

    for (const msg of mensajesPago) {
        const intencion = detectarIntencion(msg, EVENTO.cifras);
        assert.notStrictEqual(intencion.tipo, "reserva", `"${msg}" NUNCA debe ser reserva (obtuvo ${intencion.tipo})`);
        console.log(`  ✅ "${msg}" -> ${intencion.tipo} (!== reserva)`);
    }

    console.log("\n======================================================");
    console.log("PUNTO 5 — el número aislado '25' SIGUE reservando (regla de negocio, sin cambios)");
    console.log("======================================================");

    assert.strictEqual(detectarIntencion("25", 2).tipo, "reserva");
    assert.strictEqual(detectarIntencion("resérvame el 25", 2).tipo, "reserva");
    assert.strictEqual(detectarIntencion("quiero el 25", 2).tipo, "reserva");
    console.log("  ✅ '25' / 'resérvame el 25' / 'quiero el 25' -> reserva (sin cambios)");

    console.log("\n======================================================");
    console.log("PUNTO 6 — validación de 2 cifras / teléfonos / cédulas");
    console.log("======================================================");

    const { extraerNumeros } = require("./bot/funciones/reservas/extraerNumeros");

    // Auditoría "reservas por número de cifras": una sola cifra ("5") ya
    // NO se completa con un cero a la izquierda -- son datos distintos de
    // "05", y solo el segundo es válido para un evento de 2 cifras.
    const casosExtraccion = [
        ["5", []],
        ["05", ["05"]],
        ["25", ["25"]],
        ["99", ["99"]],
        ["100", []],
        ["300", []],
        ["3001234567", []]
    ];

    for (const [texto, esperado] of casosExtraccion) {
        const obtenido = extraerNumeros(texto, 2);
        console.log(`  extraerNumeros("${texto}", cifras=2) = ${JSON.stringify(obtenido)}  (esperado ${JSON.stringify(esperado)})`);
        assert.deepStrictEqual(obtenido, esperado, `extraerNumeros("${texto}") no coincide con la regla documentada`);
    }

    assert.strictEqual(detectarIntencion("3001234567", 2).tipo, "ninguna");
    assert.strictEqual(detectarIntencion("mi cedula es 1023456789", 2).tipo, "ninguna");
    console.log("  ✅ Teléfono/cédula largos -> 'ninguna' (nunca reserva, nunca consulta de número)");

    console.log("\n======================================================");
    console.log("TODO OK");
    console.log("======================================================");

}

main().catch(err => {
    console.error("❌ FALLA E2E:", err.message);
    console.error(err.stack);
    process.exitCode = 1;
});
