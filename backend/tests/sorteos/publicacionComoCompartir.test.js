// ==========================================================================
// PRUEBAS — publicar un sorteo programado = «Compartir» ese sorteo.
//
// Al llegar la hora, el publicador ejecuta las MISMAS funciones del botón
// «Compartir» en el servidor: capturarImagenTabla (precio, dueño, evento ->
// tabla guardada y diseño del sorteo), textoParaCompartir (el pie) y
// compartirEnGrupos (imagen + pie con ExecutionGuard, clave TABLA_COMPARTIR).
// Sin imagen no se publica ni se envía texto solo. Además: el evento queda
// listo para reservar antes de contar como publicado, las reservas
// anticipadas se conservan y cuentan, un envío incierto nunca se repite y
// el detector no reescribe el evento al volver a leer su anuncio.
//
// Reales: sorteos/{servicio,publicador,disponibilidad,repo,mensajes}.js,
// services/{compartirTabla (compartirEnGrupos),destinosCompartir,
// datosTablaImprimir}.js, baileys/send.js (sendImage), guardarEvento.js,
// consultarEvento.js, abrirGrupo.js, executionGuard.js, actualizarEvento.js,
// detectarEvento.js. Simulados: Supabase (memoria), el socket de WhatsApp y
// la captura con Puppeteer (ver la prueba real de captura aparte).
//
//     node backend/tests/sorteos/publicacionComoCompartir.test.js
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
const repo = require(r("sorteos/repo.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { datosTablaImprimir } = require(r("services/datosTablaImprimir.js"));
const { normalizarConfigDiseno } = require(r("sorteos/disenoTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));

// Hoy 15/10; se publica el 22/10 08:00 (Colombia) y se juega ese día.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const SIGUIENTE = new Date("2026-10-22T13:01:30Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000 (configuración base)
const T1K = "reservas_dos_cifras";        // $2.000
const BOGOTA = "identidad-bogota-21-10";
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

// A tiene «Lotería de Bogotá» ya cerrada en g1 (90 números en la tabla de
// $2.000) y las cuadrículas completas de $2.000 y $3.000.
function escenario() {
    fake = crearFake();
    enviados = [];
    operaciones = [];
    fallaEnvio = () => null;
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [{
        id: "ev-bogota-g1", grupo_id: "g1@g.us", usuario_id: A, activo: false, abierto: false, estado: "cerrado",
        identidad_evento_real: BOGOTA, nombre_evento: "Lotería de Bogotá", tabla: T1K, valor: "2000", cifras: 2, cantidad_numeros: 100,
        hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-21", creado_en: new Date("2026-09-30T21:32:28Z")
    }];
    t.reservas_archivo = [];
    for (const tabla of [T5K, T1K]) {
        t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    }
    t[T1K].slice(0, 90).forEach((f, i) => Object.assign(f, {
        estado: i < 65 ? "pagado" : "reservado", identidad_evento_real: BOGOTA, evento_id: "ev-bogota-g1", grupo_id: "g1@g.us"
    }));
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Antioqueñita Día",
        hora_fin: "22:30",
        valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us", "g2@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" },
        recordatorios: [],
        diseno: { origen: "preset", nombre: "Morado", config: DISENO },
        ...extra
    };
}

// Dependencias del publicador: las funciones REALES de «Compartir»
// (textoParaCompartir, compartirEnGrupos con su ExecutionGuard). Solo la
// captura (Puppeteer) es simulada; `cambios` reemplaza dependencias.
function deps(cambios = {}) {
    const capturas = [];
    return {
        capturas,
        d: {
            supabase: { from: (t) => fake.client.from(t) },
            guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
            puedeActuar: () => true,
            capturarImagen: async (precio, usuarioId, eventoId) => { capturas.push({ precio, usuarioId, eventoId }); return PNG; },
            textoParaCompartir: destinos.textoParaCompartir,
            compartirEnGrupos,
            sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); },
            ...cambios
        }
    };
}

// Socket de WhatsApp simulado: registra TODO lo que se envía y cada
// operación de grupo. falla(jid) hace fallar el envío.
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

async function silencio(fn) {
    const { log, table, dir, warn } = console;
    console.log = console.table = console.dir = console.warn = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn }); }
}

async function programar(datos) {
    const c = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const tick = (ahora, d) => silencio(() => publicador.tick(sock(), { ahora, deps: d }));

const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDe = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const eventosDe = (s, g) => fake.tablas.eventos_bot.filter(e => e.grupo_id === g && e.usuario_id === A && e.identidad_evento_real === s.identidad_evento_real);
const eventoDe = (s, g) => eventosDe(s, g)[0];

// Lo que «Compartir» (routes/tablas.js) usaría para el precio: el evento
// ACTIVO más reciente de la tabla de ese precio (obtenerEventoActivoReal),
// su texto (destinos.textoParaCompartir) y los datos de su imagen
// (capturarImagenTabla -> datosTablaImprimir(precio, usuario, evento.id)).
async function loQueCompartiria(precio) {
    const { data: activos } = await fake.client.from("eventos_bot").select("*")
        .eq("tabla", T5K).eq("usuario_id", A).eq("activo", true).order("creado_en", { ascending: false }).limit(1);
    const evento = activos[0];
    const texto = await destinos.textoParaCompartir(A, evento);
    const imagen = await datosTablaImprimir(A, precio, evento.id);
    return { evento, texto, imagen };
}

const historicoBogota = () => JSON.stringify({
    evento: fake.tablas.eventos_bot.find(e => e.id === "ev-bogota-g1"),
    reservas: fake.tablas[T1K].filter(f => f.estado !== "libre")
});

// Registros del ExecutionGuard de los envíos de «Compartir».
const accionesCompartir = () => (fake.tablas.automation_actions || []).filter(a => a.tipo_accion === "TABLA_COMPARTIR");
const aperturas = (g) => operaciones.filter(o => o.jid === g && o.ajuste === "not_announcement").length;

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- pruebas ---

prueba("1. Publicar = «Compartir»: imagen + pie por compartirEnGrupos, con la tabla, el diseño y el texto del sorteo", async () => {
    escenario();
    const bogota = historicoBogota();
    const s = await programar(entrada());
    const d = deps();
    await tick(EN_PUBLICACION, d.d);

    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(enviados.length, 2, "un envío por grupo");
    assert.ok(enviados.every(e => e.tipo === "imagen" && e.image === PNG), "siempre la imagen capturada, con pie");

    // El envío pasó por compartirEnGrupos: su ExecutionGuard (TABLA_COMPARTIR)
    // con una solicitud fija de ESTE sorteo y grupo.
    const acciones = accionesCompartir();
    assert.strictEqual(acciones.length, 2);
    for (const g of ["g1@g.us", "g2@g.us"]) {
        assert.ok(acciones.some(a => a.clave_idempotencia === `TABLA_COMPARTIR:${A}:3000:sorteo-${s.id}-publicacion-0:${g}` && a.estado === "ok"), `${g}: clave de «Compartir»`);
    }

    const compartir = await loQueCompartiria(3000);
    assert.strictEqual(compartir.texto.origen, "sorteo");
    assert.strictEqual(compartir.evento.identidad_evento_real, s.identidad_evento_real, "«Compartir» resuelve ESTE sorteo");

    for (const g of ["g1@g.us", "g2@g.us"]) {
        const ev = eventoDe(s, g);
        const envio = enviados.find(e => e.jid === g);
        assert.strictEqual(envio.texto, compartir.texto.texto, `${g}: el mismo pie que «Compartir»`);
        assert.ok(envio.texto.includes("Antioqueñita Día") && envio.texto.includes("$3.000") && envio.texto.includes("Premio mayor") && envio.texto.includes("Nequi A"));
        assert.strictEqual(ev.tabla, s.tabla, "evento en la tabla guardada");
        assert.ok(ev.activo && ev.abierto);
        assert.strictEqual(grupoDe(s.id, g).evento_bot_id, ev.id);
        assert.strictEqual(grupoDe(s.id, g).ultimo_error, null);
    }

    // La captura se pidió con lo que «Compartir» usa (precio, dueño, evento
    // del sorteo): misma tabla, mismos números y el diseño del sorteo.
    assert.strictEqual(d.capturas.length, 2);
    for (const c of d.capturas) {
        assert.deepStrictEqual([c.precio, c.usuarioId], [3000, A]);
        assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === c.eventoId).identidad_evento_real, s.identidad_evento_real);
        assert.deepStrictEqual(await datosTablaImprimir(c.usuarioId, c.precio, c.eventoId), compartir.imagen, "misma imagen que «Compartir»");
    }
    assert.deepStrictEqual(compartir.imagen.data.diseno, normalizarConfigDiseno(DISENO), "diseño guardado en el sorteo");
    assert.strictEqual(compartir.imagen.data.numerosDisponibles.length, 100, "cuadrícula de la tabla de $3.000");
    assert.strictEqual(historicoBogota(), bogota, "el sorteo anterior conserva su evento y sus reservas");

    // Ciclos siguientes: nada se repite.
    await tick(SIGUIENTE, d.d);
    assert.strictEqual(enviados.length, 2);
});

prueba("2. Texto propio del sorteo: el pie es el mismo que daría «Compartir»", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"], mensajes: { publicacion: "{{nombre}} {{fecha}} — {{valor}} — cierra {{hora_cierre}}", aviso_cierre: "" } }));
    await tick(EN_PUBLICACION, deps().d);

    const compartir = await loQueCompartiria(3000);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].texto, compartir.texto.texto);
    assert.ok(enviados[0].texto.startsWith("Antioqueñita Día 2026-10-22 — $3.000"), enviados[0].texto);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
});

prueba("3. La imagen no se genera: nada se envía (ni texto), el grupo no se abre, queda pendiente con el error; luego publica una vez", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"] }));
    let captura = async () => { throw new Error("Chromium no disponible (simulado)"); };
    const d = deps({ capturarImagen: (...a) => captura(...a) });
    await tick(EN_PUBLICACION, d.d);

    assert.strictEqual(enviados.length, 0, "ni imagen ni texto");
    assert.strictEqual(aperturas("g1@g.us"), 0, "el grupo no se abre sin anuncio");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "fallido");
    assert.match(grupoDe(s.id, "g1@g.us").ultimo_error, /No se pudo generar la imagen de la tabla \(Chromium no disponible/);
    assert.notStrictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(accionesCompartir().length, 0);

    captura = async () => PNG;
    await tick(SIGUIENTE, d.d);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].tipo, "imagen");
    assert.strictEqual(eventosDe(s, "g1@g.us").length, 1, "misma fila del sorteo al reintentar");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
});

prueba("4. La imagen falla siempre: tras los reintentos automáticos queda en revisión, sin ningún envío", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"] }));
    const d = deps({ capturarImagen: async () => { throw new Error("Timeout de Puppeteer (simulado)"); } });
    for (let i = 0; i < publicador.MAX_INTENTOS_AUTOMATICOS + 2; i++) {
        await tick(new Date(EN_PUBLICACION.getTime() + i * 30000), d.d);
    }
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.match(grupoDe(s.id, "g1@g.us").ultimo_error, /imagen de la tabla/);
    assert.notStrictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(eventosDe(s, "g1@g.us").length, 1, "una sola fila del sorteo en todos los reintentos");
});

prueba("5. El grupo no se abre: no se envía ni cuenta como publicado; al reintentar, misma fila y un solo anuncio", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"] }));
    let abre = false;
    const d = deps({ abrirGrupo: async () => abre });
    await tick(EN_PUBLICACION, d.d);

    assert.strictEqual(enviados.length, 0, "sin grupo abierto no hay anuncio");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "fallido");
    assert.match(grupoDe(s.id, "g1@g.us").ultimo_error, /apertura del grupo/);
    assert.strictEqual(eventoDe(s, "g1@g.us").abierto, false, "el worker de eventos también lo reintenta");

    abre = true;
    await tick(SIGUIENTE, d.d);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(eventosDe(s, "g1@g.us").length, 1, "la misma fila del sorteo, sin duplicar");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
});

prueba("6. Envío incierto: revisión sin reenviar; el detector no reescribe el evento al leer de nuevo el anuncio", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"] }));
    let intentos = 0;
    fallaEnvio = () => { intentos++; return "Timed Out (simulado)"; };
    const d = deps();
    await tick(EN_PUBLICACION, d.d);
    await tick(SIGUIENTE, d.d);
    await tick(new Date(SIGUIENTE.getTime() + 30000), d.d);

    assert.strictEqual(intentos, 1, "nunca se reenvía solo");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.match(grupoDe(s.id, "g1@g.us").ultimo_error, /Timed Out/);
    const ev = eventoDe(s, "g1@g.us");
    assert.ok(ev && ev.activo, "el evento existe y acepta reservas");
    const antes = JSON.stringify(ev);

    // El anuncio llegó igual al grupo y alguien lo vuelve a publicar a mano.
    const texto = "⚡ Para Hoy 22 De Octubre ⚡\n\n🎰 Antioqueñita Día - 10:30 PM\n\n🍀 Dos últimas cifras → $300.000\n\n🎯 Valor número: $3.000\n\n🏦 Nequi\n📲 3000000001";
    const ctx = { sock: sock(), grupo: { remoteJid: "g1@g.us" }, chat: { remoteJid: "g1@g.us" }, textoOriginal: texto, session: { usuarioId: A } };
    const devuelto = await silencio(() => detectarEvento(ctx));

    assert.ok(devuelto, "el anuncio se reconoce");
    assert.strictEqual(devuelto.id, ev.id, "devuelve el evento programado");
    assert.strictEqual(JSON.stringify(eventoDe(s, "g1@g.us")), antes, "la fila del sorteo no cambia");
    assert.strictEqual(fake.tablas.eventos_bot.filter(e => e.grupo_id === "g1@g.us").length, 2, "ninguna fila nueva");
});

prueba("7. La tabla del precio cambió desde que se programó: no se publica ni se crea evento", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"] }));
    fake.tablas.tablas_cliente = [
        { usuario_id: A, precio: 2000, tabla_fisica: T1K, cifras: 2, cantidad: 100, activa: true },
        { usuario_id: A, precio: 3000, tabla_fisica: T1K, cifras: 2, cantidad: 100, activa: true }
    ];
    const eventosAntes = fake.tablas.eventos_bot.length;
    const d = deps();
    await tick(EN_PUBLICACION, d.d);

    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(d.capturas.length, 0, "ni siquiera se captura otra tabla");
    assert.strictEqual(fake.tablas.eventos_bot.length, eventosAntes);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.match(grupoDe(s.id, "g1@g.us").ultimo_error, /ya no es la del sorteo/);
});

prueba("8. Reservas anticipadas: se conservan, cuentan en el evento y salen ocupadas en la imagen", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"] }));
    // Reserva hecha desde el panel antes de publicar: identidad del sorteo, sin evento.
    Object.assign(fake.tablas[T5K].find(f => f.numero === "07"), {
        estado: "reservado", identidad_evento_real: s.identidad_evento_real, evento_id: null,
        grupo_id: "g1@g.us", comprador: "Cliente anticipado", fecha_reserva: "2026-10-20", hora_reserva: "10:00:00"
    });
    const d = deps();
    await tick(EN_PUBLICACION, d.d);

    const fila = fake.tablas[T5K].find(f => f.numero === "07");
    assert.strictEqual(fila.estado, "reservado");
    assert.strictEqual(fila.identidad_evento_real, s.identidad_evento_real);
    const ev = eventoDe(s, "g1@g.us");
    assert.strictEqual(ev.reservados, 1, "el contador del evento la incluye");
    assert.strictEqual(ev.libres, 99);
    const datos = await datosTablaImprimir(A, d.capturas[0].precio, d.capturas[0].eventoId);
    assert.ok(!datos.data.numerosDisponibles.includes("07"), "la imagen la muestra ocupada");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
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

