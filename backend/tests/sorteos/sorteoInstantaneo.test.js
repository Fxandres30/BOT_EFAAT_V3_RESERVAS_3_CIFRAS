// ==========================================================================
// PRUEBAS — «Sorteo instantáneo»: crear el sorteo con publicacion_inmediata
// y publicarlo AHORA (servicio.publicarAhora) con el publicador de los
// programados (publicador.tick): evento en el grupo, imagen de la tabla +
// anuncio como pie por compartirEnGrupos (ExecutionGuard), sin texto solo.
// Y la imagen de prueba que genera el servidor antes de publicar
// (servicio.probarImagen, misma función de captura).
//
// Reales: sorteos/{servicio,publicador,validar,disponibilidad,repo,
// mensajes}.js, services/{compartirTabla (compartirEnGrupos),
// destinosCompartir}.js, baileys/send.js, guardarEvento, consultarEvento,
// abrirGrupo, executionGuard, actualizarEvento. Simulados: Supabase
// (memoria), el socket de WhatsApp y la captura con Puppeteer (la captura
// real está en capturaRealSorteo.test.js). Ningún envío real.
//
//     node backend/tests/sorteos/sorteoInstantaneo.test.js
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

// ------------------------------------------------------------- pruebas ---

prueba("1. Publicación instantánea en un grupo: al confirmar se envía YA (imagen + anuncio), el evento queda activo en ese grupo", async () => {
    escenario();
    usarDeps();
    const s = await crear();
    assert.strictEqual(s.estado, "borrador");
    assert.strictEqual(enviados.length, 0, "crear no publica");
    const v = await silencio(() => servicio.vistaPrevia(A, s.id));
    assert.ok(v.ok && v.data.publicacion_inmediata && v.data.estado_publicacion === "listo", JSON.stringify(v.data?.bloqueos));
    assert.strictEqual(enviados.length, 0, "la vista previa no publica");

    const res = await publicar(s);
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepStrictEqual([res.data.publicados, res.data.fallidos, res.data.en_revision, res.data.pendientes], [1, 0, 0, 0]);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(sorteoDb(s.id).publicar_en, AHORA.toISOString(), "publicado en este momento, no a una hora futura");
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].jid, "g1@g.us");
    const ev = eventoDe(s, "g1@g.us");
    assert.ok(ev && ev.activo && ev.abierto && ev.tabla === T5K, JSON.stringify(ev));
    assert.strictEqual(grupoDe(s.id, "g1@g.us").evento_bot_id, ev.id);
    assert.ok(operaciones.some(o => o.jid === "g1@g.us" && o.ajuste === "not_announcement"), "el grupo se abrió");
});

prueba("2. En otro grupo: solo ese grupo recibe la publicación", async () => {
    escenario();
    usarDeps();
    const s = await crear(entrada({ grupos: ["g2@g.us"] }));
    const res = await publicar(s);
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepStrictEqual(enviados.map(e => e.jid), ["g2@g.us"]);
    assert.ok(eventoDe(s, "g2@g.us")?.activo);
    assert.strictEqual(eventoDe(s, "g1@g.us"), undefined, "g1 no recibe nada");
});

prueba("3. La foto va adjunta: imagen de la tabla del sorteo con el anuncio como pie (no texto solo)", async () => {
    escenario();
    usarDeps();
    const s = await crear();
    await publicar(s);
    assert.strictEqual(enviados[0].tipo, "imagen");
    assert.strictEqual(enviados[0].image, PNG, "la imagen capturada");
    assert.ok(enviados[0].texto.includes("Antioqueñita Día") && enviados[0].texto.includes("$3.000") && enviados[0].texto.includes("Nequi A"), enviados[0].texto);
    const c = capturas.find(x => x.eventoId);
    assert.deepStrictEqual([c.precio, c.usuarioId], [3000, A]);
    assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === c.eventoId).identidad_evento_real, s.identidad_evento_real, "imagen del MISMO sorteo que el texto");
    assert.ok(accionesCompartir().some(a => a.clave_idempotencia === `TABLA_COMPARTIR:${A}:3000:sorteo-${s.id}-publicacion-0:g1@g.us` && a.estado === "ok"));
});

prueba("4. Imagen de prueba: el servidor la genera con el diseño del sorteo y sus números; si falla, error claro; nunca envía ni escribe", async () => {
    escenario();
    usarDeps();
    const s = await crear();
    const antes = JSON.stringify(fake.tablas);
    const ok = await silencio(() => servicio.probarImagen(A, s.id));
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.strictEqual(ok.data.imagen, `data:image/png;base64,${PNG.toString("base64")}`);
    assert.strictEqual(capturas[0].eventoId, null);
    assert.deepStrictEqual(capturas[0].datos.diseno, normalizarConfigDiseno(DISENO), "el diseño guardado en el sorteo");
    assert.strictEqual(capturas[0].datos.numerosDisponibles.length + capturas[0].datos.numerosOcupados.length, 100);

    capturaFalla = "Waiting for selector `[data-tabla-imprimir]` failed (panel abierto por el servidor: otro-panel.vercel.app; debe ser el panel de EFAAT, revisa FRONTEND_URL)";
    const mal = await silencio(() => servicio.probarImagen(A, s.id));
    assert.strictEqual(mal.ok, false);
    assert.strictEqual(mal.motivo, "error_imagen");
    assert.ok(/no pudo generar la imagen/.test(mal.mensaje) && /otro-panel\.vercel\.app/.test(mal.mensaje), mal.mensaje);
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(JSON.stringify(fake.tablas), antes, "probar la imagen no escribe nada");
});

prueba("5. Imagen ausente al publicar: no se envía NADA (ni texto), el grupo queda con error y el motivo real", async () => {
    escenario();
    usarDeps();
    capturaFalla = "net::ERR_CONNECTION_REFUSED (panel abierto por el servidor: localhost:3000; debe ser el panel de EFAAT, revisa FRONTEND_URL)";
    const s = await crear();
    const res = await publicar(s);
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepStrictEqual([res.data.publicados, res.data.fallidos], [0, 1]);
    assert.ok(/imagen/.test(res.data.grupos[0].error) && /ERR_CONNECTION_REFUSED/.test(res.data.grupos[0].error), res.data.grupos[0].error);
    assert.strictEqual(enviados.length, 0, "sin imagen no sale ni el texto");
    assert.ok(!operaciones.some(o => o.ajuste === "not_announcement"), "el grupo no se abre");
});

prueba("6. Reintento y doble clic: una sola publicación y un solo mensaje", async () => {
    escenario();
    usarDeps();
    const s = await crear();
    const [x, y] = await Promise.all([publicar(s), publicar(s)]);
    assert.ok(x.ok && y.ok, JSON.stringify([x, y]));
    assert.strictEqual([x, y].filter(v => v.data.repetido).length, 1, "uno publica, el otro informa el estado");
    const otra = await publicar(s);
    assert.ok(otra.ok && otra.data.repetido);
    assert.strictEqual(enviados.length, 1, "un solo mensaje");
    assert.strictEqual(accionesCompartir().length, 1);
    assert.strictEqual(fake.tablas.sorteos_programados.length, 1, "un solo sorteo");
    assert.strictEqual(fake.tablas.eventos_bot.filter(e => e.identidad_evento_real === s.identidad_evento_real).length, 1, "un solo evento");
    // El ciclo automático siguiente tampoco lo repite.
    await silencio(() => publicador.tick(sock(), { ahora: DESPUES, deps: servicio.instantaneo._deps }));
    assert.strictEqual(enviados.length, 1);
});

prueba("7. Grupo con un sorteo activo: sin «Sustituir» no se publica (y lo dice); con «Sustituir» se publica y el anterior conserva reservas y pagos", async () => {
    escenario({ anteriorActivo: true });
    usarDeps();
    const antes = reservasYPagos();
    const s = await crear();
    const res = await publicar(s);
    assert.strictEqual(res.ok, false);
    assert.ok(["bloqueado", "no_inmediato"].includes(res.motivo), JSON.stringify(res));
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(sorteoDb(s.id).estado, "borrador", "no se confirmó: se puede corregir");
    assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === "ev-anterior-g1").activo, true, "el sorteo actual no se toca");

    const s2 = await crear(entrada({ sustituir_activo: true, nombre: "Sinuano Noche" }));
    const res2 = await publicar(s2);
    assert.ok(res2.ok && res2.data.publicados === 1, JSON.stringify(res2));
    const anterior = fake.tablas.eventos_bot.find(e => e.id === "ev-anterior-g1");
    assert.strictEqual(anterior.activo, false);
    assert.ok(/^sustituido/.test(anterior.cierre_motivo || ""), anterior.cierre_motivo);
    assert.strictEqual(reservasYPagos(), antes, "reservas y pagos del anterior intactos");
});

prueba("8. Publicar no altera reservas ni pagos existentes", async () => {
    escenario();
    usarDeps();
    const antes = reservasYPagos();
    await publicar(await crear());
    assert.strictEqual(reservasYPagos(), antes);
});

prueba("9. Aislamiento: otro cliente no puede publicar ni probar la imagen del sorteo de A", async () => {
    escenario();
    usarDeps();
    const s = await crear();
    const r1 = await publicar(s, B);
    assert.deepStrictEqual([r1.ok, r1.motivo], [false, "no_encontrado"]);
    const r2 = await silencio(() => servicio.probarImagen(B, s.id));
    assert.deepStrictEqual([r2.ok, r2.motivo], [false, "no_encontrado"]);
    assert.strictEqual(sorteoDb(s.id).estado, "borrador");
    assert.strictEqual(enviados.length, 0);
});

prueba("10. Instantáneo ≠ programado: reglas de hora, confirmar vs publicar ahora, y el ciclo automático no publica un borrador", async () => {
    escenario();
    usarDeps();
    // Programado: exige al menos 1 minuto en el futuro (sin cambios).
    const prog = await silencio(() => servicio.crearSorteo(A, entrada({ publicacion_inmediata: false, publicar_en: AHORA.toISOString() })));
    assert.strictEqual(prog.ok, false);
    assert.ok(prog.errores.some(e => e.campo === "publicar_en"));
    // Instantáneo: sin hora de publicación; confirmar (programar) no vale.
    const s = await crear();
    const conf = await silencio(() => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true }));
    assert.strictEqual(conf.ok, false);
    assert.ok(conf.errores.some(e => e.campo === "publicacion_inmediata"));
    // Un programado no se puede «publicar ahora».
    const p = await silencio(() => servicio.crearSorteo(A, entrada({ publicacion_inmediata: false, publicar_en: "2026-10-22T20:00:00Z", grupos: ["g2@g.us"], nombre: "Programado" })));
    assert.ok(p.ok, JSON.stringify(p));
    const pa = await silencio(() => servicio.publicarAhora(A, p.data.id, { version: p.data.version, confirmacion: true }));
    assert.strictEqual(pa.ok, false);
    // El ciclo automático nunca publica un borrador instantáneo.
    await silencio(() => publicador.tick(sock(), { ahora: DESPUES, deps: servicio.instantaneo._deps }));
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(sorteoDb(s.id).estado, "borrador");
    // Cierre ya pasado: no se puede publicar ahora.
    const tarde = await silencio(() => servicio.crearSorteo(A, entrada({ hora_fin: "09:00" })));
    assert.strictEqual(tarde.ok, false);
    assert.ok(tarde.errores.some(e => e.campo === "hora_cierre" && /ya pasó/.test(e.mensaje)), JSON.stringify(tarde.errores));
});

prueba("11. WhatsApp falla: error real sin darlo por publicado, nunca se reenvía solo; «Reintentar» lo envía una sola vez", async () => {
    escenario();
    usarDeps();
    fallaEnvio = () => "not-authorized (simulado)";
    const s = await crear();
    const res = await publicar(s);
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepStrictEqual([res.data.publicados, res.data.en_revision], [0, 1]);
    assert.strictEqual(res.data.grupos[0].estado, "requiere_revision");
    assert.ok(/no se pudo enviar: not-authorized/.test(res.data.grupos[0].error), res.data.grupos[0].error);
    assert.strictEqual(enviados.length, 0);

    // WhatsApp vuelve: los ciclos automáticos no reenvían un envío incierto.
    fallaEnvio = () => null;
    for (const t of [DESPUES, new Date("2026-10-22T15:02:00Z")]) {
        await silencio(() => publicador.tick(sock(), { ahora: t, deps: servicio.instantaneo._deps }));
    }
    assert.strictEqual(enviados.length, 0, "sin reenvío automático");

    // Recuperación: «Reintentar» del administrador (mecanismo existente).
    const re = await silencio(() => servicio.reintentarGrupo(A, s.id, "g1@g.us"));
    assert.ok(re.ok, JSON.stringify(re));
    await silencio(() => publicador.tick(sock(), { ahora: new Date("2026-10-22T15:03:00Z"), deps: servicio.instantaneo._deps }));
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(enviados.length, 1, "una sola vez");
});

prueba("12. Sin WhatsApp conectado: no se confirma ni se crea ningún evento", async () => {
    escenario();
    usarDeps();
    servicio.instantaneo._socketDe = () => null;
    const s = await crear();
    const eventos = fake.tablas.eventos_bot.length;
    const res = await publicar(s);
    assert.deepStrictEqual([res.ok, res.motivo], [false, "sin_sesion_activa"]);
    assert.strictEqual(sorteoDb(s.id).estado, "borrador");
    assert.strictEqual(fake.tablas.eventos_bot.length, eventos);
});

prueba("13. Formato no admitido: si la captura no devuelve una imagen, no se envía nada (ni texto) y se informa", async () => {
    for (const mala of [Buffer.alloc(0), "no-es-imagen", null]) {
        escenario();
        usarDeps({ capturarImagen: async () => mala });
        const s = await crear();
        const res = await publicar(s);
        assert.ok(res.ok, JSON.stringify(res));
        assert.strictEqual(res.data.publicados, 0, `captura ${JSON.stringify(mala)}`);
        assert.ok(res.data.grupos[0].error, "con el motivo");
        assert.strictEqual(enviados.length, 0, "ni imagen ni texto");
        const prueba = await silencio(() => servicio.probarImagen(A, s.id));
        assert.deepStrictEqual([prueba.ok, prueba.motivo], [false, "error_imagen"], "la prueba previa también lo detecta");
    }
});

prueba("14. Con la captura del panel (capturarTabla de «Compartir»): se envía ESA imagen tal cual y el servidor no genera otra", async () => {
    escenario();
    usarDeps();
    const png = Buffer.alloc(48);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8); png.write("IHDR", 12, "ascii"); png.writeUInt32BE(1408, 16); png.writeUInt32BE(1408, 20);
    const s = await crear();
    const res = await publicar(s, A, { imagen: `data:image/png;base64,${png.toString("base64")}` });
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(res.data.publicados, 1);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].tipo, "imagen");
    assert.ok(Buffer.from(enviados[0].image).equals(png), "la imagen enviada es la del panel");
    assert.strictEqual(capturas.length, 0, "sin segunda generación");

});

prueba("15. Captura del panel inválida: 400 imagen_invalida y NADA cambia (ni confirmación, ni evento, ni mensajes)", async () => {
    for (const mala of ["", "data:image/png;base64,QUJD", "data:image/jpeg;base64,/9j/4AAQ", 123, null]) {
        escenario();
        usarDeps();
        const s = await crear();
        const eventos = fake.tablas.eventos_bot.length;
        const res = await publicar(s, A, { imagen: mala });
        assert.deepStrictEqual([res.ok, res.motivo], [false, "imagen_invalida"], JSON.stringify(mala));
        assert.strictEqual(sorteoDb(s.id).estado, "borrador");
        assert.strictEqual(fake.tablas.eventos_bot.length, eventos);
        assert.strictEqual(enviados.length, 0);
        assert.strictEqual(capturas.length, 0);
    }
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
