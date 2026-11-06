// ==========================================================================
// scripts/guardaProduccion.js: GUARDA para los scripts manuales que tocan
// datos reales (Supabase de producción, sesiones o credenciales de WhatsApp).
//
// Se llama en la PRIMERA línea ejecutable del script, antes de cargar dotenv
// o lib/supabase.js (que se conecta al cargarse):
//
//   require("./scripts/guardaProduccion").exigir({
//       script: "_test_inicio_dia_real.js",
//       tipo: "escritura",            // escritura | lectura | credenciales
//       efectos: "inserta y borra filas de grupos_autorizados, automation_configs…"
//   });
//
// Para ejecutarlo de verdad hacen falta DOS confirmaciones explícitas:
//   - el argumento   --confirmar-produccion
//   - la variable    EFAAT_CONFIRMAR_PRODUCCION=SI
// Nunca corre dentro del ejecutor de pruebas (EFAAT_PRUEBAS=1).
//
// No cambia lo que hace el script: solo impide que arranque por accidente.
// ==========================================================================

"use strict";

const TIPOS = {
    escritura: "ESCRIBE en la base de datos de PRODUCCIÓN",
    lectura: "LEE datos reales de producción (Supabase y/o la sesión de WhatsApp)",
    credenciales: "LEE las credenciales de WhatsApp guardadas en backend/auth"
};

function exigir({ script, tipo = "escritura", efectos = "" } = {}) {

    const argumentoOk = process.argv.includes("--confirmar-produccion");
    const variableOk = process.env.EFAAT_CONFIRMAR_PRODUCCION === "SI";
    const enPruebas = process.env.EFAAT_PRUEBAS === "1";

    if (argumentoOk && variableOk && !enPruebas) {
        console.warn(`⚠️  [GUARDA] ${script}: ejecución CONFIRMADA. ${TIPOS[tipo] || tipo}.${efectos ? ` Efectos: ${efectos}` : ""}`);
        return true;
    }

    const lineas = [
        "",
        `⛔ [GUARDA] ${script} NO se ejecutó.`,
        `   Este script ${TIPOS[tipo] || tipo}.`,
        efectos ? `   Efectos: ${efectos}` : null,
        enPruebas
            ? "   Motivo: está dentro del ejecutor de pruebas (EFAAT_PRUEBAS=1): nunca se ejecuta aquí."
            : "   Para ejecutarlo, con autorización expresa, hacen falta las dos confirmaciones:",
        enPruebas ? null : `     EFAAT_CONFIRMAR_PRODUCCION=SI node backend/${script} --confirmar-produccion`,
        "   No se conectó a nada ni se modificó nada.",
        ""
    ].filter(l => l !== null);

    console.error(lineas.join("\n"));
    process.exit(2);
}

module.exports = { exigir, TIPOS };
