// ==========================================================================
// FASE O0 — CARACTERIZACIÓN del motor 5: PUBLICACIÓN Y COMPARTIR TABLA
// (texto del anuncio + imagen por grupo).
//
// Reales: destinosCompartir.textoParaCompartir, compartirTabla.
// {compartirEnGrupos, construirTextoCompartir}, sorteos/mensajes.js,
// executionGuard.js (UNIQUE real de la fake) y services/baileys/send.js
// (sendImage) con socket simulado. Simulados: Supabase
// (fakeSupabaseAutomation), sorteosActivos.obtener (la lectura del sorteo)
// y puppeteer (nunca se abre Chromium).
//
//     node backend/tests/mensajes-o0/o0Compartir.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const { r, RAIZ, inyectar, silencio } = require("./_comun");
const { prueba, riesgo, ejecutar } = require("../caracterizacion/_prueba");
const { crearFakeSupabaseAutomation } = require("../automation/fakeSupabaseAutomation");

let fake = crearFakeSupabaseAutomation();
inyectar(r("lib/supabase.js"), { from: (t) => fake.client.from(t) });
inyectar(require.resolve("puppeteer", { paths: [RAIZ] }), { launch: async () => { throw new Error("Chromium prohibido en O0"); } });

let lecturaSorteo = async () => ({ ok: true, data: {} });
inyectar(r("sorteos/sorteosActivos.js"), { obtener: (...a) => lecturaSorteo(...a) });

const { textoParaCompartir } = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos, construirTextoCompartir } = require(r("services/compartirTabla.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const EVENTO = { id: "ev-1", usuario_id: A, nombre_evento: "Lotería De Manizales", valor: 3000, hora_fin: "22:30", hora_cierre: "22:00", libres: 42, cantidad_numeros: 100, premios: [{ nombre: "Mayor", premio: 300000 }], fecha_evento: "2026-10-22" };
const PNG = Buffer.from("png-simulado");
const GRUPOS = [{ grupo_id: "g1@g.us", nombre: "Uno" }, { grupo_id: "g2@g.us", nombre: "Dos" }, { grupo_id: "g3@g.us", nombre: "Tres" }];

function crearSock(usuarioId = A, falla = () => null) {
    const envios = [];
    const sock = {
        context: { usuarioId, sessionId: `ses-${usuarioId}`, telefono: "573000000000", estado: "conectado" },
        sendPresenceUpdate: async () => {},
        sendMessage: async (jid, contenido, opciones) => {
            const error = falla(jid);
            if (error) throw new Error(error);
            envios.push({ jid, contenido, opciones });
            return { key: { id: `m-${envios.length}` } };
        }
    };
    return { sock, envios };
}

function escenario() {
    fake = crearFakeSupabaseAutomation();
    lecturaSorteo = async () => ({ ok: true, data: {} });
}

const compartir = (extra) => silencio(() => compartirEnGrupos({ evento: EVENTO, grupos: GRUPOS, caption: "PIE", solicitudId: "sol-1", imagen: PNG, ...extra }));

// ================================================= texto del anuncio ===

prueba("CO1 sorteo del panel → SU mensaje guardado, con el generador de sorteos; desactivado → solo imagen (texto vacío)", async () => {
    escenario();
    lecturaSorteo = async () => ({ ok: true, data: { origen: "panel", publicacion: "📣 {{nombre}} {{valor}}", publicacion_texto: "📣 {{nombre}} {{valor}}", cuentas: [], mensajes: { publicacion_meta: { estilo: "clasico", activo: true, revision: 3 } }, publicacion_meta: { revision: 3 } } });
    const activo = await silencio(() => textoParaCompartir(A, EVENTO));
    assert.deepStrictEqual([activo.ok, activo.texto, activo.origen, activo.fuente, activo.revision], [true, "📣 Lotería De Manizales $3.000", "sorteo", "panel", 3]);
    lecturaSorteo = async () => ({ ok: true, data: { origen: "panel", publicacion: "📣 {{nombre}}", cuentas: [], mensajes: { publicacion_meta: { estilo: "clasico", activo: false } } } });
    const inactivo = await silencio(() => textoParaCompartir(A, EVENTO));
    assert.deepStrictEqual([inactivo.texto, inactivo.activo], ["", false]);
});

prueba("CO2 sorteo detectado con mensaje del panel (publicacion_panel) → ese mensaje con el mismo generador", async () => {
    escenario();
    lecturaSorteo = async () => ({ ok: true, data: { origen: "detectado", publicacion: "Hoy {{nombre}} a las {{hora}}", publicacion_meta: { estilo: "clasico" } } });
    const t = await silencio(() => textoParaCompartir(A, EVENTO));
    assert.deepStrictEqual([t.texto, t.fuente], ["Hoy Lotería De Manizales a las 10:30 PM", "detectado"]);
});

prueba("CO3 sin mensaje propio → texto HABITUAL fijo (PLANTILLA_TEXTO_COMPARTIR)", async () => {
    escenario();
    const t = await silencio(() => textoParaCompartir(A, EVENTO));
    assert.deepStrictEqual([t.origen, t.fuente], ["habitual", "habitual"]);
    assert.strictEqual(t.texto, "🎰 Lotería De Manizales\n💰 Número: $3000\n⏰ Cierra: 10:30 PM\n🎟️ 42 números disponibles\n¡Aparta el tuyo! 👇");
    riesgo("Texto habitual de «Compartir»: el precio sale sin miles («$3000») y «Cierra» muestra la hora del SORTEO (hora_fin), no la de cierre de reservas.");
});

prueba("CO4 sin poder leer el sorteo → ok=false y NO cae al texto habitual en silencio (quien llama no envía)", async () => {
    escenario();
    lecturaSorteo = async () => { throw new Error("Supabase caído (simulado)"); };
    const t = await silencio(() => textoParaCompartir(A, EVENTO));
    assert.deepStrictEqual([t.ok, t.origen, t.texto, t.motivo], [false, "error", "", "error_lectura"]);
    const sinEvento = await silencio(() => textoParaCompartir(A, {}));
    assert.strictEqual(sinEvento.motivo, "sin_evento");
});

prueba("CO5 texto habitual con datos faltantes → huecos («$», «Cierra: ») y «0 números disponibles»", () => {
    assert.strictEqual(construirTextoCompartir({ nombre_evento: "X" }), "🎰 X\n💰 Número: $\n⏰ Cierra: \n🎟️ 0 números disponibles\n¡Aparta el tuyo! 👇");
});

// ================================================== envío por grupo ===

prueba("CO6 un envío por grupo, en serie: imagen + pie, con el socket de la sesión del cliente", async () => {
    escenario();
    const { sock, envios } = crearSock();
    const res = await compartir({ sock });
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.resultados.map(x => x.estado), ["enviado", "enviado", "enviado"]);
    assert.deepStrictEqual(envios.map(e => e.jid), GRUPOS.map(g => g.grupo_id));
    assert.ok(envios.every(e => e.contenido.image === PNG && e.contenido.caption === "PIE" && e.opciones.messageId));
});

prueba("CO7 envío único por (cliente, precio, solicitud, grupo): repetir la misma solicitud → ya_enviado, sin reenviar", async () => {
    escenario();
    const { sock, envios } = crearSock();
    await compartir({ sock });
    const otra = await compartir({ sock });
    assert.deepStrictEqual(otra.resultados.map(x => x.estado), ["ya_enviado", "ya_enviado", "ya_enviado"]);
    assert.strictEqual(envios.length, 3);
    assert.ok(fake._tablas.automation_actions.some(a => a.clave_idempotencia === `TABLA_COMPARTIR:${A}:3000:sol-1:g1@g.us`));
});

prueba("CO8 cancelación: los grupos aún no iniciados quedan «cancelado»; los ya enviados no se deshacen", async () => {
    escenario();
    const { sock, envios } = crearSock();
    let enviadosHastaAhora = 0;
    const res = await compartir({ sock, control: { cancelado: () => enviadosHastaAhora >= 1, alTerminar: (x) => { if (x.estado === "enviado") enviadosHastaAhora++; } } });
    assert.deepStrictEqual(res.resultados.map(x => x.estado), ["enviado", "cancelado", "cancelado"]);
    assert.strictEqual(envios.length, 1);
});

prueba("CO9 imagen perezosa: se genera UNA vez para todos los grupos; imagen inválida → no se envía nada", async () => {
    escenario();
    const { sock } = crearSock();
    let generaciones = 0;
    const res = await compartir({ sock, solicitudId: "sol-2", imagen: async () => { generaciones++; return PNG; } });
    assert.strictEqual(generaciones, 1);
    assert.strictEqual(res.resultados.filter(x => x.estado === "enviado").length, 3);
    const mala = await compartir({ sock, imagen: Buffer.alloc(0) });
    assert.deepStrictEqual([mala.ok, mala.motivo], [false, "imagen_invalida"]);
});

prueba("CO10 fallo de WhatsApp en un grupo → ese grupo «fallido», los demás siguen; reintentar la misma solicitud → «ya falló antes»", async () => {
    escenario();
    const { sock, envios } = crearSock(A, (jid) => (jid === "g2@g.us" ? "rechazado (simulado)" : null));
    const res = await compartir({ sock });
    assert.deepStrictEqual(res.resultados.map(x => x.estado), ["enviado", "fallido", "enviado"]);
    assert.strictEqual(envios.length, 2);
    const reintento = await compartir({ sock });
    assert.strictEqual(reintento.resultados[1].motivo, "ya_error");
    assert.ok(/ya falló antes/.test(reintento.resultados[1].error));
});

prueba("CO11 sin sesión o evento inválido → no se envía nada", async () => {
    escenario();
    assert.strictEqual((await compartir({ sock: null })).motivo, "sin_sesion_activa");
    const sinDueno = await silencio(() => compartirEnGrupos({ evento: { ...EVENTO, usuario_id: null }, sock: crearSock().sock, grupos: GRUPOS, caption: "", solicitudId: "s", imagen: PNG }));
    assert.strictEqual(sinDueno.motivo, "evento_invalido");
});

prueba("CO12 aislamiento: la clave incluye al cliente; otro cliente con la misma solicitud y grupo SÍ envía", async () => {
    escenario();
    await compartir({ sock: crearSock(A).sock });
    const b = crearSock(B);
    const res = await silencio(() => compartirEnGrupos({ evento: { ...EVENTO, usuario_id: B }, sock: b.sock, grupos: GRUPOS.slice(0, 1), caption: "PIE", solicitudId: "sol-1", imagen: PNG }));
    assert.strictEqual(res.resultados[0].estado, "enviado");
});

prueba("CO13 clave propia (idempotencia del llamador): la usa en lugar de TABLA_COMPARTIR", async () => {
    escenario();
    const { sock } = crearSock();
    await compartir({ sock, idempotencia: { clave: (g) => `PUBLICACION:x:${g.grupo_id}`, tipoAccion: "SORTEO_PUBLICACION" } });
    assert.ok(fake._tablas.automation_actions.some(a => a.clave_idempotencia === "PUBLICACION:x:g1@g.us" && a.tipo_accion === "SORTEO_PUBLICACION"));
});

ejecutar("O0 · Motor 5: publicación y compartir tabla");
