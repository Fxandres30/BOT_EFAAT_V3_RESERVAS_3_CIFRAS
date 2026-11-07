// ==========================================================================
// FASE O0 — ayudante común de las pruebas de CARACTERIZACIÓN de mensajes.
//
// Fija el comportamiento ACTUAL de los motores que generan y envían
// mensajes, antes de construir el orquestador central (O1). Nada de este
// directorio cambia código de producción: solo lo ejecuta con Supabase en
// memoria y un socket de WhatsApp simulado.
//
// Garantías: el ejecutor seguro (scripts/pruebas/ejecutar.js) fija
// EFAAT_PRUEBAS=1 y bloquea la red; además cada prueba inyecta su Supabase
// falso en require.cache ANTES de cargar cualquier módulo real.
// ==========================================================================

"use strict";

const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

// --------------------------------------------------------------------------
// Supabase en memoria — solo lo que usan los módulos caracterizados:
// select/eq/neq/is/in/or(col.eq.val,…)/order/limit/maybeSingle/single,
// insert/update. Las tablas se crean al usarlas.
// --------------------------------------------------------------------------
function crearDb(inicial = {}) {

    const tablas = { ...inicial };
    const errores = new Map(); // tabla -> error forzado en la próxima lectura
    const consultas = [];      // [{ tabla, operacion, filtros }]
    let secuencia = 0;

    const filas = (t) => (tablas[t] = tablas[t] || []);

    function cumple(fila, [tipo, c, v]) {
        if (tipo === "eq") return fila[c] === v;
        if (tipo === "neq") return fila[c] !== v;
        if (tipo === "is") return (fila[c] ?? null) === v;
        if (tipo === "in") return v.includes(fila[c]);
        if (tipo === "or") {
            return v.split(",").some(cond => {
                const [col, op, ...resto] = cond.split(".");
                return op === "eq" && String(fila[col]) === resto.join(".");
            });
        }
        return true;
    }

    const client = {
        from(tabla) {
            const filtros = [];
            let operacion = "select";
            let cambios = null;
            let unico = false;
            let orden = null;
            let limite = null;
            const b = {
                select() { return b; },
                eq(c, v) { filtros.push(["eq", c, v]); return b; },
                neq(c, v) { filtros.push(["neq", c, v]); return b; },
                is(c, v) { filtros.push(["is", c, v]); return b; },
                in(c, v) { filtros.push(["in", c, v]); return b; },
                or(v) { filtros.push(["or", null, v]); return b; },
                order(c, o = {}) { orden = { c, asc: o.ascending !== false }; return b; },
                limit(n) { limite = n; return b; },
                maybeSingle() { unico = true; return b; },
                single() { unico = true; return b; },
                insert(x) { operacion = "insert"; cambios = x; return b; },
                update(x) { operacion = "update"; cambios = x; return b; },
                then(ok, ko) {
                    consultas.push({ tabla, operacion, filtros: filtros.map(f => [...f]) });
                    let res;
                    if (errores.has(tabla) && operacion === "select") {
                        res = { data: null, error: errores.get(tabla) };
                        errores.delete(tabla);
                    } else if (operacion === "insert") {
                        const nuevas = (Array.isArray(cambios) ? cambios : [cambios]).map(f => ({ id: `id-${++secuencia}`, ...f }));
                        filas(tabla).push(...nuevas);
                        res = { data: unico ? nuevas[0] : nuevas, error: null };
                    } else {
                        let sel = filas(tabla).filter(f => filtros.every(x => cumple(f, x)));
                        if (operacion === "update") {
                            sel.forEach(f => Object.assign(f, cambios));
                            res = { data: sel, error: null };
                        } else {
                            if (orden) sel = [...sel].sort((a, z) => (a[orden.c] > z[orden.c] ? 1 : a[orden.c] < z[orden.c] ? -1 : 0) * (orden.asc ? 1 : -1));
                            if (limite != null) sel = sel.slice(0, limite);
                            res = { data: unico ? (sel[0] || null) : sel, error: null };
                        }
                    }
                    return Promise.resolve(res).then(ok, ko);
                }
            };
            return b;
        }
    };

    return {
        client,
        tablas,
        consultas,
        filas,
        forzarError: (tabla, error = { message: "fallo simulado" }) => errores.set(tabla, error),
        reiniciarConsultas: () => { consultas.length = 0; }
    };

}

// Silencia los registros de consola de los módulos reales durante fn().
async function silencio(fn) {
    const { log, warn, error, table, dir } = console;
    console.log = console.warn = console.error = console.table = console.dir = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, warn, error, table, dir }); }
}

// Azar determinista: Math.random devuelve los valores dados, en orden.
async function conAzar(valores, fn) {
    const real = Math.random;
    let i = 0;
    Math.random = () => valores[Math.min(i++, valores.length - 1)];
    try { return await fn(); } finally { Math.random = real; }
}

module.exports = { RAIZ, r, inyectar, crearDb, silencio, conAzar };
