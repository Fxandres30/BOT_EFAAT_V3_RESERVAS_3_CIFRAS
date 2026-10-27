// ==========================================================================
// sorteos/publicador.js — worker de sorteos programados desde el panel.
//
// Cada ciclo (30 s), para el cliente dueño del socket activo:
//   1. PUBLICA los sorteos confirmados cuya hora llegó, grupo por grupo:
//      guarda el evento con guardarEvento.js (la MISMA fila de eventos_bot
//      que crea el detector: reservas, pagos, cierre automático y contadores
//      funcionan igual), abre el grupo y lo COMPARTE con las mismas
//      funciones del botón «Compartir» en el servidor: la imagen de su tabla
//      con su diseño (compartirTabla.capturarImagenTabla), su anuncio como
//      pie (destinosCompartir.textoParaCompartir) y el envío protegido
//      contra duplicados (compartirTabla.compartirEnGrupos). Sin imagen no
//      se publica: nunca se envía solo el texto.
//   2. Envía los RECORDATORIOS y el AVISO DE CIERRE configurados.
//   3. Libera reservas vencidas SOLO si el sorteo lo activó explícitamente.
//
// Garantías:
//   - Nunca publica una versión no confirmada (confirmado_version = version).
//   - Cada grupo se "reclama" con un UPDATE condicionado: dos ciclos o dos
//     procesos nunca publican el mismo grupo a la vez.
//   - Cada mensaje pasa por executionGuard (clave única en
//     automation_actions): como mucho UNA vez. Si un envío falla o no se
//     sabe si llegó, el grupo queda en 'requiere_revision' y solo el
//     administrador puede pedir reintentarlo (nunca un reenvío automático).
//   - Nunca publica encima de otro sorteo activo ni sobre una tabla ocupada.
//   - El reinicio de tabla elegido al programar se hace aquí, un minuto
//     antes del anuncio, revalidado y UNA sola vez (prepararPublicacion).
// ==========================================================================

const repo = require("./repo");
const { revisarTabla, revisarGrupo } = require("./disponibilidad");
const { mensajeRecordatorio, mensajeAvisoCierre } = require("./mensajes");
const { partesBogota, instanteBogota, fechaSorteoDe, identidadDelSorteo } = require("./validar");
const { decidirRecordatoriosSegunEstado } = require("../automation/eventRules");
const { leerEstadoParaRecordatorios } = require("../automation/repo/estadoSorteo");
const { cierreSilencioso } = require("../shared/eventos/estadosGestion");

const MAX_INTENTOS_AUTOMATICOS = 5;
const VENTANA_RECORDATORIO_MS = 10 * 60 * 1000;
// El reinicio de la tabla («Reiniciar la tabla antes de publicar») se hace
// en el proceso de publicación, aproximadamente este tiempo antes del
// anuncio; nunca al programar.
const ANTICIPO_REINICIO_MS = 60 * 1000;

// Conflicto REAL en el momento de publicar que se resuelve solo (el sorteo
// actual del grupo todavía no cerró, o el reinicio diferido de la tabla
// todavía no es posible): el grupo sigue 'pendiente', sin gastar intentos,
// con este prefijo en ultimo_error para explicarlo. Se reintenta en cada
// ciclo hasta el cierre de reservas del sorteo nuevo; nunca se reemplaza
// el sorteo actual.
const EN_ESPERA = "En espera: ";
const TIPOS_ESPERA = new Set(["sorteo_activo", "otra_cuenta"]);

const enEspera = (grupo) => String(grupo?.ultimo_error || "").startsWith(EN_ESPERA);

// Campos que limpia una liberación: los MISMOS que el botón "Liberar" del
// panel (services/reservaManual.js, liberarManual).
const CAMPOS_LIBERACION = {
    estado: "libre", comprador: null, contacto: null, contacto_lower: null, nombre: null, telefono: null,
    lib: null, grupo_id: null, grupo_nombre: null, evento_id: null, nombre_evento: null,
    fecha_reserva: null, hora_reserva: null, fecha_pago: null, hora_pago: null,
    temporal_por: null, bloqueado_hasta: null, usuario_global_id: null
};

function dependenciasReales() {
    return {
        supabase: require("../lib/supabase"),
        guardarEvento: require("../bot/funciones/eventos/guardarEvento").guardarEvento,
        consultarEventoDelSorteo: require("../bot/funciones/eventos/consultarEvento").consultarEventoDelSorteo,
        abrirGrupo: require("../bot/funciones/eventos/grupos/abrirGrupo").abrirGrupo,
        sendMessage: require("../services/baileys/send").sendMessage,
        // «Compartir» en el servidor (routes/tablas.js): imagen de la tabla
        // del precio con el diseño guardado en el sorteo, texto del anuncio y
        // envío de imagen + pie con ExecutionGuard.
        capturarImagen: require("../services/compartirTabla").capturarImagenTabla,
        textoParaCompartir: require("../services/destinosCompartir").textoParaCompartir,
        compartirEnGrupos: require("../services/compartirTabla").compartirEnGrupos,
        ejecutarUnaVez: require("../automation/executionGuard").ejecutarUnaVez,
        actualizarEvento: require("../bot/funciones/reservas/actualizarEvento").actualizarEvento,
        puedeActuar: require("../services/baileys/propiedadSesion").puedeActuar,
        tablasCliente: require("../bot/funciones/eventos/tablasCliente"),
        leerEstadoParaRecordatorios
    };
}

// ------------------------------------------------------------ publicar ---

async function publicarEnGrupo({ sock, sorteo, grupo, autorizados, deps, ahora }) {

    const usuarioId = sorteo.usuario_id;
    const grupoId = grupo.grupo_id;
    const config = sorteo.config;
    const programado = partesBogota(new Date(sorteo.publicar_en));
    const actual = partesBogota(ahora);
    // Día en que se JUEGA: puede ser posterior al de la publicación (se
    // anuncia la víspera). El evento se guarda con esa fecha, así el cierre
    // por hora (verificarHoraCierre) no lo cierra antes de su día.
    const fechaSorteo = fechaSorteoDe(config, sorteo.publicar_en);
    const cierre = config.hora_cierre ? instanteBogota(fechaSorteo, config.hora_cierre) : null;

    // Nunca se publica fuera de su día de publicación ni después del cierre.
    // Excepción: un grupo que estaba EN ESPERA por un conflicto real puede
    // publicarse después de su día, siempre antes del cierre de reservas.
    if (actual.fecha !== programado.fecha && !enEspera(grupo)) {
        return { estado: "requiere_revision", ultimo_error: `La fecha programada (${programado.fecha}) ya pasó; no se publicó.` };
    }
    if (cierre && ahora.getTime() >= cierre.getTime()) {
        return { estado: "requiere_revision", ultimo_error: `El cierre (${fechaSorteo} ${config.hora_cierre}) ya pasó; no se publicó.${enEspera(grupo) ? ` El conflicto del grupo no se resolvió a tiempo (${grupo.ultimo_error.slice(EN_ESPERA.length)}).` : ""}` };
    }

    // Conflictos EN ESTE MOMENTO: un sorteo distinto todavía abierto en el
    // grupo nunca se reemplaza; se espera a que cierre.
    let rg = await revisarGrupo({ usuarioId, grupoId, identidad: sorteo.identidad_evento_real, autorizados, ahora });

    // «Sustituir el sorteo activo al publicar» (decisión del administrador
    // al programar): el sorteo PROPIO distinto que sigue abierto se cierra
    // en ESTE grupo (sin aviso de cierre; reservas y pagos intactos, sus
    // otros grupos siguen) y se publica a su hora. Nunca el de otra cuenta.
    if (rg.bloqueo && rg.tipo === "sorteo_activo" && config.sustituir_activo === true && rg.conflictos?.length) {
        for (const viejo of rg.conflictos) {
            const motivo = `sustituido por el sorteo programado ${config.nombre || ""} ${config.hora_fin || ""}`.trim();
            const cambios = { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: motivo, cerrado_en: ahora.toISOString(), actualizado_en: ahora.toISOString() };
            let { error } = await deps.supabase.from("eventos_bot").update(cambios).eq("usuario_id", usuarioId).eq("id", viejo.id).eq("activo", true);
            if (error?.code === "42703") ({ error } = await deps.supabase.from("eventos_bot").update({ activo: false, estado: "cerrado", actualizado_en: ahora.toISOString() }).eq("usuario_id", usuarioId).eq("id", viejo.id));
            if (error) return { estado: "fallido", ultimo_error: `No se pudo sustituir el sorteo actual del grupo (${error.message}); se reintentará.` };
        }
        rg = await revisarGrupo({ usuarioId, grupoId, identidad: sorteo.identidad_evento_real, autorizados, ahora });
    }

    if (rg.bloqueo && TIPOS_ESPERA.has(rg.tipo)) {
        return {
            estado: "pendiente",
            intentos: Math.max(0, (Number(grupo.intentos) || 0) - 1),
            ultimo_error: `${EN_ESPERA}${rg.bloqueo}${cierre ? ` Debe resolverse antes del cierre de reservas (${fechaSorteo} ${config.hora_cierre}); si no, quedará en revisión. Para publicar antes, cierra el sorteo actual o cambia el grupo.` : ""}`
        };
    }
    if (rg.bloqueo) return { estado: rg.tipo === "error_lectura" ? "fallido" : "requiere_revision", ultimo_error: rg.bloqueo };

    // El evento usa la tabla GUARDADA en el sorteo, y la imagen (como
    // «Compartir») la tabla configurada HOY para ese precio: deben ser la
    // misma. Si la configuración cambió desde que se programó, no se publica.
    const tablas = deps.tablasCliente || require("../bot/funciones/eventos/tablasCliente");
    const confPrecio = await tablas.obtenerConfiguracionCliente(usuarioId, config.valor);
    if (!confPrecio || confPrecio.tabla !== sorteo.tabla) {
        return { estado: "requiere_revision", ultimo_error: `La tabla configurada para $${config.valor} ya no es la del sorteo (${sorteo.tabla}); no se publicó. Revisa la configuración de Tablas o vuelve a programar el sorteo.` };
    }

    const rt = await revisarTabla({ usuarioId, tabla: sorteo.tabla, cifras: sorteo.cifras, cantidad: sorteo.cantidad_numeros, identidad: sorteo.identidad_evento_real });
    if (rt.bloqueos.length) return { estado: "requiere_revision", ultimo_error: rt.bloqueos.join(" ") };

    // El estilo elegido queda SOLO en el sorteo (config.diseno): nunca se
    // escribe en el diseño global de la tabla del precio, que podrían usar
    // otros sorteos del mismo cliente. La imagen de WhatsApp lo lee del
    // sorteo a partir del evento firmado en el token (/tablas/imprimir-datos).

    // Un sorteo distinto nunca reescribe la fila de otro: solo se reutiliza
    // la fila de ESTE sorteo (reintento). Sin ella, guardarEvento crea una
    // nueva y la del sorteo anterior queda intacta con sus reservas.
    const buscarEventoDelSorteo = deps.consultarEventoDelSorteo ||
        require("../bot/funciones/eventos/consultarEvento").consultarEventoDelSorteo;
    const previo = await buscarEventoDelSorteo(grupoId, usuarioId, sorteo.identidad_evento_real);
    if (!previo.ok) return { estado: "fallido", ultimo_error: "No se pudo comprobar el evento del grupo; se reintentará." };
    const eventoAnterior = previo.data;

    const guardado = await deps.guardarEvento({
        sock,
        grupoId,
        evento: {
            nombre: config.nombre,
            hora: config.hora_fin,
            horaCierre: config.hora_cierre,
            valor: config.valor,
            premios: config.premios || [],
            tabla: sorteo.tabla,
            cifras: sorteo.cifras,
            cantidad_numeros: sorteo.cantidad_numeros
        },
        eventoAnterior,
        sorteoVigente: { identidad_evento_real: sorteo.identidad_evento_real, fecha_evento: fechaSorteo }
    });

    if (!guardado?.id) return { estado: "fallido", ultimo_error: "No se pudo guardar el evento; se reintentará." };

    // Contadores del evento con las reservas que ya tiene su identidad
    // (anticipadas desde el panel); la fila nueva nace en cero.
    try { if (deps.actualizarEvento) await deps.actualizarEvento(guardado); } catch { /* best-effort */ }

    const base = { evento_bot_id: guardado.id };

    // Lo que publica «Compartir» para este sorteo: la imagen de la tabla del
    // precio con el diseño guardado en el sorteo (por su evento) y el anuncio
    // del sorteo como pie. La imagen es obligatoria: si no se puede generar,
    // no se abre el grupo ni se envía nada; se reintenta.
    let imagen;
    try {
        imagen = await deps.capturarImagen(Number(config.valor), usuarioId, guardado.id);
    } catch (err) {
        return { ...base, estado: "fallido", ultimo_error: `No se pudo generar la imagen de la tabla (${err?.message || err}); no se envió nada. Se reintentará.` };
    }

    const texto = await deps.textoParaCompartir(usuarioId, guardado);
    if (texto?.origen !== "sorteo" || !texto.texto) {
        return { ...base, estado: "fallido", ultimo_error: "No se pudo preparar el texto del anuncio del sorteo; no se envió nada. Se reintentará." };
    }

    // Sin el grupo abierto los clientes no pueden reservar: el anuncio no se
    // envía y el grupo no cuenta como publicado. Se reintenta (misma fila,
    // por identidad); entretanto el worker de eventos también intenta
    // abrirlo (abierto=false, mismo mecanismo que la detección).
    const abierto = await deps.abrirGrupo({ sock, grupoId });
    if (!abierto) {
        await deps.supabase.from("eventos_bot").update({ abierto: false }).eq("id", guardado.id);
        return { ...base, estado: "fallido", ultimo_error: "WhatsApp no confirmó la apertura del grupo: no se envió el anuncio. Se reintentará." };
    }

    // Solicitud FIJA por sorteo, grupo y reintento manual: los reintentos
    // automáticos usan la misma clave del ExecutionGuard y nunca duplican el
    // anuncio; solo el administrador abre una nueva (reintentos_manuales).
    const r = await deps.compartirEnGrupos({
        evento: guardado,
        sock,
        grupos: [{ grupo_id: grupoId, nombre: guardado.grupo_nombre || null }],
        caption: texto.texto,
        solicitudId: `sorteo-${sorteo.id}-publicacion-${Number(grupo.reintentos_manuales) || 0}`,
        imagen
    });

    // Rechazado antes de enviar (sin sesión, imagen inválida...).
    if (!r?.ok) return { ...base, estado: "fallido", ultimo_error: `No se envió el anuncio (${r?.motivo || "error"}); se reintentará.` };

    const envio = r.resultados[0] || { estado: "fallido", motivo: "sin_resultado" };

    if (envio.estado === "enviado" || envio.estado === "ya_enviado") {
        return { ...base, estado: "publicado", version_publicada: sorteo.version, publicado_en: ahora.toISOString(), ultimo_error: null };
    }

    // El registro de idempotencia no se pudo crear: el anuncio NO se envió.
    if (envio.motivo === "error_insert") {
        return { ...base, estado: "fallido", ultimo_error: "No se pudo registrar el envío; se reintentará." };
    }

    // Falló el envío, o un intento anterior quedó a medias: no se sabe con
    // certeza si llegó. Nunca se reenvía solo.
    return {
        ...base,
        estado: "requiere_revision",
        ultimo_error: envio.motivo === "fallo_ejecucion"
            ? `El anuncio no se pudo enviar: ${envio.error}`
            : `Estado del anuncio incierto (${envio.motivo}); revisa el grupo antes de reintentar.`
    };

}

async function finalizarSorteo(usuarioId, sorteoId) {

    const grupos = await repo.gruposDelSorteo(usuarioId, sorteoId);
    if (!grupos.ok) return;

    const lista = grupos.data;
    const enCurso = lista.some(g => g.estado === "pendiente" || g.estado === "publicando" ||
        (g.estado === "fallido" && (Number(g.intentos) || 0) < MAX_INTENTOS_AUTOMATICOS));

    if (enCurso) return;

    const vivos = lista.filter(g => g.estado !== "cancelado");
    const publicados = vivos.filter(g => g.estado === "publicado").length;

    const estado = vivos.length === 0 ? "cancelado"
        : publicados === vivos.length ? "publicado"
            : publicados > 0 ? "publicado_parcial"
                : "fallido";

    await repo.actualizarSorteoSi(usuarioId, sorteoId, { estados: ["publicando"] }, { estado });

}

// ¿El sorteo pidió reiniciar la tabla al publicar y todavía no se hizo? Las
// DOS marcas son necesarias: la opción del formulario (tabla.reiniciar) y la
// confirmación de la vista previa (tabla.reiniciar_al_publicar). Con
// «Conservar la tabla actual» nunca se reinicia.
function reinicioPendiente(sorteo) {
    const t = sorteo.config?.tabla || {};
    return t.reiniciar === true && t.reiniciar_al_publicar === true && !t.reiniciado_en;
}

// Antes de tocar la tabla se vuelve a comprobar, con los datos de ESTE
// momento, que el sorteo es del cliente del socket, que la programación es
// la versión confirmada y corresponde al mismo evento, y que la tabla es la
// configurada para ese precio en la cuenta del cliente.
async function verificarParaReinicio({ usuarioId, sorteo, deps }) {

    if (sorteo.usuario_id !== usuarioId) return "el sorteo no pertenece a esta cuenta.";
    if (sorteo.confirmado_version !== sorteo.version) return "la programación cambió desde que se confirmó.";
    if (sorteo.identidad_evento_real !== identidadDelSorteo(usuarioId, sorteo.config)) return "la programación no corresponde al evento confirmado.";

    const tablas = deps.tablasCliente || require("../bot/funciones/eventos/tablasCliente");
    const conf = await tablas.obtenerConfiguracionCliente(usuarioId, sorteo.config.valor);
    if (!conf || conf.tabla !== sorteo.tabla) return "la tabla del sorteo ya no es la configurada para ese precio en tu cuenta.";

    return null;

}

async function sigueVigente(usuarioId, sorteo, estados) {
    const fresco = await repo.obtenerSorteo(usuarioId, sorteo.id);
    if (!fresco.ok) return false;
    const s = fresco.data;
    return estados.includes(s.estado) && s.version === sorteo.version && s.confirmado_version === s.version
        && s.grupos.some(g => g.estado === "pendiente" || g.estado === "fallido");
}

// Reinicio de la tabla elegido al programar: se hace UNA vez, en el proceso
// de publicación (un minuto antes del anuncio o, si el bot no estaba, justo
// antes), con la función segura de la 030 (transacción, filas bloqueadas,
// archivo de respaldo; nunca toca un sorteo activo ni pagos en proceso). La
// 030 vuelve a decidir con la tabla de ESTE momento.
// Devuelve:
//   { ok: true, sorteo }    listo (o no había nada que reiniciar)
//   { ok: false, espera }   no se toca nada; se reintenta en el próximo ciclo
//   { ok: false, abortar }  no se toca nada ni se publica: queda en revisión
// estados: estados del sorteo en los que se puede anotar el reinicio hecho.
async function prepararPublicacion({ usuarioId, sorteo, ahora, deps, estados = ["publicando"] }) {

    if (!reinicioPendiente(sorteo)) return { ok: true, sorteo };

    // Pasado el cierre del sorteo nuevo no se reinicia nada: los grupos
    // quedarán en revisión por el cierre (publicarEnGrupo).
    const fecha = fechaSorteoDe(sorteo.config, sorteo.publicar_en);
    const cierre = sorteo.config.hora_cierre ? instanteBogota(fecha, sorteo.config.hora_cierre) : null;
    if (cierre && ahora.getTime() >= cierre.getTime()) return { ok: true, sorteo };

    // Justo antes de tocar la tabla se relee la programación: si se canceló,
    // eliminó o editó después de leerla en este ciclo (o ya no le queda
    // ningún grupo por publicar), no se reinicia nada en su nombre.
    if (!(await sigueVigente(usuarioId, sorteo, estados))) return { ok: false, descartado: true };

    const problema = await verificarParaReinicio({ usuarioId, sorteo, deps });
    if (problema) return { ok: false, abortar: `No se reinició la tabla ni se publicó: ${problema} No se modificó nada.` };

    const reinicio = deps.reinicioTabla || require("./reinicioTabla");
    const tablaCfg = sorteo.config.tabla;
    const datos = { id: sorteo.id, tabla: sorteo.tabla, liberarBloqueados: tablaCfg.liberar_bloqueados === true };

    const revision = await reinicio.revisarReinicio(usuarioId, { ...datos, config: sorteo.config });

    if (!revision.ok) return { ok: false, espera: `${EN_ESPERA}no se pudo revisar la tabla para el reinicio programado; se reintentará.` };

    if (!revision.data.posible) {
        // Solo números de un sorteo ACTIVO (el actual todavía no cerró): se
        // espera a que cierre. Cualquier otra protección (pago en proceso,
        // reservas sin sorteo atribuible, estado desconocido) no se resuelve
        // sola: no se reinicia ni se publica.
        const protegidos = (revision.porSorteo || []).filter(g => String(g.clase).startsWith("protegido"));
        const soloActivo = protegidos.length > 0 && protegidos.every(g => g.clase === "protegido_activo");
        const detalle = revision.data.bloqueos.join("; ");
        if (soloActivo) {
            return { ok: false, espera: `${EN_ESPERA}la tabla todavía tiene números protegidos (${detalle}). Se reiniciará y publicará en cuanto ese sorteo cierre.` };
        }
        return { ok: false, abortar: `No se reinició la tabla ni se publicó: tiene números protegidos (${detalle}). No se modificó nada; el anuncio prometería números que no están libres.` };
    }

    if (revision.data.liberables > 0) {
        const aplicado = await reinicio.aplicarReinicio(usuarioId, datos, revision.data.huella);
        // La tabla cambió entre la revisión y la escritura (reserva o pago
        // nuevo): la 030 no hizo nada. Se vuelve a decidir en el próximo ciclo.
        if (!aplicado.ok) return { ok: false, espera: `${EN_ESPERA}la tabla cambió durante el reinicio programado; no se modificó nada y se volverá a revisar.` };
    }

    // Marca de idempotencia: un reintento del publicador (o un segundo
    // proceso) ya no vuelve a reiniciar. Si no se puede anotar, no se publica
    // en este ciclo: el próximo verá la tabla ya libre y solo anotará.
    const config = { ...sorteo.config, tabla: { ...tablaCfg, reiniciado_en: ahora.toISOString() } };
    const marcado = await repo.actualizarSorteoSi(usuarioId, sorteo.id, { version: sorteo.version, estados }, { config, ultimo_error: null });
    if (!marcado.ok) return { ok: false, espera: `${EN_ESPERA}no se pudo anotar el reinicio de la tabla; se volverá a revisar.` };

    return { ok: true, sorteo: marcado.data };

}

async function publicarPendientes({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    // Incluye los que se publican dentro del próximo minuto: su reinicio de
    // tabla (si lo eligieron) se hace antes del anuncio.
    const pendientes = await repo.sorteosParaPublicar(usuarioId, new Date(ahora.getTime() + ANTICIPO_REINICIO_MS));
    if (!pendientes.ok) return { ok: false, motivo: pendientes.motivo };

    const autorizadosRes = await repo.gruposAutorizados(usuarioId);
    const autorizados = new Set((autorizadosRes.data || []).map(g => g.grupo_id));

    const informe = [];

    for (let sorteo of pendientes.data) {

        // Nunca una versión sin confirmar (p. ej. editada después de confirmar).
        if (sorteo.confirmado_version !== sorteo.version) continue;

        // Todavía no es la hora del anuncio: solo el reinicio anticipado. Si
        // no se puede, no se anota nada; la decisión final es al publicar.
        if (new Date(sorteo.publicar_en).getTime() > ahora.getTime()) {
            if (sorteo.estado === "programado" && reinicioPendiente(sorteo)) {
                const previo = await prepararPublicacion({ usuarioId, sorteo, ahora, deps, estados: ["programado"] });
                informe.push({ sorteo: sorteo.id, estado: previo.ok ? "tabla_reiniciada" : previo.descartado ? "descartado" : "reinicio_pendiente", error: previo.espera || previo.abortar || null });
            }
            continue;
        }

        if (sorteo.estado === "programado") {
            const tomado = await repo.actualizarSorteoSi(usuarioId, sorteo.id, { version: sorteo.version, estados: ["programado"] }, { estado: "publicando" });
            if (!tomado.ok) continue;
            sorteo = tomado.data;
        }

        const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
        if (!grupos.ok) continue;

        const preparado = await prepararPublicacion({ usuarioId, sorteo, ahora, deps });

        // Cancelada o cambiada entretanto: nada que hacer en su nombre.
        if (preparado.descartado) {
            informe.push({ sorteo: sorteo.id, estado: "descartado", error: null });
            await finalizarSorteo(usuarioId, sorteo.id);
            continue;
        }

        if (!preparado.ok) {
            // Nada se publica ni se reinicia en este ciclo. En espera: los
            // grupos siguen pendientes con la explicación. Abortado: quedan
            // en revisión (el administrador decide).
            const cambios = preparado.abortar
                ? { estado: "requiere_revision", ultimo_error: preparado.abortar }
                : { ultimo_error: preparado.espera };
            // Condicionado: un grupo cancelado entretanto sigue cancelado.
            for (const g of grupos.data) {
                if (g.estado === "pendiente" || g.estado === "fallido") await repo.marcarGrupoSi(usuarioId, g.id, [g.estado], cambios);
            }
            await repo.actualizarSorteoSi(usuarioId, sorteo.id, { estados: ["publicando"] }, { ultimo_error: cambios.ultimo_error });
            informe.push({ sorteo: sorteo.id, estado: preparado.abortar ? "requiere_revision" : "en_espera", error: cambios.ultimo_error });
            if (preparado.abortar) await finalizarSorteo(usuarioId, sorteo.id);
            continue;
        }

        sorteo = preparado.sorteo;

        for (const grupo of grupos.data) {

            if (!["pendiente", "fallido"].includes(grupo.estado)) continue;
            if ((Number(grupo.intentos) || 0) >= MAX_INTENTOS_AUTOMATICOS) continue;
            if (!deps.puedeActuar(sock)) break;

            const reclamado = await repo.reclamarGrupo(usuarioId, grupo.id, grupo.intentos);
            if (!reclamado.ok) continue;

            let cambios;

            try {
                cambios = await publicarEnGrupo({ sock, sorteo, grupo: reclamado.data, autorizados, deps, ahora });
            } catch (err) {
                cambios = { estado: "fallido", ultimo_error: `Error inesperado antes de enviar: ${err?.message}` };
            }

            // Tras agotar los reintentos automáticos, revisión manual.
            if (cambios.estado === "fallido" && (Number(reclamado.data.intentos) || 0) >= MAX_INTENTOS_AUTOMATICOS) {
                cambios.estado = "requiere_revision";
            }

            await repo.marcarGrupo(usuarioId, grupo.id, cambios);
            informe.push({ sorteo: sorteo.id, grupo: grupo.grupo_id, estado: cambios.estado, error: cambios.ultimo_error || null });

        }

        await finalizarSorteo(usuarioId, sorteo.id);

    }

    return { ok: true, informe };

}

// ------------------------------------------- recordatorios y aviso final ---

async function enviarUnaVez({ deps, sock, sorteo, grupoId, sufijo, tipoAccion, texto }) {
    return deps.ejecutarUnaVez({
        claveIdempotencia: `sorteo:${sorteo.id}:grupo:${grupoId}:${sufijo}`,
        grupoId,
        usuarioId: sorteo.usuario_id,
        tipoAccion,
        ejecutar: () => deps.sendMessage({ sock, jid: grupoId, text: texto })
    });
}

async function procesarPublicados({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    const res = await repo.sorteosPublicados(usuarioId);
    if (!res.ok) return { ok: false };

    const envios = [];

    for (const sorteo of res.data) {

        const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
        const publicados = (grupos.data || []).filter(g => g.estado === "publicado" && g.evento_bot_id);
        if (!publicados.length) continue;

        // Fila completa: el estado real de los números (antes de cada
        // recordatorio) necesita tabla, cifras y cantidad del sorteo.
        const { data: eventos } = await deps.supabase.from("eventos_bot")
            .select("*").in("id", publicados.map(g => g.evento_bot_id));

        const fecha = fechaSorteoDe(sorteo.config, sorteo.publicar_en);
        const cierre = instanteBogota(fecha, sorteo.config.hora_cierre);

        for (const g of publicados) {

            const ev = (eventos || []).find(e => e.id === g.evento_bot_id);

            // La fila de eventos_bot ya es de OTRO sorteo (el grupo pasó a
            // otro): nada más que enviar para éste.
            if (!ev || ev.identidad_evento_real !== sorteo.identidad_evento_real) continue;

            if (ev.activo) {

                // Estado real del sorteo, leído solo si algún recordatorio
                // está dentro de su ventana (una vez por grupo y ciclo).
                let decision = null;

                for (const rec of sorteo.config.recordatorios || []) {

                    const momento = cierre ? cierre.getTime() - rec.minutos_antes_cierre * 60 * 1000 : null;

                    // Solo dentro de su ventana: un recordatorio atrasado (bot
                    // caído) no se envía tarde.
                    if (!momento || ahora.getTime() < momento || ahora.getTime() >= momento + VENTANA_RECORDATORIO_MS || ahora.getTime() >= cierre.getTime()) continue;
                    if (!deps.puedeActuar(sock)) return { ok: true, envios };

                    if (!decision) {
                        const leerEstado = deps.leerEstadoParaRecordatorios || leerEstadoParaRecordatorios;
                        decision = decidirRecordatoriosSegunEstado(await leerEstado(ev, g.grupo_id));
                    }

                    // El texto del recordatorio programado es libre (no indica
                    // si invita a participar o recuerda pagar): se omite solo
                    // cuando no corresponde NINGUNO de los dos — todo pagado,
                    // o sin libres ni pendientes, o grupo cerrado sin
                    // pendientes. Si no se pudo leer el estado, se reintenta
                    // dentro de la misma ventana.
                    if (!decision.participacion && !decision.cobro) {
                        envios.push({ tipo: "recordatorio", grupo: g.grupo_id, ejecutada: false, motivo: decision.reintentar ? "estado_no_disponible" : `omitido_${decision.motivo}` });
                        continue;
                    }

                    const { texto } = mensajeRecordatorio(sorteo.config, rec, sorteo.cuentas_snapshot, { fecha });
                    const r = await enviarUnaVez({ deps, sock, sorteo, grupoId: g.grupo_id, sufijo: `recordatorio:${rec.minutos_antes_cierre}`, tipoAccion: "SORTEO_RECORDATORIO", texto });
                    envios.push({ tipo: "recordatorio", grupo: g.grupo_id, ejecutada: r.ejecutada, motivo: r.motivo || null });

                }

            } else if (ev.estado === "cerrado" && !cierreSilencioso(ev) && sorteo.config.mensajes?.aviso_cierre) {

                if (!deps.puedeActuar(sock)) return { ok: true, envios };

                const { texto } = mensajeAvisoCierre(sorteo.config, sorteo.cuentas_snapshot, { fecha });
                const r = await enviarUnaVez({ deps, sock, sorteo, grupoId: g.grupo_id, sufijo: "aviso_cierre", tipoAccion: "SORTEO_AVISO_CIERRE", texto });
                envios.push({ tipo: "aviso_cierre", grupo: g.grupo_id, ejecutada: r.ejecutada, motivo: r.motivo || null });

            }

        }

    }

    return { ok: true, envios };

}

// -------------------------------------------- vencimiento de reservas ---

// Solo para sorteos que lo activaron EXPLÍCITAMENTE (desactivado por
// defecto). Libera 'reservado' -> 'libre' con UPDATE condicionado al estado:
// un número que se pagó entretanto nunca se libera.
async function liberarVencidas({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    const res = await repo.sorteosPublicados(usuarioId);
    if (!res.ok) return { ok: false };

    const liberados = [];

    for (const sorteo of res.data) {

        const reservas = sorteo.config.reservas || {};
        if (reservas.liberar_no_pagados !== true || !(reservas.vencimiento_minutos > 0)) continue;

        // Solo mientras el sorteo siga activo en algún grupo.
        const { data: activos } = await deps.supabase.from("eventos_bot").select("*")
            .eq("usuario_id", usuarioId).eq("identidad_evento_real", sorteo.identidad_evento_real).eq("activo", true);
        if (!activos?.length) continue;

        const { data: filas, error } = await deps.supabase.from(sorteo.tabla)
            .select("numero, estado, fecha_reserva, hora_reserva, comprador, contacto")
            .eq("usuario_id", usuarioId).eq("identidad_evento_real", sorteo.identidad_evento_real).eq("estado", "reservado");
        if (error) continue;

        let liberadosSorteo = 0;

        // Una reserva anticipada (hecha antes del anuncio) empieza a vencer
        // cuando el sorteo se publica, no cuando se tomó: si no, se
        // liberaría en el primer ciclo tras publicar.
        const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
        const publicaciones = (grupos.data || []).map(g => new Date(g.publicado_en).getTime()).filter(Number.isFinite);
        const publicadoEn = Math.max(new Date(sorteo.publicar_en).getTime() || 0, publicaciones.length ? Math.min(...publicaciones) : 0);

        for (const fila of filas || []) {

            const reservadoEn = instanteBogota(fila.fecha_reserva, fila.hora_reserva);

            // Sin fecha de reserva no se puede saber si venció: no se toca.
            if (!reservadoEn) continue;

            const desde = Math.max(reservadoEn.getTime(), publicadoEn);
            if (ahora.getTime() - desde < reservas.vencimiento_minutos * 60 * 1000) continue;

            const { data: cambiadas } = await deps.supabase.from(sorteo.tabla)
                .update(CAMPOS_LIBERACION)
                .eq("usuario_id", usuarioId).eq("numero", fila.numero)
                .eq("identidad_evento_real", sorteo.identidad_evento_real).eq("estado", "reservado")
                .select("numero");

            if (!cambiadas?.length) continue;

            liberadosSorteo++;
            liberados.push({ sorteo: sorteo.id, numero: fila.numero });

            await deps.supabase.from("reservas_actividad").insert({
                usuario_id: usuarioId,
                tabla: sorteo.tabla,
                numero: fila.numero,
                evento_id: activos[0].id,
                tipo: "liberado",
                detalle: { motivo: "vencimiento", minutos: reservas.vencimiento_minutos, comprador: fila.comprador || null, contacto: fila.contacto || null },
                realizado_por: "bot:vencimiento"
            });

        }

        if (liberadosSorteo) await deps.actualizarEvento(activos[0]);

    }

    return { ok: true, liberados };

}

// ----------------------------------------------------------------- tick ---

async function tick(sock, { ahora = new Date(), deps = null } = {}) {

    if (!sock?.context?.usuarioId) return { ok: false, motivo: "sin_tenant" };

    const d = deps || dependenciasReales();

    const publicacion = await publicarPendientes({ sock, deps: d, ahora });
    const mensajes = await procesarPublicados({ sock, deps: d, ahora });
    const vencimientos = await liberarVencidas({ sock, deps: d, ahora });

    return { ok: true, publicacion, mensajes, vencimientos };

}

// --------------------------------------------------------------- worker ---

const intervalos = new Map();
const ejecutando = new Set();

function iniciarPublicadorSorteos(sock, { intervaloMs = 30000 } = {}) {

    const sessionId = sock?.context?.sessionId;
    if (!sessionId) return false;

    detenerPublicadorSorteos(sessionId);

    const propiedadSesion = require("../services/baileys/propiedadSesion");

    const intervalo = setInterval(async () => {

        if (ejecutando.has(sessionId) || !propiedadSesion.puedeActuar(sock)) return;

        ejecutando.add(sessionId);

        try {
            const r = await tick(sock);
            if (r.publicacion?.motivo === "migracion_pendiente") {
                // Sin la migración 024 no hay sorteos programados: silencio.
            }
        } catch (err) {
            console.error(`❌ [SORTEOS PROGRAMADOS] error en el ciclo (${sessionId}):`, err?.message);
        } finally {
            ejecutando.delete(sessionId);
        }

    }, intervaloMs);

    if (typeof intervalo.unref === "function") intervalo.unref();

    intervalos.set(sessionId, intervalo);

    return true;

}

function detenerPublicadorSorteos(sessionId) {

    if (!intervalos.has(sessionId)) return false;

    clearInterval(intervalos.get(sessionId));
    intervalos.delete(sessionId);

    return true;

}

module.exports = {
    tick,
    publicarPendientes,
    procesarPublicados,
    liberarVencidas,
    iniciarPublicadorSorteos,
    detenerPublicadorSorteos,
    instanteBogota,
    MAX_INTENTOS_AUTOMATICOS,
    ANTICIPO_REINICIO_MS
};
