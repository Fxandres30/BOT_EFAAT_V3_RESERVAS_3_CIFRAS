// ==========================================================================
// DIAGNÓSTICO PUNTUAL — por qué el scanner encuentra tantos "solo LID" y
// tan pocos teléfonos. 100% READ-ONLY.
//
//   node backend/_diagnostico_telefonos_lid.js
//
// Qué hace (y qué NO hace):
//   ✅ sock.groupFetchAllParticipating() — lectura real de la sesión activa.
//   ✅ Recorre el objeto CRUDO de 3-5 participantes reales "solo LID" con
//      un buscador de claves/valores INDEPENDIENTE (no toca identityScanner).
//   ✅ Ejecuta recorrerObjeto()/normalizarCandidatos() del scanner ACTUAL,
//      SIN MODIFICARLOS — solo los importa y los llama.
//   ✅ Consulta sock.signalRepository.lidMapping.getPNForLID() — un store
//      INTERNO de Baileys (Signal/lid-mapping.js) separado por completo de
//      groupFetchAllParticipating(), que puede tener la conversión LID->PN
//      aunque el objeto de metadata del grupo no la traiga. Solo lectura.
//   ❌ NO llama a obtenerUsuarioGlobal/resolverIdentidad/escanearGrupo/
//      importarIdentidades — CERO escritura en Supabase, cero usuarios,
//      cero reservas, cero merges.
//   ❌ NO modifica identityScanner/ ni ningún archivo de producción.
//
// Salida: reporte JSON completo (datos crudos SIN enmascarar, igual
// convención que reportes_identidad/*.json ya existentes) + consola
// enmascarada (últimos 4 dígitos visibles, resto con *).
// ==========================================================================

const fs = require("fs");
const path = require("path");

const manager = require("./services/baileys/manager");
const { escanearObjeto } = require("./bot/funciones/usuarios/identityScanner");
const { recorrerObjeto } = require("./bot/funciones/usuarios/identityScanner/recorrerObjeto");
const { normalizarCandidatos } = require("./bot/funciones/usuarios/identityScanner/normalizarCandidatos");
const { enmascararJid } = require("./bot/utils/enmascararJid");

const DIR_REPORTES = path.resolve(__dirname, "reportes_identidad");

const CANTIDAD_A_MUESTREAR = 5;

const PALABRAS_CLAVE = [
    "s.whatsapp.net",
    "@lid",
    "phonenumber",
    "pn",
    "id",
    "jid",
    "lid",
    "participant",
    "participantalt"
];

// ==========================================================================
// Enmascarado para CONSOLA únicamente (el JSON guardado queda sin
// enmascarar — es un reporte local, misma convención que
// reportes_identidad/*.json ya existentes en este repo).
// ==========================================================================
function enmascararDigitos(valor) {

    if (typeof valor !== "string") return valor;

    return valor.replace(/\d{5,}/g, (grupo) => "*".repeat(Math.max(0, grupo.length - 4)) + grupo.slice(-4));

}

function enmascararProfundo(valor) {

    if (valor === null || valor === undefined) return valor;

    if (typeof valor === "string") return enmascararDigitos(valor);

    if (Array.isArray(valor)) return valor.map(enmascararProfundo);

    if (typeof valor === "object") {

        const copia = {};
        for (const [k, v] of Object.entries(valor)) copia[k] = enmascararProfundo(v);
        return copia;

    }

    return valor;

}

// ==========================================================================
// Buscador GENÉRICO e INDEPENDIENTE de claves/valores — a propósito NO
// reutiliza recorrerObjeto.js (ese es el motor bajo prueba; este es el
// testigo independiente para comparar contra él).
// ==========================================================================
function aplanarObjeto(obj, ruta = "", resultados = [], profundidad = 0) {

    if (obj === null || obj === undefined || profundidad > 15) return resultados;

    if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {

        resultados.push({ ruta: ruta || "(raiz)", valor: obj });
        return resultados;

    }

    if (typeof obj !== "object") return resultados;

    if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {

        resultados.push({ ruta, valor: `<binario ${obj.length} bytes>` });
        return resultados;

    }

    if (Array.isArray(obj)) {

        obj.forEach((v, i) => aplanarObjeto(v, `${ruta}[${i}]`, resultados, profundidad + 1));
        return resultados;

    }

    for (const [clave, valor] of Object.entries(obj)) {

        aplanarObjeto(valor, ruta ? `${ruta}.${clave}` : clave, resultados, profundidad + 1);

    }

    return resultados;

}

// ==========================================================================
// Heurística ADICIONAL para el Caso A/B: un valor con FORMA de teléfono
// (10-15 dígitos, tolera espacios/guiones/"+") que NO trae ningún dominio
// "@algo" -- es decir, un número "pelado" que el motor actual JAMÁS
// detectaría (recorrerObjeto.js exige siempre user@dominio, por diseño,
// para no confundir un número de teléfono con cualquier otro número de 10+
// cifras que no sea una identidad de WhatsApp). Se excluye explícitamente
// el propio LID/id del participante (su parte numérica sola no es un
// "hallazgo" nuevo).
// ==========================================================================
function pareceTelefonoPelado(valor, idPropio) {

    if (typeof valor !== "string" || valor.includes("@")) return false;
    if (idPropio && valor === idPropio) return false;

    const soloDigitos = valor.replace(/\D/g, "");

    return soloDigitos.length >= 10 && soloDigitos.length <= 15;

}

function buscarTelefonosPelados(hojas, idPropio) {

    return hojas.filter(h => pareceTelefonoPelado(h.valor, idPropio));

}

function buscarPorPalabrasClave(hojas) {

    return hojas.filter(h => PALABRAS_CLAVE.some(p => h.ruta.toLowerCase().includes(p)));

}

// A propósito SOLO dominios de tipo teléfono (@s.whatsapp.net / @hosted) —
// NO incluye "@lid"/"@hosted.lid": el objeto de un participante "solo LID"
// siempre tiene su propio LID como valor, y contarlo aquí lo haría parecer
// "sí tiene un valor con forma de teléfono" por error (bug real detectado
// probando este mismo script con datos falsos antes de entregarlo).
function buscarPorPatronDeValor(hojas) {

    return hojas.filter(h =>
        typeof h.valor === "string" &&
        (h.valor.includes("@s.whatsapp.net") || (h.valor.includes("@hosted") && !h.valor.includes("@hosted.lid")))
    );

}

// ==========================================================================
// sock.signalRepository.lidMapping — store INTERNO de Baileys
// (node_modules/@whiskeysockets/baileys/lib/Signal/lid-mapping.js),
// completamente separado de groupFetchAllParticipating(). Se prueba
// directo contra el LID real del participante — solo lectura
// (getPNForLID), nunca se escribe nada.
// ==========================================================================
async function consultarLidMappingStore(sock, lid) {

    try {

        const store = sock?.signalRepository?.lidMapping;

        if (!store || typeof store.getPNForLID !== "function") {

            return { disponible: false, motivo: "sock.signalRepository.lidMapping no existe en este socket" };

        }

        const pn = await store.getPNForLID(lid);

        return { disponible: true, pn: pn || null };

    } catch (err) {

        return { disponible: false, motivo: `error consultando el store: ${err?.message}` };

    }

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

    if (!fs.existsSync(DIR_REPORTES)) fs.mkdirSync(DIR_REPORTES, { recursive: true });

    const nombreArchivo = `diagnostico_telefonos_lid_${resultado.generadoEn.replace(/[:.]/g, "-")}.json`;
    const rutaArchivo = path.join(DIR_REPORTES, nombreArchivo);

    fs.writeFileSync(rutaArchivo, JSON.stringify(resultado, null, 2), "utf8");

    return rutaArchivo;

}

// ==========================================================================
// Clasifica el caso (A/B/C/D) para UN participante ya analizado.
// ==========================================================================
function clasificarCaso({ hallazgosValor, telefonosPelados, resultadoScanner, lidMapping }) {

    const scannerEncontroTelefono = resultadoScanner.telefonos.length > 0;

    if (scannerEncontroTelefono) {
        // No debería pasar (se filtró para excluir estos), defensivo.
        return "N/A — el scanner sí encontró teléfono para este participante";
    }

    // ¿Hay un valor con forma de JID de teléfono (@s.whatsapp.net/@hosted)
    // EN EL OBJETO CRUDO que el scanner actual no haya clasificado?
    if (hallazgosValor.length > 0) {

        return "A — el teléfono SÍ está en el objeto (como JID @s.whatsapp.net/@hosted), pero el scanner no lo está detectando/clasificando";

    }

    // ¿Hay un valor con FORMA de teléfono (10-15 dígitos) pero SIN dominio
    // "@algo" -- un formato distinto al que el motor reconoce hoy?
    if (telefonosPelados.length > 0) {

        return "B — el teléfono está presente, pero en un formato/campo que el motor actual ignora (número sin '@dominio')";

    }

    // ¿El store interno de Baileys (lid-mapping) sí lo tiene, aunque el
    // objeto de groupFetchAllParticipating() no lo traiga en absoluto?
    if (lidMapping.disponible && lidMapping.pn) {

        return "D — Baileys SÍ tiene la conversión LID->teléfono, pero en OTRA fuente (signalRepository.lidMapping), no en groupFetchAllParticipating()";

    }

    return "C — el teléfono NO está presente en el objeto del participante (ni en el store interno de Baileys, por ahora)";

}

async function main() {

    const sock = obtenerSocketActivo();

    console.log("🔎 [DIAGNÓSTICO] Trayendo grupos de la sesión activa (groupFetchAllParticipating, solo lectura)...\n");

    const mapa = await sock.groupFetchAllParticipating();
    const grupos = Object.values(mapa || {});

    console.log(`📦 ${grupos.length} grupos encontrados. Buscando participantes "solo LID" según el scanner actual...\n`);

    // ---- Selección: participantes reales con LID pero sin teléfono, según
    // el scanner ACTUAL sin modificar (escanearObjeto, tal cual producción) ----
    const candidatos = [];
    const vistos = new Set();

    let totalParticipantes = 0;
    let totalConLid = 0;
    let totalConTelefono = 0;

    for (const grupo of grupos) {

        for (const participante of (grupo.participants || [])) {

            totalParticipantes++;

            const resultado = escanearObjeto(participante, { fuenteBase: `grupo[${grupo.id}].participante` });

            if (resultado.lids.length > 0) totalConLid++;
            if (resultado.telefonos.length > 0) totalConTelefono++;

            const esSoloLid = resultado.lids.length > 0 && resultado.telefonos.length === 0;

            if (esSoloLid && participante?.id && !vistos.has(participante.id) && candidatos.length < CANTIDAD_A_MUESTREAR) {

                vistos.add(participante.id);
                candidatos.push({ grupoId: grupo.id, participante, resultadoScanner: resultado });

            }

        }

    }

    console.log(`📊 Totales reales de ESTE escaneo: ${totalParticipantes} participantes | ${totalConLid} con LID | ${totalConTelefono} con teléfono.`);
    console.log(`🎯 Seleccionados ${candidatos.length} participantes "solo LID" para inspección profunda.\n`);

    if (candidatos.length === 0) {

        console.log("⚠️ No se encontró ningún participante 'solo LID' en esta sesión — nada que diagnosticar.");
        return;

    }

    const casos = [];

    for (const { grupoId, participante, resultadoScanner } of candidatos) {

        console.log("================================================");
        console.log(`PARTICIPANTE: ${enmascararJid(participante.id)}  (grupo ${grupoId})`);
        console.log("================================================");

        // ---- 1) objeto crudo aplanado (testigo independiente) ----
        const hojas = aplanarObjeto(participante);
        const hallazgosClave = buscarPorPalabrasClave(hojas);
        const hallazgosValor = buscarPorPatronDeValor(hojas);
        const telefonosPelados = buscarTelefonosPelados(hojas, participante?.id);

        console.log(`🗂️  Objeto crudo aplanado: ${hojas.length} hojas.`);
        console.log(`🔑 Hojas cuya RUTA contiene alguna palabra clave (${PALABRAS_CLAVE.join(", ")}): ${hallazgosClave.length}`);

        hallazgosClave.forEach(h => console.log(`   - ${h.ruta} = ${enmascararDigitos(String(h.valor))}`));

        console.log(`📱 Hojas cuyo VALOR parece un JID de teléfono (@s.whatsapp.net/@hosted): ${hallazgosValor.length}`);
        hallazgosValor.forEach(h => console.log(`   - ${h.ruta} = ${enmascararDigitos(String(h.valor))}`));

        console.log(`🔢 Hojas con FORMA de teléfono pero SIN '@dominio' (formato que el motor no reconoce): ${telefonosPelados.length}`);
        telefonosPelados.forEach(h => console.log(`   - ${h.ruta} = ${enmascararDigitos(String(h.valor))}`));

        // ---- 2) el MISMO objeto, por recorrerObjeto()/normalizarCandidatos() SIN MODIFICAR ----
        const hallazgosMotor = recorrerObjeto(participante, { fuenteBase: "participante" });
        const resultadoMotor = normalizarCandidatos(hallazgosMotor);

        console.log(`\n🧠 recorrerObjeto() (motor actual, sin modificar): ${hallazgosMotor.length} hallazgos crudos -> ${resultadoMotor.candidatos.length} candidatos clasificados.`);
        resultadoMotor.candidatos.forEach(c => console.log(`   - tipo=${c.tipo} valor=${enmascararDigitos(c.valor)} source=${c.source}`));

        // ---- 3) store interno de Baileys, lectura directa ----
        const lidMapping = await consultarLidMappingStore(sock, resultadoScanner.lids[0]);

        console.log(`\n🗄️  sock.signalRepository.lidMapping.getPNForLID(${enmascararJid(resultadoScanner.lids[0])}):`);

        if (!lidMapping.disponible) {

            console.log(`   No disponible — ${lidMapping.motivo}`);

        } else {

            console.log(`   -> ${lidMapping.pn ? enmascararDigitos(lidMapping.pn) : "(sin mapeo guardado para este LID todavía)"}`);

        }

        const caso = clasificarCaso({ hallazgosValor, telefonosPelados, resultadoScanner, lidMapping });

        console.log(`\n➡️  CASO: ${caso}`);
        console.log("");

        casos.push({

            grupoId,
            participanteId: participante.id, // crudo, solo en el JSON guardado
            objetoCrudo: participante,        // crudo, solo en el JSON guardado
            hojasAplanadas: hojas.length,
            hallazgosClave,
            hallazgosValor,
            telefonosPelados,
            motorHallazgosCrudos: hallazgosMotor,
            motorCandidatos: resultadoMotor.candidatos,
            lidMapping,
            caso

        });

    }

    // ---- conclusión agregada ----
    const conteoPorCaso = {};
    casos.forEach(c => { conteoPorCaso[c.caso] = (conteoPorCaso[c.caso] || 0) + 1; });

    console.log("================================================");
    console.log("CONCLUSIÓN");
    console.log("================================================");
    console.log(JSON.stringify(conteoPorCaso, null, 2));

    const resultadoFinal = {

        generadoEn: new Date().toISOString(),
        totalesDelEscaneo: { totalParticipantes, totalConLid, totalConTelefono },
        participantesAnalizados: casos.length,
        conteoPorCaso,
        casos

    };

    const rutaReporte = guardarReporte(resultadoFinal);

    console.log(`\n📄 Reporte COMPLETO (sin enmascarar) guardado en: ${rutaReporte}`);
    console.log("ℹ️  100% solo lectura. No se modificó Supabase, usuarios, reservas ni identityScanner.");

}

main().catch(err => {

    console.error("💥 Error inesperado en el diagnóstico");
    console.error(err);
    process.exitCode = 1;

});
