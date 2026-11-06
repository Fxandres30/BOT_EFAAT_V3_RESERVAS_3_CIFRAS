// ==========================================================================
// PRUEBAS (frontend) — rediseño del editor de Mensajes: biblioteca visual de
// variables, inserción, vista previa (mismo motor) y formato de WhatsApp.
//
// Carga los servicios TypeScript REALES transpilándolos con el TypeScript
// del proyecto (mismo cargador que visibilidadDatos.test.mjs). No usa red
// ni Supabase: "@/lib/supabase" se sustituye por un objeto vacío.
//
//     node frontend/tests/mensajes/editorVisual.test.mjs
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

function cargarTs(rutaAbs, cache = new Map()) {

    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;

    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });

    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);

    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase: {} };
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

const bib = cargarTs(SERV("bibliotecaVariables.ts"));
const { segmentarFormatoWhatsApp } = cargarTs(SERV("formatoWhatsApp.ts"));
const { aplicarPlantillaPreview } = cargarTs(SERV("aplicarPlantillaPreview.ts"));
const cat = cargarTs(SERV("catalogoVariablesGlobal.ts"));
const { TIPOS_MENSAJE } = cargarTs(SERV("tiposMensaje.ts"));
const { obtenerPlantillasBase } = cargarTs(SERV("plantillasBase.ts"));
const { PLANTILLAS_NUMEROS_PAGOS } = cargarTs(SERV("plantillasNumerosPagos.ts"));
const backend = require(path.join(RAIZ, "backend/bot/ai/plantillaMensaje.js"));

let ok = 0;
function prueba(nombre, fn) {
    fn();
    ok++;
    console.log("  ✔", nombre);
}

const SOPORTADOS = TIPOS_MENSAJE.filter((t) => t.soportado);
const tipo = (id) => TIPOS_MENSAJE.find((t) => t.id === id);

// Variable personalizada (fila de variables_globales) — dato de prueba.
const DINAMICA = cat.normalizarVariableDinamica({
    id: "v1", usuario_id: "u1", identificador: "saludo_casa", nombre_visible: "Saludo de la casa",
    tipo: "texto", singular: null, plural: null, valor: "¡Bienvenido!", categoria: "MENSAJES",
    descripcion: "Saludo fijo de la casa", ejemplo: "", activa: true
});

console.log("biblioteca de variables");

prueba("no se pierde ninguna variable: todo el catálogo + las propias de cada tipo + personalizadas", () => {
    for (const t of SOPORTADOS) {
        const claves = new Set(bib.construirBiblioteca(t, [DINAMICA]).map((e) => e.clave));
        for (const v of cat.CATALOGO_VARIABLES) assert.ok(claves.has(v.key), `${t.id}: falta ${v.key}`);
        for (const v of t.variables) {
            const canonica = cat.resolverClaveCanonica(v.variable)?.definicion.key;
            assert.ok(claves.has(v.variable) || claves.has(canonica), `${t.id}: falta ${v.variable}`);
        }
        assert.ok(claves.has("saludo_casa"), `${t.id}: falta la personalizada`);
    }
});

prueba("cada código insertado es reconocido por el catálogo (nunca «variable no reconocida»)", () => {
    for (const t of SOPORTADOS) {
        const texto = bib.construirBiblioteca(t, [DINAMICA]).map((e) => `{{${e.clave}}}`).join(" ");
        assert.deepStrictEqual(cat.extraerVariablesDesconocidas(texto, [DINAMICA]), [], t.id);
    }
});

prueba("nombres comprensibles, sin llaves, para las principales", () => {
    const b = bib.construirBiblioteca(tipo("reserva_completa"));
    const nombre = (k) => b.find((e) => e.clave === k).nombre;
    assert.strictEqual(nombre("cliente"), "Nombre del cliente");
    assert.strictEqual(nombre("numeros_reservados"), "Números reservados");
    assert.strictEqual(nombre("cantidad_reservados"), "Cantidad reservada");
    for (const e of b) assert.ok(!e.nombre.includes("{{"), e.clave);
});

prueba("principales de «Reserva completada»: las más usadas, en orden y sin palabras de concordancia", () => {
    const p = bib.variablesPrincipales(bib.construirBiblioteca(tipo("reserva_completa"))).map((e) => e.clave);
    for (const k of ["cliente", "telefono", "numeros_solicitados", "numeros_reservados", "cantidad_reservados", "evento", "premio", "fecha", "hora", "precio"]) {
        assert.ok(p.includes(k), `falta ${k}`);
    }
    assert.ok(p.indexOf("cliente") < p.indexOf("numeros_reservados"));
    assert.ok(!p.includes("tu_numero_tus_numeros"));
});

prueba("principales de pago incluyen los montos propios del tipo", () => {
    const p = bib.variablesPrincipales(bib.construirBiblioteca(tipo("consulta_pago_pago_parcial"))).map((e) => e.clave);
    for (const k of ["cliente", "monto_pendiente", "monto_pagado", "numeros_pagados"]) assert.ok(p.includes(k), k);
});

prueba("disponibilidad explicada: propia, según cantidad, puede quedar vacía, personalizada", () => {
    const b = bib.construirBiblioteca(tipo("reserva_completa"), [DINAMICA]);
    const d = (k) => b.find((e) => e.clave === k);
    assert.strictEqual(d("numeros_reservados").disponibilidad, "esta_respuesta");
    assert.strictEqual(d("es_son").disponibilidad, "segun_cantidad");
    assert.strictEqual(d("monto_pendiente").disponibilidad, "puede_vacia");
    assert.match(d("monto_pendiente").textoDisponibilidad, /consulta de pagos/);
    assert.strictEqual(d("saludo_casa").disponibilidad, "personalizada");
});

prueba("formas por conjunto del tipo (solo ocupados) aparecen como sugeridas", () => {
    const b = bib.construirBiblioteca(tipo("reserva_parcial"));
    const e = b.find((x) => x.clave === "ocupado_ocupados_ocupados");
    assert.ok(e, "falta ocupado_ocupados_ocupados");
    assert.strictEqual(e.grupo, bib.GRUPO_SUGERIDAS);
    assert.match(e.nombre, /solo ocupados/);
});

prueba("buscador: por nombre, por código, sin tildes y con llaves", () => {
    const b = bib.construirBiblioteca(tipo("reserva_completa"), [DINAMICA]);
    const claves = (q) => bib.buscarEnBiblioteca(b, q).map((e) => e.clave);
    assert.ok(claves("telefono").includes("telefono"));
    assert.ok(claves("Teléfono").includes("telefono"));
    assert.ok(claves("{{precio").includes("precio"));
    assert.ok(claves("pendiente").includes("monto_pendiente"));
    assert.ok(claves("saludo").includes("saludo_casa"));
    assert.deepStrictEqual(claves("zzzz-nada"), []);
    assert.strictEqual(bib.buscarEnBiblioteca(b, "  ").length, b.length);
});

prueba("agrupación: sugeridas primero, palabras según cantidad al final", () => {
    const g = bib.agruparBiblioteca(bib.construirBiblioteca(tipo("reserva_completa"))).map((x) => x.grupo);
    assert.strictEqual(g[0], bib.GRUPO_SUGERIDAS);
    assert.strictEqual(g[g.length - 1], bib.GRUPO_PALABRAS);
});

console.log("inserción y formato en el texto");

prueba("inserta en el cursor y separa de la palabra anterior", () => {
    assert.deepStrictEqual(bib.insertarEnTexto("Hola", 4, 4, "{{cliente}}"), { texto: "Hola {{cliente}}", cursor: 16 });
    assert.deepStrictEqual(bib.insertarEnTexto("Hola !", 5, 5, "{{cliente}}"), { texto: "Hola {{cliente}}!", cursor: 16 });
    assert.deepStrictEqual(bib.insertarEnTexto("", 0, 0, "{{cliente}}"), { texto: "{{cliente}}", cursor: 11 });
    // Reemplaza la selección.
    assert.strictEqual(bib.insertarEnTexto("Hola XX!", 5, 7, "{{cliente}}").texto, "Hola {{cliente}}!");
    // Tras signos de cierre sí; tras aperturas o un marcador que abre, no.
    assert.strictEqual(bib.insertarEnTexto("*Hola*", 6, 6, "{{cliente}}").texto, "*Hola* {{cliente}}");
    assert.strictEqual(bib.insertarEnTexto("Tus números:", 12, 12, "{{x}}").texto, "Tus números: {{x}}");
    assert.strictEqual(bib.insertarEnTexto("Hola *", 6, 6, "{{cliente}}").texto, "Hola *{{cliente}}");
    assert.strictEqual(bib.insertarEnTexto("*", 1, 1, "{{cliente}}").texto, "*{{cliente}}");
    assert.strictEqual(bib.insertarEnTexto("¡", 1, 1, "{{cliente}}").texto, "¡{{cliente}}");
    assert.strictEqual(bib.insertarEnTexto("(", 1, 1, "{{x}}").texto, "({{x}}");
    assert.strictEqual(bib.insertarEnTexto("a\n", 2, 2, "{{x}}").texto, "a\n{{x}}");
    // Emoji: sin espacio forzado.
    assert.strictEqual(bib.insertarEnTexto("Listo", 5, 5, "🎉", false).texto, "Listo🎉");
});

prueba("negrita/cursiva/tachado envuelven la selección sin tocar los espacios", () => {
    assert.strictEqual(bib.envolverSeleccion("hola mundo", 5, 10, "*").texto, "hola *mundo*");
    assert.strictEqual(bib.envolverSeleccion("hola mundo ", 4, 11, "_").texto, "hola _mundo_ ");
    const vacio = bib.envolverSeleccion("ab", 1, 1, "~");
    assert.deepStrictEqual(vacio, { texto: "a~~b", inicio: 2, fin: 2 });
});

prueba("variables usadas y contenido legible para la lista", () => {
    const t = "Hola {{cliente}}, {{numeros_reservados}} {{valor}} {{cliente|upper}} {{inventada}}";
    const usadas = bib.variablesUsadas(t, [], tipo("reserva_completa"));
    assert.deepStrictEqual(usadas.map((u) => u.clave), ["cliente", "numeros_reservados", "valor", "inventada"]);
    assert.strictEqual(usadas.find((u) => u.clave === "valor").nombre, "Precio por número");
    assert.strictEqual(usadas.find((u) => u.clave === "inventada").conocida, false);
    assert.strictEqual(
        bib.contenidoLegible("Hola {{cliente}}: {{numeros_reservados}}"),
        "Hola [Nombre del cliente]: [Números reservados]"
    );
});

console.log("vista previa");

prueba("1 número y varios números con el mismo motor de vista previa", () => {
    const t = tipo("reserva_completa");
    const plantilla = "Hola {{cliente}}, {{tu_numero_tus_numeros}} {{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}}";
    const uno = aplicarPlantillaPreview(plantilla, t.ejemploSingular, {}, []);
    const varios = aplicarPlantillaPreview(plantilla, t.ejemploPlural, {}, []);
    assert.strictEqual(uno, "Hola Carlos, tu número ( 45 ) quedó reservado");
    assert.strictEqual(varios, "Hola Carlos, tus números ( 27 - 45 ) quedaron reservados");
});

prueba("vista previa = backend para cada principal insertada desde la biblioteca", () => {
    for (const t of SOPORTADOS) {
        const principales = bib.variablesPrincipales(bib.construirBiblioteca(t));
        const plantilla = principales.map((e) => `*${e.nombre}:* {{${e.clave}}}`).join("\n");
        // Mismos datos para ambos lados (con hora ya en 12h, como la entrega
        // el backend). Las globales no incluidas en el ejemplo usan el valor
        // de ejemplo del catálogo en el panel; se completan para comparar.
        const datos = {};
        for (const e of principales) {
            const def = cat.resolverClaveCanonica(e.clave)?.definicion;
            datos[def?.key || e.clave] = (t.ejemplo[e.clave] ?? def?.example ?? "");
        }
        const panel = aplicarPlantillaPreview(plantilla, datos.hora ? { ...datos, hora: "22:30" } : datos, {}, []);
        const real = backend.aplicarPlantilla(plantilla, datos.hora ? { ...datos, hora: "10:30 PM" } : datos, {});
        assert.strictEqual(panel, real, t.id);
    }
});

prueba("plantillas antiguas y sugeridas: sin códigos desconocidos y con vista previa", () => {
    let revisadas = 0;
    for (const t of SOPORTADOS) {
        const todas = [
            ...obtenerPlantillasBase(t.id).map((p) => p.contenido),
            ...(PLANTILLAS_NUMEROS_PAGOS[t.id] || []).map((p) => p.contenido)
        ];
        // «Personalizada» se siembra vacía a propósito.
        for (const contenido of todas.filter((c) => c && c.trim())) {
            assert.deepStrictEqual(cat.extraerVariablesDesconocidas(contenido), [], `${t.id}: ${contenido}`);
            const previa = aplicarPlantillaPreview(contenido, t.ejemploPlural || t.ejemplo, {}, []);
            assert.ok(previa && !previa.includes("{{"), `${t.id}: ${contenido}`);
            assert.ok(!bib.contenidoLegible(contenido, [], t).includes("{{"));
            revisadas++;
        }
    }
    assert.ok(revisadas > 100, `solo ${revisadas} plantillas revisadas`);
});

console.log("formato de WhatsApp");

const plano = (segs) => segs.map((s) => {
    let t = s.texto;
    if (s.mono) t = `<m>${t}</m>`;
    if (s.tachado) t = `<s>${t}</s>`;
    if (s.cursiva) t = `<i>${t}</i>`;
    if (s.negrita) t = `<b>${t}</b>`;
    return t;
}).join("");

prueba("negrita, cursiva, tachado, monoespaciado y combinaciones", () => {
    assert.strictEqual(plano(segmentarFormatoWhatsApp("Hola *Carlos* ya")), "Hola <b>Carlos</b> ya");
    assert.strictEqual(plano(segmentarFormatoWhatsApp("_hoy_ y ~ayer~")), "<i>hoy</i> y <s>ayer</s>");
    assert.strictEqual(plano(segmentarFormatoWhatsApp("*_ambos_*")), "<b><i>ambos</i></b>");
    assert.strictEqual(plano(segmentarFormatoWhatsApp("```*sin formato*```")), "<m>*sin formato*</m>");
});

prueba("no aplica formato donde WhatsApp tampoco lo aplica", () => {
    for (const t of ["5 * 3 = 15", "a*b*c", "* lista", "*abierto", "*sin\ncierre*", "precio_total_final", "** vacío"]) {
        assert.strictEqual(plano(segmentarFormatoWhatsApp(t)), t, t);
    }
    assert.deepStrictEqual(segmentarFormatoWhatsApp(""), []);
});

prueba("conserva el texto completo (emojis y saltos de línea)", () => {
    const t = "🎉 *¡Listo, Carlos!*\nTus números: ( 27 - 45 ) ✅\n_Gracias_";
    assert.strictEqual(segmentarFormatoWhatsApp(t).map((s) => s.texto).join(""), t.replace(/[*_]/g, ""));
});

console.log(`\n${ok} pruebas OK`);
