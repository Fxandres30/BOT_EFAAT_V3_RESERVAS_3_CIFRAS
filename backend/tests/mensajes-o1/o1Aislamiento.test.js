// ==========================================================================
// FASE O1 — garantías ESTÁTICAS de aislamiento:
//   1. shared/mensajes no importa nada de fuera de su carpeta salvo módulos
//      propios de Node (ni bot/, automation/, sorteos/, services/, lib/,
//      send.js, Supabase ni dependencias nuevas).
//   2. Ningún archivo de producción importa shared/mensajes todavía
//      (solo las pruebas de O1): ningún motor está conectado.
//
//     node backend/tests/mensajes-o1/o1Aislamiento.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { builtinModules } = require("module");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

const RAIZ = path.resolve(__dirname, "../..");
const NUCLEO = path.join(RAIZ, "shared/mensajes");

function archivos(dir, filtro = () => true) {
    const salida = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (["node_modules", ".next", "tests", "supabase_migrations"].includes(e.name)) continue;
            salida.push(...archivos(p, filtro));
        } else if (filtro(p)) salida.push(p);
    }
    return salida;
}

const requires = (texto) => [...texto.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(m => m[1]);

prueba("AI1 el núcleo solo importa archivos de su propia carpeta y módulos propios de Node", () => {
    const nucleo = archivos(NUCLEO, p => p.endsWith(".js"));
    assert.ok(nucleo.length >= 8, `archivos del núcleo: ${nucleo.length}`);
    for (const f of nucleo) {
        for (const destino of requires(fs.readFileSync(f, "utf8"))) {
            if (destino.startsWith(".")) {
                const resuelto = path.resolve(path.dirname(f), destino);
                assert.ok(resuelto.startsWith(NUCLEO), `${path.relative(RAIZ, f)} importa fuera del núcleo: ${destino}`);
            } else {
                assert.ok(builtinModules.includes(destino.replace(/^node:/, "")), `${path.relative(RAIZ, f)} importa un paquete: ${destino}`);
            }
        }
    }
});

// Puntos de integración AUTORIZADOS, fase por fase. Cualquier otro archivo
// de producción que importe el núcleo hace fallar esta prueba.
//   O2: Inicio del día en modo sombra.
const INTEGRACIONES_AUTORIZADAS = ["automation/sombraInicioDia.js"];

prueba("AI2 solo los puntos de integración autorizados importan shared/mensajes (O2: Inicio del día en sombra)", () => {
    const produccion = archivos(RAIZ, p => p.endsWith(".js") && !p.startsWith(NUCLEO) && !path.basename(p).startsWith("_"));
    const conectados = produccion.filter(f => /shared[\\/]+mensajes|shared\/mensajes/.test(fs.readFileSync(f, "utf8")));
    assert.deepStrictEqual(conectados.map(f => path.relative(RAIZ, f).split(path.sep).join("/")).sort(), INTEGRACIONES_AUTORIZADAS);
});

prueba("AI3 el núcleo no menciona send.js ni lib/supabase en ningún require", () => {
    for (const f of archivos(NUCLEO, p => p.endsWith(".js"))) {
        const texto = fs.readFileSync(f, "utf8");
        assert.ok(!requires(texto).some(d => /send|supabase|baileys/i.test(d)), path.relative(RAIZ, f));
    }
});

ejecutar("O1 · Aislamiento del núcleo");
