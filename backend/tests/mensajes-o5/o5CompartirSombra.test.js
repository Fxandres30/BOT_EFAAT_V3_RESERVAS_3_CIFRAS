// ==========================================================================
// FASE O5 — «COMPARTIR TABLA» en MODO SOMBRA (compartirEnGrupos).
//
// Reales: compartirTabla.compartirEnGrupos (con su llamada en sombra),
// destinosCompartir.textoParaCompartir, sorteos/mensajes, executionGuard
// (UNIQUE real de la fake), send.js (sendImage) con socket simulado,
// services/sombraCompartir.js y shared/mensajes. Simulados: Supabase
// (fakeSupabaseAutomation), la lectura del sorteo (sorteosActivos.obtener,
// contada) y puppeteer (prohibido).
//
//     node backend/tests/mensajes-o5/o5CompartirSombra.test.js
// ==========================================================================

"use strict";

delete process.env.MENSAJES_ORQUESTADOR_COMPARTIR;
delete process.env.MENSAJES_ORQUESTADOR_SORTEO;

const assert = require("assert");
const { r, RAIZ, inyectar } = require("../mensajes-o0/_comun");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");
const { crearFakeSupabaseAutomation } = require("../automation/fakeSupabaseAutomation");

let fake = crearFakeSupabaseAutomation();
inyectar(r("lib/supabase.js"), { from: (t) => fake.client.from(t) });
const prohibido = { chromium: 0 };
inyectar(require.resolve("puppeteer", { paths: [RAIZ] }), { launch: async () => { prohibido.chromium++; throw new Error("Chromium prohibido"); } });

let lecturasSorteo = 0;
let lecturaSorteo = async () => ({ ok: true, data: {} });
inyectar(r("sorteos/sorteosActivos.js"), { obtener: (...a) => { lecturasSorteo++; return lecturaSorteo(...a); } });

const { compartirEnGrupos } = require(r("services/compartirTabla.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const EVENTO = { id: "ev-1", usuario_id: A, nombre_evento: "Lotería De Manizales", valor: 3000, hora_fin: "22:30", hora_cierre: "22:00", libres: 42, cantidad_numeros: 100, premios: [], fecha_evento: "2026-10-22" };
const PNG = Buffer.from("png-simulado");
const GRUPOS = [{ grupo_id: "573001112233-1@g.us" }, { grupo_id: "573001112233-2@g.us" }, { grupo_id: "573001112233-3@g.us" }];
const HABITUAL = "🎰 Lotería De Manizales\n💰 Número: $3000\n⏰ Cierra: 10:30 PM\n🎟️ 42 números disponibles\n¡Aparta el tuyo! 👇";

function escenario({ compartir = "shadow", sorteo = null } = {}) {
    if (compartir) process.env.MENSAJES_ORQUESTADOR_COMPARTIR = compartir; else delete process.env.MENSAJES_ORQUESTADOR_COMPARTIR;
    if (sorteo) process.env.MENSAJES_ORQUESTADOR_SORTEO = sorteo; else delete process.env.MENSAJES_ORQUESTADOR_SORTEO;
    fake = crearFakeSupabaseAutomation();
    lecturasSorteo = 0; prohibido.chromium = 0;
    lecturaSorteo = async () => ({ ok: true, data: {} });
}

function crearSock(usuarioId = A, falla = () => null) {
    const envios = [];
    return {
        envios,
        sock: {
            context: { usuarioId, sessionId: `ses-${usuarioId}`, telefono: "573000000000", estado: "conectado" },
            sendPresenceUpdate: async () => {},
            sendMessage: async (jid, contenido, opciones) => {
                const e = falla(jid); if (e) throw new Error(e);
                envios.push({ jid, contenido, opciones }); return { key: { id: `m-${envios.length}` } };
            }
        }
    };
}

async function compartir(extra = {}) {
    const capturadas = [];
    const { log, warn, error } = console;
    console.log = console.warn = console.error = (...a) => capturadas.push(a.map(x => (typeof x === "string" ? x : "")).join(" "));
    let res;
    try {
        res = await compartirEnGrupos({ evento: EVENTO, grupos: GRUPOS, caption: HABITUAL, solicitudId: "sol-1", imagen: PNG, ...extra });
    } finally { Object.assign(console, { log, warn, error }); }
    const crudas = capturadas.filter(l => l.startsWith("[MENSAJES SOMBRA]"));
    return { res, sombras: crudas.map(l => JSON.parse(l.slice(18))), crudas, todo: capturadas };
}

const unica = (sombras) => { assert.strictEqual(sombras.length, 1, JSON.stringify(sombras)); return sombras[0]; };

prueba("O5C-1 sin la variable (off): mismo reparto, ninguna línea y NINGUNA lectura extra del sorteo", async () => {
    escenario({ compartir: null });
    const { sock, envios } = crearSock();
    const { res, sombras } = await compartir({ sock });
    assert.deepStrictEqual(res.resultados.map(x => x.estado), ["enviado", "enviado", "enviado"]);
    assert.strictEqual(envios.length, 3);
    assert.deepStrictEqual([sombras.length, lecturasSorteo], [0, 0]);
});

prueba("O5C-2 varios grupos: una comparación por reparto; texto habitual coincide; sin imagen ni Chromium en la sombra", async () => {
    escenario();
    const { sock, envios } = crearSock();
    let generaciones = 0;
    const { sombras } = await compartir({ sock, imagen: async () => { generaciones++; return PNG; } });
    assert.strictEqual(envios.length, 3);
    const s = unica(sombras);
    assert.deepStrictEqual([s.coincide, s.tipo, s.origen, s.grupos.total, s.grupos.estados.enviado, s.imagenGeneradaEnSombra], [true, "compartir_tabla", "compartir", 3, 3, false]);
    assert.strictEqual(s.fuenteTexto.origen, "habitual");
    assert.deepStrictEqual([generaciones, prohibido.chromium, lecturasSorteo], [1, 0, 1]);
});

prueba("O5C-3 mensaje del sorteo del panel (copia) y mensaje desactivado (solo imagen) → coinciden", async () => {
    escenario();
    lecturaSorteo = async () => ({ ok: true, data: { origen: "panel", publicacion: "📣 {{nombre}} {{valor}}", cuentas: [], mensajes: { publicacion_meta: { estilo: "clasico", activo: true } } } });
    const panel = await compartir({ sock: crearSock().sock, caption: "📣 Lotería De Manizales $3.000" });
    assert.strictEqual(unica(panel.sombras).coincide, true);
    lecturaSorteo = async () => ({ ok: true, data: { origen: "panel", publicacion: "📣 {{nombre}}", cuentas: [], mensajes: { publicacion_meta: { estilo: "clasico", activo: false } } } });
    const inactivo = await compartir({ sock: crearSock().sock, caption: "", solicitudId: "sol-2" });
    const s = unica(inactivo.sombras);
    assert.deepStrictEqual([s.coincide, s.fuenteTexto.activo], [true, false]);
});

prueba("O5C-4 texto editado en el envío (distinto de la fuente del anuncio) → se registra como diferencia, el envío no cambia", async () => {
    escenario();
    const { sock, envios } = crearSock();
    const { sombras } = await compartir({ sock, caption: "Texto que el operador escribió a mano" });
    assert.strictEqual(envios[0].contenido.caption, "Texto que el operador escribió a mano");
    assert.deepStrictEqual([unica(sombras).coincide, sombras[0].motivo], [false, "texto_distinto"]);
});

prueba("O5C-5 fallo de un grupo: los demás siguen y la comparación resume los estados por grupo", async () => {
    escenario();
    const { sock, envios } = crearSock(A, (jid) => (jid.endsWith("-2@g.us") ? "rechazado" : null));
    const { res, sombras } = await compartir({ sock });
    assert.deepStrictEqual(res.resultados.map(x => x.estado), ["enviado", "fallido", "enviado"]);
    assert.strictEqual(envios.length, 2);
    const s = unica(sombras);
    assert.deepStrictEqual([s.grupos.estados.enviado, s.grupos.estados.fallido, s.coincide], [2, 1, true]);
});

prueba("O5C-6 cancelación: no se deshace lo enviado; la sombra no cambia la cancelación", async () => {
    escenario();
    const { sock, envios } = crearSock();
    let hechos = 0;
    const { res, sombras } = await compartir({ sock, control: { cancelado: () => hechos >= 1, alTerminar: (x) => { if (x.estado === "enviado") hechos++; } } });
    assert.deepStrictEqual(res.resultados.map(x => x.estado), ["enviado", "cancelado", "cancelado"]);
    assert.strictEqual(envios.length, 1);
    assert.deepStrictEqual(unica(sombras).grupos.estados, { enviado: 1, cancelado: 2 });
});

prueba("O5C-7 envío único: repetir la solicitud → ya_enviado, sin reenvíos; la sombra usa las claves del motor (sin recalcularlas)", async () => {
    escenario();
    const { sock, envios } = crearSock();
    const primero = await compartir({ sock });
    const segundo = await compartir({ sock });
    assert.deepStrictEqual(segundo.res.resultados.map(x => x.estado), ["ya_enviado", "ya_enviado", "ya_enviado"]);
    assert.strictEqual(envios.length, 3);
    assert.deepStrictEqual(primero.sombras[0].grupos.claves, segundo.sombras[0].grupos.claves);
    assert.strictEqual(fake._tablas.automation_actions.length, 3, "la sombra no añade acciones");
});

prueba("O5C-8 la llamada manual con clave aleatoria: la sombra registra la MISMA clave que se usó", async () => {
    escenario();
    const { huella } = require(r("shared/mensajes/etapas/registro.js"));
    const { sock } = crearSock();
    let usada = null;
    const idempotencia = { clave: () => (usada = `TABLA_COMPARTIR:${A}:3000:manual-${Math.random()}:g`), tipoAccion: "TABLA_COMPARTIR" };
    const { sombras } = await compartir({ sock, grupos: GRUPOS.slice(0, 1), idempotencia });
    assert.strictEqual(unica(sombras).grupos.claves[0], huella(usada));
});

prueba("O5C-9 publicación de sorteo (solicitud sorteo-<id>-publicacion-<n>) se clasifica como «sorteo» y usa SU variable", async () => {
    escenario({ compartir: null, sorteo: "shadow" });
    const { sombras } = await compartir({ sock: crearSock().sock, grupos: GRUPOS.slice(0, 1), solicitudId: "sorteo-abc-publicacion-0" });
    const s = unica(sombras);
    assert.deepStrictEqual([s.tipo, s.origen, s.coincide], ["sorteo_publicacion", "sorteo", true]);
    escenario({ compartir: "shadow", sorteo: null });
    const nada = await compartir({ sock: crearSock().sock, grupos: GRUPOS.slice(0, 1), solicitudId: "sorteo-abc-publicacion-0" });
    assert.strictEqual(nada.sombras.length, 0);
});

prueba("O5C-10 lectura del sorteo fallida en la sombra → diferencia «anuncio_no_disponible»; el reparto real ya ocurrió", async () => {
    escenario();
    lecturaSorteo = async () => { throw new Error("Supabase caído"); };
    const { sock, envios } = crearSock();
    const { res, sombras } = await compartir({ sock });
    assert.deepStrictEqual([res.ok, envios.length], [true, 3]);
    assert.deepStrictEqual([unica(sombras).coincide, sombras[0].motivo], [false, "anuncio_no_disponible:error_lectura"]);
});

prueba("O5C-11 si la sombra entera falla, el reparto y sus resultados no cambian", async () => {
    escenario();
    const ruta = r("services/sombraCompartir.js");
    const original = require.cache[ruta];
    inyectar(ruta, { compararCompartirEnSombra: async () => { throw new Error("explotó (simulado)"); } });
    try {
        const { sock, envios } = crearSock();
        const { res, todo } = await compartir({ sock });
        assert.deepStrictEqual([res.ok, envios.length], [true, 3]);
        assert.ok(todo.some(l => l.includes("comparación omitida")));
    } finally { if (original) require.cache[ruta] = original; else delete require.cache[ruta]; }
});

prueba("O5C-12 aislamiento: socket de otro cliente → la sombra lo rechaza (diferencia); privacidad sin JID", async () => {
    escenario();
    const ajeno = crearSock(B);
    const { sombras, crudas } = await compartir({ sock: ajeno.sock, grupos: GRUPOS.slice(0, 1) });
    assert.deepStrictEqual([unica(sombras).coincide, sombras[0].motivo], [false, "error_orquestador:sesion_de_otro_cliente"]);
    assert.ok(!crudas[0].includes("573001112233"));
});

ejecutar("O5 · Compartir tabla en modo sombra").finally(() => { delete process.env.MENSAJES_ORQUESTADOR_COMPARTIR; delete process.env.MENSAJES_ORQUESTADOR_SORTEO; });
