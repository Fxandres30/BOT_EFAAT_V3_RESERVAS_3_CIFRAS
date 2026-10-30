const supabase = require("../../../lib/supabase");
const { extraerEvento } = require("./extraerEvento");
const { consultarEvento, consultarEventoDelSorteo } = require("./consultarEvento");
const { guardarEvento } = require("./guardarEvento");
const { obtenerConfiguracionCliente } = require("./tablasCliente");
const { abrirGrupo } = require("./grupos/abrirGrupo");
const { esMismoSorteo, fechaSorteoAnunciado, buscarSorteoVigente, crearIdentidadEventoReal } = require("./identidadEventoReal");
const { finDelEvento } = require("../../../shared/eventos/estadosGestion");
const { consultarDisponibilidad } = require("../consultas/consultarDisponibilidad");

// Sorteos creados y programados desde el panel (backend/sorteos). Solo se
// consulta para NO reemplazar un sorteo programado que sigue activo.
const { esEventoDeSorteoProgramado } = require("../../../sorteos/repo");

// Fase 3 — único punto de conexión real con el Automation Engine (Fase 2B/
// 2C, hasta ahora sin conectar). NO decide datos del sorteo — eso lo sigue
// haciendo exclusivamente extraerEvento()/guardarEvento(), sin cambios.
// Solo decide si, además de existir el evento, corresponde automatizar la
// apertura ahora mismo. Ver docs/EFAAT_AUTOMATION_PHASE_3_IMPLEMENTATION.md.
const automationEngine = require("../../../automation/engine");

// Escaneo incremental de identidades: se dispara SOLO después de que
// WhatsApp confirmó la apertura del grupo (ver más abajo). No bloqueante,
// no forma parte de la decisión de abrir/cerrar el grupo.
const { escanearGrupo } = require("../usuarios/escanerIdentidadesLifecycle");

// Reintento breve y acotado (3 intentos, 300 ms aparte) SOLO para registrar
// que la apertura falló (abierto=false). Riesgo que cierra: si WhatsApp
// falla Y esta escritura también fallara al primer intento, el evento
// quedaría con abierto=true "mintiendo" y la reconciliación del worker
// (que filtra por abierto===false) nunca lo encontraría. Con 3 intentos
// cortos, ambos fallando a la vez es prácticamente descartable. No es una
// tabla ni un estado nuevo: reintenta la MISMA escritura de siempre.
async function marcarAperturaFallida(eventoId) {

    const intentos = 3;

    for (let i = 1; i <= intentos; i++) {

        const { error } = await supabase
            .from("eventos_bot")
            .update({ abierto: false })
            .eq("id", eventoId);

        if (!error) return true;

        console.error(`❌ No se pudo registrar abierto=false (intento ${i}/${intentos}):`, error.message);

        if (i < intentos) {
            await new Promise(r => setTimeout(r, 300));
        }

    }

    return false;

}

// ¿El evento existente ya terminó? "cerrado" = cerrarEvento() ya lo marcó
// (activo=false / estado "cerrado"); "lleno" = la MISMA consulta de
// disponibilidad que usa el bot para responder a los clientes
// (consultarDisponibilidad, aislada por sorteo real) no encuentra ningún
// número libre. Ante un error o una tabla sin filas no se puede afirmar que
// esté lleno -> null (se mantiene el comportamiento de siempre).
// verificarEventoLleno() no se usa: cuenta por evento_id y no ve las
// reservas hechas en los otros grupos del mismo sorteo real.
async function estadoTerminado(evento) {

    if (evento.activo === false || evento.estado === "cerrado") {
        return "cerrado";
    }

    try {

        const { numerosDisponibles, numerosOcupados } = await consultarDisponibilidad({ evento });

        if (numerosDisponibles.length === 0 && numerosOcupados.length > 0) {
            return "lleno";
        }

    } catch (err) {

        console.error("⚠️ No se pudo verificar si el sorteo está lleno (se sigue el flujo normal):", err?.message);

    }

    return null;

}

// ¿El sorteo de esta fila ya tiene números reservados o pagados (o en
// proceso)? Un sorteo así tiene historial que conservar: un anuncio de OTRO
// sorteo nunca reescribe su fila. Ante un error de lectura se responde que sí
// (lo seguro: se crea una fila nueva y la anterior queda intacta).
async function sorteoTieneNumeros(evento) {

    if (!evento?.identidad_evento_real || !evento?.tabla || !evento?.usuario_id) return false;

    try {

        const { data, error } = await supabase
            .from(evento.tabla)
            .select("numero")
            .eq("usuario_id", evento.usuario_id)
            .eq("identidad_evento_real", evento.identidad_evento_real)
            .neq("estado", "libre")
            .limit(1);

        if (error) return true;

        return (data || []).length > 0;

    } catch {

        return true;

    }

}

// El sorteo anterior del grupo deja de estar vigente EN ESTE GRUPO porque se
// anunció otro: se cierra su fila (reservas y pagos intactos, siguen con su
// identidad). Nunca cierra el grupo de WhatsApp (el anuncio nuevo lo abre)
// ni toca las filas de ese sorteo en otros grupos.
async function sustituirEnGrupo(evento, motivo) {

    const base = { activo: false, estado: "cerrado", actualizado_en: new Date().toISOString() };

    let { error } = await supabase
        .from("eventos_bot")
        .update({ ...base, cierre_estado: "cerrado", cierre_motivo: motivo, cerrado_en: new Date().toISOString() })
        .eq("id", evento.id);

    // Sin la migración 023 (columnas de cierre por grupo).
    if (error?.code === "42703") ({ error } = await supabase.from("eventos_bot").update(base).eq("id", evento.id));

    if (error) {
        console.error(`❌ No se pudo cerrar el sorteo anterior (${evento.id}) del grupo:`, error.message);
        return false;
    }

    console.log(`🔁 Sorteo anterior ${evento.nombre_evento || ""} ${evento.hora_fin || ""} cerrado en este grupo (${motivo}); sus reservas y pagos se conservan.`);

    return true;

}

// Quien publicó el anuncio ¿puede reemplazar un sorteo programado desde el
// panel? Solo la propia cuenta del bot (fromMe) o un administrador del grupo:
// un cliente que reenvía un anuncio viejo nunca lo reemplaza.
async function remitenteAutorizado(ctx, grupoId) {

    if (ctx.message?.key?.fromMe) return true;

    const jid = ctx.message?.key?.participant || null;
    if (!jid) return false;

    try {
        const { esAdministrador } = require("../admins/esAdministrador");
        const r = await esAdministrador({ sock: ctx.sock, grupoId, jid });
        return r?.esAdministrador === true;
    } catch {
        return false;
    }

}

async function detectarEvento(ctx) {

    try {

        const { sock, grupo, textoOriginal } = ctx;

        const grupoId =
            grupo?.remoteJid ||
            ctx.chat.remoteJid;

        console.log("==================================");
        console.log("📨 DETECTAR EVENTO");
        console.log("Grupo:", grupoId);
        console.log("==================================");

        if (!textoOriginal?.trim()) {

            console.log("❌ Texto vacío");
            return null;

        }

        const evento = extraerEvento(textoOriginal);

        if (!evento) {

            console.log("❌ No es un evento");
            return null;

        }

        console.log("🎯 Evento detectado");

        console.table({

            nombre: evento.nombre,
            hora: evento.hora,
            valor: evento.valor,
            premios: evento.premios.length

        });

        // Anuncio reconocido pero sin un dato obligatorio (p. ej. "10:30"
        // sin am/pm, o sin valor por número): no se inventa ni se guarda.
        if (evento.faltantes?.length) {

            console.log(`⚠️ Anuncio incompleto — falta: ${evento.faltantes.join(", ")}. No se crea el sorteo.`);
            return null;

        }

        // Tabla del precio SEGÚN EL DUEÑO de la sesión (tablas_cliente). Sin
        // dueño no se crea el sorteo: sus reservas se rechazarían igual
        // (filtroCliente.js) y nunca debe apuntar a la cuadrícula de nadie.
        const duenoSesion = sock?.context?.usuarioId ?? null;

        if (!duenoSesion) {

            console.error("❌ Anuncio en una sesión sin usuario_id: no se crea el sorteo.");
            return null;

        }

        // El dueño validado por el dispatcher (ctx.session) y el del socket
        // que guardará el evento deben ser el mismo cliente.
        const duenoValidado = ctx.session?.usuarioId ?? null;

        if (duenoValidado && duenoValidado !== duenoSesion) {

            console.error("❌ El dueño de la sesión no coincide con el del socket: no se crea el sorteo.");
            return null;

        }

        const config = await obtenerConfiguracionCliente(duenoSesion, evento.valor);

        if (!config) {

            console.log("❌ No existe configuración para:", evento.valor);
            return null;

        }

        console.table(config);

        const eventoCompleto = {

            ...evento,

            tabla: config.tabla,
            cifras: config.cifras,
            cantidad_numeros: config.cantidad

        };

        const eventoAnterior = await consultarEvento(grupoId, duenoSesion);

        console.log(
            "📋 Evento anterior:",
            eventoAnterior
                ? `${eventoAnterior.nombre_evento} (${eventoAnterior.hora_fin})`
                : "No existe"
        );

        // ===============================
        // RE-ANUNCIO DE UN SORTEO YA LLENO/CERRADO
        // ===============================
        // "TABLA LLENA FAMILIA" + el anuncio completo (o cualquier
        // republicación del mismo anuncio) trae la misma estructura de
        // sorteo. Si es el MISMO sorteo real que el evento de este grupo y
        // ese evento ya está cerrado o lleno, no es un sorteo nuevo: no se
        // reactiva (guardarEvento), no se crea ciclo de automatización y no
        // se abre el grupo. Un sorteo distinto (otra lotería/hora/valor/
        // fecha) sigue el flujo de siempre.
        // Sorteo ACTIVO del que este anuncio es continuación (en este u otro
        // grupo): identidad estable durante todo su ciclo de vida.
        let sorteoVigente = null;

        // Hoy, o mañana si se anuncia de noche una hora que ya pasó (ver
        // fechaSorteoAnunciado). Se calcula una sola vez para todo el flujo.
        const fechaSorteo = fechaSorteoAnunciado(eventoCompleto.hora, eventoCompleto.horaCierre);

        try {

            sorteoVigente = await buscarSorteoVigente({
                supabase,
                usuarioId: sock?.context?.usuarioId ?? null,
                nombre: eventoCompleto.nombre,
                hora: eventoCompleto.hora,
                valor: eventoCompleto.valor,
                grupoId,
                hoy: fechaSorteo
            });

        } catch (err) {

            console.error("⚠️ No se pudo buscar el sorteo vigente (se usa la identidad de siempre):", err?.message);

        }

        if (eventoAnterior && (esMismoSorteo(eventoAnterior, {

            usuario_id: sock?.context?.usuarioId ?? null,
            nombre_evento: eventoCompleto.nombre,
            hora_fin: eventoCompleto.hora,
            valor: eventoCompleto.valor,
            fecha_evento: fechaSorteo

        }) || (sorteoVigente && eventoAnterior.identidad_evento_real === sorteoVigente.identidad_evento_real))) {

            const terminado = await estadoTerminado(eventoAnterior);

            if (terminado) {

                console.log(`⏭️ Re-anuncio del mismo sorteo ya ${terminado} (${eventoAnterior.nombre_evento} ${eventoAnterior.hora_fin}) — no se reactiva ni se abre el grupo.`);

                return eventoAnterior;

            }

        }

        // ===============================
        // SORTEO PROGRAMADO DESDE EL PANEL, ACTIVO
        // ===============================
        // El evento activo de este grupo nació de un sorteo programado (con
        // su configuración, cuentas y mensajes revisados y confirmados por
        // el administrador). Un anuncio escrito en el grupo nunca lo
        // reemplaza ni lo reabre: se trata como un re-anuncio. Se reconoce
        // por su identidad, aunque el envío del anuncio quedara incierto.
        // Identidad del sorteo que anuncia ESTE mensaje (la misma que
        // calculará guardarEvento).
        const identidadAnunciada = sorteoVigente?.identidad_evento_real || crearIdentidadEventoReal({
            usuario_id: duenoSesion,
            nombre_evento: eventoCompleto.nombre,
            hora_fin: eventoCompleto.hora,
            valor: eventoCompleto.valor,
            fecha_evento: sorteoVigente?.fecha_evento || fechaSorteo
        });

        const otroSorteo = Boolean(eventoAnterior) && eventoAnterior.identidad_evento_real !== identidadAnunciada &&
            !esMismoSorteo(eventoAnterior, { usuario_id: duenoSesion, nombre_evento: eventoCompleto.nombre, hora_fin: eventoCompleto.hora, valor: eventoCompleto.valor, fecha_evento: fechaSorteo });

        // Un anuncio del MISMO sorteo programado es un re-anuncio: no lo
        // reemplaza ni lo reabre. Un anuncio de OTRO sorteo es una decisión
        // explícita del administrador (corregir una lotería o cambiar el
        // sorteo vigente): prevalece si lo publica la cuenta del bot o un
        // administrador del grupo, sin esperar al cierre del anterior.
        if (eventoAnterior?.activo && await esEventoDeSorteoProgramado(eventoAnterior)) {

            if (!otroSorteo || !(await remitenteAutorizado(ctx, grupoId))) {

                console.log(`⏭️ Anuncio detectado en un grupo con un sorteo programado activo (${eventoAnterior.nombre_evento} ${eventoAnterior.hora_fin}) — no se reemplaza${otroSorteo ? " (no lo publicó un administrador)" : ""}.`);

                return eventoAnterior;

            }

            console.log(`🔁 Anuncio de OTRO sorteo publicado por un administrador en un grupo con un sorteo programado activo — se sustituye en este grupo.`);

        }

        // ¿Qué fila se guarda?
        //   - Mismo sorteo (re-anuncio): su fila, como siempre.
        //   - Otro sorteo y el anterior todavía SIN números (detección
        //     equivocada que se corrige con un anuncio nuevo): se corrige la
        //     misma fila.
        //   - Otro sorteo y el anterior CON reservas/pagos o ya terminado:
        //     fila NUEVA. La del anterior se conserva (historial, pagos
        //     pendientes, contadores) y, si seguía activo, se cierra en este
        //     grupo. Nunca se reasignan sus reservas al sorteo nuevo.
        let filaAGuardar = eventoAnterior;
        let sustituir = null;

        if (otroSorteo) {

            let filaDelSorteo = null;

            try {
                const previa = await consultarEventoDelSorteo(grupoId, duenoSesion, identidadAnunciada);
                filaDelSorteo = previa?.ok ? previa.data : null;
            } catch {
                filaDelSorteo = null;
            }

            // Re-anuncio de un sorteo que este grupo ya terminó: igual que
            // arriba, no se reactiva.
            if (finDelEvento(filaDelSorteo)) {

                console.log(`⏭️ Re-anuncio de un sorteo ya ${finDelEvento(filaDelSorteo)} en este grupo (${filaDelSorteo.nombre_evento} ${filaDelSorteo.hora_fin}) — no se reactiva.`);

                return eventoAnterior;

            }

            if (filaDelSorteo) {

                filaAGuardar = filaDelSorteo;
                if (eventoAnterior.activo && eventoAnterior.id !== filaDelSorteo.id) sustituir = eventoAnterior;

            } else if (eventoAnterior.activo && !(await sorteoTieneNumeros(eventoAnterior))) {

                console.log(`✏️ Corrección del sorteo del grupo (${eventoAnterior.nombre_evento} ${eventoAnterior.hora_fin} → ${eventoCompleto.nombre} ${eventoCompleto.hora}): todavía no tenía números, se corrige la misma fila.`);

            } else {

                filaAGuardar = null;
                if (eventoAnterior.activo) sustituir = eventoAnterior;

            }

        }

        // ===============================
        // GUARDAR EVENTO
        // ===============================

        const eventoGuardado = await guardarEvento({

            sock,
            grupoId,
            evento: eventoCompleto,
            eventoAnterior: filaAGuardar,
            sorteoVigente,
            fechaSorteo

        });

        if (!eventoGuardado) {

            console.log("❌ No se pudo guardar el evento");
            return null;

        }

        // Solo después de guardar el nuevo: si guardar falla, el grupo sigue
        // con su sorteo de siempre.
        if (sustituir) {
            await sustituirEnGrupo(sustituir, `sustituido por el anuncio de ${eventoCompleto.nombre || "otro sorteo"} ${eventoCompleto.hora || ""}`.trim());
        }

        console.log("✅ Evento guardado correctamente");

        // ===============================
        // AUTOMATION ENGINE — capa ADICIONAL, nunca un bloqueo de apertura
        // ===============================
        // CORRECCIÓN DE REGRESIÓN: antes, `if (!autorizarApertura) return`
        // impedía llamar a abrirGrupo() por completo cuando no había
        // grupo_autorizado/configuración activa — el comportamiento
        // existente (detecta evento -> guarda evento -> abre grupo) NUNCA
        // debe depender de que exista automatización configurada.
        // Automation Engine se sigue consultando aquí, pero ahora
        // ÚNICAMENTE decide si ADEMÁS se crea un event_session (necesario
        // para recordatorios/actualización/cierre/tabla inicial/
        // OPEN_MESSAGE automáticos) — nunca si el grupo se abre. Sin
        // event_session, esas extras simplemente no ocurren para este
        // ciclo; el grupo se abre igual.
        let eventSessionAutorizado = null; // Fase 4A: necesario más abajo para OPEN_MESSAGE

        try {

            const decision = await automationEngine.onEventoDetectado(eventoGuardado);

            eventSessionAutorizado = decision.eventSession || null;

            if (eventSessionAutorizado) {

                console.log("🤖 [AUTOMATION] event_session creado — recordatorios/actualización/cierre/tabla/OPEN_MESSAGE habilitados:", decision.eventSession?.id);

            } else {

                console.log(`🤖 [AUTOMATION] sin event_session (${decision.motivo}) — el grupo se abre igual por el mecanismo existente; sin extras automáticos para este ciclo.`);

            }

        } catch (errorAutomation) {

            // Un fallo del propio Automation Engine (p. ej. las 4 tablas de
            // la migración 006 todavía no aplicadas en Supabase) NUNCA debe
            // impedir la apertura normal del grupo — solo significa que
            // este ciclo queda sin extras automáticos (eventSessionAutorizado
            // ya vale null por defecto). El procesamiento del evento no se
            // rompe (sigue guardado, se sigue devolviendo).
            console.error("❌ [AUTOMATION] error evaluando automatización (sin extras automáticos para este ciclo, la apertura del grupo continúa):", errorAutomation?.message);

        }

        // ===============================
// ABRIR GRUPO
// ===============================

const grupoAbierto = await abrirGrupo({

    sock,
    grupoId

});

if (!grupoAbierto) {

    // WhatsApp NO confirmó la apertura (típicamente rate-overlimit tras
    // agotar los reintentos de la cola). NO se reporta como exitosa:
    // se registra abierto=false en el evento YA guardado para que el
    // worker de eventos lo reintente. El flujo de detección NO se rompe:
    // el evento existe (activo=true) y las reservas siguen funcionando.

    console.log("⚠ No se pudo abrir el grupo en WhatsApp — se registra abierto=false para reintento.");

    let registrado = false;

    try {

        registrado = await marcarAperturaFallida(eventoGuardado.id);

    } catch (e) {

        console.error("❌ No se pudo registrar abierto=false:", e?.message);

    }

    if (registrado) {

        eventoGuardado.abierto = false;

    } else {

        // No se pudo registrar ni tras los reintentos: se deja constancia
        // clara en el log. El evento sigue existiendo (activo=true) y
        // podrá autocorregirse si el mismo mensaje se detecta de nuevo en
        // el grupo (se reintenta abrir y se registra abierto=true al
        // confirmarlo). No se inventa un estado nuevo para esto.
        console.error(`⚠️ Evento ${eventoGuardado.id}: quedó sin poder registrar el fallo de apertura tras los reintentos.`);

    }

} else {

    console.log("🔓 Grupo abierto correctamente");

    // guardarEvento ya no reescribe `abierto`: si la fila venía con una
    // apertura pendiente, se registra aquí, tras la confirmación de WhatsApp.
    if (eventoGuardado.abierto === false) {

        const { error: errorApertura } = await supabase.from("eventos_bot").update({ abierto: true }).eq("id", eventoGuardado.id).eq("activo", true);

        if (errorApertura) console.error(`❌ No se pudo registrar abierto=true del evento ${eventoGuardado.id} (lo hará el worker):`, errorApertura.message);
        else eventoGuardado.abierto = true;

    }

    // Escaneo incremental de ESE grupo — solo después de la confirmación
    // de arriba. No bloqueante: nunca debe retrasar el flujo de detección
    // de eventos ni afectar su resultado.
    const sessionIdParaEscaner = sock?.context?.sessionId || null;

    if (sessionIdParaEscaner) {

        escanearGrupo(sessionIdParaEscaner, sock, grupoId).catch(err => {

            console.error(`❌ [ESCÁNER IDENTIDADES] error tras abrir grupo ${grupoId}:`, err?.message);

        });

    }

    // Fase 4A — OPEN_MESSAGE: SOLO después de la confirmación real de
    // arriba (abrirGrupo() ya tuvo éxito), mismo criterio que el escáner
    // de identidades: no bloqueante, nunca retrasa ni afecta el resultado
    // de detectarEvento(). El grupo ya se abrió exista o no automatización
    // configurada; eventSessionAutorizado solo existe si Automation Engine
    // SÍ creó un event_session para este ciclo — sin él, no hay
    // OPEN_MESSAGE (ni recordatorios/actualización/cierre/tabla) para
    // este ciclo, pero la apertura ya ocurrió igual.
    if (eventSessionAutorizado) {

        // CORRECCIÓN (Fase Producción Real): sin esto, el event_session
        // quedaba en "pendiente" para siempre y el Scheduler (tabla
        // inicial/recordatorios/actualización/cierre) nunca lo procesaba,
        // aunque el grupo real ya estuviera abierto. No bloqueante, mismo
        // criterio que el resto de esta rama.
        automationEngine.marcarEventSessionAbierta(eventSessionAutorizado).catch(err => {

            console.error(`❌ [AUTOMATION] error marcando event_session abierto para ${grupoId}:`, err?.message);

        });

        automationEngine.enviarMensajeApertura(eventoGuardado, eventSessionAutorizado, sock).catch(err => {

            console.error(`❌ [AUTOMATION] error inesperado enviando OPEN_MESSAGE para ${grupoId}:`, err?.message);

        });

    }

}

        return eventoGuardado;

    } catch (error) {

        console.error("❌ Error detectando evento");
        console.error(error);

        return null;

    }

}

module.exports = {
    detectarEvento
};