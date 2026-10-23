// ==========================================================================
// PRUEBA DE CICLO COMPLETO — un sorteo creado desde el panel, de principio a
// fin, con las piezas REALES de reserva y pago, y DOS clientes que comparten
// la misma tabla física (cada uno con su cuadrícula 00-99).
//
//   crear -> vista previa -> confirmar -> publicar en 3 grupos ->
//   reservar desde varios grupos (con choque concurrente) -> pagar ->
//   liberar vencidas -> 99 pagados (sigue abierto) -> 100 pagados (cierra
//   los 3 grupos; uno falla primero y se reintenta)
//
// Invariante transversal: la cuadrícula del OTRO cliente nunca cambia.
//
// Reales: servicio, publicador, guardarEvento, consultarEvento, abrirGrupo,
// executionGuard, reservarNumeros, consultarReservas, marcarReservasPagadas
// PorAdmin, actualizarEvento, sorteoReal, workerEventos, cerrarEvento.
// Simulados: Supabase (memoria), socket de WhatsApp, envío de mensajes.
//
//     node backend/tests/sorteos/cicloCompleto.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const fake = crearFake();
require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: fake.client };

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { depsCompartir } = require("./compartirSimulado");
const { reservarNumeros } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const { marcarReservasPagadasPorAdmin } = require(r("bot/funciones/pagos/marcarReservasPagadasPorAdmin.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TABLA = "5k_15k_reservas_2_cifras";
const GRUPOS = ["g1@g.us", "g2@g.us", "g3@g.us"];

const T0 = new Date("2026-10-15T15:00:00Z");          // 10:00 Colombia
const PUBLICAR = new Date("2026-10-15T15:30:00Z");    // 10:30
const EN_PUB = new Date("2026-10-15T15:31:00Z");
servicio._reloj.ahora = () => T0;

const t = fake.tablas;
t.grupos_autorizados = GRUPOS.map(g => ({ usuario_id: A, grupo_id: g, activo: true }));
t.grupos = [];
t.cuentas_pago = [{ id: "cuenta-a", usuario_id: A, nombre: "Nequi", tipo: "nequi", numero: "300", activa: true }];
t.eventos_bot = [];
t[TABLA] = [
    ...Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A })),
    ...Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: B }))
];

const cuadriculaB = () => t[TABLA].filter(f => f.usuario_id === B);
const filaA = (n) => t[TABLA].find(f => f.usuario_id === A && f.numero === n);
const intactaB = () => assert.ok(cuadriculaB().every(f => f.estado === "libre" && !f.identidad_evento_real && !f.usuario_global_id), "la cuadrícula del otro cliente cambió");

const ajustes = [];
const fallaCierre = new Set();
const sock = {
    context: { usuarioId: A, sessionId: "ses-a", telefono: "573000000000" },
    groupMetadata: async (jid) => ({ subject: `Grupo ${jid}`, participants: [] }),
    groupSettingUpdate: async (jid, ajuste) => {
        ajustes.push({ jid, ajuste });
        if (ajuste === "announcement" && fallaCierre.has(jid)) throw new Error("Connection Closed (simulado)");
    }
};
const enviados = [];
const deps = {
    supabase: fake.client, guardarEvento, consultarEvento, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true,
    sendMessage: async ({ jid, text }) => { enviados.push({ jid, text }); }
};
// El anuncio sale por «Compartir» (imagen + pie) hacia el mismo registro.
Object.assign(deps, depsCompartir(() => deps.sendMessage));

const pasos = [];
const paso = (nombre, fn) => pasos.push({ nombre, fn });
const contexto = {};

paso("1. crear el sorteo desde el panel (con liberación de vencidas a 30 min)", async () => {
    const c = await servicio.crearSorteo(A, {
        nombre: "Lotería de Manizales", hora_fin: "22:30", valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: GRUPOS, cuentas: ["cuenta-a"], publicar_en: PUBLICAR.toISOString(),
        mensajes: { publicacion: "", aviso_cierre: "🔒 {{nombre}} cerrado" },
        recordatorios: [], reservas: { liberar_no_pagados: true, vencimiento_minutos: 30 }
    });
    assert.ok(c.ok, JSON.stringify(c));
    contexto.sorteo = c.data;
});

paso("2. vista previa sin bloqueos y confirmación de la versión vista", async () => {
    const vp = await servicio.vistaPrevia(A, contexto.sorteo.id);
    assert.deepStrictEqual(vp.data.bloqueos, []);
    const conf = await servicio.confirmar(A, contexto.sorteo.id, { version: vp.data.version, confirmacion: true });
    assert.strictEqual(conf.data.estado, "programado");
});

paso("3. publicar en los 3 grupos: un anuncio por grupo, una sola tabla compartida", async () => {
    await publicador.tick(sock, { ahora: T0, deps });
    assert.strictEqual(enviados.length, 0, "no antes de su hora");
    await publicador.tick(sock, { ahora: EN_PUB, deps });
    await publicador.tick(sock, { ahora: EN_PUB, deps });
    assert.deepStrictEqual(enviados.map(e => e.jid).sort(), GRUPOS);
    assert.strictEqual(t.eventos_bot.length, 3);
    assert.strictEqual(new Set(t.eventos_bot.map(e => e.identidad_evento_real)).size, 1, "los 3 grupos son el MISMO sorteo");
    contexto.eventos = Object.fromEntries(GRUPOS.map(g => [g, t.eventos_bot.find(e => e.grupo_id === g)]));
    intactaB();
});

paso("4. reservar desde distintos grupos: el MISMO número pedido a la vez solo lo gana uno", async () => {
    const [r1, r2] = await Promise.all([
        reservarNumeros({ evento: contexto.eventos["g1@g.us"], numeros: ["07"], usuario: { id: "ug-1", nombre: "Ana" } }),
        reservarNumeros({ evento: contexto.eventos["g2@g.us"], numeros: ["07"], usuario: { id: "ug-2", nombre: "Beto" } })
    ]);
    assert.strictEqual(r1.length + r2.length, 1, "un número no se reserva dos veces");
    assert.strictEqual(filaA("07").estado, "reservado");
    await reservarNumeros({ evento: contexto.eventos["g3@g.us"], numeros: ["08", "09"], usuario: { id: "ug-3", nombre: "Caro" } });
    assert.ok(["08", "09"].every(n => filaA(n).estado === "reservado" && filaA(n).grupo_id === "g3@g.us"));
    intactaB();
});

paso("5. pagar (sticker de administrador): solo las reservas de ESE cliente pasan a pagado", async () => {
    const ganador = filaA("07").usuario_global_id;
    const r = await marcarReservasPagadasPorAdmin({ evento: contexto.eventos["g2@g.us"], usuario: { id: ganador }, realizadoPor: "admin@s.whatsapp.net" });
    assert.strictEqual(r.estado, "confirmado");
    assert.strictEqual(filaA("07").estado, "pagado");
    assert.ok(["08", "09"].every(n => filaA(n).estado === "reservado"));
    intactaB();
});

paso("6. liberar vencidas: la reserva antigua vuelve a libre; la pagada nunca", async () => {
    Object.assign(filaA("08"), { fecha_reserva: "2026-10-15", hora_reserva: "10:40:00" });
    Object.assign(filaA("09"), { fecha_reserva: "2026-10-15", hora_reserva: "11:50:00" });
    Object.assign(filaA("07"), { fecha_reserva: "2026-10-15", hora_reserva: "10:35:00" });
    await publicador.tick(sock, { ahora: new Date("2026-10-15T17:00:00Z"), deps }); // 12:00
    assert.strictEqual(filaA("08").estado, "libre");
    assert.strictEqual(filaA("09").estado, "reservado", "todavía no vence");
    assert.strictEqual(filaA("07").estado, "pagado");
    intactaB();
});

paso("7. vender y pagar 99 números únicos desde los 3 grupos: el sorteo SIGUE abierto", async () => {
    const pendientes = t[TABLA].filter(f => f.usuario_id === A && f.estado !== "pagado").map(f => f.numero);
    let i = 0;
    for (const n of pendientes) {
        const grupo = GRUPOS[i % 3];
        const usuario = { id: `ug-c${i++}` };
        if (filaA(n).estado === "libre") await reservarNumeros({ evento: contexto.eventos[grupo], numeros: [n], usuario });
        if (n === "99") continue; // el último queda reservado
        const dueno = filaA(n).usuario_global_id;
        await marcarReservasPagadasPorAdmin({ evento: contexto.eventos[grupo], usuario: { id: dueno }, realizadoPor: "admin" });
    }
    assert.strictEqual(t[TABLA].filter(f => f.usuario_id === A && f.estado === "pagado").length, 99);
    await workerEventos(sock);
    assert.ok(t.eventos_bot.every(e => e.activo), "99/100: no cierra");
    assert.ok(t.eventos_bot.every(e => e.pagados === 99 && e.reservados === 1), "todos los grupos muestran la MISMA tabla (99 pagados)");
    intactaB();
});

paso("8. pagar el último: se cierran los 3 grupos; uno falla primero y se reintenta sin tocar los cerrados", async () => {
    const dueno = filaA("99").usuario_global_id;
    await marcarReservasPagadasPorAdmin({ evento: contexto.eventos["g1@g.us"], usuario: { id: dueno }, realizadoPor: "admin" });
    fallaCierre.add("g2@g.us");
    const antes = ajustes.length;
    await workerEventos(sock);
    const cierres1 = ajustes.slice(antes).filter(a => a.ajuste === "announcement").map(a => a.jid).sort();
    assert.deepStrictEqual(cierres1, GRUPOS);
    assert.strictEqual(t.eventos_bot.find(e => e.grupo_id === "g2@g.us").activo, true, "el grupo que falló sigue activo");
    assert.ok(t.eventos_bot.filter(e => e.grupo_id !== "g2@g.us").every(e => !e.activo));
    fallaCierre.clear();
    const antes2 = ajustes.length;
    await workerEventos(sock);
    assert.deepStrictEqual(ajustes.slice(antes2).filter(a => a.ajuste === "announcement").map(a => a.jid), ["g2@g.us"], "solo se reintenta el fallido");
    assert.ok(t.eventos_bot.every(e => !e.activo && e.estado === "cerrado"));
    intactaB();
});

paso("9. aviso de cierre: una vez por grupo, sin duplicados", async () => {
    await publicador.tick(sock, { ahora: new Date("2026-10-15T17:05:00Z"), deps });
    await publicador.tick(sock, { ahora: new Date("2026-10-15T17:06:00Z"), deps });
    const avisos = enviados.filter(e => /cerrado/.test(e.text)).map(e => e.jid).sort();
    assert.deepStrictEqual(avisos, GRUPOS);
});

(async () => {
    const salida = (x) => process.stdout.write(x + "\n");
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) { originales[m] = console[m]; console[m] = () => {}; }
    let ok = 0, falla = 0;
    for (const { nombre, fn } of pasos) {
        try { await fn(); ok++; salida(`✅ ${nombre}`); }
        catch (err) { falla++; salida(`❌ ${nombre}`); salida(String(err && err.stack || err)); break; }
    }
    Object.assign(console, originales);
    salida("\n============================");
    salida(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}${falla ? " (el ciclo se detiene en el primer fallo)" : ""}`);
    salida("============================");
    process.exit(falla ? 1 : 0);
})();
