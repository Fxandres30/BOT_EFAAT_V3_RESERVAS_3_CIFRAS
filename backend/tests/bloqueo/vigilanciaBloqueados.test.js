// ==========================================================================
// PRUEBAS SIMULADAS — vigilancia permanente de bloqueados
// (vigilanciaBloqueados.js + workerExpulsiones.tick).
//
// Mismo arnés que expulsionesBloqueo.test.js: Supabase falso en memoria y
// sockets de WhatsApp falsos. lib/supabase.js, services/baileys/manager.js y
// propiedadSesion.js se sustituyen ANTES de cargar nada: ninguna prueba toca
// producción ni envía nada a WhatsApp.
//
//     node backend/tests/bloqueo/vigilanciaBloqueados.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

process.env.GROUP_QUEUE_DELAY_MS = "0";
delete process.env.BLOQUEO_EXPULSION_MODO;
delete process.env.BLOQUEO_EXPULSION_CONFIRMAR;

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const ruta = r => path.join(RAIZ, r);

function inyectar(rutaRel, exportsObj) {
    const abs = ruta(rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const fake = crearFake();
inyectar("lib/supabase.js", fake.client);

const sockets = new Map();
inyectar("services/baileys/manager.js", { getSocketActivoDe: u => sockets.get(u) || null });
inyectar("services/baileys/propiedadSesion.js", { puedeActuar: s => !!s && s.vigente !== false, describir: () => "socket de prueba" });

const repo = require(ruta("bot/funciones/bloqueo/expulsionesRepo.js"));
const bloqueadosRepo = require(ruta("bot/funciones/bloqueo/bloqueadosRepo.js"));
const { procesarPendientesDe } = require(ruta("bot/funciones/bloqueo/procesarExpulsion.js"));
const { vigilarCliente } = require(ruta("bot/funciones/bloqueo/vigilanciaBloqueados.js"));
const { tick } = require(ruta("bot/funciones/bloqueo/workerExpulsiones.js"));
const { leerConfigExpulsiones, esperaVigilancia } = require(ruta("bot/funciones/bloqueo/configExpulsiones.js"));
const bloqueoActivo = require(ruta("bot/funciones/bloqueo/bloqueoActivo.js"));
const politicaGrupos = require(ruta("bot/funciones/grupos/politicaGrupos.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

const TEL = "3001112233";
const LID = "111222333@lid";
const PERSONA = { id: LID, phoneNumber: "573001112233@s.whatsapp.net", admin: null };

const CUENTA = { id: "573000000000:7@s.whatsapp.net", lid: "999000:7@lid" };
const CUENTA_EN_GRUPO = { id: "999000@lid", phoneNumber: "573000000000@s.whatsapp.net", admin: "admin" };

const OTRO = (n) => ({ id: `55500${n}@lid`, phoneNumber: `57310000000${n}@s.whatsapp.net`, admin: null });

const CONFIG = { modo: "real", leaseSegundos: 120, maxIntentos: 3, esperaBaseMs: 60000, esperaMaxMs: 600000, lote: 10, vigilanciaMs: 60000, vigilanciaEsperaMaxMs: 600000 };

let desplazamientoMs = 0;
const ahora = () => new Date(Date.now() + desplazamientoMs);

function reiniciar() {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    sockets.clear();
    politicaGrupos.olvidarAutorizacion();
    bloqueoActivo.olvidarBloqueos();
    desplazamientoMs = 0;
}

function grupo(participantes) {
    return { participants: [{ ...CUENTA_EN_GRUPO }, ...participantes] };
}

// Socket falso con la forma de Baileys, incluido groupFetchAllParticipating
// ({ jid: metadata } de TODOS los grupos de la cuenta, autorizados o no).
function crearSock({ usuarioId = A, grupos = {}, lecturaFalla = null, lecturaTodosFalla = null } = {}) {

    const estado = { grupos: JSON.parse(JSON.stringify(grupos)), llamadas: [], lecturas: [], lecturasTodos: 0 };

    const copia = (g) => ({ id: g, participants: estado.grupos[g].participants.map(p => ({ ...p })) });

    const sock = {
        context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}` },
        user: CUENTA,
        vigente: true,
        estado,
        async groupMetadata(g) {
            estado.lecturas.push(g);
            if (lecturaFalla) { const e = lecturaFalla(g); if (e) throw e; }
            if (!estado.grupos[g]) throw new Error("item-not-found");
            return copia(g);
        },
        async groupFetchAllParticipating() {
            estado.lecturasTodos++;
            if (lecturaTodosFalla) { const e = lecturaTodosFalla(estado.lecturasTodos); if (e) throw e; }
            return Object.fromEntries(Object.keys(estado.grupos).map(g => [g, copia(g)]));
        },
        async groupParticipantsUpdate(g, jids, accion) {
            estado.llamadas.push({ g, jids, accion });
            estado.grupos[g].participants = estado.grupos[g].participants.filter(p => p.id !== jids[0]);
            return jids.map(j => ({ status: "200", jid: j }));
        }
    };

    sockets.set(usuarioId, sock);

    return sock;

}

// Reingreso SIN evento: la persona vuelve a la lista real y nadie avisa.
function reingresar(sock, g, persona = PERSONA) {
    sock.estado.grupos[g].participants.push({ ...persona });
}

function depsMotor({ real = true } = {}) {
    return {
        repo,
        registrarIntento: bloqueadosRepo.registrarIntentoExpulsion,
        obtenerSocket: u => sockets.get(u) || null,
        puedeActuar: s => !!s && s.vigente !== false,
        groupMetadata: (s, g) => s.groupMetadata(g),
        groupParticipantsUpdate: (s, g, p, a) => s.groupParticipantsUpdate(g, p, a),
        evaluarGrupo: politicaGrupos.evaluarGrupo,
        expulsionesReales: () => real,
        ahora
    };
}

function depsVigilancia({ real = true } = {}) {
    return {
        repo,
        listarBloqueados: bloqueadosRepo.listarBloqueados,
        puedeActuar: s => !!s && s.vigente !== false,
        groupFetchAllParticipating: s => s.groupFetchAllParticipating(),
        procesar: procesarPendientesDe,
        motor: depsMotor({ real }),
        ahora
    };
}

const configDe = (real) => ({ ...CONFIG, modo: real ? "real" : "simulacion" });

const correr = (usuarioId = A, { real = true } = {}) =>
    procesarPendientesDe(usuarioId, { config: configDe(real), deps: depsMotor({ real }) });

const vigilar = (usuarioId = A, { real = true, sock = sockets.get(usuarioId) } = {}) =>
    vigilarCliente(usuarioId, { sock, config: configDe(real), deps: depsVigilancia({ real }) });

function autorizar(usuarioId, grupos) {
    for (const g of grupos) {
        (fake.tablas.grupos_autorizados ||= []).push({ usuario_id: usuarioId, grupo_id: g, activo: true });
        (fake.tablas.grupos ||= []).push({ jid: g, nombre: `Grupo ${g.split("@")[0]}` });
    }
    politicaGrupos.olvidarAutorizacion();
}

// programar=false: bloqueo creado antes de la migración 040 (sin tareas).
async function escenario({ grupos = ["g1@g.us"], bloqueo = { telefono: TEL, lid: LID }, usuarioId = A, programar = true } = {}) {

    autorizar(usuarioId, grupos);

    const creado = await bloqueadosRepo.crearBloqueo({ usuarioId, ...bloqueo });
    assert.ok(creado.ok, JSON.stringify(creado));

    if (programar) {
        const programadas = await repo.programarExpulsiones({ usuarioId, bloqueado: creado.bloqueado });
        assert.ok(programadas.ok, JSON.stringify(programadas));
    }

    return { bloqueado: creado.bloqueado };

}

const tareasDe = (bloqueadoId) => (fake.tablas.bloqueo_expulsiones || []).filter(t => t.bloqueado_id === bloqueadoId);
const tareaDe = (bloqueadoId, g) => tareasDe(bloqueadoId).find(t => t.grupo_id === g);

const resultados = [];

async function prueba(nombre, fn) {
    reiniciar();
    const log = console.log, warn = console.warn, error = console.error;
    const capturado = [];
    console.log = console.warn = console.error = (...a) => capturado.push(a.join(" "));
    try {
        await fn();
        console.log = log; console.warn = warn; console.error = error;
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        console.log = log; console.warn = warn; console.error = error;
        resultados.push({ nombre, ok: false });
        console.log(`❌ ${nombre}\n   ${err.stack?.split("\n").slice(0, 3).join("\n   ")}`);
        if (capturado.length) console.log("   --- log ---\n   " + capturado.slice(-12).join("\n   "));
    }
}

async function main() {

    await prueba("V1. reingreso sin evento -> la vigilancia lo detecta, se vuelve a expulsar y verificar", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA, OTRO(1)]) } });

        await correr();
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "expulsado");

        // Revisión sin novedades: no reabre nada ni expulsa de nuevo.
        const tranquila = await vigilar();
        assert.strictEqual(tranquila.reabiertas, 0);
        assert.strictEqual(sock.estado.llamadas.length, 1);

        reingresar(sock, "g1@g.us");
        const r = await vigilar();

        assert.strictEqual(r.presentes, 1);
        assert.strictEqual(r.reabiertas, 1);
        const t = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t.estado, "expulsado", "expulsado otra vez y verificado");
        assert.strictEqual(t.origen, "reingreso");
        assert.strictEqual(sock.estado.llamadas.length, 2);
        assert.ok(!sock.estado.grupos["g1@g.us"].participants.some(p => p.id === LID));
        assert.ok(sock.estado.grupos["g1@g.us"].participants.some(p => p.id === OTRO(1).id), "nadie más sale del grupo");
    });

    await prueba("V2. bloqueos anteriores a la 040 (sin tareas) -> la vigilancia crea una tarea por grupo y se procesan", async () => {
        const grupos = ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"];
        const { bloqueado } = await escenario({ grupos, programar: false });
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]), "g2@g.us": grupo([PERSONA]), "g3@g.us": grupo([OTRO(1)]), "g4@g.us": grupo([PERSONA]) } });

        assert.strictEqual(tareasDe(bloqueado.id).length, 0);
        await vigilar();
        assert.strictEqual(tareasDe(bloqueado.id).length, 4);

        await correr();
        const estados = Object.fromEntries(grupos.map(g => [g, tareaDe(bloqueado.id, g).estado]));
        assert.deepStrictEqual(estados, { "g1@g.us": "expulsado", "g2@g.us": "expulsado", "g3@g.us": "ya_no_estaba", "g4@g.us": "expulsado" });
        assert.strictEqual(sock.estado.llamadas.length, 3);

        const r = repo.resumirTareas(tareasDe(bloqueado.id));
        assert.deepStrictEqual([r.total, r.expulsados, r.yaNoEstaban, r.resueltos], [4, 3, 1, 4]);
    });

    await prueba("V3. grupo autorizado después del bloqueo -> nueva tarea; los grupos ya verificados no se repiten", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });
        await correr();

        sock.estado.grupos["g2@g.us"] = grupo([PERSONA]);
        autorizar(A, ["g2@g.us"]);

        await vigilar();
        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g2@g.us").estado, "expulsado");
        assert.deepStrictEqual(sock.estado.llamadas.map(l => l.g), ["g1@g.us", "g2@g.us"]);
    });

    await prueba("V4. desbloqueado -> la vigilancia no lo vuelve a expulsar aunque reingrese", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });
        await correr();

        await bloqueadosRepo.desbloquear(bloqueado.id, A);
        await repo.cancelarDeBloqueo(A, bloqueado.id);
        reingresar(sock, "g1@g.us");

        const r = await vigilar();
        await correr();

        assert.strictEqual(r.activos, 0);
        assert.strictEqual(sock.estado.lecturasTodos, 0, "sin bloqueados activos no se consulta WhatsApp");
        assert.strictEqual(sock.estado.llamadas.length, 1);
    });

    await prueba("V5. desbloqueo mientras se leía el grupo -> cancelado justo antes de enviar, nada enviado", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({
            grupos: { "g1@g.us": grupo([PERSONA]) },
            lecturaFalla: () => { fake.tablas.bloqueados[0].activo = false; return null; }
        });

        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "cancelado");
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    await prueba("V6. desbloqueo antes del siguiente reintento -> el reintento no se ejecuta", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });
        sock.estado.grupos["g1@g.us"].participants[0].admin = null; // cuenta sin permisos

        await correr();
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "sin_permisos");
        assert.ok(tareaDe(bloqueado.id, "g1@g.us").proximo_intento_en);

        await bloqueadosRepo.desbloquear(bloqueado.id, A);
        await repo.cancelarDeBloqueo(A, bloqueado.id);
        sock.estado.grupos["g1@g.us"].participants[0].admin = "admin";

        desplazamientoMs = 3600 * 1000;
        await correr();
        await vigilar();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "cancelado");
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    await prueba("V7. aislamiento: solo grupos autorizados del cliente; nunca con la sesión de otro cliente", async () => {
        const { bloqueado } = await escenario();
        await escenario({ usuarioId: B, grupos: ["gB@g.us"], bloqueo: { telefono: "3009998877" } });

        // La cuenta de A también está en un grupo NO autorizado (y en el de B)
        // donde aparece la persona: no se toca.
        const sockA = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]), "libre@g.us": grupo([PERSONA]), "gB@g.us": grupo([PERSONA]) } });
        await correr();
        await vigilar();

        assert.deepStrictEqual(sockA.estado.llamadas.map(l => l.g), ["g1@g.us"]);
        assert.ok(!tareasDe(bloqueado.id).some(t => t.grupo_id !== "g1@g.us"));

        // Vigilancia de B ejecutada por error con el socket de A: no actúa.
        const r = await vigilar(B, { sock: sockA });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.motivo, "sin_sesion");
        assert.strictEqual(sockA.estado.llamadas.length, 1);
    });

    await prueba("V8. simulación -> la vigilancia no reabre en bucle a quien sigue dentro", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });

        await correr(A, { real: false });
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "simulado");

        const r1 = await vigilar(A, { real: false });
        const r2 = await vigilar(A, { real: false });
        assert.strictEqual(r1.presentes, 1);
        assert.strictEqual(r1.reabiertas + r2.reabiertas, 0);
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").intentos, 1);
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    await prueba("V9. teléfono parecido o compartido -> identidad dudosa: no se reabre ni se expulsa a nadie", async () => {
        const { bloqueado } = await escenario({ bloqueo: { telefono: TEL } });
        const parecido = { id: "777@lid", phoneNumber: "573001112234@s.whatsapp.net", admin: null };
        const sock = crearSock({ grupos: { "g1@g.us": grupo([parecido]) } });

        await correr();
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "ya_no_estaba", "un número parecido no es la persona");

        // Dos participantes con el mismo teléfono: ambiguo.
        reingresar(sock, "g1@g.us", { id: "888@lid", phoneNumber: "573001112233@s.whatsapp.net", admin: null });
        reingresar(sock, "g1@g.us", { id: "889@lid", phoneNumber: "573001112233@s.whatsapp.net", admin: null });
        const r = await vigilar();

        assert.strictEqual(r.reabiertas, 0);
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    await prueba("V10. dos vigilancias a la vez sobre el mismo reingreso -> una sola expulsión", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });
        await correr();
        reingresar(sock, "g1@g.us");

        await Promise.all([vigilar(), vigilar()]);
        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "expulsado");
        assert.strictEqual(sock.estado.llamadas.length, 2, "1 original + 1 por el reingreso");
    });

    await prueba("V11. worker: vigilancia cada intervalo; si WhatsApp falla, espera x2 hasta el tope y se recupera", async () => {
        await escenario();
        let fallar = true;
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) }, lecturaTodosFalla: () => (fallar ? new Error("timed out") : null) });
        const estado = { proxima: 0, fallos: 0 };
        const opciones = (ms) => ({ config: CONFIG, deps: depsMotor(), depsVigilancia: depsVigilancia(), estadoVigilancia: estado, ahoraMs: ms });

        let t = 1000000;
        await tick(sock, opciones(t));
        assert.strictEqual(estado.fallos, 1);
        assert.strictEqual(estado.proxima - t, 120000);

        // Antes de su turno no se vuelve a consultar.
        await tick(sock, opciones(t + 30000));
        assert.strictEqual(sock.estado.lecturasTodos, 1);

        for (let i = 0; i < 5; i++) { t = estado.proxima; await tick(sock, opciones(t)); }
        assert.strictEqual(estado.proxima - t, 600000, "tope de 10 min");

        fallar = false;
        t = estado.proxima;
        const r = await tick(sock, opciones(t));
        assert.strictEqual(r.vigilancia.ok, true);
        assert.strictEqual(estado.fallos, 0);
        assert.strictEqual(estado.proxima - t, 60000);
    });

    await prueba("V12. sesión desconectada -> no se consulta WhatsApp ni se espacia la revisión", async () => {
        await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });
        sock.vigente = false;

        const r = await vigilar();
        assert.strictEqual(r.motivo, "sin_sesion");
        assert.strictEqual(sock.estado.lecturasTodos, 0);
    });

    await prueba("V13. reintentos agotados -> sigue a ritmo lento y, al darle permisos, se completa solo", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });
        sock.estado.grupos["g1@g.us"].participants[0].admin = null;

        for (let i = 0; i < 4; i++) { await correr(); desplazamientoMs += 700000; }
        const t = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t.estado, "sin_permisos");
        assert.ok(t.proximo_intento_en, "nunca queda sin próximo intento mientras siga bloqueado");

        sock.estado.grupos["g1@g.us"].participants[0].admin = "admin";
        await correr();
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "expulsado");
    });

    await prueba("configuración: vigilancia 60 s por defecto, mínimo 30 s; espera x2 con tope", async () => {
        delete process.env.BLOQUEO_VIGILANCIA_INTERVALO_MS;
        assert.strictEqual(leerConfigExpulsiones().vigilanciaMs, 60000);
        process.env.BLOQUEO_VIGILANCIA_INTERVALO_MS = "5000";
        assert.strictEqual(leerConfigExpulsiones().vigilanciaMs, 60000, "por debajo del mínimo: valor por defecto");
        process.env.BLOQUEO_VIGILANCIA_INTERVALO_MS = "30000";
        assert.strictEqual(leerConfigExpulsiones().vigilanciaMs, 30000);
        delete process.env.BLOQUEO_VIGILANCIA_INTERVALO_MS;
        assert.deepStrictEqual([0, 1, 2, 9].map(f => esperaVigilancia(f, CONFIG)), [60000, 120000, 240000, 600000]);
    });

    const fallidas = resultados.filter(r => !r.ok);
    console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas OK (simuladas: sin Supabase real ni WhatsApp real)`);
    if (fallidas.length) process.exitCode = 1;

}

main();
