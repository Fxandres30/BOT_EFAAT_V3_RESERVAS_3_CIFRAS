// ==========================================================================
// FASE O0 — CARACTERIZACIÓN del motor 4: SORTEOS PROGRAMADOS (textos de
// publicación, recordatorios y aviso de cierre).
//
// Parte A (pura): sorteos/mensajes.js — generador único del texto.
// Parte B (flujo): servicio.crearSorteo/confirmar → publicador.tick
// (publicación, recordatorio y aviso de cierre) con el mismo montaje que
// tests/sorteos/publicadorEstados.test.js. Reales: servicio, publicador,
// destinosCompartir, compartirEnGrupos, executionGuard, guardarEvento,
// prioridadComunicaciones. Simulados: Supabase (memoria), socket y PNG.
//
//     node backend/tests/mensajes-o0/o0SorteosProgramados.test.js
// ==========================================================================

"use strict";

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const { r, silencio } = require("./_comun");
const { prueba, riesgo, ejecutar } = require("../caracterizacion/_prueba");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    }
};

const mensajes = require(r("sorteos/mensajes.js"));
const { plantillaDe } = require(r("sorteos/estilosMensaje.js"));
const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// ============================================================ PARTE A ===

const CONFIG = {
    nombre: "Lotería De Manizales", hora_fin: "22:30", hora_cierre: "22:00", valor: 3000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }], cantidad_numeros: 100, mensajes: {}
};
const CUENTAS = [{ nombre: "Nequi", numero: "3000000001", titular: "Ana", tipo: "nequi" }];

prueba("SA1 recordatorio: variables base con formato (hora 12 h, valor en pesos); desconocidas se dejan y se informan", () => {
    const r1 = mensajes.mensajeRecordatorio(CONFIG, { texto: "⏰ {{nombre}} cierra {{hora_cierre}} · {{valor}} · {{otra}}" }, CUENTAS, { fecha: "2026-10-22" });
    assert.strictEqual(r1.texto, "⏰ Lotería De Manizales cierra 10:00 PM · $3.000 · {{otra}}");
    assert.deepStrictEqual(r1.desconocidas, ["otra"]);
});

prueba("SA2 aviso de cierre: vacío → PLANTILLA_CIERRE; con texto → el del sorteo", () => {
    assert.strictEqual(mensajes.mensajeAvisoCierre(CONFIG, CUENTAS, {}).texto, "🔒 *Lotería De Manizales* — reservas cerradas. ¡Gracias por participar!");
    assert.strictEqual(mensajes.mensajeAvisoCierre({ ...CONFIG, mensajes: { aviso_cierre: "Fin de {{nombre}}" } }, CUENTAS, {}).texto, "Fin de Lotería De Manizales");
});

prueba("SA3 publicación: sin texto guardado → plantilla del estilo clásico; sorteo antiguo (sin metadatos) → sin marcos", () => {
    assert.strictEqual(mensajes.textoPublicacion({}), plantillaDe("clasico"));
    const meta = mensajes.metaPublicacion({});
    assert.deepStrictEqual([meta.estilo, meta.activo, meta.personalizado, meta.revision], ["clasico", true, false, 0]);
    const legado = mensajes.mensajePublicacion(CONFIG, CUENTAS, { fecha: "2026-10-22" });
    assert.ok(legado.texto.startsWith("🎉 *Lotería De Manizales* 🎉\n🕘 Juega a las 10:30 PM"), legado.texto);
    assert.strictEqual(legado.activo, true);
});

prueba("SA4 consolidar: nunca pierde el texto (vacío = plantilla del estilo, guardada como TEXTO); la revisión sube solo si cambia", () => {
    const t0 = new Date("2026-10-01T00:00:00Z");
    const creado = mensajes.consolidarMensajes({ publicacion: "" , publicacion_meta: { estilo: "compacto" } }, null, { ahora: t0 });
    assert.strictEqual(creado.publicacion, plantillaDe("compacto"));
    assert.strictEqual(creado.publicacion_meta.revision, 1);
    const igual = mensajes.consolidarMensajes({ publicacion: creado.publicacion }, creado, { ahora: new Date() });
    assert.strictEqual(igual.publicacion_meta.revision, 1);
    assert.strictEqual(igual.publicacion_meta.actualizado_en, t0.toISOString());
    const editado = mensajes.consolidarMensajes({ publicacion: "Mío {{nombre}}" }, igual);
    assert.deepStrictEqual([editado.publicacion_meta.revision, editado.publicacion_meta.personalizado, editado.publicacion_meta.estilo], [2, true, "compacto"]);
});

prueba("SA5 un solo generador: anuncioDelEvento (publicador y «Compartir») = mensajePublicacion de la vista previa", () => {
    const meta = { estilo: "clasico", activo: true };
    const evento = { nombre_evento: CONFIG.nombre, hora_fin: "22:30", hora_cierre: "22:00", valor: 3000, premios: CONFIG.premios, cantidad_numeros: 100, fecha_evento: "2026-10-22" };
    const a = mensajes.anuncioDelEvento(evento, { publicacion: "X {{nombre}} {{fecha_larga}}", cuentas: CUENTAS, meta });
    const b = mensajes.mensajePublicacion({ ...CONFIG, mensajes: { publicacion: "X {{nombre}} {{fecha_larga}}", publicacion_meta: meta } }, CUENTAS, { fecha: "2026-10-22" });
    assert.strictEqual(a.texto, b.texto);
    assert.strictEqual(a.texto, "X Lotería De Manizales jueves 22 de octubre");
});

prueba("SA6 marcos: una variable de varias líneas tras «│ » repite el marco en cada línea (solo textos con metadatos)", () => {
    const config = { ...CONFIG, premios: [{ nombre: "Mayor", premio: 300000 }, { nombre: "Seco", premio: 50000 }] };
    const conMeta = mensajes.mensajePublicacion({ ...config, mensajes: { publicacion: "│ {{premios}}", publicacion_meta: { estilo: "clasico" } } }, CUENTAS, {});
    const legado = mensajes.mensajePublicacion({ ...config, mensajes: { publicacion: "│ {{premios}}" } }, CUENTAS, {});
    assert.strictEqual(conMeta.texto.split("\n").length, 2);
    assert.ok(conMeta.texto.split("\n").every(l => l.startsWith("│ ")), conMeta.texto);
    assert.ok(!legado.texto.split("\n")[1].startsWith("│ "), legado.texto);
});

prueba("SA7 límite de 4000 caracteres YA GENERADO: excede=true (el validador lo rechaza al guardar)", () => {
    const largo = mensajes.generar("x".repeat(4001), CONFIG, CUENTAS, {});
    assert.deepStrictEqual([largo.longitud, largo.excede], [4001, true]);
});

prueba("SA8 sintaxis: solo {{minúsculas_y_guiones}}; sin modificadores ({{nombre|upper}} queda literal y NO se informa)", () => {
    const r1 = mensajes.mensajeRecordatorio(CONFIG, { texto: "{{nombre|upper}} {nombre}" }, CUENTAS, {});
    assert.strictEqual(r1.texto, "{{nombre|upper}} {nombre}");
    assert.deepStrictEqual(r1.desconocidas, []);
    riesgo("En sorteos, {{nombre|upper}} o {nombre} no se reconocen ni se avisan: saldrían literales si el validador no los detecta.");
});

// ============================================================ PARTE B ===

const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
// Recordatorio de 30 min antes del cierre de las 22:00 (Colombia) = 21:30 = 02:30 UTC del 23.
const EN_RECORDATORIO = new Date("2026-10-23T02:31:00Z");
const TRAS_CIERRE = new Date("2026-10-23T03:05:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const G = "g1@g.us";
const T5K = "5k_15k_reservas_2_cifras";
const PNG = Buffer.from("png-simulado");
const DISENO = {
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
    cells: { available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" }, reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" }, pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" } },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 10, spacing: 6, borderWidth: 1 }
};

let enviados = [];

function escenarioFlujo() {
    fake = crearFake();
    enviados = [];
    const t = fake.tablas;
    t.grupos_autorizados = [{ usuario_id: A, grupo_id: G, activo: true }];
    t.grupos = [{ jid: G, nombre: "Pruebas" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const entrada = (extra = {}) => ({
    modalidad: "dos_cifras", nombre: "Lotería De Manizales", hora_fin: "22:30", hora_cierre: "22:00", valor: 3000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: [G], cuentas: ["cuenta-a1"],
    publicar_en: PUBLICAR.toISOString(), fecha_sorteo: "2026-10-22",
    mensajes: { publicacion: "📣 {{nombre}} · {{valor}}", aviso_cierre: "🔒 Cerró {{nombre}}" },
    recordatorios: [{ minutos_antes_cierre: 30, texto: "⏰ {{nombre}} cierra a las {{hora_cierre}}" }],
    diseno: { origen: "preset", nombre: "Morado", config: DISENO },
    ...extra
});

const deps = (cambios = {}) => ({
    supabase: { from: (t) => fake.client.from(t) },
    guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true,
    capturarImagen: async () => PNG,
    textoParaCompartir: destinos.textoParaCompartir,
    compartirEnGrupos,
    sendMessage: async ({ jid, text }) => { enviados.push({ jid, texto: text, tipo: "texto" }); return { key: { id: `t-${enviados.length}` } }; },
    leerEstadoParaRecordatorios: async () => ({ ok: true, total: 100, libres: 60, reservados: 10, grupoCerrado: false }),
    ...cambios
});

const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async () => ({ subject: "Pruebas", participants: [{}], desc: null }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        enviados.push({ jid, image: contenido.image, texto: contenido.caption ?? contenido.text, tipo: contenido.image ? "imagen" : "texto" });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

const tick = (ahora, d = deps()) => silencio(() => publicador.tick(sock(), { ahora, deps: d }));

async function programar(datos = entrada()) {
    const c = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

prueba("SB1 publicación: imagen + pie = la COPIA guardada en el sorteo, generada con sus datos", async () => {
    escenarioFlujo();
    const sorteo = await programar();
    assert.strictEqual(fake.tablas.sorteos_programados.find(s => s.id === sorteo.id).config.mensajes.publicacion, "📣 {{nombre}} · {{valor}}");
    await tick(EN_PUBLICACION);
    const anuncio = enviados.find(e => e.tipo === "imagen");
    assert.ok(anuncio, JSON.stringify(enviados));
    assert.strictEqual(anuncio.texto, "📣 Lotería De Manizales · $3.000");
    assert.strictEqual(anuncio.jid, G);
});

prueba("SB2 recordatorio dentro de su ventana: texto del sorteo, una sola vez (clave sorteo:<id>:grupo:<g>:recordatorio:30)", async () => {
    escenarioFlujo();
    const sorteo = await programar();
    await tick(EN_PUBLICACION);
    enviados = [];
    await tick(EN_RECORDATORIO);
    await tick(new Date(EN_RECORDATORIO.getTime() + 60000));
    const recs = enviados.filter(e => e.texto?.startsWith("⏰"));
    assert.deepStrictEqual(recs.map(e => e.texto), ["⏰ Lotería De Manizales cierra a las 10:00 PM"]);
    assert.ok(fake.tablas.automation_actions.some(a => a.clave_idempotencia === `sorteo:${sorteo.id}:grupo:${G}:recordatorio:30`));
});

prueba("SB3 recordatorio omitido si el estado real no lo justifica (sin libres ni pendientes); fuera de ventana nunca se envía tarde", async () => {
    escenarioFlujo();
    await programar();
    await tick(EN_PUBLICACION);
    enviados = [];
    await tick(EN_RECORDATORIO, deps({ leerEstadoParaRecordatorios: async () => ({ ok: true, total: 100, libres: 0, reservados: 0 }) }));
    await tick(new Date(EN_RECORDATORIO.getTime() + 15 * 60000));
    assert.strictEqual(enviados.filter(e => e.texto?.startsWith("⏰")).length, 0);
});

prueba("SB4b si la automatización del grupo ya envió su CLOSE_MESSAGE para ese ciclo, el sorteo no envía su aviso", async () => {
    escenarioFlujo();
    await programar();
    await tick(EN_PUBLICACION);
    const ev = fake.tablas.eventos_bot.find(e => e.grupo_id === G);
    Object.assign(ev, { activo: false, estado: "cerrado" });
    fake.tablas.event_sessions = [{ id: "ciclo-1", evento_id: ev.id, grupo_id: G, usuario_id: A, creado_en: "2026-10-22T13:01:00Z" }];
    fake.tablas.automation_actions.push({ id: "acc-x", clave_idempotencia: "ciclo-1:CLOSE_MESSAGE", estado: "ok", tipo_accion: "CLOSE_MESSAGE", grupo_id: G, usuario_id: A });
    enviados = [];
    await tick(TRAS_CIERRE);
    assert.strictEqual(enviados.filter(e => e.texto?.startsWith("🔒")).length, 0);
});

prueba("SB4 aviso de cierre del sorteo: tras el cierre, una sola vez (clave sorteo:<id>:grupo:<g>:aviso_cierre)", async () => {
    escenarioFlujo();
    const sorteo = await programar();
    await tick(EN_PUBLICACION);
    const ev = fake.tablas.eventos_bot.find(e => e.grupo_id === G);
    Object.assign(ev, { activo: false, estado: "cerrado" });
    enviados = [];
    await tick(TRAS_CIERRE);
    await tick(new Date(TRAS_CIERRE.getTime() + 60000));
    assert.deepStrictEqual(enviados.filter(e => e.texto?.startsWith("🔒")).map(e => e.texto), ["🔒 Cerró Lotería De Manizales"]);
    assert.ok(fake.tablas.automation_actions.some(a => a.clave_idempotencia === `sorteo:${sorteo.id}:grupo:${G}:aviso_cierre`));
});

prueba("SB5 la copia del sorteo manda: cambiar después el estilo predeterminado de la cuenta no altera lo que se publica", async () => {
    escenarioFlujo();
    await programar(entrada({ mensajes: { publicacion: "", aviso_cierre: "" } }));
    const guardado = fake.tablas.sorteos_programados[0].config.mensajes;
    assert.strictEqual(guardado.publicacion, plantillaDe(guardado.publicacion_meta.estilo));
    fake.tablas.preferencias_mensaje_sorteo = [{ usuario_id: A, estilo_predeterminado: "minimalista" }];
    await tick(EN_PUBLICACION);
    const anuncio = enviados.find(e => e.tipo === "imagen");
    assert.ok(anuncio.texto.startsWith("🎉 *Lotería De Manizales* 🎉"), anuncio.texto);
});

ejecutar("O0 · Motor 4: sorteos programados");
