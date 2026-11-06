// ==========================================================================
// Revisión final de F3 (06/11/2026): comprobaciones que cierran huecos
// encontrados en la revisión.
//
//   1. El historial (048) acepta TODAS las modalidades y resultados que el
//      código escribe (si no, el insert falla y el registro solo queda en el
//      log).
//   2. Un grupo que se suma a un sorteo con permiso de reservas configurado
//      hereda ese permiso (los grupos asociados quedan sincronizados).
//   3. Sin permiso guardado (o sin la 047) la fila nueva queda como siempre.
//   4. Deshacer una sustitución pasa por el orquestador: restaura solo lo que
//      cerró ESE reemplazo y lo deja en el historial.
//
// Reales: arnés _arnesEventos, guardarEvento, gestionEventos, cerrarEvento,
// unSorteoPorPrecio. Simulados: Supabase (memoria) y el socket. Sin red.
//
//     node backend/tests/caracterizacion/revisionFinalF3.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const orquestador = require(r("bot/funciones/eventos/lifecycle/cerrarEvento.js"));
const gestion = require(r("sorteos/gestionEventos.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { reemplazarAnteriores, revertirReemplazo } = require(r("shared/eventos/unSorteoPorPrecio.js"));

const G1 = "g1@g.us", G2 = "g2@g.us", G3 = "g3@g.us";
const ANTES = new Date("2026-10-22T14:00:00Z");
const NOMBRE = "Antioqueñita Día";
const t = () => h.estado.fake.tablas;
const db = { from: (q) => h.estado.fake.client.from(q) };
const fila = (grupo) => t().eventos_bot.find(e => e.grupo_id === grupo && e.nombre_evento === NOMBRE);

async function preparar() {
    h.escenario();
    await h.programar(h.entrada({ grupos: [G1, G2] }));
    await h.tick(h.EN_PUBLICACION);
}

// Lo que hace el publicador al publicar el MISMO sorteo en un grupo nuevo.
const sumarGrupo = (grupoId, sorteoVigente) => h.silencio(() => guardarEvento({
    sock: h.sock(), grupoId,
    evento: { nombre: NOMBRE, hora: "22:30", horaCierre: "22:26", valor: 3000, premios: [], tabla: h.T5K, cifras: 2, cantidad_numeros: 100 },
    eventoAnterior: null, sorteoVigente, fechaSorteo: "2026-10-22"
}));

// ---------------------------------------------------------- 1 ---
prueba("1. la 048 acepta todas las modalidades y resultados que escribe el código", () => {
    const sql = fs.readFileSync(r("supabase_migrations/048_historial_eventos.sql"), "utf8");
    const lista = (columna) => {
        const m = sql.match(new RegExp(`${columna} text not null check \\(${columna} in \\(([^)]*)\\)`));
        assert.ok(m, `CHECK de ${columna}`);
        return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
    };
    const modalidades = lista("modalidad");
    const resultados = lista("resultado");

    for (const m of Object.keys(orquestador.MODALIDADES)) assert.ok(modalidades.has(m), `falta la modalidad ${m}`);

    // Literales que el backend pasa al historial (fuera de MODALIDADES).
    const archivos = ["bot/funciones/eventos/lifecycle/cerrarEvento.js", "sorteos/gestionEventos.js", "shared/eventos/unSorteoPorPrecio.js", "sorteos/publicador.js", "bot/funciones/eventos/detectarEvento.js", "bot/funciones/eventos/lifecycle/procesarSorteo.js"];
    for (const a of archivos) {
        const src = fs.readFileSync(r(a), "utf8");
        for (const [, m] of src.matchAll(/modalidad:\s*"([a-z_]+)"/g)) assert.ok(modalidades.has(m), `${a}: modalidad ${m} no está en la 048`);
        // (sin las líneas del informe de reintentos, que no es historial)
        const sinInforme = src.split("\n").filter(l => !l.includes("informe.push")).join("\n");
        if (!src.includes("registrarHistorialEvento")) continue; // solo quien escribe historial
        for (const [, x] of sinInforme.matchAll(/resultado:\s*"([a-z_]+)"/g)) assert.ok(resultados.has(x), `${a}: resultado ${x} no está en la 048`);
    }
    for (const x of ["ok", "ya_terminada", "rechazado", "error"]) assert.ok(resultados.has(x));
    // procesarSorteo pasa el motivo como modalidad: solo «hora» o «pagados».
    const proc = fs.readFileSync(r("bot/funciones/eventos/lifecycle/procesarSorteo.js"), "utf8");
    assert.deepStrictEqual([...proc.matchAll(/motivo = "([a-z]+)"/g)].map(x => x[1]).sort(), ["pagados"]);
    assert.ok(/\? "hora" : null/.test(proc));
});

// ---------------------------------------------------------- 2 ---
prueba("2. un grupo que se suma a un sorteo con permiso configurado lo hereda (publicador y continuación)", async () => {
    await preparar();
    const x = await h.silencio(() => gestion.cambiarPermisoReservas(h.A, fila(G1).id, { modo: "permitidas", operador: "admin@x" }));
    assert.ok(x.ok, JSON.stringify(x));
    const identidad = fila(G1).identidad_evento_real;

    // Publicador: solo identidad y fecha (lee el permiso de las otras filas).
    const nueva = await sumarGrupo(G3, { identidad_evento_real: identidad, fecha_evento: "2026-10-22" });
    assert.ok(nueva?.id, "fila creada");
    assert.strictEqual(nueva.identidad_evento_real, identidad);
    assert.strictEqual(nueva.reservas_modo, "permitidas", "hereda el permiso del sorteo");

    // Detector (continuación del sorteo vigente): lo toma de esa fila.
    await h.silencio(() => gestion.cambiarPermisoReservas(h.A, fila(G1).id, { modo: "desactivadas", operador: "admin@x" }));
    t().eventos_bot = t().eventos_bot.filter(e => e.grupo_id !== G3);
    const otra = await sumarGrupo(G3, { ...fila(G1) });
    assert.strictEqual(otra.reservas_modo, "desactivadas");
    assert.ok(t().eventos_bot.filter(e => e.identidad_evento_real === identidad).every(e => e.reservas_modo === "desactivadas"), "todas las filas del sorteo, iguales");
});

// ---------------------------------------------------------- 3 ---
prueba("3. sin permiso guardado (o sin la 047) la fila nueva no lleva la columna, como siempre", async () => {
    await preparar();
    const identidad = fila(G1).identidad_evento_real;
    const nueva = await sumarGrupo(G3, { identidad_evento_real: identidad, fecha_evento: "2026-10-22" });
    assert.ok(nueva?.id);
    assert.ok(!("reservas_modo" in nueva), "no se escribe la columna");
});

// ---------------------------------------------------------- 4 ---
prueba("4. deshacer una sustitución: pasa por el orquestador, solo restaura lo de ESE reemplazo y queda en el historial", async () => {
    await preparar();
    const filas = t().eventos_bot.filter(e => e.activo).map(e => ({ ...e }));
    const motivo = "sustituido por el sorteo Boyacá 22:30";
    const rr = await h.silencio(() => reemplazarAnteriores(db, { usuarioId: h.A, filas, motivo, ahora: ANTES, modalidad: "sustitucion_reinicio" }));
    assert.ok(rr.ok);
    assert.strictEqual(rr.modalidad, "sustitucion_reinicio");
    // Entretanto, otra acción cierra G2 con otro motivo: no se reabre.
    Object.assign(fila(G2), { cierre_motivo: "panel:cerrado manualmente" });
    await h.silencio(() => revertirReemplazo(db, { usuarioId: h.A, cerradas: rr.cerradas, motivo, modalidad: rr.modalidad }));
    assert.strictEqual(fila(G1).activo, true, "G1 restaurada");
    assert.strictEqual(fila(G1).cierre_motivo, null);
    assert.strictEqual(fila(G2).activo, false, "G2 la cerró otra acción: intacta");
    const hist = (t().eventos_bot_historial || []).filter(x => x.modalidad === "sustitucion_reinicio");
    assert.deepStrictEqual(hist.map(x => [x.grupo_id, x.resultado, x.detalle.deshecha ?? null]).sort(), [
        [G1, "error", true], [G1, "ok", null], [G2, "error", false], [G2, "ok", null]
    ]);
    assert.strictEqual(hist.find(x => x.grupo_id === G2 && x.resultado === "error").detalle.omitida, "cambiada_despues");
});

ejecutar("REVISIÓN FINAL F3 · historial, permiso en grupos nuevos y deshacer");
