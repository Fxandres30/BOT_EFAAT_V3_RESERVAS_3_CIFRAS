// ==========================================================================
// PRUEBAS (frontend) — FASE UX-02: Eventos como centro de control y las dos
// formas de publicar (Programar sorteo / Publicar ahora).
//
//   - Un sorteo detectado aparece en Eventos (origen «Detectado en WhatsApp»).
//   - Un programado está en Programados antes de publicarse y en Eventos
//     después (origen «Programado»).
//   - Un instantáneo NO aparece en Programados; publicado, aparece en Eventos
//     (origen «Publicado ahora»).
//   - Un sorteo en varios grupos es UNA tarjeta, con su administración.
//   - Se conservan acciones y enlaces (?sorteo=, ?vista=administrar).
//   - El calendario de loterías sigue en el menú y con su página.
//
// Lógica REAL del panel (agruparEventos, modalidad, centroEventos,
// filtrosSorteos, estadoEvento) transpilada; sin red ni Supabase.
//
//     node frontend/tests/eventos/centroEventos.test.mjs
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

const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");
const { agruparEventos } = cargarTs(path.join(FRONT, "components/eventos/agruparEventos.ts"));
const { faseDe } = cargarTs(path.join(FRONT, "components/eventos/modalidad.ts"));
const { origenesPorEvento, origenDe, administrableDe, sorteoPorEvento, ETIQUETA_ORIGEN } = cargarTs(path.join(FRONT, "components/eventos/centroEventos.ts"));
const { separarProgramaciones, esInstantaneo } = cargarTs(path.join(FRONT, "components/sorteos/filtrosSorteos.ts"));
const { enlaceAdministrar } = cargarTs(path.join(FRONT, "components/eventos/estadoEvento.ts"));

let total = 0;
function prueba(nombre, fn) { fn(); total++; console.log(`✅ ${nombre}`); }

const U = "aaaaaaaa-0000-4000-8000-00000000000a";

// eventos_bot: una fila por grupo.
const fila = (id, identidad, grupo, extra = {}) => ({
    id, usuario_id: U, identidad_evento_real: identidad, nombre_evento: identidad, grupo_id: grupo, grupo_nombre: grupo,
    activo: true, abierto: true, estado: "abierto", valor: "5000", cifras: 2, cantidad_numeros: 100, actualizado_en: "2026-10-30T12:00:00Z", ...extra
});

// sorteos_programados (GET /sorteos/gestion): grupos con evento_bot_id al publicarse.
const programacion = (id, { inmediato = false, estado = "programado", grupos = [] } = {}) => ({
    id, estado, config: { nombre: id, ...(inmediato ? { publicacion_inmediata: true } : {}) }, grupos
});

// GET /sorteos/eventos: uno por sorteo real.
const enGrupos = (base, filas) => ({
    id: base, identidad: filas[0].identidad_evento_real, nombre: filas[0].nombre_evento, estado: "en_curso",
    reservados: 0, pagados: 0, fecha_evento: null, hora_fin: null, hora_cierre: null, valor: 5000,
    grupos: filas.map(f => ({ evento_id: f.id, grupo_id: f.grupo_id, grupo_nombre: f.grupo_nombre, estado: "en_curso", abierto_whatsapp: true }))
});

// Lo que ve cada pantalla con los mismos datos.
function pantallas({ eventos, programaciones, administrables = [] }) {
    const origenes = origenesPorEvento(programaciones);
    const tarjetas = agruparEventos(eventos).map(e => ({
        nombre: e.nombre_evento, fase: faseDe(e), grupos: e.grupos.length,
        origen: origenDe(e, origenes), administrable: administrableDe(e, administrables)
    }));
    const { programados, instantaneos } = separarProgramaciones(programaciones);
    return { eventos: tarjetas, programados: programados.map(p => p.id), instantaneos: instantaneos.map(p => p.id) };
}

prueba("un sorteo detectado en WhatsApp aparece en Eventos como activo, con su origen y su administración", () => {
    const d = fila("ev-d", "chontico-2026-10-30", "g1");
    const v = pantallas({ eventos: [d], programaciones: [], administrables: [enGrupos("ev-d", [d])] });
    assert.deepStrictEqual(v.eventos.map(x => [x.nombre, x.fase, x.origen]), [["chontico-2026-10-30", "activo", "detectado"]]);
    assert.strictEqual(v.eventos[0].administrable.id, "ev-d");
    assert.strictEqual(ETIQUETA_ORIGEN.detectado.texto, "Detectado en WhatsApp");
});

prueba("un programado está en Programados antes de publicarse y en Eventos después (sin duplicarse por grupo)", () => {
    const antes = pantallas({ eventos: [], programaciones: [programacion("p1", { grupos: [{ grupo_id: "g1", estado: "pendiente" }, { grupo_id: "g2", estado: "pendiente" }] })] });
    assert.deepStrictEqual(antes.programados, ["p1"]);
    assert.strictEqual(antes.eventos.length, 0, "antes de publicarse no está en Eventos");

    const f1 = fila("ev-p1", "medellin-2026-10-30", "g1");
    const f2 = fila("ev-p2", "medellin-2026-10-30", "g2");
    const despues = pantallas({
        eventos: [f1, f2],
        programaciones: [programacion("p1", { estado: "publicado", grupos: [{ grupo_id: "g1", estado: "publicado", evento_bot_id: "ev-p1" }, { grupo_id: "g2", estado: "publicado", evento_bot_id: "ev-p2" }] })],
        administrables: [enGrupos("ev-p1", [f1, f2])]
    });
    assert.deepStrictEqual(despues.eventos.map(x => [x.nombre, x.fase, x.origen, x.grupos]), [["medellin-2026-10-30", "activo", "programado", 2]]);
    assert.deepStrictEqual(despues.eventos[0].administrable.grupos.map(g => g.evento_id), ["ev-p1", "ev-p2"]);
    assert.deepStrictEqual(despues.programados, ["p1"], "su programación (con su historial) sigue en Programados");
});

prueba("un instantáneo NO aparece en Programados (ni antes ni después de publicarse)", () => {
    const v = pantallas({ eventos: [], programaciones: [programacion("i1", { inmediato: true, estado: "borrador" }), programacion("p1")] });
    assert.deepStrictEqual(v.programados, ["p1"]);
    assert.deepStrictEqual(v.instantaneos, ["i1"], "está en «Publicar ahora»");
    assert.ok(esInstantaneo({ config: { publicacion_inmediata: true } }) && !esInstantaneo({ config: {} }) && !esInstantaneo(null));
    const pub = pantallas({ eventos: [], programaciones: [programacion("i1", { inmediato: true, estado: "publicado", grupos: [{ grupo_id: "g1", estado: "publicado", evento_bot_id: "x" }] })] });
    assert.deepStrictEqual(pub.programados, []);
});

prueba("un instantáneo publicado aparece en Eventos como «Publicado ahora»", () => {
    const f = fila("ev-i1", "boyaca-2026-10-30", "g3");
    const v = pantallas({
        eventos: [f],
        programaciones: [programacion("i1", { inmediato: true, estado: "publicado", grupos: [{ grupo_id: "g3", estado: "publicado", evento_bot_id: "ev-i1" }] })],
        administrables: [enGrupos("ev-i1", [f])]
    });
    assert.deepStrictEqual(v.eventos.map(x => [x.fase, x.origen]), [["activo", "instantaneo"]]);
    assert.strictEqual(ETIQUETA_ORIGEN.instantaneo.texto, "Publicado ahora");
});

prueba("los tres orígenes conviven: una tarjeta por sorteo real, nunca una por grupo", () => {
    const filas = [
        fila("d1", "chontico", "g1"), fila("d2", "chontico", "g2"), fila("d3", "chontico", "g3"),
        fila("p1", "medellin", "g1"), fila("p2", "medellin", "g4"),
        fila("i1", "boyaca", "g5")
    ];
    const v = pantallas({
        eventos: filas,
        programaciones: [
            programacion("prog", { estado: "publicado", grupos: [{ evento_bot_id: "p1" }, { evento_bot_id: "p2" }] }),
            programacion("inst", { inmediato: true, estado: "publicado", grupos: [{ evento_bot_id: "i1" }] })
        ]
    });
    assert.deepStrictEqual(v.eventos.map(x => [x.nombre, x.grupos, x.origen]), [["chontico", 3, "detectado"], ["medellin", 2, "programado"], ["boyaca", 1, "instantaneo"]]);
});

prueba("sin respuesta del backend el origen no se inventa y la tarjeta no ofrece acciones", () => {
    const e = agruparEventos([fila("x1", "a", "g1")])[0];
    assert.strictEqual(origenDe(e, null), null);
    assert.strictEqual(administrableDe(e, []), null);
});

prueba("la administración se encuentra por cualquier grupo del sorteo, o por su identidad", () => {
    const f1 = fila("e1", "manizales", "g1"), f2 = fila("e2", "manizales", "g2");
    const s = enGrupos("e1", [f1, f2]);
    const tarjeta = agruparEventos([f2, f1])[0];
    assert.strictEqual(administrableDe(tarjeta, [s]), s);
    assert.strictEqual(administrableDe({ id: "otro", grupos: [], identidad_evento_real: "manizales" }, [s]), s);
    assert.strictEqual(administrableDe({ id: "otro", grupos: [], identidad_evento_real: "ajeno" }, [s]), null);
    assert.strictEqual(sorteoPorEvento([s], "e2"), s, "?sorteo=<evento de cualquier grupo>");
    assert.strictEqual(sorteoPorEvento([s], "nada"), null);
    assert.strictEqual(sorteoPorEvento([s], null), null);
});

prueba("enlaces conservados: «Administrar sorteo» de otras pantallas y los antiguos ?vista=administrar llevan a Eventos", () => {
    assert.strictEqual(enlaceAdministrar("e1"), "/eventos?sorteo=e1");
    const pagina = leer("components/sorteos/SorteosPage.tsx");
    assert.match(pagina, /vista === "administrar" \|\| vista === "en_curso"/);
    assert.match(pagina, /router\.replace\(enlaceAdministrar\(params\?\.get\("sorteo"\)\)\)/);
    assert.match(leer("components/eventos/EventoGrid/EventoGrid.tsx"), /new URLSearchParams\(window\.location\.search\)\.get\("sorteo"\)/);
});

prueba("acciones conservadas: cerrar, reabrir, desactivar, cancelar, eliminar y editar desde Eventos; ver tabla", () => {
    const acciones = leer("components/sorteos/AccionesSorteo.tsx");
    for (const t of ["Cerrar aquí", "Desactivar aquí", "Reabrir aquí", "Desactivar en todos", "Cerrar en todos", "Cancelar sorteo", "Eliminar", "Editar"]) assert.ok(acciones.includes(t), t);
    const modal = leer("components/eventos/AdministrarEventoModal.tsx");
    assert.match(modal, /<BotonesSorteo sorteo=\{s\} onEditar=\{onEditar\}/);
    const grid = leer("components/eventos/EventoGrid/EventoGrid.tsx");
    assert.match(grid, /<EditarSorteoActivoModal/);
    assert.match(leer("components/eventos/EventoCard/EventoCard.tsx"), /Ver tabla de reservas/);
    // Los instantáneos conservan reintentar, detalle, cancelar, archivar y eliminar.
    const inst = leer("components/sorteos/SorteoInstantaneoPage.tsx");
    for (const t of ["<ListaSorteos", "<DetalleSorteoModal", "<EliminarSorteoModal", "<VistaPreviaModal", "instantaneo"]) assert.ok(inst.includes(t), t);
});

prueba("dos formas de crear, sin un tercer formulario en Eventos", () => {
    const acciones = leer("components/sorteos/AccionesCrearSorteo.tsx");
    assert.ok(acciones.includes("Programar sorteo") && acciones.includes("Publicar sorteo ahora"));
    assert.ok(acciones.includes('"/sorteos?nuevo=1"') && acciones.includes('"/sorteo-instantaneo?nuevo=1"'));
    const eventos = leer("components/eventos/EventosPage/EventosPage.tsx") + leer("components/eventos/EventoGrid/EventoGrid.tsx");
    assert.ok(!eventos.includes("<FormularioSorteo"), "Eventos no crea sorteos por su cuenta");
    assert.ok(!fs.existsSync(path.join(FRONT, "components/eventos/CrearSorteoModal")), "sin el flujo de creación propio de Eventos");
    assert.match(leer("components/sorteos/SorteosPage.tsx"), /params\?\.get\("nuevo"\) === "1"/);
    assert.match(leer("components/sorteos/SorteoInstantaneoPage.tsx"), /params\?\.get\("nuevo"\) === "1"/);
    assert.match(leer("app/sorteo-instantaneo/page.tsx"), /<Suspense\b/);
});

prueba("navegación: Eventos, Programados, Publicar ahora y Calendario de loterías (con su página)", () => {
    const menu = leer("components/layout/Sidebar/Sidebar.tsx");
    const orden = ['href: "/eventos", label: "Eventos"', 'href: "/sorteos", label: "Programados"', 'href: "/sorteo-instantaneo", label: "Publicar ahora"', 'href: "/loterias", label: "Calendario de loterías"']
        .map(t => menu.indexOf(t));
    assert.ok(orden.every(i => i > 0) && orden.every((i, k) => k === 0 || i > orden[k - 1]), JSON.stringify(orden));
    assert.ok(fs.existsSync(path.join(FRONT, "app/loterias/page.tsx")));
});

console.log(`\n============================\nTOTAL: ${total}  ✅ PASA: ${total}  ❌ FALLA: 0\n============================`);
