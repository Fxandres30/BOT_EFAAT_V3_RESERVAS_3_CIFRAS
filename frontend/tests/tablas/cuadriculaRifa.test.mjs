// ==========================================================================
// PRUEBAS (frontend): cuadrícula COMPLETA de una rifa (tabla_id) y lecturas
// sin repeticiones en /tablas.
//
// Causas corregidas:
//   1. Los libres de una rifa se pintaban atenuados (opacity-30) cuando no
//      había un sorteo activo cuyo PRECIO coincidiera con el de la tabla:
//      en una rifa nueva (sin sorteo) la cuadrícula parecía vacía.
//   2. Volver a una tabla ya vista (o editar su valor) la cerraba y recargaba
//      entera con pantalla de carga: ahora se pinta lo último visto y se
//      valida con UNA lectura, solo se reabre si cambia su identidad.
//
// Base falsa en memoria (misma forma que supabase-js) + Realtime falso con
// cortes y reconexión. Lecturas REALES de services/tablas/fuenteRifa.ts y
// abrirTabla real de hooks/useTablaPrecio.ts; la cuadrícula real (Grid +
// NumeroCard) se dibuja con react-dom/server.
//
//     node frontend/tests/tablas/cuadriculaRifa.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const U = "11111111-0000-4000-8000-000000000001";
const R1 = "aaaaaaaa-0000-4000-8000-000000000001";   // $2.000 de U, 100 números
const R2 = "aaaaaaaa-0000-4000-8000-000000000002";   // OTRA $2.000 de U, 100 números
const R3 = "aaaaaaaa-0000-4000-8000-000000000003";   // $5.000 de U, 1.000 números
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------ base falsa (SQL) ---
const db = {};
function reiniciarBase() {
    const rifa = (id, precio, cifras, cantidad) => ({ id, usuario_id: U, nombre: `Tabla ${precio}`, codigo: null, precio, cifras, cantidad, activa: true, ciclo: 1 });
    db.tablas_rifas = [rifa(R1, 2000, 2, 100), rifa(R2, 2000, 2, 100), rifa(R3, 5000, 3, 1000)];
    db.numeros_rifa = [];
    for (const r of db.tablas_rifas) {
        for (let n = 0; n < r.cantidad; n++) db.numeros_rifa.push({ id: `${r.id}-${n}`, tabla_id: r.id, usuario_id: U, numero: n, estado: "libre", comprador: null, actualizado_en: "2026-11-12T10:00:00Z" });
    }
    // Sin reservas, sin sorteos, sin actividad ni historial.
    db.eventos_bot = [];
    db.reservas_actividad = [];
    db.reservas_auditoria = [];
    db.numeros_rifa_archivo = [];
    db.consultas = [];
}
const fila = (t, n) => db.numeros_rifa.find(f => f.tabla_id === t && f.numero === n);
let reloj = Date.parse("2026-11-12T18:00:00Z");
function cambiar(t, n, cambios) {
    reloj += 1000;
    Object.assign(fila(t, n), { actualizado_en: new Date(reloj).toISOString() }, cambios);
    return { ...fila(t, n) };
}

function consulta(tabla) {
    const filtros = [];
    const desc = [];
    let orden = null, desde = 0, hasta = Infinity, una = false;
    const q = {
        select() { return q; },
        eq(c, v) { desc.push(`${c}=${v}`); filtros.push(f => String(f[c]) === String(v)); return q; },
        neq(c, v) { filtros.push(f => String(f[c]) !== String(v)); return q; },
        in(c, vs) { desc.push(`${c} in`); filtros.push(f => vs.map(String).includes(String(f[c]))); return q; },
        gte(c, v) { filtros.push(f => String(f[c]) >= String(v)); return q; },
        order(c, o = {}) { orden = { c, asc: o.ascending !== false }; return q; },
        range(a, b) { desde = a; hasta = b; return q; },
        limit(n) { hasta = desde + n - 1; return q; },
        maybeSingle() { una = true; return q; },
        then(res, rej) {
            db.consultas.push({ tabla, desc: desc.join("&"), parcial: desc.some(d => d.endsWith(" in")) });
            let filas = (db[tabla] || []).filter(f => filtros.every(fn => fn(f)));
            if (orden) filas = [...filas].sort((a, b) => (a[orden.c] > b[orden.c] ? 1 : -1) * (orden.asc ? 1 : -1));
            filas = filas.slice(desde, hasta + 1).map(f => JSON.parse(JSON.stringify(f)));
            return Promise.resolve({ data: una ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
        }
    };
    return q;
}
// Lecturas COMPLETAS de la cuadrícula de una rifa (no las relecturas por número).
const lecturasCompletas = (t) => db.consultas.filter(c => c.tabla === "numeros_rifa" && c.desc.includes(`tabla_id=${t}`) && !c.parcial).length;
const lecturasDe = (t) => db.consultas.filter(c => c.desc.includes(`tabla_id=${t}`)).length;

// ---------------------------------------------------- Realtime falso ---
const canalesAbiertos = new Set();
const supabase = {
    from: consulta,
    channel(nombre) {
        return {
            nombre, binds: [], estado: null,
            on(tipo, cfg, cb) { this.binds.push({ cfg, cb }); return this; },
            subscribe(cb) { this.alEstado = cb; canalesAbiertos.add(this); queueMicrotask(() => cb("SUBSCRIBED")); return this; }
        };
    },
    removeChannel(c) { canalesAbiertos.delete(c); }
};
function emitir(table, aviso) {
    for (const c of canalesAbiertos) for (const b of c.binds) {
        if (b.cfg.table !== table) continue;
        const [col, val] = (b.cfg.filter || "").split("=eq.");
        if (col && String(aviso.new?.[col]) !== val) continue;
        b.cb({ schema: "public", table, errors: null, old: {}, commit_timestamp: new Date(reloj).toISOString(), ...aviso });
    }
}
globalThis.window = { addEventListener() {}, removeEventListener() {} };

// --------------------------------------------------------- módulo real ---
const servicios = {
    "@/services/contactos/obtenerContactos": { obtenerContactos: async () => ({ contactos: [] }) },
    "@/services/auth/getUser": { getUser: async () => ({ data: { user: { id: U } } }) },
    "@/services/rifas/apiRifas": { apiRifas: {}, mensajeMotivo: (m) => m },
    "./NumeroDetalleModal": { __esModule: true, default: () => null }
};
function cargarTs(rutaAbs, cache) {
    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
    });
    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);
    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase };
        if (servicios[spec]) return servicios[spec];
        if (spec.endsWith(".css")) return { default: new Proxy({}, { get: (_, k) => String(k) }) };
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        return require(spec);
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}
const cache = new Map();
const hook = cargarTs(path.join(FRONT, "hooks/useTablaPrecio.ts"), cache);
const { abrirTabla, fuenteDeRifa } = hook;
const fuenteRifa = cargarTs(path.join(FRONT, "services/tablas/fuenteRifa.ts"), cache);
const historialDatos = cargarTs(path.join(FRONT, "components/tablas/historialDatos.ts"), cache);
const { estadoEfectivo } = cargarTs(path.join(FRONT, "components/tablas/estadoVisual.ts"), cache);
const almacen = cargarTs(path.join(FRONT, "lib/cache/almacen.ts"), cache);
const Grid = cargarTs(path.join(FRONT, "components/tablas/Grid.tsx"), cache).default;
const { DEFAULT_TABLA_DISENO_CONFIG } = cargarTs(path.join(FRONT, "services/tablas/disenoDefaults.ts"), cache);

function abrir(tablaId, { inicial } = {}) {
    const rifa = db.tablas_rifas.find(r => r.id === tablaId);
    const v = { numeros: inicial?.numeros ?? [], evento: null, actividad: [], loading: !inicial, cargas: 0, error: null, desactualizada: false, pintadas: 0 };
    const vista = {
        setNumeros: (x) => { v.numeros = x; v.pintadas++; }, setEventoActivo: (x) => { v.evento = x; }, setActividad: (x) => { v.actividad = x; },
        setEventosHistorial: () => {}, setContactos: () => {}, setHistorialCargado: () => {}, setDiagnostico: () => {},
        setError: (e) => { v.error = e; }, setLoading: (l) => { v.loading = l; if (l) v.cargas++; }, setDesactualizada: (d) => { v.desactualizada = d; }
    };
    const control = abrirTabla({ precio: rifa.precio, usuarioId: U, config: fuenteRifa.configDeRifa(rifa), historialPedido: () => false, vista, fuente: fuenteDeRifa(rifa), inicial });
    return { v, control, rifa };
}
const estadoDe = (v, n) => v.numeros.find(f => f.numero === n)?.estado;

// Cuadrícula real dibujada: cuántas celdas y cuántas atenuadas.
function dibujar(numeros, { atenuarLibres, coincidePrecio = false, coincidentes = null } = {}) {
    const html = renderToStaticMarkup(React.createElement(Grid, {
        precio: 2000, numeros, paquetes: [], eventoActivo: null, coincidePrecio, atenuarLibres, coincidentes,
        diseno: DEFAULT_TABLA_DISENO_CONFIG, onReservar: async () => ({ ok: true }), onMarcarPagado: async () => ({ ok: true }), onLiberar: async () => ({ ok: true })
    }));
    const celdas = (html.match(/<button/g) || []).length;
    const atenuadas = (html.match(/opacity-30/g) || []).length;
    return { html, celdas, atenuadas };
}

let ok = 0;
async function prueba(nombre, fn) { reiniciarBase(); canalesAbiertos.clear(); almacen.vaciar(); await fn(); ok++; console.log(`✔ ${nombre}`); }

// ------------------------------------------------------------- pruebas ---

await prueba("1. 100 números sin reservas ni sorteo: 00–99 completos, todos disponibles y SIN atenuar", async () => {
    const a = abrir(R1);
    await dormir(30);
    assert.strictEqual(a.v.error, null);
    assert.strictEqual(a.v.numeros.length, 100);
    assert.deepStrictEqual(a.v.numeros.map(f => f.numero), Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0")), "00…99 con ceros a la izquierda");
    assert.ok(a.v.numeros.every(f => estadoEfectivo(f) === "libre"));
    assert.strictEqual(a.v.evento, null, "sin sorteo activo");
    const rifa = dibujar(a.v.numeros, { atenuarLibres: false });
    assert.strictEqual(rifa.celdas, 100, "la cuadrícula dibuja las 100 celdas");
    assert.strictEqual(rifa.atenuadas, 0, "en una rifa los libres NUNCA se atenúan (causa del «no se ven los números»)");
    assert.ok(rifa.html.includes(">00<") && rifa.html.includes(">99<"));
    // La tabla antigua por precio conserva su comportamiento de siempre.
    assert.strictEqual(dibujar(a.v.numeros, { atenuarLibres: true }).atenuadas, 100, "tabla antigua sin sorteo de su precio: igual que antes");
    assert.strictEqual(dibujar(a.v.numeros, {}).atenuadas, 100, "por defecto (TablaImprimible, etc.) igual que antes");
    a.control.cerrar();
});

await prueba("2. 1.000 números (3 cifras): 000–999 completos, en páginas de 1.000", async () => {
    const a = abrir(R3);
    await dormir(40);
    assert.strictEqual(a.v.numeros.length, 1000);
    assert.strictEqual(a.v.numeros[0].numero, "000");
    assert.strictEqual(a.v.numeros[7].numero, "007");
    assert.strictEqual(a.v.numeros[999].numero, "999");
    assert.strictEqual(new Set(a.v.numeros.map(f => f.numero)).size, 1000, "sin repetidos");
    const g = dibujar(a.v.numeros, { atenuarLibres: false });
    assert.strictEqual(g.celdas, 1000);
    assert.strictEqual(g.atenuadas, 0);
    a.control.cerrar();
});

await prueba("3. historial vacío no oculta números: «Todos» = cuadrícula completa", async () => {
    const a = abrir(R1);
    await dormir(30);
    const historial = historialDatos.construirHistorial(a.v.numeros, { auditoria: [], auditoriaDisponible: false, actividad: [], archivo: [], contactos: [] }, estadoEfectivo);
    const todos = historialDatos.numerosCoincidentes(a.v.numeros, historial, historialDatos.FILTROS_HISTORIAL_VACIOS, estadoEfectivo);
    assert.strictEqual(todos, null, "sin filtros: no se filtra nada");
    assert.strictEqual(dibujar(a.v.numeros, { atenuarLibres: false, coincidentes: todos }).celdas, 100);
    const libres = historialDatos.numerosCoincidentes(a.v.numeros, historial, { ...historialDatos.FILTROS_HISTORIAL_VACIOS, estado: "libre" }, estadoEfectivo);
    assert.strictEqual(libres.size, 100, "los 100 libres aparecen aunque ninguno tenga historial");
    a.control.cerrar();
});

await prueba("4. filtros y estados: solo cambian lo que se ve, no los datos", async () => {
    cambiar(R1, 3, { estado: "reservado", comprador: "Ana", reservado_en: "2026-11-12T15:00:00Z" });
    cambiar(R1, 4, { estado: "pagado", comprador: "Beto", reservado_en: "2026-11-12T15:00:00Z", pagado_en: "2026-11-12T16:00:00Z" });
    cambiar(R1, 5, { estado: "bloqueado", bloqueado_hasta: "2099-01-01T00:00:00Z" });
    const a = abrir(R1);
    await dormir(30);
    const historial = historialDatos.construirHistorial(a.v.numeros, { auditoria: [], auditoriaDisponible: false, actividad: [], archivo: [], contactos: [] }, estadoEfectivo);
    const filtro = (estado) => historialDatos.numerosCoincidentes(a.v.numeros, historial, { ...historialDatos.FILTROS_HISTORIAL_VACIOS, estado }, estadoEfectivo);
    assert.deepStrictEqual([...filtro("reservado")], ["03"]);
    assert.deepStrictEqual([...filtro("pagado")], ["04"]);
    assert.deepStrictEqual([...filtro("bloqueado")], ["05"]);
    assert.strictEqual(filtro("libre").size, 97);
    const consultasAntes = db.consultas.length;
    const g = dibujar(a.v.numeros, { atenuarLibres: false, coincidentes: filtro("pagado") });
    assert.strictEqual(g.celdas, 1);
    assert.strictEqual(a.v.numeros.length, 100, "filtrar no quita números de los datos");
    assert.strictEqual(db.consultas.length, consultasAntes, "filtrar no consulta al servidor");
    assert.strictEqual(dibujar(a.v.numeros, { atenuarLibres: false }).celdas, 100, "«Todos» vuelve a mostrar los 100");
    a.control.cerrar();
});

await prueba("5. reservar, pagar y liberar actualizan la cuadrícula releyendo SOLO el número operado", async () => {
    const a = abrir(R1);
    await dormir(30);
    const completas = lecturasCompletas(R1);
    const pintadoSinCambio = a.v.numeros.find(f => f.numero === "11");
    for (const [cambios, esperado] of [
        [{ estado: "reservado", comprador: "Caro", reservado_en: "2026-11-12T17:00:00Z" }, "reservado"],
        [{ estado: "pagado", pagado_en: "2026-11-12T17:30:00Z" }, "pagado"],
        [{ estado: "libre", comprador: null, reservado_en: null, pagado_en: null }, "libre"]
    ]) {
        cambiar(R1, 10, cambios);           // lo que hace el backend
        await a.control.trasOperacion(["10"]); // lo que hace el panel al responder
        assert.strictEqual(estadoDe(a.v, "10"), esperado);
        assert.strictEqual(a.v.loading, false, "sin pantalla de carga en una actualización pequeña");
    }
    assert.strictEqual(lecturasCompletas(R1), completas, "ninguna lectura completa de la tabla por operar");
    assert.strictEqual(a.v.numeros.find(f => f.numero === "11"), pintadoSinCambio, "los demás números no se vuelven a crear");
    assert.strictEqual(a.v.numeros.length, 100);
    // También por tiempo real (operación hecha desde el bot u otra pestaña).
    const nueva = cambiar(R1, 20, { estado: "reservado", comprador: "Dani", reservado_en: "2026-11-12T18:00:00Z" });
    emitir("numeros_rifa", { eventType: "UPDATE", new: nueva });
    await dormir(20);
    assert.strictEqual(estadoDe(a.v, "20"), "reservado");
    assert.strictEqual(lecturasCompletas(R1), completas, "el aviso completo se aplica sin consultar");
    a.control.cerrar();
});

await prueba("6. aislamiento: dos tablas del MISMO precio no se mezclan", async () => {
    const a = abrir(R1), b = abrir(R2);
    await dormir(30);
    const nueva = cambiar(R2, 7, { estado: "pagado", comprador: "Eva", reservado_en: "2026-11-12T15:00:00Z", pagado_en: "2026-11-12T16:00:00Z" });
    emitir("numeros_rifa", { eventType: "UPDATE", new: nueva });
    await dormir(20);
    assert.strictEqual(estadoDe(b.v, "07"), "pagado");
    assert.strictEqual(estadoDe(a.v, "07"), "libre", "el 07 de la otra tabla de $2.000 no aparece en esta");
    const antes = lecturasDe(R1);
    await b.control.trasOperacion(["07"]);
    assert.strictEqual(lecturasDe(R1), antes, "operar en R2 no consulta R1");
    const canalesNumeros = [...canalesAbiertos].flatMap(c => c.binds).filter(x => x.cfg.table === "numeros_rifa").map(x => x.cfg.filter);
    assert.deepStrictEqual(canalesNumeros.sort(), [`tabla_id=eq.${R1}`, `tabla_id=eq.${R2}`].sort(), "Realtime filtrado por tabla_id, un canal por tabla");
    a.control.cerrar(); b.control.cerrar();
});

await prueba("7. volver a la tabla desde otra sección: sin pantalla de carga y sin lecturas repetidas", async () => {
    // Primera visita: lectura inicial + validación tras conectar (2 completas).
    const a = abrir(R1);
    await dormir(30);
    assert.strictEqual(lecturasCompletas(R1), 2);
    const clave = hook.claveVistaTabla(R1, 0);
    almacen.guardar(clave, { usuarioId: U, config: fuenteRifa.configDeRifa(a.rifa), rifa: a.rifa, numeros: a.v.numeros, evento: a.v.evento, actividad: a.v.actividad });
    a.control.cerrar();
    assert.strictEqual(canalesAbiertos.size, 0, "al salir no queda ningún canal");

    // Entretanto cambió un número (p. ej. desde el bot).
    cambiar(R1, 30, { estado: "reservado", comprador: "Fer", reservado_en: "2026-11-12T19:00:00Z" });

    // Vuelta: la instantánea en memoria se pinta ya.
    const guardada = hook.leerInstantaneaTabla(clave);
    assert.ok(guardada && guardada.numeros.length === 100, "lo último visto sigue en memoria");
    assert.strictEqual(hook.leerInstantaneaTabla(hook.claveVistaTabla(R2, 0)), null, "otra tabla no tiene la instantánea de esta");
    db.consultas = [];
    const b = abrir(R1, { inicial: { numeros: guardada.numeros, evento: guardada.evento, actividad: guardada.actividad } });
    assert.strictEqual(b.v.numeros.length, 100, "100 números visibles desde el primer instante");
    assert.strictEqual(b.v.loading, false);
    await dormir(30);
    assert.strictEqual(b.v.cargas, 0, "nunca pasó a «cargando»");
    assert.strictEqual(lecturasCompletas(R1), 1, "una sola lectura completa (la validación), no dos");
    assert.strictEqual(estadoDe(b.v, "30"), "reservado", "la validación trae lo que cambió mientras no se miraba");
    assert.strictEqual(b.v.numeros.find(f => f.numero === "31"), guardada.numeros.find(f => f.numero === "31"), "lo que no cambió no se vuelve a pintar");
    const eventosLeidos = db.consultas.filter(c => c.tabla === "eventos_bot").length;
    assert.strictEqual(eventosLeidos, 1, "el sorteo activo también se lee una sola vez");
    b.control.cerrar();

    // Al cambiar de usuario la caché del panel se vacía entera.
    almacen.vaciar();
    assert.strictEqual(hook.leerInstantaneaTabla(clave), null);
});

await prueba("8. tiempo real cortado y recuperado: queda «desactualizada» y al volver valida y recupera lo perdido", async () => {
    const a = abrir(R1);
    await dormir(30);
    const completas = lecturasCompletas(R1);
    const canal = [...canalesAbiertos].find(c => c.binds.some(b => b.cfg.table === "numeros_rifa"));
    canal.alEstado("CHANNEL_ERROR");
    assert.strictEqual(a.v.desactualizada, true);
    // Cambio que se pierde mientras el canal está caído (sin aviso).
    cambiar(R1, 44, { estado: "pagado", comprador: "Gil", reservado_en: "2026-11-12T19:00:00Z", pagado_en: "2026-11-12T19:05:00Z" });
    assert.strictEqual(estadoDe(a.v, "44"), "libre");
    canal.alEstado("SUBSCRIBED");
    await dormir(30);
    assert.strictEqual(estadoDe(a.v, "44"), "pagado", "la validación al reconectar lo recupera");
    assert.strictEqual(a.v.desactualizada, false);
    assert.strictEqual(lecturasCompletas(R1), completas + 1, "UNA lectura completa por reconexión");
    assert.strictEqual(a.v.cargas, 0, "sin pantalla de carga al reconectar");
    assert.strictEqual(a.v.numeros.length, 100, "lo que se veía se conservó durante el corte");
    a.control.cerrar();
});

await prueba("código: la tabla solo se reabre si cambia su identidad y la vista de rifa no atenúa", async () => {
    const src = fs.readFileSync(path.join(FRONT, "hooks/useTablaPrecio.ts"), "utf8");
    assert.match(src, /\}, \[usuarioId, config\?\.tabla, rifa\?\.id, tablaId \? null : precio, tablaId\]\);/, "dependencias por identidad, no por objeto");
    const cierre = src.slice(src.indexOf("control.current = c;"), src.indexOf("// Instantánea en memoria"));
    assert.ok(!/setNumeros\(\[\]\)|setLoading\(true\)/.test(cierre), "cerrar no vacía la cuadrícula ni pone «cargando»");
    assert.match(src, /eventoActivo && \(rifa \? true : Number\(eventoActivo\.valor\) === precio\)/, "en una rifa el sorteo ya es el de su tabla_id");
    const vista = fs.readFileSync(path.join(FRONT, "components/tablas/TablaPrecioView.tsx"), "utf8");
    assert.match(vista, /atenuarLibres=\{!rifa\}/);
    const diseno = fs.readFileSync(path.join(FRONT, "hooks/useTablaDiseno.ts"), "utf8");
    assert.match(diseno, /if \(!\(precio > 0\)\) return;/, "sin consulta de diseño con precio 0 mientras se lee la rifa");
});

console.log(`\n${ok} pruebas OK`);
