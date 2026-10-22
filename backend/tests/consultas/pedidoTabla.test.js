// ==========================================================================
// PRUEBAS — pedidos cortos/informales de la tabla de disponibilidad
// ("actualiza", "tabla", "actualiza x fa", "qué números quedan"...).
//
//   A. detectarIntencion(): frases que DEBEN dar "disponibilidad"
//   B. mensajes normales que NO deben activarla
//   C. conflictos con reserva / pago / comprobante / resultado / mis números
//   D. integración eventHandler (flujo real): envía la tabla del evento y
//      grupo correctos, respeta chat privado / archivos / interruptor
//   E. duplicados y pedidos simultáneos
//
// Reales: detectarIntencion.js, pedidoTabla.js, controlDisponibilidad.js,
// eventHandler.js, resolverConsulta.js, consultarDisponibilidad.js,
// responderResultado.js, plantillaMensaje.js, seleccionarPlantilla.js.
// Simulados: Supabase (tablas de 2 eventos), configMensajes (panel),
// WhatsApp (espía de envío), Gemini, detectarEvento/consultarEvento.
//
//     node backend/tests/consultas/pedidoTabla.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// Ventanas de duplicados con valores fijos para las pruebas.
process.env.DISPONIBILIDAD_VENTANA_USUARIO_MS = "30000";
process.env.DISPONIBILIDAD_VENTANA_GRUPO_MS = "8000";

// ------------------------------------------------ tablas de 2 eventos ---

const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

const TABLAS = {
    // Grupo A: solo 03, 07 y 99 libres.
    tabla_a: NUMEROS.map(n => ({ usuario_id: "tenant-test", numero: n, estado: ["03", "07", "99"].includes(n) ? "libre" : "reservado" })),
    // Grupo B: solo 50 y 51 libres.
    tabla_b: NUMEROS.map(n => ({ usuario_id: "tenant-test", numero: n, estado: ["50", "51"].includes(n) ? "libre" : "pagado" }))
};

const consultasSupabase = [];
let demoraConsultaMs = 0;

const fakeSupabase = {
    from(tabla) {
        const b = {
            select() { return b; },
            order() { return b; },
            or() { return b; },
            eq() { return b; },
            in() { return b; },
            maybeSingle() { return b; },
            single() { return b; },
            then(ok, ko) {
                if (TABLAS[tabla]) consultasSupabase.push(tabla);
                const res = { data: TABLAS[tabla] ? TABLAS[tabla].map(f => ({ ...f })) : [], error: null };
                return new Promise(res2 => setTimeout(res2, demoraConsultaMs)).then(() => res).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

// ------------------------------------------------------------- espías ---

const espias = { enviados: [], detectarReserva: 0, gemini: 0, eventosConsultados: [] };
let tipoHabilitado = true;

inyectar(r("bot/ai/configMensajes.js"), {
    obtenerConfigSeleccion: async () => null,
    obtenerPlantillasHabilitadas: async () => [],
    actualizarRotacion: async () => {},
    estaRespuestaHabilitada: async () => tipoHabilitado
});
inyectar(r("bot/ai/aiService.js"), {
    // Sin IA en estas pruebas: se usa el mensaje fijo (lista real).
    suggestReply: async () => { espias.gemini++; return null; }
});
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({}) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });

let fallarEnvio = false;
inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ jid, text, quoted }) => {
        if (fallarEnvio) throw new Error("WhatsApp desconectado (simulado)");
        espias.enviados.push({ jid, text, quotedId: quoted?.key?.id });
    },
    sendImage: async () => {}
});
inyectar(r("bot/funciones/reservas/detectarReserva.js"), {
    detectarReserva: async () => { espias.detectarReserva++; return { ok: true, mensaje: "reserva" }; }
});

const EVENTOS = {
    "grupoA@g.us": { id: "ev-a", usuario_id: "tenant-test", grupo_id: "grupoA@g.us", nombre_evento: "Sorteo A", tabla: "tabla_a", cifras: 2, identidad_evento_real: "real-a", valor: 2000, activo: true },
    "grupoB@g.us": { id: "ev-b", usuario_id: "tenant-test", grupo_id: "grupoB@g.us", nombre_evento: "Sorteo B", tabla: "tabla_b", cifras: 2, identidad_evento_real: "real-b", valor: 5000, activo: true }
};

inyectar(r("bot/funciones/eventos/detectarEvento.js"), { detectarEvento: async () => null });
inyectar(r("bot/funciones/eventos/consultarEvento.js"), {
    consultarEvento: async (grupoId) => { espias.eventosConsultados.push(grupoId); return EVENTOS[grupoId] || null; }
});
inyectar(r("bot/funciones/mensajes/cuentasIgnoradas.js"), { esCuentaIgnorada: () => false });

const { detectarIntencion } = require(r("bot/funciones/consultas/detectarIntencion.js"));
const controlDisponibilidad = require(r("bot/funciones/consultas/controlDisponibilidad.js"));
const eventHandler = require(r("bot/handlers/eventHandler.js"));

let contadorMensajes = 0;

function ctxMensaje({ texto, grupo = "grupoA@g.us", usuarioId = "u1", esGrupo = true, fromMe = false, conImagen = false }) {
    const id = `M${++contadorMensajes}`;
    return {
        sock: {},
        session: { usuarioId: "tenant-1", sessionId: "s1" },
        chat: { remoteJid: grupo, esGrupo },
        message: {
            key: { id, remoteJid: grupo, fromMe, participant: `${usuarioId}@lid` },
            message: conImagen ? { imageMessage: { caption: texto } } : { conversation: texto }
        },
        usuario: { id: usuarioId, nombre: "Cliente" },
        textoOriginal: texto
    };
}

function reiniciar() {
    Object.assign(espias, { enviados: [], detectarReserva: 0, gemini: 0, eventosConsultados: [] });
    consultasSupabase.length = 0;
    demoraConsultaMs = 0;
    tipoHabilitado = true;
    fallarEnvio = false;
    controlDisponibilidad._reiniciarParaPruebas();
}

// --------------------------------------------------------------- casos ---

const POSITIVAS = [
    // del requerimiento
    "Actualizar", "actualiza", "actualizar tabla",
    "Actualiza los números", "actualizar números",
    "Actualizar gracias", "actualiza x fa", "actualiza porfa",
    "Actualicen", "actualízame", "me actualizas",
    "Tabla", "la tabla", "tablita", "tabla actualizada",
    "Pasa tabla", "manda tabla", "envía la tabla",
    "Números disponibles", "disponibles", "los disponibles",
    "¿Qué números quedan?", "¿cuáles quedan?", "¿qué números hay?",
    "¿Qué numeritos quedan?", "los que quedan",
    "¿Hay números?", "¿quedan números?", "¿todavía hay números?",
    "Tabla xfa", "números xfa", "actualiza 🙏",
    // variantes: mayúsculas, tildes, signos, espacios, errores de tecleo
    "ACTUALIZA!!!", "  actualiza   la   tabla  ", "actualisa", "acualiza", "actulaiza",
    "actualizen porfa", "Actualízala", "tbla", "tabal", "TABLAAA", "tablas?", "la tablita porfis",
    "me pasas la tabla", "mándame la tabla 🙏🙏", "q numeros quedan", "numeros?", "Números porfa",
    "disponible", "hay numeritos?", "aun hay numeros?", "buenas, actualiza", "tabla actualizada x fa",
    "actualiza porfavor gracias", "¿ya actualizaron la tabla?",
    // auditoría: precios de tabla (nunca reserva del 10 / 15)
    "tabla 10k", "tabla del 10.000", "la tabla de $5.000 xfa", "actualiza la de 15 mil", "pasame la tabla de 3000",
    "¿ya está actualizada la tabla?", "no me llega la tabla"
];

const NEGATIVAS = [
    "Hola buenas", "buenos días", "gracias", "ok", "listo", "👍", "jajaja", "amén",
    "a qué hora juega", "bendiciones familia", "habla con el admin", "que tengan buen día",
    "ya no hay números", "no hay números disponibles por ahora", "sin números disponibles",
    "Actualizo tabla en un momento", "actualizando...", "", "   ",
    // auditoría: anuncios, negación y premios
    "ya está actualizada la tabla", "quedó actualizada la tabla", "Les actualizo la tabla", "se actualizó la tabla",
    "no actualicen", "no actualicen todavía", "tabla de premios"
];

// Conflictos: el tipo esperado es el de SIEMPRE (pedidoTabla no lo roba).
const CONFLICTOS = [
    { msg: "25 30", tipo: "reserva" },
    { msg: "quiero el 25", tipo: "reserva" },
    { msg: "la tabla 25", tipo: "reserva" },
    { msg: "actualiza el 25", tipo: "reserva" },
    { msg: "anótame el 07 y el 99", tipo: "reserva" },
    { msg: "¿el 25 está libre?", tipo: "numero_especifico" },
    // afirmaciones de pago: el bot no responde (nunca tabla ni reserva)
    { msg: "ya pagué el 25", tipo: "ninguna" },
    { msg: "¿ya pagué el 25?", tipo: "numero_especifico" },
    { msg: "cuánto debo", tipo: "consulta_pago" },
    { msg: "ya pagué, actualiza", tipo: "ninguna" },
    { msg: "actualiza mi pago", tipo: "ninguna" },
    { msg: "¿ya pagué?", tipo: "consulta_pago" },
    { msg: "les envié el comprobante", tipo: "ninguna" },
    { msg: "comprobante tabla", tipo: "ninguna" },
    { msg: "transferencia nequi", tipo: "ninguna" },
    { msg: "cuál fue el resultado", tipo: "ninguna" },
    { msg: "actualicen el resultado", tipo: "ninguna" },
    { msg: "quién ganó", tipo: "ninguna" },
    { msg: "mis números", tipo: "mis_numeros" },
    { msg: "actualiza mis números", tipo: "mis_numeros" },
    { msg: "qué números tengo", tipo: "mis_numeros" },
    { msg: "cuáles números", tipo: "mis_numeros" },
    { msg: "cuántos números tengo", tipo: "cantidad_reservas" },
    { msg: "a qué hora es el sorteo", tipo: "info_evento" },
    // auditoría: números reales del sorteo junto a "tabla" siguen siendo reserva
    { msg: "anótame el 10 de la tabla 10k", tipo: "reserva" },
    { msg: "el 10 y el 20 de la tabla 5k", tipo: "reserva" },
    { msg: "tabla 🙏 25", tipo: "reserva" },
    { msg: "el 10.000 está libre?", tipo: "numero_especifico" },
    { msg: "ya pague actualiza la tabla", tipo: "ninguna" },
    { msg: "ya mandé comprobante, actualiza", tipo: "ninguna" },
    { msg: "cuántos números hay", tipo: "cantidad_reservas" }
];

// ------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba(`A. ${POSITIVAS.length} frases de pedido de tabla -> "disponibilidad"`, async () => {
    const fallos = POSITIVAS.filter(f => detectarIntencion(f, 2).tipo !== "disponibilidad")
        .map(f => `${JSON.stringify(f)} -> ${detectarIntencion(f, 2).tipo}`);
    assert.deepStrictEqual(fallos, [], `no reconocidas:\n${fallos.join("\n")}`);
});

prueba("A2. también con evento de 3 cifras", async () => {
    for (const f of ["actualiza", "tabla xfa", "¿qué números quedan?"]) {
        assert.strictEqual(detectarIntencion(f, 3).tipo, "disponibilidad", f);
    }
});

prueba(`B. ${NEGATIVAS.length} mensajes normales -> NO "disponibilidad"`, async () => {
    const fallos = NEGATIVAS.filter(f => detectarIntencion(f, 2).tipo === "disponibilidad").map(f => JSON.stringify(f));
    assert.deepStrictEqual(fallos, [], `activaron la tabla por error: ${fallos.join(", ")}`);
});

prueba(`C. ${CONFLICTOS.length} conflictos (reserva/pago/comprobante/resultado/mis números) conservan su tipo`, async () => {
    const fallos = CONFLICTOS.filter(c => detectarIntencion(c.msg, 2).tipo !== c.tipo)
        .map(c => `${JSON.stringify(c.msg)} esperado ${c.tipo}, obtuvo ${detectarIntencion(c.msg, 2).tipo}`);
    assert.deepStrictEqual(fallos, [], fallos.join("\n"));
});

prueba("D1. 'actualiza' en grupo A -> flujo real: tabla del evento A, citando el mensaje, sin reservar", async () => {
    reiniciar();
    const ctx = ctxMensaje({ texto: "actualiza" });
    await eventHandler(ctx);

    assert.strictEqual(espias.detectarReserva, 0);
    assert.deepStrictEqual(espias.eventosConsultados, ["grupoA@g.us"]);
    assert.deepStrictEqual(consultasSupabase, ["tabla_a"]);
    assert.strictEqual(espias.enviados.length, 1);
    const env = espias.enviados[0];
    assert.strictEqual(env.jid, "grupoA@g.us");
    assert.strictEqual(env.quotedId, ctx.message.key.id);
    assert.ok(/\(3\)/.test(env.text) && /03/.test(env.text) && /07/.test(env.text) && /99/.test(env.text), env.text);
    assert.ok(!/50/.test(env.text), "no mezcla números del grupo B");
});

prueba("D2. 'tabla', 'actualiza x fa', 'qué números quedan' activan el envío real", async () => {
    for (const texto of ["tabla", "actualiza x fa", "¿qué números quedan?"]) {
        reiniciar();
        await eventHandler(ctxMensaje({ texto }));
        assert.strictEqual(espias.enviados.length, 1, texto);
        assert.ok(/03/.test(espias.enviados[0].text), texto);
    }
});

prueba("D3. grupo B recibe SU tabla (50, 51), nunca la del grupo A", async () => {
    reiniciar();
    await eventHandler(ctxMensaje({ texto: "tabla xfa", grupo: "grupoB@g.us", usuarioId: "u9" }));
    assert.deepStrictEqual(consultasSupabase, ["tabla_b"]);
    const env = espias.enviados[0];
    assert.strictEqual(env.jid, "grupoB@g.us");
    assert.ok(/50/.test(env.text) && /51/.test(env.text) && !/\b03\b/.test(env.text), env.text);
});

prueba("D4. disponibilidad vigente: tras liberar un número, el siguiente pedido lo refleja (sin caché)", async () => {
    reiniciar();
    await eventHandler(ctxMensaje({ texto: "tabla", grupo: "grupoB@g.us", usuarioId: "u1" }));
    TABLAS.tabla_b.find(f => f.numero === "52").estado = "libre";
    controlDisponibilidad._reiniciarParaPruebas(); // fuera de la ventana de duplicados
    await eventHandler(ctxMensaje({ texto: "actualiza", grupo: "grupoB@g.us", usuarioId: "u2" }));
    TABLAS.tabla_b.find(f => f.numero === "52").estado = "pagado";
    assert.strictEqual(espias.enviados.length, 2);
    assert.ok(!/52/.test(espias.enviados[0].text));
    assert.ok(/52/.test(espias.enviados[1].text), espias.enviados[1].text);
});

prueba("D5. reglas existentes: chat privado, mensaje propio, foto con pie 'tabla', grupo sin evento -> sin respuesta", async () => {
    reiniciar();
    await eventHandler(ctxMensaje({ texto: "tabla", esGrupo: false, grupo: "573000000000@s.whatsapp.net" }));
    await eventHandler(ctxMensaje({ texto: "tabla", fromMe: true }));
    await eventHandler(ctxMensaje({ texto: "tabla", conImagen: true }));
    await eventHandler(ctxMensaje({ texto: "tabla", grupo: "sinEvento@g.us" }));
    assert.strictEqual(espias.enviados.length, 0);
    assert.strictEqual(consultasSupabase.length, 0);
});

prueba("D6. interruptor del panel 'disponibilidad' desactivado -> silencio y sin consultar Supabase", async () => {
    reiniciar();
    tipoHabilitado = false;
    await eventHandler(ctxMensaje({ texto: "actualiza" }));
    assert.strictEqual(espias.enviados.length, 0);
    assert.strictEqual(consultasSupabase.length, 0);
});

prueba("E1. mismo cliente: 'tabla' + 'actualiza' seguidos -> UNA sola tabla", async () => {
    reiniciar();
    await eventHandler(ctxMensaje({ texto: "tabla", usuarioId: "u1" }));
    await eventHandler(ctxMensaje({ texto: "actualiza", usuarioId: "u1" }));
    assert.strictEqual(espias.enviados.length, 1);
    assert.strictEqual(consultasSupabase.length, 1);
});

prueba("E2. 5 pedidos SIMULTÁNEOS en el mismo grupo -> 1 consulta, 1 respuesta", async () => {
    reiniciar();
    demoraConsultaMs = 30;
    await Promise.all(["tabla", "actualiza", "tabla xfa", "disponibles", "¿hay números?"]
        .map((texto, i) => eventHandler(ctxMensaje({ texto, usuarioId: `c${i}` }))));
    assert.strictEqual(consultasSupabase.length, 1);
    assert.strictEqual(espias.enviados.length, 1);
});

prueba("E3. pedidos simultáneos en grupos DISTINTOS no se bloquean entre sí", async () => {
    reiniciar();
    demoraConsultaMs = 20;
    await Promise.all([
        eventHandler(ctxMensaje({ texto: "tabla", grupo: "grupoA@g.us" })),
        eventHandler(ctxMensaje({ texto: "tabla", grupo: "grupoB@g.us" }))
    ]);
    assert.strictEqual(espias.enviados.length, 2);
    assert.deepStrictEqual(espias.enviados.map(e => e.jid).sort(), ["grupoA@g.us", "grupoB@g.us"]);
});

prueba("E4. si el envío FALLA, el cliente puede volver a pedirla de inmediato", async () => {
    reiniciar();
    fallarEnvio = true;
    await eventHandler(ctxMensaje({ texto: "tabla", usuarioId: "u1" }));
    fallarEnvio = false;
    await eventHandler(ctxMensaje({ texto: "tabla", usuarioId: "u1" }));
    assert.strictEqual(espias.enviados.length, 1);
});

prueba("E5. ventanas: otro cliente tras 8 s sí recibe; el mismo cliente tras 30 s sí recibe", async () => {
    reiniciar();
    const t0 = 1_000_000;
    assert.ok(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "a", ahora: t0 }).permitido);
    controlDisponibilidad.finalizarTurno({ grupoId: "g", usuarioId: "a", enviado: true, ahora: t0 });
    assert.strictEqual(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "b", ahora: t0 + 5000 }).motivo, "enviada_recientemente_en_grupo");
    assert.ok(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "b", ahora: t0 + 8000 }).permitido);
    controlDisponibilidad.finalizarTurno({ grupoId: "g", usuarioId: "b", enviado: true, ahora: t0 + 8000 });
    assert.strictEqual(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "a", ahora: t0 + 20000 }).motivo, "duplicado_mismo_cliente");
    assert.ok(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "a", ahora: t0 + 30000 }).permitido);
});

prueba("E6. ventanas en 0 desactivan el control de duplicados (solo queda la exclusión en curso)", async () => {
    reiniciar();
    process.env.DISPONIBILIDAD_VENTANA_USUARIO_MS = "0";
    process.env.DISPONIBILIDAD_VENTANA_GRUPO_MS = "0";
    try {
        await eventHandler(ctxMensaje({ texto: "tabla", usuarioId: "u1" }));
        await eventHandler(ctxMensaje({ texto: "tabla", usuarioId: "u1" }));
        assert.strictEqual(espias.enviados.length, 2);
    } finally {
        process.env.DISPONIBILIDAD_VENTANA_USUARIO_MS = "30000";
        process.env.DISPONIBILIDAD_VENTANA_GRUPO_MS = "8000";
    }
});

prueba("D7. 'tabla 10k' en el grupo -> envía la tabla y NO reserva el número 10", async () => {
    reiniciar();
    await eventHandler(ctxMensaje({ texto: "tabla 10k" }));
    assert.strictEqual(espias.detectarReserva, 0);
    assert.strictEqual(espias.enviados.length, 1);
});

prueba("E8. un envío COLGADO no deja al grupo sin tabla: la marca 'en curso' caduca a los 60 s", async () => {
    reiniciar();
    const t0 = 5_000_000;
    const colgado = controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "a", ahora: t0 });
    assert.ok(colgado.permitido);
    assert.strictEqual(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "b", ahora: t0 + 59000 }).motivo, "en_curso_en_grupo");
    const nuevo = controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "b", ahora: t0 + 61000 });
    assert.ok(nuevo.permitido, "tras la caducidad otro pedido sí se atiende");
    // El colgado termina tarde: NO libera la marca del turno nuevo.
    controlDisponibilidad.finalizarTurno({ grupoId: "g", usuarioId: "a", enviado: false, token: colgado.token, ahora: t0 + 62000 });
    assert.strictEqual(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "c", ahora: t0 + 62500 }).motivo, "en_curso_en_grupo");
    controlDisponibilidad.finalizarTurno({ grupoId: "g", usuarioId: "b", enviado: false, token: nuevo.token, ahora: t0 + 63000 });
    assert.ok(controlDisponibilidad.solicitarTurno({ grupoId: "g", usuarioId: "c", ahora: t0 + 63500 }).permitido);
});

prueba("E7. una reserva NO pasa por el control de disponibilidad (nunca se omite)", async () => {
    reiniciar();
    await eventHandler(ctxMensaje({ texto: "tabla", usuarioId: "u1" }));
    await eventHandler(ctxMensaje({ texto: "07", usuarioId: "u1" }));
    await eventHandler(ctxMensaje({ texto: "99", usuarioId: "u1" }));
    assert.strictEqual(espias.detectarReserva, 2);
});

// ---------------------------------------------------------------- runner ---

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
