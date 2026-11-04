// ==========================================================================
// PRUEBAS — RECUPERACIÓN TRAS CAÍDAS, con reinicio REAL de Node.
//
// Cada escenario corre en dos procesos:
//   fase 1  publica (o detecta) y el proceso MUERE (process.exit) en un punto
//           exacto, guardando en disco la base de datos falsa (lo que habría
//           quedado persistido en Supabase) y lo que WhatsApp recibió;
//   fase 2  un proceso NUEVO (sin nada en memoria) arranca con esa base y
//           ejecuta los ciclos normales (publicador + Scheduler).
//
// Escenarios:
//   1. WhatsApp RECIBIÓ el anuncio y el backend cayó antes de registrarlo
//      (ExecutionGuard «en_progreso»): nunca se reenvía solo; revisión manual.
//   2. Cayó tras registrar el anuncio y antes del ciclo de automatización: se
//      completa SIN reenviar; la apertura sale una vez (dentro de tolerancia).
//   3. Igual que 2, pero el proceso vuelve tarde: el ciclo se abre, la
//      apertura NO se anuncia tarde (queda registrada como omitida).
//   4. Cayó antes de enviar nada: se publica una sola vez (reintento normal).
//   5. WhatsApp (detección): cayó con el ciclo pendiente; se reanuda SOLO si
//      WhatsApp confirma el grupo abierto, y una vez.
//   6. Ciclo abierto cuya apertura nunca llegó a registrarse: se envía una
//      vez; con el registro «en curso» nunca se repite.
//
// Nunca toca Supabase real (Supabase falso + EFAAT_PRUEBAS=1) ni WhatsApp.
//
//     node backend/tests/automation/recuperacionCaidas.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.EFAAT_PRUEBAS = "1";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const argumentos = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")));

// ------------------------------------------------------------ entorno ---

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
const PNG = Buffer.from("png-simulado");
const GRUPOS = ["g1@g.us", "g2@g.us", "g3@g.us"];
const MIN = 60 * 1000;
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
const fechaBogota = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function cargarEntorno() {

    const { crearFake } = require("../sorteos/fakeSupabaseSorteos");
    const fake = crearFake();

    require.cache[r("lib/supabase.js")] = {
        id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
        exports: {
            from: (t) => fake.client.from(t),
            auth: { getUser: (t) => fake.client.auth.getUser(t) },
            rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
        }
    };
    require.cache[r("bot/funciones/usuarios/escanerIdentidadesLifecycle.js")] = {
        id: "escaner", filename: "escaner", loaded: true,
        exports: { escanearGrupo: async () => null, iniciarEscanerIdentidades: () => {}, detenerEscanerIdentidades: () => {}, escanearTodosLosGrupos: async () => null }
    };

    const original = global.setTimeout;
    global.setTimeout = (fn, _ms, ...args) => original(fn, 0, ...args);

    return { fake };

}

function sembrar(fake) {
    const t = fake.tablas;
    const todoElDia = { activo: true, desde: "00:00", hasta: "23:59" };
    const dias = Object.fromEntries(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].map(d => [d, todoElDia]));
    t.grupos_autorizados = GRUPOS.map(g => ({ usuario_id: A, grupo_id: g, activo: true }));
    t.grupos = GRUPOS.map((g, i) => ({ jid: g, nombre: `Grupo ${i + 1}` }));
    t.automation_configs = GRUPOS.map(g => ({ id: `cfg-${g}`, usuario_id: A, grupo_id: g, activo: true, dias_permitidos: dias, mensaje_cierre: { activo: true } }));
    t.automation_messages = [{ id: "msg-open", usuario_id: A, tipo: "OPEN_MESSAGE", categoria: null, texto: "🔓 Grupo abierto: {nombre_evento}", activo: true, nombre_interno: "apertura" }];
    t.automation_message_uses = [];
    t.event_sessions = [];
    t.automation_actions = [];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

// WhatsApp simulado. `estadoGrupos` = lo que groupMetadata devuelve (announce).
function crearSock(ganchos = {}) {
    const enviados = [];
    const estadoGrupos = {};
    const sock = {
        context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
        user: { id: "573000000000:1@s.whatsapp.net" },
        groupMetadata: async (jid) => ({ id: jid, subject: `Nombre ${jid}`, participants: [{}, {}], announce: estadoGrupos[jid] ?? true }),
        groupSettingUpdate: async (jid, ajuste) => {
            if (ajuste === "not_announcement") estadoGrupos[jid] = false;
            if (ajuste === "announcement") estadoGrupos[jid] = true;
            if (ganchos.trasAbrir) ganchos.trasAbrir(jid);
        },
        sendPresenceUpdate: async () => {},
        sendMessage: async (jid, contenido) => {
            enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", texto: contenido.caption ?? contenido.text });
            if (contenido.image && ganchos.trasRecibirImagen) ganchos.trasRecibirImagen(jid);
            return { key: { id: `msg-${enviados.length}` } };
        }
    };
    return { sock, enviados, estadoGrupos };
}

function deps(fake, cambios = {}) {
    return {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento: require(r("bot/funciones/eventos/guardarEvento.js")).guardarEvento,
        consultarEventoDelSorteo: require(r("bot/funciones/eventos/consultarEvento.js")).consultarEventoDelSorteo,
        abrirGrupo: require(r("bot/funciones/eventos/grupos/abrirGrupo.js")).abrirGrupo,
        ejecutarUnaVez: require(r("automation/executionGuard.js")).ejecutarUnaVez,
        actualizarEvento: require(r("bot/funciones/reservas/actualizarEvento.js")).actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: async () => PNG,
        textoParaCompartir: require(r("services/destinosCompartir.js")).textoParaCompartir,
        compartirEnGrupos: require(r("services/compartirTabla.js")).compartirEnGrupos,
        sendMessage: require(r("services/baileys/send.js")).sendMessage,
        ...cambios
    };
}

const silencio = async (fn) => {
    const { log, table, dir, warn, error } = console;
    console.log = console.table = console.dir = console.warn = console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error }); }
};

// «Caída»: se persiste lo que habría quedado en Supabase y en WhatsApp, y el
// proceso muere en el acto (sin finally, sin promesas pendientes).
function caer(archivo, fake, wa) {
    fs.writeFileSync(archivo, JSON.stringify({ tablas: fake.tablas, enviados: wa.enviados, estadoGrupos: wa.estadoGrupos }));
    process.exit(0);
}

async function programarAhora(fake) {
    const servicio = require(r("sorteos/servicio.js"));
    const ahora = Date.now();
    servicio._reloj.ahora = () => new Date(ahora - 60 * MIN);
    const c = await silencio(() => servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Antioqueñita Día", hora_fin: "22:30", valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-a1"],
        publicar_en: new Date(ahora - MIN).toISOString(),
        // Se juega mañana: el cierre siempre queda en el futuro de la prueba.
        fecha_sorteo: fechaBogota(new Date(ahora + 24 * 60 * MIN)),
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: [],
        diseno: { origen: "preset", nombre: "Morado", config: DISENO }
    }));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

// ------------------------------------------------------- fase 1 (muere) ---

async function fase1(escenario, archivo) {

    const { fake } = cargarEntorno();
    sembrar(fake);
    const publicador = require(r("sorteos/publicador.js"));
    let wa;

    if (escenario === "whatsapp_recibio") {
        wa = crearSock({ trasRecibirImagen: () => caer(archivo, fake, wa) });
        await programarAhora(fake);
        await silencio(() => publicador.tick(wa.sock, { deps: deps(fake) }));
    }

    if (escenario === "tras_registro") {
        wa = crearSock();
        await programarAhora(fake);
        await silencio(() => publicador.tick(wa.sock, { deps: deps(fake, { motorEventos: { procesarEventoPublicado: async () => caer(archivo, fake, wa) } }) }));
    }

    if (escenario === "antes_envio") {
        wa = crearSock();
        await programarAhora(fake);
        await silencio(() => publicador.tick(wa.sock, { deps: deps(fake, { capturarImagen: async () => caer(archivo, fake, wa) }) }));
    }

    if (escenario === "deteccion_pendiente") {
        // Cae justo después de que WhatsApp abrió el grupo: el ciclo quedó
        // «pendiente» (se crea antes de abrir) y nunca se confirmó.
        wa = crearSock({ trasAbrir: () => caer(archivo, fake, wa) });
        const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));
        const texto = "🎰 Antioqueñita Día - 10:30 PM\n\n🍀 Dos últimas cifras → $300.000\n\n🎯 Valor número: $3.000";
        await silencio(() => detectarEvento({ sock: wa.sock, grupo: { remoteJid: "g3@g.us" }, chat: { remoteJid: "g3@g.us", esGrupo: true }, textoOriginal: texto, session: { usuarioId: A } }));
    }

    throw new Error(`fase 1 de «${escenario}» terminó sin caer`);

}

// ------------------------------------------------ fase 2 (proceso nuevo) ---

async function fase2(escenario, archivo, minutosDespues, extra) {

    const { fake } = cargarEntorno();
    const guardado = JSON.parse(fs.readFileSync(archivo, "utf8"));
    Object.assign(fake.tablas, guardado.tablas);
    const wa = crearSock();
    Object.assign(wa.estadoGrupos, guardado.estadoGrupos || {});
    if (extra === "grupo_cerrado") for (const g of Object.keys(wa.estadoGrupos)) wa.estadoGrupos[g] = true;

    const publicador = require(r("sorteos/publicador.js"));
    const scheduler = require(r("automation/scheduler.js"));
    const motor = require(r("automation/motorEventos.js"));

    const ahora = new Date(Date.now() + minutosDespues * MIN);
    const ronda = async (t) => {
        await silencio(() => publicador.tick(wa.sock, { ahora: t, deps: deps(fake) }));
        await silencio(() => scheduler.tick(wa.sock, { ahora: t }));
        await silencio(() => motor.esperarEnvios());
    };
    await ronda(ahora);
    await ronda(new Date(ahora.getTime() + 30000));
    await ronda(new Date(ahora.getTime() + 60000));

    return {
        antes: guardado.enviados,
        despues: wa.enviados,
        grupos: fake.tablas.sorteos_programados_grupos || [],
        sesiones: fake.tablas.event_sessions,
        acciones: fake.tablas.automation_actions
    };

}

// ------------------------------------------------------- orquestador ---

function ejecutar(escenario, { minutosDespues = 11, extra = "" } = {}) {
    const archivo = path.join(os.tmpdir(), `efaat-caida-${escenario}-${process.pid}-${Date.now()}.json`);
    const env = { ...process.env, EFAAT_PRUEBAS: "1" };
    const uno = spawnSync(process.execPath, [__filename, "--fase=1", `--escenario=${escenario}`, `--archivo=${archivo}`], { env, encoding: "utf8" });
    assert.ok(fs.existsSync(archivo), `fase 1 de ${escenario} no cayó: ${uno.stdout}${uno.stderr}`);
    const dos = spawnSync(process.execPath, [__filename, "--fase=2", `--escenario=${escenario}`, `--archivo=${archivo}`, `--min=${minutosDespues}`, `--extra=${extra}`], { env, encoding: "utf8" });
    fs.unlinkSync(archivo);
    const linea = (dos.stdout || "").split("\n").find(l => l.startsWith("RESULTADO "));
    assert.ok(linea, `fase 2 de ${escenario} sin resultado: ${dos.stdout}${dos.stderr}`);
    return JSON.parse(linea.slice("RESULTADO ".length));
}

const imagenes = (lista, g) => lista.filter(e => e.tipo === "imagen" && (!g || e.jid === g));
const aperturas = (lista, g) => lista.filter(e => e.tipo === "texto" && e.texto?.startsWith("🔓 Grupo abierto") && (!g || e.jid === g));

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("1. WhatsApp RECIBIÓ el anuncio y el backend cayó antes de registrarlo: no se reenvía; queda en revisión", async () => {
    const x = ejecutar("whatsapp_recibio");
    assert.strictEqual(imagenes(x.antes, "g1@g.us").length, 1, "WhatsApp lo recibió antes de la caída");
    const anuncio = x.acciones.find(a => a.tipo_accion === "TABLA_COMPARTIR");
    assert.strictEqual(anuncio.estado, "en_progreso", "el registro quedó «en curso» (incierto)");
    assert.strictEqual(imagenes(x.despues).length, 0, "tras reiniciar, NO se reenvía el anuncio");
    assert.strictEqual(aperturas(x.despues).length, 0, "ni se anuncia una apertura sin certeza");
    const g = x.grupos.find(f => f.grupo_id === "g1@g.us");
    assert.strictEqual(g.estado, "requiere_revision");
    assert.match(g.ultimo_error, /no se sabe si llegó/);
    assert.strictEqual(x.sesiones.length, 0, "sin ciclo de automatización hasta que el administrador decida");
});

prueba("2. Cayó tras registrar el anuncio y antes del ciclo: se completa sin reenviar; una apertura", async () => {
    const x = ejecutar("tras_registro", { minutosDespues: 11 });
    assert.strictEqual(imagenes(x.antes).length, 1);
    assert.strictEqual(imagenes(x.despues).length, 0, "el anuncio no se repite");
    const g = x.grupos.find(f => f.grupo_id === "g1@g.us");
    assert.strictEqual(g.estado, "publicado", "el grupo queda publicado");
    assert.ok(g.evento_bot_id, "enlazado a su evento");
    assert.strictEqual(x.sesiones.length, 1, "un ciclo");
    assert.strictEqual(x.sesiones[0].estado, "abierto");
    assert.strictEqual(aperturas(x.despues, "g1@g.us").length, 1, "una apertura, dentro de la tolerancia");
    const ti = x.acciones.filter(a => a.tipo_accion === "INITIAL_TABLE");
    assert.strictEqual(ti.length, 1, "tabla inicial cubierta por el anuncio");
});

prueba("3. Igual que 2 pero el proceso vuelve tarde (20 min): ciclo abierto, apertura NO anunciada tarde", async () => {
    const x = ejecutar("tras_registro", { minutosDespues: 20 });
    assert.strictEqual(imagenes(x.despues).length, 0);
    assert.strictEqual(x.grupos.find(f => f.grupo_id === "g1@g.us").estado, "publicado");
    assert.strictEqual(x.sesiones[0].estado, "abierto", "el ciclo funciona (recordatorios, cierre)");
    assert.strictEqual(aperturas(x.despues).length, 0, "la apertura no sale tarde");
    const open = x.acciones.filter(a => a.tipo_accion === "OPEN_MESSAGE");
    assert.strictEqual(open.length, 1);
    assert.strictEqual(open[0].detalle?.resultado?.omitido, true, "queda registrada como omitida: nunca saldrá");
});

prueba("4. Cayó antes de enviar nada: se publica una sola vez con el reintento normal", async () => {
    const x = ejecutar("antes_envio");
    assert.strictEqual(x.antes.length, 0, "nada salió antes de la caída");
    assert.strictEqual(imagenes(x.despues, "g1@g.us").length, 1, "un anuncio tras reiniciar");
    assert.strictEqual(aperturas(x.despues, "g1@g.us").length, 1, "una apertura");
    assert.strictEqual(x.grupos.find(f => f.grupo_id === "g1@g.us").estado, "publicado");
    assert.strictEqual(x.sesiones.length, 1);
});

prueba("5. WhatsApp: ciclo pendiente tras la caída; se reanuda SOLO con el grupo abierto confirmado, y una vez", async () => {
    const x = ejecutar("deteccion_pendiente", { minutosDespues: 3 });
    assert.strictEqual(x.sesiones.length, 1);
    assert.strictEqual(x.sesiones[0].estado, "abierto", "reanudado tras confirmar el grupo abierto");
    assert.strictEqual(aperturas(x.despues, "g3@g.us").length, 1, "una apertura");

    const cerrado = ejecutar("deteccion_pendiente", { minutosDespues: 3, extra: "grupo_cerrado" });
    assert.strictEqual(cerrado.sesiones[0].estado, "pendiente", "sin confirmación real de WhatsApp no se toca");
    assert.strictEqual(aperturas(cerrado.despues).length, 0);

    const tarde = ejecutar("deteccion_pendiente", { minutosDespues: 30 });
    assert.strictEqual(tarde.sesiones[0].estado, "abierto", "el ciclo se recupera");
    assert.strictEqual(aperturas(tarde.despues).length, 0, "pero la apertura no sale tarde");
});

prueba("6. Ciclo abierto sin apertura registrada: se envía una vez; con el registro «en curso» nunca se repite", async () => {
    const { fake } = cargarEntorno();
    sembrar(fake);
    const motor = require(r("automation/motorEventos.js"));
    const scheduler = require(r("automation/scheduler.js"));
    const wa = crearSock();
    const ahora = new Date();
    fake.tablas.eventos_bot.push({ id: "ev-1", usuario_id: A, grupo_id: "g1@g.us", activo: true, abierto: true, estado: "abierto", nombre_evento: "Antioqueñita Día", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaBogota(new Date(Date.now() + 24 * 60 * MIN)), valor: 3000, tabla: T5K });
    fake.tablas.event_sessions.push({ id: "ses-1", evento_id: "ev-1", grupo_id: "g1@g.us", usuario_id: A, session_id: "ses-aaaa", estado: "abierto", abierto_en: new Date(ahora.getTime() - 3 * MIN).toISOString(), creado_en: new Date(ahora.getTime() - 3 * MIN).toISOString(), datos_evento_snapshot: {} });
    fake.tablas.eventos_bot.push({ id: "ev-2", usuario_id: A, grupo_id: "g2@g.us", activo: true, abierto: true, estado: "abierto", nombre_evento: "Antioqueñita Día", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaBogota(new Date(Date.now() + 24 * 60 * MIN)), valor: 3000, tabla: T5K });
    fake.tablas.event_sessions.push({ id: "ses-2", evento_id: "ev-2", grupo_id: "g2@g.us", usuario_id: A, session_id: "ses-aaaa", estado: "abierto", abierto_en: new Date(ahora.getTime() - 3 * MIN).toISOString(), creado_en: new Date(ahora.getTime() - 3 * MIN).toISOString(), datos_evento_snapshot: {} });
    fake.tablas.automation_actions.push({ id: "en-curso", clave_idempotencia: "ses-2:OPEN_MESSAGE", tipo_accion: "OPEN_MESSAGE", estado: "en_progreso", grupo_id: "g2@g.us", usuario_id: A });
    for (let i = 0; i < 3; i++) {
        await silencio(() => scheduler.tick(wa.sock, { ahora: new Date(ahora.getTime() + i * 30000) }));
        await silencio(() => motor.esperarEnvios());
    }
    assert.strictEqual(aperturas(wa.enviados, "g1@g.us").length, 1, "la apertura perdida sale una vez");
    assert.strictEqual(aperturas(wa.enviados, "g2@g.us").length, 0, "un envío «en curso» (incierto) nunca se repite");
});

// ----------------------------------------------------------------- run ---

(async () => {
    if (argumentos.fase === "1") {
        try { await fase1(argumentos.escenario, argumentos.archivo); } catch (err) { console.log(`ERROR ${err.message}`); }
        process.exit(1);
    }
    if (argumentos.fase === "2") {
        try {
            const x = await fase2(argumentos.escenario, argumentos.archivo, Number(argumentos.min), argumentos.extra);
            console.log(`RESULTADO ${JSON.stringify(x)}`);
        } catch (err) { console.log(`ERROR ${err.stack}`); }
        process.exit(0);
    }
    let fallos = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); console.log(`✅ ${n}`); } catch (err) { fallos++; console.log(`❌ ${n}\n   ${err.message}`); }
    }
    console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK`);
    process.exit(fallos ? 1 : 0);
})();
