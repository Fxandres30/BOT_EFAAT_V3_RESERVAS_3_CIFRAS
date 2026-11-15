// ==========================================================================
// PRUEBAS (frontend) — pre-captura de la imagen de una tabla
// (services/tablas/precapturaTabla.ts, módulo puro).
//
//   - misma tabla → la imagen preparada se reutiliza (una sola generación);
//   - cualquier cambio (reserva, pago, liberación, diseño, ancho) cambia la
//     clave y se genera otra: una imagen vieja nunca se entrega;
//   - carrera: se prepara A, la tabla cambia a B y se comparte → se entrega
//     la de B (aunque A termine después);
//   - un fallo no queda guardado: el siguiente intento vuelve a generar;
//   - dos peticiones a la vez de la misma tabla → una sola generación.
//
//     node frontend/tests/tablas/precapturaTabla.test.mjs
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

const { claveImagen, crearPrecaptura } = cargarTs(path.join(FRONT, "services/tablas/precapturaTabla.ts"));

let ok = 0;
const paso = (n) => { ok++; console.log(`✅ ${n}`); };

// Tabla de 100 números con los estados dados (índice -> estado).
function entrada(estados = {}, { diseno = { tema: "azul" }, ancho = 720 } = {}) {
    const numeros = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
    const estado = (n) => estados[Number(n)] || "libre";
    return {
        numeros: {
            numerosDisponibles: numeros.filter(n => estado(n) === "libre"),
            numerosOcupados: numeros.filter(n => estado(n) !== "libre"),
            numerosPagados: numeros.filter(n => estado(n) === "pagado")
        },
        diseno,
        anchoContenido: ancho
    };
}

// Generador falso: devuelve la clave de lo que «pintó» y cuenta llamadas.
function generadorFalso() {
    const llamadas = [];
    const pendientes = [];
    const generar = (e) => new Promise((res, rej) => {
        llamadas.push(claveImagen(e));
        pendientes.push({ res: () => res({ imagen: `png:${claveImagen(e)}`, huella: "h" }), rej });
    });
    return { generar, llamadas, pendientes };
}

(async () => {

    // ---- clave
    const base = entrada({ 3: "reservado", 7: "pagado" });
    assert.strictEqual(claveImagen(base), claveImagen(entrada({ 3: "reservado", 7: "pagado" })));
    for (const [nombre, otra] of [
        ["reserva nueva", entrada({ 3: "reservado", 7: "pagado", 50: "reservado" })],
        ["pago", entrada({ 3: "pagado", 7: "pagado" })],
        ["liberación", entrada({ 7: "pagado" })],
        ["bloqueo (se pinta como ocupado)", entrada({ 3: "reservado", 7: "pagado", 9: "bloqueado" })],
        ["diseño", entrada({ 3: "reservado", 7: "pagado" }, { diseno: { tema: "rojo" } })],
        ["ancho", entrada({ 3: "reservado", 7: "pagado" }, { ancho: 390 })]
    ]) assert.notStrictEqual(claveImagen(otra), claveImagen(base), nombre);
    paso("clave: idéntica para la misma tabla; cambia con una reserva, un pago, una liberación, un bloqueo, el diseño o el ancho");

    // ---- reutilización
    {
        const g = generadorFalso();
        const p = crearPrecaptura(g.generar, () => 0);
        assert.strictEqual(p.falta(base), true);
        const a = p.obtener(base);
        const b = p.obtener(entrada({ 3: "reservado", 7: "pagado" }));
        assert.strictEqual(g.llamadas.length, 1, "dos peticiones de la misma tabla = una generación");
        assert.strictEqual(p.falta(base), false, "en curso cuenta como preparada");
        g.pendientes[0].res();
        assert.strictEqual((await a).imagen, `png:${claveImagen(base)}`);
        assert.strictEqual(await b, await a);
        assert.strictEqual((await p.obtener(base)).imagen, `png:${claveImagen(base)}`);
        assert.strictEqual(g.llamadas.length, 1);
        paso("misma tabla: la imagen preparada (o en curso) se reutiliza; una sola generación");
    }

    // ---- invalidación
    {
        const g = generadorFalso();
        const p = crearPrecaptura(g.generar, () => 0);
        const a = p.obtener(base); g.pendientes[0].res(); await a;
        const cambiada = entrada({ 3: "reservado", 7: "pagado", 50: "reservado" });
        assert.strictEqual(p.falta(cambiada), true);
        const b = p.obtener(cambiada);
        assert.strictEqual(g.llamadas.length, 2);
        g.pendientes[1].res();
        assert.strictEqual((await b).imagen, `png:${claveImagen(cambiada)}`);
        // Volver a la tabla anterior también regenera: solo se guarda la última.
        const c = p.obtener(base);
        assert.strictEqual(g.llamadas.length, 3);
        g.pendientes[2].res(); await c;
        paso("un cambio en la tabla invalida la imagen anterior: se genera otra y la vieja no se entrega nunca");
    }

    // ---- carrera: se prepara A, cambia a B, se comparte B; A termina después
    {
        const g = generadorFalso();
        const p = crearPrecaptura(g.generar, () => 0);
        const preparadaA = p.obtener(base);
        const B = entrada({ 3: "reservado", 7: "pagado", 60: "pagado" });
        const compartidaB = p.obtener(B);
        g.pendientes[1].res();          // B termina primero
        g.pendientes[0].res();          // A, después
        assert.strictEqual((await compartidaB).imagen, `png:${claveImagen(B)}`);
        assert.strictEqual((await preparadaA).imagen, `png:${claveImagen(base)}`);
        assert.strictEqual(p.falta(B), false);
        assert.strictEqual(p.falta(base), true, "A terminó tarde pero NO pasa a ser la imagen guardada");
        assert.strictEqual((await p.obtener(B)).imagen, `png:${claveImagen(B)}`);
        assert.strictEqual(g.llamadas.length, 2);
        paso("carrera: preparar A y compartir B a la vez entrega B; A, aunque termine después, no la sustituye");
    }

    // ---- fallo
    {
        const g = generadorFalso();
        const p = crearPrecaptura(g.generar, () => 0);
        const a = p.obtener(base);
        g.pendientes[0].rej(new Error("Chromium no pudo"));
        await assert.rejects(a, /Chromium no pudo/);
        assert.strictEqual(p.falta(base), true, "un fallo no queda guardado");
        const b = p.obtener(base);
        assert.strictEqual(g.llamadas.length, 2);
        g.pendientes[1].res();
        assert.strictEqual((await b).imagen, `png:${claveImagen(base)}`);
        paso("un fallo no se guarda: el siguiente intento vuelve a generar la imagen");
    }

    // ---- duración (decide si el dispositivo es lento)
    {
        let t = 0;
        const g = generadorFalso();
        const p = crearPrecaptura(g.generar, () => t);
        assert.strictEqual(p.ultimaDuracion(), null);
        const a = p.obtener(base); t = 2300; g.pendientes[0].res(); await a;
        assert.strictEqual(p.ultimaDuracion(), 2300);
        paso("registra cuánto tardó la última imagen (para no preparar por adelantado en dispositivos lentos)");
    }

    console.log(`\n${ok} pruebas correctas.`);

})().catch((e) => { console.error("❌", e); process.exit(1); });
