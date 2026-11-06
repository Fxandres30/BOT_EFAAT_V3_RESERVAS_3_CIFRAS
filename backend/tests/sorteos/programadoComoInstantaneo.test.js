// ==========================================================================
// PRUEBAS — el sorteo PROGRAMADO publica con la MISMA imagen y el mismo envío
// que el instantáneo: la captura del panel (capturarTabla, la de la vista
// previa) se guarda al «Confirmar y programar» (sorteos/capturaProgramada.js)
// y, a la hora, el publicador la envía con textoParaCompartir +
// compartirEnGrupos (ExecutionGuard). Sin Chromium en el servidor. Si la
// tabla cambió desde la captura, no se publica una imagen desactualizada: el
// grupo queda en revisión y «Reintentar» publica con una captura nueva.
//
// Reales: sorteos/{servicio,publicador,capturaProgramada,repo,...}.js,
// services/{compartirTabla (compartirEnGrupos),destinosCompartir}.js,
// baileys/send.js, guardarEvento, consultarEvento, abrirGrupo,
// executionGuard, actualizarEvento. Simulados: Supabase (memoria) y el
// socket de WhatsApp. La captura del servidor (Puppeteer) queda PROHIBIDA
// para los programados: si se llamara, la prueba falla.
//
//     EFAAT_PRUEBAS=1 node backend/tests/sorteos/programadoComoInstantaneo.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const DIR_CAPTURAS = fs.mkdtempSync(path.join(os.tmpdir(), "efaat-capturas-"));
process.env.EFAAT_CAPTURAS_DIR = DIR_CAPTURAS;

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
const capturaProgramada = require(r("sorteos/capturaProgramada.js"));
const destinos = require(r("services/destinosCompartir.js"));
const compartirTabla = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// La captura del SERVIDOR (Chromium) no debe usarse en un programado.
let capturasServidor = [];
compartirTabla.capturarImagenTabla = async (...args) => {
    capturasServidor.push(args);
    throw new Error("Falta FRONTEND_URL (simulado): el servidor no puede capturar");
};

// Hoy 15/10; se publica el 22/10 08:00 (Colombia) y se juega ese día.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const SIGUIENTE = new Date("2026-10-22T13:01:30Z");
const DESPUES = new Date("2026-10-22T13:05:00Z");
let reloj = T0;
servicio._reloj.ahora = () => reloj;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000

// PNG mínimo válido para destinosCompartir.imagenPng (firma + IHDR).
function png(ancho) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "ascii");
    b.writeUInt32BE(ancho, 16);
    b.writeUInt32BE(100, 20);
    b[24] = 8; b[25] = 6;
    return b;
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString("base64")}`;
const PNG1 = png(101);
const PNG2 = png(202);

function escenario() {
    fake = crearFake();
    enviados = [];
    intentosEnvio = 0;
    fallaEnvio = () => null;
    capturasServidor = [];
    reloj = T0;
    fs.rmSync(DIR_CAPTURAS, { recursive: true, force: true });
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    // Dos números ya ocupados de antes: salen en la imagen y en la huella.
    Object.assign(t[T5K][7], { estado: "reservado" });
    Object.assign(t[T5K][8], { estado: "pagado" });
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
        ...extra
    };
}

let enviados = [];
let intentosEnvio = 0;
let fallaEnvio = () => null;
const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        intentosEnvio++;
        const error = fallaEnvio(jid);
        if (error) throw new Error(error);
        enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", image: contenido.image, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

// Dependencias del publicador: las REALES, incluida la imagen
// (capturaProgramada.capturarParaPublicar = dependenciasReales().capturarImagen).
function deps(cambios = {}) {
    return {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: publicador.dependenciasReales().capturarImagen,
        textoParaCompartir: destinos.textoParaCompartir,
        compartirEnGrupos: compartirTabla.compartirEnGrupos,
        sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); },
        ...cambios
    };
}

function usarServicio(cambios = {}) {
    servicio.instantaneo._socketDe = () => sock();
    servicio.instantaneo._deps = deps(cambios);
}

async function silencio(fn) {
    const { log, table, dir, warn, error } = console;
    console.log = console.table = console.dir = console.warn = console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error }); }
}

async function crear(datos = entrada()) {
    const c = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(c.ok, JSON.stringify(c));
    return c.data;
}

// «Confirmar y programar» del panel: vista previa (huella) + su captura.
async function confirmarConCaptura(s, imagen = PNG1, extra = {}) {
    const v = await silencio(() => servicio.vistaPrevia(A, s.id));
    assert.ok(v.ok && v.data.huella_tabla, JSON.stringify(v));
    return silencio(() => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(imagen), huella: v.data.huella_tabla, ...extra }));
}

const tick = (ahora, d = deps()) => silencio(() => publicador.tick(sock(), { ahora, deps: d }));
const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDe = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const eventosDe = (s) => fake.tablas.eventos_bot.filter(e => e.usuario_id === A && e.identidad_evento_real === s.identidad_evento_real);
const accionesCompartir = () => (fake.tablas.automation_actions || []).filter(a => a.tipo_accion === "TABLA_COMPARTIR");

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- pruebas ---

prueba("1. Programar: la captura del panel se guarda ligada a la versión confirmada", async () => {
    escenario();
    const s = await crear();
    const conf = await confirmarConCaptura(s);
    assert.ok(conf.ok, JSON.stringify(conf));
    assert.strictEqual(sorteoDb(s.id).estado, "programado");
    const guardada = await capturaProgramada.leer(s.id);
    assert.ok(guardada, "hay captura guardada");
    assert.strictEqual(guardada.version, s.version);
    assert.ok(guardada.png.equals(PNG1), "la MISMA imagen que mostró la vista previa");
    assert.strictEqual(enviados.length, 0, "programar no publica");
});

prueba("2-4. A la hora: se envía la imagen guardada (bytes idénticos), solo al grupo elegido, sin Chromium del servidor", async () => {
    escenario();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s)).ok);
    await tick(EN_PUBLICACION);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado", grupoDe(s.id, "g1@g.us").ultimo_error);
    assert.deepStrictEqual(enviados.map(e => e.jid), ["g1@g.us"], "solo el grupo del sorteo");
    assert.strictEqual(enviados[0].tipo, "imagen");
    assert.ok(Buffer.from(enviados[0].image).equals(PNG1), "la captura guardada, tal cual");
    assert.strictEqual(capturasServidor.length, 0, "el servidor no capturó nada");
    assert.ok(accionesCompartir().some(a => a.clave_idempotencia === `TABLA_COMPARTIR:${A}:3000:sorteo-${s.id}-publicacion-0:g1@g.us` && a.estado === "ok"));
    assert.strictEqual(eventosDe(s).length, 1);
    await tick(SIGUIENTE);
    assert.strictEqual(enviados.length, 1, "el ciclo siguiente no repite");
});

prueba("5. Mismo formato que el instantáneo: misma imagen y mismo pie para el mismo sorteo", async () => {
    // Instantáneo: «Publicar ahora» con la captura del panel.
    escenario();
    reloj = EN_PUBLICACION;
    usarServicio();
    const inst = await crear(entrada({ publicar_en: undefined, publicacion_inmediata: true }));
    const pub = await silencio(() => servicio.publicarAhora(A, inst.id, { version: inst.version, confirmacion: true, imagen: dataUrl(PNG1) }));
    assert.ok(pub.ok && pub.data.publicados === 1, JSON.stringify(pub));
    const delInstantaneo = enviados[0];

    // Programado, mismo sorteo, a su hora.
    escenario();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s)).ok);
    await tick(EN_PUBLICACION);
    const delProgramado = enviados[0];

    assert.ok(delInstantaneo && delProgramado);
    assert.strictEqual(delProgramado.tipo, delInstantaneo.tipo);
    assert.ok(Buffer.from(delProgramado.image).equals(Buffer.from(delInstantaneo.image)), "la misma imagen");
    assert.strictEqual(delProgramado.texto, delInstantaneo.texto, "el mismo pie");
    assert.ok(delProgramado.texto.includes("Antioqueñita Día") && delProgramado.texto.includes("Nequi A"), delProgramado.texto);
});

prueba("6a. La tabla cambió antes de la hora: no se envía una imagen desactualizada; revisión, sin evento ni reintentos solos", async () => {
    escenario();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s)).ok);
    Object.assign(fake.tablas[T5K][20], { estado: "reservado" });
    await tick(EN_PUBLICACION);
    const g = grupoDe(s.id, "g1@g.us");
    assert.strictEqual(g.estado, "requiere_revision");
    assert.ok(/No se pudo generar la imagen de la tabla: la tabla cambió/.test(g.ultimo_error), g.ultimo_error);
    assert.strictEqual(enviados.length + intentosEnvio, 0, "nada enviado ni intentado");
    assert.strictEqual(eventosDe(s).length, 0, "no se creó el evento");
    assert.strictEqual(capturasServidor.length, 0);
    await tick(SIGUIENTE);
    await tick(DESPUES);
    assert.strictEqual(intentosEnvio, 0, "los ciclos siguientes no lo intentan");
});

prueba("6b. Falla el envío de WhatsApp: queda en revisión y NUNCA se reenvía solo", async () => {
    escenario();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s)).ok);
    fallaEnvio = () => "conexión cerrada";
    await tick(EN_PUBLICACION);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.strictEqual(intentosEnvio, 1);
    fallaEnvio = () => null;
    await tick(SIGUIENTE);
    await tick(DESPUES);
    assert.strictEqual(intentosEnvio, 1, "sin reenvío automático");
    assert.strictEqual(enviados.length, 0);
});

prueba("6c. Fallo transitorio antes de enviar (apertura del grupo): el ciclo siguiente lo reintenta con la MISMA imagen y clave, una sola vez", async () => {
    escenario();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s)).ok);
    let aperturas = 0;
    const d = deps({ abrirGrupo: async (args) => (++aperturas === 1 ? false : abrirGrupo(args)) });
    await tick(EN_PUBLICACION, d);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "fallido");
    assert.strictEqual(intentosEnvio, 0);
    await tick(SIGUIENTE, d);
    await tick(DESPUES, d);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(enviados.length, 1, "una sola publicación");
    assert.ok(Buffer.from(enviados[0].image).equals(PNG1));
    assert.strictEqual(eventosDe(s).length, 1, "un solo evento");
});

prueba("7. Reintentar con captura nueva: publica ese grupo ya, una vez; doble clic y ciclos no duplican", async () => {
    escenario();
    usarServicio();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s)).ok);
    Object.assign(fake.tablas[T5K][20], { estado: "reservado" });
    await tick(EN_PUBLICACION);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");

    reloj = SIGUIENTE;
    // Huella vieja (la tabla cambió): rechazado sin tocar nada.
    const vieja = await silencio(() => servicio.reintentarGrupo(A, s.id, "g1@g.us", { imagen: dataUrl(PNG2), huella: "huella-vieja" }));
    assert.strictEqual(vieja.motivo, "tabla_cambiada");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.ok((await capturaProgramada.leer(s.id)).png.equals(PNG1), "la captura no se sustituyó");

    const v = await silencio(() => servicio.vistaPrevia(A, s.id));
    const re = await silencio(() => servicio.reintentarGrupo(A, s.id, "g1@g.us", { imagen: dataUrl(PNG2), huella: v.data.huella_tabla }));
    assert.ok(re.ok, JSON.stringify(re));
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado", grupoDe(s.id, "g1@g.us").ultimo_error);
    assert.strictEqual(enviados.length, 1);
    assert.ok(Buffer.from(enviados[0].image).equals(PNG2), "la captura nueva");
    assert.ok(accionesCompartir().some(a => a.clave_idempotencia.endsWith(`sorteo-${s.id}-publicacion-1:g1@g.us`) && a.estado === "ok"), "clave del reintento manual");

    const doble = await silencio(() => servicio.reintentarGrupo(A, s.id, "g1@g.us", { imagen: dataUrl(PNG2), huella: v.data.huella_tabla }));
    assert.strictEqual(doble.ok, false, "un grupo publicado no se reintenta");
    await tick(DESPUES);
    assert.strictEqual(enviados.length, 1, "sin duplicados");
    assert.strictEqual(eventosDe(s).length, 1);
});

prueba("8a. Editar tras confirmar: no publica sin reconfirmar; al reconfirmar se usa la captura NUEVA y la configuración editada, una vez", async () => {
    escenario();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s, PNG1)).ok);
    const ed = await silencio(() => servicio.editar(A, s.id, { ...entrada({ premios: [{ nombre: "Premio mayor", premio: 450000 }] }), version: s.version }));
    assert.ok(ed.ok, JSON.stringify(ed));
    assert.strictEqual(ed.data.estado, "borrador");

    // Sin reconfirmar, a la hora no se publica nada.
    const copia = JSON.parse(JSON.stringify(fake.tablas.sorteos_programados));
    await tick(EN_PUBLICACION);
    assert.strictEqual(enviados.length, 0, "la versión editada sin confirmar no se publica");
    fake.tablas.sorteos_programados = copia;

    assert.ok((await confirmarConCaptura(ed.data, PNG2)).ok);
    const guardada = await capturaProgramada.leer(s.id);
    assert.strictEqual(guardada.version, ed.data.version);
    await tick(EN_PUBLICACION);
    await tick(SIGUIENTE);
    assert.strictEqual(enviados.length, 1, "una sola publicación");
    assert.ok(Buffer.from(enviados[0].image).equals(PNG2), "la captura de la versión confirmada");
    assert.ok(enviados[0].texto.includes("450.000"), enviados[0].texto);
    assert.strictEqual(sorteoDb(s.id).config.premios[0].premio, 450000, "la configuración editada se conserva");
});

prueba("8b. Reconfirmar SIN captura (panel anterior): la captura de la versión vieja no se usa; revisión sin enviar", async () => {
    escenario();
    const s = await crear();
    assert.ok((await confirmarConCaptura(s, PNG1)).ok);
    const ed = await silencio(() => servicio.editar(A, s.id, { ...entrada({ premios: [{ nombre: "Premio mayor", premio: 450000 }] }), version: s.version }));
    const conf = await silencio(() => servicio.confirmar(A, s.id, { version: ed.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    await tick(EN_PUBLICACION);
    const g = grupoDe(s.id, "g1@g.us");
    assert.strictEqual(g.estado, "requiere_revision");
    assert.ok(/no hay imagen de la tabla para la versión confirmada/.test(g.ultimo_error), g.ultimo_error);
    assert.strictEqual(intentosEnvio, 0);
    assert.strictEqual(capturasServidor.length, 0, "tampoco se recurre a la captura del servidor");
});

prueba("9. Confirmar con una captura que no corresponde: huella distinta o PNG inválido → nada se programa ni se guarda", async () => {
    escenario();
    const s = await crear();
    const v = await silencio(() => servicio.vistaPrevia(A, s.id));
    Object.assign(fake.tablas[T5K][30], { estado: "pagado" });
    const cambiada = await silencio(() => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(PNG1), huella: v.data.huella_tabla }));
    assert.strictEqual(cambiada.motivo, "tabla_cambiada");
    const invalida = await silencio(() => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: "data:image/png;base64,AAAA", huella: v.data.huella_tabla }));
    assert.strictEqual(invalida.motivo, "imagen_invalida");
    assert.strictEqual(sorteoDb(s.id).estado, "borrador");
    assert.strictEqual(await capturaProgramada.leer(s.id), null);
});

prueba("10. Una sola fuente de imagen: el instantáneo también publica la imagen guardada; nunca la captura del servidor", async () => {
    capturasServidor = [];
    const sorteoInst = { id: "00000000-0000-4000-8000-000000000999", usuario_id: A, tabla: T5K, config: { publicacion_inmediata: true }, confirmado_version: 1 };
    await assert.rejects(() => capturaProgramada.capturarParaPublicar(3000, A, null, { sorteoId: sorteoInst.id, sorteo: sorteoInst }), /no hay imagen de la tabla/);
    await assert.rejects(() => capturaProgramada.capturarParaPublicar(3000, A, null, {}), /falta el sorteo/);
    assert.strictEqual(capturasServidor.length, 0, "nunca va a Chromium");
});

// ------------------------------------------------------------- ejecutar ---

(async () => {
    let fallidas = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); console.log(`✅ ${n}`); }
        catch (err) { fallidas++; console.log(`❌ ${n}\n   ${err?.stack || err}`); }
    }
    fs.rmSync(DIR_CAPTURAS, { recursive: true, force: true });
    console.log(`\n${pruebas.length - fallidas}/${pruebas.length} pruebas superadas`);
    process.exit(fallidas ? 1 : 0);
})();
