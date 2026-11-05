// ==========================================================================
// PRUEBAS (frontend) — mensaje de publicación del sorteo en el panel.
//
//   1. Proxy: GET /estilos-mensaje, PUT /estilos-mensaje/predeterminado y
//      POST /mensaje/generar llegan al backend; sus variantes no (404).
//   2. apiSorteos: rutas, métodos y cuerpos de las tres llamadas.
//   3. FormularioSorteo: al abrir un sorteo carga EXACTAMENTE el texto,
//      estilo y estado guardados; al guardar envía publicacion_meta; usa el
//      selector en creación programada, instantánea y edición.
//   4. Sorteo en curso: solo envía el mensaje si cambió; en un detectado no
//      hay interruptor ni se rellena el texto.
//   5. Selector: rellena solo textos vacíos (nunca pisa uno escrito), pide
//      confirmación antes de sustituir un texto personalizado, restaurar y
//      sin catálogo vuelve al campo de siempre.
//
//     node frontend/tests/sorteos/selectorMensaje.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

let clienteGlobal = null;

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    const requerir = spec => {
        if (spec === "@/lib/supabase") return { supabase: new Proxy({}, { get: (_, p) => clienteGlobal[p] }) };
        if (spec === "@/lib/botApi") return { botApiHeaders: () => ({ "x-service-token": "t" }) };
        if (spec === "next/server") return { NextResponse: { json: (cuerpo, init = {}) => ({ cuerpo, status: init.status || 200 }) } };
        // apiSorteos invalida la caché del índice de Reservas tras operar.
        if (spec === "@/lib/cache/almacen") return { invalidar: () => {} };
        if (spec.startsWith("@/")) return {};
        return require(spec);
    };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

const resultados = [];
async function prueba(nombre, fn) {
    try { await fn(); resultados.push(true); console.log(`✅ ${nombre}`); }
    catch (e) { resultados.push(false); console.log(`❌ ${nombre}`); console.log("   ", e.message); }
}

const proxy = cargarTs(path.join(FRONT, "app/api/sorteos/[[...ruta]]/route.ts"));
const { apiSorteos } = cargarTs(path.join(FRONT, "services/sorteos/apiSorteos.ts"));

async function llamarProxy(metodo, ruta) {
    const llamadas = [];
    globalThis.fetch = async (url, init) => { llamadas.push({ url: String(url), metodo: init?.method }); return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) }; };
    const conCuerpo = metodo === "POST" || metodo === "PUT";
    const req = new Request(`http://panel/api/sorteos/${ruta.join("/")}`, { method: metodo, headers: { authorization: "Bearer jwt" }, ...(conCuerpo ? { body: "{}" } : {}) });
    const r = await proxy[metodo](req, { params: Promise.resolve({ ruta }) });
    return { r, llamadas };
}

await prueba("1. Proxy: las tres rutas nuevas llegan al backend con su método", async () => {
    for (const [metodo, ruta, destino] of [
        ["GET", ["estilos-mensaje"], /\/sorteos\/estilos-mensaje$/],
        ["PUT", ["estilos-mensaje", "predeterminado"], /\/sorteos\/estilos-mensaje\/predeterminado$/],
        ["POST", ["mensaje", "generar"], /\/sorteos\/mensaje\/generar$/]
    ]) {
        const { llamadas } = await llamarProxy(metodo, ruta);
        assert.strictEqual(llamadas.length, 1, `${metodo} ${ruta.join("/")}`);
        assert.match(llamadas[0].url, destino);
        assert.strictEqual(llamadas[0].metodo, metodo);
    }
});

await prueba("1b. Proxy: variantes fuera de la lista blanca -> 404 sin llamar al backend", async () => {
    for (const [metodo, ruta] of [
        ["POST", ["estilos-mensaje"]], ["DELETE", ["estilos-mensaje"]], ["GET", ["estilos-mensaje", "predeterminado"]],
        ["GET", ["mensaje", "generar"]], ["POST", ["mensaje", "enviar"]], ["POST", ["mensaje"]]
    ]) {
        const { r, llamadas } = await llamarProxy(metodo, ruta);
        assert.strictEqual(llamadas.length, 0, `${metodo} ${ruta.join("/")}`);
        assert.strictEqual(r.status, 404, `${metodo} ${ruta.join("/")}`);
    }
});

await prueba("2. apiSorteos: catálogo, preferencia y generación (ruta, método, token, cuerpo)", async () => {
    clienteGlobal = { auth: { getSession: async () => ({ data: { session: { access_token: "jwt-1" } } }) } };
    const llamadas = [];
    globalThis.fetch = async (url, init) => { llamadas.push({ url, init }); return { status: 200, json: async () => ({ ok: true, data: {} }) }; };
    await apiSorteos.estilosMensaje();
    await apiSorteos.guardarEstiloPredeterminado("boleto");
    const datos = { nombre: "X", hora_fin: "22:30", hora_cierre: null, valor: 3000, premios: [], fecha_sorteo: null, cuentas: ["c1"] };
    await apiSorteos.generarMensaje({ estilo: "agenda", texto: "Hola {{nombre}}", datos });
    assert.deepStrictEqual(llamadas.map(l => [l.url, l.init.method]), [
        ["/api/sorteos/estilos-mensaje", "GET"],
        ["/api/sorteos/estilos-mensaje/predeterminado", "PUT"],
        ["/api/sorteos/mensaje/generar", "POST"]
    ]);
    assert.ok(llamadas.every(l => l.init.headers.Authorization === "Bearer jwt-1"));
    assert.deepStrictEqual(JSON.parse(llamadas[1].init.body), { estilo: "boleto" });
    assert.deepStrictEqual(JSON.parse(llamadas[2].init.body), { estilo: "agenda", texto: "Hola {{nombre}}", datos });
});

const formulario = leer("components/sorteos/FormularioSorteo.tsx");
const activo = leer("components/sorteos/EditarSorteoActivoModal.tsx");
const selector = leer("components/sorteos/SelectorMensaje.tsx");

await prueba("3. Formulario: carga exactamente lo guardado (texto, estilo, activo) y lo envía con publicacion_meta", async () => {
    assert.match(formulario, /mensajePublicacion: config\.mensajes\?\.publicacion \|\| ""/);
    assert.match(formulario, /estiloMensaje: config\.mensajes\?\.publicacion_meta\?\.estilo \|\| ""/);
    assert.match(formulario, /mensajeActivo: config\.mensajes\?\.publicacion_meta\?\.activo !== false/);
    assert.match(formulario, /publicacion_meta: \{ \.\.\.\(f\.estiloMensaje \? \{ estilo: f\.estiloMensaje \} : \{\}\), activo: f\.mensajeActivo \}/);
    assert.ok(!formulario.includes("Vacío = plantilla por defecto"), "ya no se guarda vacío");
});

await prueba("3b. Formulario: un único selector para programado, instantáneo y edición (con datos reales)", async () => {
    assert.strictEqual((formulario.match(/<SelectorMensaje\b/g) || []).length, 1);
    // No depende de `inmediato` ni de `edicion` para mostrarse.
    const bloque = formulario.slice(formulario.indexOf("<SelectorMensaje"), formulario.indexOf("/>", formulario.indexOf("<SelectorMensaje")));
    assert.match(bloque, /sorteoNuevo=\{!edicion\}/);
    for (const dato of ["nombre: form.nombre", "hora_fin: form.horaFin", "valor: Number(form.valor)", "fecha_sorteo: fechaSorteo", "cuentas: form.cuentas"]) assert.ok(bloque.includes(dato), dato);
    // Al aplicar una plantilla de sorteo sin texto se rellena con su diseño.
    assert.match(formulario, /setSemillaMensaje\(n => n \+ 1\)/);
});

await prueba("4. Sorteo en curso: envía el mensaje SOLO si cambió; detectado sin interruptor ni relleno", async () => {
    assert.match(activo, /texto: s\.publicacion_texto \?\? s\.publicacion \?\? ""/);
    assert.match(activo, /mensajeCambiado = Boolean\(mensajeInicial\) && \(mensaje\.texto !== mensajeInicial!\.texto \|\| mensaje\.estilo !== mensajeInicial!\.estilo \|\| mensaje\.activo !== mensajeInicial!\.activo\)/);
    assert.match(activo, /sorteo\.campos\.publicacion\?\.editable && mensajeCambiado \?/);
    assert.match(activo, /permitirActivar=\{sorteo\.origen === "panel"\}/);
    assert.match(activo, /rellenarVacio=\{sorteo\.origen === "panel"\}/);
    // La base sigue siendo lo guardado (control de cambios simultáneos).
    assert.match(activo, /publicacion: sorteo\.publicacion \}/);
});

await prueba("5. Selector: rellena solo textos vacíos, confirma antes de sustituir y al restaurar", async () => {
    assert.match(selector, /if \(!rellenar \|\| v\.texto\) return;/, "nunca pisa un texto escrito");
    assert.match(selector, /if \(personalizado && !window\.confirm\(`Cambiar al diseño/);
    assert.match(selector, /window\.confirm\(`Se eliminará tu texto personalizado y se usará el diseño «\$\{estiloActual\.nombre\}» original\. El sorteo no se elimina/);
    assert.match(selector, /disabled=\{!personalizado\}/, "restaurar solo con personalización");
    assert.match(selector, /role="radiogroup"/);
    assert.match(selector, /aria-checked=\{elegido\}/);
    assert.match(selector, /role="switch"/);
    // Vista previa: generador del servidor (el del publicador), no uno propio.
    assert.match(selector, /apiSorteos\.generarMensaje\(/);
    assert.ok(!/replace\(\s*\/\\\{\\\{/.test(selector), "el panel no resuelve variables por su cuenta");
    // Sin catálogo (backend anterior): el campo de siempre.
    assert.match(selector, /catalogo\.tipo === "error"/);
    assert.match(selector, /No pudimos cargar los diseños/);
});

await prueba("5b. Selector: aviso claro de inactivo y contador con el límite", async () => {
    assert.match(selector, /se publicará solo la imagen de la tabla, sin texto\. El contenido queda guardado/);
    assert.match(selector, /al publicar/);
    assert.match(selector, /generado\?\.excede/);
    assert.match(leer("components/sorteos/VistaPreviaModal.tsx"), /vista\.publicacion_activa === false/);
});

const fallidas = resultados.filter(x => !x).length;
console.log(`\n============================\nTOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas}  ❌ FALLA: ${fallidas}\n============================`);
process.exit(fallidas ? 1 : 0);
