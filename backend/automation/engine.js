// ==========================================================================
// engine.js — orquestador del Automation Engine.
//
// onEventoDetectado() (Fase 2B/3, conectada desde Fase 3): decide
// autorización y crea el event_session. NUNCA abre/cierra un grupo, NUNCA
// envía nada — eso lo sigue haciendo detectarEvento.js con abrirGrupo()
// existente, y AHORA (Fase 4A) enviarMensajeApertura() más abajo, SOLO
// después de que abrirGrupo() ya confirmó la apertura real.
//
// enviarMensajeApertura() (Fase 4A): selecciona un OPEN_MESSAGE del pool,
// resuelve sus variables con datos reales del evento, y lo envía mediante
// services/baileys/send.js EXISTENTE (sin duplicar), protegido por
// ExecutionGuard EXISTENTE (sin duplicar, sin locking nuevo). NUNCA decide
// datos del sorteo, NUNCA inventa un valor de variable faltante.
//
// enviarMensajeProgramado() (Fase 4B, NUEVA — generaliza lo anterior):
// mismo pipeline exacto (seleccionar → resolver → ExecutionGuard → enviar
// → registrar uso), parametrizado por tipo/categoría/clave, para que
// scheduler.js lo reutilice para REMINDER_MESSAGE/UPDATE_MESSAGE/
// CLOSE_MESSAGE sin duplicar ni el Message Selector, ni el Variable
// Resolver, ni el sistema de envío. enviarMensajeApertura() ahora es un
// envoltorio delgado sobre esta función — mismo comportamiento externo.
// ==========================================================================

const eventRules = require("./eventRules");
const eventSessionsRepo = require("./repo/eventSessions");
const automationConfigRepo = require("./repo/automationConfig");

const messageSelector = require("./messageSelector");
const variableResolver = require("./variableResolver");
const messagesRepo = require("./repo/messages");
const executionGuard = require("./executionGuard");

// Reutilizado tal cual — services/baileys/send.js NO se duplica ni se
// modifica.
const { sendMessage } = require("../services/baileys/send");

// onEventoDetectado(evento, opciones?)
//
// `evento` es exactamente lo que detectarEvento() devuelve hoy (la fila de
// eventos_bot ya guardada) — el llamador de este engine (en una fase
// futura, eventHandler.js) no debe transformarlo antes de pasarlo aquí.
//
// `opciones.ahora` (Date, opcional) permite inyectar la hora en los tests;
// por defecto usa la hora real del proceso.
//
// Devuelve siempre:
//   { creoEventSession: boolean, motivo?: string, eventSession?, identidadCiclo }
async function onEventoDetectado(evento, opciones = {}) {

    if (!evento) {

        return { creoEventSession: false, motivo: "evento_nulo", identidadCiclo: null };

    }

    const identidadCiclo = eventRules.crearIdentidadCiclo(evento);

    const [grupoAutorizado, configuracion, eventSessionExistente] = await Promise.all([

        automationConfigRepo.estaGrupoAutorizado(evento.usuario_id, evento.grupo_id),
        automationConfigRepo.obtenerConfiguracion(evento.usuario_id, evento.grupo_id),
        eventSessionsRepo.buscarPorIdentidadCiclo(evento.grupo_id, identidadCiclo)

    ]);

    const decision = eventRules.evaluarApertura({

        evento,
        configuracion,
        grupoAutorizado,
        eventSessionExistente,
        ahora: opciones.ahora || new Date()

    });

    if (!decision.permitido) {

        return { creoEventSession: false, motivo: decision.motivo, identidadCiclo };

    }

    let eventSession;

    try {

        eventSession = await eventSessionsRepo.crear({

            eventoId: evento.id ?? null,
            identidadCiclo,
            grupoId: evento.grupo_id,
            sessionId: evento.session_id ?? null,
            usuarioId: evento.usuario_id,
            automationConfigId: configuracion?.id ?? null,

            // Snapshot obligatorio (migración 006) — copia de los datos de
            // ESTE ciclo, no una referencia viva a eventos_bot (Master Spec §6).
            datosEventoSnapshot: {

                nombre_evento: evento.nombre_evento,
                hora_fin: evento.hora_fin,
                hora_cierre: evento.hora_cierre,
                fecha_evento: evento.fecha_evento,
                valor: evento.valor,
                premios: evento.premios,
                tabla: evento.tabla,
                cifras: evento.cifras,
                cantidad_numeros: evento.cantidad_numeros,
                grupo_nombre: evento.grupo_nombre

            }

        });

    } catch (err) {

        // Corrección quirúrgica (auditoría Fase 2B, hallazgo E): la
        // comprobación de arriba (eventSessionExistente) tiene una ventana
        // de carrera entre "consultar" y "crear" — si otra ejecución
        // concurrente crea el MISMO ciclo justo en esa ventana, Postgres
        // rechaza este INSERT con 23505 (protección primaria, real, sin
        // cambios). Se traduce al MISMO contrato que ya devuelve
        // evaluarApertura() para un duplicado detectado por el chequeo
        // previo — el llamador no necesita distinguir uno del otro.
        if (err && err.esCicloDuplicado) {

            return { creoEventSession: false, motivo: "ciclo_duplicado", identidadCiclo };

        }

        throw err;

    }

    // Deliberadamente NO se ejecuta ninguna acción de WhatsApp aquí — eso
    // es responsabilidad de detectarEvento.js, DESPUÉS de que abrirGrupo()
    // confirme la apertura real (ver enviarMensajeApertura más abajo).

    return { creoEventSession: true, eventSession, identidadCiclo };

}

// ==========================================================================
// enviarMensajeProgramado({ evento, eventSession, sock, tipo, categoria,
//                            claveIdempotencia, tipoAccion, variablesExtra })
// ==========================================================================
//
// Pipeline ÚNICO de envío (Fase 4B — generaliza lo que Fase 4A escribió
// solo para OPEN_MESSAGE, para que REMINDER_MESSAGE/UPDATE_MESSAGE/
// CLOSE_MESSAGE del Scheduler reutilicen exactamente el mismo camino en
// vez de reimplementarlo tres veces más): seleccionar → resolver variables
// → ExecutionGuard.ejecutarUnaVez → sendMessage (services/baileys/send.js
// EXISTENTE) → registrarUso. Nada de esto es nuevo respecto a Fase 4A,
// solo dejó de estar atado a OPEN_MESSAGE.
//
// `variablesExtra` permite que el llamador aporte datos que
// construirVariablesDesdeEvento() no puede derivar solo de `evento`
// (p. ej. datos EN VIVO ya leídos aparte) — se combinan, sin pisar los
// campos reales del evento.
//
// Nunca lanza. Devuelve siempre:
//   { enviado: boolean, motivo?: string, mensajeId? }
async function enviarMensajeProgramado({
    evento,
    eventSession,
    sock,
    tipo,
    categoria = null,
    claveIdempotencia,
    tipoAccion,
    variablesExtra = {}
}) {

    try {

        if (!evento || !eventSession) {
            return { enviado: false, motivo: "sin_event_session" };
        }

        const mensaje = await messageSelector.seleccionarMensaje({

            usuarioId: evento.usuario_id,
            grupoId: evento.grupo_id,
            tipo,
            categoria

        });

        if (!mensaje) {

            console.log(`🤖 [AUTOMATION] sin mensajes ${tipo} activos disponibles — no se envía nada.`);
            return { enviado: false, motivo: "sin_mensajes_disponibles" };

        }

        const variables = { ...construirVariablesDesdeEvento(evento), ...variablesExtra };

        const resuelto = variableResolver.resolverVariables(mensaje.texto, variables);

        if (!resuelto.completo) {

            // "no enviar un mensaje corrupto": si el texto plantilla usa
            // una variable que el evento real no tiene, NO se envía —
            // nunca se inventa el valor faltante.
            console.error(`⚠️ [AUTOMATION] ${tipo} ${mensaje.id} tiene variables sin resolver (${resuelto.faltantes.join(", ")}) — no se envía.`);
            return { enviado: false, motivo: "variable_faltante", faltantes: resuelto.faltantes };

        }

        const resultado = await executionGuard.ejecutarUnaVez({

            claveIdempotencia,
            eventSessionId: eventSession.id,
            grupoId: evento.grupo_id,
            usuarioId: evento.usuario_id,
            tipoAccion,

            ejecutar: async () => {

                // Envío real — services/baileys/send.js EXISTENTE, sin
                // duplicar ni reimplementar.
                await sendMessage({ sock, jid: evento.grupo_id, text: resuelto.texto });

                // Registro de uso (anti-repetición + auditoría) — SOLO
                // después de un envío realmente exitoso, dentro del mismo
                // callback que protege ExecutionGuard: si esto fallara, la
                // acción completa queda en 'error' (no en 'ok'), igual que
                // cualquier otra acción protegida.
                await messagesRepo.registrarUso({

                    mensajeId: mensaje.id,
                    eventSessionId: eventSession.id,
                    usuarioId: evento.usuario_id,
                    grupoId: evento.grupo_id,
                    tipo,
                    categoria: mensaje.categoria ?? null

                });

                // Punto de extensión preparado para stickers (NO
                // implementado en esta fase, pedido explícitamente así):
                // si en el futuro automation_configs.stickers trae un
                // sticker activo para este `tipo`, este es el lugar donde
                // se enviaría, dentro del mismo callback protegido por
                // ExecutionGuard, después del mensaje de texto.

                return { mensajeId: mensaje.id };

            }

        });

        if (resultado.ejecutada) {

            console.log(`🤖 [AUTOMATION] ${tipo} enviado:`, mensaje.id);
            return { enviado: true, mensajeId: mensaje.id };

        }

        console.log(`🤖 [AUTOMATION] ${tipo} no enviado (${resultado.motivo}) — ya estaba resuelto para este event_session.`);
        return { enviado: false, motivo: resultado.motivo };

    } catch (err) {

        // Nunca se deja escapar una excepción — un fallo de mensajería
        // nunca debe ensuciar el flujo que lo llamó (detección/apertura ya
        // exitosa, o el tick del Scheduler).
        console.error(`❌ [AUTOMATION] error enviando ${tipo}:`, err?.message);
        return { enviado: false, motivo: "error_envio", error: err?.message };

    }

}

// ==========================================================================
// enviarMensajeApertura(evento, eventSession, sock)
// ==========================================================================
//
// Se llama SOLO después de que detectarEvento.js confirmó que abrirGrupo()
// (existente, sin cambios) tuvo éxito — nunca antes. `evento` es el mismo
// eventoGuardado de siempre (datos del sorteo, sin recalcular nada aquí).
// `eventSession` es el que onEventoDetectado() ya creó para este mismo
// ciclo. `sock` es el socket real de Baileys que detectó el mensaje —
// reutilizado tal cual para el envío, no se crea ni se busca otro.
//
// Envoltorio delgado sobre enviarMensajeProgramado() (Fase 4B) — mismo
// contrato/comportamiento externo que tenía en Fase 4A, sin cambios.
async function enviarMensajeApertura(evento, eventSession, sock) {

    return enviarMensajeProgramado({

        evento,
        eventSession,
        sock,
        tipo: "OPEN_MESSAGE",
        categoria: null,
        claveIdempotencia: `${eventSession?.id}:OPEN_MESSAGE`,
        tipoAccion: "OPEN_MESSAGE"

    });

}

// Variables reales disponibles a partir del evento ya detectado/guardado
// (eventos_bot) — nunca inventadas. "premio" toma el primer premio de la
// lista (decisión simple y documentada: el evento puede tener varios
// premios con distintos nombres/tipos, y el texto de la plantilla decide
// cómo presentarlo — esta fase no intenta resumir/formatear una lista
// completa). "disponibles" mapea a evento.libres (mismo campo que ya
// calcula guardarEvento.js).
function construirVariablesDesdeEvento(evento) {

    const variables = {};

    if (evento.nombre_evento != null) variables.nombre_evento = evento.nombre_evento;
    if (evento.valor != null) variables.valor = evento.valor;
    if (evento.hora_cierre != null) variables.hora_cierre = evento.hora_cierre;
    if (evento.reservados != null) variables.reservados = evento.reservados;
    if (evento.libres != null) variables.disponibles = evento.libres;

    if (Array.isArray(evento.premios) && evento.premios.length > 0 && evento.premios[0]?.premio != null) {
        variables.premio = evento.premios[0].premio;
    }

    return variables;

}

module.exports = {
    onEventoDetectado,
    enviarMensajeApertura,
    enviarMensajeProgramado,
    construirVariablesDesdeEvento
};
