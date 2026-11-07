#!/usr/bin/env node
// ==========================================================================
// Análisis de los registros «[MENSAJES SOMBRA]» del orquestador central.
// SOLO LECTURA LOCAL: lee archivos de log (o la entrada estándar). No
// conecta a Supabase, no usa la red, no envía nada.
//
//   node scripts/analizarSombra.js <archivo.log> [más archivos…] [opciones]
//   pm2 logs <APP> --lines 20000 --nostream | node scripts/analizarSombra.js
//
// Opciones:
//   --origen=<o>           solo ese origen (inicio_dia, automatizacion,
//                          respuesta, sorteo, compartir, reaccion)
//   --desde=<ISO>          solo líneas con marca de tiempo >= esa fecha
//                          (si la línea no tiene marca, se incluye)
//   --ejemplos=<n>         ejemplos por motivo de diferencia (3 por defecto)
//   --json                 salida en JSON (para guardar o comparar)
//
// Cuenta por origen: comparaciones, coincidencias, diferencias, no
// comparables (sin cliente de sesión), textos no comparables (IA), errores
// del orquestador, comparaciones omitidas por fallo del módulo, motivos
// más frecuentes y ejemplos. Las líneas ya vienen sin teléfonos ni JID
// (huellas y vistas previas tapadas); este script no añade nada sensible.
// ==========================================================================

"use strict";

const fs = require("fs");

const MARCA = "[MENSAJES SOMBRA] ";
const OMITIDA = /\[MENSAJES SOMBRA\]\s+([a-z_]+): comparación omitida:\s*(.*)$/;
const FECHA = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;
const ORIGENES = ["inicio_dia", "automatizacion", "respuesta", "sorteo", "compartir", "reaccion"];

function nuevoOrigen() {
    return { comparaciones: 0, coinciden: 0, difieren: 0, noComparables: 0, textoNoComparable: 0, errores: 0, omitidas: 0, ilegibles: 0, motivos: {}, tipos: {}, ejemplos: {}, primera: null, ultima: null };
}

function marcaDeTiempo(linea) {
    const m = linea.slice(0, linea.indexOf("[MENSAJES SOMBRA]")).match(FECHA);
    return m ? m[1] : null;
}

// Resumen breve y seguro de una entrada (para los ejemplos).
function ejemplo(e, fecha) {
    return {
        fecha,
        tipo: e.tipo ?? null,
        motivo: e.motivo ?? null,
        usuarioId: e.usuarioId ?? null,
        actual: e.actual ? { estado: e.actual.estado ?? null, plantillaId: e.actual.plantillaId ?? null, fuente: e.actual.fuente ?? null, vistaPrevia: e.actual.vistaPrevia ?? null } : null,
        orquestador: e.orquestador ? { estado: e.orquestador.estado ?? null, motivo: e.orquestador.motivo ?? null, plantillaId: e.orquestador.plantillaId ?? null, vistaPrevia: e.orquestador.vistaPrevia ?? null } : null,
        diferencias: e.diferencias ?? null
    };
}

function analizar(lineas, { origen = null, desde = null, ejemplos = 3 } = {}) {

    const porOrigen = {};
    const total = { lineas: 0, comparaciones: 0, omitidas: 0, ilegibles: 0 };
    const desdeMs = desde ? Date.parse(desde) : null;
    const de = (o) => (porOrigen[o] = porOrigen[o] || nuevoOrigen());

    for (const linea of lineas) {

        if (!linea || !linea.includes("[MENSAJES SOMBRA]")) continue;

        const fecha = marcaDeTiempo(linea);
        if (desdeMs != null && fecha && Date.parse(fecha) < desdeMs) continue;
        total.lineas++;

        const omitida = linea.match(OMITIDA);
        if (omitida) {
            if (origen && omitida[1] !== origen) continue;
            de(omitida[1]).omitidas++;
            total.omitidas++;
            continue;
        }

        const i = linea.indexOf(MARCA);
        let e;
        try { e = JSON.parse(linea.slice(i + MARCA.length)); } catch { total.ilegibles++; continue; }

        const o = e.origen || "desconocido";
        if (origen && o !== origen) continue;
        const r = de(o);
        total.comparaciones++;
        r.comparaciones++;
        if (fecha) { r.primera = r.primera && r.primera < fecha ? r.primera : fecha; r.ultima = r.ultima && r.ultima > fecha ? r.ultima : fecha; }
        if (e.tipo) r.tipos[e.tipo] = (r.tipos[e.tipo] || 0) + 1;

        const esError = Boolean(e.error) || String(e.motivo || "").startsWith("error_orquestador") || e.orquestador?.estado === "error";
        if (esError) r.errores++;
        if (e.textoComparable === false) r.textoNoComparable++;

        if (e.coincide === true) r.coinciden++;
        else if (e.coincide === null || String(e.motivo || "").startsWith("no_comparable")) r.noComparables++;
        else {
            r.difieren++;
            const motivo = e.motivo || (e.error ? `error:${e.error}` : "sin_motivo");
            r.motivos[motivo] = (r.motivos[motivo] || 0) + 1;
            r.ejemplos[motivo] = r.ejemplos[motivo] || [];
            if (r.ejemplos[motivo].length < ejemplos) r.ejemplos[motivo].push(ejemplo(e, fecha));
        }
    }

    for (const r of Object.values(porOrigen)) {
        const comparables = r.coinciden + r.difieren;
        r.porcentajeCoincidencia = comparables ? Math.round((r.coinciden / comparables) * 10000) / 100 : null;
    }

    return { total, porOrigen };
}

function formatear({ total, porOrigen }) {
    const out = [];
    out.push(`Líneas [MENSAJES SOMBRA]: ${total.lineas} · comparaciones: ${total.comparaciones} · omitidas por fallo: ${total.omitidas} · ilegibles: ${total.ilegibles}`);
    const orden = [...ORIGENES, ...Object.keys(porOrigen).filter(o => !ORIGENES.includes(o))];
    for (const o of orden) {
        const r = porOrigen[o];
        if (!r) { out.push(`\n■ ${o}: sin registros`); continue; }
        out.push(`\n■ ${o}${r.primera ? `  (${r.primera} → ${r.ultima})` : ""}`);
        out.push(`  comparaciones ${r.comparaciones} · coinciden ${r.coinciden} · difieren ${r.difieren} · coincidencia ${r.porcentajeCoincidencia ?? "—"}%`);
        out.push(`  no comparables ${r.noComparables} · texto no comparable (IA) ${r.textoNoComparable} · errores ${r.errores} · omitidas ${r.omitidas}`);
        const tipos = Object.entries(r.tipos).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(" · ");
        if (tipos) out.push(`  tipos: ${tipos}`);
        const motivos = Object.entries(r.motivos).sort((a, b) => b[1] - a[1]);
        for (const [m, n] of motivos) {
            out.push(`  ▸ ${m}: ${n}`);
            for (const ej of r.ejemplos[m] || []) {
                out.push(`      · ${ej.fecha || "sin fecha"} ${ej.tipo || ""} actual=[${ej.actual?.estado ?? "?"}|${ej.actual?.plantillaId ?? "-"}] «${ej.actual?.vistaPrevia ?? ""}» orquestador=[${ej.orquestador?.estado ?? "?"}|${ej.orquestador?.plantillaId ?? "-"}] «${ej.orquestador?.vistaPrevia ?? ""}»`);
            }
        }
    }
    return out.join("\n");
}

function opciones(argv) {
    const o = { archivos: [], origen: null, desde: null, ejemplos: 3, json: false };
    for (const a of argv) {
        if (a === "--json") o.json = true;
        else if (a.startsWith("--origen=")) o.origen = a.slice(9);
        else if (a.startsWith("--desde=")) o.desde = a.slice(8);
        else if (a.startsWith("--ejemplos=")) o.ejemplos = Math.max(0, Number(a.slice(11)) || 0);
        else if (a === "-h" || a === "--ayuda") o.ayuda = true;
        else o.archivos.push(a);
    }
    return o;
}

async function leerEntrada(archivos) {
    if (archivos.length) return archivos.flatMap(f => fs.readFileSync(f, "utf8").split(/\r?\n/));
    if (process.stdin.isTTY) return [];
    const trozos = [];
    for await (const t of process.stdin) trozos.push(t);
    return Buffer.concat(trozos).toString("utf8").split(/\r?\n/);
}

async function main() {
    const o = opciones(process.argv.slice(2));
    if (o.ayuda) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 23).join("\n")); return; }
    const lineas = await leerEntrada(o.archivos);
    if (!lineas.length) { console.error("Sin entrada: indica un archivo de log o envía los logs por la entrada estándar (ver --ayuda)."); process.exitCode = 1; return; }
    const res = analizar(lineas, o);
    console.log(o.json ? JSON.stringify(res, null, 2) : formatear(res));
}

if (require.main === module) main();

module.exports = { analizar, formatear, opciones };
