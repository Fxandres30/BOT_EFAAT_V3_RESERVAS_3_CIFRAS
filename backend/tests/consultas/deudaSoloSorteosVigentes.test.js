// ==========================================================================
// PRUEBAS — «¿Qué debo?» solo responde con obligaciones VIGENTES (31/10/2026).
//
// Error de producción: un cliente preguntó qué debía y la respuesta nombró
// sorteos ya terminados y sus números. Dos lecturas reconstruían deuda con
// eventos históricos:
//   1. consultarEvento() devuelve el sorteo MÁS RECIENTE del grupo cuando
//      ninguno está activo (cerrado, cancelado, desactivado...) y las
//      consultas lo trataban como «este sorteo».
//   2. «Pendiente en otros sorteos» representaba cada otra tabla del cliente
//      con su sorteo más reciente aunque hubiera terminado (bastaba con que
//      fuera de los últimos 30 días y no estuviera cancelado).
//
// Regla: solo cuenta una tabla con un sorteo VIGENTE (activo, no cerrado ni
// gestionado, y no de un día ya pasado). UNA TABLA = UN SORTEO: dentro de esa
// tabla cuentan todos los números del cliente, vengan de donde vengan.
//
// Reales: eventHandler.js, consultarEvento.js, detectarIntencion.js,
// resolverConsulta.js, consultarMisNumeros.js, responderResultado.js.
// Simulados: Supabase (en memoria), el envío de WhatsApp y Gemini.
//
//     node backend/tests/consultas/deudaSoloSorteosVigentes.test.js
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
const { sorteoVigente } = require(r("bot/funciones/consultas/consultarMisNumeros.js"));

const TENANT = "tenant-vigentes";
const OTRO_TENANT = "tenant-ajeno";

const T5 = "5k_reservas_2_cifras";
const T10 = "10k_reservas_2_cifras";
const T20 = "20k_reservas_2_cifras";
const T30 = "30k_reservas_2_cifras";

const G1 = "g1@g.us"; // sorteo anterior cerrado + sorteo actual activo (misma tabla T5)
const G2 = "g2@g.us"; // otro sorteo activo, otra tabla (T10)
const G3 = "g3@g.us"; // solo un sorteo CERRADO (T20)
const G4 = "g4@g.us"; // su sorteo terminó; su tabla (T5) sigue con el sorteo activo de G1
const G5 = "g5@g.us"; // solo un sorteo CANCELADO (T30)
const G6 = "g6@g.us"; // sorteo «activo» de un día ya pasado (vencido, T30)

const CLIENTE = { id: "u-cliente", telefono: "573000000010" };
const AL_DIA = { id: "u-al-dia", telefono: "573000000011" };
const PARCIAL = { id: "u-parcial", telefono: "573000000012" };
const NUEVO = { id: "u-nuevo", telefono: "573000000013" };

function fechaBogota(desplazamientoDias = 0) {
    const d = new Date(Date.now() + desplazamientoDias * 86400000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const HOY = fechaBogota(0);
const AYER = fechaBogota(-1);
const HACE_3 = fechaBogota(-3);

function evento(id, grupo, tabla, nombre, extra = {}) {
    return {
        id, usuario_id: TENANT, grupo_id: grupo, tabla, cifras: 2, valor: 5000,
        activo: true, estado: "abierto", identidad_evento_real: `id-${id}`,
        nombre_evento: nombre, hora_fin: "22:30", fecha_evento: HOY,
        creado_en: `${HOY}T10:00:00.000Z`, actualizado_en: `${HOY}T10:00:00.000Z`,
        ...extra
    };
}

const CERRADO = { activo: false, estado: "cerrado", cierre_estado: "cerrado" };

function fila(numero, estado, usuario, identidad, { tenant = TENANT, grupo = null } = {}) {
    return { usuario_id: tenant, numero, estado, usuario_global_id: usuario?.id || null, telefono: usuario?.telefono || null, identidad_evento_real: identidad, grupo_id: grupo };
}

function sembrar() {

    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];

    fake.tablas.eventos_bot = [
        // G1 — sorteo anterior TERMINADO y sorteo actual activo, MISMA tabla
        // (tabla conservada para el nuevo sorteo).
        evento("g1-ant", G1, T5, "Boyacá", { ...CERRADO, fecha_evento: HACE_3, creado_en: `${HACE_3}T10:00:00.000Z` }),
        evento("g1-act", G1, T5, "Cauca"),
        // G2 — otro sorteo activo del cliente, otra tabla.
        evento("g2-act", G2, T10, "Medellín", { valor: 10000, hora_fin: "22:40" }),
        // G3 — solo un sorteo CERRADO hace 3 días (dentro de los «30 días»).
        evento("g3-ant", G3, T20, "Santander", { ...CERRADO, fecha_evento: HACE_3, creado_en: `${HACE_3}T09:00:00.000Z` }),
        // G4 — su sorteo terminó; su tabla es la del sorteo activo de G1.
        evento("g4-ant", G4, T5, "Tolima", { ...CERRADO, fecha_evento: AYER, creado_en: `${AYER}T09:00:00.000Z` }),
        // G5 — sorteo CANCELADO.
        evento("g5-can", G5, T30, "Huila", { activo: false, estado: "cancelado", fecha_evento: AYER, creado_en: `${AYER}T08:00:00.000Z` }),
        // G6 — fila que quedó activo=true de un día ya pasado (el cierre no corrió).
        evento("g6-venc", G6, T30, "Quindío", { fecha_evento: AYER, creado_en: `${AYER}T07:00:00.000Z` }),
        // Otro cliente en el mismo grupo y la misma tabla: nunca se mezcla.
        { ...evento("ajeno", G1, T5, "Ajeno"), usuario_id: OTRO_TENANT }
    ];

    fake.tablas[T5] = [
        // Reservado en el ciclo ANTERIOR (Boyacá) y conservado: hoy es de Cauca.
        fila("41", "reservado", CLIENTE, "id-g1-ant"),
        // Reservado desde OTRO grupo (G4, sorteo Tolima) en la misma tabla.
        fila("42", "reservado", CLIENTE, "id-g4-ant", { grupo: G4 }),
        fila("43", "pagado", CLIENTE, "id-g1-act"),
        fila("50", "pagado", AL_DIA, "id-g1-act"),
        fila("51", "pagado", AL_DIA, "id-g1-act"),
        fila("60", "pagado", PARCIAL, "id-g1-act"),
        fila("61", "reservado", PARCIAL, "id-g1-act"),
        // Cuadrícula de OTRO cliente con el mismo teléfono: nunca es suya.
        fila("90", "reservado", CLIENTE, "id-ajeno", { tenant: OTRO_TENANT })
    ];

    fake.tablas[T10] = [
        fila("05", "reservado", CLIENTE, "id-g2-act")
    ];

    // Tabla cuyo único sorteo TERMINÓ (Santander): obligación histórica.
    fake.tablas[T20] = [
        fila("77", "reservado", CLIENTE, "id-g3-ant"),
        fila("78", "reservado", AL_DIA, "id-g3-ant")
    ];

    // Tabla de un sorteo cancelado y de uno vencido: ninguno vigente.
    fake.tablas[T30] = [
        fila("88", "reservado", CLIENTE, "id-g5-can"),
        fila("89", "reservado", CLIENTE, "id-g6-venc"),
        fila("87", "reservado", NUEVO, "id-g6-venc")
    ];

}

async function preguntar(texto, usuario, grupo) {
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

const PREGUNTAS = ["¿Qué debo?", "¿Cuánto debo?", "¿Qué números tengo pendientes?", "¿Cuánto me falta?", "¿Estoy al día?"];
const HISTORICOS = /Boyacá|Santander|Tolima|Huila|Quindío|Ajeno/;
const NUMEROS_HISTORICOS = /\b(77|78|87|88|89|90)\b/;

function plantilla(tipo, contenido) {
    fake.tablas.plantillas_mensaje = fake.tablas.plantillas_mensaje || [];
    fake.tablas.plantillas_mensaje.push({ id: `p-${tipo}`, usuario_id: TENANT, tipo_respuesta: tipo, contenido, habilitada: true, orden: 1, variables: {} });
}

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

    // Silencia el registro detallado de la consulta (no es parte de la prueba).
    const logOriginal = console.log, dirOriginal = console.dir;
    const silenciar = () => { console.log = () => {}; console.dir = () => {}; };
    const restaurar = () => { console.log = logOriginal; console.dir = dirOriginal; };
    const preguntarSilencioso = async (...a) => { silenciar(); try { return await preguntar(...a); } finally { restaurar(); } };

    await test("0. sorteoVigente: activo de hoy sí; cerrado, cancelado, desactivado, eliminado, sustituido o de un día pasado no", async () => {
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x")), true);
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { fecha_evento: fechaBogota(1) })), true, "sorteo de mañana publicado esta noche");
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { fecha_evento: null })), true, "sin fecha: decide activo");
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", CERRADO)), false);
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { cierre_estado: "cerrado" })), false, "cerrado y reactivado por un reintento");
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { activo: false, estado: "cancelado" })), false);
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { activo: false, estado: "desactivado" })), false);
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { activo: false, cierre_motivo: "sustituido" })), false);
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { estado: "eliminado" })), false);
        assert.strictEqual(sorteoVigente(evento("a", G1, T5, "x", { fecha_evento: AYER })), false, "activo=true de ayer = vencido");
        assert.strictEqual(sorteoVigente(null), false);
    });

    await test("1. ESCENARIO DEL ERROR: deuda en un sorteo anterior ya terminado + sorteo activo en la misma tabla", async () => {
        for (const p of PREGUNTAS) {
            const [msg, ...resto] = await preguntarSilencioso(p, CLIENTE, G1);
            assert.ok(msg, `${p}: debe responder`);
            assert.strictEqual(resto.length, 0, p);
            assert.doesNotMatch(msg, HISTORICOS, `${p}: no nombra sorteos terminados ni ajenos\n${msg}`);
            assert.doesNotMatch(msg, NUMEROS_HISTORICOS, `${p}: no presenta obligaciones históricas\n${msg}`);
            // UNA TABLA = UN SORTEO: 41 (ciclo anterior) y 42 (otro grupo) son de Cauca.
            assert.match(msg, /41/, p); assert.match(msg, /42/, p);
            // «¿Qué números tengo pendientes?» es «mis números»: puede listar el
            // 43 como pagado, nunca en una línea de lo pendiente.
            assert.doesNotMatch(msg, /(falta pagar|[Pp]endientes? de pago)[^\n]*\b43\b/, `${p}: lo pagado no es deuda\n${msg}`);
        }
        const [msg] = await preguntarSilencioso("¿Qué debo?", CLIENTE, G1);
        assert.match(msg, /Te falta pagar: \( 41 - 42 \) — \$10\.000/);
        // AISLAMIENTO POR SORTEO (06/11/2026): el otro sorteo activo del
        // cliente (Medellín) no entra en la respuesta de este.
        assert.doesNotMatch(msg, /Medellín|\b05\b|otros sorteos/, "solo el sorteo del grupo");
        assert.strictEqual(espias.gemini, 0);
    });

    await test("2. grupo sin sorteo activo (su último sorteo terminó): no se inventa deuda con él", async () => {
        const [msg] = await preguntarSilencioso("¿Qué debo?", AL_DIA, G3);
        assert.ok(msg);
        assert.doesNotMatch(msg, /Santander/, msg);
        assert.doesNotMatch(msg, /78/, msg);
        assert.doesNotMatch(msg, /Te falta pagar/, msg);
        assert.match(msg, /no hay un sorteo activo/i, msg);
    });

    await test("3. cliente con eventos históricos y NINGUNO activo: sin deuda, sin nombrarlos", async () => {
        // Se terminan los sorteos activos: solo quedan históricos.
        for (const e of fake.tablas.eventos_bot) if (e.usuario_id === TENANT && e.estado === "abierto" && e.fecha_evento === HOY) Object.assign(e, CERRADO);
        for (const g of [G1, G2, G3, G4, G5, G6]) {
            for (const p of PREGUNTAS) {
                const [msg] = await preguntarSilencioso(p, CLIENTE, g);
                assert.ok(msg, `${g} ${p}`);
                assert.doesNotMatch(msg, /Boyacá|Cauca|Medellín|Santander|Tolima|Huila|Quindío/, `${g} ${p}\n${msg}`);
                assert.doesNotMatch(msg, /\b(05|41|42|77|88|89)\b/, `${g} ${p}\n${msg}`);
                assert.doesNotMatch(msg, /Te falta pagar|Pendiente/, `${g} ${p}\n${msg}`);
            }
        }
    });

    await test("4. varias tablas: preguntando en G2 cuenta SOLO su tabla (ni la otra activa ni las terminadas)", async () => {
        const [msg] = await preguntarSilencioso("¿Cuánto me falta?", CLIENTE, G2);
        assert.match(msg, /Te falta pagar: \( 05 \) — \$10\.000/);
        assert.doesNotMatch(msg, /Cauca|\b41\b|\b42\b|otros sorteos/, msg);
        assert.doesNotMatch(msg, HISTORICOS, msg);
        assert.doesNotMatch(msg, NUMEROS_HISTORICOS, msg);
    });

    await test("5. reservas de diferentes grupos en la misma tabla: cuentan en el sorteo activo de esa tabla (en SU grupo); un grupo sin sorteo vigente no responde con otros", async () => {
        // Pregunta en G4: su propio sorteo (Tolima) terminó, pero su tabla
        // T5 sigue activa con Cauca (G1). El 42 se reservó desde G4.
        const [msg] = await preguntarSilencioso("¿Qué debo?", CLIENTE, G4);
        assert.doesNotMatch(msg, /Tolima/, msg);
        assert.doesNotMatch(msg, HISTORICOS, msg);
        assert.strictEqual(msg, "No hay un sorteo activo en este grupo en este momento.", "sin sorteo identificable: nunca un resultado global");
        // En el grupo de Cauca, el 42 (reservado desde G4) sí es de Cauca.
        const [enG1] = await preguntarSilencioso("¿Qué debo?", CLIENTE, G1);
        assert.match(enG1, /Te falta pagar: \( 41 - 42 \)/, enG1);
    });

    await test("6. pago parcial: solo lo pendiente del sorteo activo", async () => {
        const [msg] = await preguntarSilencioso("¿Qué debo?", PARCIAL, G1);
        assert.match(msg, /Te falta pagar: \( 61 \) — \$5\.000/);
        assert.doesNotMatch(msg, /\b60\b/);
    });

    await test("7. reservas pagadas: al día, aunque deba números de un sorteo terminado", async () => {
        // AL_DIA debe el 78 de Santander (terminado): no es deuda vigente.
        const [msg] = await preguntarSilencioso("¿Qué debo?", AL_DIA, G1);
        assert.match(msg, /al día/, msg);
        assert.doesNotMatch(msg, /78|Santander/, msg);
    });

    await test("8. evento cancelado: ni deuda ni nombre", async () => {
        for (const p of PREGUNTAS) {
            const [msg] = await preguntarSilencioso(p, CLIENTE, G5);
            assert.doesNotMatch(msg, /Huila|88/, `${p}\n${msg}`);
        }
    });

    await test("9. sorteo con activo=true de un día ya pasado (vencido): no es el sorteo actual", async () => {
        const [msg] = await preguntarSilencioso("¿Qué debo?", NUEVO, G6);
        assert.doesNotMatch(msg, /Quindío|87/, msg);
        assert.doesNotMatch(msg, /Te falta pagar/, msg);
    });

    await test("10. evento finalizado y tabla conservada para un nuevo sorteo en OTRO grupo: cuenta como deuda del nuevo (en su grupo)", async () => {
        // T20: Santander (G3) terminó; Nariño se publica en otro grupo con la misma tabla.
        fake.tablas.eventos_bot.push(evento("g7-act", "g7@g.us", T20, "Nariño", { valor: 20000 }));
        const [enG3] = await preguntarSilencioso("¿Qué debo?", CLIENTE, G3);
        assert.doesNotMatch(enG3, /Santander/, enG3);
        assert.strictEqual(enG3, "No hay un sorteo activo en este grupo en este momento.", "G3 no tiene sorteo vigente: no se responde con Nariño");
        const [enG7] = await preguntarSilencioso("¿Qué debo?", CLIENTE, "g7@g.us");
        assert.match(enG7, /Te falta pagar: \( 77 \) — \$20\.000/, enG7);
        assert.doesNotMatch(enG7, /Santander/, enG7);
    });

    await test("11. «mis números» en un grupo cuyo sorteo terminó: no lo presenta como actual", async () => {
        const [msg] = await preguntarSilencioso("mis números", AL_DIA, G3);
        assert.ok(msg);
        assert.doesNotMatch(msg, /78|Santander/, msg);
        assert.match(msg, /no hay un sorteo activo/i, msg);
    });

    await test("12. plantilla del panel con el nombre del sorteo: no se usa cuando el sorteo del grupo terminó", async () => {
        plantilla("consulta_pago_sin_saldo", "Nada pendiente en {{evento}}");
        plantilla("mis_numeros", "Tus números de {{evento}}: {{numeros}}");
        const [pago] = await preguntarSilencioso("¿Qué debo?", AL_DIA, G3);
        assert.doesNotMatch(pago, /Santander/, pago);
        const [mis] = await preguntarSilencioso("mis números", AL_DIA, G3);
        assert.doesNotMatch(mis, /Santander/, mis);
        // En un grupo con sorteo activo la plantilla sigue usándose.
        const [activo] = await preguntarSilencioso("mis números", AL_DIA, G1);
        assert.match(activo, /^Tus números de Cauca/, activo);
    });

    await test("13. las consultas nunca modifican reservas, pagos ni eventos", async () => {
        const antes = JSON.stringify([fake.tablas[T5], fake.tablas[T10], fake.tablas[T20], fake.tablas[T30], fake.tablas.eventos_bot]);
        for (const g of [G1, G2, G3, G4, G5, G6]) for (const p of PREGUNTAS) await preguntarSilencioso(p, CLIENTE, g);
        assert.strictEqual(JSON.stringify([fake.tablas[T5], fake.tablas[T10], fake.tablas[T20], fake.tablas[T30], fake.tablas.eventos_bot]), antes);
    });

    const fallidas = resultados.filter(x => !x.ok).length;
    console.log("\n============================================");
    console.log(`Pruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas}  |  Fallidas: ${fallidas}`);
    console.log("============================================");
    process.exit(fallidas ? 1 : 0);

})();
