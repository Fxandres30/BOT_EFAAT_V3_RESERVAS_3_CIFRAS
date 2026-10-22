// ==========================================================================
// PRUEBAS — programar un sorteo FUTURO aunque hoy haya otro activo en el
// mismo grupo, y editar sin duplicar.
//
//   F. Conflictos por FECHA (disponibilidad.revisarGrupo): un sorteo actual
//      que cierra antes de la publicación no bloquea ("Programado"); uno que
//      seguirá abierto, sí ("Bloqueado por un conflicto real"); dos
//      programados solapados en el mismo grupo, también.
//   P. Publicador: no publica antes de su fecha; publica en su fecha; si en
//      ese momento el sorteo anterior sigue abierto, ESPERA (pendiente, sin
//      gastar intentos, sin tocar el sorteo actual) y publica cuando cierra;
//      pasado el cierre del nuevo, queda en revisión sin perderse.
//   R. Reinicio de la tabla diferido a la publicación (mismo precio): se
//      confirma hoy, no toca nada hoy y se hace al publicar.
//   E. Editar: mismo id, versión + 1, sin sorteo nuevo; nunca el de otro.
//   C. Dos clientes.
//
// Servicio y publicador REALES; Supabase en memoria + rpc de la 030 simulada.
// Son simulaciones: ninguna toca la base real ni WhatsApp.
//
//     node backend/tests/sorteos/programacionFutura.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
const rpc = { llamadas: [], respuesta: null };

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async (nombre, args) => { rpc.llamadas.push({ nombre, args }); return typeof rpc.respuesta === "function" ? rpc.respuesta(args) : rpc.respuesta; }
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// Hoy: 15/10 10:00 Colombia. El sorteo futuro se publica el 22/10 08:00
// (siete días después) y se juega ese día a las 22:30 (cierre 22:26).
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const ANTES = new Date("2026-10-21T13:01:00Z");
const TRAS_CIERRE = new Date("2026-10-23T03:30:00Z");      // 22/10 22:30 Colombia
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const T1K = "reservas_dos_cifras";

// Sorteo ACTUAL de A en g1 (hoy, $5.000): 3 pagados y 2 reservados.
function eventoActual(extra = {}) {
    return {
        id: "ev-actual", grupo_id: "g1@g.us", grupo_nombre: "Grupo 1", usuario_id: A, activo: true, estado: "abierto", abierto: true,
        identidad_evento_real: "actual", nombre_evento: "Boyacá hoy", hora_fin: "22:30", hora_cierre: "22:26",
        fecha_evento: "2026-10-15", tabla: T5K, valor: "5000", cifras: 2, cantidad_numeros: 100, ...extra
    };
}

function escenario() {
    fake = crearFake();
    rpc.llamadas = [];
    rpc.respuesta = null;
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: B, grupo_id: "g1@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }];
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000002", activa: true }
    ];
    t.eventos_bot = [eventoActual()];
    for (const tabla of [T5K, T1K]) {
        t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    }
    t[T5K].filter(f => f.usuario_id === A).slice(0, 5).forEach((f, i) => Object.assign(f, {
        estado: i < 3 ? "pagado" : "reservado", identidad_evento_real: "actual", evento_id: "ev-actual", comprador: `Cliente ${i}`
    }));
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Lotería de Manizales",
        hora_fin: "22:30",
        valor: 1000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "{{nombre}} {{fecha}}", aviso_cierre: "" },
        recordatorios: [],
        ...extra
    };
}

function deps() {
    const enviados = [];
    return {
        enviados,
        d: {
            supabase: { from: (t) => fake.client.from(t) },
            guardarEvento, consultarEvento, abrirGrupo, ejecutarUnaVez, actualizarEvento,
            puedeActuar: () => true,
            sendMessage: async ({ jid, text }) => { enviados.push({ jid, text }); }
        }
    };
}

const sock = (usuarioId = A) => ({
    context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}`, telefono: "573000000000" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [] }),
    groupSettingUpdate: async () => {}
});

const grupoDe = (sorteoId, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === sorteoId && x.grupo_id === g);
const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const actualDb = () => fake.tablas.eventos_bot.find(e => e.identidad_evento_real === "actual");
const instantanea = () => JSON.stringify({ evento: actualDb(), filas: fake.tablas[T5K].filter(f => f.usuario_id === A) });

async function programar(extra = {}, usuario = A, reinicio) {
    const c = await servicio.crearSorteo(usuario, entrada(extra));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await servicio.confirmar(usuario, c.data.id, { version: c.data.version, confirmacion: true, ...(reinicio ? { reinicio } : {}) });
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------- F. conflictos ---

prueba("F1. programar para dentro de 7 días con otro sorteo activo HOY en el grupo: «Programado», se confirma", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada());
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.deepStrictEqual(v.data.bloqueos, [], JSON.stringify(v.data.bloqueos));
    assert.strictEqual(v.data.estado_publicacion, "programado");
    const g = v.data.grupos[0];
    assert.strictEqual(g.estado_previo, "programado");
    assert.ok(/Boyacá hoy/.test(g.motivo) && /no se modifica/.test(g.motivo), g.motivo);
    assert.strictEqual(v.data.puede_confirmar, true);
    const conf = await servicio.confirmar(A, c.data.id, { version: 1, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
    assert.strictEqual(conf.data.estado, "programado");
});

prueba("F2. el sorteo actual sigue intacto (evento, reservas y pagos) tras crear, revisar y confirmar", async () => {
    escenario();
    const antes = instantanea();
    await programar();
    // Mismo precio (misma tabla) solo revisado: tampoco toca nada.
    const mismoPrecio = await servicio.crearSorteo(A, entrada({ valor: 5000, grupos: ["g2@g.us"] }));
    await servicio.vistaPrevia(A, mismoPrecio.data.id);
    assert.strictEqual(instantanea(), antes);
    assert.strictEqual(rpc.llamadas.length, 0, "ningún reinicio");
});

prueba("F3. sin conflictos en el grupo: «Listo para publicar»", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada({ grupos: ["g2@g.us"] }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(v.data.estado_publicacion, "listo");
    assert.strictEqual(v.data.grupos[0].estado_previo, "listo");
});

prueba("F4. conflicto REAL: el sorteo actual seguirá abierto en la fecha de publicación -> bloqueado y explicado", async () => {
    escenario();
    Object.assign(actualDb(), { fecha_evento: "2026-10-22", hora_cierre: "20:00" });
    const c = await servicio.crearSorteo(A, entrada());
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(v.data.estado_publicacion, "bloqueado");
    assert.strictEqual(v.data.grupos[0].estado_previo, "bloqueado");
    assert.ok(/sigue abierto hasta/.test(v.data.grupos[0].bloqueo) && /Programa la publicación después/.test(v.data.grupos[0].bloqueo), v.data.grupos[0].bloqueo);
    assert.strictEqual((await servicio.confirmar(A, c.data.id, { version: 1, confirmacion: true })).motivo, "bloqueado");
});

prueba("F5. sorteo actual sin hora de cierre conocida: conservador, bloquea", async () => {
    escenario();
    Object.assign(actualDb(), { hora_cierre: null });
    const c = await servicio.crearSorteo(A, entrada());
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(v.data.estado_publicacion, "bloqueado");
});

prueba("F6. dos sorteos programados en el mismo grupo con periodos solapados: el segundo se bloquea; sin solape, no", async () => {
    escenario();
    await programar({ grupos: ["g2@g.us"] });
    const solapado = await servicio.crearSorteo(A, entrada({ grupos: ["g2@g.us"], publicar_en: "2026-10-22T17:00:00.000Z" }));
    const v1 = await servicio.vistaPrevia(A, solapado.data.id);
    assert.strictEqual(v1.data.estado_publicacion, "bloqueado");
    assert.ok(/otro sorteo programado/.test(v1.data.grupos[0].bloqueo), v1.data.grupos[0].bloqueo);
    const despues = await servicio.crearSorteo(A, entrada({ grupos: ["g2@g.us"], publicar_en: "2026-10-23T13:00:00.000Z", fecha_sorteo: "2026-10-23" }));
    const v2 = await servicio.vistaPrevia(A, despues.data.id);
    assert.strictEqual(v2.data.estado_publicacion, "listo", JSON.stringify(v2.data.bloqueos));
});

prueba("F7. la publicación sigue debiendo ser antes del cierre real del sorteo nuevo (y no se confunde con su fecha)", async () => {
    escenario();
    const tarde = await servicio.crearSorteo(A, entrada({ publicar_en: "2026-10-23T03:27:00.000Z" }));   // 22/10 22:27
    assert.strictEqual(tarde.motivo, "validacion");
    assert.ok(tarde.errores.some(e => e.campo === "publicar_en" && /antes del cierre/.test(e.mensaje)));
    const vispera = await servicio.crearSorteo(A, entrada({ publicar_en: "2026-10-21T23:00:00.000Z", fecha_sorteo: "2026-10-22" }));
    assert.ok(vispera.ok, "publicar la víspera es válido");
    assert.strictEqual(vispera.data.config.fecha_sorteo, "2026-10-22");
});

// ------------------------------------------------------- P. publicador ---

prueba("P1. el publicador no publica antes de la fecha y publica en la fecha correcta (el anterior ya cerró)", async () => {
    escenario();
    const s = await programar();
    const d = deps();
    await publicador.tick(sock(), { ahora: ANTES, deps: d.d });
    assert.strictEqual(d.enviados.length, 0);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "pendiente");
    Object.assign(actualDb(), { activo: false, estado: "cerrado" });   // el worker lo cerró a su hora
    const filasActual = JSON.stringify(fake.tablas[T5K].filter(f => f.usuario_id === A));
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: d.d });
    assert.deepStrictEqual(d.enviados.map(e => e.jid), ["g1@g.us"]);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    const ev = fake.tablas.eventos_bot.find(e => e.grupo_id === "g1@g.us" && e.usuario_id === A);
    assert.strictEqual(ev.identidad_evento_real, s.identidad_evento_real);
    assert.strictEqual(ev.fecha_evento, "2026-10-22");
    assert.strictEqual(JSON.stringify(fake.tablas[T5K].filter(f => f.usuario_id === A)), filasActual, "las reservas y pagos del sorteo anterior no se tocan");
});

prueba("P2. conflicto REAL al publicar (el anterior sigue abierto): espera sin perder el sorteo ni gastar intentos; publica cuando cierra", async () => {
    escenario();
    const s = await programar();
    const d = deps();
    const antes = instantanea();
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: d.d });
    await publicador.tick(sock(), { ahora: new Date("2026-10-22T13:02:00Z"), deps: d.d });
    const g = grupoDe(s.id, "g1@g.us");
    assert.strictEqual(d.enviados.length, 0);
    assert.strictEqual(g.estado, "pendiente");
    assert.strictEqual(Number(g.intentos), 0, "esperar no gasta intentos");
    assert.ok(/^En espera: /.test(g.ultimo_error) && /Boyacá hoy/.test(g.ultimo_error) && /antes del cierre de reservas/.test(g.ultimo_error), g.ultimo_error);
    assert.strictEqual(instantanea(), antes, "el sorteo actual no se reemplaza ni se modifica");
    assert.ok(sorteoDb(s.id), "el sorteo programado sigue ahí");
    Object.assign(actualDb(), { activo: false, estado: "cerrado" });
    await publicador.tick(sock(), { ahora: new Date("2026-10-22T15:00:00Z"), deps: d.d });
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(d.enviados.length, 1);
});

prueba("P3. si el conflicto no se resuelve antes del cierre del nuevo: queda en revisión explicado, sin borrarse", async () => {
    escenario();
    const s = await programar();
    const d = deps();
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: d.d });
    await publicador.tick(sock(), { ahora: TRAS_CIERRE, deps: d.d });
    const g = grupoDe(s.id, "g1@g.us");
    assert.strictEqual(g.estado, "requiere_revision");
    assert.ok(/cierre .* ya pasó/.test(g.ultimo_error) && /no se resolvió a tiempo/.test(g.ultimo_error), g.ultimo_error);
    assert.ok(sorteoDb(s.id));
    assert.strictEqual(d.enviados.length, 0);
    assert.strictEqual(actualDb().activo, true, "el sorteo actual sigue como estaba");
});

// -------------------------------------------- R. reinicio a la publicación ---

function rpcReinicio({ protegido }) {
    rpc.respuesta = (args) => {
        if (args.p_aplicar) {
            fake.tablas[T5K].filter(f => f.usuario_id === A && f.identidad_evento_real === "actual")
                .forEach(f => Object.assign(f, { estado: "libre", identidad_evento_real: null, evento_id: null, comprador: null }));
            return { data: { ok: true, aplicado: true, archivados: 5 }, error: null };
        }
        return protegido()
            ? { data: { ok: false, motivo: "protegido", huella: "h1", liberables: 0, protegidos: 5, por_sorteo: [{ identidad: "actual", nombre_evento: "Boyacá hoy", clase: "protegido_activo", reservados: 2, pagados: 3, otros: 0 }] }, error: null }
            : { data: { ok: true, aplicado: false, huella: "h2", liberables: 5, protegidos: 0, por_sorteo: [{ identidad: "actual", nombre_evento: "Boyacá hoy", clase: "liberable", reservados: 2, pagados: 3, otros: 0 }] }, error: null };
    };
}

prueba("R1. mismo precio sin reiniciar: la tabla seguirá ocupada al publicar -> bloqueo explicado (conflicto real)", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada({ valor: 5000 }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(v.data.estado_publicacion, "bloqueado");
    assert.ok(v.data.bloqueos.some(b => /otro sorteo/.test(b) && /Reiniciar tabla/.test(b)));
});

prueba("R2. mismo precio con «Reiniciar tabla»: hoy no toca nada, se confirma «al publicar» y se reinicia al publicar", async () => {
    escenario();
    const actualActivo = () => actualDb().activo !== false;
    rpcReinicio({ protegido: actualActivo });
    const c = await servicio.crearSorteo(A, entrada({ valor: 5000, tabla: { reiniciar: true } }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.deepStrictEqual(v.data.bloqueos, [], JSON.stringify(v.data.bloqueos));
    assert.strictEqual(v.data.reinicio.diferido, true);
    assert.strictEqual(v.data.estado_publicacion, "programado");
    assert.ok(v.data.avisos.some(a => /se reiniciará al publicar/.test(a)));

    assert.strictEqual((await servicio.confirmar(A, c.data.id, { version: 1, confirmacion: true })).motivo, "confirmacion_reinicio_requerida");
    const antes = instantanea();
    const conf = await servicio.confirmar(A, c.data.id, { version: 1, confirmacion: true, reinicio: { confirmado: true, huella: null, diferido: true } });
    assert.ok(conf.ok, JSON.stringify(conf));
    assert.strictEqual(sorteoDb(c.data.id).config.tabla.reiniciar_al_publicar, true);
    assert.strictEqual(instantanea(), antes, "hoy no se reinicia nada");
    assert.ok(rpc.llamadas.every(l => l.args.p_aplicar === false));

    // Al publicar con el anterior TODAVÍA abierto: espera, sin reiniciar.
    const d = deps();
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: d.d });
    assert.ok(rpc.llamadas.every(l => l.args.p_aplicar === false));
    assert.ok(/^En espera: /.test(grupoDe(c.data.id, "g1@g.us").ultimo_error));
    assert.strictEqual(d.enviados.length, 0);

    // Cerró: se reinicia UNA vez (con la huella de ese momento) y se publica.
    Object.assign(actualDb(), { activo: false, estado: "cerrado" });
    await publicador.tick(sock(), { ahora: new Date("2026-10-22T15:00:00Z"), deps: d.d });
    const aplicadas = rpc.llamadas.filter(l => l.args.p_aplicar === true);
    assert.strictEqual(aplicadas.length, 1);
    assert.deepStrictEqual([aplicadas[0].args.p_usuario, aplicadas[0].args.p_tabla, aplicadas[0].args.p_huella], [A, T5K, "h2"]);
    assert.ok(sorteoDb(c.data.id).config.tabla.reiniciado_en);
    assert.strictEqual(grupoDe(c.data.id, "g1@g.us").estado, "publicado");
    await publicador.tick(sock(), { ahora: new Date("2026-10-22T15:01:00Z"), deps: d.d });
    assert.strictEqual(rpc.llamadas.filter(l => l.args.p_aplicar === true).length, 1, "no se reinicia dos veces");
});

prueba("R3. el reinicio NO se difiere si el sorteo actual seguirá abierto al publicar", async () => {
    escenario();
    Object.assign(actualDb(), { fecha_evento: "2026-10-22", hora_cierre: "20:00" });
    rpcReinicio({ protegido: () => true });
    const c = await servicio.crearSorteo(A, entrada({ valor: 5000, tabla: { reiniciar: true } }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.ok(!v.data.reinicio.diferido);
    assert.ok(v.data.bloqueos.some(b => /No se puede reiniciar la tabla/.test(b)));
});

// ---------------------------------------------------------- E. editar ---

prueba("E1. editar actualiza el MISMO sorteo (versión + 1), sin crear otro; otro cliente no puede editarlo", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada({ premios: [{ nombre: "Mayor", premio: 1000 }, { nombre: "Seco", premio: 500 }] }));
    const total = fake.tablas.sorteos_programados.length;
    const e = await servicio.editar(A, c.data.id, { ...entrada({ hora_fin: "22:40", premios: [{ nombre: "Mayor", premio: 1000 }, { nombre: "Seco", premio: 500 }] }), version: 1 });
    assert.ok(e.ok, JSON.stringify(e));
    assert.strictEqual(e.data.id, c.data.id);
    assert.strictEqual(e.data.version, 2);
    assert.strictEqual(e.data.config.hora_fin, "22:40");
    assert.strictEqual(e.data.config.premios.length, 2);
    assert.strictEqual(fake.tablas.sorteos_programados.length, total);
    assert.strictEqual((await servicio.editar(B, c.data.id, { ...entrada(), version: 2 })).motivo, "no_encontrado");
    assert.strictEqual((await servicio.obtenerSorteo(B, c.data.id)).motivo, "no_encontrado");
    assert.strictEqual((await servicio.editar(A, c.data.id, { ...entrada(), version: 1 })).motivo, "version_cambiada", "una versión vieja no pisa la nueva");
});

// ----------------------------------------------------- C. dos clientes ---

prueba("C1. el sorteo de OTRA cuenta en el grupo: bloquea solo si sigue abierto en la fecha y sin revelar cuál", async () => {
    escenario();
    actualDb().activo = false;
    fake.tablas.eventos_bot.push({ ...eventoActual(), id: "ev-b", usuario_id: B, identidad_evento_real: "de-b", nombre_evento: "Secreto de B" });
    const c = await servicio.crearSorteo(A, entrada());
    assert.strictEqual((await servicio.vistaPrevia(A, c.data.id)).data.estado_publicacion, "listo", "el de B cierra antes");
    Object.assign(fake.tablas.eventos_bot.find(e => e.id === "ev-b"), { fecha_evento: "2026-10-22", hora_cierre: "21:00" });
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(v.data.estado_publicacion, "bloqueado");
    assert.ok(/Otra cuenta/.test(v.data.grupos[0].bloqueo) && !/Secreto de B/.test(JSON.stringify(v.data)));
});

prueba("C2. los sorteos programados de un cliente no bloquean ni modifican los del otro", async () => {
    escenario();
    actualDb().activo = false;
    const deB = await programar({ grupos: ["g1@g.us"], cuentas: ["cuenta-b1"] }, B);
    const c = await servicio.crearSorteo(A, entrada());
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(v.data.estado_publicacion, "listo", JSON.stringify(v.data.bloqueos));
    const antesB = JSON.stringify(sorteoDb(deB.id));
    await servicio.confirmar(A, c.data.id, { version: 1, confirmacion: true });
    await publicador.tick(sock(A), { ahora: EN_PUBLICACION, deps: deps().d });
    assert.strictEqual(JSON.stringify(sorteoDb(deB.id)), antesB, "el de B no se toca al publicar el de A");
    assert.strictEqual(grupoDe(deB.id, "g1@g.us").estado, "pendiente");
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        const err = console.error; console.error = () => {};
        try { await fn(); ok++; console.error = err; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.error = err; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
