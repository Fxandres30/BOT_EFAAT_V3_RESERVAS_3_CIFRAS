// ==========================================================================
// Preparación de la activación — pruebas del script de análisis
// scripts/analizarSombra.js.
//
// Las líneas se generan con las funciones de sombra REALES (para que el
// script entienda exactamente el formato que producen), con prefijos de
// PM2 y marcas de tiempo, más líneas de «comparación omitida» e ilegibles.
//
//     node backend/tests/mensajes-o6/analizarSombra.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { r, inyectar } = require("../mensajes-o0/_comun");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

inyectar(r("lib/supabase.js"), { from() { throw new Error("Supabase no permitido"); } });

const { analizar, formatear, opciones } = require(r("scripts/analizarSombra.js"));
const { compararInicioDiaEnSombra } = require(r("automation/sombraInicioDia.js"));

const ENTORNO = { MENSAJES_ORQUESTADOR_INICIO_DIA: "shadow" };
const repo = { obtenerPlantillasHabilitadas: async () => [{ id: "p1", usuario_id: "u-A", contenido: "Hola" }, { id: "p2", usuario_id: "u-A", contenido: "Adiós" }] };

async function lineasReales() {
    const lineas = [];
    const log = (l) => lineas.push(`0|efaat-bot  | 2026-11-09T13:0${lineas.length}:00.000Z: ${l}`);
    // coincide
    await compararInicioDiaEnSombra({ usuarioId: "u-A", grupoId: "573001112233-1@g.us", fecha: "2026-11-09", azar: 0, candidatasActuales: ["p1", "p2"], actual: { enviado: true, texto: "Hola", plantillaId: "p1" }, repo, entorno: ENTORNO, log });
    // texto distinto (x2)
    for (let i = 0; i < 2; i++) await compararInicioDiaEnSombra({ usuarioId: "u-A", grupoId: "573001112233-1@g.us", fecha: "2026-11-09", azar: 0, candidatasActuales: ["p1", "p2"], actual: { enviado: true, texto: "Paga al 3001234567", plantillaId: "p1" }, repo, entorno: ENTORNO, log });
    return lineas;
}

const sinteticas = [
    `0|efaat-bot  | 2026-11-09T14:00:00.000Z: [MENSAJES SOMBRA] ${JSON.stringify({ origen: "respuesta", tipo: "info_evento", coincide: true, textoComparable: false })}`,
    `0|efaat-bot  | 2026-11-09T14:01:00.000Z: [MENSAJES SOMBRA] ${JSON.stringify({ origen: "respuesta", tipo: "reserva_completa", coincide: null, motivo: "no_comparable:sin_usuario_de_sesion" })}`,
    `0|efaat-bot  | 2026-11-09T14:02:00.000Z: [MENSAJES SOMBRA] ${JSON.stringify({ origen: "respuesta", tipo: "reserva_completa", coincide: false, motivo: "error_orquestador:sesion_de_otro_cliente", orquestador: { estado: "error" } })}`,
    `0|efaat-bot  | 2026-11-09T14:03:00.000Z: [MENSAJES SOMBRA] ${JSON.stringify({ origen: "automatizacion", error: "lectura caída" })}`,
    "0|efaat-bot  | 2026-11-09T14:04:00.000Z: ⚠️ [MENSAJES SOMBRA] compartir: comparación omitida: explotó",
    "0|efaat-bot  | 2026-11-09T14:05:00.000Z: [MENSAJES SOMBRA] {esto no es json",
    "0|efaat-bot  | 2026-11-09T14:06:00.000Z: 🤖 [AUTOMATION] línea ajena que se ignora",
    "2026-11-01T00:00:00.000Z: [MENSAJES SOMBRA] " + JSON.stringify({ origen: "reaccion", coincide: true })
];

prueba("AS1 cuenta coincidencias, diferencias, motivos y porcentaje con líneas REALES de la sombra", async () => {
    const res = analizar(await lineasReales());
    const r0 = res.porOrigen.inicio_dia;
    assert.deepStrictEqual([r0.comparaciones, r0.coinciden, r0.difieren, r0.porcentajeCoincidencia], [3, 1, 2, 33.33]);
    assert.deepStrictEqual(r0.motivos, { texto_distinto: 2 });
    assert.strictEqual(r0.ejemplos.texto_distinto[0].actual.vistaPrevia, "Paga al •••");
    assert.deepStrictEqual([r0.primera, r0.ultima], ["2026-11-09T13:00:00.000Z", "2026-11-09T13:02:00.000Z"]);
});

prueba("AS2 clasifica no comparables, IA, errores, omitidas e ilegibles; ignora líneas ajenas", () => {
    const res = analizar(sinteticas);
    const resp = res.porOrigen.respuesta;
    assert.deepStrictEqual([resp.comparaciones, resp.coinciden, resp.noComparables, resp.difieren, resp.errores, resp.textoNoComparable], [3, 1, 1, 1, 1, 1]);
    assert.deepStrictEqual([res.porOrigen.automatizacion.errores, res.porOrigen.automatizacion.difieren], [1, 1]);
    assert.strictEqual(res.porOrigen.compartir.omitidas, 1);
    assert.deepStrictEqual([res.total.ilegibles, res.total.omitidas, res.total.lineas], [1, 1, 7]);
});

prueba("AS3 filtros --origen y --desde; límite de ejemplos", async () => {
    const lineas = [...(await lineasReales()), ...sinteticas];
    assert.deepStrictEqual(Object.keys(analizar(lineas, { origen: "respuesta" }).porOrigen), ["respuesta"]);
    assert.strictEqual(analizar(lineas, { desde: "2026-11-05T00:00:00Z" }).porOrigen.reaccion, undefined);
    assert.strictEqual(analizar(lineas, { ejemplos: 1 }).porOrigen.inicio_dia.ejemplos.texto_distinto.length, 1);
    assert.deepStrictEqual(opciones(["a.log", "--origen=sorteo", "--json", "--ejemplos=5"]), { archivos: ["a.log"], origen: "sorteo", desde: null, ejemplos: 5, json: true });
});

prueba("AS4 el informe legible lista los seis orígenes y no contiene teléfonos", async () => {
    const texto = formatear(analizar([...(await lineasReales()), ...sinteticas]));
    for (const o of ["inicio_dia", "automatizacion", "respuesta", "sorteo", "compartir", "reaccion"]) assert.ok(texto.includes(`■ ${o}`), o);
    assert.ok(texto.includes("sorteo: sin registros"));
    assert.ok(!/\d{7,}/.test(texto.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "")), texto);
});

prueba("AS5 la línea de órdenes funciona con archivo y con la entrada estándar (sin red ni Supabase)", async () => {
    const archivo = path.join(os.tmpdir(), `sombra-${process.pid}.log`);
    fs.writeFileSync(archivo, [...(await lineasReales()), ...sinteticas].join("\n"));
    try {
        const conArchivo = spawnSync(process.execPath, [r("scripts/analizarSombra.js"), archivo, "--json"], { encoding: "utf8" });
        assert.strictEqual(conArchivo.status, 0, conArchivo.stderr);
        assert.strictEqual(JSON.parse(conArchivo.stdout).porOrigen.inicio_dia.difieren, 2);
        const conEntrada = spawnSync(process.execPath, [r("scripts/analizarSombra.js")], { input: fs.readFileSync(archivo, "utf8"), encoding: "utf8" });
        assert.strictEqual(conEntrada.status, 0, conEntrada.stderr);
        assert.ok(conEntrada.stdout.includes("■ inicio_dia"));
    } finally { fs.unlinkSync(archivo); }
});

prueba("AS6 el script no importa Supabase, Baileys ni nada de red", () => {
    const fuente = fs.readFileSync(r("scripts/analizarSombra.js"), "utf8");
    const reqs = [...fuente.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1]);
    assert.deepStrictEqual(reqs, ["fs"]);
});

ejecutar("Preparación · script de análisis de la sombra");
