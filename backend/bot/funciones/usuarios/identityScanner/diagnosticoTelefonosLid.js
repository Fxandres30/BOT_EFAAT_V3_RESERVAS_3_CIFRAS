// ==========================================================================
// DIAGNÓSTICO PUNTUAL — 100% READ-ONLY — por qué el escáner encuentra tantos
// "solo LID" y tan pocos teléfonos.
// ==========================================================================
// Pensado para invocarse desde DENTRO del proceso real que ya tiene el
// `sock` conectado (ver bot/controllers/sessionsController.js ::
// diagnosticoTelefonosLid, expuesto en GET /sessions/active/diagnostico-
// telefonos-lid) — nunca abre una sesión propia, nunca reconecta nada.
//
// Qué hace:
//   ✅ sock.groupFetchAllParticipating() — lectura real de la sesión activa.
//   ✅ Recorre TODOS los participantes con un buscador de claves/valores
//      INDEPENDIENTE (no reutiliza ni modifica recorrerObjeto.js — es el
//      testigo para comparar contra él).
//   ✅ Ejecuta escanearObjeto() (identityScanner ACTUAL) SIN MODIFICARLO —
//      solo se importa y se llama, para saber qué encuentra HOY.
//   ✅ Consulta sock.signalRepository.lidMapping.getPNForLID() — store
//      INTERNO de Baileys (Signal/lid-mapping.js), separado por completo de
//      groupFetchAllParticipating(). Solo lectura (getPNForLID), nunca
//      storeLIDPNMappings.
//   ❌ NO llama a obtenerUsuarioGlobal/resolverIdentidad/escanearGrupo/
//      importarIdentidades — CERO escritura en Supabase, cero usuarios,
//      cero reservas, cero merges, cero cambios de sesión/credenciales.
//   ❌ NO modifica identityScanner/ ni ningún archivo de producción.
// ==========================================================================

// El motor ACTUAL, importado tal cual (sin modificarlo) — este diagnóstico
// solo lo CONSUME para saber qué encuentra hoy, nunca lo cambia.
const { escanearObjeto } = require("./index");

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

function esRutaAnidada(ruta) {
    return ruta.includes(".") || ruta.includes("[");
}

function tieneArrobaLid(valor) {
    return typeof valor === "string" && (valor.endsWith("@lid") || valor.endsWith("@hosted.lid"));
}

// A propósito SOLO dominios de tipo teléfono — NO "@lid"/"@hosted.lid" (un
// participante "solo LID" siempre tiene su propio LID como valor; contarlo
// aquí lo haría parecer, por error, "sí tiene un valor con forma de
// teléfono").
function tieneArrobaWhatsapp(valor) {
    return typeof valor === "string" && (valor.includes("@s.whatsapp.net") || (valor.includes("@hosted") && !valor.includes("@hosted.lid")));
}

// Heurística para el Caso B: un valor con FORMA de teléfono (10-15 dígitos,
// tolera separadores) que NO trae ningún "@dominio" — un formato que
// recorrerObjeto.js jamás reconocería (exige siempre user@dominio, por
// diseño, para no confundir un teléfono con cualquier otro número largo).
function pareceTelefonoPelado(valor, idPropio) {

    if (typeof valor !== "string" || valor.includes("@")) return false;
    if (idPropio && valor === idPropio) return false;

    const soloDigitos = valor.replace(/\D/g, "");

    return soloDigitos.length >= 10 && soloDigitos.length <= 15;

}

function enmascararInicioVisible(valor, n = 4) {

    if (!valor) return "(ninguno)";

    const [usuario, dominio] = String(valor).split("@");
    const visible = usuario.slice(0, n);
    const oculto = "•".repeat(Math.max(0, usuario.length - n));

    return `${visible}${oculto}${dominio ? "@" + dominio : ""}`;

}

// Ejecuta `fn` sobre `items` con concurrencia limitada — mismo patrón que ya
// usa _reconstruccion_usuarios.js (enLotes), no una lógica nueva.
async function enLotes(items, tam, fn) {

    const resultados = [];

    for (let i = 0; i < items.length; i += tam) {

        const lote = items.slice(i, i + tam);
        const parcial = await Promise.all(lote.map(fn));
        resultados.push(...parcial);

    }

    return resultados;

}

async function consultarLidMappingStore(sock, lid) {

    try {

        const store = sock?.signalRepository?.lidMapping;

        if (!store || typeof store.getPNForLID !== "function") {

            return { disponible: false, motivo: "sock.signalRepository.lidMapping no existe en este socket", pn: null };

        }

        const pn = await store.getPNForLID(lid);

        return { disponible: true, pn: pn || null };

    } catch (err) {

        return { disponible: false, motivo: `error consultando el store: ${err?.message}`, pn: null };

    }

}

// ==========================================================================
// Clasifica el caso (A/B/C/D) para UN participante "solo LID" ya analizado.
// ==========================================================================
function clasificarCaso({ hojasTelefono, telefonosPelados, lidMapping }) {

    if (hojasTelefono.length > 0) {
        return "A";
    }

    if (telefonosPelados.length > 0) {
        return "B";
    }

    if (lidMapping.disponible && lidMapping.pn) {
        return "D";
    }

    return "C";

}

// ==========================================================================
// ejecutarDiagnosticoTelefonosLid(sock, opciones) — punto de entrada único.
// Devuelve un objeto estructurado con TODO (agregados + muestra profunda +
// texto de resumen ya formateado). No escribe nada — quien la invoque
// decide si guarda el resultado en un archivo (ver el controlador).
// ==========================================================================
async function ejecutarDiagnosticoTelefonosLid(sock, { maxMuestraProfunda = 10, maxEjemplos = 5, concurrenciaLidMapping = 20 } = {}) {

    if (!sock || typeof sock.groupFetchAllParticipating !== "function") {

        throw new Error("El socket no expone groupFetchAllParticipating() — ¿sesión de Baileys no conectada?");

    }

    const generadoEn = new Date().toISOString();

    const mapa = await sock.groupFetchAllParticipating();
    const grupos = Object.values(mapa || {});

    let participantesAnalizados = 0;
    let conArrobaLid = 0;
    let conArrobaWhatsapp = 0;
    let conCampoPhoneNumber = 0;
    let conCampoPn = 0;
    let conTelefonoAnidado = 0;

    // Uno por LID único (dedup — la misma persona puede repetirse en varios
    // grupos; el diagnóstico habla de LIDs, no de apariciones).
    const soloLidPorLid = new Map();

    for (const grupo of grupos) {

        for (const participante of (grupo.participants || [])) {

            participantesAnalizados++;

            const hojas = aplanarObjeto(participante);

            if (hojas.some(h => tieneArrobaLid(h.valor))) conArrobaLid++;

            const hojasTelefono = hojas.filter(h => tieneArrobaWhatsapp(h.valor));
            if (hojasTelefono.length > 0) conArrobaWhatsapp++;
            if (hojasTelefono.some(h => esRutaAnidada(h.ruta))) conTelefonoAnidado++;

            if (Object.prototype.hasOwnProperty.call(participante || {}, "phoneNumber")) conCampoPhoneNumber++;

            const tieneCampoPn =
                Object.prototype.hasOwnProperty.call(participante || {}, "pn") ||
                hojas.some(h => /(^|[.\[])pn($|[.\[])/i.test(h.ruta));

            if (tieneCampoPn) conCampoPn++;

            // Clasificación con el motor ACTUAL, sin modificarlo — decide si
            // este participante entra al análisis "solo LID".
            const resultadoScanner = escanearObjeto(participante, { fuenteBase: `grupo[${grupo.id}].participante` });

            const esSoloLid = resultadoScanner.lids.length > 0 && resultadoScanner.telefonos.length === 0;

            if (esSoloLid) {

                const lid = resultadoScanner.lids[0];

                if (!soloLidPorLid.has(lid)) {

                    soloLidPorLid.set(lid, {
                        grupoId: grupo.id,
                        participante,
                        lid,
                        hojas,
                        hojasTelefono,
                        telefonosPelados: hojas.filter(h => pareceTelefonoPelado(h.valor, participante?.id))
                    });

                }

            }

        }

    }

    const soloLid = [...soloLidPorLid.values()];

    console.log(`🔎 [DIAGNÓSTICO] ${participantesAnalizados} participantes analizados, ${soloLid.length} LIDs únicos "solo LID" — consultando lidMapping (concurrencia ${concurrenciaLidMapping})...`);

    // ---- lidMapping: para TODOS los LIDs únicos "solo LID" (no solo la
    // muestra profunda) — es la pregunta central de este diagnóstico. ----
    const conResultadoMapping = await enLotes(soloLid, concurrenciaLidMapping, async (item) => {

        const lidMapping = await consultarLidMappingStore(sock, item.lid);

        return {
            ...item,
            lidMapping,
            caso: clasificarCaso({ hojasTelefono: item.hojasTelefono, telefonosPelados: item.telefonosPelados, lidMapping })
        };

    });

    const storeDisponible = conResultadoMapping.some(c => c.lidMapping.disponible) || soloLid.length === 0;

    const lidsConsultados = conResultadoMapping.filter(c => c.lidMapping.disponible).length;
    const telefonosPorMapping = conResultadoMapping.filter(c => c.lidMapping.disponible && c.lidMapping.pn).length;
    const lidsSinTelefonoEnMapping = lidsConsultados - telefonosPorMapping;

    const conteoPorCaso = { A: 0, B: 0, C: 0, D: 0 };
    conResultadoMapping.forEach(c => { conteoPorCaso[c.caso]++; });

    // ---- muestra profunda (hasta 10) para inspección detallada + ejemplos ----
    const muestra = conResultadoMapping.slice(0, maxMuestraProfunda);

    const ejemplos = muestra.slice(0, maxEjemplos).map((c) => {

        const campoDondeAparecio =
            c.hojasTelefono[0]?.ruta ||
            c.telefonosPelados[0]?.ruta ||
            null;

        return {
            lid: c.lid,
            lidEnmascarado: enmascararInicioVisible(c.lid),
            telefonoEnObjeto: c.hojasTelefono.length > 0 || c.telefonosPelados.length > 0,
            campoDondeAparecio,
            telefonoPorLidMapping: !!(c.lidMapping.disponible && c.lidMapping.pn),
            caso: c.caso
        };

    });

    const resumenTexto = [

        "# IDENTITY DIAGNOSTIC",
        "",
        `Participantes analizados: ${participantesAnalizados}`,
        "",
        "LID:",
        `con @lid: ${conArrobaLid}`,
        "",
        "TELÉFONO:",
        `@s.whatsapp.net encontrados: ${conArrobaWhatsapp}`,
        `phoneNumber: ${conCampoPhoneNumber}`,
        `pn: ${conCampoPn}`,
        `teléfonos encontrados en propiedades anidadas: ${conTelefonoAnidado}`,
        "",
        "LID → TELÉFONO:",
        storeDisponible
            ? `LIDs consultados en lidMapping: ${lidsConsultados}`
            : "lidMapping NO disponible en este socket (sock.signalRepository.lidMapping ausente)",
        `teléfonos encontrados mediante lidMapping: ${telefonosPorMapping}`,
        `LIDs sin teléfono en mapping: ${lidsSinTelefonoEnMapping}`,
        "",
        "RESULTADO (sobre los LIDs únicos \"solo LID\"):",
        `Caso A (teléfono en objeto, scanner no lo detecta): ${conteoPorCaso.A}`,
        `Caso B (teléfono en otro campo/formato sin '@dominio'): ${conteoPorCaso.B}`,
        `Caso C (teléfono no está ni en el objeto ni en lidMapping): ${conteoPorCaso.C}`,
        `Caso D (teléfono no está en el objeto pero SÍ en lidMapping): ${conteoPorCaso.D}`

    ].join("\n");

    return {

        generadoEn,
        gruposEncontrados: grupos.length,
        participantesAnalizados,

        lid: { conArrobaLid },

        telefono: {
            conArrobaWhatsapp,
            conCampoPhoneNumber,
            conCampoPn,
            conTelefonoAnidado
        },

        lidMapping: {
            storeDisponible,
            lidsUnicosSoloLid: soloLid.length,
            lidsConsultados,
            telefonosEncontrados: telefonosPorMapping,
            lidsSinTelefonoEnMapping
        },

        casos: conteoPorCaso,

        ejemplos,

        // Detalle completo (sin enmascarar) de la muestra profunda — para el
        // reporte JSON guardado en disco, no para consola.
        muestraProfundaCompleta: muestra.map(c => ({
            grupoId: c.grupoId,
            lid: c.lid,
            objetoCrudo: c.participante,
            hojasTelefono: c.hojasTelefono,
            telefonosPelados: c.telefonosPelados,
            lidMapping: c.lidMapping,
            caso: c.caso
        })),

        resumenTexto

    };

}

module.exports = { ejecutarDiagnosticoTelefonosLid, enmascararInicioVisible };
