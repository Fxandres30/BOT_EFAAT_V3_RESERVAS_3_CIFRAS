// ==========================================================================
// PRUEBAS (UX-07) — el publicador respeta el estado administrativo del
// evento, captura ANTES de escribirlo y no reescribe lo que no cambió.
//
// Casos ocurridos con Lotería de Manizales (30/10): 20 intentos reescribieron
// la misma fila, que además revivió tras un cierre manual y una cancelación.
//
// Reales: sorteos/{servicio,publicador,administracion,gestionEventos}.js,
// guardarEvento.js, consultarEvento.js, detectarEvento.js, abrirGrupo.js,
// executionGuard.js, compartirEnGrupos, textoParaCompartir y, en el caso de
// FRONTEND_URL, capturarImagenTabla. Simulados: Supabase (memoria), el
// socket de WhatsApp y el PNG. NO prueban Chromium ni el Droplet.
//
//     node backend/tests/sorteos/publicadorEstados.test.js
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
const { compartirEnGrupos, capturarImagenTabla } = require(r("services/compartirTabla.js"));
const { datosTablaImprimir } = require(r("services/datosTablaImprimir.js"));
const { normalizarConfigDiseno } = require(r("sorteos/disenoTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));

const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const ciclo = (n) => new Date(EN_PUBLICACION.getTime() + n * 30000);
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const G = "g1@g.us";
const T5K = "5k_15k_reservas_2_cifras";
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

let enviados = [];
let fallaEnvio = () => null;
let grupoConDatos = true;

function escenario() {
    fake = crearFake();
    enviados = [];
    fallaEnvio = () => null;
    grupoConDatos = true;
    const t = fake.tablas;
    t.grupos_autorizados = [{ usuario_id: A, grupo_id: G, activo: true }];
    t.grupos = [{ jid: G, nombre: "Pruebas" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const entrada = (extra = {}) => ({
    modalidad: "dos_cifras",
    nombre: "Lotería De Manizales",
    hora_fin: "22:30",
    valor: 3000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }],
    grupos: [G],
    cuentas: ["cuenta-a1"],
    publicar_en: PUBLICAR.toISOString(),
    fecha_sorteo: "2026-10-22",
    mensajes: { publicacion: "", aviso_cierre: "" },
    recordatorios: [],
    diseno: { origen: "preset", nombre: "Morado", config: DISENO },
    ...extra
});

function deps(cambios = {}) {
    const capturas = [];
    return {
        capturas,
        d: {
            supabase: { from: (t) => fake.client.from(t) },
            guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
            puedeActuar: () => true,
            capturarImagen: async (precio, usuarioId, eventoId, opciones) => { capturas.push({ precio, usuarioId, eventoId, opciones }); return PNG; },
            textoParaCompartir: destinos.textoParaCompartir,
            compartirEnGrupos,
            sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); },
            ...cambios
        }
    };
}

const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async () => {
        if (!grupoConDatos) throw new Error("sin metadata");
        return { subject: "Pruebas", participants: [{}], desc: null };
    },
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        const error = fallaEnvio(jid);
        if (error) throw new Error(error);
        enviados.push({ jid, image: contenido.image, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

async function silencio(fn) {
    const { log, table, dir, warn, error } = console;
    console.log = console.table = console.dir = console.warn = console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error }); }
}

async function programar(datos = entrada()) {
    const c = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const tick = (ahora, d) => silencio(() => publicador.tick(sock(), { ahora, deps: d }));
const grupoDe = (s) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === s.id);
const eventosDe = (s) => fake.tablas.eventos_bot.filter(e => e.identidad_evento_real === s.identidad_evento_real);
const escriturasDeEvento = () => fake.control.llamadas.filter(l => l.tabla === "eventos_bot" && l.op !== "select").length;

// El grupo llegó a tener fila de evento sin anuncio (el fallo real de
// Manizales): el texto no se pudo preparar.
const sinTexto = async () => null;

// Fila de un sorteo que ya terminó en el grupo.
function filaTerminada(s, cambios) {
    const fila = {
        id: "ev-terminado", grupo_id: G, usuario_id: A, identidad_evento_real: s.identidad_evento_real,
        nombre_evento: "Lotería De Manizales", tabla: T5K, valor: 3000, cifras: 2, cantidad_numeros: 100,
        hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-22", abierto: true, activo: false,
        estado: "cerrado", cierre_estado: "cerrado", actualizado_en: "2026-10-22T12:00:00.000Z", creado_en: "2026-10-22T11:00:00.000Z",
        ...cambios
    };
    fake.tablas.eventos_bot.push(fila);
    return fila;
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------- orden y captura ---

prueba("1. captura fallida: cero escrituras de evento, en ninguno de los reintentos", async () => {
    escenario();
    const s = await programar();
    const d = deps({ capturarImagen: async () => { throw new Error("Timeout de Chromium (simulado)"); } });
    for (let i = 0; i < publicador.MAX_INTENTOS_AUTOMATICOS + 2; i++) await tick(ciclo(i), d.d);
    assert.strictEqual(escriturasDeEvento(), 0);
    assert.strictEqual(eventosDe(s).length, 0);
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(grupoDe(s).estado, "requiere_revision");
    assert.strictEqual(grupoDe(s).intentos, publicador.MAX_INTENTOS_AUTOMATICOS);
    assert.ok(!/se reintentará/i.test(grupoDe(s).ultimo_error), grupoDe(s).ultimo_error);
});

prueba("2. PNG vacío: no escribe el evento ni envía", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ capturarImagen: async () => Buffer.alloc(0) }).d);
    assert.strictEqual(escriturasDeEvento(), 0);
    assert.strictEqual(grupoDe(s).estado, "fallido");
});

prueba("3. la imagen va antes del evento, sin depender de él: diseño y perfil del sorteo", async () => {
    escenario();
    const s = await programar();
    const orden = [];
    const d = deps({
        capturarImagen: async (precio, usuarioId, eventoId, opciones) => { orden.push("captura"); assert.strictEqual(eventoId, null); assert.deepStrictEqual(opciones.disenoSorteo.config, DISENO); return PNG; },
        guardarEvento: async (args) => { orden.push("evento"); return guardarEvento(args); }
    });
    await tick(ciclo(0), d.d);
    assert.deepStrictEqual(orden, ["captura", "evento"]);
    assert.strictEqual(grupoDe(s).estado, "publicado", grupoDe(s).ultimo_error);
});

prueba("4. el diseño leído del sorteo es el mismo que leído por su evento (compatibilidad con «Compartir»)", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps().d);
    const porEvento = await datosTablaImprimir(A, 3000, eventosDe(s)[0].id);
    const porSorteo = await datosTablaImprimir(A, 3000, null, { disenoSorteo: s.config.diseno });
    assert.deepStrictEqual(porSorteo, porEvento);
    assert.deepStrictEqual(porSorteo.data.diseno, normalizarConfigDiseno(DISENO));
});

// ---------------------------------------------------- error de configuración

prueba("5. FRONTEND_URL ausente (captura real): un solo intento, revisión clara, sin evento; corregida, Reintentar publica", async () => {
    escenario();
    const antes = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;
    try {
        const s = await programar();
        const d = deps({ capturarImagen: capturarImagenTabla });
        for (let i = 0; i < 4; i++) await tick(ciclo(i), d.d);
        const g = grupoDe(s);
        assert.strictEqual(g.estado, "requiere_revision");
        assert.strictEqual(g.intentos, 1, "no gasta cinco intentos idénticos");
        assert.match(g.ultimo_error, /Falta FRONTEND_URL/);
        assert.match(g.ultimo_error, /Reintentar/);
        assert.ok(!/se reintentará/i.test(g.ultimo_error));
        assert.strictEqual(escriturasDeEvento(), 0);

        // Nada automático: solo el administrador.
        const pedido = await silencio(() => servicio.reintentarGrupo(A, s.id, G));
        assert.ok(pedido.ok, JSON.stringify(pedido));
        await tick(ciclo(5), deps().d);
        assert.strictEqual(grupoDe(s).estado, "publicado", grupoDe(s).ultimo_error);
        assert.strictEqual(enviados.length, 1);
    } finally {
        if (antes === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = antes;
    }
});

// ---------------------------------------------------- estado administrativo

prueba("6. Manizales: cierre manual tras un fallo; ni el reintento automático ni el manual lo reactivan", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ textoParaCompartir: sinTexto }).d);
    const ev = eventosDe(s)[0];
    assert.ok(ev?.activo);

    const cierre = await silencio(() => servicio.eventos.aplicar(A, ev.id, { accion: "cerrar", cerrar_grupo_whatsapp: false }));
    assert.ok(cierre.ok, JSON.stringify(cierre));
    const foto = JSON.stringify(ev);

    await tick(ciclo(1), deps().d);
    assert.strictEqual(grupoDe(s).estado, "requiere_revision");
    assert.match(grupoDe(s).ultimo_error, /cerrado.*no se publicó ni se reactivó/);
    assert.strictEqual(JSON.stringify(ev), foto, "reintento automático: fila intacta");

    assert.ok((await silencio(() => servicio.reintentarGrupo(A, s.id, G))).ok);
    await tick(ciclo(2), deps().d);
    assert.strictEqual(JSON.stringify(ev), foto, "reintento manual: fila intacta");
    assert.strictEqual(grupoDe(s).estado, "requiere_revision");
    assert.strictEqual(enviados.length, 0);
});

for (const [nombre, cambios] of [
    ["cancelado", { estado: "cancelado", cierre_motivo: "panel:cancelado" }],
    ["desactivado", { estado: "desactivado", cierre_motivo: "panel:desactivado" }],
    ["eliminado", { estado: "eliminado", cierre_motivo: "panel:eliminado", archivado_en: "2026-10-22T12:00:00.000Z" }]
]) {
    prueba(`7. evento ${nombre}: ningún reintento lo reactiva ni lo recrea`, async () => {
        escenario();
        const s = await programar();
        const fila = filaTerminada(s, cambios);
        const foto = JSON.stringify(fila);
        const d = deps();
        await tick(ciclo(0), d.d);
        assert.ok((await silencio(() => servicio.reintentarGrupo(A, s.id, G))).ok);
        await tick(ciclo(1), d.d);
        assert.strictEqual(JSON.stringify(fila), foto);
        assert.strictEqual(eventosDe(s).length, 1, "no se crea otra fila");
        assert.strictEqual(d.capturas.length, 0, "ni siquiera captura");
        assert.strictEqual(enviados.length, 0);
        assert.match(grupoDe(s).ultimo_error, new RegExp(nombre));
    });
}

prueba("8. fila que un reintento antiguo revivió (activo=true, cierre_estado=cerrado): sigue tratándose como cerrada", async () => {
    escenario();
    const s = await programar();
    const fila = filaTerminada(s, { activo: true, estado: "abierto", cierre_motivo: "panel:cerrado manualmente" });
    const foto = JSON.stringify(fila);
    await tick(ciclo(0), deps().d);
    assert.strictEqual(JSON.stringify(fila), foto);
    assert.strictEqual(grupoDe(s).estado, "requiere_revision");
});

prueba("9. cerrado DURANTE la captura: se relee antes de escribir y no se reabre", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ textoParaCompartir: sinTexto }).d);
    const ev = eventosDe(s)[0];
    const d = deps({
        capturarImagen: async () => {
            await silencio(() => servicio.eventos.aplicar(A, ev.id, { accion: "cerrar", cerrar_grupo_whatsapp: false }));
            return PNG;
        }
    });
    await tick(ciclo(1), d.d);
    assert.strictEqual(ev.activo, false);
    assert.strictEqual(ev.estado, "cerrado");
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(grupoDe(s).estado, "requiere_revision");
});

prueba("10. guardarEvento con una lectura vieja: el UPDATE condicionado no reactiva una fila ya cerrada", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ textoParaCompartir: sinTexto }).d);
    const ev = eventosDe(s)[0];
    const leida = { ...ev };
    Object.assign(ev, { activo: false, estado: "cerrado", cierre_estado: "cerrado" });
    const r2 = await silencio(() => guardarEvento({
        sock: sock(), grupoId: G, eventoAnterior: leida,
        evento: { nombre: "Otro nombre", hora: "22:30", horaCierre: "22:26", valor: 3000, premios: [], tabla: T5K, cifras: 2, cantidad_numeros: 100 },
        sorteoVigente: { identidad_evento_real: s.identidad_evento_real, fecha_evento: "2026-10-22" }
    }));
    assert.strictEqual(r2, null);
    assert.strictEqual(ev.activo, false);
    assert.strictEqual(ev.estado, "cerrado");
});

prueba("11. «Reabrir» sigue siendo la vía explícita: reabierto, el reintento publica en la misma fila", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ textoParaCompartir: sinTexto }).d);
    const ev = eventosDe(s)[0];
    await silencio(() => servicio.eventos.aplicar(A, ev.id, { accion: "cerrar", cerrar_grupo_whatsapp: false }));
    await tick(ciclo(1), deps().d);
    const re = await silencio(() => servicio.eventos.aplicar(A, ev.id, { accion: "reabrir", hora_cierre: "22:26" }));
    assert.ok(re.ok, JSON.stringify(re));
    assert.strictEqual(ev.abierto, false, "el grupo aún no se abrió");
    assert.ok((await silencio(() => servicio.reintentarGrupo(A, s.id, G))).ok);
    await tick(ciclo(2), deps().d);
    assert.strictEqual(grupoDe(s).estado, "publicado", grupoDe(s).ultimo_error);
    assert.strictEqual(eventosDe(s).length, 1);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(ev.abierto, true, "solo tras la confirmación de WhatsApp");
});

// ------------------------------------------------- escrituras sin cambios ---

prueba("12. reintento sin cambios: cero UPDATE y actualizado_en intacto", async () => {
    escenario();
    const s = await programar();
    const d = deps({ textoParaCompartir: sinTexto });
    await tick(ciclo(0), d.d);
    const ev = eventosDe(s)[0];
    const foto = JSON.stringify(ev);
    const antes = escriturasDeEvento();
    for (let i = 1; i < 4; i++) await tick(ciclo(i), d.d);
    assert.strictEqual(escriturasDeEvento(), antes);
    assert.strictEqual(JSON.stringify(ev), foto);
    assert.strictEqual(grupoDe(s).intentos, 4, "los intentos sí cuentan");
});

const anuncio = (cambios = {}) => ({ nombre: "Lotería De Manizales", hora: "22:30", horaCierre: "22:26", valor: 3000, premios: [{ nombre: "Premio mayor", premio: 300000 }], tabla: T5K, cifras: 2, cantidad_numeros: 100, ...cambios });

async function filaActiva() {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ textoParaCompartir: sinTexto }).d);
    const ev = eventosDe(s)[0];
    ev.actualizado_en = "2026-10-22T12:00:00.000Z";
    const guardar = (evento) => silencio(() => guardarEvento({ sock: sock(), grupoId: G, evento, eventoAnterior: { ...ev }, sorteoVigente: { identidad_evento_real: s.identidad_evento_real, fecha_evento: "2026-10-22" } }));
    return { ev, guardar };
}

prueba("13. normalización: horas con segundos, números en texto y premios con otras claves no son cambios", async () => {
    const { ev, guardar } = await filaActiva();
    Object.assign(ev, { hora_fin: "22:30:00", hora_cierre: "22:26:00", valor: "3000", fecha_evento: "2026-10-22T00:00:00" });
    const antes = escriturasDeEvento();
    const premios = ev.premios.map(p => Object.fromEntries(Object.entries(p).reverse()));
    assert.notStrictEqual(JSON.stringify(premios), JSON.stringify(ev.premios), "otro orden de claves");
    await guardar(anuncio({ premios }));
    assert.strictEqual(escriturasDeEvento(), antes);
});

for (const [campo, evento, columna, valor] of [
    ["hora", { hora: "21:00" }, "hora_fin", "21:00"],
    ["cierre", { horaCierre: "20:00" }, "hora_cierre", "20:00"],
    ["premios", { premios: [{ nombre: "Otro", premio: 1 }] }, "premios", [{ nombre: "Otro", premio: 1 }]],
    ["nombre", { nombre: "Otra" }, "nombre_evento", "Otra"],
    ["cantidad", { cantidad_numeros: 50 }, "cantidad_numeros", 50]
]) {
    prueba(`14. cambio real de ${campo}: se actualiza y no toca el ciclo de vida`, async () => {
        const { ev, guardar } = await filaActiva();
        ev.abierto = false;
        const guardado = await guardar(anuncio(evento));
        assert.deepStrictEqual(ev[columna], valor);
        assert.deepStrictEqual(guardado[columna], valor);
        assert.notStrictEqual(ev.actualizado_en, "2026-10-22T12:00:00.000Z");
        assert.strictEqual(ev.abierto, false, "abierto no lo decide una sincronización");
        assert.strictEqual(ev.estado, "abierto");
    });
}

prueba("15. cambio de participantes o descripción del grupo: se actualiza; si no se pudo leer el grupo, no borra lo bueno", async () => {
    const { ev, guardar } = await filaActiva();
    ev.participantes = 7;
    await guardar(anuncio());
    assert.strictEqual(ev.participantes, 1);
    ev.participantes = 7;
    ev.grupo_nombre = "Pruebas";
    grupoConDatos = false;
    const antes = escriturasDeEvento();
    await guardar(anuncio());
    assert.strictEqual(escriturasDeEvento(), antes);
    assert.strictEqual(ev.participantes, 7);
});

// ------------------------------------------------- envíos y concurrencia ---

prueba("16. envío exitoso: una sola publicación; los ciclos siguientes no repiten", async () => {
    escenario();
    const s = await programar();
    const d = deps();
    for (let i = 0; i < 3; i++) await tick(ciclo(i), d.d);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(eventosDe(s).length, 1);
    assert.strictEqual(grupoDe(s).estado, "publicado");
});

prueba("17. fallo de WhatsApp: queda registrado, sin duplicar el evento ni reenviar solo", async () => {
    escenario();
    const s = await programar();
    fallaEnvio = () => "Timed Out";
    const d = deps();
    for (let i = 0; i < 3; i++) await tick(ciclo(i), d.d);
    assert.strictEqual(grupoDe(s).estado, "requiere_revision");
    assert.match(grupoDe(s).ultimo_error, /Timed Out/);
    assert.strictEqual(eventosDe(s).length, 1);
    assert.strictEqual(enviados.length, 0);
});

prueba("18. dos workers a la vez: un reclamo gana; una publicación y una fila", async () => {
    escenario();
    const s = await programar();
    const d = deps();
    await Promise.all([tick(ciclo(0), d.d), tick(ciclo(0), d.d)]);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(eventosDe(s).length, 1);
    assert.strictEqual(d.capturas.length, 1);
});

const TEXTO_ANUNCIO = "⚡ Para Hoy 22 De Octubre ⚡\n\n🎰 Lotería De Manizales - 10:30 PM\n\n🍀 Dos últimas cifras → $300.000\n\n🎯 Valor número: $3.000\n\n🏦 Nequi\n📲 3000000001";

prueba("19. programación y detección del mismo sorteo: el detector reutiliza la fila del publicador, una sola identidad", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps().d);
    const ev = eventosDe(s)[0];
    const foto = JSON.stringify(ev);
    const ctx = { sock: sock(), grupo: { remoteJid: G }, chat: { remoteJid: G }, textoOriginal: TEXTO_ANUNCIO, session: { usuarioId: A } };
    const devuelto = await silencio(() => detectarEvento(ctx));
    assert.strictEqual(devuelto?.id, ev.id);
    assert.strictEqual(fake.tablas.eventos_bot.length, 1);
    assert.strictEqual(JSON.stringify(ev), foto, "el anuncio no reescribe la fila");
});

prueba("20. el detector tampoco reactiva la fila terminada de ese sorteo cuando el grupo ya tiene otro activo", async () => {
    escenario();
    const s = await programar();
    const terminada = filaTerminada(s, { estado: "cancelado", cierre_motivo: "panel:cancelado", creado_en: "2026-10-22T10:00:00.000Z" });
    const foto = JSON.stringify(terminada);
    fake.tablas.eventos_bot.push({ ...terminada, id: "ev-otro", identidad_evento_real: "otra-identidad", nombre_evento: "Otro sorteo", hora_fin: "10:00", activo: true, estado: "abierto", cierre_estado: null, cierre_motivo: null, creado_en: "2026-10-22T11:30:00.000Z" });
    const ctx = { sock: sock(), grupo: { remoteJid: G }, chat: { remoteJid: G }, textoOriginal: TEXTO_ANUNCIO, session: { usuarioId: A } };
    await silencio(() => detectarEvento(ctx));
    assert.strictEqual(JSON.stringify(terminada), foto);
});

// ---------------------------------------------- reservas y sus contadores ---

prueba("21. los reintentos no tocan reservas ni pagos, y las anticipadas siguen contando al crear el evento", async () => {
    escenario();
    const s = await programar();
    Object.assign(fake.tablas[T5K][7], { estado: "reservado", identidad_evento_real: s.identidad_evento_real, comprador: "Ana" });
    Object.assign(fake.tablas[T5K][8], { estado: "pagado", identidad_evento_real: s.identidad_evento_real, comprador: "Luis" });
    const foto = JSON.stringify(fake.tablas[T5K]);
    await tick(ciclo(0), deps({ capturarImagen: async () => { throw new Error("falla"); } }).d);
    await tick(ciclo(1), deps({ textoParaCompartir: sinTexto }).d);
    await tick(ciclo(2), deps().d);
    assert.strictEqual(JSON.stringify(fake.tablas[T5K]), foto);
    assert.strictEqual(grupoDe(s).estado, "publicado", grupoDe(s).ultimo_error);
    assert.strictEqual(eventosDe(s)[0].reservados, 1);
    assert.strictEqual(eventosDe(s)[0].pagados, 1);
});

prueba("22. recordatorios: siguen saliendo una vez tras una publicación con reintentos", async () => {
    escenario();
    const s = await programar(entrada({ recordatorios: [{ minutos_antes_cierre: 30, texto: "Quedan números" }], hora_fin: "22:30", hora_cierre: "22:26" }));
    await tick(ciclo(0), deps({ textoParaCompartir: sinTexto }).d);
    await tick(ciclo(1), deps().d);
    assert.strictEqual(grupoDe(s).estado, "publicado", grupoDe(s).ultimo_error);
    const d = deps({ sendMessage: async ({ jid, text }) => { enviados.push({ jid, texto: text }); return { key: { id: "rec" } }; } });
    const ventana = new Date("2026-10-23T02:57:00Z");   // 21:57 en Colombia
    await tick(ventana, d.d);
    await tick(new Date(ventana.getTime() + 30000), d.d);
    assert.strictEqual(fake.tablas.automation_actions.filter(a => a.tipo_accion === "SORTEO_RECORDATORIO").length, 1);
    assert.strictEqual(enviados.length, 2, "anuncio + un recordatorio");
});

// ------------------------------------------------------- estado del panel ---

const gestionDe = async (s) => (await silencio(() => servicio.gestion(A))).data.find(x => x.id === s.id).gestion;

prueba("23. panel: una fila de evento sin anuncio NO es «Sorteo en curso»", async () => {
    escenario();
    const s = await programar();
    const d = deps({ textoParaCompartir: sinTexto });
    await tick(ciclo(0), d.d);
    let g = await gestionDe(s);
    assert.strictEqual(g.operativo.estado, "pendiente", "todavía se reintenta");
    assert.match(g.operativo.detalle, /todavía no se envió/);
    assert.strictEqual(g.grupos[0].etapa, "publicacion_fallida");

    for (let i = 1; i < publicador.MAX_INTENTOS_AUTOMATICOS; i++) await tick(ciclo(i), d.d);
    g = await gestionDe(s);
    assert.strictEqual(g.operativo.estado, "sin_publicar");
    assert.match(g.operativo.detalle, /no se envió/);
    assert.strictEqual(g.grupos[0].etapa, "requiere_intervencion");
    assert.strictEqual(g.grupos[0].resumen, "Imagen generada · Evento creado · Anuncio no enviado");
    assert.ok(!/en WhatsApp: el anuncio pudo/.test(g.grupos[0].intervencion), "sin envío no pudo llegar");
    assert.ok(!/se reintentará/i.test(g.grupos[0].explicacion));
});

prueba("24. panel: error antiguo guardado con «Se reintentará» en revisión ya no lo promete; fallo de imagen no afirma imagen", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ capturarImagen: async () => { throw new Error("falla"); } }).d);
    Object.assign(grupoDe(s), { estado: "requiere_revision", evento_bot_id: "ev-viejo", ultimo_error: "No se pudo generar la imagen de la tabla (Falta FRONTEND_URL); no se envió nada. Se reintentará." });
    const g = (await gestionDe(s)).grupos[0];
    assert.strictEqual(g.explicacion, "No se pudo generar la imagen de la tabla (Falta FRONTEND_URL); no se envió nada.");
    assert.ok(!/Imagen generada/.test(g.resumen), g.resumen);
});

prueba("25. panel: publicado de verdad = en curso y confirmado; envío incierto no se da por no enviado", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps().d);
    let g = await gestionDe(s);
    assert.strictEqual(g.operativo.estado, "en_curso");
    assert.strictEqual(g.grupos[0].etapa, "publicacion_confirmada");
    assert.strictEqual(g.grupos[0].resumen, "Imagen generada · Evento creado · Publicación confirmada");

    escenario();
    const s2 = await programar();
    fallaEnvio = () => "Timed Out";
    await tick(ciclo(0), deps().d);
    g = await gestionDe(s2);
    assert.strictEqual(g.operativo.estado, "en_curso", "pudo haber llegado");
    assert.strictEqual(g.grupos[0].etapa, "publicacion_enviada");
    assert.match(g.grupos[0].intervencion, /pudo haber llegado/);
});

prueba("26. panel: sin poder leer los envíos, una fila de evento no se presenta como publicada", async () => {
    escenario();
    const s = await programar();
    await tick(ciclo(0), deps({ textoParaCompartir: sinTexto }).d);
    fake.control.fallarTabla = "automation_actions";
    const g = await gestionDe(s);
    fake.control.fallarTabla = null;
    assert.strictEqual(g.operativo.estado, "desconocido");
    assert.match(g.grupos[0].resumen, /sin comprobar/);
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
