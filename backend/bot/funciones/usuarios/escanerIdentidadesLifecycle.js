// ==========================================================================
// CICLO DE VIDA DEL ESCÁNER DE IDENTIDADES
// ==========================================================================
// Disparadores (NO un intervalo periódico propio):
//
//   1. Al iniciar/reiniciar el BOT (sesión activa disponible) -> escaneo
//      COMPLETO de todos los grupos, una sola vez.
//   2. Cada vez que el BOT abre un grupo con éxito (abrirGrupo() confirmado
//      por WhatsApp) -> escaneo INCREMENTAL de ESE grupo únicamente.
//
// Se conecta a los eventos YA existentes del ciclo de vida del bot
// (manager "activeChanged"/"activeLost" vía bot/index.js) y de apertura de
// grupo (detectarEvento.js / workerEventos.js) — no crea un sistema
// paralelo ni un timer propio.
//
// Todo lo que dispara este módulo es "fire and forget" (no bloqueante):
// nunca debe retrasar ni afectar el registro de mensajes, el worker de
// eventos, ni la decisión de abrir/cerrar un grupo. Es un observador que
// mantiene "usuarios" al día — no forma parte del flujo de negocio.
// ==========================================================================

const {
    escanearIdentidades,
    importarIdentidades,
    formatearReporteTexto
} = require("./escanerIdentidades");

const {
    groupMetadata
} = require("../../../services/baileys/groupQueue");

// sessionId -> sock. Permite detectar, cuando una promesa en curso
// finalmente resuelve, si esa sesión sigue siendo la activa (mismo patrón
// que bot/index.js usa con socketActual/sesionActual) — evita que un
// escaneo tardío de una sesión ya reemplazada escriba con un socket muerto.
const sesionesActivas = new Map();

// Un solo escaneo COMPLETO en curso por sesión.
const escaneoCompletoEnCurso = new Set();

// Un solo escaneo POR GRUPO en curso. Si la señal de "grupo abierto" llega
// dos veces casi simultáneamente para el mismo grupo (p. ej. detectarEvento
// y, en el mismo tick, la reconciliación de workerEventos), la segunda se
// omite en vez de arrancar un escaneo duplicado.
const escaneosDeGrupoEnCurso = new Set();

// ==========================================================================
// Activa el escáner para una sesión: dispara el escaneo inicial completo
// UNA vez. No bloqueante — bot/index.js ya registró mensajes y worker de
// eventos antes de llamar a esto; el escáner nunca debe retrasar eso.
// ==========================================================================
function iniciarEscanerIdentidades(sessionId, sock) {

    if (!sessionId || !sock) {

        console.log("⚠️ [ESCÁNER IDENTIDADES] sessionId o sock inválidos — no se activa.");
        return;

    }

    sesionesActivas.set(sessionId, sock);

    console.log(`🔎 [ESCÁNER IDENTIDADES] activado para sesión ${sessionId} — escaneo inicial de todos los grupos...`);

    escanearTodosLosGrupos(sessionId, sock).catch(err => {

        console.error(`❌ [ESCÁNER IDENTIDADES] escaneo inicial falló para ${sessionId}:`, err?.message);

    });

}

// ==========================================================================
// Desactiva el escáner para una sesión (la sesión dejó de ser la activa del
// bot). No cancela un escaneo ya en curso — solo evita que uno futuro use
// un socket que ya no corresponde a la sesión activa.
// ==========================================================================
function detenerEscanerIdentidades(sessionId) {

    if (!sessionId) return;

    // Se guarda `null` en vez de borrar la clave: así se distingue
    // "explícitamente detenida" (rechaza cualquier señal tardía con el
    // socket viejo) de "nunca registrada" (ver sockSigueVigente).
    sesionesActivas.set(sessionId, null);

    console.log(`⏹️ [ESCÁNER IDENTIDADES] desactivado para sesión ${sessionId}`);

}

// Confirma que `sock` sigue siendo el socket vigente para `sessionId`.
//   - Nunca se registró esta sesión (llamada directa a
//     escanearTodosLosGrupos/escanearGrupo sin pasar por
//     iniciarEscanerIdentidades, p. ej. en pruebas o uso independiente del
//     módulo): se registra ahora mismo y se permite continuar.
//   - Se registró con OTRO socket, o se detuvo explícitamente
//     (detenerEscanerIdentidades guarda `null`): la señal es tardía/obsoleta,
//     se rechaza.
function sockSigueVigente(sessionId, sock) {

    if (!sesionesActivas.has(sessionId)) {

        sesionesActivas.set(sessionId, sock);
        return true;

    }

    return sesionesActivas.get(sessionId) === sock;

}

// ==========================================================================
// Escaneo COMPLETO: todos los grupos de la sesión, vía
// sock.groupFetchAllParticipating() (una sola IQ para todos los grupos —
// ver escanerIdentidades.js). Reservado para el arranque/reinicio del bot.
// ==========================================================================
async function escanearTodosLosGrupos(sessionId, sock) {

    if (!sessionId || !sock) return null;

    if (escaneoCompletoEnCurso.has(sessionId)) {

        console.log(`⏭️ [ESCÁNER IDENTIDADES] ya hay un escaneo completo en curso para ${sessionId} — se omite (evita duplicados).`);
        return null;

    }

    escaneoCompletoEnCurso.add(sessionId);

    try {

        if (!sockSigueVigente(sessionId, sock)) {

            console.log(`⏭️ [ESCÁNER IDENTIDADES] sesión ${sessionId} ya no está activa — se cancela el escaneo completo.`);
            return null;

        }

        const resultado = await escanearIdentidades({ sock });

        console.log(formatearReporteTexto(resultado));

        const resultadoImport = await importarIdentidades({ identidades: resultado.identidades });

        console.log(`✅ [ESCÁNER IDENTIDADES] escaneo inicial completo: ${resultadoImport.importados}/${resultadoImport.total} identidades procesadas.`);

        return { resultado, resultadoImport };

    } catch (err) {

        console.error(`❌ [ESCÁNER IDENTIDADES] error en escaneo completo (${sessionId}):`, err?.message);
        return null;

    } finally {

        escaneoCompletoEnCurso.delete(sessionId);

    }

}

// ==========================================================================
// Escaneo INCREMENTAL de UN grupo (el que el bot acaba de abrir). Usa la
// MISMA cola central de IQ (services/baileys/groupQueue.js) que ya usa el
// resto del bot para groupMetadata() — respeta el mismo espaciado/backoff
// ante rate-overlimit, no una IQ "suelta". NUNCA reconstruye toda la tabla:
// solo descubre/completa identidades de ESE grupo, vía el mismo
// obtenerUsuarioGlobal (importarIdentidades) que ya usa el resto del
// sistema — nunca sobrescribe, nunca duplica.
// ==========================================================================
async function escanearGrupo(sessionId, sock, groupJid) {

    if (!sessionId || !sock || !groupJid) return null;

    if (escaneosDeGrupoEnCurso.has(groupJid)) {

        console.log(`⏭️ [ESCÁNER IDENTIDADES] ya hay un escaneo en curso para el grupo ${groupJid} — se omite (evita duplicados).`);
        return null;

    }

    escaneosDeGrupoEnCurso.add(groupJid);

    try {

        if (!sockSigueVigente(sessionId, sock)) {

            console.log(`⏭️ [ESCÁNER IDENTIDADES] sesión ${sessionId} ya no está activa — se cancela el escaneo de ${groupJid}.`);
            return null;

        }

        const metadata = await groupMetadata(sock, groupJid);

        const resultado = await escanearIdentidades({ sock, grupos: [metadata] });

        const resultadoImport = await importarIdentidades({ identidades: resultado.identidades });

        console.log(
            `🔎 [ESCÁNER IDENTIDADES] grupo ${groupJid}: ` +
            `${resultado.estadisticas.participantesAnalizados} participantes, ` +
            `${resultadoImport.importados}/${resultadoImport.total} identidades procesadas.`
        );

        return { resultado, resultadoImport };

    } catch (err) {

        console.error(`❌ [ESCÁNER IDENTIDADES] error escaneando grupo ${groupJid}:`, err?.message);
        return null;

    } finally {

        escaneosDeGrupoEnCurso.delete(groupJid);

    }

}

module.exports = {

    iniciarEscanerIdentidades,
    detenerEscanerIdentidades,
    escanearTodosLosGrupos,
    escanearGrupo

};
