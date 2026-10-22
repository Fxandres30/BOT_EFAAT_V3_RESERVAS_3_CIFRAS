// ==========================================================================
// PRUEBAS — aislamiento de DATOS con varias sesiones simultáneas.
//
// Con varios WhatsApp conectados a la vez, el de otro cliente puede estar en
// el mismo grupo y todos los workers corren en paralelo. Aquí:
//   - consultarEvento: el sorteo de un grupo es el del dueño de la sesión;
//     sin dueño, nada (falla cerrado);
//   - eventHandler / pago por sticker: buscan el sorteo con el dueño de LA
//     SESIÓN que recibió el mensaje, nunca con datos del mensaje;
//   - workerEventos: lee solo los sorteos de su dueño; sin dueño no consulta;
//   - envíos: sin socket explícito se rechazan (antes: socket activo global).
//
// Reservas, pagos, disponibilidad, «mis números», tablas e imágenes por
// cliente: backend/tests/reservas/aislamientoCuadriculas.test.js,
// seguridad/tablasCliente.test.js y seguridad/tablaCompartidaPorCliente.test.js.
//
//     node backend/tests/seguridad/multisesionDatos.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (rel, exp) => { const abs = r(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

const C1 = "cliente-1";
const C2 = "cliente-2";
const GRUPO = "compartido@g.us";

// Supabase en memoria que registra cada consulta (tabla y filtros).
const db = { eventos_bot: [] };
const consultas = [];
const supabase = {
    from(tabla) {
        const q = { tabla, filtros: [] };
        consultas.push(q);
        let unico = false;
        const b = {
            select() { return b; },
            eq(c, v) { q.filtros.push([c, v]); return b; },
            order() { return b; },
            maybeSingle() { unico = true; return b; },
            then(ok, ko) {
                const filas = (db[tabla] || []).filter(f => q.filtros.every(([c, v]) => f[c] === v));
                const res = unico
                    ? (filas.length > 1 ? { data: null, error: { message: "varias filas" } } : { data: filas[0] || null, error: null })
                    : { data: filas, error: null };
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};
inyectar("lib/supabase.js", supabase);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------- consultarEvento ---

const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));

db.eventos_bot = [
    { id: "ev-1", grupo_id: GRUPO, usuario_id: C1, nombre_evento: "Sorteo de C1", activo: true },
    { id: "ev-2", grupo_id: GRUPO, usuario_id: C2, nombre_evento: "Sorteo de C2", activo: true }
];

prueba("consultarEvento: en un grupo compartido, cada cliente obtiene SU sorteo", async () => {
    assert.strictEqual((await consultarEvento(GRUPO, C1)).id, "ev-1");
    assert.strictEqual((await consultarEvento(GRUPO, C2)).id, "ev-2");
    assert.strictEqual(await consultarEvento(GRUPO, "cliente-3"), null);
});

prueba("consultarEvento sin dueño: null y no consulta la base", async () => {
    const n = consultas.length;
    const errorOriginal = console.error;
    console.error = () => {};
    try {
        assert.strictEqual(await consultarEvento(GRUPO), null);
        assert.strictEqual(await consultarEvento(GRUPO, null), null);
    } finally { console.error = errorOriginal; }
    assert.strictEqual(consultas.length, n);
});

// -------------------------------------- eventHandler: dueño de la sesión ---

const llamadasConsultar = [];
inyectar("bot/funciones/eventos/consultarEvento.js", { consultarEvento: async (g, u) => { llamadasConsultar.push([g, u]); return null; } });
inyectar("bot/funciones/eventos/detectarEvento.js", { detectarEvento: async () => null });
const eventHandler = require(r("bot/handlers/eventHandler.js"));

prueba("eventHandler busca el sorteo con el dueño de LA SESIÓN, aunque el mensaje diga otra cosa", async () => {
    const log = console.log, dir = console.dir;
    console.log = () => {}; console.dir = () => {};
    try {
        await eventHandler({
            sock: { context: { sessionId: "s2", usuarioId: C2 } },
            session: { sessionId: "s2", usuarioId: C2 },
            chat: { esGrupo: true, remoteJid: GRUPO },
            message: { key: { remoteJid: GRUPO, fromMe: false, participant: "x@s.whatsapp.net" }, message: { conversation: "dame el 05" } },
            textoOriginal: "dame el 05",
            usuario: { id: C1 }    // un dato del mensaje: nunca decide el cliente
        });
    } finally { console.log = log; console.dir = dir; }
    assert.deepStrictEqual(llamadasConsultar, [[GRUPO, C2]]);
});

// ---------------------------------------------------------- workerEventos ---

inyectar("bot/funciones/eventos/lifecycle/procesarSorteo.js", { procesarSorteo: async () => {} });
inyectar("bot/funciones/eventos/grupos/reconciliarApertura.js", { reconciliarAperturaGrupo: async () => ({}) });
inyectar("bot/funciones/usuarios/escanerIdentidadesLifecycle.js", { escanearGrupo: async () => {} });
inyectar("bot/funciones/eventos/lifecycle/verificarHoraCierre.js", { verificarHoraCierre: async () => {} });
const workerMod = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const workerEventos = workerMod.workerEventos || workerMod;

prueba("workerEventos: consulta SOLO los sorteos del dueño de su socket", async () => {
    consultas.length = 0;
    const log = console.log;
    console.log = () => {};
    try { await workerEventos({ context: { sessionId: "s1", usuarioId: C1 } }); }
    finally { console.log = log; }
    const lectura = consultas.find(q => q.tabla === "eventos_bot");
    assert.ok(lectura, "leyó eventos_bot");
    assert.deepStrictEqual(lectura.filtros, [["activo", true], ["usuario_id", C1]]);
});

prueba("workerEventos sin dueño: no consulta nada (antes procesaba los sorteos de todos)", async () => {
    consultas.length = 0;
    const errorOriginal = console.error;
    console.error = () => {};
    try { await workerEventos({ context: { sessionId: "sX" } }); }
    finally { console.error = errorOriginal; }
    assert.strictEqual(consultas.length, 0);
});

// ------------------------------------------------------------------ envíos ---

const sockActivoGlobal = { context: { sessionId: "s1", usuarioId: C1 }, sendMessage: async () => { throw new Error("NUNCA debe usarse"); } };
inyectar("services/baileys/manager.js", {
    getActiveSocket: () => sockActivoGlobal,
    getSocketActivoDe: () => null,
    esSocketVigenteActivo: () => true
});
inyectar("diagnostico/cicloMensaje.js", { accion: () => {}, etapa: () => {} });
const { sendMessage } = require(r("services/baileys/send.js"));

prueba("envío sin socket explícito: se rechaza; nunca se usa el socket activo global (podía ser de otro cliente)", async () => {
    const errorOriginal = console.error;
    console.error = () => {};
    try {
        await assert.rejects(sendMessage({ jid: GRUPO, text: "hola" }), /sin socket de la sesión/);
    } finally { console.error = errorOriginal; }
});

prueba("envío con socket explícito: sale por ESE socket", async () => {
    const enviados = [];
    const sockC2 = { context: { sessionId: "s2", usuarioId: C2 }, user: { id: "573002:1@s.whatsapp.net" }, sendPresenceUpdate: async () => {}, sendMessage: async (jid, contenido) => { enviados.push({ jid, contenido }); return { key: { id: "X" } }; } };
    const log = console.log;
    console.log = () => {};
    try { await sendMessage({ sock: sockC2, jid: GRUPO, text: "hola" }); }
    finally { console.log = log; }
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].jid, GRUPO);
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
