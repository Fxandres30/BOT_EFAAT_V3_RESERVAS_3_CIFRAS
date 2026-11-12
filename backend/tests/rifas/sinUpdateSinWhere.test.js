// ==========================================================================
// pg-safeupdate (cargado por PostgREST en Supabase) rechaza con 21000
// «UPDATE requires a WHERE clause» cualquier UPDATE o DELETE sin WHERE,
// también DENTRO de una función llamada por /rpc. Así falló SIEMPRE el
// reinicio de la 030 en producción (auditoría 12/11/2026: reservas_archivo
// con 0 filas) sin que ninguna prueba local lo viera: PGlite y el Postgres
// local no traen esa extensión.
//
// Esta prueba es estática: para cada función, toma su definición VIGENTE (la
// última migración que la crea; las *_revertir* no cuentan) y comprueba que
// ningún UPDATE/DELETE estático de su cuerpo quede sin WHERE. Comprueba
// también que el detector ve el fallo real de la 030 original.
//   node backend/tests/rifas/sinUpdateSinWhere.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "supabase_migrations");

// Quita comentarios y literales de texto (los UPDATE dinámicos de
// execute format('...') no los ve; los estáticos sí).
function limpiar(sql) {
    return sql
        .replace(/--[^\n]*/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/'(?:[^']|'')*'/g, "''");
}

// [{ nombre, cuerpo }] de cada create [or replace] function ... as $tag$ ... $tag$
function funciones(sql) {
    const salida = [];
    const re = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([\s\S]*?)\bas\s+(\$[\w]*\$)([\s\S]*?)\3/gi;
    let m;
    while ((m = re.exec(sql))) salida.push({ nombre: m[1].replace(/"/g, "").toLowerCase(), cuerpo: m[4] });
    return salida;
}

// UPDATE/DELETE sin WHERE dentro de un cuerpo de función.
function sinWhere(cuerpo) {
    const fallos = [];
    for (const sentencia of limpiar(cuerpo).split(";")) {
        const re = /\b(update\s+(?!of\b)[\w."]+\s+set\b|delete\s+from\s+[\w."]+)/gi;
        let m;
        while ((m = re.exec(sentencia))) {
            const resto = sentencia.slice(m.index);
            if (!/\bwhere\b/i.test(resto)) fallos.push(m[1].replace(/\s+/g, " ").slice(0, 80));
        }
    }
    return fallos;
}

const archivos = fs.readdirSync(DIR).filter(f => f.endsWith(".sql") && !/revertir/i.test(f)).sort();

// 1. El detector ve el fallo real de la 030 original.
const f030 = funciones(fs.readFileSync(path.join(DIR, "030_reinicio_tabla_seguro.sql"), "utf8"))
    .find(f => f.nombre === "public.reiniciar_tabla_cliente");
assert.ok(f030, "no se encontró reiniciar_tabla_cliente en la 030");
assert.ok(sinWhere(f030.cuerpo).some(s => /update _filas_reinicio set/i.test(s)), "el detector no ve el UPDATE sin WHERE de la 030");
console.log("✅ el detector encuentra el UPDATE sin WHERE de la 030 original (causa del 21000 en producción)");

// 2. Definición vigente de cada función: la de la última migración.
const vigente = new Map();
for (const archivo of archivos) {
    for (const f of funciones(fs.readFileSync(path.join(DIR, archivo), "utf8"))) vigente.set(f.nombre, { ...f, archivo });
}

const problemas = [];
for (const f of vigente.values()) {
    for (const s of sinWhere(f.cuerpo)) problemas.push(`${f.archivo} ${f.nombre}: «${s}»`);
}

assert.ok(vigente.get("public.reiniciar_tabla_cliente")?.archivo.startsWith("054"), "la definición vigente de reiniciar_tabla_cliente debe ser la de la 054");
assert.deepStrictEqual(problemas, [], `UPDATE/DELETE sin WHERE en funciones vigentes:\n${problemas.join("\n")}`);
console.log(`✅ ${vigente.size} funciones vigentes en ${archivos.length} migraciones: ningún UPDATE/DELETE estático sin WHERE (pg-safeupdate)`);
