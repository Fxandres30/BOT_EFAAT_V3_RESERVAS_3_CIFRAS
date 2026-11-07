// ==========================================================================
// PRUEBAS (frontend) — visibilidad de funcionalidades en el lanzamiento:
//   - Resultados, Lector de pagos y Bloqueados están ocultos desde la
//     fuente única lib/visibilidad/funcionalidades.ts;
//   - el menú lateral dibuja solo las entradas visibles, en el mismo orden,
//     y NAV conserva las ocultas (título de la barra superior);
//   - Eventos oculta la sección Resultados sin tocar Activos/Programados
//     ni la administración por ?sorteo=;
//   - nada se eliminó: páginas, componentes, servicios y rutas API siguen;
//   - el registro documental cubre cada funcionalidad declarada.
//
//     node frontend/tests/visibilidad/visibilidad.test.mjs
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

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, require);
    return modulo.exports;
}

const leer = r => fs.readFileSync(path.join(FRONT, r), "utf8");
const existe = r => fs.existsSync(path.join(FRONT, r));
const V = cargarTs(path.join(FRONT, "lib/visibilidad/funcionalidades.ts"));

// Entradas de NAV leídas del código fuente del menú (href, label, funcionalidad).
function navDelMenu() {
    const src = leer("components/layout/Sidebar/Sidebar.tsx");
    const bloque = src.slice(src.indexOf("export const NAV"), src.indexOf("];", src.indexOf("export const NAV")));
    return [...bloque.matchAll(/\{ href: "([^"]+)", label: "([^"]+)"[^}]*?(?:funcionalidad: "([^"]+)")?\s*\}/g)]
        .map(([, href, label, funcionalidad]) => (funcionalidad ? { href, label, funcionalidad } : { href, label }));
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("fuente única: las tres funcionalidades autorizadas están ocultas y solo ellas", () => {
    assert.deepStrictEqual(Object.keys(V.FUNCIONALIDADES).sort(), ["bloqueados", "lector-pagos", "resultados"]);
    for (const id of ["resultados", "lector-pagos", "bloqueados"]) assert.strictEqual(V.esVisible(id), false, id);
    assert.strictEqual(V.esVisible("no-registrada"), true, "lo no registrado sigue visible");
});

prueba("soloVisibles: quita las ocultas, conserva el orden y lo no marcado", () => {
    const lista = [{ href: "/a" }, { href: "/b", funcionalidad: "bloqueados" }, { href: "/c" }, { href: "/d", funcionalidad: "lector-pagos" }];
    assert.deepStrictEqual(V.soloVisibles(lista).map(i => i.href), ["/a", "/c"]);
    assert.strictEqual(lista.length, 4, "no muta la lista original");
});

prueba("menú lateral: sin Lector de pagos ni Bloqueados; el resto, igual y en el mismo orden", () => {
    const nav = navDelMenu();
    assert.strictEqual(nav.length, 12, "NAV conserva las 12 entradas");
    const visibles = V.soloVisibles(nav).map(i => i.label);
    assert.deepStrictEqual(visibles, [
        "Sesiones", "Reservas", "Mensajes", "Variables globales", "Contactos",
        "Eventos", "Programados", "Publicar ahora", "Calendario de loterías", "Automatización"
    ]);
    assert.deepStrictEqual(nav.filter(i => i.funcionalidad).map(i => [i.href, i.funcionalidad]), [["/lector-pagos", "lector-pagos"], ["/bloqueados", "bloqueados"]]);
    const src = leer("components/layout/Sidebar/Sidebar.tsx");
    assert.match(src, /const SECCIONES = soloVisibles\(NAV\)/, "el menú dibuja solo las visibles");
    assert.match(src, /return NAV\.find\(/, "la barra superior sigue usando NAV completo");
    for (const i of V.soloVisibles(nav)) assert.ok(existe(`app${i.href}/page.tsx`), `${i.href} tiene página`);
});

prueba("Eventos: Resultados oculta tras esVisible; Activos, Programados y ?sorteo= intactos", () => {
    const grid = leer("components/eventos/EventoGrid/EventoGrid.tsx");
    assert.match(grid, /\{esVisible\("resultados"\) && \(\s*<details[\s\S]*?Resultados <span/);
    assert.ok(grid.includes("Activos <span") && grid.includes("Programados <span"));
    assert.match(grid, /new URLSearchParams\(window\.location\.search\)\.get\("sorteo"\)/);
    assert.match(grid, /<AdministrarEventoModal/);
    assert.match(grid, /<ResultadoCard /, "la tarjeta sigue en el código");
});

prueba("rutaVisible: las páginas ocultas no se enlazan; el resto sí", () => {
    for (const r of ["/lector-pagos", "/bloqueados", "/bloqueados/x", "/bloqueados?a=1"]) assert.strictEqual(V.rutaVisible(r), false, r);
    for (const r of ["/tablas", "/contactos", "/eventos", "/bloqueadosx", "/automatizacion"]) assert.strictEqual(V.rutaVisible(r), true, r);
});

prueba("finalizados: acceso a administrar separado de Resultados, sin duplicarse ni mostrar ganador", () => {
    const grid = leer("components/eventos/EventoGrid/EventoGrid.tsx");
    assert.match(grid, /\{!esVisible\("resultados"\) && <FinalizadosAdministrables items=\{finalizadosAdministrables\} \/>\}/);
    // Solo los que el backend ofrece administrar (ventana de 30 días en gestionEventos.js).
    assert.match(grid, /finalizadosAdministrables = items\.filter\(\(i\) => i\.fase === "finalizado" && i\.onAdministrar\)/);
    const bloque = grid.slice(grid.indexOf("function FinalizadosAdministrables"), grid.indexOf("export default function EventoGrid"));
    assert.ok(bloque.includes("Administrar sorteo") && bloque.includes("onClick={i.onAdministrar"));
    for (const t of ["Ver resultado", "Sin resultado registrado", "ResultadoCard", "FILTROS"]) assert.ok(!bloque.includes(t), `sin «${t}»`);
    // Mismo modal de siempre: reabrir/eliminar los valida el backend.
    assert.match(grid, /<AdministrarEventoModal/);
    assert.ok(fs.readFileSync(path.join(RAIZ, "backend/sorteos/gestionEventos.js"), "utf8").includes("const DIAS_RECIENTES = 30;"));
});

prueba("Aprende: sin guías de Lector de pagos ni Bloqueados; artículos sin enlaces ocultos", () => {
    const A = cargarTs(path.join(FRONT, "lib/aprende/articulos.ts"));
    const centro = leer("components/aprende/CentroAprendizaje.tsx");
    assert.match(centro, /CATEGORIAS\.filter\(c => c\.id !== PRIMEROS_PASOS && \(!c\.seccion \|\| rutaVisible\(c\.seccion\.href\)\)\)/);
    const visibles = A.CATEGORIAS.filter(c => c.id !== A.PRIMEROS_PASOS && (!c.seccion || V.rutaVisible(c.seccion.href))).map(c => c.id);
    assert.ok(!visibles.includes("lector-pagos") && !visibles.includes("bloqueados"));
    assert.strictEqual(visibles.length, A.CATEGORIAS.length - 3, "solo faltan primeros pasos y las 2 ocultas");
    assert.ok(A.CATEGORIAS.some(c => c.id === "lector-pagos") && A.CATEGORIAS.some(c => c.id === "bloqueados"), "el contenido se conserva");
    assert.match(leer("components/aprende/ArticuloAprende.tsx"), /articulo\.seccion && rutaVisible\(articulo\.seccion\.href\)/);
    const texto = JSON.stringify(A.ARTICULOS);
    assert.ok(!/Lector de pagos|Abrir Bloqueados/.test(texto), "ningún artículo nombra las ocultas");
});

prueba("catálogo de activadores: sin enlaces ocultos; Lector fuera; expulsión apunta a Contactos", () => {
    const C = cargarTs(path.join(FRONT, "services/activadores/catalogoActivadores.ts"));
    const modal = leer("components/activadores/ActivadoresModal.tsx");
    assert.match(modal, /const CATALOGO = CATALOGO_ACTIVADORES/);
    assert.strictEqual((modal.match(/CATALOGO_ACTIVADORES/g) || []).length, 2, "solo import + derivación");
    // Misma regla que el modal.
    const catalogo = C.CATALOGO_ACTIVADORES.map(m => ({ ...m, entradas: m.entradas.flatMap(e => {
        if (!e.panel?.length) return [e];
        const panel = e.panel.filter(p => V.rutaVisible(p.ruta));
        return panel.length ? [{ ...e, panel }] : [];
    }) })).filter(m => m.entradas.length > 0);
    const entradas = catalogo.flatMap(m => m.entradas);
    assert.ok(entradas.every(e => (e.panel || []).every(p => V.rutaVisible(p.ruta))));
    assert.ok(!entradas.some(e => e.id === "lector-pagos"));
    assert.deepStrictEqual(entradas.find(e => e.id === "bloqueo").panel.map(p => p.ruta), ["/contactos"]);
    const original = C.CATALOGO_ACTIVADORES.flatMap(m => m.entradas);
    assert.strictEqual(entradas.length, original.length - 1, "solo se omite la entrada del Lector");
});

prueba("navegación: ningún enlace interno del panel apunta a una página oculta", () => {
    const archivos = [];
    const recorrer = d => { for (const f of fs.readdirSync(path.join(FRONT, d), { withFileTypes: true })) {
        const r = `${d}/${f.name}`;
        if (f.isDirectory()) recorrer(r); else if (/\.(tsx?|mjs)$/.test(f.name)) archivos.push(r);
    } };
    for (const d of ["components", "app", "lib", "services", "hooks"]) recorrer(d);
    const permitidos = new Set([
        "components/layout/Sidebar/Sidebar.tsx",             // NAV (filtrado con soloVisibles)
        "lib/aprende/articulos.ts",                         // categorías (filtradas con rutaVisible)
        "services/activadores/catalogoActivadores.ts",      // catálogo (filtrado en el modal)
        "lib/visibilidad/funcionalidades.ts"
    ]);
    const enlaces = archivos.filter(r => !r.startsWith("app/api/") && !permitidos.has(r))
        .filter(r => /(href|ruta|push|replace)[=:(]\s*\{?\s*["'`]\/(lector-pagos|bloqueados)\b/.test(leer(r)));
    assert.deepStrictEqual(enlaces, []);
});

prueba("nada eliminado: páginas, componentes, servicios y rutas API conservados", () => {
    for (const r of [
        "app/lector-pagos/page.tsx", "components/pagos/LectorPagosPage/LectorPagosPage.tsx",
        "app/bloqueados/page.tsx", "components/bloqueados/BloqueadosPage/BloqueadosPage.tsx",
        "services/bloqueados/bloqueados.ts", "app/api/bloqueados/route.ts", "app/api/bloqueados/desbloquear/route.ts",
        "app/api/bloqueados/contacto/route.ts", "app/api/bloqueados/expulsiones/route.ts", "app/api/bloqueados/reintentar/route.ts",
        "components/eventos/ResultadoCard/ResultadoCard.tsx", "services/eventos/obtenerEventos.ts"
    ]) assert.ok(existe(r), r);
    // Bloquear/desbloquear desde el perfil del contacto no depende del menú.
    assert.match(leer("components/contactos/PerfilContacto/PerfilContacto.tsx"), /crearBloqueo, desbloquear/);
});

prueba("registro: cada funcionalidad declarada está en ambos documentos", () => {
    const registro = fs.readFileSync(path.join(RAIZ, "docs/FEATURE_VISIBILITY_REGISTER.md"), "utf8");
    const lanzamiento = fs.readFileSync(path.join(RAIZ, "docs/LAUNCH_VISIBILITY.md"), "utf8");
    for (const [id, f] of Object.entries(V.FUNCIONALIDADES)) {
        assert.ok(registro.includes(`\`${id}\``), `registro: ${id}`);
        assert.ok(lanzamiento.includes(f.nombre), `lanzamiento: ${f.nombre}`);
    }
    assert.ok(registro.includes("lib/visibilidad/funcionalidades.ts"));
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); console.log(`  ok  ${n}`); }
    catch (e) { fallos++; console.log(`  FALLA  ${n}\n        ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas correctas`);
process.exit(fallos ? 1 : 0);
