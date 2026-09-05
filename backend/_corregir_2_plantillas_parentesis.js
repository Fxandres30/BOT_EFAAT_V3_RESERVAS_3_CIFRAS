// Corrección puntual de SOLO 2 filas de plantillas_mensaje: tenían
// paréntesis manuales alrededor de una variable de números que ahora ya
// devuelve sus propios paréntesis ("( 27 - 45 )"), produciendo doble
// paréntesis. Este script:
//   1) lee las 2 filas por tipo_respuesta+nombre,
//   2) verifica id/tipo/nombre/contenido EXACTOS antes de tocar nada,
//   3) muestra ANTES/DESPUÉS,
//   4) hace UPDATE únicamente de la columna "contenido" en esas 2 filas,
//   5) vuelve a leerlas y verifica que ya no queden paréntesis dobles.
// No toca ninguna otra fila, columna, tabla, ni lógica del BOT.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const supabase = require("./lib/supabase");

const OBJETIVOS = [
    {
        tipo_respuesta: "reserva_parcial",
        nombre: "Buena suerte",
        antesEsperado: "{{numeros_reservados}} {{reservado_reservados}} para ti, {{cliente}}. ¡Suerte con {{ese_esos}}! ({{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}})",
        despues: "{{numeros_reservados}} {{reservado_reservados}} para ti, {{cliente}}. ¡Suerte con {{ese_esos}}! {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}."
    },
    {
        tipo_respuesta: "disponibilidad",
        nombre: "Resumen",
        antesEsperado: "{{disponible_disponibles}} ({{numeros_disponibles}}). {{ocupado_ocupados_ocupados}} ({{numeros_ocupados}}).",
        despues: "{{disponible_disponibles}} {{numeros_disponibles}}. {{ocupado_ocupados_ocupados}} {{numeros_ocupados}}."
    }
];

function linea(c = "=") { console.log(c.repeat(72)); }

async function main() {

    linea();
    console.log("CORRECCIÓN PUNTUAL — 2 plantillas con paréntesis manuales");
    linea();

    // 1) Leer por tipo_respuesta (evita construir un filtro .or() frágil con
    // espacios/comas en "nombre") y filtrar exacto por nombre en JS.
    const tiposUnicos = [...new Set(OBJETIVOS.map(o => o.tipo_respuesta))];

    const { data: candidatasBrutas, error } = await supabase
        .from("plantillas_mensaje")
        .select("id, tipo_respuesta, nombre, contenido, habilitada")
        .in("tipo_respuesta", tiposUnicos);

    if (error) {
        console.error("❌ ABORTADO: error consultando Supabase:", error.message);
        process.exit(1);
    }

    const data = OBJETIVOS.map(obj =>
        candidatasBrutas.find(f => f.tipo_respuesta === obj.tipo_respuesta && f.nombre === obj.nombre)
    ).filter(Boolean);

    console.log(`\nFilas encontradas: ${data.length} (esperadas: ${OBJETIVOS.length})`);

    if (data.length !== OBJETIVOS.length) {
        console.error(`❌ ABORTADO: se esperaban exactamente ${OBJETIVOS.length} filas.`);
        OBJETIVOS.forEach((o, i) => {
            if (!data.find(f => f.tipo_respuesta === o.tipo_respuesta && f.nombre === o.nombre)) {
                console.error(`   FALTA: [${o.tipo_respuesta}] "${o.nombre}"`);
            }
        });
        process.exit(1);
    }

    // 2) Verificación estricta: id único por objetivo + contenido EXACTO
    const emparejadas = [];

    for (const obj of OBJETIVOS) {

        const candidatas = data.filter(f => f.tipo_respuesta === obj.tipo_respuesta && f.nombre === obj.nombre);

        if (candidatas.length !== 1) {
            console.error(`❌ ABORTADO: se esperaba exactamente 1 fila para [${obj.tipo_respuesta}] "${obj.nombre}", se encontraron ${candidatas.length}.`);
            process.exit(1);
        }

        const fila = candidatas[0];

        if (fila.contenido !== obj.antesEsperado) {
            console.error(`❌ ABORTADO: el contenido real de [${obj.tipo_respuesta}] "${obj.nombre}" (id=${fila.id}) no coincide EXACTAMENTE con lo esperado.`);
            console.error("   esperado:", JSON.stringify(obj.antesEsperado));
            console.error("   real:    ", JSON.stringify(fila.contenido));
            process.exit(1);
        }

        emparejadas.push({ ...obj, id: fila.id, habilitada: fila.habilitada });

    }

    // Ids únicos, sin duplicados
    const idsUnicos = new Set(emparejadas.map(e => e.id));
    if (idsUnicos.size !== emparejadas.length) {
        console.error("❌ ABORTADO: ids duplicados entre las filas objetivo.");
        process.exit(1);
    }

    linea();
    console.log("VISTA PREVIA");
    linea();

    for (const e of emparejadas) {
        console.log(`\n[${e.tipo_respuesta}] "${e.nombre}"  (id=${e.id}, habilitada=${e.habilitada})`);
        console.log("  ANTES:   ", JSON.stringify(e.antesEsperado));
        console.log("  DESPUÉS: ", JSON.stringify(e.despues));
    }

    console.log("\n✅ Las 2 filas coinciden EXACTAMENTE con lo esperado. Aplicando UPDATE (solo columna \"contenido\", solo estos 2 ids)...\n");

    // 3) UPDATE — SOLO columna "contenido", SOLO estos 2 ids, uno por uno.
    const actualizadas = [];
    const errores = [];

    for (const e of emparejadas) {

        const { error: errUpdate } = await supabase
            .from("plantillas_mensaje")
            .update({ contenido: e.despues })
            .eq("id", e.id);

        if (errUpdate) {
            console.log(`❌ [${e.id}] "${e.nombre}": ${errUpdate.message}`);
            errores.push({ id: e.id, error: errUpdate.message });
        } else {
            console.log(`✅ [${e.id}] "${e.nombre}" actualizada.`);
            actualizadas.push(e);
        }

    }

    if (errores.length) {
        console.error("\n❌ Hubo errores al actualizar. Deteniendo antes de la verificación post-cambio.");
        process.exit(1);
    }

    // 4) Volver a leer las 2 filas
    linea();
    console.log("VERIFICACIÓN POST-CAMBIO");
    linea();

    const { data: releidas, error: errorReleer } = await supabase
        .from("plantillas_mensaje")
        .select("id, tipo_respuesta, nombre, contenido, habilitada")
        .in("id", emparejadas.map(e => e.id));

    if (errorReleer) {
        console.error("⚠️ No se pudieron releer las filas para verificar:", errorReleer.message);
        process.exit(1);
    }

    let ok = true;

    for (const e of emparejadas) {

        const fila = releidas.find(f => f.id === e.id);

        console.log(`\n[${e.tipo_respuesta}] "${e.nombre}" (id=${e.id})`);
        console.log("  contenido ahora:", JSON.stringify(fila?.contenido));

        const coincideTexto = fila?.contenido === e.despues;
        const sinParentesisDobles = !/\(\(|\)\)/.test(fila?.contenido || "");
        const habilitadaIntacta = fila?.habilitada === e.habilitada;

        console.log("  ✔ contenido == esperado:", coincideTexto);
        console.log("  ✔ sin paréntesis dobles ('((' o '))'):", sinParentesisDobles);
        console.log("  ✔ 'habilitada' sin cambios:", habilitadaIntacta);

        if (!coincideTexto || !sinParentesisDobles || !habilitadaIntacta) ok = false;

    }

    linea();
    console.log(ok ? "✅ CORRECCIÓN APLICADA Y VERIFICADA — solo estas 2 filas, solo columna \"contenido\"." : "❌ VERIFICACIÓN POST-CAMBIO FALLÓ.");
    linea();

    if (!ok) process.exit(1);

}

main().catch(err => {
    console.error("💥 ERROR INESPERADO:", err);
    process.exit(1);
});
