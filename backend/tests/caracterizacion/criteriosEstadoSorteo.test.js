// ==========================================================================
// CARACTERIZACIÓN F2: fuente única del estado de un sorteo en su grupo
// (shared/eventos/estadosGestion.js + espejo del panel
// frontend/components/eventos/estadoEvento.ts), 06/11/2026.
//
// 1) Matriz de filas reales e históricas (incluidas las contradictorias):
//    qué devuelve CADA criterio. Si alguien cambia un criterio, falla aquí.
// 2) Consumidores migrados SIN cambio: misma salida que su expresión anterior
//    (copiada literalmente de f9743a4d).
// 3) Reglas F2 aplicadas (cambio intencionado): reservas nuevas del bot,
//    recordatorios y estado del panel = backend; qué cambia y qué no.
// 4) El espejo del panel coincide con el backend.
//
//     node backend/tests/caracterizacion/criteriosEstadoSorteo.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { prueba, riesgo, ejecutar } = require("./_prueba");

const RAIZ = path.resolve(__dirname, "../..");
const FRONT = path.resolve(RAIZ, "../frontend");
const g = require(path.join(RAIZ, "shared/eventos/estadosGestion.js"));

const ts = require(path.join(FRONT, "node_modules/typescript"));
function cargarTs(ruta) {
    const { outputText } = ts.transpileModule(fs.readFileSync(ruta, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const modulo = { exports: {} };
    const requerir = (id) => id.startsWith(".") ? cargarTs(path.resolve(path.dirname(ruta), `${id}.ts`)) : require(id);
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}
const panel = cargarTs(path.join(FRONT, "components/eventos/estadoEvento.ts"));
const { faseDe } = cargarTs(path.join(FRONT, "components/eventos/modalidad.ts"));

// sorteoAceptaReservas sin la hora de cierre (se prueba aparte, con hora).
require.cache[path.join(RAIZ, "lib/supabase.js")] = { id: path.join(RAIZ, "lib/supabase.js"), filename: path.join(RAIZ, "lib/supabase.js"), loaded: true, exports: { from() { throw new Error("sin base"); } } };
const { sorteoAceptaReservas } = require(path.join(RAIZ, "bot/funciones/reservas/detectarReserva.js"));
const ANTES_DE_CIERRE = new Date("2026-10-22T13:00:00Z"); // 08:00 Colombia
const conHora = (f) => ({ ...f, fecha_evento: "2026-10-22", hora_cierre: "22:00" });

// [nombre, fila, vigente, estadoEnGrupo, abiertoPorEstado(B), enCursoPorActivo(C = panel), contradicciones]
const MATRIZ = [
    ["vigente", { activo: true, estado: "abierto" }, true, "en_curso", true, true, []],
    ["vigente con grupo sin abrir (abierto=false)", { activo: true, estado: "abierto", abierto: false }, true, "en_curso", true, true, []],
    ["vigente con cierre fallido", { activo: true, estado: "abierto", cierre_estado: "fallido" }, true, "en_curso", true, true, []],
    ["cerrado por hora", { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora_cierre" }, false, "cerrado", false, false, []],
    ["cerrado (fallback sin cierre_estado)", { activo: false, estado: "cerrado" }, false, "cerrado", false, false, []],
    ["desactivado", { activo: false, estado: "desactivado" }, false, "desactivado", false, false, []],
    ["cancelado por motivo panel:", { activo: false, estado: "cerrado", cierre_motivo: "panel:cancelado por el administrador" }, false, "cancelado", false, false, []],
    ["eliminado", { activo: false, estado: "eliminado", cierre_motivo: "panel:eliminado" }, false, "eliminado", false, false, []],
    ["sustituido", { activo: false, estado: "cerrado", cierre_motivo: "sustituido por el sorteo X" }, false, "sustituido", false, false, []],
    ["inactivo con estado 'abierto' (histórico)", { activo: false, estado: "abierto" }, false, "cerrado", false, false, []],
    // ---- contradictorias ----
    ["C3: activo=true y cierre_estado='cerrado' (reintento antiguo)", { activo: true, estado: "abierto", cierre_estado: "cerrado" }, false, "cerrado", true, true, ["activo_terminado"]],
    ["C3: activo=true y estado='cerrado'", { activo: true, estado: "cerrado" }, false, "cerrado", false, true, ["activo_terminado"]],
    ["C3: activo=true con motivo de gestión", { activo: true, estado: "abierto", cierre_motivo: "panel:desactivado" }, false, "desactivado", true, true, ["activo_terminado"]],
    ["activo NULL sin más datos (histórico)", { activo: null, estado: "abierto" }, false, "cerrado", true, false, ["activo_sin_valor"]],
    ["activo ausente (fila sin la columna)", { estado: "abierto" }, false, "cerrado", true, false, ["activo_sin_valor"]],
    ["activo NULL y estado 'cerrado'", { activo: null, estado: "cerrado" }, false, "cerrado", false, false, ["activo_sin_valor"]]
];
const filas = MATRIZ.map(m => m[1]);

for (const [n, f, vig, est, b, c, contra] of MATRIZ) {
    prueba(`«${n}» → vigente=${vig} · ${est} · B=${b} · C=${c}`, () => {
        assert.strictEqual(g.vigente(f), vig, "vigente (canónico)");
        assert.strictEqual(g.estadoEnGrupo(f), est, "estadoEnGrupo (canónico)");
        assert.strictEqual(g.abiertoPorEstado(f), b, "B abiertoPorEstado");
        assert.strictEqual(g.enCursoPorActivo(f), c, "C enCursoPorActivo (backend)");
        assert.strictEqual(panel.enCursoPorActivo(f), c, "C enCursoPorActivo (panel)");
        assert.deepStrictEqual(g.contradicciones(f), contra, "contradicciones");
    });
}

prueba("sin contradicciones, todos los criterios coinciden (salvo B en filas de gestión inactivas, que también dan false)", () => {
    for (const [n, f, vig, , b, c, contra] of MATRIZ) {
        if (contra.length) continue;
        assert.strictEqual(vig, c, `${n}: canónico = C`);
        assert.strictEqual(vig, b, `${n}: canónico = B`);
    }
});

prueba("sin fila: vigente=false, estadoEnGrupo=null, sin contradicciones", () => {
    assert.strictEqual(g.vigente(null), false);
    assert.strictEqual(g.estadoEnGrupo(null), null);
    assert.deepStrictEqual(g.contradicciones(undefined), []);
    assert.strictEqual(g.enCursoPorActivo(null), false);
});

// ---- 2) migraciones SIN cambio de comportamiento ----
const ANTES = {
    consultarEvento: (f) => f.activo === true && !g.finDelEvento(f),
    procesarSorteoActivas: (f) => Boolean(f && f.activo && !g.finDelEvento(f)),
    workerEventosTrasConsulta: (f) => !g.finDelEvento(f),     // filas de .eq("activo", true)
    confirmarPagoBloquea: (e) => !e || !e.activo || Boolean(g.finDelEvento(e)),
    sorteosActivosAbierto: (e) => e.activo !== false && e.estado !== "cerrado",
    administracionAbierto: (e) => e.activo !== false && e.estado !== "cerrado",
    gestionEstadoFila: (f) => (f.activo ? "en_curso" : g.motivoGestion(f) || "cerrado"),
    gestionEnCurso: (f) => Boolean(f.activo)
};

prueba("consultarEvento / procesarSorteo: vigente() = expresión anterior en todas las filas", () => {
    for (const f of filas) {
        assert.strictEqual(g.vigente(f), ANTES.consultarEvento(f), JSON.stringify(f));
        assert.strictEqual(g.vigente(f), ANTES.procesarSorteoActivas(f), JSON.stringify(f));
    }
});

prueba("workerEventos: vigente() = !finDelEvento() en las filas que devuelve su consulta (activo=true)", () => {
    for (const f of filas.filter(x => x.activo === true)) assert.strictEqual(g.vigente(f), ANTES.workerEventosTrasConsulta(f), JSON.stringify(f));
});

prueba("confirmarPagoPorSticker: !vigente() = expresión anterior (incluida la fila nula)", () => {
    for (const f of [null, undefined, ...filas]) assert.strictEqual(!g.vigente(f), ANTES.confirmarPagoBloquea(f), JSON.stringify(f));
});

prueba("sorteosActivos / administracion: abiertoPorEstado() = expresión anterior", () => {
    for (const f of filas) {
        assert.strictEqual(g.abiertoPorEstado(f), ANTES.sorteosActivosAbierto(f), JSON.stringify(f));
        assert.strictEqual(g.abiertoPorEstado(f), ANTES.administracionAbierto(f), JSON.stringify(f));
    }
});

prueba("gestionEventos: estadoEnGrupoPorActivo() y enCursoPorActivo() = expresiones anteriores", () => {
    for (const f of filas) {
        assert.strictEqual(g.estadoEnGrupoPorActivo(f), ANTES.gestionEstadoFila(f), JSON.stringify(f));
        assert.strictEqual(g.enCursoPorActivo(f), ANTES.gestionEnCurso(f), JSON.stringify(f));
    }
});

// ---- 3) reglas F2 (cambios intencionados) ----
prueba("regla 1: el bot ya no acepta reservas NUEVAS en filas C3 ni NULL; en las demás, igual que antes", () => {
    const antes = (e) => !!e && e.activo !== false && e.estado !== "cerrado"; // + hora, igual en las dos
    for (const f of filas) {
        const ahora = sorteoAceptaReservas(conHora(f), ANTES_DE_CIERRE);
        assert.strictEqual(ahora, g.vigente(f), `ahora = vigente: ${JSON.stringify(f)}`);
        if (g.contradicciones(f).length === 0) assert.strictEqual(ahora, antes(f), `sin contradicción, igual que antes: ${JSON.stringify(f)}`);
    }
    // Cambian exactamente estas: antes aceptaban, ahora no.
    const cambian = filas.filter(f => antes(f) && !sorteoAceptaReservas(conHora(f), ANTES_DE_CIERRE));
    assert.ok(cambian.every(f => g.contradicciones(f).length > 0));
    assert.strictEqual(cambian.length, 4, "C3 abierta, C3 con motivo, NULL y ausente");
    // La hora de cierre sigue mandando.
    assert.strictEqual(sorteoAceptaReservas(conHora({ activo: true, estado: "abierto" }), new Date("2026-10-23T04:00:00Z")), false);
});

prueba("regla 3: el panel muestra EXACTAMENTE el estado del backend (Eventos) en todas las filas mostradas", () => {
    for (const f of filas) {
        if (g.eliminado(f)) continue; // nunca se muestran
        assert.strictEqual(panel.estadoFila(f), g.estadoEnGrupoPorActivo(f), JSON.stringify(f));
    }
    assert.strictEqual(panel.estadoSorteo([{ activo: null, estado: "abierto" }]), "cerrado", "NULL = cerrado también en el sorteo completo");
});

prueba("regla 4 en la pestaña del panel (faseDe): NULL = finalizado; el resto como antes", () => {
    const antes = (e) => { const s = (e.estado || "").toLowerCase(); return s === "cerrado" || s === "finalizado" || e.activo === false ? "finalizado" : s === "programado" ? "programado" : "activo"; };
    for (const f of filas) {
        if (f.activo === true || f.activo === false) assert.strictEqual(faseDe(f), antes(f), JSON.stringify(f));
        else assert.strictEqual(faseDe(f), "finalizado", JSON.stringify(f));
    }
});

// ---- 4) espejo del panel ----
prueba("panel.motivoGestion y panel.eliminado = backend en todas las filas y motivos", () => {
    const motivos = [null, "", "hora_cierre", "panel:cancelado", "panel:cancelado por x", "panel:desactivado", "panel:eliminado", "panel:eliminado:x", "panel:otra", "sustituido", "sustituido por X", "recuperado: hora pasó", "panel:eliminados", "normalizado: panel:cancelado", "normalizado: hora", "normalizado: sustituido por X", "normalizado: panel:eliminado"];
    const estados = [null, "abierto", "cerrado", "desactivado", "cancelado", "eliminado", "programado"];
    for (const estado of estados) for (const cierre_motivo of motivos) for (const activo of [true, false, null]) {
        const f = { activo, estado, cierre_motivo };
        assert.strictEqual(panel.motivoGestion(f), g.motivoGestion(f), JSON.stringify(f));
        assert.strictEqual(panel.eliminado(f), g.eliminado(f), JSON.stringify(f));
    }
});

// ---- riesgos que quedan escritos ----
prueba("conflictos pendientes de decisión (no se resuelven en F2)", () => {
    const c3 = { activo: true, estado: "abierto", cierre_estado: "cerrado" };
    assert.strictEqual(g.vigente(c3), false);                         // canónico: cerrada
    assert.strictEqual(g.estadoEnGrupoPorActivo(c3), "en_curso");     // Eventos (backend y panel): «En curso»
    assert.strictEqual(g.abiertoPorEstado(c3), true);                 // sorteosActivos/administracion: «abierto», editable
    riesgo("Regla 5 en Eventos, Sorteos programados y edición: una fila activo=true ya terminada (C3) se sigue mostrando «En curso»/«abierta». Pasarla a «Cerrado» exige cambiar las acciones Cerrar/Reabrir (F3) y la lectura de Compartir (protegida).");
    riesgo("Reserva manual del panel: el propietario puede reservar en el sorteo activo aunque esté cerrado (regla de negocio vigente), lo que choca con la regla 1.");
});

ejecutar("CARACTERIZACIÓN F2 · criterios y reglas del estado de un sorteo");
