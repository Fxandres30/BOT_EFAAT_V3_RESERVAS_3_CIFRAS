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

prueba("reserva completa de dos números libres, con reacción ✅", () => {
    const e = sim.crearEstadoInicial();
    const r = sim.procesarMensaje(e, "Me anotas el 23 y el 46");
    assert.strictEqual(r.tipo, "reserva_completa");
    assert.deepStrictEqual(r.reservados, [23, 46]);
    assert.strictEqual(r.reaccion, "✅");
    assert.match(r.respuesta, /23 y 46 quedaron reservados/);
    assert.deepStrictEqual(sim.numerosDe(r.estado, "Camila"), [23, 46]);
});

prueba("la función es pura: no modifica el estado recibido", () => {
    const e = sim.crearEstadoInicial();
    const copia = [...e];
    sim.procesarMensaje(e, "quiero el 10");
    assert.deepStrictEqual([...e], copia);
});

prueba("reserva parcial: uno libre y uno ocupado, sin reacción", () => {
    const r = sim.procesarMensaje(sim.crearEstadoInicial(), "me das el 23 y el 45");
    assert.strictEqual(r.tipo, "reserva_parcial");
    assert.deepStrictEqual(r.reservados, [23]);
    assert.strictEqual(r.reaccion, null);
    assert.match(r.respuesta, /23 quedó reservado\. 45 ya estaba ocupado\./);
});

prueba("reserva parcial con un número que ya era propio, sin reacción", () => {
    const e = sim.procesarMensaje(sim.crearEstadoInicial(), "el 23").estado;
    const r = sim.procesarMensaje(e, "el 23 y el 24");
    assert.strictEqual(r.tipo, "reserva_parcial");
    assert.deepStrictEqual(r.reservados, [24]);
    assert.strictEqual(r.reaccion, null);
    assert.match(r.respuesta, /24 quedó reservado\. 23 ya era tuyo\./);
});

prueba("número ocupado (singular) y todos ocupados (plural), con reacción ❌", () => {
    const uno = sim.procesarMensaje(sim.crearEstadoInicial(), "el 45 por favor");
    assert.strictEqual(uno.tipo, "numero_ocupado");
    assert.strictEqual(uno.reaccion, "❌");
    assert.match(uno.respuesta, /el número 45 ya está ocupado/);
    const varios = sim.procesarMensaje(sim.crearEstadoInicial(), "03 y 07");
    assert.strictEqual(varios.tipo, "todos_ocupados");
    assert.strictEqual(varios.reaccion, "❌");
    assert.match(varios.respuesta, /03 y 07 ya estaban ocupados/);
});

prueba("ocupado + uno propio: no son TODOS ocupados, sin reacción", () => {
    const e = sim.procesarMensaje(sim.crearEstadoInicial(), "el 23").estado;
    const r = sim.procesarMensaje(e, "el 23 y el 45");
    assert.strictEqual(r.reaccion, null);
    assert.strictEqual(r.estado, e);
});

prueba("pedir un número propio no lo duplica", () => {
    const e = sim.procesarMensaje(sim.crearEstadoInicial(), "el 23").estado;
    const r = sim.procesarMensaje(e, "el 23");
    assert.strictEqual(r.tipo, "ya_era_tuyo");
    assert.strictEqual(r.reaccion, null);
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

prueba("las consultas se limitan a los números propios: disponibilidad general no se responde", () => {
    const e = sim.crearEstadoInicial();
    for (const pregunta of ["¿Qué números quedan?", "cuales hay disponibles", "¿El 23 está libre?", "¿el 18 está libre?"]) {
        const r = sim.procesarMensaje(e, pregunta);
        assert.strictEqual(r.tipo, "consulta_general", pregunta);
        assert.strictEqual(r.estado, e, `${pregunta} no debe reservar`);
        assert.strictEqual(r.reaccion, null);
        assert.match(r.respuesta, /tus propios números/);
        assert.ok(!/\d{2}/.test(r.respuesta), `${pregunta} no debe listar números`);
    }
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

prueba("los enlaces de solicitud son mailto a contacto@efaat.com", () => {
    const general = planes.enlaceSolicitud();
    assert.ok(general.startsWith("mailto:contacto@efaat.com?subject="));
    assert.match(decodeURIComponent(general), /prueba gratuita de 7 días/);
    assert.match(decodeURIComponent(planes.enlaceSolicitud(planes.PLANES[1])), /plan Profesional/);
});

console.log("Textos comerciales");

const textoLanding = ["app/page.tsx", "components/landing/Landing.tsx", "components/landing/demo/DemoSorteo.tsx"]
    .map((a) => fs.readFileSync(path.join(FRONT, a), "utf8"))
    .join("\n")
    // Solo el texto visible: los comentarios explican las reglas y las nombran.
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

prueba("reacciones descritas como ✅ todos reservados, ❌ todos ocupados, ninguna si es parcial", () => {
    assert.match(textoLanding, /✅ cuando se reservan todos los números pedidos/);
    assert.match(textoLanding, /❌ cuando todos estaban ocupados/);
    assert.match(textoLanding, /si la reserva es parcial, no reacciona/);
    assert.ok(!textoLanding.includes("👍"));
});

prueba("no se anuncian consultas de disponibilidad general", () => {
    assert.ok(!/consultas? de disponibilidad/i.test(textoLanding));
    assert.ok(!/qué números quedan/i.test(textoLanding));
    assert.match(textoLanding, /Consulta de números propios/);
});

prueba("sticker de pago: en verificación y sin consultar bancos", () => {
    assert.match(textoLanding, /Confirmación de pagos con sticker/);
    assert.match(textoLanding, /Está en verificación/);
    assert.match(textoLanding, /No consulta bancos/);
    assert.ok(!/Confirmación automática de pagos/.test(textoLanding));
});

prueba("prueba gratuita como solicitud pendiente, sin activación inmediata", () => {
    assert.match(textoLanding, /queda pendiente/);
    assert.ok(!/habilitamos/i.test(textoLanding));
    assert.ok(!/Probar gratis/.test(textoLanding));
    assert.match(textoLanding, /no activa nada de inmediato/);
    assert.ok(!/(activación|acceso) inmediat/i.test(textoLanding));
});

prueba("no se anuncian pagos Android ni control de inactividad", () => {
    assert.ok(!/android/i.test(textoLanding));
    assert.ok(!/inactividad|inactivos?/i.test(textoLanding));
    assert.ok(!/lector de pagos/i.test(textoLanding));
});

console.log("Conexión de WhatsApp");

prueba("recomendaciones de conexión: número dedicado y administrador marcados como esenciales", () => {
    assert.match(textoLanding, /Recomendaciones para conectar WhatsApp correctamente/);
    const landing = fs.readFileSync(path.join(FRONT, "components/landing/Landing.tsx"), "utf8");
    const esenciales = [...landing.matchAll(/titulo: "([^"]+)",\s*texto: "[^"]*",\s*esencial: true/g)].map((m) => m[1]);
    assert.deepStrictEqual(esenciales, ["Utiliza un número dedicado para EFAAT", "Haz administrador al número conectado"]);
    assert.match(textoLanding, /Mantén activa y estable la conexión/);
    assert.match(textoLanding, /Ser administrador no garantiza por sí solo/);
});

prueba("administración de conexiones sin prometer respaldo automático ni sesiones simultáneas", () => {
    assert.match(textoLanding, /Administra tus conexiones desde el panel/);
    assert.match(textoLanding, /una sola sesión a la\s+vez/);
    assert.match(textoLanding, /no forma parte de las funciones garantizadas/);
    assert.ok(!/simultáne/i.test(textoLanding));
    assert.ok(!/(cambia|pasa|conmuta)[a-z]* automáticamente/i.test(textoLanding));
    assert.ok(!/todas las funciones (administrativas|de administrador)/i.test(textoLanding));
});

prueba("preguntas frecuentes de conexión", () => {
    for (const p of [
        "¿Necesito conectar mi WhatsApp?",
        "¿Por qué mi número debe ser administrador?",
        "¿Puedo conectar más de un número?",
        "¿Qué pasa si WhatsApp desconecta mi número?",
        "¿Puedo eliminar una conexión desde el panel?"
    ]) {
        assert.ok(textoLanding.includes(`p: "${p}"`), p);
    }
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
