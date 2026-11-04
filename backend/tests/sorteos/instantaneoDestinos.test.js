// ==========================================================================
// PRUEBAS — Destinos de un SORTEO INSTANTÁNEO (03/11). Un instantáneo no
// hereda el flujo de los programados: se publica en el momento, cada destino
// tiene su propio estado, un destino fallido queda en «Error» (sin
// reintentos automáticos ni «Reintentando») y solo ESE destino se reintenta,
// en el momento, sin tocar ni duplicar los ya publicados. Sin «Cancelar
// programación». Los programados conservan su comportamiento.
//
// Mismo arnés que sorteoInstantaneo.test.js: código real de sorteos,
// publicador, Compartir, guardarEvento y ExecutionGuard; Supabase en memoria,
// socket de WhatsApp y captura simulados. Ningún envío real.
//
//     node backend/tests/sorteos/instantaneoDestinos.test.js
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
const { normalizarConfigDiseno } = require(r("sorteos/disenoTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// Hoy 22/10, 10:00 de Colombia; el sorteo se juega hoy a las 22:30.
const AHORA = new Date("2026-10-22T15:00:00Z");
const DESPUES = new Date("2026-10-22T15:01:00Z");
servicio._reloj.ahora = () => AHORA;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000
const T1K = "reservas_dos_cifras";        // $2.000
const PNG = Buffer.from("png-simulado");

const DISENO = {
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
    cells: {
        available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" },
        reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" },
        pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" }
    },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 10, spacing: 6, borderWidth: 1 }
};

// A: grupos g1 y g2; en g1, un sorteo ANTERIOR de $2.000 (otra identidad)
// con reservas y pagos. En $3.000, dos números ya tomados de otro sorteo
// cerrado (no deben tocarse).
function escenario({ anteriorActivo = false } = {}) {
    fake = crearFake();
    enviados = [];
    operaciones = [];
    fallaEnvio = () => null;
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }, { jid: "gb@g.us", nombre: "Grupo B" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [{
        id: "ev-anterior-g1", grupo_id: "g1@g.us", usuario_id: A, activo: anteriorActivo, abierto: anteriorActivo, estado: anteriorActivo ? "abierto" : "cerrado",
        identidad_evento_real: "id-anterior", nombre_evento: "Lotería de Bogotá", tabla: T1K, valor: "2000", cifras: 2, cantidad_numeros: 100,
        hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-22", creado_en: new Date("2026-10-22T12:00:00Z")
    }];
    t.reservas_archivo = [];
    for (const tabla of [T5K, T1K]) {
        t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    }
    t[T1K].filter(f => f.usuario_id === A).slice(0, 6).forEach((f, i) => Object.assign(f, {
        estado: i < 3 ? "pagado" : "reservado", identidad_evento_real: "id-anterior", evento_id: "ev-anterior-g1", grupo_id: "g1@g.us"
    }));
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Antioqueñita Día",
        hora_fin: "22:30",
        valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        publicacion_inmediata: true,
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" },
        recordatorios: [],
        diseno: { origen: "preset", nombre: "Morado", config: DISENO },
        ...extra
    };
}

let enviados = [];
let operaciones = [];
let fallaEnvio = () => null;
const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async (jid, ajuste) => { operaciones.push({ jid, ajuste }); },
    sendMessage: async (jid, contenido) => {
        const error = fallaEnvio(jid);
        if (error) throw new Error(error);
        enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", image: contenido.image, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

// Dependencias del publicador: las REALES de «Compartir»; solo la captura
// (Puppeteer) es simulada y registra con qué se pidió.
let capturas = [];
let capturaFalla = null;
function usarDeps(cambios = {}) {
    capturas = [];
    capturaFalla = null;
    servicio.instantaneo._socketDe = () => sock();
    servicio.instantaneo._deps = {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: async (precio, usuarioId, eventoId, opciones) => {
            capturas.push({ precio, usuarioId, eventoId, datos: opciones?.datos || null });
            if (capturaFalla) throw new Error(capturaFalla);
            return PNG;
        },
        textoParaCompartir: destinos.textoParaCompartir,
        compartirEnGrupos,
        sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); },
        ...cambios
    };
}

async function silencio(fn) {
    const { log, table, dir, warn, error } = console;
    console.log = console.table = console.dir = console.warn = console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error }); }
}

async function crear(datos = entrada(), usuario = A) {
    const c = await silencio(() => servicio.crearSorteo(usuario, datos));
    assert.ok(c.ok, JSON.stringify(c));
    return c.data;
}

const publicar = (s, usuario = A, extra = {}) => silencio(() => servicio.publicarAhora(usuario, s.id, { version: s.version, confirmacion: true, ...extra }));
const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDe = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const eventoDe = (s, g) => fake.tablas.eventos_bot.find(e => e.grupo_id === g && e.usuario_id === A && e.identidad_evento_real === s.identidad_evento_real);
const accionesCompartir = () => (fake.tablas.automation_actions || []).filter(a => a.tipo_accion === "TABLA_COMPARTIR");
const reservasYPagos = () => JSON.stringify({
    t1k: fake.tablas[T1K].filter(f => f.estado !== "libre"),
    t5k: fake.tablas[T5K].filter(f => f.estado !== "libre")
});

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });
const administracion = require(r("sorteos/administracion.js"));

// Tres destinos: g1, g2 y g3 (g3 se añade al escenario base).
function tresDestinos(opciones) {
    escenario(opciones);
    fake.tablas.grupos_autorizados.push({ usuario_id: A, grupo_id: "g3@g.us", activo: true });
    fake.tablas.grupos.push({ jid: "g3@g.us", nombre: "Grupo 3" });
}
const TRES = ["g1@g.us", "g2@g.us", "g3@g.us"];
const enviadosA = (jid) => enviados.filter(e => e.jid === jid).length;
const reintentar = (s, g, usuario = A) => silencio(() => servicio.reintentarGrupo(usuario, s.id, g));
async function gestionDe(s, ahora = AHORA) {
    const d = await silencio(() => administracion.detalle(A, s.id, { ahora }));
    assert.ok(d.ok, JSON.stringify(d));
    return d.data.gestion;
}
const destino = (gestion, g) => gestion.grupos.find(x => x.grupo_id === g);

// Publica en g1, g2 y g3 con g3 fallando en WhatsApp.
async function publicadoConG3Fallido(extra = {}) {
    tresDestinos();
    usarDeps();
    fallaEnvio = (jid) => (jid === "g3@g.us" ? "not-authorized (simulado)" : null);
    const s = await crear(entrada({ grupos: TRES, ...extra }));
    const res = await publicar(s);
    assert.ok(res.ok, JSON.stringify(res));
    return { s, res };
}

// ------------------------------------------------------------- pruebas ---

prueba("1. Publicado en tres destinos: los tres publicados, una imagen por destino, sin «Cancelar programación»", async () => {
    tresDestinos();
    usarDeps();
    const s = await crear(entrada({ grupos: TRES }));
    const res = await publicar(s);
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepStrictEqual([res.data.publicados, res.data.fallidos, res.data.en_revision, res.data.pendientes], [3, 0, 0, 0]);
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 1, 1]);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    const g = await gestionDe(s);
    assert.strictEqual(g.acciones.cancelar, false, "un instantáneo no tiene programación que cancelar");
    assert.deepStrictEqual(g.grupos.map(x => x.estado), ["publicado", "publicado", "publicado"]);
});

prueba("2. Dos publicados y uno fallido: cada destino con su estado; el fallido es «Error» (sin reintento automático), reintentable; sin «Cancelar programación»", async () => {
    const { s, res } = await publicadoConG3Fallido();
    assert.deepStrictEqual([res.data.publicados, res.data.en_revision, res.data.fallidos], [2, 1, 0]);
    assert.deepStrictEqual([grupoDe(s.id, "g1@g.us").estado, grupoDe(s.id, "g2@g.us").estado, grupoDe(s.id, "g3@g.us").estado], ["publicado", "publicado", "requiere_revision"]);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado_parcial");
    const g = await gestionDe(s);
    assert.strictEqual(g.acciones.cancelar, false);
    const g3 = destino(g, "g3@g.us");
    assert.strictEqual(g3.puede_reintentar, true);
    assert.ok(!/Falló el intento|se reintentará solo/.test(g3.explicacion), g3.explicacion);
    assert.ok(!/cancela la programación/.test(g3.intervencion || ""), g3.intervencion);
    assert.strictEqual(destino(g, "g1@g.us").puede_reintentar, false, "un destino publicado no se reintenta");
    // Los ciclos automáticos no tocan el instantáneo: ni reenvían g3 ni repiten g1/g2.
    fallaEnvio = () => null;
    await silencio(() => publicador.tick(sock(), { ahora: DESPUES, deps: servicio.instantaneo._deps }));
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 1, 0]);
});

prueba("3. Reintento del destino fallido: se publica EN EL MOMENTO (sin esperar al ciclo) solo en ese destino", async () => {
    const { s } = await publicadoConG3Fallido();
    const antes = { g1: { ...grupoDe(s.id, "g1@g.us") }, g2: { ...grupoDe(s.id, "g2@g.us") } };
    fallaEnvio = () => null;
    const re = await reintentar(s, "g3@g.us");
    assert.ok(re.ok, JSON.stringify(re));
    assert.strictEqual(grupoDe(s.id, "g3@g.us").estado, "publicado", "publicado sin ciclo del publicador");
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 1, 1]);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.deepStrictEqual({ g1: grupoDe(s.id, "g1@g.us"), g2: grupoDe(s.id, "g2@g.us") }, antes, "los publicados no se modifican");
    assert.ok(eventoDe(s, "g3@g.us")?.activo, "el destino reintentado tiene su sorteo abierto");
    const g = await gestionDe(s);
    assert.ok(g.grupos.every(x => x.estado === "publicado"));
    assert.strictEqual(g.acciones.cancelar, false);
    // Historial del reintento conservado.
    assert.ok((fake.tablas.sorteos_programados_historial || []).some(h => h.accion === "reintentar" && h.sorteo_id === s.id));
});

prueba("4. Reintentos sin duplicar: publicados nunca se repiten; doble clic = un envío; reintentar un publicado se rechaza; un reintento que vuelve a fallar queda en Error", async () => {
    const { s } = await publicadoConG3Fallido();
    // Sigue fallando: vuelve a «Error», no a «Reintentando».
    const re = await reintentar(s, "g3@g.us");
    assert.ok(re.ok, JSON.stringify(re));
    assert.strictEqual(grupoDe(s.id, "g3@g.us").estado, "requiere_revision");
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 1, 0]);
    // Doble clic con WhatsApp ya bien: una sola publicación.
    fallaEnvio = () => null;
    const [x, y] = await Promise.all([reintentar(s, "g3@g.us"), reintentar(s, "g3@g.us")]);
    assert.ok(x.ok || y.ok, JSON.stringify([x, y]));
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 1, 1], "un solo envío a g3 y ninguno nuevo a g1/g2");
    // Un destino publicado no se puede reintentar.
    const otra = await reintentar(s, "g1@g.us");
    assert.deepStrictEqual([otra.ok, otra.motivo], [false, "estado_invalido"]);
    await silencio(() => publicador.tick(sock(), { ahora: DESPUES, deps: servicio.instantaneo._deps }));
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 1, 1]);
    const claves = accionesCompartir().filter(a => a.estado === "ok").map(a => a.clave_idempotencia);
    assert.strictEqual(new Set(claves).size, claves.length);
});

prueba("5. Estado heredado «Reintentando / Falló el intento 0 de 5»: se muestra como Error reintentable, sin cancelar; «Reintentar» lo publica ya y una sola vez", async () => {
    const { s } = await publicadoConG3Fallido();
    // Lo que dejaba el reintento anterior: fallido, intentos 0, sorteo «publicando», esperando un ciclo.
    Object.assign(grupoDe(s.id, "g3@g.us"), { estado: "fallido", intentos: 0, reintentos_manuales: 1, ultimo_error: "reintento manual solicitado" });
    sorteoDb(s.id).estado = "publicando";
    const g = await gestionDe(s);
    const g3 = destino(g, "g3@g.us");
    assert.strictEqual(g.acciones.cancelar, false, "sin «Cancelar programación»");
    assert.strictEqual(g3.puede_reintentar, true);
    assert.ok(!/Falló el intento 0 de 5/.test(g3.explicacion), g3.explicacion);
    fallaEnvio = () => null;
    const re = await reintentar(s, "g3@g.us");
    assert.ok(re.ok, JSON.stringify(re));
    assert.strictEqual(grupoDe(s.id, "g3@g.us").estado, "publicado");
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 1, 1]);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
});

prueba("6. Selección libre de destinos: solo los elegidos (g1 y g3) reciben la publicación", async () => {
    tresDestinos();
    usarDeps();
    const s = await crear(entrada({ grupos: ["g3@g.us", "g1@g.us"] }));
    const res = await publicar(s);
    assert.ok(res.ok && res.data.publicados === 2, JSON.stringify(res));
    assert.deepStrictEqual(TRES.map(enviadosA), [1, 0, 1]);
    assert.deepStrictEqual(res.data.grupos.map(g => g.grupo_id).sort(), ["g1@g.us", "g3@g.us"]);
});

prueba("7. Reintento al día siguiente (sorteo de mañana, antes del cierre): no exige la fecha de una programación", async () => {
    const { s } = await publicadoConG3Fallido({ fecha_sorteo: "2026-10-23" });
    fallaEnvio = () => null;
    servicio._reloj.ahora = () => new Date("2026-10-23T14:00:00Z");
    try {
        const re = await reintentar(s, "g3@g.us");
        assert.ok(re.ok, JSON.stringify(re));
        assert.strictEqual(grupoDe(s.id, "g3@g.us").estado, "publicado", grupoDe(s.id, "g3@g.us").ultimo_error);
    } finally { servicio._reloj.ahora = () => AHORA; }
});

prueba("8. Reintento sin WhatsApp conectado: no se toca el destino (sigue en Error) y se informa", async () => {
    const { s } = await publicadoConG3Fallido();
    const antes = { ...grupoDe(s.id, "g3@g.us") };
    servicio.instantaneo._socketDe = () => null;
    const re = await reintentar(s, "g3@g.us");
    assert.deepStrictEqual([re.ok, re.motivo], [false, "sin_sesion_activa"]);
    assert.deepStrictEqual(grupoDe(s.id, "g3@g.us"), antes);
});

prueba("9. Programado SIN cambios: un fallo queda «fallido» con reintento automático, «Cancelar programación» disponible y el ciclo lo reintenta", async () => {
    tresDestinos();
    usarDeps();
    const p = await silencio(() => servicio.crearSorteo(A, entrada({ publicacion_inmediata: false, publicar_en: "2026-10-22T15:05:00Z", grupos: ["g1@g.us", "g2@g.us"], nombre: "Programado" })));
    assert.ok(p.ok, JSON.stringify(p));
    const c = await silencio(() => servicio.confirmar(A, p.data.id, { version: p.data.version, confirmacion: true }));
    assert.ok(c.ok, JSON.stringify(c));
    // La imagen falla una vez (primer destino del primer ciclo).
    let fallos = 1;
    servicio.instantaneo._deps.capturarImagen = async () => { if (fallos-- > 0) throw new Error("captura simulada"); return PNG; };
    const t1 = new Date("2026-10-22T15:05:30Z");
    await silencio(() => publicador.tick(sock(), { ahora: t1, deps: servicio.instantaneo._deps }));
    const fallido = ["g1@g.us", "g2@g.us"].map(g => grupoDe(p.data.id, g)).find(g => g.estado === "fallido");
    assert.ok(fallido, JSON.stringify(fake.tablas.sorteos_programados_grupos));
    const g = await gestionDe(p.data, t1);
    assert.strictEqual(g.acciones.cancelar, true, "el programado conserva «Cancelar programación»");
    assert.ok(/Falló el intento 1 de 5; se reintentará solo/.test(destino(g, fallido.grupo_id).explicacion), destino(g, fallido.grupo_id).explicacion);
    await silencio(() => publicador.tick(sock(), { ahora: new Date("2026-10-22T15:06:00Z"), deps: servicio.instantaneo._deps }));
    assert.strictEqual(grupoDe(p.data.id, fallido.grupo_id).estado, "publicado", "el ciclo automático lo reintenta");
    assert.deepStrictEqual(["g1@g.us", "g2@g.us"].map(enviadosA), [1, 1]);
});

// ------------------------------------------------------------ ejecución ---

(async () => {
    let ok = 0;
    for (const p of pruebas) {
        try { await p.fn(); ok++; console.log(`✅ ${p.n}`); }
        catch (e) { console.log(`❌ ${p.n}\n   ${e.stack?.split("\n").slice(0, 3).join("\n   ")}`); }
    }
    console.log("============================");
    console.log(`TOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}`);
    console.log("============================");
    process.exit(ok === pruebas.length ? 0 : 1);
})();
