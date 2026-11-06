// ==========================================================================
// PRUEBAS — AISLAMIENTO DE CONSULTAS POR SORTEO (06/11/2026).
//
// Error de producción: «Q debo» (consulta_pago) respondió con los 11 números
// del sorteo del grupo y, además, con 7 de «Lotería De Medellín», otro sorteo
// del mismo participante (otrosPendientes / textoOtrosPendientes).
//
// Regla: UNA CONSULTA RESPONDE EXCLUSIVAMENTE DEL SORTEO DEL GRUPO.
//   - Nunca se añaden otros sorteos del cliente.
//   - Sorteos terminados: sus filas nunca entran en la consulta de otro.
//   - Tabla física compartida por dos sorteos vigentes (dos precios): solo
//     las filas con la identidad del sorteo consultado; una fila sin
//     identidad o de un sorteo terminado no se adivina.
//   - Sin sorteo vigente en el grupo: mensaje fijo, nunca un resultado global.
//
// Reales: eventHandler.js, consultarEvento.js, detectarIntencion.js,
// resolverConsulta.js, consultarMisNumeros.js, consultarNumero.js,
// responderResultado.js. Simulados: Supabase (en memoria), WhatsApp y Gemini.
//
//     node backend/tests/consultas/aislamientoConsultasPorSorteo.test.js
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
const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));

const TENANT = "tenant-aislamiento";
const OTRO_TENANT = "tenant-ajeno";

// Tablas de uso exclusivo (un sorteo cada una).
const T_A = "tabla_a_2_cifras";
const T_B = "tabla_b_2_cifras";
const T_C = "tabla_c_2_cifras";
const T_H = "tabla_h_2_cifras";
// Tabla física COMPARTIDA por dos sorteos vigentes (dos precios).
const T_S = "5k_15k_reservas_2_cifras";

const G_A = "ga@g.us";       // Sorteo A — Antioqueñita, $5.000
const G_B = "gb@g.us";       // Sorteo B — Cauca, $10.000
const G_C = "gc@g.us";       // Sorteo C — Lotería De Medellín, $2.000
const G_H = "gh@g.us";       // solo un sorteo TERMINADO
const G_D = "gd@g.us";       // Sorteo D — Sinuano, $3.000 (tabla compartida)
const G_E = "ge@g.us";       // Sorteo E — Chontico, $5.000 (tabla compartida)
const G_VACIO = "gv@g.us";   // grupo sin ningún sorteo

const CLIENTE = { id: "u-cliente", telefono: "573000000020" };
const OTRA = { id: "u-otra", telefono: "573000000021" };

function fechaBogota(dias = 0) {
    const d = new Date(Date.now() + dias * 86400000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const HOY = fechaBogota(0);
const HACE_3 = fechaBogota(-3);

function evento(id, grupo, tabla, nombre, valor, extra = {}) {
    return {
        id, usuario_id: TENANT, grupo_id: grupo, tabla, cifras: 2, valor,
        activo: true, estado: "abierto", identidad_evento_real: `id-${id}`,
        nombre_evento: nombre, hora_fin: "22:30", fecha_evento: HOY,
        creado_en: `${HOY}T10:00:00.000Z`, actualizado_en: `${HOY}T10:00:00.000Z`,
        ...extra
    };
}
const CERRADO = { activo: false, estado: "cerrado", cierre_estado: "cerrado", fecha_evento: HACE_3, creado_en: `${HACE_3}T10:00:00.000Z` };

function fila(numero, estado, usuario, identidad, tenant = TENANT) {
    return { usuario_id: tenant, numero, estado, usuario_global_id: usuario?.id || null, telefono: usuario?.telefono || null, identidad_evento_real: identidad };
}

function sembrar() {

    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.fallarTabla = null;
    fake.control.despuesDeLeer = null;

    fake.tablas.eventos_bot = [
        evento("A", G_A, T_A, "Antioqueñita", 5000),
        // Sorteo anterior de A, TERMINADO; su tabla se conservó para A.
        evento("A-ant", G_A, T_A, "Boyacá", 5000, CERRADO),
        evento("B", G_B, T_B, "Cauca", 10000),
        evento("C", G_C, T_C, "Lotería De Medellín", 2000),
        evento("H", G_H, T_H, "Santander", 4000, CERRADO),
        evento("D", G_D, T_S, "Sinuano", 3000),
        evento("E", G_E, T_S, "Chontico", 5000),
        // Sorteo terminado que usó la tabla compartida.
        evento("S-ant", G_D, T_S, "Huila", 3000, CERRADO),
        // Otro cliente con un sorteo activo en el grupo de A y la misma tabla.
        { ...evento("X", G_A, T_A, "Ajeno", 5000), usuario_id: OTRO_TENANT }
    ];

    fake.tablas[T_A] = [
        fila("11", "reservado", CLIENTE, "id-A"),
        fila("12", "reservado", CLIENTE, "id-A"),
        fila("13", "pagado", CLIENTE, "id-A"),
        // Conservado del ciclo anterior en una tabla de uso exclusivo: es de A
        // (UNA TABLA = UN SORTEO, regla del 31/10).
        fila("14", "reservado", CLIENTE, "id-A-ant"),
        fila("15", "reservado", OTRA, "id-A"),
        fila("90", "reservado", CLIENTE, "id-X", OTRO_TENANT)
    ];
    fake.tablas[T_B] = [
        fila("21", "reservado", CLIENTE, "id-B"),
        fila("22", "pagado", CLIENTE, "id-B"),
        fila("23", "pagado", CLIENTE, "id-B")
    ];
    // Medellín: los 7 números que se colaban en el «qué debo» de otro sorteo.
    fake.tablas[T_C] = ["31", "32", "33", "34", "35", "36", "37"].map(n => fila(n, "reservado", CLIENTE, "id-C"));
    // Tabla de un sorteo TERMINADO: obligación histórica, nunca deuda actual.
    fake.tablas[T_H] = [fila("71", "reservado", CLIENTE, "id-H"), fila("72", "pagado", CLIENTE, "id-H")];
    fake.tablas[T_S] = [
        fila("51", "reservado", CLIENTE, "id-D"),
        fila("52", "pagado", CLIENTE, "id-D"),
        fila("61", "reservado", CLIENTE, "id-E"),
        fila("62", "reservado", CLIENTE, null),         // sin identidad: ¿de D o de E?
        fila("63", "reservado", CLIENTE, "id-S-ant")    // de un sorteo terminado
    ];

}

async function preguntar(texto, grupo, usuario = CLIENTE) {
    espias.enviados = [];
    const { log, dir, warn } = console;
    console.log = console.dir = console.warn = () => {};
    try {
        await eventHandler({
            sock: { context: { usuarioId: TENANT, sessionId: "s1" } },
            session: { usuarioId: TENANT, sessionId: "s1" },
            chat: { remoteJid: grupo, esGrupo: true },
            message: { key: { id: `m-${Math.random()}`, remoteJid: grupo, fromMe: false, participant: `${usuario.telefono}@s.whatsapp.net` }, message: { conversation: texto } },
            usuario,
            textoOriginal: texto
        });
    } finally {
        Object.assign(console, { log, dir, warn });
    }
    return espias.enviados.join("\n");
}

// Números de dos cifras que aparecen en una respuesta (sin los importes).
const numerosEn = (texto) => [...new Set((String(texto).replace(/\$[\d.]+/g, "").match(/\b\d{2}\b/g) || []))].sort();
const OTROS_NOMBRES = /otros sorteos|Medell|Cauca|Santander|Boyac|Huila|Ajeno|Sinuano|Chontico/i;

const resultados = [];
async function test(nombre, fn) {
    try {
        sembrar();
        await fn();
        resultados.push(true);
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push(false);
        console.log(`❌ ${nombre}\n   ${err.message}`);
    }
}

(async () => {

    await test("1-3. «Q debo» en el sorteo A: solo lo pendiente de A (11, 12 y el 14 conservado de su tabla), nada de Medellín ni de otros sorteos", async () => {
        const msg = await preguntar("Q debo", G_A);
        assert.ok(msg, "hay respuesta");
        assert.deepStrictEqual(numerosEn(msg), ["11", "12", "14"], msg);
        assert.ok(/\$15\.000/.test(msg), `total solo de A (3 × $5.000): ${msg}`);
        assert.ok(!OTROS_NOMBRES.test(msg), msg);
    });

    await test("2. Variantes de pago en A («¿Qué debo?», «¿Cuánto debo?», «¿Cuánto me falta?», «¿Estoy al día?»): nunca números de otro sorteo", async () => {
        for (const p of ["¿Qué debo?", "¿Cuánto debo?", "¿Cuánto me falta?", "¿Estoy al día?"]) {
            const msg = await preguntar(p, G_A);
            const ajenos = numerosEn(msg).filter(n => !["11", "12", "13", "14"].includes(n));
            assert.deepStrictEqual(ajenos, [], `${p} → ${msg}`);
            assert.ok(!OTROS_NOMBRES.test(msg), `${p} → ${msg}`);
            assert.ok(!/\$(10|17|20|25|29|39)\.000/.test(msg) || /\$15\.000|\$10\.000/.test(msg), `${p} → ${msg}`);
        }
    });

    await test("4-5. Pagos en el sorteo B: solo los de B (22 y 23); su deuda solo el 21", async () => {
        const pagados = await preguntar("¿Cuáles ya pagué?", G_B);
        assert.ok(pagados, "hay respuesta");
        assert.ok(numerosEn(pagados).every(n => ["21", "22", "23"].includes(n)), pagados);
        assert.ok(numerosEn(pagados).includes("22") && numerosEn(pagados).includes("23"), pagados);
        assert.ok(!OTROS_NOMBRES.test(pagados.replace(/Cauca/g, "")), pagados);
        const debo = await preguntar("¿Qué debo?", G_B);
        assert.deepStrictEqual(numerosEn(debo), ["21"], debo);
        assert.ok(/\$10\.000/.test(debo), debo);
    });

    await test("Mis números en Medellín (C): solo sus 7 números; en A nunca aparecen", async () => {
        const c = await preguntar("mis números", G_C);
        assert.deepStrictEqual(numerosEn(c), ["31", "32", "33", "34", "35", "36", "37"], c);
        const a = await preguntar("mis números", G_A);
        assert.deepStrictEqual(numerosEn(a), ["11", "12", "13", "14"], a);
    });

    await test("6. Sorteo TERMINADO con registros antiguos: su grupo no tiene sorteo vigente → mensaje fijo, sin sus números ni los de otros", async () => {
        const msg = await preguntar("¿Qué debo?", G_H);
        assert.strictEqual(msg, "No hay un sorteo activo en este grupo en este momento.", msg);
        const mis = await preguntar("mis números", G_H);
        assert.deepStrictEqual(numerosEn(mis), [], mis);
        assert.ok(!OTROS_NOMBRES.test(mis), mis);
    });

    await test("7-8. Tabla física compartida por D ($3.000) y E ($5.000): cada uno solo con SUS filas; la fila sin identidad y la del sorteo terminado no se cuentan en ninguno", async () => {
        const d = await preguntar("¿Qué debo?", G_D);
        assert.deepStrictEqual(numerosEn(d), ["51"], d);
        assert.ok(/\$3\.000/.test(d), d);
        const e = await preguntar("¿Qué debo?", G_E);
        assert.deepStrictEqual(numerosEn(e), ["61"], e);
        assert.ok(/\$5\.000/.test(e), e);
        const misD = await preguntar("mis números", G_D);
        assert.deepStrictEqual(numerosEn(misD), ["51", "52"], misD);
        // Totales: la unión nunca repite un número entre sorteos.
        const todos = [...numerosEn(d), ...numerosEn(e)];
        assert.strictEqual(new Set(todos).size, todos.length, "ningún número contado en dos sorteos");
    });

    await test("Número específico en la tabla compartida: «¿el 61 está pagado?» en D no dice que es suyo; en E sí (reservado por él)", async () => {
        const enD = await preguntar("¿el 61 está pagado?", G_D);
        assert.ok(enD, "hay respuesta");
        assert.ok(!/(es tuyo|por ti|tienes reservado|lo tienes)/i.test(enD), enD);
        assert.ok(/no está disponible/.test(enD), enD);
        const enE = await preguntar("¿el 61 está pagado?", G_E);
        assert.ok(/ya lo tienes reservado/.test(enE), enE);
    });

    await test("Otro cliente con sorteo activo en el mismo grupo y tabla: nunca entra (90 no aparece)", async () => {
        const msg = await preguntar("¿Qué debo?", G_A);
        assert.ok(!numerosEn(msg).includes("90"), msg);
    });

    await test("9. Contexto ambiguo: grupo sin sorteo → no se responde con datos globales", async () => {
        const msg = await preguntar("¿Qué debo?", G_VACIO);
        assert.deepStrictEqual(numerosEn(msg), [], msg);
        assert.ok(!OTROS_NOMBRES.test(msg), msg);
    });

    await test("9b. No se puede comprobar si otro sorteo comparte la tabla (fallo de lectura): error técnico, sin números ni «al día»", async () => {
        const evD = fake.tablas.eventos_bot.find(e => e.id === "D");
        fake.control.fallarTabla = "eventos_bot";
        const { log } = console; console.log = () => {};
        let res;
        try {
            res = await resolverConsulta({ tipo: "consulta_pago", evento: evD, usuario: CLIENTE, modo: "resumen", bucket: "pendiente" });
        } finally { console.log = log; }
        fake.control.fallarTabla = null;
        assert.ok(res.errorTecnico, JSON.stringify(res));
        assert.deepStrictEqual(numerosEn(res.mensaje), []);
    });

    await test("Ninguna respuesta de pago incluye ya «otrosPendientes» ni su texto", async () => {
        const evA = fake.tablas.eventos_bot.find(e => e.id === "A");
        const { log } = console; console.log = () => {};
        let res;
        try {
            res = await resolverConsulta({ tipo: "consulta_pago", evento: evA, usuario: CLIENTE, modo: "resumen", bucket: "pendiente" });
        } finally { console.log = log; }
        assert.ok(!("otrosPendientes" in res) && !("textoOtrosPendientes" in res), JSON.stringify(res));
        assert.deepStrictEqual(res.reservados.sort(), ["11", "12", "14"]);
        assert.strictEqual(res.montoPendiente, 15000);
    });

    await test("Las consultas no modifican datos", async () => {
        const antes = JSON.stringify(fake.tablas);
        for (const g of [G_A, G_B, G_C, G_D, G_E, G_H]) {
            await preguntar("¿Qué debo?", g);
            await preguntar("mis números", g);
        }
        // Las únicas escrituras admitidas son de registro (no tablas de números ni eventos).
        for (const t of [T_A, T_B, T_C, T_H, T_S, "eventos_bot"]) {
            assert.strictEqual(JSON.stringify(fake.tablas[t]), JSON.stringify(JSON.parse(antes)[t]), `sin cambios en ${t}`);
        }
    });

    const fallidas = resultados.filter(x => !x).length;
    console.log(`\nTOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas}  ❌ FALLA: ${fallidas}`);
    process.exit(fallidas ? 1 : 0);

})();
