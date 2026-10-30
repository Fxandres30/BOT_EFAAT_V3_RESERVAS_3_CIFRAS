// ==========================================================================
// Perfil de captura: dato que llega del panel (ventana y columna) y abre el
// Chromium del servidor. Solo se acepta si son enteros en rango; si no, el
// sorteo se queda sin perfil (imagen como «Compartir» en escritorio).
//
//     node backend/tests/sorteos/perfilCaptura.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const abs = path.join(RAIZ, "lib/supabase.js");
require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: { from: () => ({}), auth: {} } };

const { perfilCapturaValido } = require(path.join(RAIZ, "sorteos/servicio.js"));

assert.deepStrictEqual(perfilCapturaValido({ ventana: 390, contenido: 358, extra: "x" }), { ventana: 390, contenido: 358 }, "válido, sin campos ajenos");
assert.deepStrictEqual(perfilCapturaValido({ ventana: "1366", contenido: "1100" }), { ventana: 1366, contenido: 1100 }, "enteros en texto");

for (const malo of [undefined, null, "390", {}, { ventana: 390 }, { ventana: 100, contenido: 90 }, { ventana: 99999, contenido: 500 },
    { ventana: 390, contenido: 500 }, { ventana: 390, contenido: 100 }, { ventana: 390.5, contenido: 358 }, { ventana: NaN, contenido: 358 }]) {
    assert.strictEqual(perfilCapturaValido(malo), null, JSON.stringify(malo));
}

console.log("✅ perfil de captura: 2 válidos y 11 inválidos");
