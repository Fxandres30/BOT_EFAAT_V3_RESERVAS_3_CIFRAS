// ==========================================================================
// PRUEBAS (frontend) — Sorteos → Administrar.
//
//   - El proxy /api/sorteos reenvía al backend SOLO las rutas nuevas de
//     administración (GET /eventos, POST /eventos/<uuid>/accion); cualquier
//     otra variante sigue respondiendo 404 sin llegar al backend.
//   - apiSorteos.eventos()/accionEvento() llaman a esas rutas con el token
//     de la sesión y el cuerpo de la acción.
//   - El listado de Eventos no muestra los sorteos eliminados (eliminación
//     lógica: siguen en la base).
//
// Sin red ni Supabase reales: fetch y el cliente se simulan.
//
//     node frontend/tests/sorteos/administrarSorteos.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

const UUID = "e0000000-0000-4000-8000-000000000001";

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
        if (spec.startsWith("@/")) return {};
        return require(spec);
    };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const resultados = [];
async function prueba(nombre, fn) {
    try { await fn(); resultados.push(true); console.log(`✅ ${nombre}`); }
    catch (e) { resultados.push(false); console.log(`❌ ${nombre}`); console.log("   ", e.message); }
}

const proxy = cargarTs(path.join(FRONT, "app/api/sorteos/[[...ruta]]/route.ts"));
const { apiSorteos } = cargarTs(path.join(FRONT, "services/sorteos/apiSorteos.ts"));
const { obtenerEventos } = cargarTs(path.join(FRONT, "services/eventos/obtenerEventos.ts"));

async function llamarProxy(metodo, ruta) {
    const llamadas = [];
    globalThis.fetch = async (url, init) => { llamadas.push({ url: String(url), metodo: init?.method }); return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) }; };
    const req = new Request(`http://panel/api/sorteos/${ruta.join("/")}`, { method: metodo, headers: { authorization: "Bearer jwt" }, ...(metodo === "POST" ? { body: "{}" } : {}) });
    const r = await proxy[metodo](req, { params: Promise.resolve({ ruta }) });
    return { r, llamadas };
}

await prueba("proxy: GET /eventos y POST /eventos/<uuid>/accion llegan al backend", async () => {
    const a = await llamarProxy("GET", ["eventos"]);
    assert.strictEqual(a.llamadas.length, 1);
    assert.match(a.llamadas[0].url, /\/sorteos\/eventos$/);
    const b = await llamarProxy("POST", ["eventos", UUID, "accion"]);
    assert.strictEqual(b.llamadas.length, 1);
    assert.match(b.llamadas[0].url, new RegExp(`/sorteos/eventos/${UUID}/accion$`));
    assert.strictEqual(b.llamadas[0].metodo, "POST");
});

await prueba("proxy: variantes fuera de la lista blanca -> 404 sin llamar al backend", async () => {
    for (const [metodo, ruta] of [["POST", ["eventos"]], ["GET", ["eventos", UUID, "accion"]], ["POST", ["eventos", "no-uuid", "accion"]], ["POST", ["eventos", UUID, "borrar"]]]) {
        const { r, llamadas } = await llamarProxy(metodo, ruta);
        assert.strictEqual(llamadas.length, 0, `${metodo} ${ruta.join("/")}`);
        assert.strictEqual(r.status, 404, `${metodo} ${ruta.join("/")}`);
    }
});

await prueba("apiSorteos.accionEvento: ruta, método, token y cuerpo de la acción", async () => {
    clienteGlobal = { auth: { getSession: async () => ({ data: { session: { access_token: "jwt-123" } } }) } };
    const llamadas = [];
    globalThis.fetch = async (url, init) => { llamadas.push({ url, init }); return { status: 200, json: async () => ({ ok: true, data: { accion: "desactivar", alcance: "grupo", grupos: [], whatsapp: [], publicaciones_detenidas: 0 } }) }; };
    const r = await apiSorteos.accionEvento(UUID, { accion: "desactivar", alcance: "grupo" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(llamadas[0].url, `/api/sorteos/eventos/${UUID}/accion`);
    assert.strictEqual(llamadas[0].init.method, "POST");
    assert.strictEqual(llamadas[0].init.headers.Authorization, "Bearer jwt-123");
    assert.deepStrictEqual(JSON.parse(llamadas[0].init.body), { accion: "desactivar", alcance: "grupo" });
    await apiSorteos.eventos();
    assert.strictEqual(llamadas[1].url, "/api/sorteos/eventos");
});

await prueba("Eventos: los sorteos eliminados (lógico) no se muestran; el resto sí", async () => {
    const filas = [
        { id: 1, usuario_id: "u", estado: "abierto" },
        { id: 2, usuario_id: "u", estado: "eliminado" },
        { id: 3, usuario_id: "u", estado: "cerrado", cierre_motivo: "panel:eliminado" },
        { id: 4, usuario_id: "u", estado: "desactivado" }
    ];
    const cliente = {
        auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
        from() { const b = { select: () => b, eq: () => b, order: () => b, then: (ok) => Promise.resolve({ data: filas, error: null }).then(ok) }; return b; }
    };
    const r = await obtenerEventos(cliente);
    assert.deepStrictEqual(r.map(e => e.id), [1, 4]);
});

// Regresión (27/10, producción): las acciones existían solo en Sorteos →
// «Administrar»; el camino que usa el administrador (Eventos → «Administrar»
// → Tablas → «Editar») no las mostraba. Se comprueba en el código fuente
// que ese camino y las tarjetas de Eventos las ofrecen.
const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

await prueba("«Editar sorteo activo» (Eventos → Administrar → Tablas → Editar) muestra las acciones de estado", async () => {
    const fuente = leer("components/sorteos/EditarSorteoActivoModal.tsx");
    assert.match(fuente, /<BotonesSorteo\b/);
    assert.match(fuente, /<ConfirmarAccionSorteo\b/);
    assert.match(fuente, /Estado del sorteo/);
    const acciones = leer("components/sorteos/AccionesSorteo.tsx");
    for (const texto of ["Cerrar aquí", "Desactivar aquí", "Reabrir aquí", "Desactivar en todos", "Cancelar sorteo", "Eliminar"]) {
        assert.ok(acciones.includes(texto), texto);
    }
});

await prueba("Eventos: cada tarjeta enlaza a Sorteos → «Administrar» y la página abre esa pestaña con ?vista=administrar", async () => {
    // El enlace lleva además ESE sorteo (?sorteo=), ver estadoEvento.ts y
    // frontend/tests/eventos/estadoEvento.test.mjs.
    for (const tarjeta of ["components/eventos/EventoCard/EventoCard.tsx", "components/eventos/EventoTresCifrasCard/EventoTresCifrasCard.tsx"]) {
        assert.match(leer(tarjeta), /href=\{enlaceAdministrar\(evento\??\.id\)\}/, tarjeta);
    }
    assert.match(leer("components/eventos/estadoEvento.ts"), /`\/sorteos\?vista=administrar&sorteo=\$\{encodeURIComponent\(eventoId\)\}`/);
    const pagina = leer("components/sorteos/SorteosPage.tsx");
    assert.match(pagina, /useSearchParams\(\)/);
    assert.match(pagina, /params\?\.get\("vista"\)/);
    assert.match(pagina, /params\?\.get\("sorteo"\)/);
    assert.match(leer("app/sorteos/page.tsx"), /<Suspense\b/);
});

await prueba("Backend sin la versión nueva: «Administrar» lo dice explícitamente (no un error genérico)", async () => {
    assert.match(leer("components/sorteos/SorteosPage.tsx"), /e\.status === 404\) setErrorEnGrupos\("el servidor del bot todavía ejecuta la versión anterior/);
});

const fallidas = resultados.filter(x => !x).length;
console.log(`\n============================\nTOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas}  ❌ FALLA: ${fallidas}\n============================`);
process.exit(fallidas ? 1 : 0);
