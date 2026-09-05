// ==========================================================================
// INVESTIGACIÓN — completar solo-LID usando fuentes YA disponibles
// ==========================================================================
// 100% LOCAL. No abre socket, no se conecta a WhatsApp, no hace ninguna
// llamada de red, no toca Supabase. Solo lee (nunca escribe) los archivos
// de auth ya existentes en disco.
//
// Hallazgo clave: Baileys (@whiskeysockets/baileys ^7.0.0-rc14) mantiene un
// caché LID<->PN persistente como parte de su propio manejo de sesiones de
// cifrado (Signal), guardado en el MISMO folder de auth que
// useMultiFileAuthState ya usa, bajo la categoría "lid-mapping":
//   lid-mapping-<telefono>.json          (PN -> LID)
//   lid-mapping-<lidUser>_reverse.json   (LID -> PN)  <- lo que necesitamos
//
// Se llenó solo, como efecto secundario de cifrar/descifrar mensajes reales
// a lo largo del tiempo. Leerlo es exactamente lo mismo que hace Baileys
// internamente en getPNsForLIDs() (lid-mapping.js) — esa función NUNCA hace
// una llamada de red para la dirección LID->PN (no existe fallback USync
// para ese sentido en esta versión); por eso este chequeo es 100% seguro.
//
//   node backend/_investigar_completar_lid.js [ruta-al-reporte.json]
// ==========================================================================

const fs = require("fs");
const path = require("path");

const { useMultiFileAuthState, jidDecode } = require("@whiskeysockets/baileys");

const SESSION_ID = "d308bedb-f713-44be-bde7-60b9893b3cbc";
const AUTH_FOLDER = path.resolve(__dirname, "auth", SESSION_ID);
const DIR_REPORTES = path.resolve(__dirname, "reportes_identidad");

function ultimoReporte() {

    const archivos = fs.readdirSync(DIR_REPORTES)
        .filter(f => f.startsWith("escaner-") && f.endsWith(".json"))
        .sort();

    if (archivos.length === 0) {
        throw new Error("No hay ningún reporte previo en reportes_identidad/.");
    }

    return path.join(DIR_REPORTES, archivos[archivos.length - 1]);

}

async function main() {

    const rutaReporte = process.argv[2]
        ? path.resolve(process.argv[2])
        : ultimoReporte();

    console.log(`📄 Usando reporte: ${rutaReporte}\n`);

    const reporte = JSON.parse(fs.readFileSync(rutaReporte, "utf8"));

    const soloLid = reporte.identidades.filter(i => i.lid && !i.telefono);

    console.log(`🔎 Identidades solo-LID a investigar: ${soloLid.length}\n`);

    // ==========================================
    // Carga SOLO LECTURA del estado de auth. useMultiFileAuthState() en sí
    // solo LEE los archivos existentes (createa la carpeta si no existe,
    // pero YA existe con miles de archivos, así que no crea nada nuevo).
    // NUNCA se llama a keys.set() ni saveCreds() en este script.
    // ==========================================

    const { state } = await useMultiFileAuthState(AUTH_FOLDER);

    // Construye, para cada LID, la clave inversa exacta que usa
    // LIDMappingStore internamente: jidDecode(lid).user + "_reverse".
    const porClaveReversa = new Map(); // "<lidUser>_reverse" -> [identidad, ...]

    let noDecodificables = 0;

    for (const identidad of soloLid) {

        const decoded = jidDecode(identidad.lid);

        if (!decoded || !decoded.user) {
            noDecodificables++;
            continue;
        }

        const clave = `${decoded.user}_reverse`;

        if (!porClaveReversa.has(clave)) porClaveReversa.set(clave, []);
        porClaveReversa.get(clave).push(identidad);

    }

    const clavesUnicas = [...porClaveReversa.keys()];

    console.log(`📦 Consultando el caché local ("lid-mapping") en un solo lote de ${clavesUnicas.length} claves...\n`);

    // Una única llamada batched, 100% local (Promise.all de fs.readFile
    // dentro de useMultiFileAuthState) — CERO llamadas de red.
    const resultado = await state.keys.get("lid-mapping", clavesUnicas);

    let resueltos = 0;
    let identidadesResueltas = 0;
    const ejemplos = [];

    for (const [clave, identidades] of porClaveReversa.entries()) {

        const pnUser = resultado[clave];

        if (pnUser && typeof pnUser === "string") {

            resueltos++;
            identidadesResueltas += identidades.length; // por si un mismo lidUser mapea a >1 "identidad" reconstruida (no debería, pero se cuenta bien igual)

            if (ejemplos.length < 5) {
                ejemplos.push({ lid: identidades[0].lid, telefonoEncontradoLocalmente: pnUser });
            }

        }

    }

    const totalUnicos = clavesUnicas.length;
    const pctSobreUnicos = totalUnicos ? ((resueltos / totalUnicos) * 100).toFixed(1) : "0.0";
    const pctSobreIdentidades = soloLid.length ? ((identidadesResueltas / soloLid.length) * 100).toFixed(1) : "0.0";

    console.log("================================================");
    console.log("📊 RESULTADO — completar solo-LID con caché local");
    console.log("================================================");
    console.log(`Solo-LID en el reporte:                 ${soloLid.length}`);
    console.log(`  no decodificables (formato raro):     ${noDecodificables}`);
    console.log(`LID únicos consultados en el caché:     ${totalUnicos}`);
    console.log(`Resueltos LOCALMENTE (0 llamadas red):  ${resueltos}  (${pctSobreUnicos}% de los LID únicos)`);
    console.log(`Identidades que se completarían:        ${identidadesResueltas}  (${pctSobreIdentidades}% de los solo-LID)`);
    console.log(`Quedarían SIN resolver localmente:      ${soloLid.length - identidadesResueltas}`);
    console.log("");
    console.log("Ejemplos (LID -> teléfono encontrado en caché local):");
    ejemplos.forEach(e => console.log(`  ${e.lid} -> ${e.telefonoEncontradoLocalmente}`));

    const salida = {

        generadoEn: new Date().toISOString(),
        reporteBase: rutaReporte,
        soloLidTotal: soloLid.length,
        lidUnicosConsultados: totalUnicos,
        resueltosLocalmente: resueltos,
        identidadesQueSeCompletarian: identidadesResueltas,
        pctSobreLidUnicos: Number(pctSobreUnicos),
        pctSobreIdentidades: Number(pctSobreIdentidades),
        quedarianSinResolver: soloLid.length - identidadesResueltas,
        ejemplos

    };

    const rutaSalida = path.join(
        DIR_REPORTES,
        `investigacion-completar-lid-${salida.generadoEn.replace(/[:.]/g, "-")}.json`
    );

    fs.writeFileSync(rutaSalida, JSON.stringify(salida, null, 2), "utf8");

    console.log(`\n📄 Investigación guardada en: ${rutaSalida}`);

}

main().catch(err => {

    console.error("💥 Error en la investigación");
    console.error(err);
    process.exitCode = 1;

});
