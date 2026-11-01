// ==========================================================================
// PRUEBAS — cierre automático con FECHA Y HORA completas (31/10/2026).
//
// Antes verificarHoraCierre comparaba solo la hora del día: un sorteo de un
// día anterior que no se cerró a su hora (proceso desconectado) seguía
// abierto, aceptando reservas, hasta que el reloj volvía a pasar esa hora.
//
// Reales: verificarHoraCierre.js, procesarSorteo.js, cerrarEvento.js,
// workerEventos.js, estadosGestion.js. Simulados: Supabase (en memoria), el
// cierre del grupo en WhatsApp, la lectura de la tabla y la autorización.
//
//     node backend/tests/eventos/cierreRecuperado.test.js
// ==========================================================================

// Zona del servidor deliberadamente DISTINTA de Colombia: el resultado no
// puede depender de ella.
process.env.TZ = "Asia/Tokyo";

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (p, e) => { require.cache[r(p)] = { id: r(p), filename: r(p), loaded: true, exports: e }; };

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");
const fake = crearFake();
inyectar("lib/supabase.js", fake.client);

// WhatsApp: registra cada cierre de grupo; un gancho permite simular que la
// administración actuó mientras WhatsApp respondía.
const whatsapp = { cierres: [], durante: null, fallos: 0 };
inyectar("bot/funciones/eventos/grupos/cerrarGrupo.js", {
    cerrarGrupo: async () => true,
    cerrarGrupoDetallado: async ({ grupoId }) => {
        if (whatsapp.fallos > 0) { whatsapp.fallos--; return { ok: false, error: "rate-overlimit" }; }
        whatsapp.cierres.push(grupoId);
        if (whatsapp.durante) whatsapp.durante(grupoId);
        return { ok: true };
    }
});
inyectar("bot/funciones/eventos/sorteoReal.js", {
    estadoDelSorteo: async () => ({ ok: true, completo: false, reservados: 0, pagados: 0, libres: 100 }),
    claveSorteo: (e) => (e.identidad_evento_real ? `${e.usuario_id}::${e.identidad_evento_real}` : `evento::${e.id}`)
});
inyectar("bot/funciones/reservas/actualizarEvento.js", { sincronizarContadores: async () => true });
inyectar("bot/funciones/grupos/politicaGrupos.js", { gruposAutorizadosDe: async () => new Set(["g1@g.us", "g2@g.us", "g3@g.us"]) });
inyectar("bot/funciones/eventos/grupos/reconciliarApertura.js", { reconciliarAperturaGrupo: async () => ({ resultado: "sin_cambios" }) });
inyectar("bot/funciones/usuarios/escanerIdentidadesLifecycle.js", { escanearGrupo: async () => {} });

const { verificarHoraCierre, cierreAtrasado } = require(r("bot/funciones/eventos/lifecycle/verificarHoraCierre.js"));
const { procesarSorteo } = require(r("bot/funciones/eventos/lifecycle/procesarSorteo.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const { cierreSilencioso, finDelEvento } = require(r("shared/eventos/estadosGestion.js"));

// Hora de Colombia (UTC-5, sin horario de verano).
const co = (fechaHora) => new Date(`${fechaHora}:00-05:00`);
const AHORA = co("2026-10-31T08:00");
const TENANT = "tenant-cierre";

function fila(id, extra = {}) {
    return {
        id, usuario_id: TENANT, grupo_id: "g1@g.us", activo: true, abierto: true, estado: "abierto",
        identidad_evento_real: `id-${id}`, nombre_evento: id, tabla: "t", fecha_evento: "2026-10-31",
        hora_fin: "22:30", hora_cierre: "22:26", cierre_intentos: 0, ...extra
    };
}

function sembrar(filas) {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.tablas.eventos_bot = filas;
    whatsapp.cierres = [];
    whatsapp.durante = null;
    whatsapp.fallos = 0;
}

// «Reinicio» del proceso: se descargan los módulos del cierre (estado en
// memoria incluido) y se vuelven a cargar. Los dobles de arriba se conservan.
function workerReiniciado() {
    for (const rel of ["bot/funciones/eventos/workers/workerEventos.js", "bot/funciones/eventos/lifecycle/procesarSorteo.js", "bot/funciones/eventos/lifecycle/cerrarEvento.js", "bot/funciones/eventos/lifecycle/verificarHoraCierre.js"]) {
        delete require.cache[r(rel)];
    }
    return require(r("bot/funciones/eventos/workers/workerEventos.js")).workerEventos;
}

const fila$ = (id) => fake.tablas.eventos_bot.find(e => e.id === id);
const sock = { context: { usuarioId: TENANT, sessionId: "s1" } };

const resultados = [];
async function test(nombre, fn) {
    const log = console.log, dir = console.dir;
    console.log = () => {}; console.dir = () => {};
    try {
        await fn();
        console.log = log; console.dir = dir;
        resultados.push(true);
        console.log(`✅ ${nombre}`);
    } catch (err) {
        console.log = log; console.dir = dir;
        resultados.push(false);
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);
    }
}

(async () => {

    await test("1. fecha y hora completas en hora de Colombia, sin importar la zona del servidor", async () => {
        const ev = { fecha_evento: "2026-10-30", hora_cierre: "22:26" };
        assert.strictEqual(verificarHoraCierre(ev, co("2026-10-30T22:25")), false);
        assert.strictEqual(verificarHoraCierre(ev, co("2026-10-30T22:26")), true);
        // El error: al día siguiente antes de las 22:26 seguía «abierto».
        assert.strictEqual(verificarHoraCierre(ev, co("2026-10-31T08:00")), true, "sorteo de ayer: cerrado");
        assert.strictEqual(verificarHoraCierre({ ...ev, hora_cierre: "22:26:00" }, co("2026-10-30T22:26")), true, "hora con segundos (time de Postgres)");
    });

    await test("2. sorteos futuros nunca se cierran antes de tiempo (mañana, fin de mes, cierre de madrugada)", async () => {
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-11-01", hora_cierre: "09:56" }, co("2026-10-31T23:59")), false);
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-11-01", hora_cierre: "00:20" }, co("2026-10-31T23:30")), false, "cierre después de medianoche");
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-11-01", hora_cierre: "00:20" }, co("2026-11-01T00:20")), true);
    });

    await test("3. sin hora o con hora inválida: no se cierra por hora; sin fecha: la hora de hoy (como siempre)", async () => {
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-10-30" }, AHORA), false);
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-10-30", hora_cierre: "25:99" }, AHORA), false);
        assert.strictEqual(verificarHoraCierre({ hora_cierre: "07:59" }, AHORA), true);
        assert.strictEqual(verificarHoraCierre({ hora_cierre: "08:01" }, AHORA), false);
    });

    await test("4. cierreAtrasado: solo si su cierre fue un día anterior", async () => {
        assert.strictEqual(cierreAtrasado({ fecha_evento: "2026-10-30", hora_cierre: "22:26" }, AHORA), true);
        assert.strictEqual(cierreAtrasado({ fecha_evento: "2026-10-31", hora_cierre: "07:00" }, AHORA), false);
        assert.strictEqual(cierreAtrasado({ fecha_evento: "2026-11-01", hora_cierre: "07:00" }, AHORA), false);
    });

    await test("5. RECUPERA el cierre pendiente de ayer: cierra el grupo, marca la fila «recuperado» y sin aviso tardío", async () => {
        sembrar([fila("ayer", { fecha_evento: "2026-10-30" })]);
        await workerEventos(sock, { ahora: AHORA });
        const f = fila$("ayer");
        assert.strictEqual(f.activo, false);
        assert.strictEqual(f.estado, "cerrado");
        assert.strictEqual(f.cierre_estado, "cerrado");
        assert.match(f.cierre_motivo, /^hora \(recuperado: cierre pendiente del 2026-10-30\)/);
        assert.deepStrictEqual(whatsapp.cierres, ["g1@g.us"]);
        assert.strictEqual(cierreSilencioso(f), true, "el aviso de cierre de ayer no se envía hoy");
    });

    await test("6. un cierre normal (a su hora, mismo día) se sigue anunciando", async () => {
        sembrar([fila("hoy", { hora_cierre: "07:30" })]);
        await workerEventos(sock, { ahora: AHORA });
        const f = fila$("hoy");
        assert.strictEqual(f.activo, false);
        assert.strictEqual(f.cierre_motivo, "hora");
        assert.strictEqual(cierreSilencioso(f), false);
    });

    await test("7. recuperación con OTRO sorteo vigente en el mismo grupo: se marca la fila, el grupo de WhatsApp NO se cierra", async () => {
        sembrar([fila("ayer", { fecha_evento: "2026-10-30" }), fila("nuevo")]);
        const nuevoAntes = JSON.stringify(fila$("nuevo"));
        await workerEventos(sock, { ahora: AHORA });
        assert.strictEqual(fila$("ayer").activo, false);
        assert.match(fila$("ayer").cierre_motivo, /grupo en uso por otro sorteo/);
        assert.deepStrictEqual(whatsapp.cierres, [], "el grupo sigue abierto para el sorteo nuevo");
        assert.strictEqual(JSON.stringify(fila$("nuevo")), nuevoAntes, "el sorteo nuevo no se toca");
    });

    await test("8. sorteo futuro (mañana) en el worker: ni se cierra ni se escribe", async () => {
        sembrar([fila("manana", { fecha_evento: "2026-11-01", hora_cierre: "07:00" })]);
        const antes = JSON.stringify(fake.tablas.eventos_bot);
        await workerEventos(sock, { ahora: AHORA });
        assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes);
        assert.deepStrictEqual(whatsapp.cierres, []);
    });

    await test("9. nunca se cierra dos veces: el segundo ciclo no toca WhatsApp ni reescribe la fila", async () => {
        sembrar([fila("ayer", { fecha_evento: "2026-10-30" })]);
        await workerEventos(sock, { ahora: AHORA });
        const cerrada = JSON.stringify(fila$("ayer"));
        await workerEventos(sock, { ahora: AHORA });
        assert.deepStrictEqual(whatsapp.cierres, ["g1@g.us"]);
        assert.strictEqual(JSON.stringify(fila$("ayer")), cerrada);
    });

    await test("10. respeta cerrado/cancelado/desactivado aunque un reintento antiguo dejara activo=true", async () => {
        sembrar([
            fila("zombi", { fecha_evento: "2026-10-29", cierre_estado: "cerrado", cierre_motivo: "hora" }),
            fila("cancelado", { fecha_evento: "2026-10-29", estado: "cancelado", grupo_id: "g2@g.us" }),
            fila("desactivado", { fecha_evento: "2026-10-29", cierre_motivo: "panel:desactivado", grupo_id: "g3@g.us" })
        ]);
        const antes = JSON.stringify(fake.tablas.eventos_bot);
        await workerEventos(sock, { ahora: AHORA });
        assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes, "ninguna fila terminada se reescribe");
        assert.deepStrictEqual(whatsapp.cierres, [], "ni se cierra su grupo (puede ser ya de otro sorteo)");
        assert.ok(fake.tablas.eventos_bot.every(e => finDelEvento(e)));
    });

    await test("11. carrera: la administración cancela mientras WhatsApp cierra -> el «cancelado» se conserva", async () => {
        sembrar([fila("carrera", { fecha_evento: "2026-10-30" })]);
        whatsapp.durante = () => Object.assign(fila$("carrera"), { activo: false, estado: "cancelado", cierre_motivo: "panel:cancelado" });
        const r1 = await procesarSorteo({ sock, filas: [{ ...fila$("carrera") }], ahora: AHORA.getTime() });
        assert.strictEqual(r1.resultados[0].resultado, "cerrado", "para el worker ya no está abierto");
        assert.strictEqual(fila$("carrera").estado, "cancelado");
        assert.strictEqual(fila$("carrera").cierre_motivo, "panel:cancelado");
        assert.strictEqual(fila$("carrera").cierre_estado, undefined, "no se escribió el cierre encima");
    });

    await test("12. el sorteo del mismo día antes de su hora sigue abierto (sin cambios de comportamiento)", async () => {
        sembrar([fila("abierto")]);
        const antes = JSON.stringify(fake.tablas.eventos_bot);
        await workerEventos(sock, { ahora: AHORA });
        assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes);
    });

    // ------------------------------------------------ verificación final ---

    await test("13. recuperación de un sorteo en 2 grupos, sorteo nuevo solo en g1: se cierra el grupo g2, el g1 sigue abierto", async () => {
        sembrar([
            fila("ayer-g1", { fecha_evento: "2026-10-30", identidad_evento_real: "id-ayer" }),
            fila("ayer-g2", { fecha_evento: "2026-10-30", identidad_evento_real: "id-ayer", grupo_id: "g2@g.us" }),
            fila("nuevo")
        ]);
        const nuevoAntes = JSON.stringify(fila$("nuevo"));
        await workerEventos(sock, { ahora: AHORA });
        assert.deepStrictEqual(whatsapp.cierres, ["g2@g.us"]);
        assert.ok(!fila$("ayer-g1").activo && !fila$("ayer-g2").activo);
        assert.match(fila$("ayer-g1").cierre_motivo, /grupo en uso por otro sorteo/);
        assert.doesNotMatch(fila$("ayer-g2").cierre_motivo, /grupo en uso/);
        assert.strictEqual(JSON.stringify(fila$("nuevo")), nuevoAntes);
    });

    await test("14. el sorteo nuevo del mismo grupo es para MAÑANA (publicado esta noche): también protege el grupo", async () => {
        sembrar([fila("ayer", { fecha_evento: "2026-10-30" }), fila("manana", { fecha_evento: "2026-11-01", hora_cierre: "09:56" })]);
        await workerEventos(sock, { ahora: AHORA });
        assert.deepStrictEqual(whatsapp.cierres, []);
        assert.strictEqual(fila$("ayer").activo, false);
        assert.strictEqual(fila$("manana").activo, true);
    });

    await test("15. si el sorteo «nuevo» del grupo también venció, ambos se cierran (el atrasado sin aviso, el de hoy con aviso)", async () => {
        sembrar([fila("ayer", { fecha_evento: "2026-10-30" }), fila("hoy", { hora_cierre: "07:30" })]);
        await workerEventos(sock, { ahora: AHORA });
        assert.ok(!fila$("ayer").activo && !fila$("hoy").activo);
        assert.strictEqual(cierreSilencioso(fila$("ayer")), true);
        assert.strictEqual(cierreSilencioso(fila$("hoy")), false);
        assert.ok(whatsapp.cierres.every(g => g === "g1@g.us"));
    });

    await test("16. concurrencia: desactivado desde el panel o cerrado por otro proceso mientras WhatsApp respondía -> no se sobrescribe", async () => {
        sembrar([fila("desact", { fecha_evento: "2026-10-30" })]);
        whatsapp.durante = () => Object.assign(fila$("desact"), { activo: false, estado: "desactivado", cierre_motivo: "panel:desactivado" });
        await workerEventos(sock, { ahora: AHORA });
        assert.deepStrictEqual([fila$("desact").estado, fila$("desact").cierre_motivo], ["desactivado", "panel:desactivado"]);

        sembrar([fila("otro", { fecha_evento: "2026-10-30" })]);
        whatsapp.durante = () => Object.assign(fila$("otro"), { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "pagados", cerrado_en: "X" });
        await workerEventos(sock, { ahora: AHORA });
        assert.deepStrictEqual([fila$("otro").cierre_motivo, fila$("otro").cerrado_en], ["pagados", "X"], "el primer cierre manda");
    });

    await test("17. idempotencia ante varios reinicios del worker: un solo cierre en WhatsApp, la fila no vuelve a cambiar", async () => {
        sembrar([fila("ayer", { fecha_evento: "2026-10-30" }), fila("nuevo-g2", { grupo_id: "g2@g.us" })]);
        await workerReiniciado()(sock, { ahora: AHORA });
        const tras1 = JSON.stringify(fake.tablas.eventos_bot);
        for (let i = 0; i < 3; i++) await workerReiniciado()(sock, { ahora: new Date(AHORA.getTime() + (i + 1) * 30000) });
        assert.deepStrictEqual(whatsapp.cierres, ["g1@g.us"]);
        assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), tras1);
    });

    await test("18. reinicio después de un fallo de WhatsApp: se reintenta y se cierra una sola vez", async () => {
        sembrar([fila("ayer", { fecha_evento: "2026-10-30" })]);
        whatsapp.fallos = 1;
        await workerReiniciado()(sock, { ahora: AHORA });
        assert.strictEqual(fila$("ayer").activo, true, "sin confirmación de WhatsApp no se marca cerrado");
        assert.strictEqual(fila$("ayer").cierre_estado, "fallido");
        await workerReiniciado()(sock, { ahora: AHORA });
        await workerReiniciado()(sock, { ahora: AHORA });
        assert.strictEqual(fila$("ayer").activo, false);
        assert.strictEqual(fila$("ayer").cierre_estado, "cerrado");
        assert.deepStrictEqual(whatsapp.cierres, ["g1@g.us"]);
    });

    await test("19. cierre después de medianoche: no antes, a su hora sin «recuperado», al día siguiente recuperado", async () => {
        const madrugada = { fecha_evento: "2026-11-01", hora_cierre: "00:20" };
        assert.strictEqual(verificarHoraCierre(madrugada, co("2026-10-31T23:59")), false);
        sembrar([fila("madrugada", madrugada)]);
        await workerEventos(sock, { ahora: co("2026-10-31T23:59") });
        assert.strictEqual(fila$("madrugada").activo, true);
        await workerEventos(sock, { ahora: co("2026-11-01T00:20") });
        assert.strictEqual(fila$("madrugada").cierre_motivo, "hora");
        sembrar([fila("madrugada", madrugada)]);
        await workerEventos(sock, { ahora: co("2026-11-02T08:00") });
        assert.match(fila$("madrugada").cierre_motivo, /recuperado: cierre pendiente del 2026-11-01/);
    });

    await test("20. filas SIN fecha_evento: la hora de hoy, nunca «recuperado» (límite conocido: no se sabe su día)", async () => {
        sembrar([fila("sinfecha", { fecha_evento: null, hora_cierre: "07:30" })]);
        await workerEventos(sock, { ahora: AHORA });
        assert.strictEqual(fila$("sinfecha").cierre_motivo, "hora");
        sembrar([fila("sinfecha", { fecha_evento: null, hora_cierre: "09:00" })]);
        await workerEventos(sock, { ahora: AHORA });
        assert.strictEqual(fila$("sinfecha").activo, true, "antes de su hora de hoy sigue abierta");
    });

    await test("21. fila de otro cliente o de un grupo no autorizado: nunca la toca este worker", async () => {
        sembrar([
            fila("ajena", { fecha_evento: "2026-10-30", usuario_id: "otro-tenant" }),
            fila("noaut", { fecha_evento: "2026-10-30", grupo_id: "g9@g.us" })
        ]);
        const antes = JSON.stringify(fake.tablas.eventos_bot);
        await workerEventos(sock, { ahora: AHORA });
        assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes);
        assert.deepStrictEqual(whatsapp.cierres, []);
    });

    const fallidas = resultados.filter(x => !x).length;
    console.log(`\nPruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas}  |  Fallidas: ${fallidas}`);
    process.exit(fallidas ? 1 : 0);

})();
