// ==========================================================================
// F4-D/F4-E (06/11/2026): piezas del núcleo de activación
// (bot/funciones/eventos/lifecycle/activarEvento.js y lifecycle/activacion/),
// por separado. El comportamiento completo lo fija C7
// (caracterizacion/activacionEntradas).
//
// CAMBIO INTENCIONADO F4-E: la apertura y el reemplazo por precio se movieron
// a lifecycle/activacion/ (aperturaGrupo.js, sustituciones.js) con la
// política de cada entrada, y el núcleo ya acepta «anuncio_whatsapp».
//
//     node backend/tests/sorteos/activarEventoNucleo.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const a = require(path.join(RAIZ, "bot/funciones/eventos/lifecycle/activarEvento.js"));
const apertura = require(path.join(RAIZ, "bot/funciones/eventos/lifecycle/activacion/aperturaGrupo.js"));
const sustituciones = require(path.join(RAIZ, "bot/funciones/eventos/lifecycle/activacion/sustituciones.js"));

const pruebas = [];
const prueba = (n, fn) => pruebas.push([n, fn]);

prueba("perfiles: las entradas conservan su publicación, ciclo y reintentos", () => {
    assert.deepStrictEqual(Object.keys(a.PERFILES), ["anuncio_whatsapp", "programado", "instantaneo", "grupo_nuevo", "reintento_manual", "reanudacion"]);
    assert.strictEqual(a.PERFILES.anuncio_whatsapp.ciclo, "antes_de_abrir");
    assert.strictEqual(a.PERFILES.anuncio_whatsapp.publicacion, "ninguna");
    for (const e of ["programado", "instantaneo", "grupo_nuevo", "reintento_manual"]) {
        assert.strictEqual(a.PERFILES[e].ciclo, "tras_anuncio", e);
        assert.strictEqual(a.PERFILES[e].publicacion, "anuncio", e);
    }
    assert.strictEqual(a.PERFILES.programado.reintentos, "automaticos");
    assert.ok(Object.isFrozen(a.PERFILES) && Object.isFrozen(a.PERFILES.programado));
});

prueba("entradaDelPanel: instantáneo, reintento manual, grupo nuevo, programado", () => {
    assert.strictEqual(a.entradaDelPanel({ sorteo: { config: { publicacion_inmediata: true } }, grupo: { reintentos_manuales: 2 }, solicitado: true }), "instantaneo");
    assert.strictEqual(a.entradaDelPanel({ sorteo: { config: {} }, grupo: { reintentos_manuales: 1 }, solicitado: false }), "reintento_manual");
    assert.strictEqual(a.entradaDelPanel({ sorteo: { config: {} }, grupo: {}, solicitado: true }), "grupo_nuevo");
    assert.strictEqual(a.entradaDelPanel({ sorteo: { config: {} }, grupo: {}, solicitado: false }), "programado");
});

prueba("activarEnGrupo: reanudacion aún no usa el núcleo (F4-G); una entrada desconocida se rechaza", async () => {
    await assert.rejects(() => a.activarEnGrupo({ entrada: "reanudacion" }), /no soportada/);
    await assert.rejects(() => a.activarEnGrupo({ entrada: "otra" }), /desconocida/);
});

async function abrir({ abre, abierto, politica = "panel", activo = true, fallaEscritura = 0 }) {
    const fake = crearFake();
    fake.tablas.eventos_bot = [{ id: "e1", grupo_id: "g1", activo, abierto }];
    const llamadas = [];
    let escrituras = 0;
    const db = { from: (t) => { const q = fake.client.from(t); const update = q.update; q.update = (x) => { escrituras++; if (escrituras <= fallaEscritura) { return { eq: () => ({ then: (ok) => ok({ error: { message: "fallo simulado" } }) }) }; } return update(x); }; return q; } };
    const evento = { ...fake.tablas.eventos_bot[0] };
    const ok = await apertura.abrirGrupoDelEvento({ db, sock: {}, evento, abrirGrupo: async (x) => { llamadas.push(x.grupoId); return abre; }, politica });
    return { ok, fila: fake.tablas.eventos_bot[0], evento, llamadas, escrituras };
}

prueba("abrirGrupoDelEvento (panel): confirma y registra una apertura pendiente; sin confirmación deja abierto=false", async () => {
    const apertura = (x) => abrir(x);
    let r = await apertura({ abre: true, abierto: true });
    assert.deepStrictEqual([r.ok, r.fila.abierto, r.llamadas], [true, true, ["g1"]]);
    r = await apertura({ abre: true, abierto: false });
    assert.deepStrictEqual([r.ok, r.fila.abierto], [true, true], "pendiente → abierto");
    r = await apertura({ abre: false, abierto: true });
    assert.deepStrictEqual([r.ok, r.fila.abierto], [false, false], "fallo → abierto=false");
    r = await apertura({ abre: false, abierto: false });
    assert.deepStrictEqual([r.ok, r.fila.abierto, r.escrituras], [false, false, 0], "ya estaba en false: el panel no escribe");
});

prueba("abrirGrupoDelEvento (detección): el fallo se registra SIEMPRE, con hasta 3 intentos", async () => {
    let r = await abrir({ abre: false, abierto: false, politica: "deteccion" });
    assert.deepStrictEqual([r.ok, r.fila.abierto, r.escrituras, r.evento.abierto], [false, false, 1, false]);
    r = await abrir({ abre: false, abierto: true, politica: "deteccion", fallaEscritura: 2 });
    assert.deepStrictEqual([r.ok, r.fila.abierto, r.escrituras], [false, false, 3], "dos fallos y el tercer intento registra");
    r = await abrir({ abre: false, abierto: true, politica: "deteccion", fallaEscritura: 3 });
    assert.deepStrictEqual([r.ok, r.fila.abierto, r.escrituras, r.evento.abierto], [false, true, 3, true], "tres fallos: queda sin registrar");
    r = await abrir({ abre: true, abierto: false, politica: "deteccion", activo: false });
    assert.deepStrictEqual([r.ok, r.fila.abierto], [true, false], "abierto=true solo sobre una fila activa");
    await assert.rejects(() => abrir({ abre: true, abierto: true, politica: "otra" }), /política desconocida/);
});

prueba("reemplazarDelPrecio: error de lectura = «lectura», sin escribir nada", async () => {
    const fake = crearFake();
    fake.tablas.eventos_bot = [{ id: "e1", usuario_id: "u", grupo_id: "g1", activo: true, valor: 3000, identidad_evento_real: "x" }];
    fake.control.fallarTabla = "eventos_bot";
    const r = await sustituciones.reemplazarDelPrecio({ db: fake.client, usuarioId: "u", valor: 3000, identidad: "y", motivo: "m", ahora: new Date() });
    assert.deepStrictEqual([r.ok, r.motivo], [false, "lectura"]);
    fake.control.fallarTabla = null;
    assert.strictEqual(fake.tablas.eventos_bot[0].activo, true);
});

prueba("reemplazarDelPrecio: ocupado en otros grupos y sin autorización → no reemplaza; con autorización, sí", async () => {
    const base = () => { const f = crearFake(); f.tablas.eventos_bot = [{ id: "e1", usuario_id: "u", grupo_id: "g2", activo: true, estado: "abierto", valor: 3000, identidad_evento_real: "x" }]; return f; };
    let preguntas = 0;
    let fake = base();
    let r = await sustituciones.reemplazarDelPrecio({ db: fake.client, usuarioId: "u", grupoId: "g1", valor: 3000, identidad: "y", motivo: "m", autorizarOtrosGrupos: async () => { preguntas++; return false; } });
    assert.deepStrictEqual([r.ok, r.motivo, fake.tablas.eventos_bot[0].activo, preguntas], [false, "no_autorizado", true, 1]);
    fake = base();
    r = await sustituciones.reemplazarDelPrecio({ db: fake.client, usuarioId: "u", grupoId: "g1", valor: 3000, identidad: "y", motivo: "m", autorizarOtrosGrupos: async () => true });
    assert.deepStrictEqual([r.ok, r.reemplazo.cerradas.map(f => f.id), fake.tablas.eventos_bot[0].activo], [true, ["e1"], false]);
    // Mismo grupo: no se pregunta.
    fake = base(); preguntas = 0;
    r = await sustituciones.reemplazarDelPrecio({ db: fake.client, usuarioId: "u", grupoId: "g2", valor: 3000, identidad: "y", motivo: "m", autorizarOtrosGrupos: async () => { preguntas++; return false; } });
    assert.deepStrictEqual([r.ok, preguntas], [true, 0]);
});

(async () => {
    let fallos = 0;
    for (const [n, fn] of pruebas) {
        try { await fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
    }
    console.log(`\nTOTAL: ${pruebas.length} · ✅ ${pruebas.length - fallos} · ❌ ${fallos}`);
    process.exit(fallos ? 1 : 0);
})();
