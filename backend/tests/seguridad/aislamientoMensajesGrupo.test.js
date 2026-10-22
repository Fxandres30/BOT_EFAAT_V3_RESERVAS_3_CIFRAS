// ==========================================================================
// PRUEBAS — mensajes de grupo con DOS clientes (dispatcher real).
//
// REALES: bot/handlers/dispatcher.js (puertas de dueño, grupo autorizado y
// "ya procesado"), compuertaIngreso.js, guardarMensajeGrupo.js,
// politicaGrupos.js, workerEventos.js y bot/events/groups.js (bloqueo).
// SIMULADOS: Supabase en memoria que reproduce la base CON la migración 028
// (cliente_usuario_id + único por cliente) o SIN ella (único global de la
// 021, sin columna), y los manejadores de negocio (registran quién procesa).
//
//   - grupo compartido: A y B procesan cada uno su copia del mismo mensaje;
//   - dentro de un cliente, un mensaje se procesa una sola vez (secuencial y
//     concurrente);
//   - fila histórica sin cliente: no se reprocesa, sin atribuirle dueño;
//   - usuario_id = participante; cliente_usuario_id = dueño de la sesión;
//   - sin dueño de la sesión, grupo no autorizado o autorización
//     desconocida: nada (ni historial ni negocio);
//   - sin la 028: comportamiento anterior, sin errores;
//   - worker de sorteos y expulsiones: solo en grupos autorizados.
//
//     node backend/tests/seguridad/aislamientoMensajesGrupo.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (rel, exp) => { const abs = r(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PARTICIPANTE = "cccccccc-0000-4000-8000-0000000000cc";   // usuarios.id del que escribe
const COMPARTIDO = "compartido@g.us";
const SOLO_A = "soloA@g.us";

// --------------------------------------------------- Supabase (en memoria) ---

const base = {
    con028: true,
    errorAutorizacion: false,
    mensajes: [],
    autorizados: [],
    eventos: []
};

function cumple(fila, filtros, ors) {
    if (!filtros.every(([c, v]) => fila[c] === v)) return false;
    return ors.every(alternativas => alternativas.some(([c, op, v]) => (op === "eq" ? fila[c] === v : fila[c] == null)));
}

const supabase = {
    from(tabla) {
        const q = { filtros: [], ors: [], op: "select", datos: null, single: false };
        const b = {
            select() { return b; },
            insert(d) { q.op = "insert"; q.datos = d; return b; },
            eq(c, v) { q.filtros.push([c, v]); return b; },
            or(texto) { q.ors.push(texto.split(",").map(p => { const [c, op, ...v] = p.split("."); return [c, op, v.join(".")]; })); return b; },
            order() { return b; },
            limit() { return b; },
            single() { q.single = true; return b; },
            maybeSingle() { q.single = true; return b; },
            then(ok, ko) { return Promise.resolve(ejecutar(tabla, q)).then(ok, ko); }
        };
        return b;
    }
};

function ejecutar(tabla, q) {

    if (tabla === "grupos_autorizados") {
        if (base.errorAutorizacion) return { data: null, error: { message: "fallo simulado" } };
        return { data: base.autorizados.filter(f => cumple(f, q.filtros, [])), error: null };
    }

    if (tabla === "eventos_bot") {
        return { data: base.eventos.filter(f => cumple(f, q.filtros, [])), error: null };
    }

    if (tabla === "mensajes_grupos_sorteos") {

        const usaCliente = q.filtros.some(([c]) => c === "cliente_usuario_id")
            || q.ors.some(o => o.some(([c]) => c === "cliente_usuario_id"))
            || (q.datos && "cliente_usuario_id" in q.datos);

        // Como PostgREST real: una clave desconocida en el cuerpo de un INSERT
        // da PGRST204 (caché del esquema); en un filtro, 42703 de Postgres.
        if (usaCliente && !base.con028) {
            return q.op === "insert"
                ? { data: null, error: { code: "PGRST204", message: "Could not find the 'cliente_usuario_id' column of 'mensajes_grupos_sorteos' in the schema cache" } }
                : { data: null, error: { code: "42703", message: "column mensajes_grupos_sorteos.cliente_usuario_id does not exist" } };
        }

        if (q.op === "insert") {
            const fila = { id: base.mensajes.length + 1, ...q.datos };
            const choca = base.con028
                ? fila.cliente_usuario_id && base.mensajes.some(m => m.cliente_usuario_id === fila.cliente_usuario_id && m.grupo_id === fila.grupo_id && m.mensaje_id === fila.mensaje_id)
                : base.mensajes.some(m => m.grupo_id === fila.grupo_id && m.mensaje_id === fila.mensaje_id);
            if (choca) return { data: null, error: { code: "23505", message: "duplicate key" } };
            base.mensajes.push(fila);
            return { data: fila, error: null };
        }

        return { data: base.mensajes.filter(f => cumple(f, q.filtros, q.ors)), error: null };
    }

    return { data: [], error: null };

}

inyectar("lib/supabase.js", supabase);

// ------------------------------------------------- negocio (espiado) ---

const negocio = [];
inyectar("bot/middleware/obtenerContexto.js", async (sock, message) => ({
    sock,
    message,
    chat: { esGrupo: message.key.remoteJid.endsWith("@g.us"), remoteJid: message.key.remoteJid },
    usuario: { id: PARTICIPANTE, nombre: "Ana", telefono: "3001112222", lid: null },
    texto: "dame el 05",
    textoOriginal: "dame el 05"
}));
inyectar("bot/funciones/mensajes/clasificarMensaje.js", { clasificarMensaje: async () => {} });
inyectar("bot/handlers/eventHandler.js", async (ctx) => { negocio.push({ cliente: ctx.session.usuarioId, grupo: ctx.chat.remoteJid, id: ctx.message.key.id }); });
inyectar("bot/handlers/commandHandler.js", async () => {});
inyectar("bot/funciones/pagos/registrarStickerPago.js", { registrarStickerPago: async () => ({ intervino: false }) });
inyectar("bot/funciones/pagos/confirmarPagoPorSticker.js", { confirmarPagoPorSticker: async () => {} });

const dispatcher = require(r("bot/handlers/dispatcher.js"));
const compuerta = require(r("bot/funciones/mensajes/compuertaIngreso.js"));
const politica = require(r("bot/funciones/grupos/politicaGrupos.js"));

const sesion = (cliente) => ({ sessionId: `ses-${cliente || "x"}`, usuarioId: cliente });
const sockDe = (cliente) => ({ context: sesion(cliente) });

let n = 0;
const mensaje = (grupo, id = `M${++n}`) => ({
    key: { remoteJid: grupo, id, participant: "573001112222@s.whatsapp.net", fromMe: false },
    message: { conversation: "dame el 05" },
    messageTimestamp: Math.floor(Date.now() / 1000)
});

const recibir = (cliente, msg) => dispatcher({ sock: sockDe(cliente), message: msg, session: sesion(cliente), tipo: "GRUPO", ingreso: { historico: false } });

function reiniciar({ con028 = true } = {}) {
    Object.assign(base, { con028, errorAutorizacion: false, mensajes: [], eventos: [] });
    base.autorizados = [
        { usuario_id: A, grupo_id: COMPARTIDO, activo: true },
        { usuario_id: A, grupo_id: SOLO_A, activo: true },
        { usuario_id: B, grupo_id: COMPARTIDO, activo: true }
    ];
    negocio.length = 0;
    politica.olvidarAutorizacion();
    compuerta._reiniciarMemoria();
}

// ---------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("grupo compartido (028): A y B procesan cada uno SU copia del mismo mensaje", async () => {
    reiniciar();
    const msg = mensaje(COMPARTIDO);
    await recibir(A, msg);
    await recibir(B, msg);
    assert.deepStrictEqual(negocio.map(x => x.cliente).sort(), [A, B].sort());
    assert.deepStrictEqual(base.mensajes.map(m => m.cliente_usuario_id).sort(), [A, B].sort(), "una fila por cliente");
});

prueba("mismo cliente: el mensaje se procesa una sola vez (repetido y concurrente)", async () => {
    reiniciar();
    const msg = mensaje(COMPARTIDO);
    await recibir(A, msg);
    await recibir(A, msg);
    assert.strictEqual(negocio.length, 1, "repetido");
    const otro = mensaje(COMPARTIDO);
    await Promise.all([recibir(A, otro), recibir(A, otro), recibir(A, otro)]);
    assert.strictEqual(negocio.filter(x => x.id === otro.key.id).length, 1, "concurrente: el único por cliente reclama una vez");
    assert.strictEqual(base.mensajes.filter(m => m.mensaje_id === otro.key.id).length, 1);
});

prueba("fila histórica SIN cliente: no se reprocesa para nadie y no se le asigna dueño", async () => {
    reiniciar();
    const msg = mensaje(COMPARTIDO);
    base.mensajes.push({ id: 99, grupo_id: COMPARTIDO, mensaje_id: msg.key.id, cliente_usuario_id: null });
    await recibir(A, msg);
    await recibir(B, msg);
    assert.strictEqual(negocio.length, 0);
    assert.strictEqual(base.mensajes.length, 1);
    assert.strictEqual(base.mensajes[0].cliente_usuario_id, null);
});

prueba("la fila guarda el participante en usuario_id y el dueño de la sesión en cliente_usuario_id", async () => {
    reiniciar();
    await recibir(B, mensaje(COMPARTIDO));
    assert.strictEqual(base.mensajes[0].usuario_id, PARTICIPANTE);
    assert.strictEqual(base.mensajes[0].cliente_usuario_id, B);
});

prueba("sesión SIN dueño: nada (ni historial ni negocio)", async () => {
    reiniciar();
    const err = console.error; console.error = () => {};
    try { await recibir(null, mensaje(COMPARTIDO)); } finally { console.error = err; }
    assert.strictEqual(negocio.length, 0);
    assert.strictEqual(base.mensajes.length, 0);
});

prueba("grupo NO autorizado para B: B no guarda ni procesa; A sí", async () => {
    reiniciar();
    const msg = mensaje(SOLO_A);
    await recibir(B, msg);
    await recibir(A, msg);
    assert.deepStrictEqual(negocio.map(x => x.cliente), [A]);
    assert.deepStrictEqual(base.mensajes.map(m => m.cliente_usuario_id), [A]);
});

prueba("autorización desconocida (error leyendo grupos_autorizados): se rechaza", async () => {
    reiniciar();
    base.errorAutorizacion = true;
    const err = console.error; console.error = () => {};
    try { await recibir(A, mensaje(COMPARTIDO)); } finally { console.error = err; }
    assert.strictEqual(negocio.length, 0);
    assert.strictEqual(base.mensajes.length, 0);
});

prueba("autorización: la caché es por cliente; desautorizar tiene efecto al expirar/olvidar", async () => {
    reiniciar();
    await recibir(A, mensaje(COMPARTIDO));
    base.autorizados = base.autorizados.filter(f => !(f.usuario_id === A && f.grupo_id === COMPARTIDO));
    politica.olvidarAutorizacion(A);
    await recibir(A, mensaje(COMPARTIDO));
    await recibir(B, mensaje(COMPARTIDO));
    assert.deepStrictEqual(negocio.map(x => x.cliente), [A, B], "el segundo de A ya no se procesa; B no se ve afectado");
});

prueba("SIN la migración 028: sin errores y como antes (el segundo cliente del grupo queda descartado)", async () => {
    reiniciar({ con028: false });
    const msg = mensaje(COMPARTIDO);
    await recibir(A, msg);
    await recibir(B, msg);
    assert.deepStrictEqual(negocio.map(x => x.cliente), [A]);
    assert.strictEqual(base.mensajes.length, 1);
    assert.ok(!("cliente_usuario_id" in base.mensajes[0]), "fila guardada sin la columna");
    await recibir(A, msg);
    assert.strictEqual(negocio.length, 1, "y el duplicado de A se sigue descartando");
});

prueba("compuerta en memoria: la clave incluye al cliente", () => {
    const msg = mensaje(COMPARTIDO);
    assert.notStrictEqual(compuerta.identidadMensaje(msg, A).clave, compuerta.identidadMensaje(msg, B).clave);
    assert.strictEqual(compuerta.identidadMensaje(msg, A).clave, compuerta.identidadMensaje(msg, A).clave);
});

// ------------------------------------------------- worker y expulsiones ---

const sorteosProcesados = [];
inyectar("bot/funciones/eventos/lifecycle/procesarSorteo.js", { procesarSorteo: async ({ filas }) => { for (const f of filas) sorteosProcesados.push(f.grupo_id); } });
inyectar("bot/funciones/eventos/grupos/reconciliarApertura.js", { reconciliarAperturaGrupo: async () => ({}) });
inyectar("bot/funciones/usuarios/escanerIdentidadesLifecycle.js", { escanearGrupo: async () => {} });
inyectar("bot/funciones/eventos/lifecycle/verificarHoraCierre.js", { verificarHoraCierre: async () => {} });
const workerMod = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const workerEventos = workerMod.workerEventos || workerMod;

prueba("worker de sorteos: solo actúa en grupos autorizados de su cliente", async () => {
    reiniciar();
    base.eventos = [
        { id: 1, usuario_id: A, grupo_id: SOLO_A, activo: true, abierto: true, estado: "abierto" },
        { id: 2, usuario_id: A, grupo_id: "noAutorizado@g.us", activo: true, abierto: true, estado: "abierto" }
    ];
    sorteosProcesados.length = 0;
    const log = console.log; console.log = () => {};
    try { await workerEventos({ context: { sessionId: "ses-A", usuarioId: A } }); } finally { console.log = log; }
    assert.deepStrictEqual(sorteosProcesados, [SOLO_A], "procesa el autorizado y no toca el grupo sin autorizar");
});

prueba("worker de sorteos: autorización desconocida -> no actúa sobre ninguno", async () => {
    reiniciar();
    base.eventos = [{ id: 1, usuario_id: A, grupo_id: SOLO_A, activo: true, abierto: true, estado: "abierto" }];
    base.errorAutorizacion = true;
    sorteosProcesados.length = 0;
    const err = console.error; console.error = () => {};
    try { await workerEventos({ context: { sessionId: "ses-A", usuarioId: A } }); } finally { console.error = err; }
    assert.deepStrictEqual(sorteosProcesados, []);
});

const expulsiones = [];
inyectar("bot/funciones/grupos/sincronizarGrupo.js", { sincronizarGrupo: async () => {}, programarSincronizacion: () => {} });
inyectar("bot/funciones/bloqueo/bloqueoParticipantesGrupo.js", { procesarIngresoParticipante: async (sock, grupo) => { expulsiones.push({ cliente: sock.context.usuarioId, grupo }); } });
inyectar("services/baileys/propiedadSesion.js", { puedeActuar: () => true, describir: () => "", configurar: () => {} });
const { registerGroups } = require(r("bot/events/groups.js"));

prueba("expulsiones automáticas: solo en grupos autorizados del dueño del socket", async () => {
    reiniciar();
    expulsiones.length = 0;
    const socks = [A, B].map(c => { const s = { ev: new EventEmitter(), context: { sessionId: `ses-${c}`, usuarioId: c } }; registerGroups(s); return s; });
    const log = console.log; console.log = () => {};
    try {
        for (const s of socks) s.ev.emit("group-participants.update", { id: SOLO_A, action: "add", participants: ["x@lid"] });
        for (let i = 0; i < 20; i++) await new Promise(res => setImmediate(res));
    } finally { console.log = log; }
    assert.deepStrictEqual(expulsiones, [{ cliente: A, grupo: SOLO_A }], "B no evalúa expulsiones en un grupo que no autorizó");
});

(async () => {
    const log = console.log;
    let fallos = 0;
    const res = [];
    for (const { nombre, fn } of pruebas) {
        console.log = () => {};
        try { await fn(); res.push(`✅ ${nombre}`); }
        catch (e) { fallos++; res.push(`❌ ${nombre}\n    ${e.message}`); }
        finally { console.log = log; }
    }
    for (const l of res) console.log(l);
    console.log(`\n============================\nTOTAL: ${pruebas.length}  ✅ PASA: ${pruebas.length - fallos}  ❌ FALLA: ${fallos}\n============================`);
    process.exit(fallos ? 1 : 0);
})();
