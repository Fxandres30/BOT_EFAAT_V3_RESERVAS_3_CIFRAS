// ==========================================================================
// PRUEBAS — Fase 2: plantillas administrables de "disponibilidad_agotada".
//
//   disponibles > 0          -> plantillas "disponibilidad" (sin cambios)
//   0 libres + ocupados > 0  -> plantillas "disponibilidad_agotada" del
//                               tenant, con el MISMO selector (fijo/
//                               aleatorio/rotación); sin plantilla válida ->
//                               mensaje fijo de agotado. Nunca plantillas de
//                               "disponibilidad", nunca lista vacía, nunca IA.
//   0 libres + 0 ocupados    -> NO es agotado (error de consulta)
//
// Reales: consultarDisponibilidad.js, resolverConsulta.js,
// responderResultado.js, configMensajes.js (consultas reales por
// usuario_id + tipo_respuesta + habilitada), seleccionarPlantilla.js,
// plantillaMensaje.js. Simulados: Supabase (en memoria, con DOS tenants),
// envío por WhatsApp y Gemini (espía).
//
//     node backend/tests/consultas/plantillasAgotado.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ------------------------------------------------------------- Supabase ---

const TABLA = "5k_15k_reservas_2_cifras";
const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

const db = {
    [TABLA]: [],
    plantillas_mensaje: [],
    configuracion_seleccion_mensajes: []
};
let errorTabla = null;

const fakeSupabase = {
    from(tabla) {
        const filtros = [];
        let operacion = "select";
        let cambios = null;
        let unico = false;
        let orden = null;
        const b = {
            select() { return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            or() { return b; },
            in() { return b; },
            order(c) { orden = c; return b; },
            update(x) { operacion = "update"; cambios = x; return b; },
            maybeSingle() { unico = true; return b; },
            single() { unico = true; return b; },
            then(ok, ko) {
                let res;
                if (tabla === TABLA && errorTabla) {
                    res = { data: null, error: errorTabla };
                } else {
                    const filas = (db[tabla] || []).filter(f => filtros.every(([c, v]) => f[c] === v));
                    if (operacion === "update") {
                        filas.forEach(f => Object.assign(f, cambios));
                        res = { data: null, error: null };
                    } else {
                        if (orden) filas.sort((a, z) => (a[orden] ?? 0) - (z[orden] ?? 0));
                        res = { data: unico ? (filas[0] || null) : filas, error: null };
                    }
                }
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

// -------------------------------------------------------------- espías ---

const espias = { gemini: 0, enviados: [], tiposPedidos: [] };

inyectar(r("bot/ai/aiService.js"), {
    suggestReply: async () => { espias.gemini++; return { respuesta: "Números disponibles: 01 02 03 (IA)" }; }
});
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({}) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ text }) => { espias.enviados.push(text); },
    sendImage: async () => {}
});

// espía de qué TIPO de plantillas se piden (sobre el configMensajes REAL)
const configReal = require(r("bot/ai/configMensajes.js"));
const pedirReal = configReal.obtenerPlantillasHabilitadas;
configReal.obtenerPlantillasHabilitadas = async (tipo, usuarioId) => {
    espias.tiposPedidos.push(tipo);
    return pedirReal(tipo, usuarioId);
};

const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));
const { responderResultado } = require(r("bot/ai/responderResultado.js"));

// ----------------------------------------------------------------- datos ---

const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";
const EVENTO = { id: "ev-1", nombre_evento: "Lotería De Manizales", tabla: TABLA, cifras: 2, identidad_evento_real: "id", hora_fin: "22:30", valor: 3000 };

let secuencia = 0;

function plantilla(usuario, tipo, contenido, extra = {}) {
    const fila = { id: `p-${++secuencia}`, usuario_id: usuario, tipo_respuesta: tipo, nombre: `P${secuencia}`, contenido, variables: {}, habilitada: true, orden: secuencia, ...extra };
    db.plantillas_mensaje.push(fila);
    return fila;
}

function modo(usuario, tipo, modo_seleccion, extra = {}) {
    db.configuracion_seleccion_mensajes.push({ id: `cfg-${++secuencia}`, usuario_id: usuario, tipo_respuesta: tipo, modo_seleccion, rotacion_indice: 0, habilitada: true, ...extra });
}

function tabla(estadoDe) {
    db[TABLA] = NUMEROS.map((numero, i) => ({ numero, estado: estadoDe(i) }));
}

function reiniciar() {
    db.plantillas_mensaje = [];
    db.configuracion_seleccion_mensajes = [];
    errorTabla = null;
    Object.assign(espias, { gemini: 0, enviados: [], tiposPedidos: [] });
    // Las plantillas de "disponibilidad" del tenant A (como las 35 reales).
    plantilla(TENANT_A, "disponibilidad", "🎲 *NÚMEROS DISPONIBLES* 🎲\n\n📋 Estos son los números que puedes elegir:\n\n{{numeros_disponibles}}");
    modo(TENANT_A, "disponibilidad", "fijo", { plantilla_fija_id: db.plantillas_mensaje[0].id });
}

async function consultar(usuarioId = TENANT_A) {
    const consulta = await resolverConsulta({ tipo: "disponibilidad", evento: EVENTO, usuario: { id: "u1" } });
    await responderResultado({
        sock: {},
        session: { usuarioId, sessionId: "s1" },
        chat: { remoteJid: "g@g.us", esGrupo: true },
        message: { key: { id: `M${++secuencia}`, remoteJid: "g@g.us", fromMe: false } },
        usuario: { id: "u1", nombre: "Cliente" },
        evento: EVENTO,
        textoOriginal: "¿qué números quedan?",
        consulta
    });
    return { consulta, enviado: espias.enviados[espias.enviados.length - 1] };
}

const llena = () => tabla(i => (i % 3 === 0 ? "pagado" : "reservado"));
const FIJO_AGOTADO = /NÚMEROS AGOTADOS[\s\S]*ya no hay números disponibles/;

// ---------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. disponibles > 0 -> plantillas de 'disponibilidad' (lista), nunca las de agotado", async () => {

    reiniciar();
    plantilla(TENANT_A, "disponibilidad_agotada", "🚫 AGOTADO A");
    tabla(i => (i < 98 ? "reservado" : "libre"));

    const { enviado } = await consultar();

    assert.deepStrictEqual(espias.tiposPedidos, ["disponibilidad"]);
    assert.ok(/Estos son los números/.test(enviado) && /98/.test(enviado) && /99/.test(enviado));
    assert.ok(!/AGOTADO/.test(enviado));

});

prueba("2. 0 disponibles + ocupados -> selecciona 'disponibilidad_agotada'", async () => {

    reiniciar();
    plantilla(TENANT_A, "disponibilidad_agotada", "🚫 *SORTEO AGOTADO* de {{evento}} ❤️");
    llena();

    const { consulta, enviado } = await consultar();

    assert.strictEqual(consulta.agotado, true);
    assert.deepStrictEqual(espias.tiposPedidos, ["disponibilidad_agotada"]);
    assert.strictEqual(enviado, "🚫 *SORTEO AGOTADO* de Lotería De Manizales ❤️", "plantilla de agotado con sus variables");

});

prueba("3. 0 disponibles + 0 ocupados (error) -> NO es agotado; nunca plantillas de agotado", async () => {

    reiniciar();
    plantilla(TENANT_A, "disponibilidad_agotada", "🚫 AGOTADO");
    errorTabla = { message: "fallo simulado" };

    const { consulta, enviado } = await consultar();

    assert.notStrictEqual(consulta.agotado, true);
    assert.ok(!espias.tiposPedidos.includes("disponibilidad_agotada"));
    assert.ok(!/AGOTADO/.test(enviado));

});

prueba("4. plantilla de agotado HABILITADA -> se utiliza", async () => {

    reiniciar();
    plantilla(TENANT_A, "disponibilidad_agotada", "🔒 YA NO QUEDAN NUMERITOS");
    llena();

    const { enviado } = await consultar();

    assert.strictEqual(enviado, "🔒 YA NO QUEDAN NUMERITOS");

});

prueba("5. plantilla de agotado DESHABILITADA -> no se utiliza (fallback fijo)", async () => {

    reiniciar();
    plantilla(TENANT_A, "disponibilidad_agotada", "🔒 DESHABILITADA", { habilitada: false });
    llena();

    const { enviado } = await consultar();

    assert.ok(!/DESHABILITADA/.test(enviado));
    assert.ok(FIJO_AGOTADO.test(enviado));

});

prueba("6. varias plantillas de agotado -> respeta el selector existente (rotación y fijo)", async () => {

    reiniciar();
    const p1 = plantilla(TENANT_A, "disponibilidad_agotada", "AGOTADO 1");
    plantilla(TENANT_A, "disponibilidad_agotada", "AGOTADO 2");
    plantilla(TENANT_A, "disponibilidad_agotada", "AGOTADO 3");
    modo(TENANT_A, "disponibilidad_agotada", "rotacion");
    llena();

    const vistos = [];
    for (let i = 0; i < 4; i++) vistos.push((await consultar()).enviado);
    assert.deepStrictEqual(vistos, ["AGOTADO 1", "AGOTADO 2", "AGOTADO 3", "AGOTADO 1"], "rotación persistida");

    const cfg = db.configuracion_seleccion_mensajes.find(c => c.tipo_respuesta === "disponibilidad_agotada");
    Object.assign(cfg, { modo_seleccion: "fijo", plantilla_fija_id: p1.id });
    assert.strictEqual((await consultar()).enviado, "AGOTADO 1", "modo fijo");

    Object.assign(cfg, { modo_seleccion: "aleatorio" });
    const aleatorio = (await consultar()).enviado;
    assert.ok(["AGOTADO 1", "AGOTADO 2", "AGOTADO 3"].includes(aleatorio), "modo aleatorio entre las habilitadas");

});

prueba("7. sin plantillas de agotado -> fallback fijo seguro, sin IA", async () => {

    reiniciar();
    llena();

    const { enviado } = await consultar();

    assert.ok(FIJO_AGOTADO.test(enviado));
    assert.strictEqual(espias.gemini, 0);

});

prueba("8. NUNCA agotado -> plantilla de 'disponibilidad' (aunque sea la única que existe)", async () => {

    reiniciar();
    llena();

    const { enviado } = await consultar();

    assert.ok(!espias.tiposPedidos.includes("disponibilidad"));
    assert.ok(!/Estos son los números/.test(enviado));

});

prueba("9. NUNCA agotado -> lista vacía: una plantilla de agotado con {{numeros_disponibles}} no participa", async () => {

    reiniciar();
    plantilla(TENANT_A, "disponibilidad_agotada", "Disponibles: {{numeros_disponibles}}");
    plantilla(TENANT_A, "disponibilidad_agotada", "Quedan {{ numeros_disponibles|upper }}");
    llena();

    const { enviado } = await consultar();
    assert.ok(FIJO_AGOTADO.test(enviado), "las dos se descartan -> mensaje fijo");

    plantilla(TENANT_A, "disponibilidad_agotada", "🚫 Tabla llena, familia");
    assert.strictEqual((await consultar()).enviado, "🚫 Tabla llena, familia", "solo participa la válida");

});

prueba("10. NUNCA agotado -> Gemini", async () => {

    reiniciar();
    llena();
    await consultar();
    plantilla(TENANT_A, "disponibilidad_agotada", "{{numeros_disponibles}}");
    await consultar();

    assert.strictEqual(espias.gemini, 0);
    assert.ok(espias.enviados.every(t => !/\(IA\)/.test(t)));

});

prueba("11. aislamiento por tenant: las plantillas de agotado de B nunca se usan para A", async () => {

    reiniciar();
    plantilla(TENANT_B, "disponibilidad_agotada", "AGOTADO DEL TENANT B");
    modo(TENANT_B, "disponibilidad_agotada", "aleatorio");
    llena();

    const deA = (await consultar(TENANT_A)).enviado;
    assert.ok(!/TENANT B/.test(deA));
    assert.ok(FIJO_AGOTADO.test(deA));

    const deB = (await consultar(TENANT_B)).enviado;
    assert.strictEqual(deB, "AGOTADO DEL TENANT B");

});

prueba("12. interruptor del panel para 'disponibilidad_agotada' desactivado -> silencio", async () => {

    reiniciar();
    plantilla(TENANT_A, "disponibilidad_agotada", "🚫 AGOTADO");
    modo(TENANT_A, "disponibilidad_agotada", "aleatorio", { habilitada: false });
    llena();

    await consultar();

    assert.strictEqual(espias.enviados.length, 0);

});

prueba("13. las plantillas de 'disponibilidad' no se tocan (contenido, habilitada y orden intactos)", async () => {

    reiniciar();
    const antes = JSON.stringify(db.plantillas_mensaje.filter(p => p.tipo_respuesta === "disponibilidad"));
    llena();
    await consultar();
    tabla(i => (i < 50 ? "reservado" : "libre"));
    await consultar();

    assert.strictEqual(JSON.stringify(db.plantillas_mensaje.filter(p => p.tipo_respuesta === "disponibilidad")), antes);

});

(async () => {

    const salida = (t) => process.stdout.write(t + "\n");
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) {
        originales[m] = console[m];
        console[m] = () => {};
    }

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            salida(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            salida(`❌ ${nombre}`);
            salida(String(err && err.stack || err));
        }
    }

    Object.assign(console, originales);

    salida("\n============================");
    salida(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    salida("============================");

    process.exit(falla ? 1 : 0);

})();
