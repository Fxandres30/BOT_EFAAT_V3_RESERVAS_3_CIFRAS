// ==========================================================================
// CLI del escáner de identidades — SOLO DRY-RUN por defecto.
//
//   node backend/_escaner_identidades.js
//
// Recorre los grupos de la sesión activa de Baileys, reconstruye
// candidatos de identidad (lid/teléfono/nombre) y muestra + guarda un
// reporte de auditoría. NO toca Supabase.
//
// El modo de importación real (que sí escribe en "usuarios" vía
// obtenerUsuarioGlobal, ya probado) existe en escanerIdentidades.js pero
// este CLI NO lo ejecuta salvo que se pase explícitamente --import, y aun
// así pide confirmación explícita por variable de entorno — pensado para
// usarse solo después de revisar el dry-run.
// ==========================================================================

const fs = require("fs");
const path = require("path");

const manager = require("./services/baileys/manager");

const {
    escanearIdentidades,
    importarIdentidades,
    formatearReporteTexto
} = require("./bot/funciones/usuarios/escanerIdentidades");

const DIR_REPORTES = path.resolve(__dirname, "reportes_identidad");

function obtenerSocketActivo() {

    const sock = manager.getActiveSocket();

    if (!sock) {

        console.error("❌ No hay una sesión de WhatsApp activa (manager.getActiveSocket() devolvió null).");
        console.error("   Conecta una sesión desde el panel de Sesiones y vuelve a intentar.");

        process.exit(1);

    }

    return sock;

}

function guardarReporte(resultado) {

    if (!fs.existsSync(DIR_REPORTES)) {
        fs.mkdirSync(DIR_REPORTES, { recursive: true });
    }

    const nombreArchivo = `escaner-${resultado.generadoEn.replace(/[:.]/g, "-")}.json`;
    const rutaArchivo = path.join(DIR_REPORTES, nombreArchivo);

    fs.writeFileSync(rutaArchivo, JSON.stringify(resultado, null, 2), "utf8");

    return rutaArchivo;

}

async function main() {

    const argv = process.argv.slice(2);
    const modoImport = argv.includes("--import");

    const sock = obtenerSocketActivo();

    console.log("🔎 Escaneando grupos de la sesión activa (dry-run)...\n");

    const resultado = await escanearIdentidades({ sock });

    console.log(formatearReporteTexto(resultado));
    console.log("");

    const rutaReporte = guardarReporte(resultado);

    console.log(`📄 Reporte detallado guardado en: ${rutaReporte}`);

    if (!modoImport) {

        console.log("\nℹ️  Este fue un DRY-RUN. No se modificó Supabase.");
        console.log("   Para importar de verdad, revisa el reporte y vuelve a ejecutar con --import");
        console.log("   y la variable de entorno CONFIRMAR_IMPORTACION_IDENTIDADES=si");

        return;

    }

    // ---- Modo importación: requiere confirmación explícita adicional ----
    if (process.env.CONFIRMAR_IMPORTACION_IDENTIDADES !== "si") {

        console.log("\n⛔ --import fue pasado, pero falta CONFIRMAR_IMPORTACION_IDENTIDADES=si.");
        console.log("   No se escribió nada en Supabase.");

        return;

    }

    console.log("\n✍️  Importando identidades reconstruidas a Supabase (usuarios)...");

    const resultadoImport = await importarIdentidades({ identidades: resultado.identidades });

    console.log(`✅ Importación terminada: ${resultadoImport.importados}/${resultadoImport.total} identidades procesadas.`);

    if (resultadoImport.noImportados > 0) {
        console.log(`⚠️ ${resultadoImport.noImportados} no se pudieron procesar (ver log de obtenerUsuarioGlobal arriba).`);
    }

    const rutaReporteImport = guardarReporte({ ...resultadoImport, estadisticas: resultado.estadisticas });

    console.log(`📄 Reporte de importación guardado en: ${rutaReporteImport}`);

}

main().catch(err => {

    console.error("💥 Error inesperado en el escáner de identidades");
    console.error(err);
    process.exitCode = 1;

});
