// ==========================================================================
// PRUEBAS — UN SORTEO ACTIVO POR PRECIO desde el panel (decisión 01/11):
// activación de sorteos programados, vista previa, independencia entre
// precios, aislamiento entre clientes, «Reabrir», corrección de precio y
// concurrencia.
//
//   - Un sorteo nuevo del MISMO precio REEMPLAZA al anterior en todos sus
//     grupos (sin mensaje de cierre; reservas y pagos intactos).
//   - Precios distintos conviven aunque compartan tabla física ($3.000 y
//     $10.000; $5.000 y $15.000).
//   - El sorteo propio de OTRO precio abierto en el MISMO grupo se cierra
//     solo ahí (el bot atiende un sorteo por grupo).
//   - Un sorteo de OTRA cuenta en el grupo sigue haciendo esperar.
//   - Si la captura falla no se cierra nada; si guardar falla, se deshace.
//   - Reabrir o corregir el precio hacia uno ocupado: rechazado (Reabrir,
//     salvo «sustituir» confirmado); hacia uno libre, permitido.
//   - Dos publicaciones a la vez del mismo precio: nunca quedan dos activos.
//
// Reales: servicio, publicador, disponibilidad, gestionEventos,
// sorteosActivos, shared/eventos/unSorteoPorPrecio, «Compartir»
// (destinosCompartir + compartirEnGrupos + sendImage). Simulados: Supabase
// (memoria), WhatsApp y la captura. No toca nada real.
//
//     node backend/tests/sorteos/unSorteoActivoPorPrecio.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { finDelEvento } = require(r("shared/eventos/estadosGestion.js"));
const { precioDe } = require(r("shared/eventos/unSorteoPorPrecio.js"));

const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000 ... $15.000
const T1K = "reservas_dos_cifras";        // $1.000 ... $2.000
const MED = "identidad-medellin";
const PNG = Buffer.from("png-simulado");

let enviados = [];

// Medellín $3.000 activo en g1 y g2 (tabla T5K), con reservas y pagos.
function escenario({ extra = [] } = {}) {
    fake = crearFake();
    enviados = [];
    const t = fake.tablas;
    t.grupos_autorizados = ["g1@g.us", "g2@g.us", "g3@g.us"].map(g => ({ usuario_id: A, grupo_id: g, activo: true }));
    t.grupos = ["g1@g.us", "g2@g.us", "g3@g.us"].map(g => ({ jid: g, nombre: `Grupo ${g}` }));
    t.cuentas_pago = [{ id: "c1", usuario_id: A, nombre: "Nequi", tipo: "nequi", numero: "3001234567", titular: "Ana", activa: true }];
    t.reservas_archivo = [];
    t.eventos_bot = [
        evento("ev-med-g1", A, "g1@g.us", MED, T5K),
        evento("ev-med-g2", A, "g2@g.us", MED, T5K),
        ...extra
    ];
    for (const tabla of [T5K, T1K]) t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    Object.assign(t[T5K].find(f => f.usuario_id === A && f.numero === "07"), { estado: "pagado", identidad_evento_real: MED });
    Object.assign(t[T5K].find(f => f.usuario_id === A && f.numero === "08"), { estado: "reservado", identidad_evento_real: MED });
}

function evento(id, usuario, grupo, identidad, tabla, cambios = {}) {
    return {
        id, usuario_id: usuario, grupo_id: grupo, grupo_nombre: `Grupo ${grupo}`, session_id: "s", activo: true, abierto: true, estado: "abierto",
        identidad_evento_real: identidad, nombre_evento: "Lotería de Medellín", hora_fin: "22:30", hora_cierre: "22:00", fecha_evento: "2026-10-22",
        valor: tabla === T5K ? 3000 : 1000, tabla, cifras: 2, cantidad_numeros: 100, premios: [{ nombre: "Mayor", premio: 100000 }],
        creado_en: "2026-10-21T12:00:00Z", ...cambios
    };
}

function entrada(cambios = {}) {
    return {
        modalidad: "dos_cifras", nombre: "Lotería de Bogotá", hora_fin: "22:30", hora_cierre: "22:00", valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["c1"],
        publicar_en: PUBLICAR.toISOString(), fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: [], diseno: { origen: "actual" }, ...cambios
    };
}

const sock = () => ({
    context: { usuarioId: A, sessionId: "s", telefono: "573000000000" }, user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: jid, participants: [{}] }), groupSettingUpdate: async () => {},
    sendMessage: async (jid, c) => { enviados.push({ jid, imagen: !!c.image, texto: c.caption ?? c.text }); return { key: { id: "m" } }; }
});

const deps = (cambios = {}) => ({
    supabase: { from: (t) => fake.client.from(t) }, guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true, capturarImagen: async () => PNG, textoParaCompartir: destinos.textoParaCompartir, compartirEnGrupos,
    sendMessage: async () => { throw new Error("nunca texto solo"); }, ...cambios
});

async function programar(datos) {
    const c = await servicio.crearSorteo(A, datos);
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
    return c.data;
}

const tick = (d = deps(), ahora = EN_PUBLICACION) => publicador.tick(sock(), { ahora, deps: d });
const ev = (id) => fake.tablas.eventos_bot.find(e => e.id === id);
const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDb = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const numerosDe = (u, tabla) => JSON.stringify(fake.tablas[tabla].filter(f => f.usuario_id === u));

// Sorteos activos (identidades) por cliente y PRECIO, con la misma regla que la 043.
function activosPorPrecio() {
    const mapa = new Map();
    for (const e of fake.tablas.eventos_bot) {
        if (e.activo !== true || finDelEvento(e) || !precioDe(e.valor)) continue;
        const k = `${e.usuario_id}|$${precioDe(e.valor)}`;
        if (!mapa.has(k)) mapa.set(k, new Set());
        mapa.get(k).add(e.identidad_evento_real);
    }
    return mapa;
}
const invarianteUnPrecio = () => {
    for (const [k, ids] of activosPorPrecio()) assert.ok(ids.size <= 1, `dos sorteos activos en ${k}: ${[...ids].join(", ")}`);
};
const activo = (id) => ev(id).activo === true && !finDelEvento(ev(id));

const silenciar = async (fn) => {
    const c = { ...console };
    for (const m of ["log", "warn", "error", "table", "dir"]) console[m] = () => {};
    try { return await fn(); } finally { Object.assign(console, c); }
};
const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn: () => silenciar(fn) });

// ========================================================== activación

prueba("1. Programado en g1 sobre una tabla con Medellín activo en g1 y g2: Medellín se reemplaza en LOS DOS; sin mensaje de cierre; números intactos", async () => {
    escenario();
    const numeros = numerosDe(A, T5K);
    const s = await programar(entrada());
    await tick();
    assert.strictEqual(sorteoDb(s.id).estado, "publicado", JSON.stringify(grupoDb(s.id, "g1@g.us")));
    for (const id of ["ev-med-g1", "ev-med-g2"]) {
        assert.strictEqual(ev(id).activo, false, id);
        assert.match(ev(id).cierre_motivo, /^sustituido por el sorteo Lotería de Bogotá/, id);
    }
    const bogota = fake.tablas.eventos_bot.filter(e => e.identidad_evento_real === sorteoDb(s.id).identidad_evento_real);
    assert.deepStrictEqual(bogota.map(e => [e.grupo_id, e.activo]), [["g1@g.us", true]]);
    assert.deepStrictEqual(enviados.map(e => [e.jid, e.imagen]), [["g1@g.us", true]], "solo la imagen del sorteo nuevo; ningún mensaje de cierre");
    assert.strictEqual(numerosDe(A, T5K), numeros, "reservas y pagos intactos");
    invarianteUnPrecio();
});

prueba("2. Vista previa: avisa del reemplazo en todos los grupos y queda «Listo» (ya no «esperará»)", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada({ publicacion_inmediata: true, publicar_en: null }));
    assert.ok(c.ok, JSON.stringify(c));
    const v = (await servicio.vistaPrevia(A, c.data.id)).data;
    assert.strictEqual(v.estado_publicacion, "listo", JSON.stringify(v.grupos));
    assert.ok(v.avisos.some(a => /El precio \$3\.000 tiene activo «Lotería de Medellín 22:30» en 2 grupo\(s\)\. Al publicar, si sigue activo, se reemplazará en todos ellos/.test(a)), JSON.stringify(v.avisos));
    assert.deepStrictEqual(v.bloqueos, []);
});

prueba("3. Sorteo propio de OTRO precio abierto en g1 (y en g3): se cierra solo en g1 (un sorteo por grupo); en g3 sigue", async () => {
    escenario({ extra: [evento("ev-chica-g1", A, "g1@g.us", "chica", T1K, { nombre_evento: "Chica" }), evento("ev-chica-g3", A, "g3@g.us", "chica", T1K, { nombre_evento: "Chica" })] });
    const s = await programar(entrada());
    await tick();
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(ev("ev-chica-g1").activo, false, "otro precio: reemplazado en el grupo donde se publica");
    assert.strictEqual(ev("ev-chica-g3").activo, true, "otro precio: en sus otros grupos sigue");
    invarianteUnPrecio();
});

// ============================================== independencia por precio

prueba("3b. $3.000 y $10.000 activos a la vez (misma tabla física, grupos distintos); reservas del de $3.000 intactas", async () => {
    escenario();
    const numeros = numerosDe(A, T5K);
    const s = await programar(entrada({ valor: 10000, nombre: "Gran Sorteo", grupos: ["g3@g.us"] }));
    assert.strictEqual(sorteoDb(s.id).tabla, T5K, "precondición: misma tabla física que Medellín $3.000");
    await tick();
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.ok(activo("ev-med-g1") && activo("ev-med-g2"), "Medellín $3.000 sigue activo en g1 y g2");
    assert.ok(fake.tablas.eventos_bot.some(e => e.grupo_id === "g3@g.us" && e.activo && precioDe(e.valor) === 10000), "$10.000 activo en g3");
    assert.strictEqual(numerosDe(A, T5K), numeros, "reservas y pagos del de $3.000 intactos, sin reasignar");
    invarianteUnPrecio();
});

prueba("3c. $5.000 y $15.000 activos a la vez (dos programados, misma tabla física)", async () => {
    escenario();
    const cinco = await programar(entrada({ valor: 5000, nombre: "Cinco Mil", grupos: ["g3@g.us"] }));
    const quince = await programar(entrada({ valor: 15000, nombre: "Quince Mil", grupos: ["g2@g.us"] }));
    await tick();
    assert.ok([cinco, quince].every(x => sorteoDb(x.id).estado === "publicado"));
    const activosA = fake.tablas.eventos_bot.filter(e => e.usuario_id === A && e.activo && !finDelEvento(e));
    assert.deepStrictEqual([...new Set(activosA.map(e => precioDe(e.valor)))].sort((x, y) => x - y), [3000, 5000, 15000], "tres precios activos a la vez");
    invarianteUnPrecio();
});

prueba("3d. Dos sorteos de $10.000: el nuevo reemplaza al anterior en TODOS sus grupos; el de $3.000 no se toca", async () => {
    escenario({ extra: [evento("ev-diez-g2", A, "g2@g.us", "diez-viejo", T5K, { nombre_evento: "Diez Viejo", valor: 10000 }), evento("ev-diez-g3", A, "g3@g.us", "diez-viejo", T5K, { nombre_evento: "Diez Viejo", valor: 10000 })] });
    // Medellín $3.000 solo en g1 para que g2/g3 tengan solo el de $10.000.
    fake.tablas.eventos_bot = fake.tablas.eventos_bot.filter(e => e.id !== "ev-med-g2");
    const s = await programar(entrada({ valor: 10000, nombre: "Diez Nuevo", grupos: ["g3@g.us"] }));
    await tick();
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    for (const id of ["ev-diez-g2", "ev-diez-g3"]) {
        assert.strictEqual(ev(id).activo, false, id);
        assert.match(ev(id).cierre_motivo, /^sustituido por el sorteo Diez Nuevo/, id);
    }
    assert.ok(activo("ev-med-g1"), "Medellín $3.000 sigue activo");
    invarianteUnPrecio();
});

prueba("4. Sorteo de OTRA cuenta abierto en g1: el programado espera y no se cierra nada", async () => {
    escenario({ extra: [evento("ev-b-g1", B, "g1@g.us", "de-b", T5K, { nombre_evento: "De B" })] });
    const antes = JSON.stringify(fake.tablas.eventos_bot);
    const s = await programar(entrada());
    await tick();
    assert.strictEqual(grupoDb(s.id, "g1@g.us").estado, "pendiente");
    assert.match(grupoDb(s.id, "g1@g.us").ultimo_error, /^En espera: Otra cuenta tiene un sorteo abierto/);
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes, "ninguna fila cambia");
    assert.strictEqual(enviados.length, 0);
});

prueba("5. Aislamiento: el sorteo de OTRO cliente en la misma tabla física (otro grupo) no se toca", async () => {
    escenario({ extra: [evento("ev-b-g9", B, "g9@g.us", "de-b", T5K, { nombre_evento: "De B" })] });
    const numerosB = numerosDe(B, T5K);
    const s = await programar(entrada());
    await tick();
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(ev("ev-b-g9").activo, true);
    assert.strictEqual(ev("ev-b-g9").cierre_motivo, undefined);
    assert.strictEqual(numerosDe(B, T5K), numerosB);
});

prueba("6. La captura de la imagen falla: no se cierra NADA y no se publica", async () => {
    escenario();
    const antes = JSON.stringify(fake.tablas.eventos_bot);
    const s = await programar(entrada());
    await tick(deps({ capturarImagen: async () => { throw new Error("Chromium no arrancó"); } }));
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes, "Medellín sigue activo en g1 y g2");
    assert.notStrictEqual(grupoDb(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(enviados.length, 0);
});

prueba("7. Guardar el sorteo nuevo falla (p. ej. la 043 lo rechaza): el reemplazo se deshace en todos los grupos", async () => {
    escenario();
    const s = await programar(entrada());
    await tick(deps({ guardarEvento: async () => null }));
    for (const id of ["ev-med-g1", "ev-med-g2"]) {
        assert.strictEqual(ev(id).activo, true, `${id} restaurado`);
        assert.strictEqual(ev(id).estado, "abierto");
        assert.strictEqual(ev(id).cierre_motivo ?? null, null);
    }
    assert.strictEqual(grupoDb(s.id, "g1@g.us").estado, "fallido");
    assert.strictEqual(enviados.length, 0);
});

prueba("8. $10.000 en el MISMO grupo que el $3.000: lo reemplaza SOLO en ese grupo (un sorteo por grupo); en g2 el $3.000 sigue", async () => {
    escenario();
    const s = await programar(entrada({ valor: 10000, nombre: "Gran Sorteo" }));
    await tick();
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(ev("ev-med-g1").activo, false, "en g1 se reemplaza");
    assert.ok(activo("ev-med-g2"), "en g2 el de $3.000 sigue activo");
    invarianteUnPrecio();
});

// ========================================================== concurrencia

prueba("9. Dos programados del MISMO precio a la misma hora (g1 y g2): nunca quedan dos activos", async () => {
    escenario();
    const bogota = await programar(entrada());
    const cali = await programar(entrada({ nombre: "Lotería de Cali", grupos: ["g2@g.us"] }));
    await tick();
    invarianteUnPrecio();
    const activos = fake.tablas.eventos_bot.filter(e => e.activo && !finDelEvento(e) && precioDe(e.valor) === 3000 && e.usuario_id === A);
    assert.strictEqual(new Set(activos.map(e => e.identidad_evento_real)).size, 1, "un solo sorteo de $3.000 activo");
    assert.ok([sorteoDb(bogota.id), sorteoDb(cali.id)].every(s => s.estado === "publicado"), "los dos se publicaron; el último reemplazó al primero");
});

prueba("9b. Dos programados de PRECIOS distintos a la misma hora: quedan los dos activos", async () => {
    escenario();
    fake.tablas.eventos_bot = [];
    const tres = await programar(entrada({ grupos: ["g1@g.us"] }));
    const diez = await programar(entrada({ valor: 10000, nombre: "Gran Sorteo", grupos: ["g2@g.us"] }));
    await tick();
    const activos = fake.tablas.eventos_bot.filter(e => e.activo && !finDelEvento(e));
    assert.deepStrictEqual(activos.map(e => precioDe(e.valor)).sort((x, y) => x - y), [3000, 10000]);
    assert.ok([tres, diez].every(x => sorteoDb(x.id).estado === "publicado"));
});

prueba("10. Dos ciclos del publicador en paralelo: sin duplicar envíos y con un solo sorteo activo por precio", async () => {
    escenario();
    const s = await programar(entrada());
    await Promise.all([tick(), tick()]);
    invarianteUnPrecio();
    assert.strictEqual(enviados.filter(e => e.jid === "g1@g.us").length, 1, "un solo anuncio");
    assert.strictEqual(fake.tablas.eventos_bot.filter(e => e.identidad_evento_real === sorteoDb(s.id).identidad_evento_real).length, 1, "una sola fila del sorteo nuevo");
});

// ===================================================== reabrir y corregir

prueba("11. Reabrir un sorteo cerrado del MISMO precio con otro activo (otro grupo): rechazado sin «sustituir»; con «sustituir», lo reemplaza en todos", async () => {
    escenario({ extra: [evento("ev-viejo-g3", A, "g3@g.us", "viejo", T5K, { nombre_evento: "Viejo", activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" })] });
    const antes = JSON.stringify(fake.tablas.eventos_bot);
    const r1 = await servicio.eventos.aplicar(A, "ev-viejo-g3", { accion: "reabrir", hora_cierre: "22:00" });
    assert.strictEqual(r1.ok, false);
    assert.strictEqual(r1.motivo, "conflicto");
    assert.match(r1.mensaje, /el precio ya tienen otro sorteo activo \(Lotería de Medellín/);
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes, "nada cambió");
    const r2 = await servicio.eventos.aplicar(A, "ev-viejo-g3", { accion: "reabrir", hora_cierre: "22:00", sustituir: true });
    assert.ok(r2.ok, JSON.stringify(r2));
    assert.strictEqual(ev("ev-viejo-g3").activo, true);
    assert.strictEqual(ev("ev-med-g1").activo, false);
    assert.strictEqual(ev("ev-med-g2").activo, false);
    invarianteUnPrecio();
});

prueba("11b. Reabrir un sorteo cerrado de OTRO precio con el $3.000 activo en otros grupos: se permite sin tocar el de $3.000", async () => {
    escenario({ extra: [evento("ev-diez-g3", A, "g3@g.us", "diez", T5K, { nombre_evento: "Diez", valor: 10000, activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" })] });
    const r = await servicio.eventos.aplicar(A, "ev-diez-g3", { accion: "reabrir", hora_cierre: "22:00" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(activo("ev-diez-g3"), "el de $10.000 reabierto");
    assert.ok(activo("ev-med-g1") && activo("ev-med-g2"), "el de $3.000 sigue activo");
    invarianteUnPrecio();
});

prueba("12. Corregir el precio de un sorteo en curso hacia uno OCUPADO: rechazado, nada cambia", async () => {
    escenario({ extra: [evento("ev-chica-g3", A, "g3@g.us", "chica", T1K, { nombre_evento: "Chica" })] });
    const antes = JSON.stringify([fake.tablas.eventos_bot, fake.tablas[T5K], fake.tablas[T1K]]);
    // «Chica» ($1.000, sin números) pasaría a $3.000: el precio de Medellín.
    const base = { premios: ev("ev-chica-g3").premios, hora_cierre: "22:00" };
    const r = await servicio.activos.editar(A, "ev-chica-g3", { valor: 3000, confirmar_identidad: true, base });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.strictEqual(r.motivo, "conflicto");
    assert.match(r.mensaje, /El precio \$3\.000 ya tiene activo el sorteo «Lotería de Medellín/);
    assert.strictEqual(JSON.stringify([fake.tablas.eventos_bot, fake.tablas[T5K], fake.tablas[T1K]]), antes);
});

prueba("12b. Corregir el precio hacia uno LIBRE de la misma tabla física ($1.000 → $5.000 con $3.000 activo): se permite, el de $3.000 no se toca", async () => {
    escenario({ extra: [evento("ev-chica-g3", A, "g3@g.us", "chica", T1K, { nombre_evento: "Chica" })] });
    const numeros = numerosDe(A, T5K);
    const base = { premios: ev("ev-chica-g3").premios, hora_cierre: "22:00" };
    const r = await servicio.activos.editar(A, "ev-chica-g3", { valor: 5000, confirmar_identidad: true, base });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(precioDe(ev("ev-chica-g3").valor), 5000);
    assert.ok(activo("ev-med-g1") && activo("ev-med-g2"), "el de $3.000 sigue activo");
    assert.strictEqual(numerosDe(A, T5K), numeros, "números del de $3.000 intactos");
    invarianteUnPrecio();
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
