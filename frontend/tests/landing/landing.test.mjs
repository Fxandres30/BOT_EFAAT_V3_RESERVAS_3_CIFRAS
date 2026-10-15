// ==========================================================================
// PRUEBAS (frontend) — landing pública: simulador de la demostración y
// configuración comercial de planes.
//
// Carga los módulos TypeScript REALES transpilándolos con el TypeScript del
// propio proyecto (mismo método que tests/mensajes). Sin dependencias nuevas.
//
//     node frontend/tests/landing/landing.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// Módulos sin imports: basta con transpilar y evaluar.
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

const sim = cargarTs("components/landing/demo/simuladorDemo.ts");
const planes = cargarTs("lib/comercial/planes.ts");

let ok = 0;
function prueba(nombre, fn) {
    fn();
    ok++;
    console.log("  ✔", nombre);
}

console.log("Simulador de la demostración");

prueba("estado inicial: 100 números, 20 ocupados, ninguno de Camila", () => {
    const e = sim.crearEstadoInicial();
    assert.strictEqual(e.length, 100);
    assert.strictEqual(sim.contarLibres(e), 80);
    assert.deepStrictEqual(sim.numerosDe(e, sim.PARTICIPANTE_DEMO), []);
});

prueba("reserva completa de dos números libres, con reacción", () => {
    const e = sim.crearEstadoInicial();
    const r = sim.procesarMensaje(e, "Me anotas el 23 y el 46");
    assert.strictEqual(r.tipo, "reserva_completa");
    assert.deepStrictEqual(r.reservados, [23, 46]);
    assert.strictEqual(r.reaccion, sim.REACCION_RESERVA);
    assert.match(r.respuesta, /23 y 46 quedaron reservados/);
    assert.deepStrictEqual(sim.numerosDe(r.estado, "Camila"), [23, 46]);
});

prueba("la función es pura: no modifica el estado recibido", () => {
    const e = sim.crearEstadoInicial();
    const copia = [...e];
    sim.procesarMensaje(e, "quiero el 10");
    assert.deepStrictEqual([...e], copia);
});

prueba("reserva parcial: uno libre y uno ocupado", () => {
    const r = sim.procesarMensaje(sim.crearEstadoInicial(), "me das el 23 y el 45");
    assert.strictEqual(r.tipo, "reserva_parcial");
    assert.deepStrictEqual(r.reservados, [23]);
    assert.match(r.respuesta, /23 quedó reservado\. 45 ya estaba ocupado\./);
});

prueba("número ocupado (singular) y todos ocupados (plural), sin reacción", () => {
    const uno = sim.procesarMensaje(sim.crearEstadoInicial(), "el 45 por favor");
    assert.strictEqual(uno.tipo, "numero_ocupado");
    assert.strictEqual(uno.reaccion, null);
    assert.match(uno.respuesta, /el número 45 ya está ocupado/);
    const varios = sim.procesarMensaje(sim.crearEstadoInicial(), "03 y 07");
    assert.strictEqual(varios.tipo, "todos_ocupados");
    assert.match(varios.respuesta, /03 y 07 ya estaban ocupados/);
});

prueba("pedir un número propio no lo duplica", () => {
    const e = sim.procesarMensaje(sim.crearEstadoInicial(), "el 23").estado;
    const r = sim.procesarMensaje(e, "el 23");
    assert.strictEqual(r.tipo, "ya_era_tuyo");
    assert.strictEqual(r.estado, e);
});

prueba("mis números: vacío, singular y plural", () => {
    let e = sim.crearEstadoInicial();
    assert.match(sim.procesarMensaje(e, "¿Cuáles son mis números?").respuesta, /todavía no tienes/);
    e = sim.procesarMensaje(e, "el 05").estado;
    assert.match(sim.procesarMensaje(e, "mis numeros").respuesta, /tu número es: 05/);
    e = sim.procesarMensaje(e, "el 06").estado;
    assert.match(sim.procesarMensaje(e, "qué números tengo").respuesta, /tus números son: 05 y 06/);
});

prueba("disponibilidad lista los 80 libres", () => {
    const r = sim.procesarMensaje(sim.crearEstadoInicial(), "¿Qué números quedan?");
    assert.strictEqual(r.tipo, "disponibilidad");
    assert.match(r.respuesta, /\(80\)/);
    assert.ok(!r.respuesta.includes(" 45,"));
});

prueba("consulta de un número específico no reserva", () => {
    const e = sim.crearEstadoInicial();
    const libre = sim.procesarMensaje(e, "¿El 23 está libre?");
    assert.strictEqual(libre.tipo, "numero_especifico");
    assert.match(libre.respuesta, /el 23 está disponible/);
    assert.strictEqual(libre.estado, e);
    assert.match(sim.procesarMensaje(e, "¿el 18 está libre?").respuesta, /el 18 ya está ocupado/);
});

prueba("fuera de rango, cantidades y mensajes sin intención", () => {
    const e = sim.crearEstadoInicial();
    assert.strictEqual(sim.procesarMensaje(e, "quiero el 123").tipo, "fuera_de_rango");
    const cantidad = sim.procesarMensaje(e, "quiero 3 números");
    assert.strictEqual(cantidad.tipo, "ayuda");
    assert.strictEqual(cantidad.estado, e);
    assert.strictEqual(sim.procesarMensaje(e, "hola").tipo, "ayuda");
});

prueba("máximo de números por mensaje", () => {
    const pedido = Array.from({ length: 15 }, (_, i) => 60 + i).join(" ");
    const r = sim.procesarMensaje(sim.crearEstadoInicial(), pedido);
    assert.ok(r.reservados.length <= sim.MAX_NUMEROS_POR_MENSAJE);
});

console.log("Configuración comercial");

prueba("cuatro planes con los precios y grupos aprobados", () => {
    const resumen = planes.PLANES.map((p) => [p.nombre, p.precioMensualCOP, p.maxGrupos]);
    assert.deepStrictEqual(resumen, [
        ["Esencial", 49999, 1],
        ["Profesional", 139999, 2],
        ["Avanzado", 299999, 5],
        ["Empresarial", 499999, 10]
    ]);
    assert.deepStrictEqual(planes.PLANES.filter((p) => p.recomendado).map((p) => p.id), ["profesional"]);
    assert.strictEqual(planes.DIAS_PRUEBA_GRATUITA, 7);
});

prueba("formato COP y texto de grupos", () => {
    assert.strictEqual(planes.formatearCOP(49999), "$49.999");
    assert.strictEqual(planes.formatearCOP(499999), "$499.999");
    assert.strictEqual(planes.formatearCOP(5000), "$5.000");
    assert.strictEqual(planes.textoGrupos(1), "1 grupo de WhatsApp");
    assert.strictEqual(planes.textoGrupos(5), "Hasta 5 grupos de WhatsApp");
});

prueba("los enlaces de solicitud son mailto a soporte@efaat.com", () => {
    const general = planes.enlaceSolicitud();
    assert.ok(general.startsWith("mailto:soporte@efaat.com?subject="));
    assert.match(decodeURIComponent(general), /prueba gratuita de 7 días/);
    assert.match(decodeURIComponent(planes.enlaceSolicitud(planes.PLANES[1])), /plan Profesional/);
});

console.log("Aislamiento");

prueba("la landing y la demo no usan Supabase, fetch ni el backend", () => {
    const archivos = [
        "app/page.tsx",
        "components/landing/Landing.tsx",
        "components/landing/demo/DemoSorteo.tsx",
        "components/landing/demo/simuladorDemo.ts",
        "lib/comercial/planes.ts"
    ];
    for (const a of archivos) {
        const fuente = fs.readFileSync(path.join(FRONT, a), "utf8")
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "");
        for (const prohibido of [/supabase/i, /\bfetch\s*\(/, /fetchConSesion/, /botApi/, /XMLHttpRequest/, /localStorage/, /\/api\//]) {
            assert.ok(!prohibido.test(fuente), `${a} contiene ${prohibido}`);
        }
    }
});

console.log(`\n${ok} pruebas superadas`);
