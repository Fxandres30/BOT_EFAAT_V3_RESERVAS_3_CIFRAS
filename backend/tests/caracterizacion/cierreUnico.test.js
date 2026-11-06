// ==========================================================================
// CARACTERIZACIÓN C4: un solo aviso de cierre aunque los DOS emisores
// trabajen a la vez.
//
// Hoy hay dos motores que pueden anunciar el cierre de un evento:
//   - automation/scheduler.js   CLOSE_MESSAGE general del grupo
//   - sorteos/publicador.js     aviso_cierre propio del sorteo del panel
// Los coordina prioridadComunicaciones.js (fuente determinista + comprobación
// cruzada). tests/automation/motorEventosUnico.test.js ya prueba el orden
// «publicador y luego scheduler». Aquí se fija lo que falta: los dos en el
// MISMO instante (Promise.all) y en orden invertido, con y sin aviso propio.
// F7 (un solo motor de recordatorios) debe conservar exactamente esto.
//
//     node backend/tests/caracterizacion/cierreUnico.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const G = "g1@g.us";
const DESPUES = new Date("2026-10-22T13:05:00Z");
const { sendMessage } = require(path.resolve(__dirname, "../../services/baileys/send.js"));
const AVISO_PROPIO = "🔒 Cerrado — aviso propio del sorteo";

const cerrarTodo = () => { for (const e of h.estado.fake.tablas.eventos_bot) Object.assign(e, { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" }); };
const tickPublicador = (ahora) => h.silencio(() => h.publicador.tick(h.sock(), { ahora, deps: h.deps({ sendMessage }) }));
const tickScheduler = (ahora) => h.silencio(() => h.scheduler.tick(h.sock(), { ahora }));

const ORDENES = {
    simultaneo: (t) => Promise.all([tickPublicador(t), tickScheduler(t)]),
    scheduler_primero: async (t) => { await tickScheduler(t); await tickPublicador(t); }
};

async function prepararYCerrar({ avisoPropio, orden }) {
    h.escenario();
    await h.programar(h.entrada(avisoPropio ? { mensajes: { publicacion: "", aviso_cierre: AVISO_PROPIO } } : {}));
    await h.tick(h.EN_PUBLICACION);
    assert.strictEqual(h.aperturas(G).length, 1, "publicado y abierto antes del cierre");
    cerrarTodo();
    // Dos ciclos seguidos: el segundo nunca repite.
    await ORDENES[orden](DESPUES);
    await ORDENES[orden](new Date(DESPUES.getTime() + 30000));
    await h.silencio(h.drenar);
    return h.cierres(G);
}

for (const orden of Object.keys(ORDENES)) {
    prueba(`${orden}, con aviso propio del sorteo → sale SOLO el del sorteo, una vez`, async () => {
        const cierres = await prepararYCerrar({ avisoPropio: true, orden });
        assert.strictEqual(cierres.length, 1, `un aviso de cierre (hay ${cierres.length})`);
        assert.ok(cierres[0].texto.startsWith(AVISO_PROPIO), cierres[0].texto);
        assert.strictEqual(h.estado.fake.tablas.automation_actions.filter(a => a.tipo_accion === "CLOSE_MESSAGE").length, 0, "el del grupo ni se intenta");
        assert.strictEqual(h.sesionesDe(G)[0].estado, "cerrado", "ciclo cerrado");
    });
    prueba(`${orden}, sin aviso propio → sale SOLO el general del grupo, una vez`, async () => {
        const cierres = await prepararYCerrar({ avisoPropio: false, orden });
        assert.strictEqual(cierres.length, 1, `un aviso de cierre (hay ${cierres.length})`);
        assert.ok(cierres[0].texto.startsWith("🔒 Cerrado: Antioqueñita"), cierres[0].texto);
        assert.strictEqual(h.estado.fake.tablas.automation_actions.filter(a => a.tipo_accion === "SORTEO_AVISO_CIERRE").length, 0, "el del sorteo ni se intenta");
        assert.strictEqual(h.sesionesDe(G)[0].estado, "cerrado", "ciclo cerrado");
    });
}

ejecutar("CARACTERIZACIÓN C4 · un solo aviso de cierre con dos emisores").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
