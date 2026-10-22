// ==========================================================================
// PRUEBAS (frontend) — "Datos a mostrar" del editor de respuestas.
//
//   1. Cada casilla del editor (tiposMensaje.ts: mostrarCampo) es la MISMA
//      bandera que el backend usa para ocultar esa variable.
//   2. La vista previa (aplicarPlantillaPreview.ts) da el mismo texto que el
//      backend REAL (backend/bot/ai/plantillaMensaje.js) con los mismos
//      datos y casillas: lo que ve el admin es lo que se envía.
//   3. Guardar y volver a abrir: las casillas se guardan tal cual en
//      plantillas_mensaje.variables y se recuperan (Supabase en memoria).
//   4. El editor pinta cada casilla con el criterio del backend.
//
//     node frontend/tests/mensajes/visibilidadDatos.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAIZ = path.resolve(FRONT, "..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// ------------------------------------------------------- Supabase (fake) ---

const db = { plantillas_mensaje: [] };
let secuencia = 0;

const supabase = {
    from(tabla) {
        const filtros = [];
        let operacion = "select";
        let datos = null;
        let unico = false;
        const b = {
            select() { return b; },
            insert(x) { operacion = "insert"; datos = x; return b; },
            update(x) { operacion = "update"; datos = x; return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            order() { return b; },
            single() { unico = true; return b; },
            then(ok, ko) {
                const filas = db[tabla];
                const coinciden = filas.filter(f => filtros.every(([c, v]) => f[c] === v));
                let res;
                if (operacion === "insert") {
                    // JSON: lo que guarda y devuelve la columna jsonb.
                    const nueva = JSON.parse(JSON.stringify({ id: `id-${++secuencia}`, ...datos }));
                    filas.push(nueva);
                    res = { data: nueva, error: null };
                } else if (operacion === "update") {
                    coinciden.forEach(f => Object.assign(f, JSON.parse(JSON.stringify(datos))));
                    res = { data: unico ? coinciden[0] : coinciden, error: null };
                } else {
                    res = { data: JSON.parse(JSON.stringify(coinciden)), error: null };
                }
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

// ------------------------------------------------- cargador de módulos TS ---

function cargarTs(rutaAbs, cache = new Map()) {

    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;

    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });

    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);

    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase };
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) {
            if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        }
        return require(spec);
    };

    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);

    return modulo.exports;

}

const SERV = (p) => path.join(FRONT, "services/mensajes", p);

const { aplicarPlantillaPreview, quitarEmojis, datoVisible } = cargarTs(SERV("aplicarPlantillaPreview.ts"));
const plantillas = cargarTs(SERV("plantillas.ts"));
const { TIPOS_MENSAJE } = cargarTs(SERV("tiposMensaje.ts"));
const backend = require(path.join(RAIZ, "backend/bot/ai/plantillaMensaje.js"));

// --------------------------------------------------------------- pruebas ---

let ok = 0;
async function prueba(nombre, fn) {
    await fn();
    ok++;
    console.log("  ✔", nombre);
}

console.log("visibilidad de datos");

await prueba("cada casilla del editor es la bandera que el backend usa para ESA variable", () => {
    const vistas = new Map();
    for (const tipo of TIPOS_MENSAJE) {
        for (const v of tipo.variables) {
            if (!v.mostrarCampo) continue;
            assert.strictEqual(backend.MOSTRAR_POR_VARIABLE[v.variable], v.mostrarCampo, `${tipo.id}: ${v.variable}`);
            vistas.set(v.mostrarCampo, v.etiqueta);
        }
    }
    for (const etiqueta of ["Nombre del cliente", "Nombre del evento", "Números solicitados", "Números reservados", "Fecha del evento", "Hora del evento", "Precio por número"]) {
        assert.ok([...vistas.values()].includes(etiqueta), `casilla «${etiqueta}»`);
    }
});

// Datos con hora en 24h (la vista previa y el backend la pasan a 12h).
const DATOS = {
    cliente: "Ana 🌸", evento: "Lotería De Manizales", numeros_solicitados: "( 05 - 12 )", numeros_reservados: "( 05 )",
    fecha: "2026-10-25", hora: "22:30", precio: "3000"
};
const PLANTILLA = "🎉 Hola {{cliente}}\nEvento: {{evento|upper}} 🎲\nPediste {{numeros_solicitados}}, quedó {{numeros_reservados}} ✅\n{{fecha}} {{hora}} · {{precio}} / {{valor}}";
const CAMPOS = ["mostrar_nombre", "mostrar_evento", "mostrar_numeros_solicitados", "mostrar_numeros_reservados", "mostrar_fecha", "mostrar_hora", "mostrar_precio", "emojis"];

// El backend recibe la hora ya en 12h desde construirVariables; aquí se
// compara solo la sustitución, así que se le da el mismo valor ya formateado.
const backendCon = (mostrar) => backend.aplicarPlantilla(PLANTILLA, { ...DATOS, hora: "10:30 PM" }, mostrar);

await prueba("vista previa = mensaje del backend, activando y desactivando cada opción", () => {
    const casos = [{}, null, Object.fromEntries(CAMPOS.map(c => [c, true]))];
    for (const c of CAMPOS) casos.push({ [c]: false }, { [c]: true });
    casos.push(Object.fromEntries(CAMPOS.map(c => [c, false])));
    for (const mostrar of casos) {
        const previa = aplicarPlantillaPreview(PLANTILLA, DATOS, mostrar || {});
        assert.strictEqual(previa, backendCon(mostrar || {}), JSON.stringify(mostrar));
    }
});

await prueba("vista previa: cada opción quita solo su dato y al reactivarla vuelve", () => {
    const completo = aplicarPlantillaPreview(PLANTILLA, DATOS, {});
    assert.ok(completo.includes("Ana 🌸") && completo.includes("LOTERÍA DE MANIZALES") && completo.includes("10:30 PM") && completo.includes("3000 / 3000"));
    const sinPrecio = aplicarPlantillaPreview(PLANTILLA, DATOS, { mostrar_precio: false });
    assert.ok(sinPrecio.endsWith("10:30 PM ·  / "), "precio y su alias {{valor}} fuera");
    assert.ok(sinPrecio.includes("Ana 🌸") && sinPrecio.includes("2026-10-25"));
    assert.strictEqual(aplicarPlantillaPreview(PLANTILLA, DATOS, { mostrar_precio: true }), completo);
    const sinEmojis = aplicarPlantillaPreview(PLANTILLA, DATOS, { emojis: false });
    assert.ok(sinEmojis.startsWith("Hola Ana 🌸\nEvento: LOTERÍA DE MANIZALES\n"), sinEmojis);
    assert.ok(!sinEmojis.includes("✅"));
    assert.strictEqual(quitarEmojis("Listo ✅"), backend.quitarEmojis("Listo ✅"));
});

await prueba("variables globales dinámicas siguen resolviendo en la vista previa", () => {
    const extra = [{ key: "despedida", aliases: [], categoria: "PERSONALIZADA", description: "", example: "Suerte 🍀", requires: [], type: "texto", estado: "NUEVA", dinamica: true }];
    assert.strictEqual(aplicarPlantillaPreview("{{despedida}} 🎉", {}, { emojis: false }, extra), "Suerte 🍀");
    assert.strictEqual(aplicarPlantillaPreview("{{despedida}} 🎉", {}, { mostrar_nombre: false }, extra), "Suerte 🍀 🎉");
});

await prueba("datoVisible: mismo criterio que el backend (solo false oculta)", () => {
    assert.strictEqual(datoVisible({ mostrar_fecha: false }, "mostrar_fecha"), false);
    assert.strictEqual(datoVisible({ mostrar_fecha: true }, "mostrar_fecha"), true);
    assert.strictEqual(datoVisible({}, "mostrar_fecha"), true);
    assert.strictEqual(datoVisible(null, "mostrar_fecha"), true);
});

await prueba("guardar y volver a abrir: las casillas se conservan; el resto de la plantilla no cambia", async () => {
    db.plantillas_mensaje = [];
    const { data: creada } = await plantillas.crearPlantilla({
        usuario_id: "A", tipo_respuesta: "reserva_completa", nombre: "P", estilo: "x",
        contenido: PLANTILLA, variables: plantillas.valoresPorDefectoVariables(), habilitada: true, orden: 0
    });
    for (const campo of CAMPOS) {
        for (const valor of [false, true]) {
            const antes = (await plantillas.listarPlantillas("A", "reserva_completa")).data[0];
            const variables = { ...antes.variables, [campo]: valor };
            await plantillas.actualizarPlantilla(creada.id, { nombre: antes.nombre, estilo: antes.estilo, contenido: antes.contenido, variables });
            const despues = (await plantillas.listarPlantillas("A", "reserva_completa")).data[0];
            assert.deepStrictEqual(despues.variables, variables, `${campo}=${valor}`);
            assert.strictEqual(despues.contenido, PLANTILLA);
        }
    }
});

await prueba("editor: casillas con datoVisible, sin rellenar con valores por defecto lo no guardado", () => {
    const editor = fs.readFileSync(path.join(FRONT, "components/mensajes/EditorMensaje/EditorMensaje.tsx"), "utf8");
    assert.ok(editor.includes("checked={datoVisible(variables as Record<string, boolean>, v.mostrarCampo)}"));
    assert.ok(editor.includes("checked={variables.emojis !== false}"));
    assert.strictEqual((editor.match(/plantilla\.variables \|\| \{\}/g) || []).length, 2);
    assert.ok(!editor.includes("valoresPorDefectoVariables"));
    // La vista previa recibe las MISMAS casillas que se guardan.
    assert.strictEqual((editor.match(/variables as Record<string, boolean>, variablesDinamicas\)/g) || []).length, 3);
});

console.log(`\n${ok} pruebas OK`);
