// ==========================================================================
// PRUEBAS (frontend) — indicador orientativo de seguridad de contraseñas del
// formulario Crear cuenta.
//
// Carga el módulo TypeScript REAL transpilándolo con el TypeScript del
// propio proyecto (mismo método que tests/landing). Sin dependencias nuevas.
//
//     node frontend/tests/auth/seguridadContrasena.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(relativa) {
    const fuente = fs.readFileSync(path.join(FRONT, relativa), "utf8");
    const { outputText } = ts.transpileModule(fuente, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, () => {
        throw new Error(`${relativa} no debe importar nada`);
    });
    return modulo.exports;
}

const { evaluarContrasena, LONGITUD_MINIMA } = cargarTs("lib/auth/seguridadContrasena.ts");

let ok = 0;
function prueba(nombre, fn) {
    fn();
    ok++;
    console.log(`  ✔ ${nombre}`);
}

const nivel = (p, datos) => evaluarContrasena(p, datos).nivel;

console.log("seguridadContrasena");

prueba("longitud mínima de 8", () => {
    assert.strictEqual(LONGITUD_MINIMA, 8);
    const e = evaluarContrasena("Tr7#k");
    assert.strictEqual(e.nivel, 0);
    assert.strictEqual(e.etiqueta, "Muy débil");
    assert.strictEqual(e.cumpleMinimo, false);
    assert.ok(e.sugerencias.some((s) => s.startsWith("Añade más caracteres")));
});

prueba("contraseñas comunes son muy débiles (también con adornos y sustituciones)", () => {
    for (const p of ["password", "Password2024!", "P@ssw0rd", "qwerty123", "contraseña", "Qwerty123!", "iloveyou"]) {
        assert.strictEqual(nivel(p), 0, p);
        assert.strictEqual(evaluarContrasena(p).cumpleMinimo, false, p);
    }
});

prueba("secuencias y repeticiones son muy débiles", () => {
    for (const p of ["12345678", "abcdefgh", "87654321", "aaaaaaaa", "Abcdefgh1!", "abcabcabc", "asdfghjk", "11111111!!"]) {
        assert.strictEqual(nivel(p), 0, p);
    }
    assert.ok(evaluarContrasena("abcdefgh").sugerencias.some((s) => s.includes("secuencias")));
    assert.ok(evaluarContrasena("aaaaaaaa").sugerencias.some((s) => s.includes("repetir")));
});

prueba("los símbolos solos no hacen fuerte una contraseña", () => {
    assert.strictEqual(nivel("!!!!!!!!@#"), 0);
    assert.ok(nivel("Ab1!xyzq") < 3);
});

prueba("solo dígitos nunca pasa de débil", () => {
    assert.ok(nivel("80417395261847") <= 1);
});

prueba("palabra sencilla: débil pero admitida", () => {
    const e = evaluarContrasena("pantalones");
    assert.strictEqual(e.etiqueta, "Débil");
    assert.strictEqual(e.cumpleMinimo, true);
    assert.ok(e.sugerencias.includes("Combina palabras o utiliza una frase larga y única."));
});

prueba("años restan", () => {
    assert.ok(evaluarContrasena("Verano2024!").sugerencias.includes("Evita años o fechas."));
    assert.ok(!evaluarContrasena("Verano8461!").sugerencias.includes("Evita años o fechas."));
    assert.ok(nivel("tranvia1987xq") < nivel("tranvia8461xq"));
});

prueba("nombre o correo de la persona restan", () => {
    const datos = ["Andrés Pérez", "andres.perez@correo.com"];
    const e = evaluarContrasena("perez.andres7", datos);
    assert.ok(e.sugerencias.includes("No uses tu nombre ni tu correo."));
    assert.ok(e.nivel < nivel("perez.andres7"));
});

prueba("frase larga y única es fuerte", () => {
    const e = evaluarContrasena("nube verde sobre el tranvía");
    assert.strictEqual(e.etiqueta, "Fuerte");
    assert.deepStrictEqual(e.sugerencias, ["Buena contraseña."]);
    assert.strictEqual(e.cumpleMinimo, true);
});

prueba("aleatoria con variedad y longitud es fuerte", () => {
    assert.strictEqual(nivel("Tq8#vLm2pZ!w"), 3);
    assert.strictEqual(nivel("Tr7#kq9!"), 2);
});

prueba("como mucho 3 sugerencias y nunca vacío", () => {
    for (const p of ["", "a", "Password2024!", "abcabc123", "nube verde sobre el tranvía"]) {
        const e = evaluarContrasena(p);
        assert.ok(e.sugerencias.length >= 1 && e.sugerencias.length <= 3, p);
    }
});

console.log(`\n${ok} pruebas OK`);
