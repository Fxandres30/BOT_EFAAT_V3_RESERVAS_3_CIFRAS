// ==========================================================================
// PRUEBAS (frontend) — galería de stickers de pago
// (services/automatizacion/bibliotecaStickersVista.ts, módulo puro).
//
//     node frontend/tests/automatizacion/bibliotecaStickers.test.mjs
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
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, () => {
        throw new Error("bibliotecaStickersVista.ts no debe importar nada");
    });
    return modulo.exports;
}

const V = cargarTs(path.join(FRONT, "services/automatizacion/bibliotecaStickersVista.ts"));

let total = 0;
function prueba(nombre, fn) {
    fn();
    total++;
    console.log(`  ✔ ${nombre}`);
}

const U = "11111111-1111-1111-1111-111111111111";

function st(id, hash, fecha, extra = {}) {
    return {
        id, usuario_id: U, sticker_sha256: hash, mimetype: "image/webp", es_animado: false,
        imagen_ruta: `${U}/${hash}.webp`, registrado_en: fecha, registrado_por: null, ...extra
    };
}

prueba("el predeterminado se identifica por huella (sin distinguir mayúsculas) y va primero", () => {
    const g = V.armarGaleria(
        [st("a", "aa", "2026-11-05T10:00:00Z"), st("b", "bb", "2026-11-01T10:00:00Z")],
        " BB "
    );
    assert.deepStrictEqual(g.map(t => t.clave), ["b", "a"]);
    assert.strictEqual(g[0].esPredeterminado, true);
    assert.strictEqual(g.filter(t => t.esPredeterminado).length, 1);
});

prueba("los no predeterminados se ordenan del más reciente al más antiguo", () => {
    const g = V.armarGaleria(
        [st("viejo", "01", "2026-10-01T00:00:00Z"), st("nuevo", "02", "2026-11-01T00:00:00Z")],
        null
    );
    assert.deepStrictEqual(g.map(t => t.clave), ["nuevo", "viejo"]);
    assert.ok(g.every(t => !t.esPredeterminado));
});

prueba("predeterminado sin fila en la biblioteca: no se pierde, aparece sin vista previa", () => {
    const g = V.armarGaleria([st("a", "aa", "2026-11-05T10:00:00Z")], "ff");
    assert.strictEqual(g[0].clave, "predeterminado-sin-fila");
    assert.strictEqual(g[0].sticker, null);
    assert.strictEqual(g[0].vista, "sin_imagen");
    assert.strictEqual(g.length, 2);
});

prueba("sin predeterminado ni biblioteca: galería vacía", () => {
    assert.deepStrictEqual(V.armarGaleria([], null), []);
});

prueba("tipo de vista: imagen, Lottie y sin imagen", () => {
    assert.strictEqual(V.tipoVista({ mimetype: "image/webp", imagen_ruta: "x/y.webp" }), "imagen");
    assert.strictEqual(V.tipoVista({ mimetype: "application/was", imagen_ruta: "x/y.was" }), "lottie");
    assert.strictEqual(V.tipoVista({ mimetype: "image/webp", imagen_ruta: null }), "sin_imagen");
});

prueba("solo se piden URLs de la carpeta propia", () => {
    const rutas = V.rutasFirmables([
        st("a", "aa", "x"),
        st("b", "bb", "x", { imagen_ruta: "otro-usuario/bb.webp" }),
        st("c", "cc", "x", { imagen_ruta: `${U}/../otro/cc.webp` }),
        st("d", "dd", "x", { imagen_ruta: null })
    ], U);
    assert.deepStrictEqual(rutas, [`${U}/aa.webp`]);
});

prueba("tabla ausente (046 sin aplicar) se reconoce; otros errores no", () => {
    assert.strictEqual(V.esTablaAusente({ code: "PGRST205" }), true);
    assert.strictEqual(V.esTablaAusente({ code: "42P01" }), true);
    assert.strictEqual(V.esTablaAusente({ message: "Could not find the table 'public.stickers_pago_biblioteca' in the schema cache" }), true);
    assert.strictEqual(V.esTablaAusente({ code: "42501", message: "permission denied" }), false);
    assert.strictEqual(V.esTablaAusente(null), false);
});

prueba("mismo bucket que el backend y la migración 046", () => {
    const backend = fs.readFileSync(path.join(FRONT, "../backend/bot/funciones/pagos/bibliotecaStickersPago.js"), "utf8");
    const sql = fs.readFileSync(path.join(FRONT, "../backend/supabase_migrations/046_biblioteca_stickers_pago.sql"), "utf8");
    assert.ok(backend.includes(`"${V.BUCKET_STICKERS_PAGO}"`));
    assert.ok(sql.includes(`'${V.BUCKET_STICKERS_PAGO}'`));
});

prueba("la confirmación de pagos no lee la biblioteca", () => {
    for (const archivo of ["confirmarPagoPorSticker.js", "configuracionStickerPago.js"]) {
        const fuente = fs.readFileSync(path.join(FRONT, "../backend/bot/funciones/pagos", archivo), "utf8");
        assert.ok(!fuente.includes("stickers_pago_biblioteca"), `${archivo} no debe usar la biblioteca`);
    }
});

console.log(`\n${total} pruebas superadas`);
