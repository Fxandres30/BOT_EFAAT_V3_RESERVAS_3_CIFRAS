// ==========================================================================
// PRUEBAS — UNA sola forma de capturar, preparar y publicar un sorteo.
//
// Todas las entradas (instantáneo, programado, reintentos, grupos nuevos
// desde «Compartir» o desde «Editar») terminan en el MISMO núcleo:
//   imagen   → sorteos/capturaProgramada.js (la captura del navegador que
//              guardó la entrada; nunca Chromium del servidor)
//   anuncio  → destinosCompartir.textoParaCompartir
//   envío    → compartirTabla.compartirEnGrupos → baileys sendImage, con la
//              clave del ExecutionGuard (sin duplicados)
//   motor    → publicador.publicarEnGrupo (reclamo condicionado del grupo)
// Incluye la reproducción del fallo «intermitente» del instantáneo: un
// grupo reclamado por OTRO ciclo del publicador (no el de la petición que
// traía la imagen) usaba la captura del servidor y fallaba.
//
// Reales: servicio, publicador, gruposSorteo, capturaProgramada, repo,
// compartirEnGrupos, destinosCompartir, guardarEvento, consultarEvento,
// abrirGrupo, executionGuard, actualizarEvento. Simulados: Supabase (memoria,
// con la RPC 030 de reinicio) y el socket de WhatsApp.
//
//     EFAAT_PRUEBAS=1 node backend/tests/sorteos/publicacionUnica.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const DIR_CAPTURAS = fs.mkdtempSync(path.join(os.tmpdir(), "efaat-capturas-unica-"));
process.env.EFAAT_CAPTURAS_DIR = DIR_CAPTURAS;

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
const rpc = { llamadas: [] };

// Simulación de reiniciar_tabla_cliente (030), como en reinicioAlPublicar.test.js.
function reinicio030(args) {
    const filas = (fake.tablas[args.p_tabla] || []).filter(f => f.usuario_id === args.p_usuario);
    const eventos = (fake.tablas.eventos_bot || []).filter(e => e.usuario_id === args.p_usuario && (e.tabla === args.p_tabla || e.tabla == null));
    const activas = new Set(eventos.filter(e => e.activo !== false && e.identidad_evento_real).map(e => e.identidad_evento_real));
    const clase = (f) => {
        if (f.estado === "libre") return "libre";
        if (["reservado", "pagado"].includes(f.estado)) {
            if (f.identidad_evento_real && activas.has(f.identidad_evento_real)) return "protegido_activo";
            return f.identidad_evento_real ? "liberable" : "protegido_sin_sorteo";
        }
        if (f.estado === "bloqueado") return args.p_liberar_bloqueados ? "liberable" : "conservado";
        return "protegido_desconocido";
    };
    const huella = filas.filter(f => f.estado !== "libre").map(f => `${f.numero}|${f.estado}|${f.identidad_evento_real || ""}`).sort().join(",");
    const ocupadas = filas.filter(f => clase(f) !== "libre");
    const grupos = new Map();
    for (const f of ocupadas) {
        const k = `${f.identidad_evento_real}|${clase(f)}`;
        const g = grupos.get(k) || { identidad: f.identidad_evento_real || null, nombre_evento: f.nombre_evento || null, clase: clase(f), reservados: 0, pagados: 0, otros: 0 };
        if (f.estado === "reservado") g.reservados++; else if (f.estado === "pagado") g.pagados++; else g.otros++;
        grupos.set(k, g);
    }
    const resumen = {
        liberables: ocupadas.filter(f => clase(f) === "liberable").length,
        protegidos: ocupadas.filter(f => clase(f).startsWith("protegido")).length,
        conservados: ocupadas.filter(f => clase(f) === "conservado").length,
        por_sorteo: [...grupos.values()]
    };
    if (resumen.protegidos > 0) return { data: { ok: false, motivo: "protegido", huella, ...resumen }, error: null };
    if (!args.p_aplicar) return { data: { ok: true, aplicado: false, huella, ...resumen }, error: null };
    if (args.p_huella !== huella) return { data: { ok: false, motivo: "tabla_cambio", huella, ...resumen }, error: null };
    for (const f of ocupadas.filter(x => clase(x) === "liberable")) {
        fake.tablas.reservas_archivo.push({ usuario_id: args.p_usuario, tabla: args.p_tabla, numero: f.numero, estado: f.estado, fila: { ...f } });
        Object.assign(f, { estado: "libre", identidad_evento_real: null, evento_id: null, nombre_evento: null, comprador: null });
    }
    return { data: { ok: true, aplicado: true, huella, ...resumen }, error: null };
}

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async (nombre, args) => { rpc.llamadas.push({ nombre, args, cuando: enviados.length }); return reinicio030(args); }
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const gruposSorteo = require(r("sorteos/gruposSorteo.js"));
const capturaProgramada = require(r("sorteos/capturaProgramada.js"));
const compartirTabla = require(r("services/compartirTabla.js"));

// F4-G: sin navegador del administrador, la imagen la genera el MISMO
// capturarTabla en Chromium headless (compartirTabla.capturarImagenTabla).
// Aquí se simula: el PNG codifica los datos que recibe (números, diseño y
// perfil), así cada prueba comprueba QUÉ tabla se pintó.
const crypto = require("crypto");
let capturasServidor = 0;
let generadas = [];
let servidorFalla = null;
let retardoGenerar = 0;
function pngDeDatos(datos, captura) {
    const h = crypto.createHash("sha256").update(JSON.stringify({ d: datos.numerosDisponibles, o: datos.numerosOcupados, p: datos.numerosPagados, diseno: datos.diseno, captura: captura || null })).digest();
    return Buffer.concat([png(4242), h]);
}
compartirTabla.capturarImagenTabla = async (precio, usuarioId, eventoId, opciones = {}) => {
    capturasServidor++;
    generadas.push({ precio, usuarioId, eventoId, opciones });
    if (retardoGenerar) await new Promise(res => setTimeout(res, retardoGenerar));
    if (servidorFalla) throw new Error(servidorFalla);
    return pngDeDatos(opciones.datos, opciones.captura);
};
const ultimaGenerada = () => { const g = generadas[generadas.length - 1]; return g && pngDeDatos(g.opciones.datos, g.opciones.captura); };

const T0 = new Date("2026-10-15T15:00:00Z");           // se programa
const PUBLICAR = new Date("2026-10-22T13:00:00Z");     // 08:00 Colombia
const seg = (s) => new Date(PUBLICAR.getTime() + s * 1000);
let reloj = T0;
servicio._reloj.ahora = () => reloj;
gruposSorteo.reloj.ahora = () => reloj;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000

function png(ancho) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(ancho, 16); b.writeUInt32BE(100, 20); b[24] = 8; b[25] = 6;
    return b;
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString("base64")}`;
const P1 = png(111), P2 = png(222), P3 = png(333), PB = png(999);

let enviados = [];
let falla = () => null;
let retardoEnvio = 0;
const sock = (usuarioId = A) => ({
    context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}`, telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        if (retardoEnvio) await new Promise(res => setTimeout(res, retardoEnvio));
        const e = falla(jid);
        if (e) throw new Error(e);
        enviados.push({ jid, usuarioId, tipo: contenido.image ? "imagen" : "texto", image: Buffer.from(contenido.image || []), texto: contenido.caption ?? contenido.text });
        return { key: { id: `m${enviados.length}` } };
    }
});

function escenario() {
    fake = crearFake();
    rpc.llamadas = [];
    enviados = [];
    falla = () => null;
    retardoEnvio = 0;
    capturasServidor = 0;
    generadas = [];
    servidorFalla = null;
    retardoGenerar = 0;
    capturaProgramada._olvidarGeneraciones();
    reloj = T0;
    fs.rmSync(DIR_CAPTURAS, { recursive: true, force: true });
    const t = fake.tablas;
    t.grupos_autorizados = ["g1", "g2", "g3"].map(g => ({ usuario_id: A, grupo_id: `${g}@g.us`, activo: true })).concat([{ usuario_id: B, grupo_id: "gb@g.us", activo: true }]);
    t.grupos = ["g1", "g2", "g3", "gb"].map(g => ({ jid: `${g}@g.us`, nombre: `Grupo ${g}` }));
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000002", titular: "B", activa: true }
    ];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    // Para A: 3 números de un sorteo anterior YA CERRADO (los libera un reinicio).
    t[T5K].filter(f => f.usuario_id === A).slice(10, 13).forEach(f => Object.assign(f, { estado: "pagado", identidad_evento_real: "anterior-a", nombre_evento: "Anterior" }));
    usarServicio();
}

const deps = () => publicador.dependenciasReales();
function usarServicio() {
    servicio.instantaneo._socketDe = (u) => sock(u);
    servicio.instantaneo._deps = { ...deps(), puedeActuar: () => true };
    gruposSorteo.deps.socketDe = (u) => sock(u);
    gruposSorteo.deps.puedeActuar = () => true;
    gruposSorteo.deps.publicadorDeps = { ...deps(), puedeActuar: () => true };
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras", nombre: "Lotería Única", hora_fin: "22:30", valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(), fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: [], ...extra
    };
}
const instantanea = (extra = {}) => entrada({ publicar_en: undefined, publicacion_inmediata: true, ...extra });

// Con contador: las pruebas de concurrencia anidan silencios a la vez.
const consolaReal = { log: console.log, table: console.table, dir: console.dir, warn: console.warn, error: console.error };
let silencios = 0;
async function silencio(fn) {
    if (silencios++ === 0) console.log = console.table = console.dir = console.warn = console.error = () => {};
    try { return await fn(); } finally { if (--silencios === 0) Object.assign(console, consolaReal); }
}

async function crear(datos, u = A) { const c = await silencio(() => servicio.crearSorteo(u, datos)); assert.ok(c.ok, JSON.stringify(c)); return c.data; }
async function huella(id, u = A) { const v = await silencio(() => servicio.vistaPrevia(u, id)); assert.ok(v.ok, JSON.stringify(v)); return v.data.huella_tabla; }
async function publicarAhora(s, imagen, u = A, extra = {}) { return silencio(async () => servicio.publicarAhora(u, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(imagen), huella: await huella(s.id, u), ...extra })); }
const tick = (ahora, u = A, sorteoId = null) => silencio(() => publicador.tick(sock(u), { ahora, deps: { ...deps(), puedeActuar: () => true }, sorteoId }));
const grupoDe = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const a = (jid) => enviados.filter(e => e.jid === jid);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------------ 1-3 ---

prueba("1. Instantáneo: «Publicar ahora» guarda la captura y el núcleo la envía (sin Chromium)", async () => {
    escenario(); reloj = seg(0);
    const s = await crear(instantanea({ grupos: ["g1@g.us", "g2@g.us"] }));
    const res = await publicarAhora(s, P1);
    assert.ok(res.ok && res.data.publicados === 2, JSON.stringify(res));
    assert.ok(a("g1@g.us")[0].image.equals(P1) && a("g2@g.us")[0].image.equals(P1));
    assert.strictEqual((await capturaProgramada.leer(s.id)).origen, "publicar_ahora");
    assert.strictEqual(capturasServidor, 0);
});

prueba("2. Programado: a su hora genera una imagen NUEVA (capturarTabla en Chromium headless, no la de «Confirmar») y sale por el MISMO núcleo con el mismo pie", async () => {
    escenario(); reloj = seg(0);
    const inst = await crear(instantanea());
    await publicarAhora(inst, P1);
    const pieInstantaneo = enviados[0].texto;
    escenario();
    const s = await crear(entrada());
    const c = await silencio(async () => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(P1), huella: await huella(s.id) }));
    assert.ok(c.ok, JSON.stringify(c));
    await tick(seg(60));
    assert.strictEqual(a("g1@g.us").length, 1);
    assert.strictEqual(capturasServidor, 1, "una generación al llegar la hora");
    assert.ok(!a("g1@g.us")[0].image.equals(P1), "no reutiliza la captura de la confirmación");
    assert.ok(a("g1@g.us")[0].image.equals(ultimaGenerada()), "la imagen recién generada");
    const g = generadas[0];
    assert.strictEqual(g.precio, 3000);
    assert.strictEqual(g.usuarioId, A);
    assert.strictEqual(g.opciones.datos.numerosPagados.length, 3, "los datos persistidos de la tabla");
    assert.strictEqual(a("g1@g.us")[0].texto, pieInstantaneo, "mismo pie que el instantáneo");
});

prueba("3. «Compartir» con un grupo nuevo: su captura se guarda y el núcleo la publica en el grupo nuevo", async () => {
    escenario(); reloj = seg(0);
    const s = await crear(instantanea());
    await publicarAhora(s, P1);
    const cg = await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g2@g.us"], { origen: "tablas" }));
    assert.ok(cg.ok, JSON.stringify(cg));
    reloj = seg(120);
    fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "50").estado = "reservado";   // ventas entre medias
    const r = await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id, { imagen: P2 }));     // lo que llama routes/tablas.js
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(a("g2@g.us").length, 1);
    assert.ok(a("g2@g.us")[0].image.equals(P2), "la captura de Compartir");
    assert.strictEqual(a("g1@g.us").length, 1, "el grupo ya publicado no se toca");
    assert.strictEqual((await capturaProgramada.leer(s.id)).origen, "grupos_nuevos");
    assert.strictEqual(capturasServidor, 0);
});

// ------------------------------------------------------------- 4 y 5 ---

prueba("4. Reintentar: sin captura nueva usa la del panel si la tabla no cambió; un programado con la tabla cambiada se publica a su hora con imagen NUEVA, una vez", async () => {
    escenario(); reloj = seg(0);
    const s = await crear(instantanea({ grupos: ["g1@g.us", "g2@g.us"] }));
    falla = (jid) => (jid === "g2@g.us" ? "conexión cerrada" : null);
    await publicarAhora(s, P1);
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "requiere_revision");
    falla = () => null;
    reloj = seg(30);
    const r1 = await silencio(() => servicio.reintentarGrupo(A, s.id, "g2@g.us"));
    assert.ok(r1.ok && grupoDe(s.id, "g2@g.us").estado === "publicado", JSON.stringify(r1));
    assert.ok(a("g2@g.us")[0].image.equals(P1), "la imagen guardada, sin Chromium");

    // Programado con la tabla cambiada → revisión → reintento con captura nueva.
    escenario();
    const p = await crear(entrada());
    await silencio(async () => servicio.confirmar(A, p.id, { version: p.version, confirmacion: true, imagen: dataUrl(P1), huella: await huella(p.id) }));
    fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "40").estado = "reservado";
    await tick(seg(60));
    assert.strictEqual(grupoDe(p.id, "g1@g.us").estado, "publicado", grupoDe(p.id, "g1@g.us").ultimo_error);
    assert.strictEqual(enviados.length, 1);
    assert.ok(!enviados[0].image.equals(P1), "nunca la imagen desactualizada de la confirmación");
    assert.ok(generadas[0].opciones.datos.numerosOcupados.includes("40"), "la imagen incluye la reserva hecha después de programar");
    assert.ok(enviados[0].image.equals(ultimaGenerada()));
    // Ciclos posteriores no repiten la publicación ni la generación.
    await tick(seg(90));
    await tick(seg(120));
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(capturasServidor, 1);
});

prueba("5. Grupos nuevos desde «Editar»: con huella vieja no guarda ni envía; sin captura y tabla cambiada → imagen NUEVA del servidor con la tabla actual", async () => {
    escenario(); reloj = seg(0);
    const s = await crear(instantanea());
    await publicarAhora(s, P1);
    await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g2@g.us", "g3@g.us"], { origen: "editar" }));
    reloj = seg(60);
    const vieja = await huella(s.id);
    fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "60").estado = "reservado";
    const rechazada = await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id, { imagen: dataUrl(P2), huella: vieja }));
    assert.strictEqual(rechazada.motivo, "tabla_cambiada");
    assert.ok((await capturaProgramada.leer(s.id)).png.equals(P1), "no se sustituyó la imagen");
    assert.strictEqual(enviados.length, 1);

    const sinImagen = await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    assert.ok(sinImagen.ok);
    assert.strictEqual(enviados.length, 3, "g2 y g3 publicados");
    for (const g of ["g2@g.us", "g3@g.us"]) assert.strictEqual(grupoDe(s.id, g).estado, "publicado", grupoDe(s.id, g).ultimo_error);
    assert.ok(!a("g2@g.us")[0].image.equals(P1), "la imagen guardada ya no es la de la tabla: no se envía");
    assert.ok(a("g2@g.us")[0].image.equals(ultimaGenerada()) && a("g3@g.us")[0].image.equals(ultimaGenerada()));
    assert.ok(generadas[0].opciones.datos.numerosOcupados.includes("60"));
    assert.strictEqual(capturasServidor, 1, "una sola generación para los dos grupos con la misma tabla");
});

// ------------------------------------------------------------- 6 a 8 ---

prueba("6. Reiniciar la tabla antes de publicar: el reinicio va ANTES del envío y la imagen (tabla ya libre) coincide con la tabla reiniciada", async () => {
    escenario();
    const s = await crear(entrada({ tabla: { reiniciar: true } }));
    const v = await silencio(() => servicio.vistaPrevia(A, s.id));
    assert.ok(v.ok && v.data.reinicio?.al_publicar, JSON.stringify(v.data?.bloqueos));
    assert.strictEqual(v.data.numeros.numerosOcupados.length, 0, "la vista previa pinta la tabla como quedará");
    const c = await silencio(() => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(P1), huella: v.data.huella_tabla, reinicio: { confirmado: true } }));
    assert.ok(c.ok, JSON.stringify(c));
    assert.strictEqual(fake.tablas[T5K].filter(f => f.usuario_id === A && f.estado !== "libre").length, 3, "programar no toca la tabla");
    await tick(seg(-30));   // reinicio anticipado (un minuto antes)
    await tick(seg(60));
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado", grupoDe(s.id, "g1@g.us").ultimo_error);
    const aplicado = rpc.llamadas.find(l => l.args.p_aplicar);
    assert.ok(aplicado && aplicado.cuando === 0, "el reinicio se aplicó antes de cualquier envío");
    assert.strictEqual(fake.tablas.reservas_archivo.length, 3, "los 3 números del sorteo anterior se archivaron");
    assert.strictEqual(capturasServidor, 1);
    assert.strictEqual(generadas[0].opciones.datos.numerosOcupados.length, 0, "la imagen pinta la tabla YA reiniciada");
    assert.ok(enviados[0].image.equals(ultimaGenerada()));
});

prueba("7-8. Conservar la tabla: se publica si no cambió; si cambió después de programar, se publica con la tabla ACTUAL (imagen nueva)", async () => {
    escenario();
    const s = await crear(entrada());
    await silencio(async () => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(P1), huella: await huella(s.id) }));
    await tick(seg(60));
    assert.ok(a("g1@g.us")[0]?.image.equals(ultimaGenerada()));
    assert.strictEqual(generadas[0].opciones.datos.numerosPagados.length, 3);
    assert.strictEqual(fake.tablas[T5K].filter(f => f.usuario_id === A && f.estado === "pagado").length, 3, "conservar no libera nada");

    escenario();
    const p = await crear(entrada());
    await silencio(async () => servicio.confirmar(A, p.id, { version: p.version, confirmacion: true, imagen: dataUrl(P1), huella: await huella(p.id) }));
    fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "70").estado = "pagado";
    await tick(seg(60));
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(grupoDe(p.id, "g1@g.us").estado, "publicado");
    assert.ok(generadas[0].opciones.datos.numerosPagados.includes("70"), "el pago hecho después de programar sale en la imagen");
    assert.ok(enviados[0].image.equals(ultimaGenerada()));
});

// ------------------------------------------------------------ F4-G -----

prueba("13. Chromium falla a la hora: no se envía NADA (ni la captura de la confirmación); el ciclo siguiente genera de nuevo y publica una vez", async () => {
    escenario();
    const s = await crear(entrada());
    await silencio(async () => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(P1), huella: await huella(s.id) }));
    servidorFalla = "Failed to launch the browser process (simulado)";
    await tick(seg(60));
    assert.strictEqual(enviados.length, 0, "sin imagen nueva no se publica una antigua");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "fallido");
    assert.ok(/Failed to launch/.test(grupoDe(s.id, "g1@g.us").ultimo_error), "se registra el error real");
    assert.ok(!fake.tablas.eventos_bot.length, "sin imagen no se crea el evento");
    servidorFalla = null;
    fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "77").estado = "reservado";
    await tick(seg(180));
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado", grupoDe(s.id, "g1@g.us").ultimo_error);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(capturasServidor, 2, "el fallo no se guarda: se vuelve a generar");
    assert.ok(generadas[1].opciones.datos.numerosOcupados.includes("77"));
    assert.ok(enviados[0].image.equals(ultimaGenerada()));
});

prueba("14. Dos ciclos simultáneos de un programado con 3 grupos: UNA generación, un envío por grupo, la misma imagen", async () => {
    escenario();
    const s = await crear(entrada({ grupos: ["g1@g.us", "g2@g.us", "g3@g.us"] }));
    await silencio(async () => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(P1), huella: await huella(s.id) }));
    retardoGenerar = 30;
    retardoEnvio = 10;
    await Promise.all([tick(seg(60)), tick(seg(60)), tick(seg(61))]);
    await tick(seg(120));
    for (const g of ["g1@g.us", "g2@g.us", "g3@g.us"]) {
        assert.strictEqual(a(g).length, 1, `un envío en ${g}`);
        assert.ok(a(g)[0].image.equals(ultimaGenerada()));
    }
    assert.strictEqual(capturasServidor, 1, "una sola generación");
});

prueba("15. Perfil y diseño guardados en el sorteo llegan al generador (la misma imagen que «Compartir» en ese dispositivo)", async () => {
    escenario();
    const s = await crear(entrada());
    await silencio(async () => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(P1), huella: await huella(s.id), captura: { ventana: 390, contenido: 358 } }));
    await tick(seg(60));
    const g = generadas[0];
    assert.ok(g, "se generó");
    assert.deepStrictEqual(g.opciones.captura, { ventana: 390, contenido: 358 });
    const sorteo = fake.tablas.sorteos_programados.find(x => x.id === s.id);
    const { normalizarConfigDiseno } = require(r("sorteos/disenoTabla.js"));
    assert.deepStrictEqual(g.opciones.datos.diseno, normalizarConfigDiseno(sorteo.config?.diseno?.config ?? null));
    assert.strictEqual(g.opciones.datos.cifras, sorteo.cifras);
    assert.strictEqual(g.opciones.datos.cantidad, sorteo.cantidad_numeros);
});

// ---------------------------------------------------------- 9 y 10 -----

prueba("9a. Fallo «intermitente» del instantáneo REPRODUCIDO y corregido: otro ciclo del publicador reclama grupos a la vez → misma imagen, una vez por grupo, sin Chromium", async () => {
    escenario(); reloj = seg(0);
    const s = await crear(instantanea({ grupos: ["g1@g.us", "g2@g.us", "g3@g.us"] }));
    retardoEnvio = 25;
    const pedido = publicarAhora(s, P1);
    // Otro proceso/ciclo del publicador (como el de 30 s antes de excluir
    // instantáneos, o un segundo proceso PM2) entra en cuanto se confirma.
    while (fake.tablas.sorteos_programados.find(x => x.id === s.id).estado === "borrador") await new Promise(res => setImmediate(res));
    const ciclo = tick(seg(1), A, s.id);
    await Promise.all([pedido, ciclo]);
    for (const g of ["g1@g.us", "g2@g.us", "g3@g.us"]) {
        assert.strictEqual(a(g).length, 1, `${g}: una sola publicación`);
        assert.ok(a(g)[0].image.equals(P1), `${g}: la captura del panel`);
        assert.strictEqual(grupoDe(s.id, g).estado, "publicado", grupoDe(s.id, g).ultimo_error);
    }
    assert.strictEqual(capturasServidor, 0, "ningún grupo cae en la captura del servidor");
});

prueba("9b. Doble clic: dos «Publicar ahora» y dos «Reintentar» simultáneos publican una sola vez", async () => {
    escenario(); reloj = seg(0);
    const s = await crear(instantanea({ grupos: ["g1@g.us", "g2@g.us"] }));
    const h = await huella(s.id);
    const pedir = () => silencio(() => servicio.publicarAhora(A, s.id, { version: s.version, confirmacion: true, imagen: dataUrl(P1), huella: h }));
    falla = (jid) => (jid === "g2@g.us" ? "fallo" : null);
    const [x, y] = await Promise.all([pedir(), pedir()]);
    assert.ok(x.ok && y.ok, JSON.stringify([x, y]).slice(0, 600));
    assert.ok(x.data.repetido || y.data.repetido, "la segunda devuelve el estado sin publicar");
    assert.strictEqual(a("g1@g.us").length, 1);
    falla = () => null;
    const reintentar = () => silencio(async () => servicio.reintentarGrupo(A, s.id, "g2@g.us", { imagen: dataUrl(P2), huella: await huella(s.id) }));
    await Promise.all([reintentar(), reintentar()]);
    assert.strictEqual(a("g2@g.us").length, 1, "un solo envío al reintentar dos veces a la vez");
});

prueba("10. Aislamiento entre clientes: B no publica, reintenta ni usa la imagen de un sorteo de A", async () => {
    escenario(); reloj = seg(0);
    const sa = await crear(instantanea({ grupos: ["g1@g.us", "g2@g.us"] }));
    falla = (jid) => (jid === "g2@g.us" ? "fallo" : null);
    await publicarAhora(sa, P1);
    falla = () => null;
    const ajena = await silencio(() => servicio.reintentarGrupo(B, sa.id, "g2@g.us", { imagen: dataUrl(PB), huella: "x" }));
    assert.strictEqual(ajena.ok, false);
    const ajena2 = await silencio(() => gruposSorteo.publicarGruposNuevos(B, sa.id, { imagen: PB }));
    assert.strictEqual(ajena2.ok, false);
    assert.ok((await capturaProgramada.leer(sa.id)).png.equals(P1), "la imagen de A intacta");

    const sb = await crear(instantanea({ grupos: ["gb@g.us"], cuentas: ["cuenta-b1"] }), B);
    const rb = await publicarAhora(sb, PB, B);
    assert.ok(rb.ok && rb.data.publicados === 1, JSON.stringify(rb));
    assert.ok(a("gb@g.us")[0].image.equals(PB) && a("gb@g.us")[0].usuarioId === B);
    assert.ok(enviados.every(e => (e.usuarioId === B) === (e.jid === "gb@g.us")), "cada cliente solo en sus grupos con su socket");
    // La huella de B se calcula con SU cuadrícula (la tabla física es compartida).
    assert.notStrictEqual(await huella(sb.id, B), capturaProgramada.huellaNumeros({}), "huella con números de B");
});

prueba("11. Almacén: dos guardados simultáneos nunca dejan una ficha apuntando a otra imagen; tras «reiniciar el proceso» se lee igual", async () => {
    escenario();
    const id = "00000000-0000-4000-8000-0000000000aa";
    await Promise.all([1, 2, 3, 4, 5, 6].map(i => capturaProgramada.guardar(id, { version: 1, huella: `h${i}`, png: png(1000 + i) })));
    const leida = await capturaProgramada.leer(id);
    const i = Number(leida.huella.slice(1));
    assert.ok(leida.png.equals(png(1000 + i)), "imagen y ficha del mismo guardado");
    delete require.cache[r("sorteos/capturaProgramada.js")];
    const otraVez = require(r("sorteos/capturaProgramada.js"));
    assert.ok((await otraVez.leer(id)).png.equals(leida.png), "persistente en disco (reinicio de PM2)");
});

prueba("12. compartirTabla() heredada (tabla inicial del Scheduler) envía por el MISMO núcleo con su clave de siempre; una captura fallida queda registrada y no se reintenta en cada ciclo", async () => {
    escenario();
    const previo = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "";   // nunca arranca Chromium real en la prueba
    try {
        const evento = { id: "ev-1", grupo_id: "g1@g.us", usuario_id: A, valor: 3000, tabla: T5K, nombre_evento: "Detectado", hora_fin: "22:30", activo: true };
        fake.tablas.eventos_bot.push({ ...evento, identidad_evento_real: "det-1", cifras: 2, cantidad_numeros: 100 });
        const idem = { claveIdempotencia: "ses-1:INITIAL_TABLE", eventSessionId: null, tipoAccion: "INITIAL_TABLE" };
        const filas = () => (fake.tablas.automation_actions || []).filter(x => x.clave_idempotencia === "ses-1:INITIAL_TABLE");
        const r1 = await silencio(() => compartirTabla.compartirTabla({ evento, sock: sock(A), idempotencia: idem }));
        assert.strictEqual(r1.enviado, false);
        assert.strictEqual(filas().length, 1, "intento registrado con la clave de siempre");
        assert.deepStrictEqual([filas()[0].tipo_accion, filas()[0].estado], ["INITIAL_TABLE", "error"]);
        const r2 = await silencio(() => compartirTabla.compartirTabla({ evento, sock: sock(A), idempotencia: idem }));
        assert.strictEqual(r2.enviado, false);
        assert.strictEqual(filas().length, 1, "el ciclo siguiente no vuelve a intentarlo");
        assert.strictEqual(enviados.length, 0);
    } finally {
        process.env.FRONTEND_URL = previo ?? "";
        if (previo === undefined) delete process.env.FRONTEND_URL;
    }
});

// ------------------------------------------------------------- ejecutar ---

(async () => {
    let fallidas = 0;
    for (const { n, fn } of pruebas.filter(p => !process.env.SOLO || p.n.startsWith(process.env.SOLO))) {
        try { await fn(); console.log(`✅ ${n}`); }
        catch (err) { fallidas++; console.log(`❌ ${n}\n   ${err?.stack || err}`); }
    }
    fs.rmSync(DIR_CAPTURAS, { recursive: true, force: true });
    console.log(`\nTOTAL: ${pruebas.length}  ✅ PASA: ${pruebas.length - fallidas}  ❌ FALLA: ${fallidas}`);
    process.exit(fallidas ? 1 : 0);
})();
