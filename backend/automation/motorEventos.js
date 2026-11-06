// ==========================================================================
// automation/motorEventos.js — MOTOR CENTRAL de las comunicaciones de un
// evento publicado. UN EVENTO ES UN EVENTO, venga de donde venga.
//
// Antes (auditoría del 04/11) solo el detector de WhatsApp
// (detectarEvento.js) llamaba al Automation Engine: creaba el ciclo
// (event_session), lo abría y enviaba el OPEN_MESSAGE. El publicador del
// panel (sorteos/publicador.js: instantáneos y programados) guardaba el MISMO
// evento con guardarEvento.js y abría el grupo, pero nunca llamaba al motor:
// sin ciclo no había mensaje de apertura, ni tabla inicial, recordatorios,
// actualizaciones ni mensaje de cierre de la automatización del grupo.
//
// Ahora los tres caminos que dejan un evento publicado con su grupo abierto
// pasan por aquí, con las MISMAS reglas (eventRules.evaluarApertura: grupo
// autorizado, automatización activa, día y horario permitidos):
//   - detectarEvento.js      (anuncio leído en WhatsApp)
//   - sorteos/publicador.js  (instantáneo y programado del panel, y sus
//                             reintentos)
//   - workerEventos.js       (el grupo no se pudo abrir al publicar y el
//                             worker lo abrió después)
//
// No es un mecanismo de envío nuevo: reutiliza engine.onEventoDetectado,
// engine.marcarEventSessionAbierta y engine.enviarMensajeApertura (que envía
// por services/baileys/send.js protegido por el ExecutionGuard).
//
// Garantías:
//   - Un ciclo por evento: una edición o corrección del evento (misma fila de
//     eventos_bot, otra identidad de ciclo) conserva su ciclo; nunca abre
//     otro ni repite la apertura.
//   - La apertura se procesa UNA vez por ciclo: solo cuando el ciclo pasa de
//     «pendiente» a «abierto» (grupo realmente abierto). Un ciclo ya abierto,
//     cerrado o expirado nunca la repite. Además el ExecutionGuard (clave
//     `<ciclo>:OPEN_MESSAGE`) impide un segundo envío aunque dos procesos
//     confirmaran a la vez.
//   - Nunca antes de tiempo: solo se llama después de que WhatsApp confirmó la
//     apertura del grupo (y, en el panel, después de enviar el anuncio).
//   - Nunca lanza: un fallo aquí no cambia el resultado de la publicación.
// ==========================================================================

const engine = require("./engine");
const eventSessionsRepo = require("./repo/eventSessions");
const executionGuard = require("./executionGuard");

const CICLO_VIVO = ["pendiente", "abierto", "cerrando"];

// RECUPERACIÓN (04/11). Una apertura solo se anuncia si sale como mucho este
// tiempo después del anuncio real; más tarde, el ciclo se abre igual
// (recordatorios, cierre) pero el OPEN_MESSAGE queda registrado como omitido.
const recuperacion = require("./recuperacion");
const TOLERANCIA_APERTURA_MS = recuperacion.UMBRALES.CICLO_TOLERANCIA_APERTURA_MS;
// Un ciclo se considera interrumpido (no en curso) pasado este margen.
const MARGEN_RECUPERACION_MS = recuperacion.UMBRALES.CICLO_MARGEN_MS;
// Ciclos pendientes más viejos que esto no se reanudan (datos históricos).
const ANTIGUEDAD_MAXIMA_MS = recuperacion.UMBRALES.CICLO_ANTIGUEDAD_MAXIMA_MS;
// (Umbrales comunes desde F4-G: automation/recuperacion.js.)

const claveApertura = (eventSession) => `${eventSession.id}:OPEN_MESSAGE`;
const cierrePasado = (evento, ahora) => require("../bot/funciones/eventos/lifecycle/verificarHoraCierre").verificarHoraCierre(evento, ahora);

// La apertura no se anuncia tarde: se deja constancia (misma clave del
// ExecutionGuard) para que nunca salga después.
async function omitirApertura(evento, eventSession, motivo) {
    return executionGuard.ejecutarUnaVez({
        claveIdempotencia: claveApertura(eventSession),
        eventSessionId: eventSession.id,
        grupoId: evento.grupo_id,
        usuarioId: evento.usuario_id,
        tipoAccion: "OPEN_MESSAGE",
        ejecutar: async () => ({ omitido: true, motivo })
    });
}

// ¿Se puede anunciar la apertura AHORA? `momento` = cuándo ocurrió de verdad
// (anuncio o creación del ciclo). null = sí.
function motivoAperturaTardia(evento, { momento = null, ahora = new Date() } = {}) {
    if (cierrePasado(evento, ahora)) return "cierre_pasado";
    if (momento && ahora.getTime() - new Date(momento).getTime() > TOLERANCIA_APERTURA_MS) return "fuera_de_tolerancia";
    return null;
}

// Envíos en segundo plano (el OPEN_MESSAGE espera 1-7 s de «escribiendo...»):
// nunca retrasan la publicación. esperarEnvios() solo lo usan las pruebas.
const enCurso = new Set();

function enSegundoPlano(promesa) {
    const p = Promise.resolve(promesa).catch(err => {
        console.error("❌ [MOTOR EVENTOS] error en segundo plano:", err?.message);
    }).finally(() => enCurso.delete(p));
    enCurso.add(p);
    return p;
}

async function esperarEnvios() {
    while (enCurso.size) await Promise.all([...enCurso]);
}

// ------------------------------------------------------------ registrar ---

// ¿Este evento ya tiene su ciclo? (una corrección cambia nombre/hora de la
// MISMA fila: su identidad de ciclo cambia, pero el evento es el mismo).
async function cicloVivoDelEvento(eventoId) {
    if (!eventoId) return null;
    return eventSessionsRepo.buscarVivaPorEvento(eventoId);
}

// registrarEvento(evento, { ahora }) — decide con las reglas de siempre si el
// evento tiene ciclo de automatización y lo crea (estado «pendiente»), o
// devuelve el que ya tenía. Se llama al guardar el evento, antes de abrir el
// grupo (detección) o después de publicarlo (panel).
//
// Devuelve { eventSession, nuevo, motivo }. Puede lanzar (como
// engine.onEventoDetectado): el llamador decide (la detección lo registra y
// sigue sin automatización, igual que antes).
async function registrarEvento(evento, { ahora } = {}) {

    if (!evento?.id) return { eventSession: null, nuevo: false, motivo: "evento_nulo" };

    const existente = await cicloVivoDelEvento(evento.id);
    if (existente) return { eventSession: existente, nuevo: false, motivo: "ciclo_del_evento" };

    const decision = await engine.onEventoDetectado(evento, ahora ? { ahora } : {});

    if (decision.eventSession) return { eventSession: decision.eventSession, nuevo: true, motivo: null };

    // El mismo ciclo ya existía (otro proceso lo creó a la vez, o un intento
    // anterior se cortó antes de abrirlo): se reanuda solo si es de ESTE
    // evento y sigue vivo. Uno cerrado o de otra fila no se toca.
    if (decision.motivo === "ciclo_duplicado" && decision.identidadCiclo) {
        const mismo = await eventSessionsRepo.buscarPorIdentidadCiclo(evento.grupo_id, decision.identidadCiclo);
        if (mismo && mismo.evento_id === evento.id && CICLO_VIVO.includes(mismo.estado)) {
            return { eventSession: mismo, nuevo: false, motivo: "ciclo_duplicado" };
        }
    }

    return { eventSession: null, nuevo: false, motivo: decision.motivo };

}

// --------------------------------------------------------- reapertura ---

// abrirCicloDeReapertura({ evento, ahora }) — F3-D. Un sorteo reabierto desde
// el panel necesita un ciclo de automatización VIVO para volver a recibir sus
// recordatorios y para que su siguiente cierre se anuncie (las claves de los
// avisos van por ciclo). Si todavía tiene uno vivo (se reabrió antes de que el
// scheduler cerrara el anterior), se reutiliza. Si no, se crea un ciclo
// lógico NUEVO con las reglas de siempre (engine.onEventoDetectado), con la
// identidad del ciclo y un sufijo de reapertura; el anterior se conserva. El
// nuevo nace con la apertura y la tabla inicial dadas por hechas (el sorteo ya
// se anunció): no se repiten. Lo confirma la reapertura del grupo de WhatsApp
// (worker → reanudarApertura), como cualquier ciclo pendiente.
// -> { eventSession, nuevo, motivo }. Nunca lanza.
async function abrirCicloDeReapertura({ evento, ahora = new Date() }) {

    try {

        if (!evento?.id) return { eventSession: null, nuevo: false, motivo: "evento_nulo" };

        const vivo = await cicloVivoDelEvento(evento.id);
        if (vivo) return { eventSession: vivo, nuevo: false, motivo: "ciclo_vivo" };

        const decision = await engine.onEventoDetectado(evento, { ahora, sufijoCiclo: `:reapertura:${ahora.toISOString()}` });
        if (!decision.eventSession) return { eventSession: null, nuevo: false, motivo: decision.motivo };

        await omitirApertura(evento, decision.eventSession, "reapertura");
        await cubrirTablaInicial(evento, decision.eventSession);

        return { eventSession: decision.eventSession, nuevo: true, motivo: null };

    } catch (err) {

        console.error(`❌ [MOTOR EVENTOS] no se pudo abrir el ciclo de reapertura del evento ${evento?.id}:`, err?.message);
        return { eventSession: null, nuevo: false, motivo: "error", error: err?.message };

    }

}

// ------------------------------------------------------------ confirmar ---

// La tabla ya salió como anuncio (el panel publica imagen + pie): la «tabla
// inicial» del ciclo (Scheduler, INITIAL_TABLE) queda cumplida con la MISMA
// clave del ExecutionGuard, para no enviar la misma tabla dos veces.
async function cubrirTablaInicial(evento, eventSession) {
    return executionGuard.ejecutarUnaVez({
        claveIdempotencia: `${eventSession.id}:INITIAL_TABLE`,
        eventSessionId: eventSession.id,
        grupoId: evento.grupo_id,
        usuarioId: evento.usuario_id,
        tipoAccion: "INITIAL_TABLE",
        ejecutar: async () => ({ cubiertaPor: "anuncio_publicado" })
    });
}

// confirmarApertura({ evento, eventSession, sock, tablaPublicada }) — SOLO
// después de que WhatsApp confirmó la apertura del grupo. Abre el ciclo (el
// Scheduler empieza a procesarlo) y envía el OPEN_MESSAGE en segundo plano.
// Nunca lanza.
// `momento` (solo recuperación): cuándo ocurrió de verdad la publicación; con
// él, una apertura fuera de tolerancia o tras el cierre no se anuncia.
async function confirmarApertura({ evento, eventSession, sock, tablaPublicada = false, momento = null, ahora = null }) {

    try {

        if (!evento || !eventSession) return { abierta: false, motivo: "sin_event_session" };

        // Abierto = su apertura ya se procesó; cerrado/expirado = terminó.
        if (eventSession.estado !== "pendiente") {
            return { abierta: eventSession.estado === "abierto", motivo: eventSession.estado === "abierto" ? "apertura_ya_procesada" : "ciclo_terminado" };
        }

        // ANTES de abrir el ciclo: el Scheduler solo procesa ciclos abiertos,
        // así que nunca llega a ver este ciclo sin la tabla inicial cumplida.
        // Si no se puede registrar, el ciclo no se abre (se reintenta: un
        // reintento o la recuperación lo completan) — nunca dos tablas.
        if (tablaPublicada) {
            try {
                const r = await cubrirTablaInicial(evento, eventSession);
                if (!r.ejecutada && (r.motivo === "error_insert" || r.motivo === "conflicto_desconocido")) return { abierta: false, motivo: "tabla_inicial_no_registrada" };
            } catch (err) {
                console.error(`❌ [MOTOR EVENTOS] no se pudo registrar la tabla inicial del ciclo ${eventSession.id}:`, err?.message);
                return { abierta: false, motivo: "tabla_inicial_no_registrada" };
            }
        }

        const marcado = await engine.marcarEventSessionAbierta(eventSession);
        if (!marcado.actualizado) return { abierta: false, motivo: marcado.motivo };

        const abierta = { ...eventSession, estado: "abierto" };

        // Recuperación: nunca una apertura tarde (tras el cierre o pasada la
        // tolerancia desde el anuncio real). El ciclo queda abierto igual.
        const tarde = momento ? motivoAperturaTardia(evento, { momento, ahora: ahora || new Date() }) : null;
        if (tarde) {
            await omitirApertura(evento, abierta, tarde);
            console.log(`🤖 [MOTOR EVENTOS] ciclo ${eventSession.id} recuperado: apertura no anunciada (${tarde}).`);
            return { abierta: true, motivo: `apertura_omitida_${tarde}` };
        }

        enSegundoPlano(engine.enviarMensajeApertura(evento, abierta, sock));

        return { abierta: true, motivo: null };

    } catch (err) {

        console.error("❌ [MOTOR EVENTOS] error confirmando la apertura:", err?.message);
        return { abierta: false, motivo: "error", error: err?.message };

    }

}

// ------------------------------------------------------------- entradas ---

// Panel (instantáneo y programado): el evento ya se guardó, el grupo se abrió
// y el anuncio se envió. Registra y confirma en un solo paso. Nunca lanza.
// `momento` (recuperación): cuándo se publicó de verdad el anuncio. Las reglas
// de día/horario se evalúan con ESE momento, no con el de la recuperación.
async function procesarEventoPublicado({ evento, sock, ahora, tablaPublicada = false, momento = null }) {

    try {

        const { eventSession, motivo } = await registrarEvento(evento, { ahora: momento ? new Date(momento) : ahora });

        if (!eventSession) {
            console.log(`🤖 [MOTOR EVENTOS] evento ${evento?.id}: sin ciclo de automatización (${motivo}).`);
            return { abierta: false, motivo };
        }

        return await confirmarApertura({ evento, eventSession, sock, tablaPublicada, momento, ahora });

    } catch (err) {

        console.error(`❌ [MOTOR EVENTOS] error procesando el evento publicado ${evento?.id}:`, err?.message);
        return { abierta: false, motivo: "error", error: err?.message };

    }

}

// Worker de eventos: el grupo de un evento que se guardó sin poder abrirlo ya
// está abierto. Reanuda SOLO el ciclo que quedó pendiente (nunca crea uno:
// las reglas de día/horario se evaluaron al publicar). Nunca lanza.
async function reanudarApertura({ evento, sock }) {

    try {

        const eventSession = await cicloVivoDelEvento(evento?.id);
        if (!eventSession || eventSession.estado !== "pendiente") return { abierta: false, motivo: eventSession ? "apertura_ya_procesada" : "sin_event_session" };

        return await confirmarApertura({ evento, eventSession, sock });

    } catch (err) {

        console.error(`❌ [MOTOR EVENTOS] error reanudando la apertura del evento ${evento?.id}:`, err?.message);
        return { abierta: false, motivo: "error", error: err?.message };

    }

}

// --------------------------------------------------------- recuperación ---

// recuperarCiclos({ sock, ahora, abiertas }) — cada tick del Scheduler, para
// la sesión del socket. Completa lo que una caída del proceso dejó a medias,
// sin repetir nada (ExecutionGuard) y sin anunciar tarde:
//   1. Ciclo ABIERTO cuyo OPEN_MESSAGE nunca llegó a registrarse (caída entre
//      abrir el ciclo y el envío en segundo plano): se envía dentro de la
//      tolerancia. Un envío que quedó «en curso» tiene su registro: nunca se
//      repite.
//   2. Ciclo PENDIENTE de un evento activo cuyo grupo WhatsApp confirma
//      ABIERTO (groupMetadata: announce=false) — caída entre crear el ciclo y
//      confirmarlo. Sin esa confirmación real no se toca. Un ciclo de un
//      sorteo del panel solo nace tras enviar su anuncio con la imagen: su
//      tabla inicial queda cumplida.
// Nunca lanza.
async function recuperarCiclos({ sock, ahora = new Date(), abiertas = [] }) {

    const resultado = { aperturas: 0, reanudados: 0 };
    const sessionId = sock?.context?.sessionId;
    if (!sessionId) return resultado;

    const eventosBotRepo = require("./repo/eventosBot");
    const { finDelEvento } = require("../shared/eventos/estadosGestion");

    try {

        for (const ses of abiertas) {
            if (ses.estado !== "abierto" || !ses.abierto_en) continue;
            const edad = ahora.getTime() - new Date(ses.abierto_en).getTime();
            if (edad < MARGEN_RECUPERACION_MS || edad > TOLERANCIA_APERTURA_MS) continue;
            // Regla común de envíos (F4-G): solo se envía lo NO INICIADO; uno
            // confirmado, en curso (incierto) o fallido nunca se repite aquí.
            if (!recuperacion.reenviable(recuperacion.estadoDelEnvio(await executionGuard.obtenerPorClave(claveApertura(ses))))) continue;
            const evento = await eventosBotRepo.obtenerPorId(ses.evento_id);
            if (!evento || evento.activo !== true || cierrePasado(evento, ahora)) continue;
            enSegundoPlano(engine.enviarMensajeApertura(evento, ses, sock));
            resultado.aperturas++;
        }

        const pendientes = await eventSessionsRepo.obtenerPendientesPorSesion(sessionId, {
            desde: new Date(ahora.getTime() - ANTIGUEDAD_MAXIMA_MS),
            hasta: new Date(ahora.getTime() - MARGEN_RECUPERACION_MS)
        });

        for (const ses of pendientes) {
            const evento = await eventosBotRepo.obtenerPorId(ses.evento_id);
            if (!evento || evento.usuario_id !== sock.context.usuarioId) continue;
            if (evento.activo !== true || evento.abierto === false || finDelEvento(evento) || cierrePasado(evento, ahora)) continue;

            // Estado REAL del grupo en WhatsApp: sin confirmación, nada.
            let announce = null;
            try {
                const { groupMetadata } = require("../services/baileys/groupQueue");
                const meta = await groupMetadata(sock, evento.grupo_id);
                announce = typeof meta?.announce === "boolean" ? meta.announce : null;
            } catch { announce = null; }
            if (announce !== false) continue;

            const prioridad = require("./prioridadComunicaciones");
            const sorteo = await prioridad.sorteoDelEvento(evento);
            if (!sorteo.ok) continue;

            // Solo un sorteo PUBLICADO por el panel llevó la imagen en su anuncio.
            // Una programación creada para un sorteo detectado en WhatsApp
            // (config.origen = "whatsapp", sorteos/gruposSorteo.js) no: su
            // anuncio original fue el texto del administrador.
            const delPanel = Boolean(sorteo.sorteo) && sorteo.sorteo.config?.origen !== "whatsapp";

            const r = await confirmarApertura({ evento, eventSession: ses, sock, tablaPublicada: delPanel, momento: ses.creado_en, ahora });
            if (r.abierta) resultado.reanudados++;
        }

    } catch (err) {

        console.error("❌ [MOTOR EVENTOS] error en la recuperación de ciclos:", err?.message);

    }

    return resultado;

}

module.exports = {
    TOLERANCIA_APERTURA_MS,
    MARGEN_RECUPERACION_MS,
    recuperarCiclos,
    motivoAperturaTardia,
    registrarEvento,
    confirmarApertura,
    procesarEventoPublicado,
    reanudarApertura,
    abrirCicloDeReapertura,
    enSegundoPlano,
    esperarEnvios
};
