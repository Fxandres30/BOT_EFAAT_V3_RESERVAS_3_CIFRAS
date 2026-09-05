// Migración de las 66 plantillas SEGURO (Fase 2) a las variables
// gramaticales centrales de gramatica.js/plantillaMensaje.js.
//
// SOLO toca la columna "contenido" de "plantillas_mensaje", SOLO para las
// 66 filas clasificadas SEGURO en _migracion_propuesta_fase2.js, SIEMPRE
// por "id" exacto (nunca por nombre). No toca habilitada, tipo_respuesta,
// nombre, id, ninguna otra columna, ninguna otra tabla, ni la lógica del
// BOT (detectarReserva, detectarIntencion, seleccionarPlantilla,
// configMensajes, responderResultado quedan intactos).
//
// MODOS:
//   node _migrar_plantillas_seguras.js            -> DRY-RUN (solo lee, no escribe)
//   node _migrar_plantillas_seguras.js --apply     -> pide confirmación y ejecuta el UPDATE real
// Carga explícita de backend/.env por RUTA ABSOLUTA (no relativa al cwd
// desde el que se invoque el script) — así funciona igual si se ejecuta
// como "node _migrar_plantillas_seguras.js" (cwd=backend) o como
// "node backend/_migrar_plantillas_seguras.js" (cwd=raíz del repo), sin
// mover ni copiar el .env real de backend/.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const readline = require("readline");
const { execFileSync } = require("child_process");
const supabase = require("./lib/supabase");
const propuestas = require("./_migracion_propuesta_fase2.js");
const { construirVariables } = require("./bot/ai/plantillaMensaje.js");

const APPLY = process.argv.includes("--apply");

const TOTAL_ESPERADO = 151;
const SEGURO_ESPERADO = 66;
const NO_APLICA_ESPERADO = 85;
const REQUIERE_ESPERADO = 0;

const MIGRACIONES = propuestas
    .filter(f => f.clasificacion === "SEGURO")
    .map(f => ({ id: f.id, tipo: f.tipo, nombre: f.nombre, habilitada: f.habilitada, antes: f.antes, despues: f.propuesto }));

const NO_APLICA = propuestas.filter(f => f.clasificacion === "NO_APLICA");
const REQUIERE = propuestas.filter(f => f.clasificacion === "REQUIERE_REVISION");

function linea(c = "=") {
    console.log(c.repeat(72));
}

function extraerVariables(plantilla) {
    const nombres = new Set();
    (plantilla.match(/\{\{\s*(\w+)\s*\}\}/g) || []).forEach(m => nombres.add(m.replace(/[{}]/g, "").trim()));
    return nombres;
}

// Genera el conjunto COMPLETO de nombres de variable que
// plantillaMensaje.js puede llegar a producir. construirVariables() SIEMPRE
// calcula las tres cantidades independientes (reservados/ocupados/
// disponibles) y SIEMPRE las expone (con valor 0 si no aplica) — por eso un
// solo ctx representativo (con las tres listas no vacías) alcanza para
// obtener el diccionario completo de claves posibles, sin adivinar nombres
// a mano ni duplicar la lista en este script.
function obtenerVariablesConocidas() {

    const ctx = {
        usuario: { nombre: "X" },
        evento: { nombre_evento: "X", fecha_evento: "X", hora_fin: "X", valor: 1 },
        textoOriginal: "10 20 30",
        reserva: { ok: true, reservados: ["10"], ocupados: ["20", "30"], mensaje: "" }
    };

    return new Set(Object.keys(construirVariables(ctx, ctx.reserva)));

}

function preguntar(pregunta) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(pregunta, respuesta => { rl.close(); resolve(respuesta.trim()); }));
}

function ejecutarTests(archivos) {
    const resultados = {};
    for (const archivo of archivos) {
        try {
            execFileSync(process.execPath, [path.join(__dirname, archivo)], { stdio: "inherit" });
            resultados[archivo] = "PASS";
        } catch (e) {
            resultados[archivo] = "FAIL";
        }
    }
    return resultados;
}

async function main() {

    linea();
    console.log(APPLY ? "MODO: --apply  (VA A ESCRIBIR EN SUPABASE, tras confirmación)" : "MODO: DRY-RUN  (solo lectura, NINGÚN cambio se escribe)");
    linea();

    // ---------- 0) Integridad del propio dataset de migración ----------
    console.log(`\nMigraciones SEGURO cargadas: ${MIGRACIONES.length} (esperado ${SEGURO_ESPERADO})`);
    console.log(`NO_APLICA cargadas: ${NO_APLICA.length} (esperado ${NO_APLICA_ESPERADO})`);
    console.log(`REQUIERE_REVISION cargadas: ${REQUIERE.length} (esperado ${REQUIERE_ESPERADO})`);
    console.log(`Total filas en el dataset: ${propuestas.length} (esperado ${TOTAL_ESPERADO})`);

    if (
        MIGRACIONES.length !== SEGURO_ESPERADO ||
        NO_APLICA.length !== NO_APLICA_ESPERADO ||
        REQUIERE.length !== REQUIERE_ESPERADO ||
        propuestas.length !== TOTAL_ESPERADO
    ) {
        console.error("\n❌ ABORTADO: la distribución del dataset (_migracion_propuesta_fase2.js) no coincide con lo verificado en Fase 2. No se consultó ni se tocó Supabase.");
        process.exit(1);
    }

    const idsUnicosDataset = new Set(propuestas.map(p => p.id));
    if (idsUnicosDataset.size !== propuestas.length) {
        console.error("\n❌ ABORTADO: hay ids duplicados dentro de _migracion_propuesta_fase2.js.");
        process.exit(1);
    }

    // ---------- 1) Variables usadas deben existir en plantillaMensaje.js ----------
    const variablesConocidas = obtenerVariablesConocidas();
    const desconocidas = [];

    for (const m of MIGRACIONES) {
        for (const v of extraerVariables(m.despues)) {
            if (!variablesConocidas.has(v)) {
                desconocidas.push({ id: m.id, nombre: m.nombre, variable: v });
            }
        }
    }

    if (desconocidas.length) {
        console.error(`\n❌ ABORTADO: ${desconocidas.length} variable(s) desconocida(s) en las propuestas (no existen en plantillaMensaje.js/gramatica.js):`);
        desconocidas.forEach(d => console.error(`   [${d.id}] "${d.nombre}": {{${d.variable}}}`));
        process.exit(1);
    }

    console.log(`\n✅ Todas las variables referenciadas en las 66 propuestas existen en plantillaMensaje.js/gramatica.js (${variablesConocidas.size} variables conocidas en total).`);

    // ---------- 2) Leer las 66 filas reales de Supabase ----------
    const idsSeguro = MIGRACIONES.map(m => m.id);

    const { data: filasSeguro, error: errorSeguro } = await supabase
        .from("plantillas_mensaje")
        .select("id, tipo_respuesta, nombre, contenido, habilitada")
        .in("id", idsSeguro);

    if (errorSeguro) {
        console.error("\n❌ ABORTADO: error consultando Supabase:", errorSeguro.message);
        process.exit(1);
    }

    console.log(`\nFilas encontradas en Supabase para los ${idsSeguro.length} ids SEGURO: ${filasSeguro.length} (esperado ${SEGURO_ESPERADO})`);

    if (filasSeguro.length !== SEGURO_ESPERADO) {
        const encontrados = new Set(filasSeguro.map(f => f.id));
        const faltantes = idsSeguro.filter(id => !encontrados.has(id));
        console.error(`\n❌ ABORTADO: se esperaban ${SEGURO_ESPERADO} filas y Supabase devolvió ${filasSeguro.length}.`);
        faltantes.forEach(id => console.error("   FALTA en Supabase:", id));
        process.exit(1);
    }

    const idsDevueltosUnicos = new Set(filasSeguro.map(f => f.id));
    if (idsDevueltosUnicos.size !== filasSeguro.length) {
        console.error("\n❌ ABORTADO: Supabase devolvió ids duplicados para la consulta de las 66 filas SEGURO.");
        process.exit(1);
    }

    const porId = Object.fromEntries(filasSeguro.map(f => [f.id, f]));

    // Sanity extra: tipo/nombre deben coincidir con lo auditado (adicional
    // a comparar por id — detecta el caso improbable de que un id se haya
    // reasignado a otra fila).
    const metadatosInconsistentes = [];
    for (const m of MIGRACIONES) {
        const fila = porId[m.id];
        if (fila.tipo_respuesta !== m.tipo || fila.nombre !== m.nombre) {
            metadatosInconsistentes.push({ id: m.id, esperadoTipo: m.tipo, realTipo: fila.tipo_respuesta, esperadoNombre: m.nombre, realNombre: fila.nombre });
        }
    }
    if (metadatosInconsistentes.length) {
        console.error(`\n❌ ABORTADO: ${metadatosInconsistentes.length} fila(s) cambiaron de tipo_respuesta/nombre desde la auditoría (mismo id, metadatos distintos):`);
        metadatosInconsistentes.forEach(d => console.error(`   [${d.id}] tipo esperado="${d.esperadoTipo}" real="${d.realTipo}" | nombre esperado="${d.esperadoNombre}" real="${d.realNombre}"`));
        process.exit(1);
    }

    // ---------- 3) Vista previa completa ----------
    linea();
    console.log(`VISTA PREVIA — ${MIGRACIONES.length} migraciones SEGURO`);
    linea();

    for (const m of MIGRACIONES) {
        console.log(`\n[${m.tipo}] "${m.nombre}"  (id=${m.id}, habilitada=${porId[m.id].habilitada})`);
        console.log(`  ANTES:     ${JSON.stringify(porId[m.id].contenido)}`);
        console.log(`  PROPUESTO: ${JSON.stringify(m.despues)}`);
    }

    // ---------- 4) Comprobación estricta: contenido real === "antes" auditado ----------
    const discrepancias = [];
    for (const m of MIGRACIONES) {
        const fila = porId[m.id];
        if (fila.contenido !== m.antes) {
            discrepancias.push({ id: m.id, nombre: m.nombre, esperado: m.antes, real: fila.contenido });
        }
    }

    linea();
    console.log("COMPROBACIÓN ESTRICTA (contenido real de Supabase vs. \"antes\" auditado)");
    linea();

    if (discrepancias.length) {
        console.error(`\n❌ ABORTADO: ${discrepancias.length} plantilla(s) cambiaron en Supabase desde la auditoría de Fase 2 — el contenido real ya NO coincide con el "antes" registrado. No se ejecutó ningún UPDATE.`);
        discrepancias.forEach(d => {
            console.error(`\n   [${d.id}] "${d.nombre}"`);
            console.error(`     esperado ("antes" auditado): ${JSON.stringify(d.esperado)}`);
            console.error(`     real (Supabase ahora mismo): ${JSON.stringify(d.real)}`);
        });
        process.exit(1);
    }

    console.log(`✅ Las ${MIGRACIONES.length} filas coinciden EXACTAMENTE (byte a byte) con el contenido auditado en Fase 2. Seguro proceder.`);

    if (!APPLY) {
        linea();
        console.log("DRY-RUN completo. NINGÚN cambio fue escrito en Supabase.");
        console.log("Para aplicar de verdad: node _migrar_plantillas_seguras.js --apply");
        linea();
        return;
    }

    // ---------- 5) Confirmación explícita ----------
    const respuesta = await preguntar(`\nSE VAN A ACTUALIZAR ${MIGRACIONES.length} PLANTILLAS. ¿CONTINUAR? (escribe SI)\n> `);

    if (respuesta !== "SI") {
        console.log("\nAbortado: no se recibió \"SI\" exacto. No se ejecutó ningún UPDATE.");
        process.exit(1);
    }

    // ---------- 6) UPDATE uno por uno, SOLO columna "contenido", por id exacto ----------
    linea();
    console.log("APLICANDO ACTUALIZACIONES");
    linea();

    const actualizadas = [];
    const noActualizadas = [];

    for (const m of MIGRACIONES) {

        const { error: errorUpdate } = await supabase
            .from("plantillas_mensaje")
            .update({ contenido: m.despues }) // SOLO esta columna — nunca habilitada/tipo/nombre/id/otras
            .eq("id", m.id);

        if (errorUpdate) {
            console.log(`❌ [${m.id}] "${m.nombre}": ${errorUpdate.message}`);
            noActualizadas.push({ id: m.id, nombre: m.nombre, error: errorUpdate.message });
        } else {
            console.log(`✅ [${m.id}] "${m.nombre}" actualizada.`);
            actualizadas.push(m);
        }

    }

    // ---------- 7) Re-consultar las 151 filas ----------
    console.log("\nRe-consultando las 151 filas para la verificación post-migración...");

    const todosIds = propuestas.map(p => p.id);
    const { data: todasLasFilas, error: errorTodas } = await supabase
        .from("plantillas_mensaje")
        .select("id, tipo_respuesta, nombre, contenido, habilitada")
        .in("id", todosIds);

    if (errorTodas) {
        console.error("⚠️ No se pudieron re-consultar las 151 filas:", errorTodas.message);
    }

    const porIdFinal = Object.fromEntries((todasLasFilas || []).map(f => [f.id, f]));

    // ---------- 8) Verificación post-migración ----------
    linea();
    console.log("VERIFICACIÓN POST-MIGRACIÓN");
    linea();

    let okSeguras = 0;
    const malSeguras = [];
    for (const m of MIGRACIONES) {
        const fila = porIdFinal[m.id];
        if (fila && fila.contenido === m.despues) okSeguras++;
        else malSeguras.push({ id: m.id, nombre: m.nombre, esperado: m.despues, real: fila?.contenido });
    }
    console.log(`SEGURO con texto ya actualizado en Supabase: ${okSeguras}/${MIGRACIONES.length}`);

    let okNoAplica = 0;
    const malNoAplica = [];
    for (const n of NO_APLICA) {
        const fila = porIdFinal[n.id];
        if (fila && fila.contenido === n.antes) okNoAplica++;
        else malNoAplica.push({ id: n.id, nombre: n.nombre, esperado: n.antes, real: fila?.contenido });
    }
    console.log(`NO_APLICA que permanecen SIN cambios: ${okNoAplica}/${NO_APLICA.length}`);

    if (malSeguras.length) {
        console.log(`\n⚠️ ${malSeguras.length} fila(s) SEGURO no coinciden con lo esperado tras el UPDATE:`);
        malSeguras.forEach(d => console.log(`   [${d.id}] "${d.nombre}" esperado=${JSON.stringify(d.esperado)} real=${JSON.stringify(d.real)}`));
    }
    if (malNoAplica.length) {
        console.log(`\n⚠️ ${malNoAplica.length} fila(s) NO_APLICA CAMBIARON (no debería pasar — ninguna migración las tocaba):`);
        malNoAplica.forEach(d => console.log(`   [${d.id}] "${d.nombre}" esperado=${JSON.stringify(d.esperado)} real=${JSON.stringify(d.real)}`));
    }

    // ---------- 9) Re-ejecutar la batería de pruebas de gramática ----------
    linea();
    console.log("RE-EJECUTANDO PRUEBAS DE GRAMÁTICA");
    linea();

    const resultadoTests = ejecutarTests([
        "_test_singular_plural.js",
        "_test_gramatica_central.js",
        "_test_gramatica_fase2.js"
    ]);

    // ---------- 10) Reporte final ----------
    linea();
    console.log("REPORTE FINAL");
    linea();
    console.log(`Actualizadas correctamente:      ${actualizadas.length}/${MIGRACIONES.length}`);
    console.log(`No actualizadas (error UPDATE):  ${noActualizadas.length}`);
    console.log(`NO_APLICA sin cambios:           ${okNoAplica}/${NO_APLICA.length}`);
    console.log(`Discrepancias post-UPDATE (SEGURO):    ${malSeguras.length}`);
    console.log(`Discrepancias post-UPDATE (NO_APLICA): ${malNoAplica.length}`);
    console.log("Tests:", resultadoTests);

    if (noActualizadas.length || malSeguras.length || malNoAplica.length || Object.values(resultadoTests).some(r => r !== "PASS")) {
        console.log("\n⚠️ La migración terminó con advertencias — revisar el detalle arriba.");
        process.exitCode = 1;
    } else {
        console.log("\n✅ Migración completa y verificada sin errores.");
    }

}

main().catch(err => {
    console.error("\n💥 ERROR INESPERADO:", err);
    process.exit(1);
});
