// ==========================================================================
// PRUEBAS (frontend) — «Aprende a usar EFAAT»:
//   - acceso en el menú lateral entre «Mi cuenta» y «Cerrar sesión»;
//   - centro (/aprende) y artículos (/aprende/[slug]) protegidos con el
//     mismo DashboardLayout que el resto del panel;
//   - navegación: centro -> artículo -> centro, y «Volver al panel»;
//   - búsqueda de artículos (sin tildes) y estados vacíos;
//   - plantilla completa en cada artículo y enlaces a rutas que existen;
//   - ayuda contextual en Sesiones y Reservas con artículos válidos;
//   - el contenido es estático: no consulta Supabase ni el backend.
//
//     node frontend/tests/aprende/aprende.test.mjs
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

const leer = r => fs.readFileSync(path.join(FRONT, r), "utf8");
const A = cargarTs(path.join(FRONT, "lib/aprende/articulos.ts"));

// ¿Existe la página de una ruta del panel? (/tablas -> app/tablas/page.tsx)
const existeRuta = href => fs.existsSync(path.join(FRONT, "app", href.replace(/^\//, ""), "page.tsx"));

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("menú lateral: «Aprende a usar EFAAT» entre «Mi cuenta» y «Cerrar sesión», con icono y estado activo", () => {
    const src = leer("components/layout/Sidebar/Sidebar.tsx");
    const pos = ["Mi cuenta", "Aprende a usar EFAAT", "Cerrar sesión"].map(t => src.indexOf(t));
    assert.ok(pos.every(p => p > 0));
    assert.deepStrictEqual([...pos].sort((a, b) => a - b), pos);
    assert.ok(/href="\/aprende"/.test(src));
    assert.ok(/GraduationCap/.test(src));
    assert.ok(/aprendeActiva/.test(src) && /aria-current=\{aprendeActiva \? "page" : undefined\}/.test(src));
    const css = leer("components/layout/Sidebar/Sidebar.css");
    assert.ok(/\.sidebar__account:focus-visible/.test(css), "estado de foco");
    assert.ok(/\.sidebar__accountText[\s\S]*text-overflow: ellipsis/.test(css), "sin desbordar en pantallas pequeñas");
});

prueba("rutas protegidas con el layout del panel (redirige a /login sin sesión)", () => {
    for (const r of ["app/aprende/page.tsx", "app/aprende/[slug]/page.tsx"]) {
        const src = leer(r);
        assert.ok(/<DashboardLayout>/.test(src), `${r} usa DashboardLayout`);
    }
    assert.ok(/router\.replace\("\/login"\)/.test(leer("components/layout/DashboardLayout/DashboardLayout.tsx")));
});

prueba("navegación: centro -> artículo -> centro y «Volver al panel»", () => {
    const centro = leer("components/aprende/CentroAprendizaje.tsx");
    assert.ok(/href=\{`\/aprende\/\$\{a(rticulo)?\.slug\}`\}/.test(centro), "abre artículos");
    assert.ok(/Volver al panel/.test(centro) && /router\.back\(\)/.test(centro));
    const art = leer("components/aprende/ArticuloAprende.tsx");
    assert.ok((art.match(/href="\/aprende"/g) || []).length >= 2, "vuelve al centro arriba y abajo");
    assert.ok(/Volver al centro de aprendizaje/.test(art));
    // Cada artículo tiene página estática.
    assert.ok(/generateStaticParams/.test(leer("app/aprende/[slug]/page.tsx")));
});

prueba("artículo inexistente: estado vacío con enlace al centro", () => {
    assert.strictEqual(A.articuloPorSlug("no-existe"), null);
    const art = leer("components/aprende/ArticuloAprende.tsx");
    assert.ok(/No encontramos esta guía/.test(art) && /Ver todas las guías/.test(art));
});

prueba("búsqueda: sin tildes, varias palabras, vacía y sin resultados", () => {
    const slugs = q => A.buscarArticulos(q).map(a => a.slug);
    assert.ok(slugs("codigo qr").includes("crear-y-conectar-sesion"));
    assert.ok(slugs("CÓDIGO QR").includes("crear-y-conectar-sesion"));
    assert.ok(slugs("compartir").includes("compartir-tabla"));
    assert.ok(slugs("historial").includes("historial-de-numeros"));
    assert.ok(slugs("contraseña").includes("mi-cuenta"));
    assert.deepStrictEqual(slugs("   "), []);
    assert.deepStrictEqual(slugs("xyzzy inexistente"), []);
    const centro = leer("components/aprende/CentroAprendizaje.tsx");
    assert.ok(/No encontramos guías con esa búsqueda/.test(centro) && /Limpiar búsqueda/.test(centro));
});

prueba("contenido: slugs únicos, plantilla completa y categorías existentes", () => {
    const vistos = new Set();
    for (const a of A.ARTICULOS) {
        assert.ok(!vistos.has(a.slug), `slug repetido ${a.slug}`);
        vistos.add(a.slug);
        assert.match(a.slug, /^[a-z0-9-]+$/);
        assert.ok(A.categoriaPorId(a.categoria), `${a.slug}: categoría inexistente`);
        assert.ok(a.titulo && a.descripcion && a.paraQueSirve, `${a.slug}: faltan textos`);
        assert.ok(a.pasos.length >= 2, `${a.slug}: paso a paso`);
        assert.ok(a.siNoFunciona.length >= 1, `${a.slug}: qué hacer si no funciona`);
        assert.ok(a.minutos >= 1 && a.minutos <= 10);
        if (a.seccion) assert.ok(existeRuta(a.seccion.href), `${a.slug}: la ruta ${a.seccion.href} no existe`);
    }
    for (const c of A.CATEGORIAS) if (c.seccion) assert.ok(existeRuta(c.seccion.href), `${c.id}: ${c.seccion.href}`);
});

prueba("prioridad: Sesiones y Reservas cubren lo pedido; las demás quedan en preparación", () => {
    const de = id => A.articulosDe(id).map(a => a.slug);
    for (const s of ["crear-y-conectar-sesion", "estado-de-la-sesion", "sesion-en-uso-y-preferida", "desconectar-y-eliminar-sesion", "enlace-de-conexion", "sesion-no-conecta"]) {
        assert.ok(de("sesiones").includes(s), s);
    }
    for (const s of ["tablas-de-precio", "estados-de-los-numeros", "buscar-y-filtrar", "historial-de-numeros", "compartir-tabla", "editar-personalizar-disenos"]) {
        assert.ok(de("reservas").includes(s), s);
    }
    assert.ok(de("primeros-pasos").length >= 3);
    for (const id of ["mensajes", "variables", "contactos", "eventos", "sorteos", "loterias", "automatizacion", "lector-pagos", "bloqueados"]) {
        assert.deepStrictEqual(de(id), [], `${id} sin artículos no verificados`);
    }
    assert.ok(/Guía en preparación/.test(leer("components/aprende/CentroAprendizaje.tsx")));
});

prueba("sin promesas que el sistema no tiene: suscripción y pagos no se presentan como disponibles", () => {
    const cuenta = A.articuloPorSlug("mi-cuenta");
    assert.ok(cuenta.pasos.some(p => /todavía no se registran/.test(p)));
    const enlace = A.articuloPorSlug("enlace-de-conexion");
    assert.ok(enlace.siNoFunciona.some(p => /no pide iniciar sesión/.test(p)), "advierte que el enlace es público");
});

prueba("ayuda contextual: componente reutilizable en Sesiones y Reservas, abre un modal sin navegar", () => {
    const comp = leer("components/aprende/AyudaContextual.tsx");
    assert.ok(/<Modal/.test(comp) && /useState\(false\)/.test(comp));
    assert.ok(/target="_blank"/.test(comp), "el centro se abre aparte, sin perder la pantalla");
    const usos = [
        ["components/sessions/SessionsPage/SessionsPage.tsx", "crear-y-conectar-sesion"],
        ["components/tablas/TablaPrecioView.tsx", "tablas-de-precio"],
        ["app/tablas/page.tsx", "tablas-de-precio"]
    ];
    for (const [archivo, slug] of usos) {
        const src = leer(archivo);
        assert.ok(src.includes(`<AyudaContextual slug="${slug}" />`), `${archivo}`);
        assert.ok(A.articuloPorSlug(slug), slug);
    }
});

prueba("contenido estático: la guía no consulta Supabase, el backend ni datos de clientes", () => {
    const dir = path.join(FRONT, "components/aprende");
    const fuentes = [...fs.readdirSync(dir).filter(f => f.endsWith(".tsx")).map(f => fs.readFileSync(path.join(dir, f), "utf8")), leer("lib/aprende/articulos.ts")];
    for (const src of fuentes) {
        assert.ok(!/supabase|fetchConSesion|fetch\(|\/api\//.test(src));
    }
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); console.log(`  ok  ${n}`); }
    catch (e) { fallos++; console.log(`  FALLA  ${n}\n        ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas correctas`);
process.exit(fallos ? 1 : 0);
