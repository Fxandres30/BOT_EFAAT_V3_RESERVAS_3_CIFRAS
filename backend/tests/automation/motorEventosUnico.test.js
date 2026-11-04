// ==========================================================================
// PRUEBAS — UN EVENTO ES UN EVENTO: el mismo motor de aperturas y
// comunicaciones para todo evento publicado, venga de donde venga.
//
// Escenarios (los del encargo del 04/11):
//   A. Evento detectado por WhatsApp y publicado.
//   B. Evento instantáneo publicado desde el panel.
//   C. Evento programado desde el panel, al llegar su hora (y no antes).
//   D. Evento editado después de su publicación (no repite la apertura).
//   E. Evento procesado otra vez por un reintento / reinicio (una sola vez).
//   F. Evento publicado en varios grupos (una apertura por grupo, a su grupo).
//   +  Comunicaciones posteriores: el Scheduler procesa por igual el ciclo
//      de un evento del panel y el de uno detectado (CLOSE_MESSAGE).
//
// Reales: detectarEvento, guardarEvento, abrirGrupo, groupQueue,
// workerEventos, sorteos/{servicio,publicador,repo}, compartirEnGrupos,
// automation/{motorEventos,engine,eventRules,executionGuard,scheduler,
// messageSelector,variableResolver,repo/*}, services/baileys/send.js.
// Simulados: Supabase (memoria), el socket de WhatsApp y la captura de la
// imagen (Puppeteer). Nunca toca Supabase real ni WhatsApp real.
//
//     node backend/tests/automation/motorEventosUnico.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

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

// El escáner de identidades (fire-and-forget tras abrir) queda fuera de alcance.
require.cache[r("bot/funciones/usuarios/escanerIdentidadesLifecycle.js")] = {
    id: "escaner", filename: "escaner", loaded: true,
    exports: { escanearGrupo: async () => null, iniciarEscanerIdentidades: () => {}, detenerEscanerIdentidades: () => {}, escanearTodosLosGrupos: async () => null }
};

// send.js real espera 1-7 s («escribiendo...») antes de cada texto.
const setTimeoutOriginal = global.setTimeout;
global.setTimeout = (fn, _ms, ...args) => setTimeoutOriginal(fn, 0, ...args);

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const scheduler = require(r("automation/scheduler.js"));

let motor = null;
try { motor = require(r("automation/motorEventos.js")); } catch { motor = null; }

// Hoy 15/10; el programado se publica el 22/10 08:00 (Colombia) y se juega
// ese día a las 22:30.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const ANTES = new Date("2026-10-22T12:58:30Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const SIGUIENTE = new Date("2026-10-22T13:01:30Z");
const DESPUES = new Date("2026-10-22T13:05:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000 (configuración base)
const PNG = Buffer.from("png-simulado");
const GRUPOS = ["g1@g.us", "g2@g.us", "g3@g.us"];
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
const TEXTO_APERTURA = "🔓 Grupo abierto: {nombre_evento} — valor {valor}";
const TEXTO_CIERRE = "🔒 Cerrado: {nombre_evento}";

// La misma automatización configurada en TODOS los grupos (activa todos los
// días, todo el día) y un OPEN_MESSAGE y un CLOSE_MESSAGE en el pool.
function escenario() {
    fake = crearFake();
    enviados = [];
    operaciones = [];
    fallaApertura = () => false;
    const t = fake.tablas;
    const todoElDia = { activo: true, desde: "00:00", hasta: "23:59" };
    const dias = Object.fromEntries(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].map(d => [d, todoElDia]));
    t.grupos_autorizados = GRUPOS.map(g => ({ usuario_id: A, grupo_id: g, activo: true }));
    t.grupos = GRUPOS.map((g, i) => ({ jid: g, nombre: `Grupo ${i + 1}` }));
    const todos = Object.fromEntries(Object.keys(dias).map(d => [d, true]));
    t.automation_configs = GRUPOS.map(g => ({
        id: `cfg-${g}`, usuario_id: A, grupo_id: g, activo: true, dias_permitidos: dias, mensaje_cierre: { activo: true },
        // Lo general del grupo, todo activo: recordatorio a 30 min, tabla
        // inicial desde las 00:00 y actualización con cada reserva.
        recordatorios: { 30: { activo: true } },
        publicacion_inicial_tabla: { activo: true, hora: "00:00", dias_permitidos: todos },
        mensaje_actualizacion: { activo: true }, umbral_reservas: 1, cooldown_minutos: 0
    }));
    t.automation_messages = [
        { id: "msg-open", usuario_id: A, tipo: "OPEN_MESSAGE", categoria: null, texto: TEXTO_APERTURA, activo: true, nombre_interno: "apertura" },
        { id: "msg-close", usuario_id: A, tipo: "CLOSE_MESSAGE", categoria: null, texto: TEXTO_CIERRE, activo: true, nombre_interno: "cierre" },
        { id: "msg-rem", usuario_id: A, tipo: "REMINDER_MESSAGE", categoria: null, texto: "⏰ General: {nombre_evento}", activo: true, nombre_interno: "recordatorio" },
        { id: "msg-upd", usuario_id: A, tipo: "UPDATE_MESSAGE", categoria: null, texto: "📈 Actualización: {nombre_evento}", activo: true, nombre_interno: "actualizacion" }
    ];
    t.automation_message_uses = [];
    t.event_sessions = [];
    t.automation_actions = [];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
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
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" },
        recordatorios: [],
        diseno: { origen: "preset", nombre: "Morado", config: DISENO },
        ...extra
    };
}

let enviados = [];
let operaciones = [];
let fallaApertura = () => false;
const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async (jid, ajuste) => {
        if (ajuste === "not_announcement" && fallaApertura(jid)) throw new Error("rate-overlimit simulado");
        operaciones.push({ jid, ajuste });
    },
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

function deps(cambios = {}) {
    return {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: async () => PNG,
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

// Los envíos de apertura van en segundo plano (como siempre en la
// detección): se espera a que terminen antes de comprobar.
async function drenar() {
    for (let i = 0; i < 40; i++) {
        if (motor?.esperarEnvios) await motor.esperarEnvios();
        await new Promise(res => setImmediate(res));
    }
}

async function programar(datos) {
    const c = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const tick = async (ahora, d = deps()) => { const x = await silencio(() => publicador.tick(sock(), { ahora, deps: d })); await silencio(drenar); return x; };

async function instantaneo(datos) {
    servicio.instantaneo._socketDe = () => sock();
    servicio.instantaneo._deps = deps();
    const s = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(s.ok, JSON.stringify(s));
    const res = await silencio(() => servicio.publicarAhora(A, s.data.id, { version: s.data.version, confirmacion: true }));
    await silencio(drenar);
    assert.ok(res.ok, JSON.stringify(res));
    return { sorteo: s.data, res };
}

const ANUNCIO = "🎰 Antioqueñita Día - 10:30 PM\n\n🍀 Dos últimas cifras → $300.000\n\n🎯 Valor número: $3.000\n\n🏦 Nequi\n📲 3000000001";
async function detectar(grupoId, texto = ANUNCIO) {
    const ctx = { sock: sock(), grupo: { remoteJid: grupoId }, chat: { remoteJid: grupoId, esGrupo: true }, textoOriginal: texto, session: { usuarioId: A } };
    const ev = await silencio(() => detectarEvento(ctx));
    await silencio(drenar);
    return ev;
}

const aperturas = (g) => enviados.filter(e => e.tipo === "texto" && e.texto?.startsWith("🔓 Grupo abierto") && (!g || e.jid === g));
const cierres = (g) => enviados.filter(e => e.tipo === "texto" && e.texto?.startsWith("🔒 Cerrado") && (!g || e.jid === g));
const anuncios = (g) => enviados.filter(e => e.tipo === "imagen" && (!g || e.jid === g));
const recordatoriosGenerales = (g) => enviados.filter(e => e.tipo === "texto" && e.texto?.startsWith("⏰ General") && (!g || e.jid === g));
const recordatoriosSorteo = (g) => enviados.filter(e => e.tipo === "texto" && e.texto?.startsWith("⏰ Del sorteo") && (!g || e.jid === g));
const actualizaciones = (g) => enviados.filter(e => e.tipo === "texto" && e.texto?.startsWith("📈 Actualización") && (!g || e.jid === g));
const sesionesDe = (g) => fake.tablas.event_sessions.filter(s => s.grupo_id === g);
const eventosDe = (g) => fake.tablas.eventos_bot.filter(e => e.grupo_id === g);

// Lo que el motor debe dejar en un grupo tras publicar un evento: UNA
// apertura con los datos reales del evento y su ciclo abierto para el
// Scheduler (recordatorios, actualizaciones, cierre).
function comprobarCicloAbierto(g, origen) {
    const ev = eventosDe(g).find(e => e.activo);
    assert.ok(ev, `${origen}: evento activo en ${g}`);
    assert.strictEqual(aperturas(g).length, 1, `${origen}: UNA apertura en ${g} (hay ${aperturas(g).length})`);
    assert.strictEqual(aperturas(g)[0].texto, `🔓 Grupo abierto: ${ev.nombre_evento} — valor ${ev.valor}`, `${origen}: variables reales del evento`);
    const ses = sesionesDe(g);
    assert.strictEqual(ses.length, 1, `${origen}: un ciclo (event_session) en ${g} (hay ${ses.length})`);
    assert.strictEqual(ses[0].evento_id, ev.id, `${origen}: el ciclo es de ESE evento`);
    assert.strictEqual(ses[0].estado, "abierto", `${origen}: ciclo abierto para el Scheduler`);
    assert.strictEqual(ses[0].session_id, "ses-aaaa", `${origen}: ciclo de la sesión que publicó`);
    const open = fake.tablas.automation_actions.filter(a => a.tipo_accion === "OPEN_MESSAGE" && a.grupo_id === g);
    assert.strictEqual(open.length, 1, `${origen}: una sola acción OPEN_MESSAGE registrada en ${g}`);
    assert.strictEqual(open[0].estado, "ok");
    return { ev, sesion: ses[0] };
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- pruebas ---

prueba("A. Detectado por WhatsApp: abre el grupo, UNA apertura y su ciclo abierto", async () => {
    escenario();
    const ev = await detectar("g3@g.us");
    assert.ok(ev?.id, "evento detectado y guardado");
    comprobarCicloAbierto("g3@g.us", "WhatsApp");
    assert.strictEqual(operaciones.filter(o => o.ajuste === "not_announcement").length, 1, "grupo abierto una vez");

    // El mismo anuncio leído otra vez: nada se repite.
    await detectar("g3@g.us");
    comprobarCicloAbierto("g3@g.us", "WhatsApp (re-anuncio)");
});

prueba("B. Instantáneo del panel: anuncio + la MISMA apertura y ciclo que un evento detectado", async () => {
    escenario();
    const { sorteo, res } = await instantaneo(entrada({ publicacion_inmediata: true, publicar_en: undefined }));
    assert.strictEqual(res.data.publicados, 1);
    assert.strictEqual(anuncios("g1@g.us").length, 1, "anuncio (imagen + pie) publicado");
    const { ev } = comprobarCicloAbierto("g1@g.us", "instantáneo");
    assert.strictEqual(ev.identidad_evento_real, sorteo.identidad_evento_real);
    // La apertura va DESPUÉS del anuncio, como en WhatsApp (el anuncio va primero).
    assert.ok(enviados.indexOf(anuncios("g1@g.us")[0]) < enviados.indexOf(aperturas("g1@g.us")[0]), "anuncio antes que la apertura");
    // La tabla ya salió como anuncio: la «tabla inicial» del ciclo no la repite.
    const tablaInicial = fake.tablas.automation_actions.filter(a => a.tipo_accion === "INITIAL_TABLE");
    assert.strictEqual(tablaInicial.length, 1, "tabla inicial cubierta por el anuncio");
    assert.strictEqual(tablaInicial[0].estado, "ok");
});

prueba("C. Programado del panel: nada antes de su hora; a su hora, anuncio + la misma apertura y ciclo", async () => {
    escenario();
    const s = await programar(entrada());
    await tick(ANTES);
    assert.strictEqual(enviados.length, 0, "antes de la hora no se envía nada");
    assert.strictEqual(fake.tablas.event_sessions.length, 0, "ni se abre ningún ciclo");
    assert.strictEqual(eventosDe("g1@g.us").length, 0);

    await tick(EN_PUBLICACION);
    assert.strictEqual(fake.tablas.sorteos_programados.find(x => x.id === s.id).estado, "publicado");
    assert.strictEqual(anuncios("g1@g.us").length, 1);
    comprobarCicloAbierto("g1@g.us", "programado");

    await tick(SIGUIENTE);
    await tick(DESPUES);
    comprobarCicloAbierto("g1@g.us", "programado (ciclos siguientes)");
    assert.strictEqual(anuncios("g1@g.us").length, 1);
});

prueba("D. Editado después de publicar: no se repite la apertura ni se abre otro ciclo", async () => {
    // Panel: un sorteo ya publicado no se puede editar (no hay otra publicación).
    escenario();
    const s = await programar(entrada());
    await tick(EN_PUBLICACION);
    const actual = fake.tablas.sorteos_programados.find(x => x.id === s.id);
    const ed = await silencio(() => servicio.editar(A, s.id, { ...entrada({ hora_fin: "22:00" }), version: actual.version }));
    assert.ok(!ed.ok, "el panel rechaza editar un sorteo publicado");
    await tick(DESPUES);
    comprobarCicloAbierto("g1@g.us", "panel editado");

    // WhatsApp: corrección del anuncio (otra hora, todavía sin números): se
    // corrige la MISMA fila; antes nacía un segundo ciclo con su apertura.
    escenario();
    const ev = await detectar("g3@g.us");
    await detectar("g3@g.us", ANUNCIO.replace("10:30 PM", "10:00 PM"));
    const filas = eventosDe("g3@g.us");
    assert.strictEqual(filas.length, 1, "la corrección reescribe la misma fila");
    assert.strictEqual(filas[0].id, ev.id);
    assert.strictEqual(filas[0].hora_fin, "22:00", "con la hora corregida");
    assert.strictEqual(aperturas("g3@g.us").length, 1, `una sola apertura tras la corrección (hay ${aperturas("g3@g.us").length})`);
    const vivas = sesionesDe("g3@g.us").filter(x => ["pendiente", "abierto", "cerrando"].includes(x.estado));
    assert.strictEqual(vivas.length, 1, `un solo ciclo vivo para el evento (hay ${vivas.length}): si no, recordatorios y cierre saldrían dos veces`);
});

prueba("E. Reintentos y reinicios: la apertura sale una sola vez, cuando el grupo de verdad se abre", async () => {
    // Panel: WhatsApp no abre el grupo en el primer intento.
    escenario();
    await programar(entrada());
    let falla = true;
    fallaApertura = () => falla;
    await tick(EN_PUBLICACION);
    assert.strictEqual(enviados.length, 0, "sin grupo abierto no hay anuncio ni apertura");
    assert.strictEqual(fake.tablas.event_sessions.length, 0);
    falla = false;
    await tick(SIGUIENTE);           // reintento automático del publicador
    comprobarCicloAbierto("g1@g.us", "programado tras reintento");
    await tick(DESPUES);
    // Reinicio del proceso: el motor vuelve a procesar el mismo evento.
    const ev = eventosDe("g1@g.us")[0];
    if (motor) await silencio(() => motor.procesarEventoPublicado({ evento: ev, sock: sock(), ahora: DESPUES, tablaPublicada: true }));
    await silencio(drenar);
    comprobarCicloAbierto("g1@g.us", "programado tras reproceso");

    // WhatsApp: el grupo no se pudo abrir al detectar; el worker lo abre después.
    escenario();
    falla = true;
    fallaApertura = () => falla;
    await detectar("g3@g.us");
    assert.strictEqual(aperturas().length, 0, "sin grupo abierto no hay apertura");
    assert.strictEqual(eventosDe("g3@g.us")[0].abierto, false);
    falla = false;
    await silencio(() => workerEventos(sock()));
    await silencio(drenar);
    comprobarCicloAbierto("g3@g.us", "WhatsApp tras reconciliar la apertura");
    await silencio(() => workerEventos(sock()));
    await silencio(drenar);
    comprobarCicloAbierto("g3@g.us", "WhatsApp (worker otra vez)");
});

prueba("F. Varios grupos: una apertura y un ciclo por grupo, cada uno a su grupo", async () => {
    escenario();
    await programar(entrada({ grupos: ["g1@g.us", "g2@g.us"] }));
    await tick(EN_PUBLICACION);
    comprobarCicloAbierto("g1@g.us", "programado g1");
    comprobarCicloAbierto("g2@g.us", "programado g2");
    assert.strictEqual(aperturas("g3@g.us").length, 0, "nada en un grupo que no es destino");
    assert.strictEqual(aperturas().length, 2);

    escenario();
    await instantaneo(entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: ["g1@g.us", "g3@g.us"] }));
    comprobarCicloAbierto("g1@g.us", "instantáneo g1");
    comprobarCicloAbierto("g3@g.us", "instantáneo g3");
    assert.strictEqual(aperturas("g2@g.us").length, 0);
    assert.strictEqual(aperturas().length, 2);
});

prueba("Paridad: el Scheduler hace lo mismo con el ciclo de un evento del panel que con uno detectado (CLOSE_MESSAGE una vez)", async () => {
    // El cierre real (cerrarEvento) deja el evento inactivo: el Scheduler
    // envía la comunicación de cierre del ciclo. Un sorteo por precio: cada
    // origen en su propio escenario.
    const cerrarYProgramar = async (g, origen) => {
        comprobarCicloAbierto(g, origen);
        for (const e of fake.tablas.eventos_bot) Object.assign(e, { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" });
        await silencio(() => scheduler.tick(sock(), { ahora: DESPUES }));
        await silencio(() => scheduler.tick(sock(), { ahora: DESPUES }));
        await silencio(drenar);
        assert.strictEqual(cierres(g).length, 1, `${origen}: un CLOSE_MESSAGE (hay ${cierres(g).length})`);
        assert.strictEqual(sesionesDe(g)[0].estado, "cerrado", `${origen}: ciclo cerrado`);
        return enviados.filter(e => e.tipo === "texto").map(e => e.texto.split(":")[0]);
    };

    escenario();
    await programar(entrada());
    await tick(EN_PUBLICACION);
    const panel = await cerrarYProgramar("g1@g.us", "panel");

    escenario();
    await detectar("g3@g.us");
    const whatsapp = await cerrarYProgramar("g3@g.us", "WhatsApp");

    assert.deepStrictEqual(panel, whatsapp, "las mismas comunicaciones automáticas, en el mismo orden");
});

// ------------------------------------------- reglas del 04/11 (2.ª ronda) ---

// Momento «N minutos antes del cierre» del evento del grupo (hora Colombia).
const antesDelCierre = (g, minutos) => {
    const ev = eventosDe(g)[0];
    return new Date(publicador.instanteBogota(String(ev.fecha_evento).slice(0, 10), ev.hora_cierre).getTime() - minutos * 60000);
};
const ciclo = async (ahora) => {
    // Recordatorios y avisos del sorteo salen como texto (send.js real).
    await silencio(() => publicador.tick(sock(), { ahora, deps: deps({ sendMessage: require(r("services/baileys/send.js")).sendMessage }) }));
    await silencio(() => scheduler.tick(sock(), { ahora }));
    await silencio(drenar);
};
const cerrarTodo = () => { for (const e of fake.tablas.eventos_bot) Object.assign(e, { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" }); };

prueba("2. Tabla inicial: si el anuncio ya llevó la imagen, el grupo no recibe otra (programado, instantáneo, reintento manual y grupo nuevo)", async () => {
    const sinSegundaTabla = async (g, origen) => {
        await silencio(() => scheduler.tick(sock(), { ahora: DESPUES }));
        await silencio(() => scheduler.tick(sock(), { ahora: DESPUES }));
        await silencio(drenar);
        assert.strictEqual(anuncios(g).length, 1, `${origen}: una sola imagen de la tabla en ${g} (hay ${anuncios(g).length})`);
        const ses = sesionesDe(g)[0];
        const ti = fake.tablas.automation_actions.filter(a => a.clave_idempotencia === `${ses.id}:INITIAL_TABLE`);
        assert.strictEqual(ti.length, 1, `${origen}: tabla inicial registrada`);
        assert.deepStrictEqual([ti[0].estado, ti[0].detalle?.resultado?.cubiertaPor], ["ok", "anuncio_publicado"], `${origen}: cumplida por el anuncio`);
    };

    escenario();
    await programar(entrada());
    await tick(EN_PUBLICACION);
    await sinSegundaTabla("g1@g.us", "programado");

    escenario();
    await instantaneo(entrada({ publicacion_inmediata: true, publicar_en: undefined }));
    await sinSegundaTabla("g1@g.us", "instantáneo");

    // Reintento manual de un destino del instantáneo que falló al abrir.
    escenario();
    let falla = true;
    fallaApertura = () => falla;
    const { sorteo } = await instantaneo(entrada({ publicacion_inmediata: true, publicar_en: undefined }));
    assert.strictEqual(anuncios().length, 0);
    falla = false;
    const re = await silencio(() => servicio.reintentarGrupo(A, sorteo.id, "g1@g.us"));
    await silencio(drenar);
    assert.ok(re.ok, JSON.stringify(re));
    comprobarCicloAbierto("g1@g.us", "reintento manual");
    await sinSegundaTabla("g1@g.us", "reintento manual");

    // Grupo añadido después de publicar (sorteos/gruposSorteo.js, otra sesión).
    escenario();
    const s = await programar(entrada());
    await tick(EN_PUBLICACION);
    const gs = require(r("sorteos/gruposSorteo.js"));
    gs.deps.socketDe = () => sock();
    gs.deps.puedeActuar = () => true;
    gs.deps.publicadorDeps = deps();
    gs.reloj.ahora = () => SIGUIENTE;
    const c = await silencio(() => gs.cambiarGrupos(A, s.id, ["g1@g.us", "g2@g.us"]));
    assert.ok(c.ok, JSON.stringify(c));
    const pub = await silencio(() => gs.publicarGruposNuevos(A, s.id));
    await silencio(drenar);
    assert.ok(pub.ok, JSON.stringify(pub));
    comprobarCicloAbierto("g2@g.us", "grupo nuevo");
    comprobarCicloAbierto("g1@g.us", "grupo original (sin repetir nada)");
    assert.strictEqual(anuncios("g1@g.us").length, 1);
    await sinSegundaTabla("g2@g.us", "grupo nuevo");
});

prueba("3. Recordatorios: los del sorteo tienen prioridad; sin ellos, los generales del grupo (y nunca los dos)", async () => {
    escenario();
    await programar(entrada({ recordatorios: [{ minutos_antes_cierre: 30, texto: "⏰ Del sorteo: quedan 30 minutos" }] }));
    await tick(EN_PUBLICACION);
    const t = new Date(antesDelCierre("g1@g.us", 30).getTime() + 60000);
    await ciclo(t);
    await ciclo(new Date(t.getTime() + 30000));
    assert.strictEqual(recordatoriosSorteo("g1@g.us").length, 1, `el del sorteo, una vez (hay ${recordatoriosSorteo("g1@g.us").length})`);
    assert.strictEqual(recordatoriosGenerales("g1@g.us").length, 0, "el general del grupo no sale");

    escenario();
    await programar(entrada());   // sin recordatorios propios
    await tick(EN_PUBLICACION);
    const t2 = new Date(antesDelCierre("g1@g.us", 30).getTime() + 60000);
    await ciclo(t2);
    await ciclo(new Date(t2.getTime() + 30000));
    assert.strictEqual(recordatoriosGenerales("g1@g.us").length, 1, `el general del grupo, una vez (hay ${recordatoriosGenerales("g1@g.us").length})`);
    assert.strictEqual(recordatoriosSorteo().length, 0);

    // WhatsApp: no hay sorteo del panel, siempre el general.
    escenario();
    await detectar("g3@g.us");
    const t3 = new Date(antesDelCierre("g3@g.us", 30).getTime() + 60000);
    await ciclo(t3);
    assert.strictEqual(recordatoriosGenerales("g3@g.us").length, 1, "WhatsApp: el general");
});

prueba("4. Cierres: el aviso del sorteo tiene prioridad; sin él, el del grupo; nunca dos para el mismo evento y grupo", async () => {
    const cierreUnico = async (g, texto, origen) => {
        cerrarTodo();
        await ciclo(DESPUES);
        await ciclo(new Date(DESPUES.getTime() + 30000));
        assert.strictEqual(cierres(g).length, 1, `${origen}: un aviso de cierre (hay ${cierres(g).length})`);
        assert.ok(cierres(g)[0].texto.startsWith(texto), `${origen}: ${cierres(g)[0].texto}`);
        assert.strictEqual(sesionesDe(g)[0].estado, "cerrado", `${origen}: ciclo cerrado`);
    };

    escenario();
    await programar(entrada({ mensajes: { publicacion: "", aviso_cierre: "🔒 Cerrado — aviso propio del sorteo" } }));
    await tick(EN_PUBLICACION);
    await cierreUnico("g1@g.us", "🔒 Cerrado — aviso propio", "con aviso del sorteo");
    assert.strictEqual(fake.tablas.automation_actions.filter(a => a.tipo_accion === "CLOSE_MESSAGE").length, 0, "el del grupo ni se intenta");

    escenario();
    await programar(entrada());
    await tick(EN_PUBLICACION);
    await cierreUnico("g1@g.us", "🔒 Cerrado: Antioqueñita", "sin aviso del sorteo");

    // Defensa: si el otro ya lo anunció (p. ej. un despliegue a mitad del
    // evento), no sale el segundo, en ninguno de los dos sentidos.
    escenario();
    await programar(entrada({ mensajes: { publicacion: "", aviso_cierre: "🔒 Cerrado — aviso propio del sorteo" } }));
    await tick(EN_PUBLICACION);
    const ses = sesionesDe("g1@g.us")[0];
    fake.tablas.automation_actions.push({ id: "previo", clave_idempotencia: `${ses.id}:CLOSE_MESSAGE`, tipo_accion: "CLOSE_MESSAGE", estado: "ok", grupo_id: "g1@g.us", usuario_id: A });
    cerrarTodo();
    await ciclo(DESPUES);
    assert.strictEqual(cierres("g1@g.us").length, 0, "el grupo ya lo anunció: el del sorteo no sale");

    escenario();
    const s2 = await programar(entrada());
    await tick(EN_PUBLICACION);
    fake.tablas.automation_actions.push({ id: "previo2", clave_idempotencia: `sorteo:${s2.id}:grupo:g1@g.us:aviso_cierre`, tipo_accion: "SORTEO_AVISO_CIERRE", estado: "ok", grupo_id: "g1@g.us", usuario_id: A });
    cerrarTodo();
    await ciclo(DESPUES);
    assert.strictEqual(cierres("g1@g.us").length, 0, "el sorteo ya lo anunció: el del grupo no sale");
    assert.strictEqual(sesionesDe("g1@g.us")[0].estado, "cerrado");
});

prueba("5. Actualizaciones: las generales del grupo también para eventos del panel, una por movimiento y sin duplicar", async () => {
    for (const origen of ["panel", "WhatsApp"]) {
        escenario();
        let g = "g1@g.us";
        if (origen === "panel") { await programar(entrada()); await tick(EN_PUBLICACION); } else { g = "g3@g.us"; await detectar(g); }
        const ev = eventosDe(g)[0];
        fake.tablas.reservas_actividad = [{ id: "ra-1", evento_id: ev.id, tipo: "reservado", numero: "07", creado_en: new Date().toISOString() }];
        // Reloj real: el ciclo anota abierto_en / ultima_actualizacion_en con
        // él. La reserva, unos ms ANTES del ciclo (no en el mismo ms).
        await new Promise(res => setTimeoutOriginal(res, 5));
        await ciclo(new Date());
        await new Promise(res => setTimeoutOriginal(res, 5));
        await ciclo(new Date());
        assert.strictEqual(actualizaciones(g).length, 1, `${origen}: una actualización (hay ${actualizaciones(g).length})`);
        assert.strictEqual(sesionesDe(g).length, 1, `${origen}: un solo ciclo emisor`);
    }
});

// ----------------------------------------------------------------- run ---

(async () => {
    let fallos = 0;
    for (const { n, fn } of pruebas) {
        try {
            await fn();
            console.log(`✅ ${n}`);
        } catch (err) {
            fallos++;
            console.log(`❌ ${n}\n   ${err.message}`);
        }
    }
    console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK`);
    global.setTimeout = setTimeoutOriginal;
    process.exit(fallos ? 1 : 0);
})();
