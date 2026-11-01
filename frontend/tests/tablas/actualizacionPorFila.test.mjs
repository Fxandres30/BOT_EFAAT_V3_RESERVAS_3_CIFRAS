// ==========================================================================
// PRUEBAS (frontend) — puesta al día por fila y selección local de Tablas.
//
//   1. services/tablas/cambiosTabla.ts: las filas que no cambian conservan el
//      mismo objeto; un aviso repetido (eco) no cambia nada; un aviso viejo
//      (commit_timestamp anterior) no pisa uno nuevo; una lectura empezada
//      antes de un aviso no lo pisa; avisos de otro cliente / otra tabla /
//      borrados ajenos se descartan; un aviso incompleto pide releer.
//   2. services/tablas/estadoSeleccion.ts: la selección es local, avisa solo
//      cuando cambia y respeta el bloqueo durante un lote.
//
// Módulos REALES transpilados con el TypeScript del proyecto.
//
//     node frontend/tests/tablas/actualizacionPorFila.test.mjs
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

const C = cargarTs(path.join(FRONT, "services/tablas/cambiosTabla.ts"));
const S = cargarTs(path.join(FRONT, "services/tablas/estadoSeleccion.ts"));

let ok = 0;
function prueba(nombre, fn) { fn(); ok++; console.log(`✔ ${nombre}`); }

const U = "usuario-a";
const fila = (numero, extra = {}) => ({ id: Number(numero) + 1, numero, estado: "libre", usuario_id: U, comprador: null, telefono: null, fecha_reserva: null, ...extra });
const cuadricula = () => Array.from({ length: 100 }, (_, i) => fila(String(i).padStart(2, "0")));

// ---------------------------------------------------------------- fusiones ---

prueba("fusionar: solo cambia el número afectado; los demás conservan su objeto", () => {
    const antes = cuadricula();
    const despues = C.fusionarNumeros(antes, [fila("07", { estado: "pagado", comprador: "Ana" })]);
    assert.notStrictEqual(despues, antes);
    assert.strictEqual(despues[7].estado, "pagado");
    assert.strictEqual(despues.filter((n, i) => n !== antes[i]).length, 1, "un solo objeto nuevo");
});

prueba("fusionar: el eco de una operación (misma fila) no cambia la lista", () => {
    const antes = C.fusionarNumeros(cuadricula(), [fila("07", { estado: "pagado" })]);
    assert.strictEqual(C.fusionarNumeros(antes, [fila("07", { estado: "pagado" })]), antes, "misma lista = React no vuelve a pintar");
    assert.strictEqual(C.fusionarNumeros(antes, []), antes);
});

prueba("fusionar: igualdad por contenido (jsonb y orden de columnas distinto)", () => {
    const a = { ...fila("03"), detalle: { x: 1 } };
    const b = { detalle: { x: 1 }, ...fila("03") };
    assert.ok(C.mismaFila(a, b));
    assert.ok(!C.mismaFila(a, { ...b, estado: "reservado" }));
});

prueba("fusionar: un número nuevo se inserta en orden", () => {
    const lista = C.fusionarNumeros([fila("00"), fila("02")], [fila("01")]);
    assert.deepStrictEqual(lista.map(n => n.numero), ["00", "01", "02"]);
});

prueba("lectura completa: comparte objetos iguales y respeta lo que llegó por aviso durante la lectura", () => {
    const actuales = C.fusionarNumeros(cuadricula(), [fila("10", { estado: "pagado" })]);
    const leidas = cuadricula().map(n => (n.numero === "11" ? { ...n, estado: "reservado" } : n)); // vieja para el 10
    const r = C.reemplazarNumeros(actuales, leidas, n => n === "10");
    assert.strictEqual(r[10], actuales[10], "el 10 cambió por aviso: no lo pisa la lectura");
    assert.strictEqual(r[11].estado, "reservado");
    assert.strictEqual(r[0], actuales[0], "sin cambio: mismo objeto");
    assert.strictEqual(C.reemplazarNumeros(actuales, actuales.map(n => ({ ...n })), () => false), actuales, "nada cambió: misma lista");
});

// --------------------------------------------------------------- versiones ---

prueba("orden: un aviso con commit anterior al último aplicado se descarta", () => {
    const v = C.crearVersiones();
    assert.ok(v.aceptarEvento("05", "2026-10-31T10:00:02.000Z"));
    assert.ok(!v.aceptarEvento("05", "2026-10-31T10:00:01.000Z"), "viejo");
    assert.ok(v.aceptarEvento("05", "2026-10-31T10:00:02.000Z"), "repetido: se acepta (no cambia nada al fusionar)");
    assert.ok(v.aceptarEvento("06", "2026-10-31T09:00:00.000Z"), "otro número: independiente");
    assert.ok(v.aceptarEvento("05", null), "sin commit_timestamp: orden de llegada");
    assert.ok(v.esViejo("06", "2026-10-31T08:00:00.000Z") && !v.esViejo("06", "2026-10-31T09:00:00.000Z") && !v.esViejo("07", "2026-10-31T08:00:00.000Z"), "esViejo no registra nada");
});

prueba("orden: una lectura empezada antes de un aviso no lo pisa; una posterior sí vale", () => {
    const v = C.crearVersiones();
    const lectura1 = v.iniciarLectura();
    v.aceptarEvento("05", "2026-10-31T10:00:00Z");
    assert.ok(!v.lecturaVigente("05", lectura1), "la lectura vieja no vale para el 05");
    assert.ok(v.lecturaVigente("06", lectura1), "sí para los demás");
    const lectura2 = v.iniciarLectura();
    assert.ok(v.lecturaVigente("05", lectura2));
    v.aplicarLectura("05", lectura2);
    assert.ok(!v.lecturaVigente("05", lectura1), "entre lecturas manda la más reciente");
});

// ------------------------------------------------------------------ avisos ---

const nuestra = (id) => id >= 1 && id <= 100;

prueba("aviso: fila completa -> aplicar; otro cliente -> ignorar", () => {
    const actual = fila("05");
    const d = C.decidirAvisoNumero({ eventType: "UPDATE", new: { ...actual, estado: "pagado" }, commit_timestamp: "2026-10-31T10:00:00Z" }, U, actual, nuestra);
    assert.strictEqual(d.tipo, "aplicar");
    assert.strictEqual(d.fila.estado, "pagado");
    assert.strictEqual(C.decidirAvisoNumero({ eventType: "UPDATE", new: { ...actual, usuario_id: "otro" } }, U, actual, nuestra).tipo, "ignorar");
});

prueba("aviso: incompleto (falta una columna o trae errores) -> releer ese número", () => {
    const actual = fila("05");
    const sinComprador = { ...actual };
    delete sinComprador.comprador;
    assert.deepStrictEqual(C.decidirAvisoNumero({ eventType: "UPDATE", new: sinComprador }, U, actual, nuestra), { tipo: "releer", numero: "05" });
    assert.deepStrictEqual(C.decidirAvisoNumero({ eventType: "UPDATE", new: actual, errors: ["Error 413: Payload Too Large"] }, U, actual, nuestra), { tipo: "releer", numero: "05" });
});

prueba("aviso: DELETE de una fila ajena (el filtro no se aplica a borrados) -> ignorar; de una nuestra -> recargar", () => {
    assert.strictEqual(C.decidirAvisoNumero({ eventType: "DELETE", old: { id: 5000 } }, U, undefined, nuestra).tipo, "ignorar");
    assert.strictEqual(C.decidirAvisoNumero({ eventType: "DELETE", old: { id: 6, usuario_id: "otro" } }, U, undefined, nuestra).tipo, "ignorar");
    assert.strictEqual(C.decidirAvisoNumero({ eventType: "DELETE", old: { id: 6 } }, U, undefined, nuestra).tipo, "recargar");
    assert.strictEqual(C.decidirAvisoNumero({ eventType: "DELETE", old: {} }, U, undefined, nuestra).tipo, "recargar", "sin clave: no se sabe");
});

prueba("otra tabla física: se reconoce por la columna tabla (nuevo u old)", () => {
    assert.ok(C.esDeOtraTabla({ eventType: "INSERT", new: { tabla: "reservas_dos_cifras" } }, "5k_15k_reservas_2_cifras"));
    assert.ok(!C.esDeOtraTabla({ eventType: "INSERT", new: { tabla: "5k_15k_reservas_2_cifras" } }, "5k_15k_reservas_2_cifras"));
    assert.ok(C.esDeOtraTabla({ eventType: "DELETE", new: {}, old: { tabla: "otra" } }, "5k_15k_reservas_2_cifras"));
    assert.ok(!C.esDeOtraTabla({ eventType: "DELETE", new: {}, old: { id: 1 } }, "5k_15k_reservas_2_cifras"), "sin columna: no se descarta");
});

// ------------------------------------------------------- listas por id ---

prueba("actividad: unión por id, más reciente primero, sin duplicados y con límite", () => {
    const f = (id, en) => ({ id, creado_en: en });
    const base = [f("b", "2026-10-31T10:00:00+00:00"), f("a", "2026-10-31T09:00:00+00:00")];
    const r = C.fusionarPorId(base, [f("c", "2026-10-31T11:00:00.5Z"), f("b", "2026-10-31T10:00:00+00:00")], x => x.creado_en, 2);
    assert.deepStrictEqual(r.map(x => x.id), ["c", "b"], "ordenada por instante y cortada al límite");
    assert.strictEqual(C.fusionarPorId(base, [f("a", "2026-10-31T09:00:00+00:00")], x => x.creado_en, 10), base, "repetido: misma lista");
});

prueba("ventana: desde la más reciente menos el margen; vacía -> null", () => {
    assert.strictEqual(C.desdeVentana([], x => x.en, 1000), null);
    assert.strictEqual(C.desdeVentana([{ en: "2026-10-31T10:00:00Z" }, { en: "2026-10-31T09:00:00Z" }], x => x.en, 60_000), "2026-10-31T09:59:00.000Z");
});

// --------------------------------------------------------------- selección ---

prueba("selección: local, avisa solo si cambia, conserva el orden de marcado", () => {
    const s = S.crearSeleccion();
    let avisos = 0;
    const quitar = s.suscribir(() => avisos++);
    s.activar();
    s.alternar("05"); s.alternar("01"); s.alternar("05");
    assert.deepStrictEqual(s.obtener().numeros, ["01"]);
    assert.ok(s.obtener().conjunto.has("01"));
    const antes = s.obtener();
    s.limpiar(); s.limpiar();
    assert.strictEqual(avisos, 5, "activar + 3 clics + 1 limpiar (el segundo no cambia nada)");
    assert.notStrictEqual(s.obtener(), antes);
    quitar();
    s.alternar("09");
    assert.strictEqual(avisos, 5, "sin oyente tras desuscribirse");
});

prueba("selección: bloqueada durante un lote no cambia; 100 números distintos", () => {
    const s = S.crearSeleccion();
    s.activar();
    s.bloquear(true);
    s.alternar("05");
    assert.deepStrictEqual(s.obtener().numeros, []);
    s.bloquear(false);
    for (let i = 0; i < 100; i++) s.alternar(String(i).padStart(2, "0"));
    assert.strictEqual(s.obtener().conjunto.size, 100);
    s.salir();
    assert.deepStrictEqual([s.obtener().activo, s.obtener().numeros.length], [false, 0]);
});

prueba("estático: la selección no consulta la base; el hook no escribe en Supabase", () => {
    const sel = fs.readFileSync(path.join(FRONT, "services/tablas/estadoSeleccion.ts"), "utf8");
    assert.ok(!/supabase|fetch\(/.test(sel));
    const cambios = fs.readFileSync(path.join(FRONT, "services/tablas/cambiosTabla.ts"), "utf8");
    assert.ok(!/from "@\/lib\/supabase"|fetch\(/.test(cambios), "módulo puro");
    const hook = fs.readFileSync(path.join(FRONT, "hooks/useTablaPrecio.ts"), "utf8");
    assert.ok(!/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(hook));
    assert.ok(/crearSincronizacion\(/.test(hook), "la sincronización está conectada");
    const card = fs.readFileSync(path.join(FRONT, "components/tablas/NumeroCard.tsx"), "utf8");
    assert.ok(/export default memo\(NumeroCard\)/.test(card), "celda memorizada");
});

console.log(`\n${ok} pruebas OK`);
