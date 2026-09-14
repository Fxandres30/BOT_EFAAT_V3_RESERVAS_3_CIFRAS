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
    groupMetadata: groupMetadataEncolado
} = require("../../../services/baileys/groupQueue");

// FASE 2 (IdentitySync) — motor ÚNICO de extracción, ver
// identityScanner/index.js. Reemplaza la lectura de campos fijos
// (participant.lid / .phoneNumber / .id) que tenía antes este archivo:
// ahora recorre el participante COMPLETO (cualquier campo, cualquier
// anidamiento) y ya no depende de que Baileys siga usando esos 3 nombres
// de campo. "No crear una segunda implementación del scanner" — este
// archivo deja de tener su propia extracción y pasa a ser un consumidor
// más de identityScanner, igual que el escaneo en vivo de mensajes.
const { escanearObjeto } = require("./identityScanner");

// FASE 2 — el mismo IdentityResolver que usa el escaneo en vivo de
// mensajes (identitySync). importarIdentidades() deja de llamar a
// obtenerUsuarioGlobal() directamente y pasa por acá, para que el
// escaneo de grupos TAMBIÉN se beneficie de la canonicalización de LID
// (sección 6 — sufijo de dispositivo) con el mismo criterio único, en vez
// de un segundo camino de resolución.
const { resolverIdentidad } = require("./identityScanner/identityResolver");

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
// phoneNumber, name, notify, verifiedName... — o cualquier otra forma que
// Baileys use en el futuro), el candidato de identidad.
//
// FASE 2: ya no lee campos fijos por nombre — delega TODO el recorrido en
// identityScanner (recorrerObjeto + normalizarCandidatos), que camina el
// participante completo sin asumir en qué propiedad viene cada dato. Este
// función solo decide, sobre los candidatos YA encontrados, cuál usar
// (mismo criterio de "un participante = una persona" de siempre) y arma el
// mismo shape { lid, telefono, nombre, fuente } que ya esperaban
// reconciliarIdentidades()/importarIdentidades() — nadie más en este
// archivo cambia.
//
// Nombre: se prioriza "notify" (el nombre que la propia persona configuró
// en WhatsApp) sobre "name" (el nombre que el TELÉFONO DEL BOT tiene
// guardado en su libreta de contactos — para una cuenta de bot esto casi
// nunca existe y, si existiera, no sería un dato que la persona controla).
// "verifiedName" (cuentas de empresa) se usa como último recurso.
// ==========================================================================
function extraerCandidatoDeParticipante(participante, { grupoId } = {}) {

    const resultado = escanearObjeto(participante, {
        fuenteBase: grupoId ? `grupo[${grupoId}].participante` : "participante"
    });

    if (resultado.lids.length > 1) {

        console.warn(
            `⚠️ [ESCÁNER IDENTIDADES] participante con ${resultado.lids.length} LIDs distintos (dato anómalo) — se usa el primero. Todos: ${resultado.lids.join(", ")}`
        );

    }

    const lid = resultado.lids[0] || null;

    // Solo teléfonos con longitud/formato válido (ver normalizarCandidatos.js)
    // — antes este archivo aceptaba cualquier cosa que quedara tras quitar
    // el "57" inicial, sin validar longitud. Un candidato inválido no se
    // descarta silenciosamente: sigue disponible en resultado.candidatos
    // para quien quiera auditar, solo no se usa como teléfono de "usuarios".
    const candidatoTelefono = resultado.candidatos.find(c => c.tipo === "phone" && c.valido);
    const telefono = candidatoTelefono ? candidatoTelefono.valor : null;

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
// MODO B — IMPORTACIÓN REAL. La invoca escanerIdentidadesLifecycle.js
// (escaneo completo al conectar/reconectar + periódico, y escaneo
// incremental por grupo) — no es un modo manual/desconectado, es el camino
// real que puebla "usuarios" a partir de los participantes de grupo.
//
// Reutiliza resolverIdentidad() (identityResolver.js) — que a su vez
// reutiliza obtenerUsuarioGlobal(), el mismo camino seguro que ya usan los
// mensajes reales (resuelve por LID/teléfono, nunca sobrescribe, detecta
// colisión y no fusiona). El escáner NO inventa un segundo camino de
// escritura a "usuarios".
//
// `usuarioIdTenant` (opcional) — propagado por escanerIdentidadesLifecycle.js
// desde sock.context.usuarioId — registra, además, la relación tenant/
// contacto en contactos_tenant (ver obtenerUsuarioGlobal.js
// ::registrarContactoTenant). Sin este parámetro, se comporta exactamente
// igual que antes: solo resuelve/crea en "usuarios".
//
// CONCURRENCIA (optimización 2026-09 — informe "escaneo de ~2.800
// participantes tarda 30-60min"): antes se procesaba una identidad a la
// vez, en serie (`for...of` con `await` adentro) — con ~7 round-trips a
// Supabase por participante, ~2.800 participantes se volvían ~19.600
// llamadas HTTP en serie. Ahora se procesan en lotes de
// CONCURRENCIA_IMPORTACION identidades EN PARALELO (Promise.all por lote,
// lotes en serie entre sí) — el guard de un-solo-escaneo-por-sesión
// (escanerIdentidadesLifecycle.js::escaneoCompletoEnCurso) NO se toca: sigue
// habiendo exactamente UN escaneo completo en vuelo por sesión, esto solo
// acelera lo que pasa DENTRO de ese único escaneo.
//
// Es seguro procesar en paralelo porque:
//   1. `identidades` ya viene deduplicada por reconciliarIdentidades()
//      (ver escanearIdentidades() más arriba) — dos entradas del mismo lote
//      nunca comparten lid ni teléfono exactos.
//   2. Si dos resoluciones concurrentes (de personas distintas que
//      canonicalizan al mismo usuario por sufijo de dispositivo, caso raro)
//      compitieran por crear la misma fila, obtenerUsuarioGlobal.js YA
//      maneja esa carrera (unique_violation 23505 -> reutiliza la fila
//      ganadora, nunca duplica — ver su propio comentario "Concurrencia" y
//      la prueba 14 de identidad.test.js).
//   3. Cada identidad sigue en su propio try/catch: una que falle no aborta
//      el lote ni el resto del escaneo, se cuenta como error y se sigue.
// ==========================================================================
const CONCURRENCIA_IMPORTACION = 18;

async function importarUnaIdentidad(identidad, usuarioIdTenant) {

    try {

        const r = await resolverIdentidad({

            lids: identidad.lid ? [identidad.lid] : [],
            telefonos: identidad.telefono ? [identidad.telefono] : [],
            candidatos: identidad.telefono
                ? [{ tipo: "phone", valor: identidad.telefono, valido: true }]
                : [],
            nombre: identidad.nombre,
            fromMe: false,
            usuarioIdTenant,
            origenContacto: "escaneo_grupo"

        });

        return {
            entrada: identidad,
            usuario: r.usuario,
            importado: !!r.usuario,
            esNuevo: r.esNuevo,
            fueEnriquecido: r.fueEnriquecido,
            conflicto: r.conflicto,
            errorInesperado: false
        };

    } catch (err) {

        // Una identidad individual que falle (error real de Supabase,
        // dato inesperado, etc.) NUNCA debe abortar el resto del escaneo —
        // se registra como error y se continúa con las demás.
        console.error(`❌ [ESCÁNER IDENTIDADES] error resolviendo identidad (lid=${identidad.lid || "-"}, telefono=${identidad.telefono || "-"}):`, err?.message);

        return {
            entrada: identidad,
            usuario: null,
            importado: false,
            esNuevo: false,
            fueEnriquecido: false,
            conflicto: false,
            errorInesperado: true
        };

    }

}

async function importarIdentidades({ identidades, usuarioIdTenant = null }) {

    const resultados = [];

    let nuevos = 0, enriquecidos = 0, conflictos = 0, errores = 0;

    for (let i = 0; i < identidades.length; i += CONCURRENCIA_IMPORTACION) {

        const lote = identidades.slice(i, i + CONCURRENCIA_IMPORTACION);

        const resultadosLote = await Promise.all(
            lote.map((identidad) => importarUnaIdentidad(identidad, usuarioIdTenant))
        );

        for (const r of resultadosLote) {

            if (r.errorInesperado) errores++;
            else if (r.esNuevo) nuevos++;
            else if (r.fueEnriquecido) enriquecidos++;
            else if (r.conflicto) conflictos++;

            resultados.push(r);

        }

    }

    const importados = resultados.filter(r => r.importado).length;
    const noImportados = resultados.length - importados;

    return {
        modo: "import",
        generadoEn: new Date().toISOString(),
        total: resultados.length,
        importados,
        noImportados,
        nuevos,
        enriquecidos,
        conflictos,
        errores,
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

// ==========================================================================
// Reporte legible en consola para UN ciclo de IdentitySync (escaneo +
// importación juntos) — formato pedido en la auditoría de identidad, Fase
// 2, sección "Logs". Distinto de formatearReporteTexto() (que es solo el
// DRY-RUN de extracción, sin import, y sus pruebas ya dependen del texto
// exacto que produce hoy) — este es aditivo, no lo reemplaza.
// ==========================================================================
function formatearReporteIdentitySync({ alcance, participantes, encontrados, nuevos, enriquecidos, conflictos, errores }) {

    return [
        "🔎 IDENTITY SCAN",
        `${alcance}`,
        `Participantes: ${participantes}`,
        `Encontrados: ${encontrados}`,
        `Nuevos: ${nuevos}`,
        `Enriquecidos: ${enriquecidos}`,
        `Conflictos: ${conflictos}`,
        `Errores: ${errores}`
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
    formatearReporteTexto,
    formatearReporteIdentitySync

};
