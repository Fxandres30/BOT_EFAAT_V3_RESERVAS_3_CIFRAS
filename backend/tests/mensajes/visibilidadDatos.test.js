// ==========================================================================
// PRUEBAS — "Datos a mostrar" de las respuestas automáticas
// (plantillas_mensaje.variables: mostrar_* y emojis).
//
// Se prueba el MENSAJE QUE SE ENVÍA: responderResultado.js real (selección
// de plantilla, construirVariables, aplicarPlantilla) con Supabase en
// memoria y el envío por WhatsApp espiado. Las banderas salen de la fila de
// la plantilla, igual que en producción.
//
//   - cada casilla oculta SOLO su dato; al volver a activarla reaparece
//   - un alias ({{valor}}) obedece la casilla de su variable ({{precio}})
//   - clave ausente (plantilla antigua) = visible
//   - "Emojis activados" desmarcado quita los emojis escritos en la
//     plantilla, nunca los de los datos (nombre, variables globales)
//   - las variables globales dinámicas siguen resolviendo
//
//     node backend/tests/mensajes/visibilidadDatos.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ------------------------------------------------------------- Supabase ---

const db = { plantillas_mensaje: [], configuracion_seleccion_mensajes: [] };

const fakeSupabase = {
    from(tabla) {
        const filtros = [];
        let unico = false;
        const b = {
            select() { return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            order() { return b; },
            update() { return b; },
            maybeSingle() { unico = true; return b; },
            then(ok, ko) {
                const filas = (db[tabla] || []).filter(f => filtros.every(([c, v]) => f[c] === v));
                return Promise.resolve({ data: unico ? (filas[0] || null) : filas, error: null }).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

const enviados = [];
let variablesGlobales = [];

inyectar(r("bot/ai/aiService.js"), { suggestReply: async () => ({ respuesta: "(IA)" }) });
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({}) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => variablesGlobales });
inyectar(r("services/baileys/send.js"), { sendMessage: async ({ text }) => { enviados.push(text); }, sendImage: async () => {} });

const { responderResultado } = require(r("bot/ai/responderResultado.js"));
const { aplicarPlantilla, quitarEmojis, MOSTRAR_POR_VARIABLE } = require(r("bot/ai/plantillaMensaje.js"));

// ----------------------------------------------------------------- datos ---

const USUARIO = "tenant-A";
const EVENTO = { id: "ev-1", nombre_evento: "Lotería De Manizales", tabla: "5k_15k_reservas_2_cifras", cifras: 2, fecha_evento: "2026-10-25", hora_fin: "22:30", valor: 3000 };
const CLIENTE = "Ana 🌸";

const CONTENIDO =
    "🎉 Hola {{cliente}}\n" +
    "Evento: {{evento}} 🎲\n" +
    "Pediste {{numeros_solicitados}} y quedaron {{numeros_reservados}} ✅\n" +
    "Fecha {{fecha}} hora {{hora}} precio {{precio}} / {{valor}}";

// Fragmento del mensaje que muestra cada dato, con su etiqueta: solicitados
// y reservados valen lo mismo ("( 05 - 12 )").
const DATO = {
    mostrar_nombre: /Hola Ana 🌸/u,
    mostrar_evento: /Evento: Lotería De Manizales/,
    mostrar_numeros_solicitados: /Pediste \( 05 - 12 \)/,
    mostrar_numeros_reservados: /quedaron \( 05 - 12 \)/,
    mostrar_fecha: /Fecha 2026-10-25/,
    mostrar_hora: /hora 10:30 PM/,
    mostrar_precio: /precio 3000 \/ 3000/
};

async function enviar(variables, contenido = CONTENIDO) {

    db.plantillas_mensaje = [{ id: "p1", usuario_id: USUARIO, tipo_respuesta: "reserva_completa", nombre: "P", contenido, variables, habilitada: true, orden: 1 }];
    db.configuracion_seleccion_mensajes = [{ id: "c1", usuario_id: USUARIO, tipo_respuesta: "reserva_completa", modo_seleccion: "fijo", plantilla_fija_id: "p1", habilitada: true }];

    await responderResultado({
        sock: {},
        session: { usuarioId: USUARIO, sessionId: "s1" },
        chat: { remoteJid: "g@g.us", esGrupo: true },
        message: { key: { id: `M${enviados.length}`, remoteJid: "g@g.us", fromMe: false } },
        usuario: { id: "u1", nombre: CLIENTE },
        evento: EVENTO,
        textoOriginal: "05 12",
        reserva: { ok: true, reservados: ["05", "12"], ocupados: [], mensaje: "MENSAJE FIJO" }
    });

    return enviados[enviados.length - 1];

}

const TODO_VISIBLE = Object.fromEntries(Object.keys(DATO).map(k => [k, true]));

// ---------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("todo activado: el mensaje enviado trae todos los datos y los emojis", async () => {
    const texto = await enviar({ ...TODO_VISIBLE, emojis: true });
    assert.notStrictEqual(texto, "MENSAJE FIJO", "se usó la plantilla");
    for (const patron of Object.values(DATO)) assert.ok(patron.test(texto), `falta ${patron}:\n${texto}`);
    assert.ok(texto.includes("🎉") && texto.includes("✅"));
});

for (const [campo, patron] of Object.entries(DATO)) {
    prueba(`${campo}: desactivado no aparece; el resto sí; activado de nuevo vuelve`, async () => {
        const oculto = await enviar({ ...TODO_VISIBLE, [campo]: false });
        assert.ok(!patron.test(oculto), `${campo}=false y aún sale ${patron}:\n${oculto}`);
        for (const [otro, p] of Object.entries(DATO)) {
            if (otro !== campo) assert.ok(p.test(oculto), `${campo}=false no debe ocultar ${otro}`);
        }
        const visible = await enviar({ ...TODO_VISIBLE, [campo]: true });
        assert.ok(patron.test(visible), `${campo}=true vuelve a mostrar ${patron}`);
    });
}

prueba("alias: {{valor}} obedece la casilla de {{precio}}", async () => {
    const texto = await enviar({ mostrar_precio: false }, "Valor: {{valor}}.");
    assert.strictEqual(texto, "Valor: .");
    assert.strictEqual(await enviar({ mostrar_precio: true }, "Valor: {{valor}}."), "Valor: 3000.");
});

prueba("plantilla antigua sin clave o sin configuración: todo visible (como siempre)", async () => {
    for (const variables of [{}, null]) {
        const texto = await enviar(variables);
        for (const patron of Object.values(DATO)) assert.ok(patron.test(texto), `falta ${patron}`);
        assert.ok(texto.includes("🎉"));
    }
});

prueba("emojis desactivados: fuera los de la plantilla, intactos los del dato; activados de nuevo vuelven", async () => {
    const sin = await enviar({ ...TODO_VISIBLE, emojis: false });
    assert.strictEqual(sin.split("\n")[0], `Hola ${CLIENTE}`, "sin 🎉 ni espacio inicial, con el 🌸 del nombre");
    assert.strictEqual(sin.split("\n")[1], "Evento: Lotería De Manizales");
    assert.ok(/quedaron .*05.*$/m.test(sin) && !sin.includes("✅") && !sin.includes("🎲"));
    const con = await enviar({ ...TODO_VISIBLE, emojis: true });
    assert.ok(con.startsWith("🎉 Hola") && con.includes("✅"));
});

prueba("emojis y casillas se combinan: cada opción controla solo lo suyo", async () => {
    const texto = await enviar({ ...TODO_VISIBLE, mostrar_nombre: false, emojis: false });
    assert.ok(!texto.includes("Ana") && !texto.includes("🌸") && !texto.includes("🎉"));
    assert.ok(texto.includes("Lotería De Manizales") && texto.includes("3000"));
});

prueba("variables globales dinámicas siguen funcionando (y conservan sus emojis)", async () => {
    variablesGlobales = [{ identificador: "despedida", tipo: "texto", valor: "Suerte 🍀", nombre_visible: "Despedida" }];
    try {
        const texto = await enviar({ ...TODO_VISIBLE, emojis: false, mostrar_evento: false }, "{{cliente}}: {{despedida}} 🎉");
        assert.strictEqual(texto, `${CLIENTE}: Suerte 🍀`);
    } finally {
        variablesGlobales = [];
    }
});

prueba("solo emojis + emojis desactivados: no se envía vacío (mensaje de respaldo)", async () => {
    const texto = await enviar({ emojis: false }, "🎉🎉 ✅");
    assert.ok(texto && texto.trim(), "nunca un mensaje vacío");
    assert.ok(!/^[\s🎉✅]*$/u.test(texto));
});

prueba("quitarEmojis: tonos, banderas, ZWJ, keycaps y espacios", () => {
    assert.strictEqual(quitarEmojis("Hola 👋🏽 Ana"), "Hola Ana");
    assert.strictEqual(quitarEmojis("🇨🇴 Colombia"), "Colombia");
    assert.strictEqual(quitarEmojis("Familia 👨‍👩‍👧 feliz"), "Familia feliz");
    assert.strictEqual(quitarEmojis("Paso 1️⃣ listo ❤️"), "Paso 1 listo");
    assert.strictEqual(quitarEmojis("Sí✅no"), "Síno");
    assert.strictEqual(quitarEmojis("Línea 🎉\n🎲 otra"), "Línea\notra");
    assert.strictEqual(quitarEmojis("{{cliente}} sin emojis, #1 y 50%"), "{{cliente}} sin emojis, #1 y 50%");
});

prueba("aplicarPlantilla sin opciones: igual que antes", () => {
    assert.strictEqual(aplicarPlantilla("🎉 {{cliente}}", { cliente: "Ana" }), "🎉 Ana");
    assert.strictEqual(aplicarPlantilla("🎉 {{cliente}}", { cliente: "Ana" }, { emojis: true }), "🎉 Ana");
    assert.deepStrictEqual(Object.values(MOSTRAR_POR_VARIABLE).sort(), [
        "mostrar_evento", "mostrar_fecha", "mostrar_hora", "mostrar_nombre", "mostrar_numeros_disponibles",
        "mostrar_numeros_ocupados", "mostrar_numeros_reservados", "mostrar_numeros_solicitados", "mostrar_precio"
    ]);
});

(async () => {
    let fallos = 0;
    for (const { nombre, fn } of pruebas) {
        try { await fn(); console.log("✅", nombre); } catch (e) { fallos++; console.log("❌", nombre, "\n   ", e.message); }
    }
    console.log(`\n============================\nTOTAL: ${pruebas.length}  ✅ PASA: ${pruebas.length - fallos}  ❌ FALLA: ${fallos}\n============================`);
    process.exit(fallos ? 1 : 0);
})();
