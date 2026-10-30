// ==========================================================================
// PRUEBAS (frontend) — Sorteos → Programados: textos de los tres estados y
// de las confirmaciones de cancelar / eliminar (services/sorteos/
// estadosSorteo.ts, módulo puro: sin red ni Supabase).
//
// Comprueba que «Publicado» no se muestra como «terminado», que la
// confirmación de eliminar nombra el sorteo, los grupos, lo publicado y las
// reservas, y que sin poder borrar ofrece la alternativa segura.
//
//     node frontend/tests/sorteos/estadosSorteo.test.mjs
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
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, (spec) => { throw new Error(`módulo no previsto: ${spec}`); });
    return modulo.exports;
}

const E = cargarTs(path.join(FRONT, "services/sorteos/estadosSorteo.ts"));

let total = 0;
let fallidas = 0;
function prueba(nombre, fn) {
    total++;
    try { fn(); console.log(`✅ ${nombre}`); }
    catch (err) { fallidas++; console.log(`❌ ${nombre}\n   ${err.message}`); }
}

const grupo = (extra = {}) => ({ id: "f1", grupo_id: "g1@g.us", nombre: "Grupo 1", estado: "pendiente", en_espera: false, intentos: 0, reintentos_manuales: 0, publicado_en: null, actualizado_en: null, ultimo_error: null, evento: "sin_evento", explicacion: "", intervencion: null, puede_reintentar: false, ...extra });

function sorteo({ estado = "programado", operativo = { estado: "pendiente", reservas: null, detalle: "" }, grupos = [grupo()], reservas = { reservados: 0, pagados: 0, otros: 0, total: 0 }, anticipadas = 0, acciones = {}, eliminacion = { posible: true, bloqueos: [], alternativa: null } } = {}) {
    const cuenta = (e) => grupos.filter(g => g.estado === e).length;
    return {
        id: "s1", estado, version: 2, config: { nombre: "Lotería de Manizales" }, publicar_en: "2026-10-15T15:30:00Z", grupos: [],
        gestion: {
            operativo,
            impacto: { grupos: { total: grupos.length, pendientes: cuenta("pendiente"), publicando: cuenta("publicando"), publicados: cuenta("publicado"), fallidos: cuenta("fallido"), en_revision: cuenta("requiere_revision"), cancelados: cuenta("cancelado"), con_evento: 0 }, reservas, anticipadas },
            acciones: { eliminar: eliminacion.posible, cancelar: false, archivar: false, ...acciones },
            eliminacion,
            grupos
        }
    };
}

prueba("1. «Publicado» (programación) y el estado operativo se nombran por separado", () => {
    const s = sorteo({ estado: "publicado", operativo: { estado: "en_curso", reservas: "abiertas", detalle: "" } });
    assert.strictEqual(E.ESTADO_PROGRAMACION[s.estado].texto, "Publicado");
    assert.strictEqual(E.etiquetaOperativo(s).texto, "Sorteo en curso");
    const cerradas = sorteo({ estado: "publicado", operativo: { estado: "en_curso", reservas: "cerradas", detalle: "" } });
    assert.strictEqual(E.etiquetaOperativo(cerradas).texto, "Reservas cerradas");
    assert.strictEqual(E.etiquetaOperativo(sorteo({ operativo: { estado: "terminado", reservas: "cerradas", detalle: "" } })).texto, "Sorteo terminado");
    assert.strictEqual(E.etiquetaOperativo(sorteo({ operativo: { estado: "cancelado", reservas: null, detalle: "" } })).texto, "Sorteo cancelado");
});

prueba("2. todos los estados tienen texto y tono (programación, grupo y operativo)", () => {
    for (const e of ["borrador", "programado", "publicando", "publicado", "publicado_parcial", "fallido", "cancelado"]) assert.ok(E.ESTADO_PROGRAMACION[e]?.texto, e);
    for (const e of ["pendiente", "publicando", "publicado", "fallido", "requiere_revision", "cancelado"]) assert.ok(E.ESTADO_GRUPO[e]?.texto, e);
    for (const e of ["pendiente", "en_curso", "terminado", "cancelado", "sin_publicar", "desconocido"]) assert.ok(E.ESTADO_OPERATIVO[e]?.texto, e);
    assert.strictEqual(E.etiquetaGrupo(grupo({ en_espera: true })).texto, "En espera");
});

prueba("3b. eliminar con actividad: avisos, qué se borra y qué se conserva; un backend anterior no rompe el resumen", () => {
    const r = E.resumenEliminacion(sorteo({ eliminacion: {
        posible: true, bloqueos: [], alternativa: null, con_actividad: true,
        avisos: ["Hubo 10 intento(s) de publicación: se borra su detalle por grupo."],
        borra: ["La programación y su configuración."], conserva: ["Auditoría."]
    } }));
    assert.deepStrictEqual([r.posible, r.conActividad, r.avisos.length, r.borra.length, r.conserva.length], [true, true, 1, 1, 1]);
    const viejo = E.resumenEliminacion(sorteo({ eliminacion: { posible: true, bloqueos: [], alternativa: null } }));
    assert.deepStrictEqual([viejo.conActividad, viejo.avisos, viejo.borra, viejo.conserva], [false, [], [], []]);
});

prueba("3. eliminar sin actividad: nombre, grupos y la consecuencia (no toca WhatsApp, tabla ni reservas)", () => {
    const r = E.resumenEliminacion(sorteo({ grupos: [grupo(), grupo({ id: "f2", grupo_id: "g2@g.us", nombre: null })] }));
    assert.strictEqual(r.nombre, "Lotería de Manizales");
    assert.deepStrictEqual(r.grupos.map(g => g.nombre), ["Grupo 1", "g2@g.us"]);
    assert.strictEqual(r.publicaciones, 0);
    assert.strictEqual(r.reservas, null);
    assert.strictEqual(r.posible, true);
    assert.ok(/No se envía ni se borra nada en WhatsApp/.test(r.consecuencia));
});

prueba("4. eliminar con publicaciones y reservas: motivos y alternativa segura", () => {
    const s = sorteo({
        estado: "publicado",
        grupos: [grupo({ estado: "publicado", publicado_en: "2026-10-15T15:31:00Z" })],
        reservas: { reservados: 2, pagados: 1, otros: 0, total: 3 },
        eliminacion: { posible: false, bloqueos: ["Se publicó en 1 grupo(s)."], alternativa: "archivar" }
    });
    const r = E.resumenEliminacion(s);
    assert.strictEqual(r.posible, false);
    assert.strictEqual(r.publicaciones, 1);
    assert.strictEqual(r.reservas, "2 reservados · 1 pagado");
    assert.deepStrictEqual(r.bloqueos, ["Se publicó en 1 grupo(s)."]);
    assert.ok(/archivarla/.test(r.consecuencia));
    const cancelar = E.resumenEliminacion(sorteo({ eliminacion: { posible: false, bloqueos: ["x"], alternativa: "cancelar" } }));
    assert.ok(/cancelarla/.test(cancelar.consecuencia));
    assert.strictEqual(E.textoReservas(sorteo({ reservas: { reservados: 1, pagados: 0, otros: 0, total: 1 }, anticipadas: 1 })), "1 reservado (anticipadas)");
});

prueba("5. confirmación de cancelar: pendiente, publicado (no se deshace) y en curso, sin tocar reservas", () => {
    const t = E.textoCancelacion(sorteo({ grupos: [grupo(), grupo({ id: "f2", estado: "publicado" }), grupo({ id: "f3", estado: "publicando" })] }));
    assert.ok(/1 grupo pendiente ya no se publicará/.test(t), t);
    assert.ok(/NO se deshace/.test(t), t);
    assert.ok(/se está publicando ahora/.test(t), t);
    assert.ok(/No se toca ninguna reserva ni pago/.test(t), t);
});

console.log(`\n============================\nTOTAL: ${total}  ✅ PASA: ${total - fallidas}  ❌ FALLA: ${fallidas}\n============================`);
process.exit(fallidas ? 1 : 0);
