// ==========================================================================
// MINI ESCÁNER DE IDENTIDADES
// ==========================================================================
// Reconstruye candidatos de identidad (lid / teléfono / nombre) a partir de
// los GRUPOS de WhatsApp que ya conoce la sesión activa de Baileys, sin
// esperar a que las personas vuelvan a escribir.
//
// Reutiliza el ÚNICO criterio de identidad del sistema
// (normalizarIdentificadoresDesdeJid, definido en obtenerUsuarioGlobal.js)
// — este archivo NO reimplementa ninguna regla de identidad nueva, solo
// aporta las FUENTES (participantes de grupo) y la RECONCILIACIÓN en
// memoria antes de tocar Supabase.
//
// Dos modos:
//   - escanearIdentidades()  → DRY-RUN. Solo lee Baileys. NO toca Supabase.
//   - importarIdentidades()  → escribe usando obtenerUsuarioGlobal() (el
//     mismo camino seguro que ya usan los mensajes reales: detecta
//     colisiones, nunca sobrescribe, nunca fusiona). NO se ejecuta todavía
//     — queda implementado y probado para cuando se apruebe el import real.
// ==========================================================================

const {
    isLidUser,
    isPnUser,
    jidDecode
} = require("@whiskeysockets/baileys");

const {
    obtenerUsuarioGlobal,
    normalizarIdentificadoresDesdeJid
} = require("./obtenerUsuarioGlobal");

const {
    groupMetadata: groupMetadataEncolado
} = require("../../../services/baileys/groupQueue");

// ==========================================================================
// Clasificación de un JID crudo (puede venir de participant.id,
// participant.lid, participant.phoneNumber, sock.user.id, etc.)
// ==========================================================================
// NO se asume que "@s.whatsapp.net" siempre es teléfono ni que "@lid"
// siempre es LID por ubicación del campo: se usan los propios helpers de
// Baileys (isLidUser / isPnUser) para decidir, y luego se delega en
// normalizarIdentificadoresDesdeJid() para producir el mismo formato que
// usa el resto del sistema.
function clasificarJid(jid) {

    if (!jid || typeof jid !== "string") return "desconocido";

    if (isLidUser(jid)) return "lid";
    if (isPnUser(jid)) return "telefono";

    return "desconocido";

}

// ==========================================================================
// Extrae, de UN participante de grupo (forma Contact de Baileys: id, lid,
// phoneNumber, name, notify, verifiedName...), el candidato de identidad.
//
// No importa en qué campo llegó cada dato — se revisan todas las fuentes
// disponibles y se normalizan con el mismo criterio que usa el resto del
// sistema:
//   - participant.lid          (ya viene en formato "...@lid")
//   - participant.phoneNumber  (ya viene en formato "...@s.whatsapp.net")
//   - participant.id           (respaldo: "preferido" según la doc de
//                                Baileys, puede ser @lid o @s.whatsapp.net
//                                según el modo de direccionamiento — se
//                                clasifica antes de usarlo, NUNCA se asume)
//
// Nombre: se prioriza "notify" (el nombre que la propia persona configuró
// en WhatsApp) sobre "name" (el nombre que el TELÉFONO DEL BOT tiene
// guardado en su libreta de contactos — para una cuenta de bot esto casi
// nunca existe y, si existiera, no sería un dato que la persona controla).
// "verifiedName" (cuentas de empresa) se usa como último recurso.
// ==========================================================================
function extraerCandidatoDeParticipante(participante, { grupoId } = {}) {

    let lid = null;
    let telefono = null;

    // 1) Campos explícitos que Baileys ya separó por nosotros.
    if (participante?.lid && clasificarJid(participante.lid) === "lid") {

        lid = normalizarIdentificadoresDesdeJid(participante.lid).lid;

    }

    if (participante?.phoneNumber && clasificarJid(participante.phoneNumber) === "telefono") {

        telefono = normalizarIdentificadoresDesdeJid(participante.phoneNumber).telefono;

    }

    // 2) Respaldo: participant.id ("preferido" según Baileys, pero puede
    //    ser @lid O @s.whatsapp.net — se clasifica, nunca se asume).
    if ((!lid || !telefono) && participante?.id) {

        const derivado = normalizarIdentificadoresDesdeJid(participante.id);

        if (!lid && derivado.lid) lid = derivado.lid;
        if (!telefono && derivado.telefono) telefono = derivado.telefono;

    }

    const nombre =
        participante?.notify ||
        participante?.verifiedName ||
        participante?.name ||
        null;

    if (!lid && !telefono) return null;

    return {
        lid,
        telefono,
        nombre,
        fuente: { grupoId: grupoId || null, participanteId: participante?.id || null }
    };

}

// ==========================================================================
// Identidad del propio BOT — jamás debe entrar a la reconstrucción, aunque
// aparezca como participante de todos sus grupos (regla 6, análoga a
// "fromMe" pero para participantes de grupo).
// ==========================================================================
function extraerIdentidadDelBot(sock) {

    const contactoBot = sock?.user || null;

    if (!contactoBot) return { lid: null, telefono: null };

    const candidato = extraerCandidatoDeParticipante(contactoBot) || {};

    return {
        lid: candidato.lid || null,
        telefono: candidato.telefono || null
    };

}

// Compara por el "user" decodificado del JID, NUNCA por el string completo.
// BUG REAL encontrado en producción: sock.user.lid trae el LID con sufijo
// de dispositivo (p. ej. "7156153774273:11@lid"), mientras que ese mismo
// bot aparece en la lista de participantes de sus propios grupos SIN ese
// sufijo ("7156153774273@lid"). Una comparación de string exacto los trata
// como personas distintas y deja pasar al propio bot como si fuera un
// participante real. normalizarIdentificadoresDesdeJid() no quita el
// sufijo de dispositivo del LID (por diseño, para no alterar el criterio
// ya usado en producción) — por eso esta comparación específica sí debe
// ignorar el dispositivo.
function usuarioDeJid(jid) {

    if (!jid) return null;

    const decodificado = jidDecode(jid);
    return decodificado?.user || null;

}

function esIdentidadDelBot(candidato, identidadBot) {

    if (!candidato || !identidadBot) return false;

    if (
        identidadBot.lid &&
        candidato.lid &&
        usuarioDeJid(candidato.lid) === usuarioDeJid(identidadBot.lid)
    ) return true;

    if (identidadBot.telefono && candidato.telefono === identidadBot.telefono) return true;

    return false;

}

// ==========================================================================
// Reconciliación EN MEMORIA de todos los candidatos recolectados (de todos
// los grupos), aplicando las reglas 1-4 y 7-10:
//   - Un candidato con solo LID o solo teléfono crea/alimenta una identidad.
//   - Un candidato con AMBOS completa bidireccionalmente la misma identidad
//     si coinciden; si LID y teléfono ya apuntan a identidades DISTINTAS ya
//     reconstruidas, es un CONFLICTO — no se fusiona, se registra y se
//     continúa.
//   - La misma persona en varios grupos NUNCA genera una segunda identidad
//     (se deduplica por lid/teléfono, no por grupo).
// ==========================================================================
function reconciliarIdentidades(candidatos) {

    const porLid = new Map();
    const porTelefono = new Map();
    const identidades = [];
    const conflictos = [];

    let duplicadosEvitados = 0;

    for (const candidato of candidatos) {

        const existentePorLid = candidato.lid ? porLid.get(candidato.lid) : null;
        const existentePorTelefono = candidato.telefono ? porTelefono.get(candidato.telefono) : null;

        // --- Conflicto: LID -> identidad A, teléfono -> identidad B (distintas) ---
        if (existentePorLid && existentePorTelefono && existentePorLid !== existentePorTelefono) {

            conflictos.push({
                tipo: "IDENTITY_CONFLICT",
                lid: candidato.lid,
                telefono: candidato.telefono,
                identidadPorLid: existentePorLid,
                identidadPorTelefono: existentePorTelefono,
                fuente: candidato.fuente
            });

            // Seguridad primero: NO fusionar, NO tocar ninguna de las dos
            // identidades ya reconstruidas. Se descarta este candidato.
            continue;

        }

        // --- Ya existe una identidad para lid o teléfono: completar/reusar ---
        const identidadExistente = existentePorLid || existentePorTelefono;

        if (identidadExistente) {

            let cambio = false;

            if (!identidadExistente.lid && candidato.lid) {
                identidadExistente.lid = candidato.lid;
                porLid.set(candidato.lid, identidadExistente);
                cambio = true;
            }

            if (!identidadExistente.telefono && candidato.telefono) {
                identidadExistente.telefono = candidato.telefono;
                porTelefono.set(candidato.telefono, identidadExistente);
                cambio = true;
            }

            if (!identidadExistente.nombre && candidato.nombre) {
                identidadExistente.nombre = candidato.nombre;
                cambio = true;
            }

            identidadExistente.fuentes.push(candidato.fuente);

            if (!cambio) duplicadosEvitados++; // misma persona, mismo dato, otro grupo

            continue;

        }

        // --- Identidad nueva ---
        const nueva = {
            lid: candidato.lid,
            telefono: candidato.telefono,
            nombre: candidato.nombre,
            fuentes: [candidato.fuente]
        };

        identidades.push(nueva);

        if (nueva.lid) porLid.set(nueva.lid, nueva);
        if (nueva.telefono) porTelefono.set(nueva.telefono, nueva);

    }

    return { identidades, conflictos, duplicadosEvitados };

}

// ==========================================================================
// Lista los grupos de la sesión activa CON sus participantes, en UNA sola
// llamada (groupFetchAllParticipating ya incluye .participants por grupo —
// no hace falta encolar un groupMetadata() por grupo, evitando el
// rate-overlimit de WhatsApp que ya documenta services/baileys/groupQueue.js).
// ==========================================================================
async function listarGruposActivos(sock) {

    if (!sock || typeof sock.groupFetchAllParticipating !== "function") {
        throw new Error("El socket no expone groupFetchAllParticipating() — ¿sesión de Baileys no conectada?");
    }

    const mapa = await sock.groupFetchAllParticipating();

    return Object.values(mapa || {});

}

// Fallback explícito para un grupo puntual, pasando por la cola central
// (rate-limit friendly). No se usa en el camino normal del escáner, pero
// queda disponible por si algún grupo llega sin participantes en el bulk
// fetch y hace falta refrescarlo puntualmente.
async function escanearGrupoPuntual(sock, grupoId) {

    return groupMetadataEncolado(sock, grupoId);

}

// ==========================================================================
// MODO A — DRY-RUN / AUDITORÍA. Solo lee Baileys. NO toca Supabase.
// ==========================================================================
async function escanearIdentidades({ sock, grupos = null } = {}) {

    const identidadBot = extraerIdentidadDelBot(sock);

    const listaGrupos = grupos || await listarGruposActivos(sock);

    let participantesAnalizados = 0;
    let excluidosPorSerElBot = 0;

    const candidatos = [];

    for (const grupo of listaGrupos) {

        const participantes = grupo.participants || [];

        for (const participante of participantes) {

            participantesAnalizados++;

            const candidato = extraerCandidatoDeParticipante(participante, { grupoId: grupo.id });

            if (!candidato) continue; // ni lid ni teléfono reconocibles

            if (esIdentidadDelBot(candidato, identidadBot)) {
                excluidosPorSerElBot++;
                continue; // regla 6 (análoga a fromMe): el bot nunca es un cliente
            }

            candidatos.push(candidato);

        }

    }

    const { identidades, conflictos, duplicadosEvitados } = reconciliarIdentidades(candidatos);

    const conAmbos = identidades.filter(i => i.lid && i.telefono).length;
    const soloLid = identidades.filter(i => i.lid && !i.telefono).length;
    const soloTelefono = identidades.filter(i => !i.lid && i.telefono).length;

    const lidsEncontrados = candidatos.filter(c => c.lid).length;
    const telefonosEncontrados = candidatos.filter(c => c.telefono).length;

    const estadisticas = {

        gruposEncontrados: listaGrupos.length,
        participantesAnalizados,
        excluidosPorSerElBot,

        lidsEncontrados,
        telefonosEncontrados,

        identidadesUnicasReconstruibles: identidades.length,
        conLidYTelefono: conAmbos,
        soloLid,
        soloTelefono,

        conflictos: conflictos.length,
        duplicadosEvitados

    };

    return {
        modo: "dry-run",
        generadoEn: new Date().toISOString(),
        estadisticas,
        identidades,
        conflictos
    };

}

// ==========================================================================
// MODO B — IMPORTACIÓN REAL. Implementado y probado, pero NO se invoca
// automáticamente desde ningún punto del sistema: requiere una llamada
// explícita, y solo debería ejecutarse después de revisar el DRY-RUN.
//
// Reutiliza obtenerUsuarioGlobal() — el mismo camino seguro que ya usan los
// mensajes reales (resuelve por LID/teléfono, nunca sobrescribe, detecta
// colisión y no fusiona). El escáner NO inventa un segundo camino de
// escritura a "usuarios".
// ==========================================================================
async function importarIdentidades({ identidades }) {

    const resultados = [];

    for (const identidad of identidades) {

        const usuario = await obtenerUsuarioGlobal({

            lid: identidad.lid,
            telefono: identidad.telefono,
            nombre: identidad.nombre,
            fromMe: false

        });

        resultados.push({
            entrada: identidad,
            usuario,
            importado: !!usuario
        });

    }

    const importados = resultados.filter(r => r.importado).length;
    const noImportados = resultados.length - importados;

    return {
        modo: "import",
        generadoEn: new Date().toISOString(),
        total: resultados.length,
        importados,
        noImportados,
        resultados
    };

}

// ==========================================================================
// Reporte legible en consola, con el formato pedido.
// ==========================================================================
function formatearReporteTexto(resultado) {

    const e = resultado.estadisticas;

    return [
        "🔎 ESCÁNER DE IDENTIDADES",
        "",
        `Grupos encontrados: ${e.gruposEncontrados}`,
        `Participantes analizados: ${e.participantesAnalizados}`,
        "",
        `LIDs encontrados: ${e.lidsEncontrados}`,
        `Teléfonos encontrados: ${e.telefonosEncontrados}`,
        `Identidades únicas reconstruibles: ${e.identidadesUnicasReconstruibles}`,
        "",
        `Identidades con LID + teléfono: ${e.conLidYTelefono}`,
        `Solo LID: ${e.soloLid}`,
        `Solo teléfono: ${e.soloTelefono}`,
        `Conflictos: ${e.conflictos}`,
        `Duplicados evitados: ${e.duplicadosEvitados}`,
        "",
        `(excluidos por ser el propio BOT: ${e.excluidosPorSerElBot})`
    ].join("\n");

}

module.exports = {

    // Orquestadores
    escanearIdentidades,
    importarIdentidades,

    // Piezas — exportadas para pruebas e instrumentación
    clasificarJid,
    extraerCandidatoDeParticipante,
    extraerIdentidadDelBot,
    esIdentidadDelBot,
    reconciliarIdentidades,
    listarGruposActivos,
    escanearGrupoPuntual,
    formatearReporteTexto

};
