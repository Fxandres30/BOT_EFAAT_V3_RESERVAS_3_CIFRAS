// ==========================================================================
// PRUEBAS (frontend) — estado de los sorteos en Eventos y enlace «Administrar
// sorteo» (components/eventos/estadoEvento.ts, agruparEventos.ts; módulos
// puros: sin red ni Supabase).
//
//   - el estado de cada grupo y del sorteo es el MISMO que decide el backend
//     (backend/shared/eventos/estadosGestion.js): desactivado, cancelado y
//     sustituido ya no se muestran como «Cerrado» ni con el texto crudo;
//   - el sorteo está «En curso» si lo está en algún grupo;
//   - «Administrar sorteo» lleva a Sorteos → «Administrar» con ESE sorteo.
//
//     node frontend/tests/eventos/estadoEvento.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, require);
    return modulo.exports;
}

const { estadoFila, estadoSorteo, ETIQUETA_ESTADO, enlaceAdministrar } = cargarTs(path.join(FRONT, "components/eventos/estadoEvento.ts"));
const { agruparEventos } = cargarTs(path.join(FRONT, "components/eventos/agruparEventos.ts"));
const backend = require(path.join(FRONT, "../backend/shared/eventos/estadosGestion.js"));

let total = 0;
function prueba(nombre, fn) { fn(); total++; console.log(`✅ ${nombre}`); }

// Filas como las deja el backend (gestionEventos.js, cerrarEvento, detección).
const FILAS = {
    activa: { activo: true, estado: "abierto" },
    cerrada: { activo: false, estado: "cerrado", cierre_motivo: "hora de cierre" },
    cerrada_panel: { activo: false, estado: "cerrado", cierre_motivo: "panel:cerrado manualmente" },
    desactivada: { activo: false, estado: "desactivado", cierre_motivo: "panel:desactivado" },
    // Base con CHECK antiguo sobre «estado»: solo el motivo lo distingue.
    desactivada_check: { activo: false, estado: "cerrado", cierre_motivo: "panel:desactivado" },
    cancelada: { activo: false, estado: "cancelado", cierre_motivo: "panel:cancelado" },
    cancelada_check: { activo: false, estado: "cerrado", cierre_motivo: "panel:cancelado" },
    sustituida: { activo: false, estado: "cerrado", cierre_motivo: "sustituido por Boyacá 22:30 (reabierto desde el panel)" }
};

prueba("cada fila muestra el estado que decide el backend (también con CHECK antiguo sobre «estado»)", () => {
    const esperado = { activa: "en_curso", cerrada: "cerrado", cerrada_panel: "cerrado", desactivada: "desactivado", desactivada_check: "desactivado", cancelada: "cancelado", cancelada_check: "cancelado", sustituida: "sustituido" };
    for (const [k, f] of Object.entries(FILAS)) {
        assert.strictEqual(estadoFila(f), esperado[k], k);
        // Paridad con backend/shared/eventos/estadosGestion.js.
        if (!f.activo) assert.strictEqual(estadoFila(f), backend.motivoGestion(f) || "cerrado", `paridad ${k}`);
    }
});

prueba("sorteo con varios grupos: «En curso» si lo está en alguno; si no, el estado de la representante", () => {
    assert.strictEqual(estadoSorteo([FILAS.desactivada, FILAS.activa]), "en_curso");
    assert.strictEqual(estadoSorteo([FILAS.cancelada, FILAS.cancelada]), "cancelado");
    assert.strictEqual(estadoSorteo([]), "cerrado");
    assert.strictEqual(estadoSorteo([{ estado: "abierto" }]), "en_curso", "activo ausente = activo (como agruparEventos)");
});

prueba("etiquetas: nunca el texto crudo de la base; desactivado y cancelado se distinguen de cerrado", () => {
    assert.deepStrictEqual(Object.values(ETIQUETA_ESTADO).map(e => e.texto), ["En curso", "Cerrado", "Desactivado", "Cancelado", "Sustituido"]);
    assert.notStrictEqual(ETIQUETA_ESTADO.cancelado.kind, ETIQUETA_ESTADO.cerrado.kind);
    assert.notStrictEqual(ETIQUETA_ESTADO.desactivado.kind, ETIQUETA_ESTADO.cerrado.kind);
});

prueba("agruparEventos pasa cierre_motivo a cada grupo: un grupo desactivado no se ve «Cerrado»", () => {
    const [s] = agruparEventos([
        { id: "e1", usuario_id: "u", identidad_evento_real: "x", grupo_id: "g1", activo: true, estado: "abierto", actualizado_en: "2026-10-27T10:00:00Z" },
        { id: "e2", usuario_id: "u", identidad_evento_real: "x", grupo_id: "g2", activo: false, estado: "cerrado", cierre_motivo: "panel:desactivado", actualizado_en: "2026-10-27T11:00:00Z" }
    ]);
    assert.deepStrictEqual(s.grupos.map(g => [g.grupo_id, estadoFila(g)]), [["g1", "en_curso"], ["g2", "desactivado"]]);
    assert.strictEqual(estadoSorteo(s.grupos), "en_curso");
});

prueba("«Administrar sorteo» desde otras pantallas abre Eventos con ESE sorteo", () => {
    assert.strictEqual(enlaceAdministrar("e0000000-0000-4000-8000-000000000001"), "/eventos?sorteo=e0000000-0000-4000-8000-000000000001");
    assert.strictEqual(enlaceAdministrar(undefined), "/eventos");
    assert.ok(!enlaceAdministrar("a&b=c").includes("&b="), "el id va codificado");
});

prueba("Eventos ya no tiene un «Administrar» que lleve a la tabla de reservas", () => {
    for (const f of ["components/eventos/EventoCard/EventoCard.tsx", "components/eventos/EventoTresCifrasCard/EventoTresCifrasCard.tsx"]) {
        const fuente = fs.readFileSync(path.join(FRONT, f), "utf8");
        assert.ok(/onClick=\{onAdministrar\}[\s\S]*?Administrar sorteo/.test(fuente), `${f}: abre la administración real en Eventos`);
        assert.ok(!/>\s*Administrar\s*</.test(fuente), `${f}: sin el botón ambiguo «Administrar»`);
        assert.ok(fuente.includes("Ver tabla de reservas"), `${f}: la tabla tiene su propio nombre`);
    }
});

console.log(`\nTOTAL: ${total}  ✅ PASA: ${total}  ❌ FALLA: 0`);
