// ==========================================================================
// PRUEBAS — reacción ✅/❌ al mensaje del cliente cuando pide números.
//
//   todos libres y reservados      -> respuesta de siempre + ✅
//   todos ocupados por otros       -> respuesta de siempre + ❌
//   mixto (libres + ocupados)      -> respuesta de siempre, sin reacción
//   bloqueado / en proceso / mío   -> sin reacción (no se confunden)
//   mensaje repetido               -> sin respuesta ni reacción duplicada
//   fallo al reaccionar            -> la respuesta ya salió; el bot sigue
//   tipo de respuesta desactivado  -> silencio: ni respuesta ni reacción
//   interruptor «Reacciones automáticas» (panel /mensajes): desactivado ->
//   ninguna reacción y el MISMO texto; persistido en la base, sobrevive a un
//   reinicio del proceso; caché para no consultar la base en cada mensaje.
//
// Reales: eventHandler.js, detectarIntencion.js, detectarReserva.js,
// validarReservas.js, consultarReservas.js, reservarNumeros.js,
// responderResultado.js, reaccionReserva.js. Simulados: Supabase (tabla en
// memoria), plantillas, IA y el envío a WhatsApp (espías: nada sale).
//
//     node backend/tests/reservas/reaccionesReserva.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// ---------------------------------------------- tabla del sorteo (fake) ---

const TABLA = "5k_15k_reservas_2_cifras";
const TENANT = "tenant-1";
const IDENTIDAD = "id-sorteo";
const tablas = {};

function sembrar(estados = {}) {
    tablas[TABLA] = Array.from({ length: 100 }, (_, i) => {
        const numero = String(i).padStart(2, "0");
        const e = estados[numero];
        return {
            numero,
            estado: e?.estado || "libre",
            usuario_global_id: e?.usuario_global_id || null,
            usuario_id: TENANT,
            identidad_evento_real: e ? IDENTIDAD : null
        };
    });
    tablas.reservas_actividad = [];
}

// Lo que guarda el panel (guardarTipoHabilitado): una fila por cliente y tipo.
function interruptor(habilitada) {
    tablas[CONFIG] = habilitada === undefined ? [] : [{ usuario_id: TENANT, tipo_respuesta: "reacciones_reserva", habilitada }];
}

function condicionOr(expr) {
    const conds = String(expr).split(",").map(c => {
        const [col, op, ...resto] = c.split(".");
        const val = resto.join(".");
        if (op === "eq") return f => String(f[col]) === val;
        if (op === "is" && val === "null") return f => f[col] == null;
        throw new Error(`or() no soportado: ${c}`);
    });
    return f => conds.some(fn => fn(f));
}

const CONFIG = "configuracion_seleccion_mensajes";
const consultasConfig = { n: 0 };
let falloConfig = false;

const fakeSupabase = {
    from(tabla) {
        if (tabla === CONFIG) consultasConfig.n++;
        const q = { op: "select", filtros: [], payload: null };
        const b = {
            select() { return b; },
            order() { return b; },
            limit() { return b; },
            eq(c, v) { q.filtros.push(f => f[c] === v); return b; },
            in(c, vs) { q.filtros.push(f => vs.includes(f[c])); return b; },
            or(expr) { q.filtros.push(condicionOr(expr)); return b; },
            update(p) { q.op = "update"; q.payload = p; return b; },
            insert(p) { q.op = "insert"; q.payload = p; return b; },
            maybeSingle() { q.unico = true; return b; },
            single() { q.unico = true; return b; },
            then(ok, ko) {
                if (tabla === CONFIG && falloConfig) return Promise.resolve({ data: null, error: { message: "fallo simulado de la base" } }).then(ok, ko);
                const filas = tablas[tabla] || (tablas[tabla] = []);
                let res;
                if (q.op === "insert") {
                    filas.push(...(Array.isArray(q.payload) ? q.payload : [q.payload]));
                    res = { data: null, error: null };
                } else {
                    const sel = filas.filter(f => q.filtros.every(fn => fn(f)));
                    if (q.op === "update") sel.forEach(f => Object.assign(f, q.payload));
                    const copia = sel.map(f => ({ ...f }));
                    res = { data: q.unico ? copia[0] || null : copia, error: null };
                }
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

inyectar(r("lib/supabase.js"), fakeSupabase);

// ------------------------------------------------------------- espías ---

const salida = [];          // orden real de lo enviado: { tipo, ... }
let fallaReaccion = false;
let tipoHabilitado = true;

inyectar(r("services/baileys/send.js"), {
    sendMessage: async ({ jid, text, quoted }) => { salida.push({ tipo: "mensaje", jid, text, citado: quoted?.key?.id }); },
    sendImage: async () => {},
    sendReaction: async ({ jid, key, emoji }) => {
        if (fallaReaccion) throw new Error("fallo simulado de WhatsApp");
        salida.push({ tipo: "reaccion", jid, emoji, mensaje: key.id });
    }
});
inyectar(r("bot/ai/configMensajes.js"), {
    obtenerConfigSeleccion: async () => null,
    obtenerPlantillasHabilitadas: async () => [],
    actualizarRotacion: async () => {},
    estaRespuestaHabilitada: async () => tipoHabilitado
});
inyectar(r("bot/ai/aiService.js"), { suggestReply: async () => { throw new Error("sin IA en pruebas"); } });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("bot/funciones/reservas/actualizarEvento.js"), { actualizarEvento: async () => {} });

const EVENTO = { id: "ev-1", nombre_evento: "Lotería de Prueba", tabla: TABLA, cifras: 2, identidad_evento_real: IDENTIDAD, usuario_id: TENANT, hora_fin: "22:30", valor: 5000 };

inyectar(r("bot/funciones/eventos/detectarEvento.js"), { detectarEvento: async () => null });
inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => EVENTO });

const eventHandler = require(r("bot/handlers/eventHandler.js"));
const reaccion = require(r("bot/funciones/reservas/reaccionReserva.js"));
const { validarReservas } = require(r("bot/funciones/reservas/validarReservas.js"));

const CLIENTE = { id: "cliente-1", nombre: "Cliente", telefono: "573000000001", lid: "111@lid" };
const OTRO = "cliente-2";

let secuencia = 0;
function ctxMensaje(texto, { esGrupo = true, id } = {}) {
    const remoteJid = esGrupo ? "grupo-1@g.us" : "573000000001@s.whatsapp.net";
    return {
        sock: {},
        session: { usuarioId: TENANT, sessionId: "s1" },
        chat: { remoteJid, esGrupo },
        message: { key: { id: id || `MSG-${++secuencia}`, remoteJid, participant: "111@lid", fromMe: false }, message: { conversation: texto } },
        usuario: { ...CLIENTE },
        textoOriginal: texto
    };
}

function reiniciar(estados, { activado } = {}) {
    sembrar(estados);
    interruptor(activado);
    salida.length = 0;
    fallaReaccion = false;
    falloConfig = false;
    tipoHabilitado = true;
    consultasConfig.n = 0;
    delete process.env.REACCIONES_CACHE_MS;
    reaccion._reiniciar();
}

const ocupado = (estado = "reservado") => ({ estado, usuario_global_id: OTRO });
const mensajes = () => salida.filter(s => s.tipo === "mensaje");
const reacciones = () => salida.filter(s => s.tipo === "reaccion");
const estadoDe = (n) => tablas[TABLA].find(f => f.numero === n);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// -------------------------------------------- decisión pura (unitarias) ---

prueba("decidirReaccion: usa la clasificación real número por número", () => {
    const fila = (numero, estado, usuario_global_id = null) => ({ numero, estado, usuario_global_id });
    const clasif = (filas) => validarReservas(filas, { id: CLIENTE.id });
    const r1 = clasif([fila("23", "libre"), fila("45", "libre")]);
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["23", "45"], resultado: r1, reservados: ["23", "45"] }), "✅");
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["23", "45"], resultado: r1, reservados: ["23"] }), null, "reserva parcial (otro se adelantó) -> nada");
    const r2 = clasif([fila("23", "reservado", OTRO), fila("45", "pagado", OTRO)]);
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["23", "45"], resultado: r2 }), "❌");
    const r3 = clasif([fila("23", "reservado", OTRO), fila("45", "bloqueado")]);
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["23", "45"], resultado: r3 }), null, "bloqueado no es 'ocupado por otra persona'");
    const r4 = clasif([fila("23", "reservado", OTRO), fila("45", "en_proceso")]);
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["23", "45"], resultado: r4 }), null);
    const r5 = clasif([fila("23", "libre"), fila("45", "reservado", CLIENTE.id)]);
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["23", "45"], resultado: r5, reservados: ["23"] }), null, "uno ya era suyo -> nada");
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["23", "77"], resultado: clasif([fila("23", "reservado", OTRO)]) }), null, "número inexistente -> nada");
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: [], resultado: r1 }), null);
});

// ------------------------------------------- flujo completo (integración) ---

prueba("todos libres → «✅ Reserva realizada» de siempre + reacción ✅ al mensaje original, después de la respuesta", async () => {
    reiniciar();
    const ctx = ctxMensaje("23 45");
    await eventHandler(ctx);
    assert.strictEqual(mensajes().length, 1);
    assert.ok(mensajes()[0].text.startsWith("✅ Reserva realizada correctamente."), mensajes()[0].text);
    assert.strictEqual(mensajes()[0].citado, ctx.message.key.id, "la respuesta sigue citando el mensaje");
    assert.deepStrictEqual(reacciones(), [{ tipo: "reaccion", jid: "grupo-1@g.us", emoji: "✅", mensaje: ctx.message.key.id }]);
    assert.deepStrictEqual(salida.map(s => s.tipo), ["mensaje", "reaccion"], "primero la respuesta, luego la reacción");
    assert.deepStrictEqual([estadoDe("23").estado, estadoDe("45").estado], ["reservado", "reservado"]);
});

prueba("todos ocupados por otras personas → «❌ Los números solicitados ya están ocupados» de siempre + reacción ❌", async () => {
    reiniciar({ 23: ocupado("reservado"), 45: ocupado("pagado") });
    const ctx = ctxMensaje("23 45");
    await eventHandler(ctx);
    assert.strictEqual(mensajes().length, 1);
    assert.ok(mensajes()[0].text.startsWith("❌ Los números solicitados ya están ocupados."));
    assert.deepStrictEqual(reacciones().map(x => [x.emoji, x.mensaje]), [["❌", ctx.message.key.id]]);
    assert.strictEqual(estadoDe("23").usuario_global_id, OTRO, "no se tocó ninguna reserva ajena");
});

prueba("mixto (uno libre, uno ocupado) → la misma respuesta de siempre, SIN reacción", async () => {
    reiniciar({ 45: ocupado() });
    await eventHandler(ctxMensaje("23 45"));
    assert.strictEqual(mensajes().length, 1);
    assert.ok(/Reserva realizada/.test(mensajes()[0].text) && /Ya estaban ocupados/.test(mensajes()[0].text));
    assert.strictEqual(reacciones().length, 0);
});

prueba("ocupado + bloqueado / en proceso → respuesta de siempre, sin ❌ (no se confunden estados)", async () => {
    reiniciar({ 23: ocupado(), 45: { estado: "bloqueado" } });
    await eventHandler(ctxMensaje("23 45"));
    assert.strictEqual(mensajes().length, 1);
    assert.strictEqual(reacciones().length, 0);
    reiniciar({ 23: ocupado(), 45: { estado: "en_proceso" } });
    await eventHandler(ctxMensaje("23 45"));
    assert.strictEqual(reacciones().length, 0);
});

prueba("libre + uno que ya era del cliente → reserva el libre, sin reacción", async () => {
    reiniciar({ 45: { estado: "reservado", usuario_global_id: CLIENTE.id } });
    await eventHandler(ctxMensaje("23 45"));
    assert.strictEqual(mensajes().length, 1);
    assert.strictEqual(reacciones().length, 0);
});

prueba("mensaje repetido (mismo id) → ni respuesta ni reacción duplicadas, ni doble reserva", async () => {
    reiniciar();
    const ctx = ctxMensaje("23 45", { id: "MSG-REPETIDO" });
    await eventHandler(ctx);
    await eventHandler(ctxMensaje("23 45", { id: "MSG-REPETIDO" }));
    assert.strictEqual(mensajes().length, 1, "la segunda vez los números ya son suyos: no se responde");
    assert.strictEqual(reacciones().length, 1);
    assert.strictEqual(tablas[TABLA].filter(f => f.estado === "reservado").length, 2);
    // Aunque el mismo mensaje se reintente reaccionar, solo una vez.
    assert.strictEqual(await reaccion.reaccionarAlMensaje({ ctx, emoji: "✅", enviar: async () => salida.push({ tipo: "reaccion" }) }), false);
    assert.strictEqual(reacciones().length, 1);
});

prueba("mensaje repetido con todos ocupados → una sola reacción ❌ aunque llegue dos veces", async () => {
    reiniciar({ 23: ocupado(), 45: ocupado() });
    await eventHandler(ctxMensaje("23 45", { id: "MSG-OCUPADO" }));
    await eventHandler(ctxMensaje("23 45", { id: "MSG-OCUPADO" }));
    assert.strictEqual(reacciones().length, 1);
});

prueba("fallo simulado al reaccionar → la respuesta ya salió, no lanza y el siguiente mensaje se atiende normal", async () => {
    reiniciar();
    fallaReaccion = true;
    await eventHandler(ctxMensaje("23 45"));
    assert.strictEqual(mensajes().length, 1);
    assert.ok(mensajes()[0].text.startsWith("✅ Reserva realizada"));
    assert.strictEqual(reacciones().length, 0);
    fallaReaccion = false;
    await eventHandler(ctxMensaje("67"));
    assert.strictEqual(mensajes().length, 2);
    assert.strictEqual(reacciones().length, 1);
});

prueba("tipo de respuesta desactivado en el panel → la reserva se hace, pero ni respuesta ni reacción", async () => {
    reiniciar();
    tipoHabilitado = false;
    await eventHandler(ctxMensaje("23 45"));
    assert.strictEqual(salida.length, 0);
    assert.strictEqual(estadoDe("23").estado, "reservado");
});

prueba("chat privado → el bot no lo atiende (como siempre): sin respuesta ni reacción", async () => {
    reiniciar();
    await eventHandler(ctxMensaje("23 45", { esGrupo: false }));
    assert.strictEqual(salida.length, 0);
    assert.strictEqual(estadoDe("23").estado, "libre");
});

prueba("mensaje propio del bot (fromMe) → nunca se reacciona", async () => {
    reiniciar();
    const ctx = ctxMensaje("23 45");
    ctx.message.key.fromMe = true;
    assert.strictEqual(await reaccion.reaccionarAlMensaje({ ctx, emoji: "✅", enviar: async () => { throw new Error("no debe llamarse"); } }), false);
});

// ------------------------------------------- interruptor del panel ---

prueba("interruptor DESACTIVADO → misma reserva y MISMO texto que activado, sin ninguna reacción", async () => {
    for (const [estados, texto] of [[{}, "23 45"], [{ 23: ocupado(), 45: ocupado() }, "23 45"]]) {
        reiniciar(estados, { activado: true });
        await eventHandler(ctxMensaje(texto));
        const conReaccion = { textos: mensajes().map(m => m.text), reservas: tablas[TABLA].map(f => f.estado).join() };
        assert.strictEqual(reacciones().length, 1);
        reiniciar(estados, { activado: false });
        await eventHandler(ctxMensaje(texto));
        assert.deepStrictEqual(mensajes().map(m => m.text), conReaccion.textos, "el texto no cambia");
        assert.strictEqual(tablas[TABLA].map(f => f.estado).join(), conReaccion.reservas, "la reserva no cambia");
        assert.strictEqual(reacciones().length, 0, "ninguna reacción");
    }
});

prueba("sin fila guardada → ACTIVADO por defecto (comportamiento de hoy)", async () => {
    reiniciar({}, {});
    await eventHandler(ctxMensaje("23 45"));
    assert.deepStrictEqual(reacciones().map(x => x.emoji), ["✅"]);
});

prueba("activar/desactivar en el panel se aplica al vencer la caché (REACCIONES_CACHE_MS)", async () => {
    reiniciar({}, { activado: false });
    process.env.REACCIONES_CACHE_MS = "0";
    await eventHandler(ctxMensaje("23"));
    assert.strictEqual(reacciones().length, 0);
    interruptor(true);                       // el administrador lo activa en el panel
    await eventHandler(ctxMensaje("45"));
    assert.deepStrictEqual(reacciones().map(x => x.emoji), ["✅"]);
    interruptor(false);                      // y lo vuelve a desactivar
    await eventHandler(ctxMensaje("67"));
    assert.strictEqual(reacciones().length, 1);
    assert.strictEqual(mensajes().length, 3, "las 3 respuestas de texto salieron");
});

prueba("caché: 5 mensajes seguidos → 1 sola consulta del interruptor; mensajes sin reacción → 0 consultas", async () => {
    reiniciar({ 50: ocupado() }, { activado: true });
    for (const n of ["10", "11", "12", "13", "14"]) await eventHandler(ctxMensaje(n));
    assert.strictEqual(reacciones().length, 5);
    assert.strictEqual(consultasConfig.n, 1);
    reiniciar({ 45: ocupado() }, { activado: true });
    await eventHandler(ctxMensaje("23 45"));  // mixto: no hay reacción que enviar
    assert.strictEqual(consultasConfig.n, 0, "sin reacción no se consulta la base");
    // Dentro del plazo de la caché un cambio aún no se ve; al vencer, sí.
    reiniciar({}, { activado: true });
    const t0 = Date.now();
    assert.strictEqual(await reaccion.reaccionesActivadas(TENANT, { ahora: t0 }), true);
    interruptor(false);
    assert.strictEqual(await reaccion.reaccionesActivadas(TENANT, { ahora: t0 + 29000 }), true);
    assert.strictEqual(await reaccion.reaccionesActivadas(TENANT, { ahora: t0 + 31000 }), false);
    assert.strictEqual(consultasConfig.n, 2);
});

prueba("reinicio del proceso: la preferencia DESACTIVADA guardada en la base se respeta al volver a cargar el bot", async () => {
    reiniciar({}, { activado: false });
    for (const m of ["bot/handlers/eventHandler.js", "bot/funciones/reservas/detectarReserva.js", "bot/funciones/reservas/reaccionReserva.js"]) delete require.cache[r(m)];
    const eventHandlerNuevo = require(r("bot/handlers/eventHandler.js"));
    await eventHandlerNuevo(ctxMensaje("23 45"));
    assert.strictEqual(mensajes().length, 1);
    assert.ok(mensajes()[0].text.startsWith("✅ Reserva realizada"));
    assert.strictEqual(reacciones().length, 0, "sigue desactivado tras el reinicio");
    interruptor(true);
    for (const m of ["bot/handlers/eventHandler.js", "bot/funciones/reservas/detectarReserva.js", "bot/funciones/reservas/reaccionReserva.js"]) delete require.cache[r(m)];
    await require(r("bot/handlers/eventHandler.js"))(ctxMensaje("67"));
    assert.deepStrictEqual(reacciones().map(x => x.emoji), ["✅"], "activado tras otro reinicio");
});

prueba("fallo de la base al leer el interruptor → se conserva el último valor; sin ninguno, activado; la respuesta sale igual", async () => {
    reiniciar({}, { activado: false });
    process.env.REACCIONES_CACHE_MS = "0";
    await eventHandler(ctxMensaje("23"));            // lee «desactivado»
    falloConfig = true;
    await eventHandler(ctxMensaje("45"));            // la base falla: sigue desactivado
    assert.strictEqual(reacciones().length, 0);
    assert.strictEqual(mensajes().length, 2);
    reiniciar({}, { activado: false });
    falloConfig = true;
    await eventHandler(ctxMensaje("23"));            // sin valor previo: activado (hoy)
    assert.strictEqual(reacciones().length, 1);
});

(async () => {
    let ok = 0, falla = 0;
    const log = console.log, dir = console.dir;
    for (const { n, fn } of pruebas) {
        console.log = () => {}; console.dir = () => {};
        let error = null;
        try { await fn(); } catch (e) { error = e; }
        console.log = log; console.dir = dir;
        if (error) { falla++; console.log(`❌ ${n}`); console.log(String(error && error.stack || error)); }
        else { ok++; console.log(`✅ ${n}`); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
