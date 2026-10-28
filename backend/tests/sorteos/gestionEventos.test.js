// ==========================================================================
// PRUEBAS — administración de sorteos que ya están en los grupos
// (eventos_bot): cerrar, reabrir, desactivar en UN grupo o en TODOS,
// cancelar y eliminar (lógico), con su efecto real en reservas, pagos,
// consultas de pago, recordatorios y publicaciones programadas.
//
// API HTTP REAL (routes/sorteos.js + exigirUsuario), servicio REAL,
// gestionEventos.js REAL, consultarEvento.js y consultarMisNumeros.js
// REALES. Supabase en memoria y socket de WhatsApp falso.
//
//     node backend/tests/sorteos/gestionEventos.test.js
// ==========================================================================

process.env.SESSIONS_API_TOKEN = "token-servicio-gestion";

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } }
};

// Cierre de grupo en WhatsApp: se registra, nunca red real.
const cierresWhatsApp = [];
require.cache[r("bot/funciones/eventos/grupos/cerrarGrupo.js")] = {
    id: r("bot/funciones/eventos/grupos/cerrarGrupo.js"), filename: r("bot/funciones/eventos/grupos/cerrarGrupo.js"), loaded: true,
    exports: { cerrarGrupoDetallado: async ({ grupoId }) => { cierresWhatsApp.push(grupoId); return { ok: true }; }, cerrarGrupo: async () => true }
};

const servicio = require(r("sorteos/servicio.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { consultarPendientesOtrosSorteos } = require(r("bot/funciones/consultas/consultarMisNumeros.js"));
const { cierreSilencioso } = require(r("shared/eventos/estadosGestion.js"));

// Hoy: 15/10 10:00 Colombia.
const T0 = new Date("2026-10-15T15:00:00Z");
servicio._reloj.ahora = () => T0;
let socketActivo = { context: { usuarioId: "a" } };
servicio.eventos._socketDe = () => socketActivo;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";

const EV_G1 = "e0000000-0000-4000-8000-000000000001";
const EV_G2 = "e0000000-0000-4000-8000-000000000002";
const EV_VIEJO = "e0000000-0000-4000-8000-000000000003";
const EV_B = "e0000000-0000-4000-8000-0000000000b1";
const SP = "50000000-0000-4000-8000-000000000001";

function evento(id, usuario, grupo, identidad, extra = {}) {
    return {
        id, usuario_id: usuario, grupo_id: grupo, grupo_nombre: `Grupo ${grupo}`,
        activo: true, abierto: true, estado: "abierto", identidad_evento_real: identidad,
        nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-15",
        valor: 5000, premios: [], tabla: T5K, cifras: 2, cantidad_numeros: 100,
        creado_en: "2026-10-15T12:00:00Z", actualizado_en: "2026-10-15T12:00:00Z", ...extra
    };
}

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
    cierresWhatsApp.length = 0;
    socketActivo = { context: { usuarioId: A } };
    t.eventos_bot = [
        // Mismo sorteo en DOS grupos.
        evento(EV_G1, A, "g1@g.us", "id-actual"),
        evento(EV_G2, A, "g2@g.us", "id-actual"),
        // Sorteo anterior del grupo 1, cerrado ayer.
        evento(EV_VIEJO, A, "g1@g.us", "id-viejo", { activo: false, estado: "cerrado", nombre_evento: "Boyacá", fecha_evento: "2026-10-14", creado_en: "2026-10-14T12:00:00Z", actualizado_en: "2026-10-14T23:00:00Z" }),
        // Otro cliente en el mismo grupo.
        evento(EV_B, B, "g1@g.us", "id-b", { nombre_evento: "Secreto de B" })
    ];
    t[T5K] = [
        { usuario_id: A, numero: "01", estado: "pagado", identidad_evento_real: "id-actual", usuario_global_id: "u1" },
        { usuario_id: A, numero: "02", estado: "reservado", identidad_evento_real: "id-actual", usuario_global_id: "u1" },
        { usuario_id: A, numero: "03", estado: "reservado", identidad_evento_real: "id-viejo", usuario_global_id: "u1" },
        { usuario_id: B, numero: "01", estado: "pagado", identidad_evento_real: "id-b" }
    ];
    // Programación del panel del sorteo actual con un grupo todavía pendiente.
    t.sorteos_programados = [{ id: SP, usuario_id: A, estado: "publicando", version: 1, identidad_evento_real: "id-actual", config: {}, creado_en: "2026-10-14T00:00:00Z" }];
    t.sorteos_programados_grupos = [
        { id: "60000000-0000-4000-8000-000000000001", sorteo_id: SP, usuario_id: A, grupo_id: "g1@g.us", estado: "publicado", evento_bot_id: EV_G1 },
        { id: "60000000-0000-4000-8000-000000000003", sorteo_id: SP, usuario_id: A, grupo_id: "g3@g.us", estado: "pendiente", intentos: 0 }
    ];
}

let base;
const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-gestion", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) });
const get = async (camino, jwt = "jwt-A") => { const res = await fetch(base + camino, { headers: h(jwt) }); return { status: res.status, json: await res.json() }; };
const post = async (camino, cuerpo, jwt = "jwt-A") => { const res = await fetch(base + camino, { method: "POST", headers: h(jwt), body: JSON.stringify(cuerpo) }); return { status: res.status, json: await res.json() }; };
const accion = (id, cuerpo, jwt) => post(`/eventos/${id}/accion`, cuerpo, jwt);
const ev = (id) => fake.tablas.eventos_bot.find(e => e.id === id);
const numeros = () => JSON.stringify(fake.tablas[T5K]);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("1. Listado: sorteos activos e inactivos recientes, con el estado de CADA grupo; nunca los de otro cliente", async () => {
    escenario();
    const r1 = await get("/eventos");
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    const actual = r1.json.data.find(s => s.identidad === "id-actual");
    assert.deepStrictEqual(actual.grupos.map(g => [g.grupo_id, g.estado]).sort(), [["g1@g.us", "en_curso"], ["g2@g.us", "en_curso"]]);
    assert.deepStrictEqual([actual.reservados, actual.pagados], [1, 1]);
    assert.strictEqual(r1.json.data.find(s => s.identidad === "id-viejo").estado, "cerrado");
    assert.ok(!JSON.stringify(r1.json).includes("Secreto de B"));
});

prueba("2. Desactivar en UN grupo: ese grupo deja de estar activo, el otro grupo sigue igual; reservas y pagos intactos", async () => {
    escenario();
    const antes = numeros();
    const r1 = await accion(EV_G1, { accion: "desactivar", alcance: "grupo" });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.strictEqual(ev(EV_G1).activo, false);
    assert.strictEqual(ev(EV_G1).estado, "desactivado");
    assert.strictEqual(ev(EV_G2).activo, true, "el otro grupo sigue según su configuración");
    assert.strictEqual(ev(EV_B).activo, true, "otro cliente intacto");
    assert.strictEqual(numeros(), antes);
    assert.ok(cierreSilencioso(ev(EV_G1)), "sin mensaje de cierre");
    assert.strictEqual(cierresWhatsApp.length, 0, "desactivar no toca WhatsApp");
    // Pendiente en g3 sigue (alcance grupo g1).
    assert.strictEqual(fake.tablas.sorteos_programados_grupos.find(g => g.grupo_id === "g3@g.us").estado, "pendiente");
    // El grupo 1 ya no tiene sorteo vigente activo: el más reciente es el desactivado.
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, EV_G1);
});

prueba("3. Desactivar en TODOS: se detienen todos sus grupos y sus publicaciones pendientes", async () => {
    escenario();
    const r1 = await accion(EV_G2, { accion: "desactivar", alcance: "todos" });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.ok([EV_G1, EV_G2].every(id => ev(id).activo === false && ev(id).estado === "desactivado"));
    assert.strictEqual(fake.tablas.sorteos_programados_grupos.find(g => g.grupo_id === "g3@g.us").estado, "cancelado", "no se publicará en el grupo pendiente");
    assert.strictEqual(fake.tablas.sorteos_programados_grupos.find(g => g.grupo_id === "g1@g.us").estado, "publicado", "lo publicado no se toca");
    assert.strictEqual(r1.json.data.publicaciones_detenidas, 1);
});

prueba("4. Cerrar (fin normal) un grupo: cierra el grupo de WhatsApp si no queda otro sorteo activo en él", async () => {
    escenario();
    const r1 = await accion(EV_G2, { accion: "cerrar", alcance: "grupo" });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.strictEqual(ev(EV_G2).estado, "cerrado");
    assert.deepStrictEqual(cierresWhatsApp, ["g2@g.us"]);
    assert.strictEqual(ev(EV_G2).abierto, false);
    assert.ok(!cierreSilencioso(ev(EV_G2)), "un cierre manual sí envía el aviso de cierre configurado");
    // g1: hay sorteo de OTRO cliente activo en el grupo -> no se cierra WhatsApp.
    cierresWhatsApp.length = 0;
    const r2 = await accion(EV_G1, { accion: "cerrar", alcance: "grupo" });
    assert.strictEqual(r2.status, 200);
    assert.deepStrictEqual(cierresWhatsApp, []);
    assert.strictEqual(r2.json.data.whatsapp[0].whatsapp, "omitido_otro_sorteo_activo");
});

prueba("5. Cerrar sin sesión de WhatsApp: el sorteo se cierra igual y se informa", async () => {
    escenario();
    socketActivo = null;
    const r1 = await accion(EV_G2, { accion: "cerrar", alcance: "grupo" });
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(ev(EV_G2).activo, false);
    assert.strictEqual(r1.json.data.whatsapp[0].whatsapp, "sin_sesion");
});

prueba("6. Reabrir: cierre pasado -> pide hora nueva; con hora futura reabre y deja la apertura de WhatsApp al worker", async () => {
    escenario();
    await accion(EV_G2, { accion: "desactivar", alcance: "grupo" });
    ev(EV_G2).hora_cierre = "09:00"; // ya pasó (son las 10:00)
    const r1 = await accion(EV_G2, { accion: "reabrir", alcance: "grupo" });
    assert.strictEqual(r1.status, 400, JSON.stringify(r1.json));
    assert.ok(r1.json.errores.some(e => e.campo === "hora_cierre"));
    const r2 = await accion(EV_G2, { accion: "reabrir", alcance: "grupo", hora_cierre: "22:00" });
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
    assert.strictEqual(ev(EV_G2).activo, true);
    assert.strictEqual(ev(EV_G2).estado, "abierto");
    assert.strictEqual(ev(EV_G2).hora_cierre, "22:00");
    assert.strictEqual(ev(EV_G2).abierto, false, "el worker de eventos abrirá el grupo (reconciliación)");
    assert.strictEqual(ev(EV_G2).cierre_motivo, null);
});

prueba("7. Reabrir el sorteo ANTERIOR del grupo: con otro activo se rechaza; con «sustituir» pasa a ser el vigente sin tocar reservas", async () => {
    escenario();
    ev(EV_VIEJO).fecha_evento = "2026-10-15";
    const antes = numeros();
    const r1 = await accion(EV_VIEJO, { accion: "reabrir", alcance: "grupo", hora_cierre: "21:00" });
    assert.strictEqual(r1.status, 409, JSON.stringify(r1.json));
    assert.ok(/otro sorteo activo/.test(r1.json.mensaje));
    assert.strictEqual(ev(EV_G1).activo, true, "nada cambió");
    const r2 = await accion(EV_VIEJO, { accion: "reabrir", alcance: "grupo", hora_cierre: "21:00", sustituir: true });
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
    assert.strictEqual(ev(EV_VIEJO).activo, true);
    assert.strictEqual(ev(EV_G1).activo, false);
    assert.ok(/^sustituido/.test(ev(EV_G1).cierre_motivo));
    assert.strictEqual(ev(EV_G2).activo, true, "el sorteo sustituido sigue en sus otros grupos");
    assert.strictEqual(ev(EV_B).activo, true, "el sorteo de otro cliente nunca se sustituye");
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, EV_VIEJO, "cambia el evento vigente del grupo");
    assert.strictEqual(numeros(), antes);
});

prueba("8. Cancelar: todos sus grupos, publicaciones pendientes detenidas y sus reservas dejan de ser deuda (sin borrarse)", async () => {
    escenario();
    const antes = numeros();
    const r1 = await accion(EV_G1, { accion: "cancelar" });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.ok([EV_G1, EV_G2].every(id => ev(id).estado === "cancelado" && !ev(id).activo));
    assert.strictEqual(fake.tablas.sorteos_programados_grupos.find(g => g.grupo_id === "g3@g.us").estado, "cancelado");
    assert.strictEqual(numeros(), antes, "reservas y pagos conservados");
    // Pagos: preguntando desde otro sorteo, el cancelado no aparece como deuda.
    const otros = await consultarPendientesOtrosSorteos({ evento: { usuario_id: A, identidad_evento_real: "otro" }, usuario: { id: "u1" }, ahora: T0 });
    assert.deepStrictEqual(otros.map(o => o.identidad), ["id-viejo"]);
});

prueba("9. Eliminar (lógico) un sorteo ACTIVO: se oculta del listado y de las consultas, nada se borra", async () => {
    escenario();
    const antes = numeros();
    const filasAntes = fake.tablas.eventos_bot.length;
    const r1 = await accion(EV_G1, { accion: "eliminar" });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.strictEqual(fake.tablas.eventos_bot.length, filasAntes, "ninguna fila se borra");
    assert.ok([EV_G1, EV_G2].every(id => ev(id).estado === "eliminado" && !ev(id).activo && ev(id).archivado_en));
    assert.strictEqual(numeros(), antes);
    assert.ok(!(await get("/eventos")).json.data.some(s => s.identidad === "id-actual"), "no aparece en el panel");
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, EV_VIEJO, "el grupo vuelve a su sorteo anterior para consultas");
    assert.strictEqual((await accion(EV_G1, { accion: "reabrir", hora_cierre: "22:00" })).status, 404, "un eliminado no se administra");
});

prueba("10. Aislamiento: otro cliente no puede administrar (404) y nada cambia", async () => {
    escenario();
    const antes = JSON.stringify(fake.tablas.eventos_bot);
    for (const a of ["cerrar", "desactivar", "cancelar", "eliminar", "reabrir"]) {
        const r1 = await accion(EV_G1, { accion: a, alcance: "todos" }, "jwt-B");
        assert.strictEqual(r1.status, 404, a);
    }
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes);
    assert.strictEqual((await accion(EV_G1, { accion: "borrar_todo" })).status, 400);
    assert.strictEqual((await accion(EV_G1, { accion: "cerrar" }, null)).status, 401);
});

prueba("11. Base con una restricción antigua sobre «estado»: se guarda «cerrado» y el motivo real en cierre_motivo", async () => {
    escenario();
    const original = fake.client.from;
    fake.client.from = (t) => {
        const q = original(t);
        if (t !== "eventos_bot") return q;
        const update = q.update.bind(q);
        q.update = (v) => (["desactivado", "cancelado", "eliminado"].includes(v.estado)
            ? { eq() { return this; }, then(ok) { return Promise.resolve({ data: null, error: { code: "23514", message: "check constraint" } }).then(ok); } }
            : update(v));
        return q;
    };
    try {
        const r1 = await accion(EV_G1, { accion: "desactivar", alcance: "grupo" });
        assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    } finally {
        fake.client.from = original;
    }
    assert.strictEqual(ev(EV_G1).estado, "cerrado");
    assert.strictEqual(ev(EV_G1).activo, false);
    assert.ok(cierreSilencioso(ev(EV_G1)), "se reconoce como desactivado por cierre_motivo");
});

// Base sin la migración 039 (como producción el 28/10): eventos_bot no tiene
// archivado_en, pero sí las columnas de cierre de la 023. Opcionalmente con
// una restricción CHECK antigua sobre «estado».
function sinMigracion039({ conCheck = false } = {}) {
    const original = fake.client.from;
    fake.client.from = (t) => {
        const q = original(t);
        if (t !== "eventos_bot") return q;
        const update = q.update.bind(q);
        const fallo = (error) => ({ eq() { return this; }, then(ok) { return Promise.resolve({ data: null, error }).then(ok); } });
        q.update = (v) => {
            if ("archivado_en" in v) return fallo({ code: "PGRST204", message: "Could not find the 'archivado_en' column of 'eventos_bot' in the schema cache" });
            if (conCheck && ["desactivado", "cancelado", "eliminado"].includes(v.estado)) return fallo({ code: "23514", message: "check constraint" });
            return update(v);
        };
        return q;
    };
    return () => { fake.client.from = original; };
}

prueba("12. Sin la 039: eliminar conserva el motivo (aunque haya CHECK sobre estado) y queda oculto; solo se omite archivado_en", async () => {
    escenario();
    const antes = numeros();
    const restaurar = sinMigracion039({ conCheck: true });
    try {
        const r1 = await accion(EV_G1, { accion: "eliminar" });
        assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    } finally {
        restaurar();
    }
    for (const id of [EV_G1, EV_G2]) {
        assert.strictEqual(ev(id).activo, false);
        assert.strictEqual(ev(id).cierre_motivo, "panel:eliminado", "el motivo es lo único que distingue el eliminado");
        assert.strictEqual(ev(id).cierre_estado, "cerrado");
        assert.ok(!("archivado_en" in ev(id)) || ev(id).archivado_en == null);
    }
    assert.ok(!(await get("/eventos")).json.data.some(s => s.identidad === "id-actual"), "no aparece en el panel");
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, EV_VIEJO, "el grupo vuelve a su sorteo anterior");
    assert.strictEqual(numeros(), antes, "reservas y pagos intactos");
});

prueba("13. Sin la 039: reabrir un sorteo cancelado limpia el motivo y el cierre (vuelve a ser deuda y a avisar su cierre)", async () => {
    escenario();
    const restaurar = sinMigracion039();
    try {
        assert.strictEqual((await accion(EV_G1, { accion: "cancelar" })).status, 200);
        const r2 = await accion(EV_G1, { accion: "reabrir", alcance: "todos", hora_cierre: "22:00" });
        assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
    } finally {
        restaurar();
    }
    for (const id of [EV_G1, EV_G2]) {
        assert.strictEqual(ev(id).activo, true);
        assert.strictEqual(ev(id).cierre_motivo, null, "sin el motivo «panel:cancelado» de antes");
        assert.strictEqual(ev(id).cierre_estado, null);
        assert.strictEqual(ev(id).cerrado_en, null);
        assert.ok(!cierreSilencioso(ev(id)), "su cierre se anunciará como siempre");
    }
    const otros = await consultarPendientesOtrosSorteos({ evento: { usuario_id: A, identidad_evento_real: "otro" }, usuario: { id: "u1" }, ahora: T0 });
    assert.ok(otros.some(o => o.identidad === "id-actual"), "sus reservas vuelven a ser deuda");
    // Panel: en curso en sus dos grupos, con los mismos contadores.
    const actual = (await get("/eventos")).json.data.find(s => s.identidad === "id-actual");
    assert.strictEqual(actual.estado, "en_curso");
    assert.deepStrictEqual(actual.grupos.map(g => g.estado), ["en_curso", "en_curso"]);
    assert.deepStrictEqual([actual.reservados, actual.pagados], [1, 1]);
    assert.strictEqual((await consultarEvento("g2@g.us", A)).id, EV_G2, "vuelve a ser el sorteo vigente del grupo");
});

prueba("14. Sin la 039: otro cliente no puede eliminar, cancelar ni reabrir (404) y nada cambia", async () => {
    escenario();
    const antes = JSON.stringify(fake.tablas.eventos_bot);
    const numerosAntes = numeros();
    const restaurar = sinMigracion039({ conCheck: true });
    try {
        for (const cuerpo of [{ accion: "eliminar" }, { accion: "cancelar" }, { accion: "desactivar", alcance: "todos" }, { accion: "reabrir", hora_cierre: "22:00" }]) {
            const r1 = await accion(EV_G1, cuerpo, "jwt-B");
            assert.strictEqual(r1.status, 404, `${cuerpo.accion}: ${JSON.stringify(r1.json)}`);
        }
    } finally {
        restaurar();
    }
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes);
    assert.strictEqual(numeros(), numerosAntes);
});

(async () => {
    const app = express();
    app.use(express.json());
    app.use("/sorteos", require(r("routes/sorteos.js")));
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    base = `http://127.0.0.1:${server.address().port}/sorteos`;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        const silencio = {}; for (const m of ["log", "error", "warn", "table", "dir"]) { silencio[m] = console[m]; console[m] = () => {}; }
        try { await fn(); ok++; Object.assign(console, silencio); console.log(`✅ ${n}`); }
        catch (e) { falla++; Object.assign(console, silencio); console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    server.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
