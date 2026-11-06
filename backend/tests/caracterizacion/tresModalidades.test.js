// ==========================================================================
// CARACTERIZACIÓN C1: las tres modalidades (detección en WhatsApp,
// instantáneo y programado del panel) dejan HOY la misma forma de evento.
//
// Fija lo que el futuro orquestador único (F4) debe conservar:
//   - el mismo conjunto de columnas en eventos_bot (las tres pasan por
//     guardarEvento.js);
//   - los mismos datos estructurales (tabla, cifras, cantidad, valor, hora
//     de cierre, estado, activo, abierto);
//   - UNA apertura y UN ciclo de automatización abierto;
//   - las del panel publican la imagen ANTES de la apertura; la detección
//     no publica imagen (el anuncio lo escribió una persona en el grupo).
// Diferencia legítima que también se fija: los premios (el detector los
// extrae del texto; el panel usa los del formulario). El reloj está fijado
// al día del sorteo (_arnesEventos.js), así que la fecha y la identidad
// coinciden en las tres.
//
//     node backend/tests/caracterizacion/tresModalidades.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const COLUMNAS = [
    "abierto", "activo", "actualizado_en", "cantidad_numeros", "cifras", "creado_en", "descripcion_grupo", "estado",
    "fecha_evento", "grupo_id", "grupo_nombre", "hora_cierre", "hora_fin", "id", "identidad_evento_real", "libres",
    "nombre_evento", "pagados", "participantes", "pendientes", "premios", "reservados", "session_id", "tabla",
    "telefono_bot", "usuario_id", "valor"
];
const ESTRUCTURA = { tabla: h.T5K, cifras: 2, cantidad_numeros: 100, valor: 3000, hora_fin: "22:30", hora_cierre: "22:26", estado: "abierto", activo: true, abierto: true, nombre_evento: "Antioqueñita Día", usuario_id: h.A, session_id: "ses-aaaa", reservados: 0, pagados: 0, pendientes: 0, libres: 100 };

const MODALIDADES = {
    deteccion: async () => { await h.detectar("g1@g.us"); await h.silencio(h.drenar); },
    instantaneo: async () => { const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined })); const r = await h.publicarAhora(s); assert.ok(r.ok, JSON.stringify(r)); await h.silencio(h.drenar); },
    programado: async () => { await h.programar(h.entrada()); await h.tick(h.EN_PUBLICACION); }
};

const resultado = {};
async function correr(nombre) {
    if (resultado[nombre]) return resultado[nombre];
    h.escenario();
    await MODALIDADES[nombre]();
    const filas = h.eventosDe("g1@g.us");
    resultado[nombre] = {
        filas,
        enviados: h.estado.enviados.map(e => e.tipo === "imagen" ? "imagen" : e.texto.startsWith("🔓") ? "apertura" : "otro"),
        ciclos: h.sesionesDe("g1@g.us"),
        open: h.estado.fake.tablas.automation_actions.filter(a => a.tipo_accion === "OPEN_MESSAGE")
    };
    return resultado[nombre];
}

for (const nombre of Object.keys(MODALIDADES)) {
    prueba(`${nombre}: una fila con las ${COLUMNAS.length} columnas de siempre y los mismos datos estructurales`, async () => {
        const { filas } = await correr(nombre);
        assert.strictEqual(filas.length, 1, "una sola fila en el grupo");
        assert.deepStrictEqual(Object.keys(filas[0]).sort(), COLUMNAS);
        for (const [k, v] of Object.entries(ESTRUCTURA)) assert.deepStrictEqual(filas[0][k], v, k);
        assert.strictEqual(typeof filas[0].identidad_evento_real, "string");
    });
    prueba(`${nombre}: una apertura, un ciclo abierto y una acción OPEN_MESSAGE`, async () => {
        const { filas, enviados, ciclos, open } = await correr(nombre);
        assert.strictEqual(enviados.filter(e => e === "apertura").length, 1);
        assert.strictEqual(ciclos.length, 1);
        assert.strictEqual(ciclos[0].estado, "abierto");
        assert.strictEqual(ciclos[0].evento_id, filas[0].id);
        assert.strictEqual(open.length, 1);
        assert.strictEqual(open[0].estado, "ok");
    });
}

prueba("orden de envíos: panel = imagen y luego apertura; detección = solo apertura", async () => {
    assert.deepStrictEqual((await correr("instantaneo")).enviados, ["imagen", "apertura"]);
    assert.deepStrictEqual((await correr("programado")).enviados, ["imagen", "apertura"]);
    assert.deepStrictEqual((await correr("deteccion")).enviados, ["apertura"]);
});

prueba("mismo sorteo, misma fecha e identidad en las tres; premios según la fuente; instantáneo y programado idénticos", async () => {
    const det = (await correr("deteccion")).filas[0];
    const ins = (await correr("instantaneo")).filas[0];
    const pro = (await correr("programado")).filas[0];
    for (const f of [det, ins, pro]) assert.strictEqual(f.fecha_evento, "2026-10-22");
    assert.strictEqual(det.identidad_evento_real, ins.identidad_evento_real, "detección e instantáneo: misma identidad");
    assert.deepStrictEqual(det.premios, [{ tipo: "dos_ultimas_cifras", nombre: "Dos últimas cifras", premio: 300000 }]);
    assert.deepStrictEqual(ins.premios, [{ tipo: "otro", nombre: "Premio mayor", premio: 300000 }]);
    assert.strictEqual(ins.identidad_evento_real, pro.identidad_evento_real, "misma identidad para el mismo sorteo del panel");
    const sinTiempos = ({ id, creado_en, actualizado_en, ...resto }) => resto;
    assert.deepStrictEqual(sinTiempos(ins), sinTiempos(pro), "instantáneo y programado: misma fila salvo id y marcas de tiempo");
});

ejecutar("CARACTERIZACIÓN C1 · tres modalidades, una forma de evento").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
