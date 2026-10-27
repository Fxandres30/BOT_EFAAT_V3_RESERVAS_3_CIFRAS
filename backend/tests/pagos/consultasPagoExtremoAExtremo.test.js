// ==========================================================================
// PRUEBAS — Consultas de pago de EXTREMO A EXTREMO (mensaje de WhatsApp ->
// intención -> sorteo del grupo -> lectura de la tabla -> interruptores y
// plantillas del panel -> respuesta enviada).
//
// Reales: eventHandler.js, detectarEvento.js (no detecta anuncio),
// consultarEvento.js, detectarIntencion.js, resolverConsulta.js,
// consultarMisNumeros.js, configMensajes.js, responderResultado.js,
// plantillaMensaje.js, seleccionarPlantilla.js. Simulados: Supabase (en
// memoria, tests/sorteos/fakeSupabaseSorteos.js), el envío de WhatsApp y
// Gemini (que nunca debe usarse en consultas de pago).
//
// Ningún estado ni importe se modifica para "hacer pasar" una prueba: cada
// escenario siembra datos y comprueba que la respuesta refleja esos datos.
//
//     node backend/tests/pagos/consultasPagoExtremoAExtremo.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (p, e) => { require.cache[r(p)] = { id: r(p), filename: r(p), loaded: true, exports: e }; };

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");
const fake = crearFake();
inyectar("lib/supabase.js", fake.client);

const espias = { enviados: [], gemini: 0 };
inyectar("services/baileys/send.js", { sendMessage: async ({ text }) => { espias.enviados.push(text); }, sendImage: async () => {} });
inyectar("bot/ai/aiService.js", { suggestReply: async () => { espias.gemini++; return { respuesta: "(IA)" }; } });

const eventHandler = require(r("bot/handlers/eventHandler.js"));

const TENANT = "tenant-pagos";
const OTRO_TENANT = "tenant-ajeno";
const T5 = "5k_15k_reservas_2_cifras";
const T10 = "10k_reservas_2_cifras";
const G1 = "g1@g.us";
const G2 = "g2@g.us";

const USUARIOS = {
    sinPago: { id: "u-sin-pago", telefono: "573000000001" },
    parcial: { id: "u-parcial", telefono: "573000000002" },
    completo: { id: "u-completo", telefono: "573000000003" },
    sinSaldo: { id: "u-sin-saldo", telefono: "573000000004" },
    multi: { id: "u-multi", telefono: "573000000005" }
};

function fila(numero, estado, usuario, identidad, tenant = TENANT) {
    return { usuario_id: tenant, numero, estado, usuario_global_id: usuario?.id || null, telefono: usuario?.telefono || null, identidad_evento_real: identidad };
}

function sembrar() {

    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];

    const hoy = new Date().toISOString();

    fake.tablas.eventos_bot = [
        // Grupo 1: sorteo anterior CERRADO (con deudas) y sorteo actual activo.
        { id: "ev-g1-ant", usuario_id: TENANT, grupo_id: G1, activo: false, estado: "cerrado", tabla: T5, cifras: 2, valor: 5000, identidad_evento_real: "id-anterior", nombre_evento: "Boyacá", hora_fin: "22:30", fecha_evento: hoy.slice(0, 10), creado_en: "2026-10-26T10:00:00.000Z", actualizado_en: hoy },
        { id: "ev-g1-act", usuario_id: TENANT, grupo_id: G1, activo: true, estado: "abierto", tabla: T5, cifras: 2, valor: 5000, identidad_evento_real: "id-actual", nombre_evento: "Cauca", hora_fin: "22:30", fecha_evento: hoy.slice(0, 10), creado_en: "2026-10-27T10:00:00.000Z", actualizado_en: hoy },
        // Grupo 2: otro sorteo activo del mismo cliente, otra tabla.
        { id: "ev-g2-act", usuario_id: TENANT, grupo_id: G2, activo: true, estado: "abierto", tabla: T10, cifras: 2, valor: 10000, identidad_evento_real: "id-g2", nombre_evento: "Medellín", hora_fin: "22:40", fecha_evento: hoy.slice(0, 10), creado_en: "2026-10-27T11:00:00.000Z", actualizado_en: hoy },
        // Sorteo CANCELADO: sus reservas nunca son deuda.
        { id: "ev-cancelado", usuario_id: TENANT, grupo_id: G2, activo: false, estado: "cancelado", tabla: T10, cifras: 2, valor: 10000, identidad_evento_real: "id-cancelado", nombre_evento: "Santander", hora_fin: "22:00", fecha_evento: hoy.slice(0, 10), creado_en: "2026-10-25T11:00:00.000Z", actualizado_en: hoy },
        // Otro cliente en el mismo grupo: nunca se mezcla.
        { id: "ev-ajeno", usuario_id: OTRO_TENANT, grupo_id: G1, activo: true, estado: "abierto", tabla: T5, cifras: 2, valor: 5000, identidad_evento_real: "id-ajeno", nombre_evento: "Ajeno", hora_fin: "21:00", fecha_evento: hoy.slice(0, 10), creado_en: "2026-10-27T12:00:00.000Z", actualizado_en: hoy }
    ];

    fake.tablas[T5] = [
        fila("10", "reservado", USUARIOS.sinPago, "id-actual"),
        fila("11", "reservado", USUARIOS.sinPago, "id-actual"),
        fila("20", "pagado", USUARIOS.parcial, "id-actual"),
        fila("21", "reservado", USUARIOS.parcial, "id-actual"),
        fila("30", "pagado", USUARIOS.completo, "id-actual"),
        fila("31", "pagado", USUARIOS.completo, "id-actual"),
        // u-multi: al día en el sorteo actual, pero debe el anterior.
        fila("40", "pagado", USUARIOS.multi, "id-actual"),
        fila("41", "reservado", USUARIOS.multi, "id-anterior"),
        fila("42", "pagado", USUARIOS.multi, "id-anterior"),
        // Mismo teléfono en la cuadrícula de OTRO cliente: nunca es suyo.
        fila("90", "reservado", USUARIOS.multi, "id-ajeno", OTRO_TENANT)
    ];

    fake.tablas[T10] = [
        fila("05", "reservado", USUARIOS.multi, "id-g2"),
        fila("06", "reservado", USUARIOS.multi, "id-cancelado")
    ];

}

function plantilla(tipo, contenido) {
    fake.tablas.plantillas_mensaje = fake.tablas.plantillas_mensaje || [];
    fake.tablas.plantillas_mensaje.push({ id: `p-${tipo}`, usuario_id: TENANT, tipo_respuesta: tipo, contenido, habilitada: true, orden: 1, variables: {} });
}

function interruptor(tipo, habilitada) {
    fake.tablas.configuracion_seleccion_mensajes = fake.tablas.configuracion_seleccion_mensajes || [];
    fake.tablas.configuracion_seleccion_mensajes.push({ id: `c-${tipo}`, usuario_id: TENANT, tipo_respuesta: tipo, modo_seleccion: "aleatorio", plantilla_fija_id: null, rotacion_indice: 0, habilitada });
}

async function preguntar(texto, usuario, grupo = G1) {
    espias.enviados = [];
    await eventHandler({
        sock: { context: { usuarioId: TENANT, sessionId: "s1" } },
        session: { usuarioId: TENANT, sessionId: "s1" },
        chat: { remoteJid: grupo, esGrupo: true },
        message: { key: { id: `m-${Math.random()}`, remoteJid: grupo, fromMe: false, participant: `${usuario.telefono}@s.whatsapp.net` }, message: { conversation: texto } },
        usuario,
        textoOriginal: texto
    });
    return espias.enviados;
}

const PREGUNTAS = ["¿Qué debo?", "¿Cuánto debo?", "¿Cuánto me falta?", "¿Estoy al día?"];

const resultados = [];

async function test(nombre, fn) {
    try {
        sembrar();
        espias.gemini = 0;
        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);
    }
}

(async () => {

    await test("1-4 + 5. sin pago: las 4 preguntas responden lo pendiente real ( 10 ) ( 11 ) y su valor", async () => {
        for (const p of PREGUNTAS) {
            const [msg, ...resto] = await preguntar(p, USUARIOS.sinPago);
            assert.strictEqual(resto.length, 0, p);
            assert.match(msg, /Te falta pagar/, p);
            assert.match(msg, /10/); assert.match(msg, /11/);
            assert.match(msg, /\$10\.000/, `${p}: 2 x $5.000`);
        }
        assert.strictEqual(espias.gemini, 0, "nunca IA en consultas de pago");
    });

    await test("6. pago parcial: solo lo pendiente ( 21 ), nunca el pagado ( 20 )", async () => {
        for (const p of PREGUNTAS) {
            const [msg] = await preguntar(p, USUARIOS.parcial);
            assert.match(msg, /21/);
            assert.doesNotMatch(msg, /20/);
            assert.match(msg, /\$5\.000/);
        }
    });

    await test("7. pago completo: «estás al día», nunca «te falta $0»", async () => {
        for (const p of PREGUNTAS) {
            const [msg] = await preguntar(p, USUARIOS.completo);
            assert.match(msg, /al día/);
            assert.doesNotMatch(msg, /\$0/);
        }
    });

    await test("8. sin saldo (sin números): «no debes nada»", async () => {
        for (const p of PREGUNTAS) {
            const [msg] = await preguntar(p, USUARIOS.sinSaldo);
            assert.match(msg, /no debes nada/);
        }
    });

    await test("9a. reservas en otro evento del mismo grupo: al día en el actual, pero se informa la deuda del anterior", async () => {
        const [msg] = await preguntar("¿Qué debo?", USUARIOS.multi);
        assert.match(msg, /En este sorteo estás al día/);
        assert.match(msg, /Boyacá/);
        assert.match(msg, /41/);
        assert.doesNotMatch(msg, /42/, "lo pagado del anterior no es deuda");
        assert.match(msg, /Medellín/, "deuda del otro grupo del mismo cliente");
        assert.match(msg, /05/);
    });

    await test("9b. aislamiento: nunca un sorteo cancelado ni la cuadrícula de otro cliente", async () => {
        const [msg] = await preguntar("¿Cuánto debo?", USUARIOS.multi);
        assert.doesNotMatch(msg, /Santander/);
        assert.doesNotMatch(msg, /06/);
        assert.doesNotMatch(msg, /Ajeno/);
        assert.doesNotMatch(msg, /90/);
    });

    await test("9c. preguntando en el grupo 2: su sorteo propio ( 05 ) y la deuda del sorteo anterior del grupo 1 ( 41 )", async () => {
        const [msg] = await preguntar("¿Cuánto me falta?", USUARIOS.multi, G2);
        assert.match(msg, /Te falta pagar: \( 05 \)/);
        assert.match(msg, /\$10\.000/);
        assert.match(msg, /41/);
        assert.doesNotMatch(msg, /Medellín/, "el sorteo actual no se repite como «otro sorteo»");
    });

    await test("«Ya pagué» (afirmación) sigue sin respuesta; «¿ya pagué?» responde el estado real", async () => {
        assert.deepStrictEqual(await preguntar("Ya pagué", USUARIOS.sinPago), []);
        assert.deepStrictEqual(await preguntar("ya pague el 10", USUARIOS.sinPago), []);
        const [msg] = await preguntar("¿ya pagué?", USUARIOS.sinPago);
        assert.match(msg, /Te falta pagar/);
    });

    await test("plantilla del panel por estado: se usa la del estado real de cada cliente", async () => {
        plantilla("consulta_pago_sin_pago", "SIN_PAGO {{numeros_pendientes}}");
        plantilla("consulta_pago_pago_parcial", "PARCIAL {{numeros_pendientes}}");
        plantilla("consulta_pago_pago_completo", "COMPLETO");
        plantilla("consulta_pago_sin_saldo", "SIN_SALDO");
        assert.match((await preguntar("¿Qué debo?", USUARIOS.sinPago))[0], /^SIN_PAGO/);
        assert.match((await preguntar("¿Qué debo?", USUARIOS.parcial))[0], /^PARCIAL/);
        assert.match((await preguntar("¿Qué debo?", USUARIOS.completo))[0], /^COMPLETO/);
        assert.match((await preguntar("¿Qué debo?", USUARIOS.sinSaldo))[0], /^SIN_SALDO/);
    });

    await test("plantilla «completo» + deuda en otro sorteo: mensaje fijo (nunca «no debes nada» a quien debe)", async () => {
        plantilla("consulta_pago_pago_completo", "COMPLETO: no debes nada");
        const [msg] = await preguntar("¿Qué debo?", USUARIOS.multi);
        assert.doesNotMatch(msg, /no debes nada/);
        assert.match(msg, /41/);
    });

    await test("plantilla «sin pago» + deuda en otro sorteo: la plantilla y luego el detalle del otro sorteo", async () => {
        plantilla("consulta_pago_sin_pago", "SIN_PAGO {{numeros_pendientes}}");
        const [msg] = await preguntar("¿Qué debo?", USUARIOS.multi, G2);
        assert.match(msg, /^SIN_PAGO/);
        assert.match(msg, /Pendiente en otros sorteos/);
        assert.match(msg, /41/);
    });

    await test("interruptores del panel: un estado DESACTIVADO calla solo ese estado; los demás responden", async () => {
        interruptor("consulta_pago_sin_pago", false);
        interruptor("consulta_pago_pago_parcial", true);
        assert.deepStrictEqual(await preguntar("¿Qué debo?", USUARIOS.sinPago), [], "Sin pago desactivado -> silencio");
        assert.strictEqual((await preguntar("¿Qué debo?", USUARIOS.parcial)).length, 1);
        assert.strictEqual((await preguntar("¿Qué debo?", USUARIOS.completo)).length, 1, "sin fila = habilitado");
    });

    await test("con los 4 estados desactivados en el panel, ninguna consulta de pago responde (causa posible a verificar en producción)", async () => {
        for (const t of ["consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo", "consulta_pago_sin_saldo"]) interruptor(t, false);
        for (const u of [USUARIOS.sinPago, USUARIOS.parcial, USUARIOS.completo, USUARIOS.sinSaldo]) {
            assert.deepStrictEqual(await preguntar("¿Cuánto debo?", u), []);
        }
    });

    await test("la fila heredada «consulta_pago» desactivada NO silencia las consultas de pago", async () => {
        interruptor("consulta_pago", false);
        assert.strictEqual((await preguntar("¿Qué debo?", USUARIOS.sinPago)).length, 1);
    });

    await test("las consultas nunca modifican estados ni importes", async () => {
        const antes = JSON.stringify([fake.tablas[T5], fake.tablas[T10], fake.tablas.eventos_bot]);
        for (const u of Object.values(USUARIOS)) for (const p of PREGUNTAS) await preguntar(p, u);
        assert.strictEqual(JSON.stringify([fake.tablas[T5], fake.tablas[T10], fake.tablas.eventos_bot]), antes);
    });

    await test("error leyendo los otros sorteos: se responde igual el sorteo actual", async () => {
        fake.control.fallarTabla = T10;
        try {
            const [msg] = await preguntar("¿Qué debo?", USUARIOS.sinPago);
            assert.match(msg, /Te falta pagar/);
        } finally {
            fake.control.fallarTabla = null;
        }
    });

    const fallidas = resultados.filter(x => !x.ok).length;
    console.log("\n============================================");
    console.log(`Pruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas}  |  Fallidas: ${fallidas}`);
    console.log("============================================");
    process.exit(fallidas ? 1 : 0);

})();
