// ==========================================================================
// PRUEBAS (frontend) — «Sorteo instantáneo» (services/sorteos/
// sorteoInstantaneo.ts, módulo puro: sin red) y su conexión en el panel.
//
//   - «Publicar ahora» solo con: borrador, sin bloqueos, listo para publicar
//     YA, imagen del servidor generada (sin imagen no se publica), reinicio
//     confirmado si lo hay y la vista previa revisada;
//   - el resultado nunca da por enviado lo que no se confirmó;
//   - tras un «tiempo agotado» se reconstruye el resultado del sorteo real;
//   - la sección existe en el menú (debajo de «Sorteos»), el formulario y la
//     vista previa tienen el modo inmediato y el proxy deja pasar las rutas.
//
//     node frontend/tests/sorteos/sorteoInstantaneo.test.mjs
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

const { motivoNoPublicable, resumenDesdeSorteo, textoResultado } = cargarTs(path.join(FRONT, "services/sorteos/sorteoInstantaneo.ts"));
const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

let total = 0;
function prueba(nombre, fn) { fn(); total++; console.log(`✅ ${nombre}`); }

const vista = (extra = {}) => ({ estado: "borrador", bloqueos: [], estado_publicacion: "listo", reinicio: null, publicacion_inmediata: true, ...extra });
const OK = { tipo: "ok", imagen: "data:image/png;base64,AAAA" };

prueba("«Publicar ahora» solo cuando todo está listo, incluida la imagen generada por el servidor", () => {
    const base = { revisado: true, reinicioConfirmado: false, imagen: OK };
    assert.strictEqual(motivoNoPublicable(vista(), base), null);
    assert.match(motivoNoPublicable(vista({ estado: "programado" }), base), /ya se confirmó/);
    assert.match(motivoNoPublicable(vista({ bloqueos: ["x"] }), base), /bloqueos/);
    assert.match(motivoNoPublicable(vista({ estado_publicacion: "programado" }), base), /Sustituir/);
    assert.match(motivoNoPublicable(vista(), { ...base, imagen: { tipo: "probando" } }), /Generando/);
    assert.match(motivoNoPublicable(vista(), { ...base, imagen: { tipo: "error", mensaje: "x" } }), /sin imagen no se publica/);
    assert.match(motivoNoPublicable(vista({ reinicio: { al_publicar: true } }), base), /reinicio/);
    assert.strictEqual(motivoNoPublicable(vista({ reinicio: { al_publicar: true } }), { ...base, reinicioConfirmado: true }), null);
    assert.match(motivoNoPublicable(vista(), { ...base, revisado: false }), /revisaste/);
});

prueba("el resultado no da por enviado lo que no se confirmó", () => {
    const r = { publicados: 1, fallidos: 1, en_revision: 1, pendientes: 0, grupos: [{}, {}, {}] };
    const t = textoResultado(r);
    assert.match(t, /Enviado en 1 de 3/);
    assert.match(t, /1 con error \(no se envió/);
    assert.match(t, /no se sabe si llegó, no se reenvía solo/);
    assert.match(textoResultado({ ...r, repetido: true }), /^Este sorteo ya se había confirmado: no se publicó otra vez/);
});

prueba("tras un tiempo agotado, el resultado se reconstruye con el estado real del sorteo", () => {
    const s = {
        id: "s1", estado: "publicado_parcial",
        grupos: [
            { grupo_id: "g1", grupo_nombre: "Uno", estado: "publicado", ultimo_error: null },
            { grupo_id: "g2", grupo_nombre: "Dos", estado: "requiere_revision", ultimo_error: "El anuncio no se pudo enviar: x" },
            { grupo_id: "g3", grupo_nombre: "Tres", estado: "cancelado", ultimo_error: null }
        ]
    };
    const r = resumenDesdeSorteo(s);
    assert.deepStrictEqual([r.publicados, r.en_revision, r.fallidos, r.pendientes, r.grupos.length], [1, 1, 0, 0, 2]);
    assert.strictEqual(r.grupos[1].error, "El anuncio no se pudo enviar: x");
});

prueba("acceso directo «Publicar ahora» en el menú justo debajo de «Programados», con su página", () => {
    const menu = leer("components/layout/Sidebar/Sidebar.tsx");
    const sorteos = menu.indexOf('{ href: "/sorteos", label: "Programados"');
    const instantaneo = menu.indexOf('{ href: "/sorteo-instantaneo", label: "Publicar ahora"');
    assert.ok(sorteos > 0 && instantaneo > sorteos && menu.slice(sorteos, instantaneo).split("\n").length === 2, "inmediatamente debajo");
    assert.match(leer("app/sorteo-instantaneo/page.tsx"), /<SorteoInstantaneoPage \/>/);
    assert.match(leer("components/sorteos/SorteoInstantaneoPage.tsx"), /<FormularioSorteo[\s\S]*?instantaneo[\s\S]*?\/>/);
});

prueba("formulario y vista previa en modo inmediato; «Programados» sigue igual", () => {
    const form = leer("components/sorteos/FormularioSorteo.tsx");
    assert.match(form, /publicacion_inmediata: true/);
    assert.match(form, /Fecha y hora de publicación \(hora de Colombia\)/, "el programado conserva su campo");
    const vistaPrevia = leer("components/sorteos/VistaPreviaModal.tsx");
    assert.match(vistaPrevia, /apiSorteos\.publicarAhora\(/);
    assert.match(vistaPrevia, /apiSorteos\.imagenPrueba\(/);
    assert.match(vistaPrevia, /publicandoRef\.current/, "bloqueo síncrono contra doble clic");
    assert.match(vistaPrevia, /Confirmar y programar/, "el botón de programar sigue existiendo");
});

prueba("el proxy deja pasar publicar-ahora (POST) e imagen-prueba (GET) con más tiempo, y un tiempo agotado no se da por fallo", () => {
    const proxy = leer("app/api/sorteos/[[...ruta]]/route.ts");
    assert.match(proxy, /b === "publicar-ahora"\) return metodo === "POST"/);
    assert.match(proxy, /b === "imagen-prueba"\) return metodo === "GET"/);
    assert.match(proxy, /publicar-ahora"\) \? 120000/);
    assert.match(proxy, /motivo: "tiempo_agotado"/);
});

console.log(`\nTOTAL: ${total}  ✅ PASA: ${total}  ❌ FALLA: 0`);
