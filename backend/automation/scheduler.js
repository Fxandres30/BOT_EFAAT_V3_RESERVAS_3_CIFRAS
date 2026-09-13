// ==========================================================================
// scheduler.js — Scheduler real del Automation Engine (Fase 4B).
//
// Responsabilidad ÚNICA: para cada event_session YA ABIERTO (creado por
// engine.onEventoDetectado(), nunca por este archivo), decidir si
// corresponde ejecutar REMINDER_MESSAGE / UPDATE_MESSAGE / CLOSE_MESSAGE
// AHORA, y si corresponde, ejecutarlo a través del mismo pipeline que ya
// usa OPEN_MESSAGE desde Fase 4A (engine.enviarMensajeProgramado).
//
// El Scheduler JAMÁS:
//   - crea/detecta eventos, ni decide datos del sorteo (nombre_evento,
//     valor, premios, hora_cierre, reservados, etc.) — todos vienen de
//     eventos_bot real, vía repo/eventosBot.js (SOLO LECTURA).
//   - abre un grupo (abrirGrupo() no se llama nunca desde aquí).
//   - crea event_sessions (eventSessionsRepo.crear() no se llama nunca
//     desde aquí).
//   - decide POR SU CUENTA que un evento cerró: reacciona a que el sistema
//     de cierre EXISTENTE (cerrarEvento.js) ya puso eventos_bot.activo en
//     false — nunca compara horas para decidir el cierre real.
//
// Mismo patrón de setInterval-por-sesión + guarda anti-solapamiento que ya
// usa bot/funciones/eventos/lifecycle/iniciarWorkerEventos.js — replicado
// aquí (sin modificar ese archivo, que pertenece a un dominio distinto:
// reconciliación de eventos_bot, no mensajería de Automation) porque
// mezclar ambas responsabilidades en el mismo worker violaría "única
// responsabilidad". No se auto-arranca en producción en esta fase — algo
// externo a este archivo decide cuándo llamar start()/stop() (todavía
// nada lo hace: ver docs/EFAAT_AUTOMATION_PHASE_4B_IMPLEMENTATION.md).
// ==========================================================================

const eventSessionsRepo = require("./repo/eventSessions");
const eventosBotRepo = require("./repo/eventosBot");
const automationConfigRepo = require("./repo/automationConfig");
const reservasActividadRepo = require("./repo/reservasActividad");
const eventRules = require("./eventRules");
const engine = require("./engine");

// INITIAL_TABLE (Fase "Compartir real"): reutiliza la ÚNICA función real
// de compartir tabla (imagen real + texto real) — la misma que usa el
// botón "Compartir" del panel (backend/routes/tablas.js). Nunca un
// generador de tabla de texto aparte — ver services/compartirTabla.js.
const { compartirTabla } = require("../services/compartirTabla");

// Inicio del día (Master Spec §15) — reutiliza el catálogo/resolver
// GLOBAL de variables (backend/shared/variables, el mismo que usan
// plantillas_mensaje/consultas) y el mismo repo de plantillas del panel
// (plantillas_mensaje, vía automation/repo/plantillasMensaje.js — misma
// tabla que EditorMensaje.tsx ya edita, ninguna tabla/motor nuevo).
const plantillasMensajeRepo = require("./repo/plantillasMensaje");
const { construirContextoGlobal } = require("../shared/variables/contextoVariables");
const { resolverTexto } = require("../shared/variables/resolverVariables");
const { sendMessage } = require("../services/baileys/send");
const executionGuard = require("./executionGuard");

const INTERVALO_MS_DEFECTO = 30000;

const intervalos = new Map(); // sessionId -> intervalId
const ejecutando = new Set(); // sessionId cuyo tick sigue en curso ahora mismo

// start(sock, { intervaloMs? })
//
// Igual que iniciarWorkerEventos(sock): si ya había un intervalo activo
// para esta sesión, se reemplaza (nunca quedan dos corriendo a la vez para
// el mismo sessionId). Devuelve true si quedó activo, false si sock no
// trae un sessionId válido.
function start(sock, { intervaloMs = INTERVALO_MS_DEFECTO } = {}) {

    const sessionId = sock?.context?.sessionId;

    if (!sessionId) {

        console.log("❌ [SCHEDULER] no existe sessionId para iniciar el Scheduler.");
        return false;

    }

    if (intervalos.has(sessionId)) {
        clearInterval(intervalos.get(sessionId));
    }

    console.log(`🕒 [SCHEDULER] iniciado para ${sessionId} (cada ${intervaloMs}ms)`);

    const intervalo = setInterval(async () => {

        if (ejecutando.has(sessionId)) {

            console.log(`⏭️ [SCHEDULER] tick (${sessionId}) omitido: el anterior aún está en curso.`);
            return;

        }

        ejecutando.add(sessionId);

        try {

            await tick(sock);

        } catch (error) {

            console.error(`❌ [SCHEDULER] error en tick (${sessionId}):`, error?.message);

        } finally {

            ejecutando.delete(sessionId);

        }

    }, intervaloMs);

    intervalos.set(sessionId, intervalo);

    return true;

}

function stop(sessionId) {

    if (!intervalos.has(sessionId)) return false;

    clearInterval(intervalos.get(sessionId));
    intervalos.delete(sessionId);
    ejecutando.delete(sessionId);

    console.log(`🛑 [SCHEDULER] detenido: ${sessionId}`);

    return true;

}

// tick(sock) — un barrido completo, expuesto por separado de start() para
// que las pruebas puedan invocarlo de forma síncrona/controlada sin
// depender de un setInterval real.
async function tick(sock, opciones = {}) {

    const sessionId = sock?.context?.sessionId;

    if (!sessionId) return;

    const abiertas = await eventSessionsRepo.obtenerAbiertasPorSesion(sessionId);

    for (const eventSession of abiertas) {

        try {

            await procesarEventSession(eventSession, sock, opciones);

        } catch (error) {

            // Un fallo procesando UN event_session nunca debe impedir que
            // el resto del barrido continúe.
            console.error(`❌ [SCHEDULER] error procesando event_session ${eventSession.id}:`, error?.message);

        }

    }

    // Inicio del día (Master Spec §15) — independiente por completo del
    // ciclo de Event Session (no depende de "abiertas" de arriba, nunca
    // lee eventos_bot): evalúa TODOS los grupos configurados del usuario
    // dueño de esta sesión de WhatsApp, cada tick.
    try {

        await evaluarInicioDiaGlobal(sock, opciones);

    } catch (error) {

        console.error(`❌ [SCHEDULER] error evaluando Inicio del día (${sessionId}):`, error?.message);

    }

}

// ==========================================================================
// INICIO DEL DÍA (Master Spec §15)
// ==========================================================================
//
// NO crea, NO toca, NO lee eventos_bot — por eso las variables globales
// que dependen del evento del día (evento/loteria/premio) solo resolverán
// con dato real si, por la razón que sea, ya existe un evento en el
// contexto en ese momento; lo normal es que Inicio del día se envíe ANTES
// de que el sorteo del día se detecte, así que esas variables quedarán en
// "" (nunca inventadas) en el caso típico — ver informe.
async function evaluarInicioDiaGlobal(sock, opciones = {}) {

    const usuarioId = sock?.context?.usuarioId;

    if (!usuarioId) return;

    const ahora = opciones.ahora || new Date();

    const configuraciones = await automationConfigRepo.listarConfiguraciones(usuarioId);

    for (const configuracion of configuraciones) {

        try {

            await evaluarInicioDiaPorGrupo({ configuracion, usuarioId, ahora, sock });

        } catch (error) {

            console.error(`❌ [SCHEDULER] error en Inicio del día para grupo ${configuracion?.grupo_id}:`, error?.message);

        }

    }

}

async function evaluarInicioDiaPorGrupo({ configuracion, usuarioId, ahora, sock }) {

    const grupoAutorizado = await automationConfigRepo.estaGrupoAutorizado(usuarioId, configuracion.grupo_id);

    const decision = eventRules.evaluarInicioDia({ configuracion, grupoAutorizado, ahora });

    if (!decision.permitido) {
        return; // sin log por tick — mismo criterio silencioso que el resto de evaluar*
    }

    // Las plantillas se leen ANTES de tocar ExecutionGuard: si hoy no hay
    // ninguna activa todavía, no se consume la idempotencia del día — así,
    // si el admin activa una plantilla más tarde ese mismo día, el
    // siguiente tick todavía puede enviarla (mismo criterio que
    // engine.js::enviarMensajeProgramado con "sin mensajes disponibles").
    const plantillas = await plantillasMensajeRepo.obtenerPlantillasHabilitadas(usuarioId, "inicio_dia");

    if (plantillas.length === 0) {

        console.log(`🤖 [AUTOMATION] Inicio del día: sin plantillas habilitadas para el grupo ${configuracion.grupo_id} — no se envía nada.`);
        return;

    }

    // Selección aleatoria entre las activas — una sola, nunca varias
    // (mismo criterio simple ya usado por automation/messageSelector.js:
    // Math.random() sobre el arreglo ya filtrado, sin un motor de modos
    // aparte, porque esta categoría solo pidió "aleatorio").
    const plantilla = plantillas[Math.floor(Math.random() * plantillas.length)];

    const fecha = eventRules.obtenerFechaISO(ahora);
    const claveIdempotencia = `${configuracion.grupo_id}:DAILY_START_MESSAGE:${fecha}`;

    const resultado = await executionGuard.ejecutarUnaVez({

        claveIdempotencia,
        eventSessionId: null, // Inicio del día no pertenece a ningún Event Session (Master Spec §8)
        grupoId: configuracion.grupo_id,
        usuarioId,
        tipoAccion: "DAILY_START_MESSAGE",

        ejecutar: async () => {

            // Sin evento (Inicio del día nunca lee eventos_bot) — las
            // variables {{evento}}/{{loteria}}/{{premio}} de la plantilla
            // resuelven a "" si no hay uno en contexto, nunca inventado.
            const contextoGlobal = construirContextoGlobal({});
            const texto = resolverTexto(plantilla.contenido, contextoGlobal);

            await sendMessage({ sock, jid: configuracion.grupo_id, text: texto });

            return { plantillaId: plantilla.id };

        }

    });

    if (resultado.ejecutada) {

        console.log(`🤖 [AUTOMATION] Inicio del día publicado para el grupo ${configuracion.grupo_id} (plantilla ${plantilla.id})`);

    } else {

        console.log(`🤖 [AUTOMATION] Inicio del día no enviado (${resultado.motivo}) para el grupo ${configuracion.grupo_id}`);

    }

}

async function procesarEventSession(eventSession, sock, opciones = {}) {

    if (!eventSession || eventSession.estado !== "abierto") return;

    // Fuente EN VIVO del sorteo real — nunca el snapshot para datos que
    // cambian (reservados/libres/activo). El snapshot (datos_evento_
    // snapshot) sigue existiendo solo para lo que es inmutable del ciclo.
    const evento = await eventosBotRepo.obtenerPorId(eventSession.evento_id);

    if (!evento) {

        // eventos_bot ya no existe/es inaccesible para este ciclo — no hay
        // datos reales sobre los que decidir nada, así que no se inventa
        // ningún envío.
        return;

    }

    // 1. ¿El sistema de cierre EXISTENTE ya cerró de verdad este sorteo?
    if (evento.activo === false) {

        await ejecutarCierre(evento, eventSession, sock);
        return; // un evento ya cerrado no evalúa recordatorios/updates

    }

    // 2. Publicación inicial de la tabla real (Fase 5) — independiente de
    //    OPEN_MESSAGE, ver automation/tablaInicial.js.
    await evaluarPublicacionInicialTabla(evento, eventSession, sock, opciones);

    // 3. Recordatorios (antes del cierre real).
    await evaluarRecordatorios(evento, eventSession, sock, opciones);

    // 4. Actualizaciones por movimiento de reservas.
    await evaluarActualizacion(evento, eventSession, sock, opciones);

}

// ==========================================================================
// PUBLICACION_INICIAL_TABLA (Fase 5)
// ==========================================================================
//
// automation_configs.publicacion_inicial_tabla: {activo, hora: "HH:mm",
// dias_permitidos: {lunes: boolean, ...}} (migración 009) — día/hora
// PROPIOS de esta acción, nunca la hora del sorteo. Mientras no exista un
// event_session ABIERTO para el grupo (evento real todavía no detectado),
// este tick nunca se ejecuta para ese grupo — es la forma en que "no hay
// evento real todavía -> no se envía nada" queda garantizado sin lógica
// extra (tick() solo itera event_sessions ya abiertos, ver arriba). En
// cuanto el evento real se detecta y el event_session se abre, el
// siguiente tick evalúa la hora normalmente — si ya pasó, publica de
// inmediato (evita perder la publicación por una detección tardía).
async function evaluarPublicacionInicialTabla(evento, eventSession, sock, opciones = {}) {

    const ahora = opciones.ahora || new Date();

    const [config, grupoAutorizado] = await Promise.all([
        automationConfigRepo.obtenerConfiguracion(evento.usuario_id, evento.grupo_id),
        automationConfigRepo.estaGrupoAutorizado(evento.usuario_id, evento.grupo_id)
    ]);

    const decision = eventRules.evaluarPublicacionInicialTabla({ configuracion: config, grupoAutorizado, ahora });

    if (!decision.permitido) {
        return; // sin log por tick — mismo criterio silencioso que evaluarRecordatorios/evaluarActualizacion
    }

    if (!evento.tabla) {

        console.log(`🤖 [AUTOMATION] INITIAL_TABLE omitida para event_session ${eventSession.id}: el evento real todavía no tiene tabla válida.`);
        return;

    }

    const resultado = await compartirTabla({

        evento,
        sock,

        idempotencia: {
            claveIdempotencia: `${eventSession.id}:INITIAL_TABLE`,
            eventSessionId: eventSession.id,
            tipoAccion: "INITIAL_TABLE"
        }

    });

    if (resultado.enviado) {

        console.log(`🤖 [AUTOMATION] INITIAL_TABLE (compartir real) publicada para event_session ${eventSession.id}`);

    } else {

        console.log(`🤖 [AUTOMATION] INITIAL_TABLE no enviada (${resultado.motivo}) para event_session ${eventSession.id}`);

    }

}

// ==========================================================================
// REMINDER_MESSAGE
// ==========================================================================
//
// automation_configs.recordatorios: {"<minutos>": {activo, categoria}, ...}
// — los offsets NO están hardcodeados: cualquier clave numérica de
// minutos-antes-del-cierre que la configuración traiga se evalúa (Master
// Spec / instrucción explícita de Fase 4B: arquitectura configurable, no
// un conjunto fijo de 60/30/10).
async function evaluarRecordatorios(evento, eventSession, sock, opciones = {}) {

    const config = await automationConfigRepo.obtenerConfiguracion(evento.usuario_id, evento.grupo_id);

    if (!config || !config.recordatorios || typeof config.recordatorios !== "object") return;

    const horaCierre = eventSession.datos_evento_snapshot?.hora_cierre || evento.hora_cierre;

    if (!horaCierre) return;

    const ahora = opciones.ahora || new Date();
    const ahoraHHmm = eventRules.obtenerHoraMinuto(ahora);
    const minutosParaCierre = eventRules.minutosEntre(ahoraHHmm, horaCierre);

    // Sin hora válida, o ya pasada la hora de cierre (el sistema de cierre
    // real todavía no lo reflejó en eventos_bot.activo) -> no se envían
    // recordatorios, para no anunciar "faltan X minutos" en negativo.
    if (minutosParaCierre === null || minutosParaCierre < 0) return;

    for (const [offsetTexto, cfg] of Object.entries(config.recordatorios)) {

        if (!cfg || cfg.activo !== true) continue;

        const offset = Number(offsetTexto);

        if (!Number.isFinite(offset) || offset < 0) continue;

        // Todavía no se llegó al punto de disparo de ESTE offset.
        if (minutosParaCierre > offset) continue;

        const tipoAccion = `REMINDER_${offset}M`;

        await engine.enviarMensajeProgramado({

            evento,
            eventSession,
            sock,
            tipo: "REMINDER_MESSAGE",
            categoria: cfg.categoria || null,
            claveIdempotencia: `${eventSession.id}:${tipoAccion}`,
            tipoAccion

        });

    }

}

// ==========================================================================
// UPDATE_MESSAGE
// ==========================================================================
//
// Reutiliza reservas_actividad (log EXISTENTE) para contar reservas nuevas
// desde la última actualización enviada (o desde la apertura, si nunca se
// envió ninguna) — nada de esto inventa un algoritmo de reservas nuevo.
async function evaluarActualizacion(evento, eventSession, sock, opciones = {}) {

    const config = await automationConfigRepo.obtenerConfiguracion(evento.usuario_id, evento.grupo_id);

    if (!config || !config.mensaje_actualizacion || config.mensaje_actualizacion.activo !== true) return;

    const cooldownMinutos = Number.isFinite(config.cooldown_minutos) ? config.cooldown_minutos : 20;
    const umbral = Number.isFinite(config.umbral_reservas) ? config.umbral_reservas : 10;

    const ahora = opciones.ahora || new Date();

    if (eventSession.ultima_actualizacion_en) {

        const minutosDesdeUltima = (ahora - new Date(eventSession.ultima_actualizacion_en)) / 60000;

        if (minutosDesdeUltima < cooldownMinutos) return; // cooldown no cumplido todavía

    }

    const desde = eventSession.ultima_actualizacion_en || eventSession.abierto_en || eventSession.creado_en;

    const nuevasReservas = await reservasActividadRepo.contarNuevasReservas({
        eventoId: evento.id,
        desde
    });

    if (nuevasReservas < umbral) return;

    const numeroActualizacion = (eventSession.actualizaciones_enviadas || 0) + 1;

    const resultado = await engine.enviarMensajeProgramado({

        evento,
        eventSession,
        sock,
        tipo: "UPDATE_MESSAGE",
        categoria: config.mensaje_actualizacion.categoria || null,
        claveIdempotencia: `${eventSession.id}:UPDATE_MESSAGE:${numeroActualizacion}`,
        tipoAccion: "UPDATE_MESSAGE"

    });

    if (resultado.enviado) {

        await eventSessionsRepo.actualizar(eventSession.id, {

            actualizaciones_enviadas: numeroActualizacion,
            ultima_actualizacion_en: ahora.toISOString()

        });

    }

}

// ==========================================================================
// CLOSE_MESSAGE
// ==========================================================================
//
// Se llama SOLO cuando evento.activo === false — es decir, cuando el
// sistema de cierre EXISTENTE (cerrarEvento.js) ya confirmó el cierre real
// en WhatsApp y lo persistió. Este Scheduler nunca reemplaza esa decisión,
// solo reacciona a ella.
async function ejecutarCierre(evento, eventSession, sock) {

    const config = await automationConfigRepo.obtenerConfiguracion(evento.usuario_id, evento.grupo_id);

    if (config && config.mensaje_cierre && config.mensaje_cierre.activo === true) {

        await engine.enviarMensajeProgramado({

            evento,
            eventSession,
            sock,
            tipo: "CLOSE_MESSAGE",
            categoria: config.mensaje_cierre.categoria || null,
            claveIdempotencia: `${eventSession.id}:CLOSE_MESSAGE`,
            tipoAccion: "CLOSE_MESSAGE"

        });

    }

    if (eventSession.estado !== "cerrado") {
        await eventSessionsRepo.marcarCerrado(eventSession.id);
    }

}

module.exports = {
    start,
    stop,
    tick
};
