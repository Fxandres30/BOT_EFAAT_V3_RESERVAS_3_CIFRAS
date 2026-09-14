// ==========================================================================
// Comparación SCANNER ANTIGUO vs SCANNER NUEVO — MODO PRUEBA.
//
//   node backend/_comparar_scanner_identidades.js
//
// Usa la sesión de Baileys YA ACTIVA (services/baileys/manager.js, mismo
// patrón que _escaner_identidades.js) para traer los grupos UNA sola vez
// (groupFetchAllParticipating) y correr, sobre los MISMOS datos, dos
// extracciones en paralelo:
//
//   - "ANTIGUO": réplica literal de
//     BOT_Escaner_1.0/functions/escanearGrupo.js::extraerDeObjeto() — se
//     queda con el PRIMER lid y el PRIMER teléfono que encuentra por
//     participante, y usa el string completo como JID si contiene "@lid" /
//     "@s.whatsapp.net" (su bug real, documentado en la auditoría).
//   - "NUEVO": bot/funciones/usuarios/identityScanner (recorrido
//     recursivo con extracción exacta por regex, sin quedarse con el
//     primero, con soporte de @hosted/@hosted.lid).
//
// 100% SOLO LECTURA. NO llama a Supabase. NO llama a obtenerUsuarioGlobal.
// NO toca "usuarios" ni ninguna tabla de reservas. Es exclusivamente una
// comparación de EXTRACCIÓN, para decidir si el motor nuevo encuentra
// identidades reales que el antiguo (o el escáner actual de campos fijos)
// se estaba perdiendo — antes de conectar nada al flujo de negocio.
// ==========================================================================

const fs = require("fs");
const path = require("path");

const manager = require("./services/baileys/manager");
const { escanearObjeto } = require("./bot/funciones/usuarios/identityScanner");

const DIR_REPORTES = path.resolve(__dirname, "reportes_identidad");

// ==========================================================================
// Réplica EXACTA del scanner antiguo — a propósito, con sus mismos límites,
// para que la comparación sea honesta (no se "mejora" el antiguo antes de
// compararlo).
// ==========================================================================
function limpiarTelefonoAntiguo(numero) {

    if (!numero) return null;

    let num = numero.replace(/\D/g, "");

    if (num.startsWith("57") && num.length === 12) {
        num = num.slice(2);
    }

    if (num.length !== 10) return null;

    return num;

}

function extraerDeObjetoAntiguo(obj) {

    let lid = null;
    let telefono = null;

    const revisar = (data) => {

        if (!data) return;

        if (typeof data === "string") {

            if (data.includes("@lid") && !lid) {
                lid = data;
            }

            if (data.includes("@s.whatsapp.net") && !telefono) {
                const raw = data.split("@")[0];
                telefono = limpiarTelefonoAntiguo(raw);
            }

            return;

        }

        if (typeof data === "object" && data !== null) {
            for (const key in data) revisar(data[key]);
        }

    };

    revisar(obj);

    return { lid, telefono };

}

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

    const nombreArchivo = `comparacion-scanner-${resultado.generadoEn.replace(/[:.]/g, "-")}.json`;
    const rutaArchivo = path.join(DIR_REPORTES, nombreArchivo);

    fs.writeFileSync(rutaArchivo, JSON.stringify(resultado, null, 2), "utf8");

    return rutaArchivo;

}

async function main() {

    const sock = obtenerSocketActivo();

    console.log("🔎 Trayendo grupos de la sesión activa (una sola llamada, reutilizada para ambos scanners)...\n");

    const mapa = await sock.groupFetchAllParticipating();
    const grupos = Object.values(mapa || {});

    const antiguo = { conLid: 0, conTelefono: 0, conAmbos: 0, sinNada: 0 };
    const nuevo = { conLid: 0, conTelefono: 0, conAmbos: 0, sinNada: 0, totalCandidatos: 0 };

    const lidsUnicosNuevo = new Set();
    const telefonosUnicosNuevo = new Set();
    const lidsUnicosAntiguo = new Set();
    const telefonosUnicosAntiguo = new Set();

    let participantesConLidAdicional = 0;
    let participantesConTelefonoAdicional = 0;

    const ejemplosDiferencia = [];

    let participantesAnalizados = 0;

    for (const grupo of grupos) {

        const participantes = grupo.participants || [];

        for (const participante of participantes) {

            participantesAnalizados++;

            // ---- ANTIGUO: solo el participante, se queda con 1+1 ----
            const resultadoAntiguo = extraerDeObjetoAntiguo(participante);

            if (resultadoAntiguo.lid) { antiguo.conLid++; lidsUnicosAntiguo.add(resultadoAntiguo.lid); }
            if (resultadoAntiguo.telefono) { antiguo.conTelefono++; telefonosUnicosAntiguo.add(resultadoAntiguo.telefono); }
            if (resultadoAntiguo.lid && resultadoAntiguo.telefono) antiguo.conAmbos++;
            if (!resultadoAntiguo.lid && !resultadoAntiguo.telefono) antiguo.sinNada++;

            // ---- NUEVO: mismo participante, motor recursivo completo ----
            const resultadoNuevo = escanearObjeto(participante, {
                fuenteBase: `grupo[${grupo.id}].participante[${participante?.id || "?"}]`
            });

            nuevo.totalCandidatos += resultadoNuevo.candidatos.length;
            resultadoNuevo.lids.forEach(l => lidsUnicosNuevo.add(l));
            resultadoNuevo.telefonos.forEach(t => telefonosUnicosNuevo.add(t));

            if (resultadoNuevo.lids.length > 0) nuevo.conLid++;
            if (resultadoNuevo.telefonos.length > 0) nuevo.conTelefono++;
            if (resultadoNuevo.lids.length > 0 && resultadoNuevo.telefonos.length > 0) nuevo.conAmbos++;
            if (resultadoNuevo.lids.length === 0 && resultadoNuevo.telefonos.length === 0) nuevo.sinNada++;

            // ---- diferencias reales para ESTE participante ----
            const lidsAdicionales = resultadoNuevo.lids.filter(l => l !== resultadoAntiguo.lid);
            const telefonosAdicionales = resultadoNuevo.telefonos.filter(t => t !== resultadoAntiguo.telefono);

            const encontroLidQueAntiguoPerdio = !resultadoAntiguo.lid && resultadoNuevo.lids.length > 0;
            const encontroTelefonoQueAntiguoPerdio = !resultadoAntiguo.telefono && resultadoNuevo.telefonos.length > 0;
            const encontroLidExtra = lidsAdicionales.length > 0 && !!resultadoAntiguo.lid;
            const encontroTelefonoExtra = telefonosAdicionales.length > 0 && !!resultadoAntiguo.telefono;

            if (encontroLidQueAntiguoPerdio || encontroLidExtra) participantesConLidAdicional++;
            if (encontroTelefonoQueAntiguoPerdio || encontroTelefonoExtra) participantesConTelefonoAdicional++;

            if ((lidsAdicionales.length > 0 || telefonosAdicionales.length > 0) && ejemplosDiferencia.length < 15) {

                ejemplosDiferencia.push({
                    grupoId: grupo.id,
                    participanteId: participante?.id || null,
                    antiguo: resultadoAntiguo,
                    nuevo: { lids: resultadoNuevo.lids, telefonos: resultadoNuevo.telefonos }
                });

            }

        }

    }

    // ==========================================================================
    // Extras EXCLUSIVOS del nuevo scanner: campos a nivel de GRUPO (owner,
    // subjectOwner...) que el antiguo nunca miraba, porque solo recorría
    // grupo.participants.
    // ==========================================================================
    const lidsSoloEnGrupo = new Set();
    const telefonosSoloEnGrupo = new Set();

    for (const grupo of grupos) {

        const { participants, ...grupoSinParticipantes } = grupo;

        const r = escanearObjeto(grupoSinParticipantes, { fuenteBase: `grupo[${grupo.id}]` });

        r.lids.forEach(l => { if (!lidsUnicosNuevo.has(l)) lidsSoloEnGrupo.add(l); });
        r.telefonos.forEach(t => { if (!telefonosUnicosNuevo.has(t)) telefonosSoloEnGrupo.add(t); });

    }

    const resultado = {

        modo: "comparacion-dry-run",
        generadoEn: new Date().toISOString(),

        gruposEncontrados: grupos.length,
        participantesAnalizados,

        scannerAntiguo: {
            ...antiguo,
            lidsUnicos: lidsUnicosAntiguo.size,
            telefonosUnicos: telefonosUnicosAntiguo.size
        },

        scannerNuevo: {
            ...nuevo,
            lidsUnicos: lidsUnicosNuevo.size,
            telefonosUnicos: telefonosUnicosNuevo.size
        },

        diferencias: {
            participantesConLidAdicionalEncontrado: participantesConLidAdicional,
            participantesConTelefonoAdicionalEncontrado: participantesConTelefonoAdicional,
            lidsUnicosAdicionales: lidsUnicosNuevo.size - lidsUnicosAntiguo.size,
            telefonosUnicosAdicionales: telefonosUnicosNuevo.size - telefonosUnicosAntiguo.size,
            soloVistosANivelDeGrupoNoDeParticipante: {
                lids: [...lidsSoloEnGrupo],
                telefonos: [...telefonosSoloEnGrupo]
            }
        },

        ejemplosDeDiferencia: ejemplosDiferencia

    };

    console.log("================================================");
    console.log("SCANNER ANTIGUO (réplica de BOT_Escaner_1.0)");
    console.log("================================================");
    console.log(`Participantes con LID:      ${antiguo.conLid}`);
    console.log(`Participantes con teléfono: ${antiguo.conTelefono}`);
    console.log(`Con ambos:                  ${antiguo.conAmbos}`);
    console.log(`Sin nada:                   ${antiguo.sinNada}`);
    console.log(`LIDs únicos:                ${lidsUnicosAntiguo.size}`);
    console.log(`Teléfonos únicos:           ${telefonosUnicosAntiguo.size}`);

    console.log("\n================================================");
    console.log("SCANNER NUEVO (IdentityScanner recursivo)");
    console.log("================================================");
    console.log(`Participantes con LID:      ${nuevo.conLid}`);
    console.log(`Participantes con teléfono: ${nuevo.conTelefono}`);
    console.log(`Con ambos:                  ${nuevo.conAmbos}`);
    console.log(`Sin nada:                   ${nuevo.sinNada}`);
    console.log(`LIDs únicos:                ${lidsUnicosNuevo.size}`);
    console.log(`Teléfonos únicos:           ${telefonosUnicosNuevo.size}`);
    console.log(`Total candidatos (con duplicados por fuente): ${nuevo.totalCandidatos}`);

    console.log("\n================================================");
    console.log("DIFERENCIAS");
    console.log("================================================");
    console.log(`Participantes donde el nuevo encontró LID(s) adicionales: ${participantesConLidAdicional}`);
    console.log(`Participantes donde el nuevo encontró teléfono(s) adicionales: ${participantesConTelefonoAdicional}`);
    console.log(`LIDs únicos adicionales (nuevo - antiguo): ${resultado.diferencias.lidsUnicosAdicionales}`);
    console.log(`Teléfonos únicos adicionales (nuevo - antiguo): ${resultado.diferencias.telefonosUnicosAdicionales}`);

    console.log("\n================================================");
    console.log("IDENTIDADES ADICIONALES ENCONTRADAS (solo a nivel de grupo — owner/subjectOwner, el antiguo NUNCA los veía)");
    console.log("================================================");
    console.log(`LIDs:      ${resultado.diferencias.soloVistosANivelDeGrupoNoDeParticipante.lids.length}`);
    console.log(`Teléfonos: ${resultado.diferencias.soloVistosANivelDeGrupoNoDeParticipante.telefonos.length}`);

    if (ejemplosDiferencia.length > 0) {

        console.log("\n================================================");
        console.log(`EJEMPLOS REALES DE DIFERENCIA (hasta 15 de ${ejemplosDiferencia.length}+ encontrados)`);
        console.log("================================================");

        ejemplosDiferencia.forEach((e, i) => {
            console.log(`\n${i + 1}) grupo=${e.grupoId} participante=${e.participanteId}`);
            console.log(`   antiguo -> lid: ${e.antiguo.lid || "(ninguno)"} | telefono: ${e.antiguo.telefono || "(ninguno)"}`);
            console.log(`   nuevo   -> lids: [${e.nuevo.lids.join(", ")}] | telefonos: [${e.nuevo.telefonos.join(", ")}]`);
        });

    }

    const rutaReporte = guardarReporte(resultado);

    console.log(`\n📄 Reporte completo guardado en: ${rutaReporte}`);
    console.log("\nℹ️  Esto fue un DRY-RUN de comparación. No se modificó Supabase, usuarios ni reservas.");

}

main().catch(err => {

    console.error("💥 Error inesperado en la comparación de scanners");
    console.error(err);
    process.exitCode = 1;

});
