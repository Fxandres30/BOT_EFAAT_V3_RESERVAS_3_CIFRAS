// ==========================================================================
// PRUEBAS (frontend) — Biblioteca de mensajes de automatización sin
// categorías y con «Inicio del día» integrado.
//
// Reglas puras (services/mensajes/bibliotecaAutomatizacion.ts) + garantías
// estáticas de los componentes y del acceso a datos: nunca se pierde ni se
// mueve un mensaje, la categoría guardada no se toca, cada tipo se guarda en
// su propia tabla. Sin red.
//
//     node frontend/tests/mensajes/bibliotecaAutomatizacion.test.mjs
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
    const requerir = (id) => id.startsWith(".") ? cargarTs(path.resolve(path.dirname(rutaAbs), `${id}.ts`)) : require(id);
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const B = cargarTs(path.join(FRONT, "services/mensajes/bibliotecaAutomatizacion.ts"));
const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

let total = 0;
let fallidas = 0;
function prueba(nombre, fn) {
    total++;
    try { fn(); console.log(`✅ ${nombre}`); } catch (err) { fallidas++; console.log(`❌ ${nombre}\n   ${err.message}`); }
}

const CATEGORIAS = ["eleccion", "escasez", "humor", "competencia", "tiempo", "curiosidad", "accion", "urgencia", "familiar", "movimiento"];
const TIPOS_AUTO = ["OPEN_MESSAGE", "REMINDER_MESSAGE", "UPDATE_MESSAGE", "CLOSE_MESSAGE"];
const A = "cliente-A";

// Los 100 ejemplos: 10 categorías × 10, 25 por tipo (como mensajesEjemplo.ts).
const CIEN = Array.from({ length: 100 }, (_, i) => ({
    id: `m-${i}`, usuario_id: A, nombre_interno: `Ejemplo: ${i}`, texto: `Texto {nombre_evento} ${i}`,
    tipo: TIPOS_AUTO[i % 4], categoria: CATEGORIAS[Math.floor(i / 10)], activo: i % 7 !== 0, orden: 0,
    creado_en: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
}));
const INICIO = [
    { id: "p-1", usuario_id: A, tipo_respuesta: "inicio_dia", nombre: "Inicio del día — cálido", contenido: "☀️ Buenos días {{evento}}", habilitada: true, orden: 0, created_at: "2026-01-02T00:00:00Z", variables: {} },
    { id: "p-2", usuario_id: A, tipo_respuesta: "inicio_dia", nombre: "Inicio del día — corto", contenido: "☀️ ¡Buenos días!", habilitada: false, orden: 1, created_at: "2026-01-03T00:00:00Z", variables: {} }
];
const GLOBAL = { id: "g-1", usuario_id: null, nombre_interno: "De EFAAT", texto: "Abrimos {nombre_evento}", tipo: "OPEN_MESSAGE", categoria: null, activo: true, creado_en: "2026-01-01T00:00:00Z" };

const todos = () => [...CIEN.map(B.desdeAutomatizacion), ...INICIO.map(B.desdeInicioDia), B.desdeAutomatizacion(GLOBAL)];

// ================================================================= tipos ===

prueba("BT1 cinco tipos en el orden del día; los cuatro de automation_messages conservan sus ids", () => {
    assert.deepStrictEqual(B.TIPOS_BIBLIOTECA.map((t) => t.id), ["inicio_dia", ...TIPOS_AUTO]);
    assert.deepStrictEqual(B.TIPOS_BIBLIOTECA.map((t) => t.label), ["Inicio del día", "Apertura", "Recordatorio", "Actualización", "Cierre"]);
    assert.deepStrictEqual(B.TIPOS_BIBLIOTECA.map((t) => t.origen), ["inicio_dia", "automatizacion", "automatizacion", "automatizacion", "automatizacion"]);
    assert.strictEqual(B.esTipoBiblioteca("humor"), false);
});

// ============================================================ conservación ===

prueba("BT2 las 100 plantillas de ejemplo + Inicio del día + las de EFAAT aparecen TODAS, sin cambiar ids ni filas", () => {
    const lista = B.filtrarYOrdenar(todos());
    assert.strictEqual(lista.length, 103);
    assert.deepStrictEqual(new Set(lista.map((m) => m.id)), new Set([...CIEN.map((m) => m.id), "p-1", "p-2", "g-1"]));
    const m7 = lista.find((m) => m.id === "m-7");
    assert.strictEqual(m7.fila, CIEN[7], "la fila original se conserva intacta (incluida su categoría)");
    assert.strictEqual(m7.fila.categoria, "eleccion");
    assert.strictEqual(m7.texto, "Texto {nombre_evento} 7", "las variables dinámicas no se tocan");
});

prueba("BT3 Inicio del día se mapea desde plantillas_mensaje (nombre, contenido, habilitada) con su id real", () => {
    const m = B.desdeInicioDia(INICIO[0]);
    assert.deepStrictEqual([m.id, m.origen, m.tipo, m.nombre, m.texto, m.activo, m.clave], ["p-1", "inicio_dia", "inicio_dia", "Inicio del día — cálido", "☀️ Buenos días {{evento}}", true, "inicio_dia:p-1"]);
    assert.strictEqual(m.fila, INICIO[0]);
});

prueba("BT4 claves únicas aunque un id coincida entre tablas", () => {
    const a = B.desdeAutomatizacion({ ...GLOBAL, id: "x" });
    const b = B.desdeInicioDia({ ...INICIO[0], id: "x" });
    assert.notStrictEqual(a.clave, b.clave);
});

// ================================================================ filtros ===

prueba("BT5 filtro por tipo: Inicio del día solo trae sus plantillas; cada tipo, sus 25", () => {
    assert.deepStrictEqual(B.filtrarYOrdenar(todos(), { tipo: "inicio_dia" }).map((m) => m.id), ["p-2", "p-1"]);
    for (const t of TIPOS_AUTO) {
        const extra = t === "OPEN_MESSAGE" ? 1 : 0;
        assert.strictEqual(B.filtrarYOrdenar(todos(), { tipo: t }).length, 25 + extra, t);
    }
});

prueba("BT6 filtro por estado (activos / inactivos / todos)", () => {
    const lista = todos();
    const activos = B.filtrarYOrdenar(lista, { estado: "activos" });
    const inactivos = B.filtrarYOrdenar(lista, { estado: "inactivos" });
    assert.ok(activos.every((m) => m.activo) && inactivos.every((m) => !m.activo));
    assert.strictEqual(activos.length + inactivos.length, lista.length);
    assert.deepStrictEqual(B.resumen(lista), { total: 103, activos: activos.length, inactivos: inactivos.length });
});

prueba("BT7 orden: por tipo (Inicio del día primero) y, dentro de cada tipo, del más reciente al más antiguo; un tipo desconocido va al final sin perderse", () => {
    const raro = B.desdeAutomatizacion({ ...GLOBAL, id: "raro", tipo: "OTRO_TIPO" });
    const lista = B.filtrarYOrdenar([raro, ...todos()]);
    assert.strictEqual(lista[0].tipo, "inicio_dia");
    assert.strictEqual(lista.at(-1).id, "raro");
    const aperturas = lista.filter((m) => m.tipo === "OPEN_MESSAGE").map((m) => m.fecha);
    assert.deepStrictEqual(aperturas, [...aperturas].sort().reverse());
});

prueba("BT8 qué fuentes se leen según el filtro", () => {
    assert.deepStrictEqual(B.fuentesParaFiltro(""), { automatizacion: true, inicioDia: true });
    assert.deepStrictEqual(B.fuentesParaFiltro("inicio_dia"), { automatizacion: false, inicioDia: true });
    assert.deepStrictEqual(B.fuentesParaFiltro("CLOSE_MESSAGE"), { automatizacion: true, inicioDia: false });
});

// ================================================================ edición ===

prueba("BT9 un mensaje guardado solo cambia de tipo dentro de su tabla (nunca se mueve de tabla)", () => {
    assert.deepStrictEqual(B.tiposEditables("inicio_dia").map((t) => t.id), ["inicio_dia"]);
    assert.deepStrictEqual(B.tiposEditables("REMINDER_MESSAGE").map((t) => t.id), TIPOS_AUTO);
    assert.strictEqual(B.tiposEditables(null).length, 5);
});

prueba("BT10 variables según el motor: {x} para automatización, {{x}} para Inicio del día", () => {
    assert.ok(B.variablesDeTipo("OPEN_MESSAGE").every((v) => /^\{[a-z_]+\}$/.test(v.variable)));
    assert.ok(B.variablesDeTipo("OPEN_MESSAGE").some((v) => v.variable === "{nombre_evento}"));
    assert.ok(B.variablesDeTipo("inicio_dia").every((v) => /^\{\{[a-z_]+\}\}$/.test(v.variable)));
});

// ===================================================== garantías estáticas ===

prueba("BT11 la biblioteca ya no muestra ni pide categorías (filtros, formulario, tarjetas)", () => {
    for (const rel of ["components/mensajes/MensajesAutomatizacion/MensajesAutomatizacion.tsx", "components/mensajes/MensajesAutomatizacion/MensajeModal.tsx", "components/mensajes/MensajesAutomatizacion/MensajeCard.tsx"]) {
        const fuente = leer(rel);
        assert.ok(!/CATEGORIAS_AUTOMATIZACION|nombreCategoria|label="Categoría"|filtroCategoria/.test(fuente), rel);
    }
});

prueba("BT12 editar nunca envía «categoria» (se conserva); crear la deja vacía; duplicar copia la fila original", () => {
    const datos = leer("services/mensajes/bibliotecaAutomatizacionDatos.ts");
    const editar = datos.slice(datos.indexOf("export async function actualizarElemento"), datos.indexOf("export async function alternarElemento"));
    assert.ok(!/categoria/.test(editar.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")), "actualizarElemento no debe tocar la categoría");
    assert.ok(/crearMensaje\(usuarioId, \{[^}]*categoria: null/.test(datos));
    assert.ok(/duplicarMensaje\(usuarioId, elemento\.fila as AutomationMessage\)/.test(datos));
});

prueba("BT13 cada origen se guarda en su propia tabla con los servicios de siempre", () => {
    const datos = leer("services/mensajes/bibliotecaAutomatizacionDatos.ts");
    assert.ok(/from "@\/services\/automatizacion\/mensajesAutomation"/.test(datos) && /from "@\/services\/mensajes\/plantillas"/.test(datos));
    assert.ok(/tipo_respuesta: TIPO_INICIO_DIA/.test(datos));
    assert.ok(!/supabase/.test(datos), "sin consultas propias: solo los servicios existentes");
});

prueba("BT14 «Respuestas a clientes» ya no lista Inicio del día; Automatización enlaza a la biblioteca filtrada", () => {
    assert.ok(/const CATEGORIAS: TipoMensaje\["categoria"\]\[\] = \["Reservas", "Consultas", "Futuro"\]/.test(leer("components/mensajes/MensajesPage/MensajesPage.tsx")));
    assert.ok(leer("components/automatizacion/ConfiguracionGrupo/secciones/SeccionInicioDia.tsx").includes("/mensajes?vista=automatizacion&tipo=inicio_dia"));
});

prueba("BT15 la selección de categoría de Automatización y los datos de categorías siguen existiendo (no se borra nada)", () => {
    assert.ok(/CATEGORIAS_AUTOMATIZACION/.test(leer("services/automatizacion/tiposCategorias.ts")));
    assert.ok(/categoria/.test(leer("services/automatizacion/mensajesAutomation.ts")));
});

console.log(`\nTOTAL: ${total} · ✅ ${total - fallidas} · ❌ ${fallidas}`);
process.exitCode = fallidas ? 1 : 0;
