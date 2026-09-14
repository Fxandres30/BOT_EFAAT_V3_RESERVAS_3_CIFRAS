// ==========================================================================
// CICLO DE VIDA DEL ESCÁNER DE IDENTIDADES (IdentitySync)
// ==========================================================================
// Disparadores:
//
//   1. Al iniciar/reiniciar el BOT (sesión activa disponible) -> escaneo
//      COMPLETO de todos los grupos, una sola vez.
//   2. Cada vez que el BOT abre un grupo con éxito (abrirGrupo() confirmado
//      por WhatsApp) -> escaneo INCREMENTAL de ESE grupo únicamente.
//   3. Cada vez que entra/sale un participante de un grupo
//      (group-participants.update, ver bot/events/groups.js) -> escaneo
//      INCREMENTAL de ESE grupo únicamente (FASE 2).
//   4. Escaneo PERIÓDICO completo, de respaldo — ver iniciarEscaneoPeriodico
//      más abajo (FASE 2). Cubre a quien nunca escribe y cuyo grupo nunca
//      se vuelve a abrir/tocar (nadie más lo detectaría).
//
// Se conecta a los eventos YA existentes del ciclo de vida del bot
// (manager "activeChanged"/"activeLost" vía bot/index.js), de apertura de
// grupo (detectarEvento.js / workerEventos.js) y de cambios de
// participantes (bot/events/groups.js) — no crea un sistema paralelo. El
// ÚNICO timer propio de este módulo es el periódico de la FASE 2 (uno por
// sesión, nunca uno por grupo ni uno por mensaje).
//
// Todo lo que dispara este módulo es "fire and forget" (no bloqueante):
// nunca debe retrasar ni afectar el registro de mensajes, el worker de
// eventos, ni la decisión de abrir/cerrar un grupo. Es un observador que
// mantiene "usuarios" al día — no forma parte del flujo de negocio.
// ==========================================================================

const {
    escanearIdentidades,
    importarIdentidades,
    formatearReporteTexto,
    formatearReporteIdentitySync
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
// y, en el mismo tick, la reconciliación de workerEventos, o alguien entró
// al grupo justo cuando se estaba abriendo), la segunda se omite en vez de
// arrancar un escaneo duplicado.
const escaneosDeGrupoEnCurso = new Set();

// ==========================================================================
// ESTADO DEL SYNC (sección 12) — "idle" | "scanning" | "syncing" | "error",
// por sesión. "scanning" = leyendo Baileys (extracción), "syncing" =
// escribiendo en Supabase (importación/resolución). No es un mecanismo de
// bloqueo nuevo — los Sets de arriba ya son la protección real contra
// ejecuciones simultáneas; esto es solo observabilidad (para exponer, por
// ejemplo, en el panel, si el sync está trabajando o se quedó en error).
// ==========================================================================
const estadoPorSesion = new Map();

function fijarEstado(sessionId, estado) {
    if (sessionId) estadoPorSesion.set(sessionId, estado);
}

function obtenerEstadoIdentitySync(sessionId) {
    return estadoPorSesion.get(sessionId) || "idle";
}

// ==========================================================================
// ESCANEO PERIÓDICO (sección 8) — un único setInterval por sesión, nunca
// uno por grupo ni uno por mensaje. Es un respaldo detrás de los
// disparadores en vivo (startup / apertura de grupo / nuevo participante):
// cubre al participante que nunca escribió y cuyo grupo nadie volvió a
// abrir en ese lapso. Reutiliza escanearTodosLosGrupos() — el mismo Set
// escaneoCompletoEnCurso ya evita que un tick choque con un escaneo manual
// o el inicial en curso (sección 12: "scan global no debe arrancar dos
// veces"), así que este timer no necesita su propia guarda adicional.
// ==========================================================================
const PERIODO_ESCANEO_MS = 6 * 60 * 60 * 1000; // 6 horas — mismo período que ya usaba BOT_Escaner_1.0
const timersPeriodicos = new Map(); // sessionId -> intervalId

function iniciarEscaneoPeriodico(sessionId, sock, periodoMs = PERIODO_ESCANEO_MS) {

    detenerEscaneoPeriodico(sessionId); // por si ya había uno (defensivo, nunca debe haberlo)

    const intervalId = setInterval(() => {

        escanearTodosLosGrupos(sessionId, sock).catch(err => {

            console.error(`❌ [ESCÁNER IDENTIDADES] escaneo periódico falló para ${sessionId}:`, err?.message);

        });

    }, periodoMs);

    // No debe mantener vivo el proceso solo por este timer.
    if (typeof intervalId.unref === "function") intervalId.unref();

    timersPeriodicos.set(sessionId, intervalId);

}

function detenerEscaneoPeriodico(sessionId) {

    const intervalId = timersPeriodicos.get(sessionId);

    if (intervalId) {

        clearInterval(intervalId);
        timersPeriodicos.delete(sessionId);

    }

}

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

    iniciarEscaneoPeriodico(sessionId, sock);

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

    detenerEscaneoPeriodico(sessionId);
    estadoPorSesion.delete(sessionId);

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
    fijarEstado(sessionId, "scanning");

    try {

        if (!sockSigueVigente(sessionId, sock)) {

            console.log(`⏭️ [ESCÁNER IDENTIDADES] sesión ${sessionId} ya no está activa — se cancela el escaneo completo.`);
            fijarEstado(sessionId, "idle");
            return null;

        }

        const resultado = await escanearIdentidades({ sock });

        console.log(formatearReporteTexto(resultado));

        fijarEstado(sessionId, "syncing");

        const resultadoImport = await importarIdentidades({ identidades: resultado.identidades });

        console.log(formatearReporteIdentitySync({

            alcance: `Alcance: TODOS los grupos (sesión ${sessionId})`,
            participantes: resultado.estadisticas.participantesAnalizados,
            encontrados: resultado.estadisticas.identidadesUnicasReconstruibles,
            nuevos: resultadoImport.nuevos,
            enriquecidos: resultadoImport.enriquecidos,
            conflictos: resultadoImport.conflictos,
            errores: resultadoImport.errores

        }));

        fijarEstado(sessionId, "idle");

        return { resultado, resultadoImport };

    } catch (err) {

        console.error(`❌ [ESCÁNER IDENTIDADES] error en escaneo completo (${sessionId}):`, err?.message);
        fijarEstado(sessionId, "error");
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
    fijarEstado(sessionId, "scanning");

    try {

        if (!sockSigueVigente(sessionId, sock)) {

            console.log(`⏭️ [ESCÁNER IDENTIDADES] sesión ${sessionId} ya no está activa — se cancela el escaneo de ${groupJid}.`);
            fijarEstado(sessionId, "idle");
            return null;

        }

        const metadata = await groupMetadata(sock, groupJid);

        const resultado = await escanearIdentidades({ sock, grupos: [metadata] });

        fijarEstado(sessionId, "syncing");

        const resultadoImport = await importarIdentidades({ identidades: resultado.identidades });

        console.log(formatearReporteIdentitySync({

            alcance: `Grupo: ${groupJid}`,
            participantes: resultado.estadisticas.participantesAnalizados,
            encontrados: resultado.estadisticas.identidadesUnicasReconstruibles,
            nuevos: resultadoImport.nuevos,
            enriquecidos: resultadoImport.enriquecidos,
            conflictos: resultadoImport.conflictos,
            errores: resultadoImport.errores

        }));

        fijarEstado(sessionId, "idle");

        return { resultado, resultadoImport };

    } catch (err) {

        console.error(`❌ [ESCÁNER IDENTIDADES] error escaneando grupo ${groupJid}:`, err?.message);
        fijarEstado(sessionId, "error");
        return null;

    } finally {

        escaneosDeGrupoEnCurso.delete(groupJid);

    }

}

module.exports = {

    iniciarEscanerIdentidades,
    detenerEscanerIdentidades,
    escanearTodosLosGrupos,
    escanearGrupo,

    // Sección 12 — estado consultable del sync (idle/scanning/syncing/error).
    obtenerEstadoIdentitySync,

    // Sección 8 — exportado para pruebas e instrumentación (permite pasar
    // un período corto en pruebas sin esperar 6 horas reales).
    iniciarEscaneoPeriodico,
    detenerEscaneoPeriodico

};
