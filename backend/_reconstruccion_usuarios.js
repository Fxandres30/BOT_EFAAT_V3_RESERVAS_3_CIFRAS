// ==========================================================================
// RECONSTRUCCIÓN DEFINITIVA DE `usuarios` — script de un solo uso.
//
// Fases:
//   1. Backup (solo lectura -> JSON local) de usuarios y de las 2 tablas
//      de reservas que tienen columna usuario_global_id.
//   2. DELETE de todas las filas de usuarios (estructura intacta).
//   3. Import de las identidades del último escaneo real, usando
//      EXCLUSIVAMENTE obtenerUsuarioGlobal (mismo mecanismo central).
//   4. Re-vincular usuario_global_id en las 2 tablas de reservas, cruzando
//      por lid/telefono ya guardado en cada fila -> el usuarios.id nuevo.
//      Se toca SOLO esa columna. Nada de números, estado, comprador, etc.
//   5. Verificación completa (duplicados, conflictos, huérfanos, bot).
//
// NO cambia estructura de tablas. NO crea tablas paralelas. NO toca
// reservas más allá de la columna usuario_global_id (y solo para
// re-vincular, no para cambiar datos de negocio).
// ==========================================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const supabase = require("./lib/supabase");

const {
    obtenerUsuarioGlobal
} = require("./bot/funciones/usuarios/obtenerUsuarioGlobal");

const DIR_REPORTES = path.resolve(__dirname, "reportes_identidad");
const TABLAS_RESERVAS = ["5k_15k_reservas_2_cifras", "reservas_dos_cifras"];

const IDENTIDAD_BOT = {
    telefono: "3106814436",
    lid: "7156153774273@lid"
};

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function guardarJSON(nombre, data) {

    if (!fs.existsSync(DIR_REPORTES)) fs.mkdirSync(DIR_REPORTES, { recursive: true });

    const ruta = path.join(DIR_REPORTES, nombre);
    fs.writeFileSync(ruta, JSON.stringify(data, null, 2), "utf8");
    return ruta;

}

// Trae TODAS las filas de una tabla, paginando (Supabase limita ~1000 por
// consulta por defecto).
async function traerTodo(tabla, columnas = "*") {

    const filas = [];
    const TAM_PAGINA = 1000;
    let desde = 0;

    while (true) {

        const { data, error } = await supabase
            .from(tabla)
            .select(columnas)
            .range(desde, desde + TAM_PAGINA - 1);

        if (error) throw new Error(`Error leyendo ${tabla}: ${error.message}`);

        filas.push(...data);

        if (data.length < TAM_PAGINA) break;

        desde += TAM_PAGINA;

    }

    return filas;

}

// Ejecuta `fn` sobre `items` con concurrencia limitada (mismo
// obtenerUsuarioGlobal para todos — esto es solo estrategia de ejecución,
// no una segunda lógica de identidad).
async function enLotes(items, tam, fn) {

    const resultados = [];

    for (let i = 0; i < items.length; i += tam) {

        const lote = items.slice(i, i + tam);
        const parcial = await Promise.all(lote.map(fn));
        resultados.push(...parcial);

        process.stdout.write(`\r   procesados ${Math.min(i + tam, items.length)}/${items.length}`);

    }

    process.stdout.write("\n");

    return resultados;

}

async function main() {

    const ts = timestamp();

    console.log("================================================");
    console.log("FASE 1 — BACKUP (solo lectura)");
    console.log("================================================");

    const usuariosAntes = await traerTodo("usuarios");
    const rutaBackupUsuarios = guardarJSON(`backup_usuarios_${ts}.json`, usuariosAntes);
    console.log(`✅ Backup de usuarios: ${usuariosAntes.length} filas -> ${rutaBackupUsuarios}`);

    const backupsReservas = {};

    for (const tabla of TABLAS_RESERVAS) {

        const filas = await traerTodo(
            tabla,
            "id, numero, estado, usuario_global_id, telefono, lid, comprador, evento_id, grupo_id"
        );

        const ruta = guardarJSON(`backup_${tabla}_${ts}.json`, filas);
        backupsReservas[tabla] = filas;

        console.log(`✅ Backup de ${tabla}: ${filas.length} filas -> ${ruta}`);

    }

    console.log("\n================================================");
    console.log("FASE 2 — DELETE de usuarios");
    console.log("================================================");

    const { count: totalAntes } = await supabase
        .from("usuarios")
        .select("*", { count: "exact", head: true });

    console.log(`Filas en usuarios ANTES del DELETE: ${totalAntes}`);

    const { error: errorDelete } = await supabase
        .from("usuarios")
        .delete()
        .not("id", "is", null); // coincide con TODAS las filas (id nunca es null)

    if (errorDelete) {

        console.error("❌ ERROR EN EL DELETE — abortando, no se importó nada.");
        console.error(errorDelete);
        process.exitCode = 1;
        return;

    }

    const { count: totalDespuesDelete } = await supabase
        .from("usuarios")
        .select("*", { count: "exact", head: true });

    console.log(`✅ DELETE ejecutado. Filas en usuarios DESPUÉS: ${totalDespuesDelete}`);

    console.log("\n================================================");
    console.log("FASE 3 — IMPORTACIÓN (obtenerUsuarioGlobal, mismo mecanismo central)");
    console.log("================================================");

    const rutaUltimoEscaneo = path.join(DIR_REPORTES, "_ultimo_escaneo.json");
    const escaneo = JSON.parse(fs.readFileSync(rutaUltimoEscaneo, "utf8"));
    const identidades = escaneo.resultado.identidades;

    console.log(`Identidades a importar: ${identidades.length}`);
    console.log(`(del escaneo generado en: ${escaneo.resultado.generadoEn})\n`);

    const CONCURRENCIA = 20;

    const resultadosImport = await enLotes(identidades, CONCURRENCIA, async (identidad) => {

        const usuario = await obtenerUsuarioGlobal({

            lid: identidad.lid,
            telefono: identidad.telefono,
            nombre: identidad.nombre,
            fromMe: false

        });

        return { entrada: identidad, usuario, importado: !!usuario };

    });

    const importados = resultadosImport.filter(r => r.importado).length;
    const noImportados = resultadosImport.filter(r => !r.importado);

    console.log(`\n✅ Importación terminada: ${importados}/${identidades.length} identidades creadas.`);

    if (noImportados.length > 0) {

        console.log(`⚠️ ${noImportados.length} NO se pudieron importar:`);
        noImportados.slice(0, 20).forEach(r => console.log("   ", JSON.stringify(r.entrada)));

    }

    guardarJSON(`import_resultado_${ts}.json`, resultadosImport);

    console.log("\n================================================");
    console.log("FASE 4 — RE-VINCULAR usuario_global_id en reservas");
    console.log("================================================");

    // Mapa de la identidad RECIÉN creada: lid/telefono -> usuarios.id nuevo.
    const porLid = new Map();
    const porTelefono = new Map();

    for (const r of resultadosImport) {

        if (!r.usuario) continue;

        if (r.usuario.lid) porLid.set(r.usuario.lid, r.usuario.id);
        if (r.usuario.telefono) porTelefono.set(r.usuario.telefono, r.usuario.id);

    }

    const resumenRelink = {};

    for (const tabla of TABLAS_RESERVAS) {

        const filas = backupsReservas[tabla].filter(f => f.usuario_global_id);

        console.log(`\n${tabla}: ${filas.length} filas con usuario_global_id a revisar`);

        let reVinculadas = 0;
        let yaCorrectas = 0;
        let sinCoincidencia = 0;
        const sinCoincidenciaDetalle = [];

        const actualizaciones = [];

        for (const fila of filas) {

            const nuevoId =
                (fila.lid && porLid.get(fila.lid)) ||
                (fila.telefono && porTelefono.get(fila.telefono)) ||
                null;

            if (!nuevoId) {

                sinCoincidencia++;
                sinCoincidenciaDetalle.push({ id: fila.id, numero: fila.numero, telefono: fila.telefono, lid: fila.lid });
                continue;

            }

            if (nuevoId === fila.usuario_global_id) {

                yaCorrectas++; // no debería pasar (los ids viejos ya no existen), pero se revisa por si acaso
                continue;

            }

            actualizaciones.push({ id: fila.id, nuevoId });

        }

        await enLotes(actualizaciones, 20, async ({ id, nuevoId }) => {

            const { error } = await supabase
                .from(tabla)
                .update({ usuario_global_id: nuevoId })
                .eq("id", id);

            if (error) {
                console.error(`   ❌ Error actualizando ${tabla} id=${id}:`, error.message);
            } else {
                reVinculadas++;
            }

        });

        console.log(`   ✅ Re-vinculadas: ${reVinculadas}`);
        console.log(`   ➖ Ya correctas (sin cambio): ${yaCorrectas}`);
        console.log(`   ⚠️ Sin coincidencia (quedan huérfanas): ${sinCoincidencia}`);

        resumenRelink[tabla] = { total: filas.length, reVinculadas, yaCorrectas, sinCoincidencia, sinCoincidenciaDetalle };

    }

    guardarJSON(`relink_resultado_${ts}.json`, resumenRelink);

    console.log("\n================================================");
    console.log("FASE 5 — VERIFICACIÓN COMPLETA");
    console.log("================================================");

    const usuariosDespues = await traerTodo("usuarios");

    const conteoLid = new Map();
    const conteoTelefono = new Map();

    let conLidYTelefono = 0, soloLid = 0, soloTelefono = 0, sinNinguno = 0;
    let esDelBot = 0;

    for (const u of usuariosDespues) {

        if (u.lid) conteoLid.set(u.lid, (conteoLid.get(u.lid) || 0) + 1);
        if (u.telefono) conteoTelefono.set(u.telefono, (conteoTelefono.get(u.telefono) || 0) + 1);

        if (u.lid && u.telefono) conLidYTelefono++;
        else if (u.lid) soloLid++;
        else if (u.telefono) soloTelefono++;
        else sinNinguno++;

        if (u.telefono === IDENTIDAD_BOT.telefono || u.lid === IDENTIDAD_BOT.lid) esDelBot++;

    }

    const duplicadosLid = [...conteoLid.entries()].filter(([, n]) => n > 1);
    const duplicadosTelefono = [...conteoTelefono.entries()].filter(([, n]) => n > 1);

    const verificacion = {

        totalUsuarios: usuariosDespues.length,
        totalConLid: [...conteoLid.keys()].length,
        totalConTelefono: [...conteoTelefono.keys()].length,
        conLidYTelefono,
        soloLid,
        soloTelefono,
        sinNinguno,
        duplicadosPorLid: duplicadosLid.length,
        duplicadosPorTelefono: duplicadosTelefono.length,
        usuariosDelBot: esDelBot,
        detalleDuplicadosLid: duplicadosLid,
        detalleDuplicadosTelefono: duplicadosTelefono

    };

    console.log(JSON.stringify(verificacion, null, 2));

    guardarJSON(`verificacion_final_${ts}.json`, verificacion);

    console.log("\n================================================");
    console.log("RESUMEN FINAL");
    console.log("================================================");
    console.log(`usuarios ANTES del delete: ${totalAntes}`);
    console.log(`usuarios DESPUÉS del delete (antes de importar): ${totalDespuesDelete}`);
    console.log(`usuarios importados: ${importados}/${identidades.length}`);
    console.log(`usuarios en la tabla AHORA: ${verificacion.totalUsuarios}`);
    console.log(`Duplicados por LID: ${verificacion.duplicadosPorLid}`);
    console.log(`Duplicados por teléfono: ${verificacion.duplicadosPorTelefono}`);
    console.log(`Usuarios sin LID ni teléfono: ${verificacion.sinNinguno}`);
    console.log(`Usuarios del propio BOT: ${verificacion.usuariosDelBot}`);

    for (const tabla of TABLAS_RESERVAS) {

        const r = resumenRelink[tabla];
        console.log(`${tabla}: ${r.reVinculadas} re-vinculadas, ${r.sinCoincidencia} sin coincidencia`);

    }

}

main().catch(err => {

    console.error("💥 ERROR INESPERADO — revisar backups antes de reintentar nada.");
    console.error(err);
    process.exitCode = 1;

});
