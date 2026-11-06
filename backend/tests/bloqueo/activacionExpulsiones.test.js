// ==========================================================================
// PRUEBAS SIMULADAS — preparación para activar la expulsión de bloqueados.
//
// 1. Reproduce el estado real de producción visto el 06/11/2026 (solo la
//    FORMA, con datos inventados): 4 bloqueos activos de un cliente, todos
//    con LID, uno de ellos sin teléfono; solo uno tiene tareas (creadas el
//    30/10 y nunca procesadas); 4 grupos autorizados activos + 1 inactivo.
//    Recorre la activación prevista: simulación -> real -> sin duplicados.
// 2. Cubre las dos correcciones del motor (procesarExpulsion.js):
//    - identidad «no comparable» (el grupo no expone el tipo de
//      identificador del bloqueo) se completa con "usuarios" (solo lectura);
//    - si aun así no se puede comparar, queda «identidad_ambigua» CON
//      reintento automático; una ambigüedad real sigue siendo final.
//
// Todo en memoria: Supabase falso y sockets de WhatsApp falsos. NINGUNA
// prueba consulta ni modifica producción ni envía nada a WhatsApp.
//
//     node backend/tests/bloqueo/activacionExpulsiones.test.js
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

const repo = require(ruta("bot/funciones/bloqueo/expulsionesRepo.js"));
const bloqueadosRepo = require(ruta("bot/funciones/bloqueo/bloqueadosRepo.js"));
const { procesarPendientesDe } = require(ruta("bot/funciones/bloqueo/procesarExpulsion.js"));
const { vigilarCliente } = require(ruta("bot/funciones/bloqueo/vigilanciaBloqueados.js"));
const bloqueoActivo = require(ruta("bot/funciones/bloqueo/bloqueoActivo.js"));
const politicaGrupos = require(ruta("bot/funciones/grupos/politicaGrupos.js"));
const { resolverIdentidadExistente } = require(ruta("bot/funciones/usuarios/obtenerUsuarioGlobal.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

const CUENTA = { id: "573000000000:7@s.whatsapp.net", lid: "999000:7@lid" };
const CUENTA_EN_GRUPO = { id: "999000@lid", phoneNumber: "573000000000@s.whatsapp.net", admin: "admin" };

const CONFIG = { leaseSegundos: 120, maxIntentos: 3, esperaBaseMs: 60000, esperaMaxMs: 600000, lote: 50, vigilanciaMs: 60000 };

let desplazamientoMs = 0;
const ahora = () => new Date(Date.now() + desplazamientoMs);

function reiniciar() {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    sockets.clear();
    politicaGrupos.olvidarAutorizacion();
    bloqueoActivo.olvidarBloqueos();
    desplazamientoMs = 0;
}

const grupo = (participantes) => ({ participants: [{ ...CUENTA_EN_GRUPO }, ...participantes] });

function crearSock({ usuarioId = A, grupos = {} } = {}) {

    const estado = { grupos: JSON.parse(JSON.stringify(grupos)), llamadas: [], lecturas: [] };
    const copia = (g) => ({ id: g, participants: estado.grupos[g].participants.map(p => ({ ...p })) });

    const sock = {
        context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}` },
        user: CUENTA,
        vigente: true,
        estado,
        async groupMetadata(g) {
            estado.lecturas.push(g);
            if (!estado.grupos[g]) throw new Error("item-not-found");
            return copia(g);
        },
        async groupFetchAllParticipating() {
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

function depsMotor({ real = true, conUsuarios = true } = {}) {
    return {
        repo,
        registrarIntento: bloqueadosRepo.registrarIntentoExpulsion,
        obtenerSocket: u => sockets.get(u) || null,
        puedeActuar: s => !!s && s.vigente !== false,
        groupMetadata: (s, g) => s.groupMetadata(g),
        groupParticipantsUpdate: (s, g, p, a) => s.groupParticipantsUpdate(g, p, a),
        evaluarGrupo: politicaGrupos.evaluarGrupo,
        expulsionesReales: () => real,
        ...(conUsuarios ? { resolverIdentidad: resolverIdentidadExistente } : {}),
        ahora
    };
}

const correr = (usuarioId = A, { real = true, conUsuarios = true } = {}) =>
    procesarPendientesDe(usuarioId, { config: { ...CONFIG, modo: real ? "real" : "simulacion" }, deps: depsMotor({ real, conUsuarios }) });

const vigilar = (usuarioId = A, { real = true } = {}) =>
    vigilarCliente(usuarioId, {
        sock: sockets.get(usuarioId),
        config: { ...CONFIG, modo: real ? "real" : "simulacion" },
        deps: {
            repo,
            listarBloqueados: bloqueadosRepo.listarBloqueados,
            puedeActuar: s => !!s && s.vigente !== false,
            groupFetchAllParticipating: s => s.groupFetchAllParticipating(),
            procesar: procesarPendientesDe,
            motor: depsMotor({ real }),
            ahora
        }
    });

function autorizar(usuarioId, grupos, { activo = true } = {}) {
    for (const g of grupos) {
        (fake.tablas.grupos_autorizados ||= []).push({ usuario_id: usuarioId, grupo_id: g, activo });
        (fake.tablas.grupos ||= []).push({ jid: g, nombre: `Grupo ${g.split("@")[0]}` });
    }
}

async function bloquear(usuarioId, datos, { programar = true } = {}) {
    const creado = await bloqueadosRepo.crearBloqueo({ usuarioId, ...datos });
    assert.ok(creado.ok, JSON.stringify(creado));
    if (programar) assert.ok((await repo.programarExpulsiones({ usuarioId, bloqueado: creado.bloqueado })).ok);
    return creado.bloqueado;
}

const tareasDe = (bloqueadoId) => (fake.tablas.bloqueo_expulsiones || []).filter(t => t.bloqueado_id === bloqueadoId);
const tareaDe = (bloqueadoId, g) => tareasDe(bloqueadoId).find(t => t.grupo_id === g);
const intentosDe = (bloqueadoId) => (fake.tablas.bloqueo_intentos || []).filter(i => i.bloqueado_id === bloqueadoId);

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

    // ------------------------------------------------------------------ P1
    await prueba("P1. forma de producción: 4 bloqueos (3 sin tareas) -> simulación sin enviar nada, real expulsa una vez por grupo, sin duplicados", async () => {
        const G = ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"];
        autorizar(A, G);
        autorizar(A, ["g0@g.us"], { activo: false }); // autorizado antes, hoy inactivo

        // Persona 4: solo LID en el bloqueo; el grupo la muestra por teléfono
        // y "usuarios" conoce su teléfono.
        (fake.tablas.usuarios ||= []).push({ id: "u4", lid: "400@lid", telefono: "3004000004" });

        const p = [
            { lid: "100@lid", tel: "3001000001" },
            { lid: "200@lid", tel: "3002000002" },
            { lid: "400@lid", tel: null },
            { lid: "300@lid", tel: "3003000003" }
        ];
        const b1 = await bloquear(A, { telefono: p[0].tel, lid: p[0].lid }, { programar: false });
        const b2 = await bloquear(A, { telefono: p[1].tel, lid: p[1].lid }, { programar: false });
        const b3 = await bloquear(A, { lid: p[2].lid }, { programar: false });
        const b4 = await bloquear(A, { telefono: p[3].tel, lid: p[3].lid }); // el único con tareas

        assert.deepStrictEqual([b1, b2, b3, b4].map(b => tareasDe(b.id).length), [0, 0, 0, 4]);

        // g1: los cuatro (persona 3 solo por teléfono: grupo en modo teléfono).
        // g2: personas 1 y 4. g3: nadie. g4: persona 2.
        const persona = (i, { soloTelefono = false } = {}) => soloTelefono
            ? { id: `57${["3001000001", "3002000002", "3004000004", "3003000003"][i]}@s.whatsapp.net`, admin: null }
            : { id: p[i].lid, phoneNumber: p[i].tel ? `57${p[i].tel}@s.whatsapp.net` : undefined, admin: null };

        const sock = crearSock({ grupos: {
            "g1@g.us": grupo([persona(0), persona(1), persona(2, { soloTelefono: true }), persona(3)]),
            "g2@g.us": grupo([persona(0), persona(3)]),
            "g3@g.us": grupo([{ id: "777@lid", phoneNumber: "573109999999@s.whatsapp.net", admin: null }]),
            "g4@g.us": grupo([persona(1)]),
            "g0@g.us": grupo([persona(0)]) // grupo NO autorizado: jamás se toca
        } });

        // Activación en SIMULACIÓN: la vigilancia crea las 12 tareas que faltan.
        await vigilar(A, { real: false });
        assert.deepStrictEqual([b1, b2, b3, b4].map(b => tareasDe(b.id).length), [4, 4, 4, 4]);
        assert.ok(!(fake.tablas.bloqueo_expulsiones || []).some(t => t.grupo_id === "g0@g.us"), "sin tareas en el grupo inactivo");

        await correr(A, { real: false });
        assert.strictEqual(sock.estado.llamadas.length, 0, "simulación: nada enviado a WhatsApp");
        assert.strictEqual(tareaDe(b3.id, "g1@g.us").estado, "simulado", "persona solo-LID localizada por teléfono gracias a usuarios");
        assert.strictEqual(tareaDe(b3.id, "g1@g.us").criterio_identidad, "telefono_usuarios");
        assert.strictEqual(tareaDe(b1.id, "g3@g.us").estado, "ya_no_estaba");

        // Activación REAL: se procesan las simuladas, una vez cada una.
        await correr(A, { real: true });
        const esperadas = [
            [b1.id, "g1@g.us", p[0].lid], [b1.id, "g2@g.us", p[0].lid],
            [b2.id, "g1@g.us", p[1].lid], [b2.id, "g4@g.us", p[1].lid],
            [b3.id, "g1@g.us", "573004000004@s.whatsapp.net"],
            [b4.id, "g1@g.us", p[3].lid], [b4.id, "g2@g.us", p[3].lid]
        ];
        for (const [id, g] of esperadas) assert.strictEqual(tareaDe(id, g).estado, "expulsado", `${id.slice(0, 6)} en ${g}`);
        const enviados = sock.estado.llamadas.map(l => `${l.g}|${l.jids[0]}`).sort();
        assert.deepStrictEqual(enviados, esperadas.map(([, g, j]) => `${g}|${j}`).sort(), "una expulsión exacta por (persona, grupo)");
        assert.ok(!sock.estado.llamadas.some(l => l.g === "g0@g.us"));

        // Segunda pasada y segunda vigilancia: nada nuevo.
        await correr(A, { real: true });
        await vigilar(A, { real: true });
        assert.strictEqual(sock.estado.llamadas.length, esperadas.length, "sin expulsiones duplicadas");

        // Historial: cada expulsión con su resultado y modo real.
        const reales = (fake.tablas.bloqueo_intentos || []).filter(i => i.resultado === "expulsado");
        assert.strictEqual(reales.length, esperadas.length);
        assert.ok(reales.every(i => i.modo === "real"));
    });

    // ------------------------------------------------------------------ P2
    await prueba("P2. aislamiento: los bloqueos de A nunca generan tareas ni expulsiones en grupos o con la sesión de B", async () => {
        autorizar(A, ["ga@g.us"]);
        autorizar(B, ["gb@g.us"]);
        const persona = { id: "100@lid", phoneNumber: "573001000001@s.whatsapp.net", admin: null };
        const bA = await bloquear(A, { telefono: "3001000001", lid: "100@lid" });

        const sockA = crearSock({ usuarioId: A, grupos: { "ga@g.us": grupo([persona]) } });
        const sockB = crearSock({ usuarioId: B, grupos: { "gb@g.us": grupo([persona]), "ga@g.us": grupo([persona]) } });

        await vigilar(B);
        await correr(B);
        assert.strictEqual(sockB.estado.llamadas.length, 0, "B no tiene bloqueos: no expulsa a nadie");

        await correr(A);
        assert.deepStrictEqual(tareasDe(bA.id).map(t => t.grupo_id), ["ga@g.us"]);
        assert.strictEqual(tareaDe(bA.id, "ga@g.us").estado, "expulsado");
        assert.strictEqual(sockA.estado.llamadas.length, 1);
        assert.strictEqual(sockB.estado.llamadas.length, 0, "nunca con la sesión de B");
        assert.ok(sockB.estado.grupos["gb@g.us"].participants.some(p => p.id === "100@lid"), "sigue en el grupo de B");
    });

    // ------------------------------------------------------------------ P3
    await prueba("P3. identidad no comparable y sin datos en usuarios -> identidad_ambigua CON reintento; al completarse usuarios se expulsa", async () => {
        autorizar(A, ["g1@g.us"]);
        const b = await bloquear(A, { lid: "500@lid" }); // solo LID
        const sock = crearSock({ grupos: { "g1@g.us": grupo([{ id: "573005000005@s.whatsapp.net", admin: null }]) } });

        await correr(A);
        const t = tareaDe(b.id, "g1@g.us");
        assert.strictEqual(t.estado, "identidad_ambigua");
        assert.match(t.ultimo_error, /no se pudo comparar/);
        assert.ok(t.proximo_intento_en, "tiene reintento programado");
        assert.strictEqual(intentosDe(b.id).length, 1, "queda en el historial, no se oculta");
        assert.strictEqual(sock.estado.llamadas.length, 0);

        // Antes de su turno no se reprocesa.
        const lecturas = sock.estado.lecturas.length;
        await correr(A);
        assert.strictEqual(sock.estado.lecturas.length, lecturas);

        // "usuarios" aprende el teléfono (p. ej. la persona escribió al bot).
        (fake.tablas.usuarios ||= []).push({ id: "u5", lid: "500@lid", telefono: "3005000005" });
        desplazamientoMs = 10 * 60 * 1000;
        await correr(A);
        assert.strictEqual(tareaDe(b.id, "g1@g.us").estado, "expulsado");
        assert.deepStrictEqual(sock.estado.llamadas.map(l => l.jids[0]), ["573005000005@s.whatsapp.net"]);
    });

    // ------------------------------------------------------------------ P4
    await prueba("P4. ambigüedad real (dos participantes con el mismo teléfono) sigue siendo final: sin reintento ni expulsión", async () => {
        autorizar(A, ["g1@g.us"]);
        const b = await bloquear(A, { telefono: "3006000006" });
        const sock = crearSock({ grupos: { "g1@g.us": grupo([
            { id: "61@lid", phoneNumber: "573006000006@s.whatsapp.net", admin: null },
            { id: "62@lid", phoneNumber: "573006000006:2@s.whatsapp.net", admin: null }
        ]) } });

        await correr(A);
        const t = tareaDe(b.id, "g1@g.us");
        assert.strictEqual(t.estado, "identidad_ambigua");
        assert.strictEqual(t.proximo_intento_en, null);

        desplazamientoMs = 24 * 60 * 60 * 1000;
        const lecturas = sock.estado.lecturas.length;
        await correr(A);
        assert.strictEqual(sock.estado.lecturas.length, lecturas, "no se reprocesa sola");
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    // ------------------------------------------------------------------ P5
    await prueba("P5. usuarios en conflicto (LID repetido) -> no se completa la identidad ni se expulsa", async () => {
        autorizar(A, ["g1@g.us"]);
        const b = await bloquear(A, { lid: "700@lid" });
        (fake.tablas.usuarios ||= []).push({ id: "u7a", lid: "700@lid", telefono: "3007000007" }, { id: "u7b", lid: "700@lid", telefono: "3007000008" });
        const sock = crearSock({ grupos: { "g1@g.us": grupo([{ id: "573007000007@s.whatsapp.net", admin: null }]) } });

        await correr(A);
        assert.strictEqual(tareaDe(b.id, "g1@g.us").estado, "identidad_ambigua");
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    // ------------------------------------------------------------------ P6
    await prueba("P6. sin el cruce con usuarios (dependencia ausente) el comportamiento previo no cambia", async () => {
        autorizar(A, ["g1@g.us"]);
        (fake.tablas.usuarios ||= []).push({ id: "u8", lid: "800@lid", telefono: "3008000008" });
        const b = await bloquear(A, { lid: "800@lid" });
        const sock = crearSock({ grupos: { "g1@g.us": grupo([{ id: "573008000008@s.whatsapp.net", admin: null }]) } });

        await correr(A, { conUsuarios: false });
        assert.strictEqual(tareaDe(b.id, "g1@g.us").estado, "identidad_ambigua");
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    const fallidas = resultados.filter(r => !r.ok);
    console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas OK (simuladas: sin Supabase real ni WhatsApp real)`);
    if (fallidas.length) process.exitCode = 1;

}

main();
