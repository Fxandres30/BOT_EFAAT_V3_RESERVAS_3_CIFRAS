// ==========================================================================
// sorteos/publicador.js — worker de sorteos programados desde el panel.
//
// Cada ciclo (30 s), para el cliente dueño del socket activo:
//   1. PUBLICA los sorteos confirmados cuya hora llegó, grupo por grupo:
//      comprueba que su evento no terminó, genera la imagen de su tabla con
//      su diseño (compartirTabla.capturarImagenTabla) y solo entonces guarda
//      el evento con guardarEvento.js (la MISMA fila de eventos_bot que crea
//      el detector: reservas, pagos, cierre automático y contadores funcionan
//      igual), abre el grupo y lo COMPARTE con las mismas funciones del botón
//      «Compartir» en el servidor: su anuncio como pie
//      (destinosCompartir.textoParaCompartir) y el envío protegido contra
//      duplicados (compartirTabla.compartirEnGrupos). Sin imagen no se
//      publica ni se escribe el evento: nunca se envía solo el texto.
//   2. Envía los RECORDATORIOS y el AVISO DE CIERRE configurados.
//   3. Libera reservas vencidas SOLO si el sorteo lo activó explícitamente.
//
// Tras publicar en un grupo, el evento pasa por el MOTOR CENTRAL
// (automation/motorEventos.js), el mismo del detector de WhatsApp: ciclo de
// automatización del grupo y su mensaje de apertura, una vez.
//
// Garantías:
//   - Nunca publica una versión no confirmada (confirmado_version = version).
//   - Cada grupo se "reclama" con un UPDATE condicionado: dos ciclos o dos
//     procesos nunca publican el mismo grupo a la vez.
//   - Cada mensaje pasa por executionGuard (clave única en
//     automation_actions): como mucho UNA vez. Si un envío falla o no se
//     sabe si llegó, el grupo queda en 'requiere_revision' y solo el
//     administrador puede pedir reintentarlo (nunca un reenvío automático).
//   - Nunca reactiva un evento cerrado, cancelado, desactivado o eliminado:
//     el grupo queda en revisión. Reabrirlo es la acción «Reabrir» del panel.
//   - Nunca publica encima de otro sorteo activo del grupo (salvo que el
//     administrador eligiera sustituirlo) ni sobre una tabla incompleta o
//     con números repetidos. Con «Conservar la tabla actual» los números de
//     otros sorteos se quedan como están: no impiden publicar (UX-03).
//   - El reinicio de tabla elegido al programar se hace aquí, un minuto
//     antes del anuncio, revalidado y UNA sola vez (prepararPublicacion).
// ==========================================================================

const repo = require("./repo");
const { revisarTabla, revisarGrupo } = require("./disponibilidad");
const { mensajeRecordatorio, mensajeAvisoCierre } = require("./mensajes");
const { partesBogota, instanteBogota, fechaSorteoDe, identidadDelSorteo } = require("./validar");
const { decidirRecordatoriosSegunEstado } = require("../automation/eventRules");
const { leerEstadoParaRecordatorios } = require("../automation/repo/estadoSorteo");
const { cierreSilencioso, finDelEvento, vigente } = require("../shared/eventos/estadosGestion");
const { sorteosActivosDelPrecio, reemplazarAnteriores, revertirReemplazo } = require("../shared/eventos/unSorteoPorPrecio");
// Recordatorios y cierre: los del sorteo tienen prioridad sobre los generales
// del grupo (automation/scheduler.js); la decisión es la misma en los dos.
const prioridad = require("../automation/prioridadComunicaciones");
const activacionPanel = require("./activacionPanel");
const compartida = require("./publicacionCompartida");
const { MAX_INTENTOS_AUTOMATICOS, EN_ESPERA, sinPromesaDeReintento, esInstantaneo, resultadoInstantaneo, finalizarSorteo } = require("./estadoPublicacion");
const { recuperarAtascados } = require("./recuperacionPublicacion");
// Movidos a la entrada del panel (F4-F); se siguen exportando desde aquí.
const { eventoTerminado, ERROR_IMAGEN } = activacionPanel;
// Liberación: los mismos campos, filtro y auditoría que el botón «Liberar»
// del panel (fuente única, F1-B).
const { consultaLiberacion } = require("../bot/funciones/reservas/liberacion");
const { registrarAuditoria, contextoAuditoriaFila } = require("../bot/funciones/reservas/auditoriaReservas");
// Motor único de rifas (12/11/2026): la tabla de un sorteo es SU rifa.
const numerosSorteo = require("../rifas/numerosSorteo");
const { esUuid } = require("../rifas/formato");
const motorRifas = require("../rifas/motor");

// Motor nuevo: ¿sigue siendo válida la rifa del sorteo? null = sí; si no,
// el motivo. La rifa (tabla_id) existe en la cuenta, está activa, no está
// archivada y tiene el MISMO precio que el anuncio.
async function problemaDeRifa(usuarioId, sorteo, deps) {
    if (!esUuid(sorteo.tabla_id)) return "el sorteo no tiene una tabla (rifa) asignada. Edítalo y elige su tabla.";
    let rifa;
    try {
        rifa = await (deps.rifaDe || numerosSorteo.rifaDe)(usuarioId, { tablaId: sorteo.tabla_id });
    } catch (e) {
        return `no se pudo leer la tabla (rifa) del sorteo (${e.message}).`;
    }
    if (!rifa) return "la tabla (rifa) del sorteo ya no existe en tu cuenta.";
    if (rifa.archivada_en) return `la tabla «${rifa.nombre}» está archivada.`;
    if (rifa.activa === false) return `la tabla «${rifa.nombre}» está desactivada.`;
    if (Number(rifa.precio) !== Number(sorteo.config?.valor)) return `la tabla «${rifa.nombre}» ahora es de $${rifa.precio} y el sorteo anuncia $${sorteo.config?.valor}.`;
    return null;
}

// ¿Otra cuenta tiene un sorteo activo en el grupo? (lo que revisarGrupo
// comprueba después de los sorteos propios).
async function otraCuentaEnGrupo(supabase, usuarioId, grupoId) {
    const { data, error } = await supabase.from("eventos_bot").select("usuario_id, activo").eq("grupo_id", grupoId).eq("activo", true);
    if (error) return { error };
    return { hay: (data || []).some(f => f.usuario_id !== usuarioId) };
}

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
const TIPOS_ESPERA = new Set(["sorteo_activo", "otra_cuenta"]);

const enEspera = (grupo) => String(grupo?.ultimo_error || "").startsWith(EN_ESPERA);

// ERROR_IMAGEN (prefijo con el que el panel distingue que la imagen no llegó
// a generarse) y eventoTerminado viven en activacionPanel.js (F4-F).

// MAX_INTENTOS_AUTOMATICOS, EN_ESPERA, sinPromesaDeReintento, esInstantaneo,
// resultadoInstantaneo y finalizarSorteo viven en estadoPublicacion.js (F4-G).

function dependenciasReales() {
    return {
        supabase: require("../lib/supabase"),
        guardarEvento: require("../bot/funciones/eventos/guardarEvento").guardarEvento,
        consultarEventoDelSorteo: require("../bot/funciones/eventos/consultarEvento").consultarEventoDelSorteo,
        abrirGrupo: require("../bot/funciones/eventos/grupos/abrirGrupo").abrirGrupo,
        sendMessage: require("../services/baileys/send").sendMessage,
        // Imagen (F4-G): generada en el momento con los datos actuales de la
        // tabla por el generador de «Compartir» (capturaProgramada.js →
        // capturarTabla en el navegador del panel o, sin él, en Chromium
        // headless). Texto del anuncio y envío de imagen + pie con
        // ExecutionGuard, como «Compartir».
        capturarImagen: require("./capturaProgramada").capturarParaPublicar,
        textoParaCompartir: require("../services/destinosCompartir").textoParaCompartir,
        compartirEnGrupos: require("../services/compartirTabla").compartirEnGrupos,
        // Motor central de comunicaciones del evento publicado (04/11).
        motorEventos: require("../automation/motorEventos"),
        ejecutarUnaVez: require("../automation/executionGuard").ejecutarUnaVez,
        actualizarEvento: require("../bot/funciones/reservas/actualizarEvento").actualizarEvento,
        puedeActuar: require("../services/baileys/propiedadSesion").puedeActuar,
        tablasCliente: require("../bot/funciones/eventos/tablasCliente"),
        leerEstadoParaRecordatorios
    };
}

// ------------------------------------------------------------ publicar ---

// solicitado: publicación pedida AHORA por el administrador («Publicar
// ahora», «Reintentar» o «Publicar en los grupos nuevos»), no el ciclo.
async function publicarEnGrupo({ sock, sorteo, grupo, autorizados, deps, ahora, solicitado = false }) {

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
    // Un instantáneo no tiene «día programado»: publicar_en es solo cuándo
    // se pulsó «Publicar ahora»; un reintento manual vale hasta el cierre.
    // Tampoco cuando el administrador lo pide ahora (p. ej. un grupo añadido
    // después de publicar): vale hasta el cierre, que se comprueba abajo.
    if (actual.fecha !== programado.fecha && !enEspera(grupo) && !esInstantaneo(sorteo) && !solicitado) {
        return { estado: "requiere_revision", ultimo_error: `La fecha programada (${programado.fecha}) ya pasó; no se publicó.` };
    }
    if (cierre && ahora.getTime() >= cierre.getTime()) {
        return { estado: "requiere_revision", ultimo_error: `El cierre (${fechaSorteo} ${config.hora_cierre}) ya pasó; no se publicó.${enEspera(grupo) ? ` El conflicto del grupo no se resolvió a tiempo (${grupo.ultimo_error.slice(EN_ESPERA.length)}).` : ""}` };
    }

    // Conflictos EN ESTE MOMENTO.
    let rg = await revisarGrupo({ usuarioId, grupoId, identidad: sorteo.identidad_evento_real, autorizados, ahora });

    // Publicar otro sorteo REEMPLAZA al anterior (decisión del 31/10, ya no
    // depende de «Sustituir el sorteo activo»): el sorteo PROPIO distinto
    // que sigue abierto en el grupo no hace esperar. Se cierra justo antes
    // de guardar el nuevo (ver más abajo), nunca antes de tener la imagen.
    // El de OTRA cuenta en el grupo sí hace esperar, como siempre.
    let delGrupo = [];
    if (rg.bloqueo && rg.tipo === "sorteo_activo" && rg.conflictos?.length) {
        delGrupo = rg.conflictos;
        const ajena = await otraCuentaEnGrupo(deps.supabase, usuarioId, grupoId);
        rg = ajena.error
            ? { bloqueo: "No pudimos revisar este grupo en este momento. Inténtalo de nuevo en unos minutos.", tipo: "error_lectura" }
            : ajena.hay
                ? { bloqueo: "Otra cuenta tiene un sorteo abierto en este grupo. Se publicará en cuanto termine.", tipo: "otra_cuenta" }
                : { bloqueo: null };
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
    if (motorRifas.motorNuevo()) {
        const problemaRifa = await problemaDeRifa(usuarioId, sorteo, deps);
        if (problemaRifa) return { estado: "requiere_revision", ultimo_error: `No se publicó: ${problemaRifa} Revisa Tablas o vuelve a programar el sorteo.` };
    }
    const tablas = deps.tablasCliente || require("../bot/funciones/eventos/tablasCliente");
    const confPrecio = motorRifas.motorNuevo() ? { tabla: sorteo.tabla } : await tablas.obtenerConfiguracionCliente(usuarioId, config.valor);
    if (!confPrecio || confPrecio.tabla !== sorteo.tabla) {
        return { estado: "requiere_revision", ultimo_error: `La tabla configurada para $${config.valor} ya no es la del sorteo (${sorteo.tabla}); no se publicó. Revisa la configuración de Tablas o vuelve a programar el sorteo.` };
    }

    const rt = await revisarTabla({ usuarioId, tabla: sorteo.tabla, tablaId: sorteo.tabla_id ?? null, cifras: sorteo.cifras, cantidad: sorteo.cantidad_numeros, identidad: sorteo.identidad_evento_real });
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
    if (finDelEvento(previo.data)) return eventoTerminado(finDelEvento(previo.data));

    // Imagen, relectura y ACTIVACIÓN (núcleo central), una sola vez por sorteo
    // y grupo entre programaciones (K3, F4-F): entrada del panel
    // (activacionPanel.js). Mismas escrituras, orden, mensajes y estados.
    return activacionPanel.publicarDestino({
        sock, sorteo, grupo, delGrupo, fechaSorteo, ahora, deps, solicitado, buscarEventoDelSorteo,
        esperar: (motivo) => ({
            estado: "pendiente",
            intentos: Math.max(0, (Number(grupo.intentos) || 0) - 1),
            ultimo_error: `${EN_ESPERA}${motivo}${cierre ? ` Debe resolverse antes del cierre de reservas (${fechaSorteo} ${config.hora_cierre}); si no, quedará en revisión.` : ""}`
        })
    });
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

    if (motorRifas.motorNuevo()) return problemaDeRifa(usuarioId, sorteo, deps);

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

// Mismo motivo que publicarEnGrupo: el reemplazo es el mismo, hecho antes.
const motivoDeReemplazo = (config) => `sustituido por el sorteo ${config.nombre || ""} ${config.hora_fin || ""}`.trim();

// ¿Lo único que impide el reinicio son números de sorteos activos que esta
// publicación va a reemplazar (mismo precio y cliente)? Entonces, al
// publicar, se cierran como «sustituido» (reservas y pagos intactos en la
// tabla; la 030 los archiva). Devuelve:
//   {}                  no aplica (otras protecciones u otro precio)
//   { anticipado: true } aplicaría, pero aún no es la publicación
//   { reemplazo }        filas cerradas (para deshacer si hace falta)
//   { error }            no se pudo revisar o cerrar; nada cambió
async function reemplazarParaReiniciar({ usuarioId, sorteo, revision, ahora, deps, alPublicar }) {

    const protegidos = (revision.porSorteo || []).filter(g => String(g.clase).startsWith("protegido"));
    if (!protegidos.length || protegidos.some(g => g.clase !== "protegido_activo" || !g.identidad)) return {};

    const ocupan = await sorteosActivosDelPrecio(deps.supabase, { usuarioId, valor: sorteo.config.valor, identidad: sorteo.identidad_evento_real });
    if (!ocupan.ok) return { error: "no se pudo revisar el sorteo anterior de este precio; se reintentará." };

    const reemplazables = new Set(ocupan.filas.map(f => f.identidad_evento_real).filter(Boolean));
    if (!protegidos.every(g => reemplazables.has(g.identidad))) return {};
    if (!alPublicar) return { anticipado: true };

    const motivo = motivoDeReemplazo(sorteo.config);
    const r = await reemplazarAnteriores(deps.supabase, { usuarioId, filas: ocupan.filas, motivo, ahora, modalidad: "sustitucion_reinicio" });
    if (!r.ok) return { error: `no se pudo reemplazar el sorteo anterior (${r.error?.message || "error"}); no se modificó nada y se reintentará.` };

    return { reemplazo: { cerradas: r.cerradas, motivo, modalidad: r.modalidad } };

}

async function deshacerReemplazo(deps, usuarioId, reemplazo) {
    await revertirReemplazo(deps.supabase, { usuarioId, cerradas: reemplazo.cerradas, motivo: reemplazo.motivo, modalidad: reemplazo.modalidad });
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
    const datos = { id: sorteo.id, tabla: sorteo.tabla, tabla_id: sorteo.tabla_id ?? null, liberarBloqueados: tablaCfg.liberar_bloqueados === true };

    let revision = await reinicio.revisarReinicio(usuarioId, { ...datos, config: sorteo.config });

    if (!revision.ok) return { ok: false, espera: `${EN_ESPERA}no se pudo revisar la tabla para el reinicio programado; se reintentará.` };

    // UN SORTEO POR PRECIO: el sorteo activo de ESTE precio lo reemplaza la
    // publicación. Si sus números son lo único protegido, se reemplaza AQUÍ
    // (antes del reinicio, no después como sin reinicio) para que la 030 los
    // archive. Solo en la publicación misma: el ciclo anticipado (estado
    // «programado») nunca cierra un sorteo antes de su hora. Si después el
    // reinicio no se puede aplicar, el reemplazo se deshace.
    let reemplazo = null;
    const alPublicar = estados.includes("publicando");
    if (!revision.data.posible) {
        const r = await reemplazarParaReiniciar({ usuarioId, sorteo, revision, ahora, deps, alPublicar });
        if (r.error) return { ok: false, espera: `${EN_ESPERA}${r.error}` };
        if (r.anticipado) return { ok: false, espera: `${EN_ESPERA}el sorteo activo de este precio se reemplazará al publicar y entonces se reiniciará la tabla.` };
        if (r.reemplazo) {
            reemplazo = r.reemplazo;
            revision = await reinicio.revisarReinicio(usuarioId, { ...datos, config: sorteo.config });
            if (!revision.ok) {
                await deshacerReemplazo(deps, usuarioId, reemplazo);
                return { ok: false, espera: `${EN_ESPERA}no se pudo revisar la tabla para el reinicio programado; se reintentará.` };
            }
        }
    }

    if (!revision.data.posible) {
        if (reemplazo) await deshacerReemplazo(deps, usuarioId, reemplazo);
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
        if (!aplicado.ok && reemplazo) await deshacerReemplazo(deps, usuarioId, reemplazo);
        if (!aplicado.ok) return { ok: false, espera:`${EN_ESPERA}la tabla cambió durante el reinicio programado; no se modificó nada y se volverá a revisar.` };
    }

    // Marca de idempotencia: un reintento del publicador (o un segundo
    // proceso) ya no vuelve a reiniciar. Si no se puede anotar, no se publica
    // en este ciclo: el próximo verá la tabla ya libre y solo anotará.
    const config = { ...sorteo.config, tabla: { ...tablaCfg, reiniciado_en: ahora.toISOString() } };
    const marcado = await repo.actualizarSorteoSi(usuarioId, sorteo.id, { version: sorteo.version, estados }, { config, ultimo_error: null });
    if (!marcado.ok) return { ok: false, espera: `${EN_ESPERA}no se pudo anotar el reinicio de la tabla; se volverá a revisar.` };

    return { ok: true, sorteo: marcado.data };

}

// sorteoId: publicar SOLO ese sorteo, a petición del administrador
// («Publicar ahora» o «Reintentar» de un destino de un instantáneo). Sin él
// (ciclo automático) los instantáneos no se tocan.
async function publicarPendientes({ sock, deps, ahora, sorteoId = null }) {

    const usuarioId = sock.context.usuarioId;
    // Incluye los que se publican dentro del próximo minuto: su reinicio de
    // tabla (si lo eligieron) se hace antes del anuncio.
    const pendientes = await repo.sorteosParaPublicar(usuarioId, new Date(ahora.getTime() + ANTICIPO_REINICIO_MS));
    if (!pendientes.ok) return { ok: false, motivo: pendientes.motivo };

    pendientes.data = pendientes.data.filter(s => (sorteoId ? s.id === sorteoId : !esInstantaneo(s)));

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
            // Un instantáneo no espera a un ciclo: queda en error, reintentable.
            const cambios = preparado.abortar
                ? { estado: "requiere_revision", ultimo_error: preparado.abortar }
                : esInstantaneo(sorteo)
                    ? resultadoInstantaneo({ estado: "pendiente", ultimo_error: preparado.espera })
                    : { ultimo_error: preparado.espera };
            const terminaAqui = cambios.estado === "requiere_revision";
            // Condicionado: un grupo cancelado entretanto sigue cancelado.
            for (const g of grupos.data) {
                if (g.estado === "pendiente" || g.estado === "fallido") await repo.marcarGrupoSi(usuarioId, g.id, [g.estado], cambios);
            }
            await repo.actualizarSorteoSi(usuarioId, sorteo.id, { estados: ["publicando"] }, { ultimo_error: cambios.ultimo_error });
            informe.push({ sorteo: sorteo.id, estado: terminaAqui ? "requiere_revision" : "en_espera", error: cambios.ultimo_error });
            if (terminaAqui) await finalizarSorteo(usuarioId, sorteo.id);
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
                cambios = await publicarEnGrupo({ sock, sorteo, grupo: reclamado.data, autorizados, deps, ahora, solicitado: Boolean(sorteoId) });
            } catch (err) {
                cambios = { estado: "fallido", ultimo_error: `Error inesperado antes de enviar: ${err?.message}` };
            }

            // Instantáneo: sin reintentos automáticos (ver resultadoInstantaneo).
            if (esInstantaneo(sorteo)) cambios = resultadoInstantaneo(cambios);

            // Tras agotar los reintentos automáticos, revisión manual.
            if (cambios.estado === "fallido" && (Number(reclamado.data.intentos) || 0) >= MAX_INTENTOS_AUTOMATICOS) {
                cambios.estado = "requiere_revision";
                cambios.ultimo_error = sinPromesaDeReintento(cambios.ultimo_error);
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

// FASE O5: compara recordatorios y aviso de cierre con el orquestador central
// EN SOMBRA (sorteos/sombraSorteos.js). Solo cuando el motor decidió el
// contenido (envió o falló el envío); clave ya resuelta = nada que comparar.
// No hace nada salvo con MENSAJES_ORQUESTADOR_SORTEO=shadow y NUNCA lanza.
async function compararSorteoEnSombra(datos) {
    if (!(datos.r?.ejecutada || datos.r?.motivo === "fallo_ejecucion")) return;
    try {
        await require("./sombraSorteos").compararSorteoEnSombra(datos);
    } catch (error) {
        console.error("⚠️ [MENSAJES SOMBRA] sorteo: comparación omitida:", error?.message);
    }
}

async function procesarPublicados({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    const res = await repo.sorteosPublicados(usuarioId);
    if (!res.ok) return { ok: false };

    const envios = [];

    for (const sorteo of res.data) {

        const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
        // Publicación COMPARTIDA (K3, F4-F.1): en un grupo cuya publicación
        // produjo otra programación del mismo sorteo, los recordatorios y el
        // aviso de cierre los envía la propietaria. Sin poder saberlo, no se
        // envía nada en este ciclo (nunca un duplicado).
        let adoptados;
        try { adoptados = await compartida.gruposAdoptados(deps.supabase, sorteo, grupos.data); } catch { continue; }
        const publicados = (grupos.data || []).filter(g => g.estado === "publicado" && g.evento_bot_id && !adoptados.has(g.grupo_id));
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

            // REGLA F2 (06/11/2026): solo un sorteo VIGENTE recibe
            // recordatorios. Una fila activo=true ya terminada (C3) ya no los
            // recibe. El aviso de cierre (rama siguiente) conserva su
            // condición exacta (!ev.activo): esa fila tampoco recibe ahora un
            // aviso que antes no recibía. El cierre es F3.
            if (vigente(ev)) {

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
                    await compararSorteoEnSombra({ deps, sock, sorteo, grupoId: g.grupo_id, tipo: "sorteo_recordatorio", sufijo: `recordatorio:${rec.minutos_antes_cierre}`, tipoAccion: "SORTEO_RECORDATORIO", minutos: rec.minutos_antes_cierre, fecha, texto, r });

                }

            } else if (!ev.activo && ev.estado === "cerrado" && !cierreSilencioso(ev) && prioridad.fuentesDeComunicacion(sorteo.config).cierre === prioridad.SORTEO) {

                if (!deps.puedeActuar(sock)) return { ok: true, envios };

                // Nunca dos avisos de cierre para el mismo evento y grupo: si
                // la automatización del grupo ya lo anunció, no se envía otro.
                // Sin poder comprobarlo, se reintenta en el próximo ciclo.
                // Vigencia actual (F3-D): tras una reapertura, el aviso del
                // siguiente cierre lleva la clave de su ciclo; sin reapertura,
                // la de siempre.
                let yaAnunciado;
                let sufijoAviso = "aviso_cierre";
                try {
                    yaAnunciado = await prioridad.avisoCierreYaEnviado({ eventoId: ev.id, grupoId: g.grupo_id });
                    sufijoAviso = prioridad.sufijoAvisoCierre(await prioridad.ciclosDelEvento(ev.id));
                } catch {
                    envios.push({ tipo: "aviso_cierre", grupo: g.grupo_id, ejecutada: false, motivo: "estado_no_disponible" });
                    continue;
                }
                if (yaAnunciado) {
                    envios.push({ tipo: "aviso_cierre", grupo: g.grupo_id, ejecutada: false, motivo: "ya_anunciado_por_el_grupo" });
                    continue;
                }

                const { texto } = mensajeAvisoCierre(sorteo.config, sorteo.cuentas_snapshot, { fecha });
                const r = await enviarUnaVez({ deps, sock, sorteo, grupoId: g.grupo_id, sufijo: sufijoAviso, tipoAccion: "SORTEO_AVISO_CIERRE", texto });
                envios.push({ tipo: "aviso_cierre", grupo: g.grupo_id, ejecutada: r.ejecutada, motivo: r.motivo || null });
                await compararSorteoEnSombra({ deps, sock, sorteo, grupoId: g.grupo_id, tipo: "sorteo_aviso_cierre", sufijo: sufijoAviso, tipoAccion: "SORTEO_AVISO_CIERRE", fecha, texto, r });

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
        // Publicación COMPARTIDA (K3, F4-F.1): una programación que solo adopta
        // publicaciones de otra no aplica su vencimiento: lo gobierna la
        // propietaria. Sin poder saberlo, no se libera nada en este ciclo.
        try {
            const destinos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
            if (!destinos.ok || await compartida.esPuraAdoptante(deps.supabase, sorteo, destinos.data)) continue;
        } catch { continue; }

        // Solo mientras el sorteo siga activo en algún grupo.
        const { data: activos } = await deps.supabase.from("eventos_bot").select("*")
            .eq("usuario_id", usuarioId).eq("identidad_evento_real", sorteo.identidad_evento_real).eq("activo", true);
        if (!activos?.length) continue;

        // Motor de rifas (MOTOR_RIFAS=nuevo): vencen las reservas de ESTE
        // sorteo en SU rifa (sorteos_programados.tabla_id). rifa_liberar solo
        // libera 'reservado'/'en_proceso' (un pago entretanto nunca se toca) y
        // escribe la auditoría en la misma transacción.
        if (require("../rifas/motor").motorNuevo()) {
            liberados.push(...await liberarVencidasRifa({ sorteo, usuarioId, activos, reservas, ahora, deps }));
            continue;
        }

        // Lo que se lee de cada fila es también lo que queda en la auditoría.
        const { data: filas, error } = await deps.supabase.from(sorteo.tabla)
            .select("numero, estado, fecha_reserva, hora_reserva, comprador, contacto, nombre, telefono, usuario_global_id, evento_id, identidad_evento_real, grupo_id, grupo_nombre")
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

            const { data: cambiadas } = await consultaLiberacion(deps.supabase, { usuarioId, tabla: sorteo.tabla })
                .eq("numero", fila.numero)
                .eq("identidad_evento_real", sorteo.identidad_evento_real).eq("estado", "reservado")
                .select("numero");

            if (!cambiadas?.length) continue;

            liberadosSorteo++;
            liberados.push({ sorteo: sorteo.id, numero: fila.numero });

            // Mismo registro inmutable que una liberación del panel (032):
            // quién tenía el número y de qué sorteo, antes de limpiarlo.
            await (deps.registrarAuditoria || registrarAuditoria)({
                usuario_id: usuarioId, operador_id: null, operador_email: null,
                origen: "bot", accion: "liberar", tabla: sorteo.tabla,
                precio: Number(sorteo.config?.valor) || null, numero: String(fila.numero),
                ...contextoAuditoriaFila(fila),
                estado_nuevo: "libre", motivo: `vencimiento (${reservas.vencimiento_minutos} min)`, resultado: "ok"
            });

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

async function liberarVencidasRifa({ sorteo, usuarioId, activos, reservas, ahora, deps }) {
    const rifas = require("../rifas/repositorio");
    if (!sorteo.tabla_id) {
        console.error(`🛑 [RIFAS] vencimiento: el sorteo programado ${sorteo.id} no tiene rifa (tabla_id); no se libera nada.`);
        return [];
    }
    let leidas;
    try {
        leidas = await rifas.leerNumeros(usuarioId, sorteo.tabla_id, { estados: ["reservado"] });
    } catch (e) {
        console.error(`❌ [RIFAS] vencimiento: no se pudo leer la rifa ${sorteo.tabla_id}: ${e.message}`);
        return [];
    }
    const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
    const publicaciones = (grupos.data || []).map(g => new Date(g.publicado_en).getTime()).filter(Number.isFinite);
    const publicadoEn = Math.max(new Date(sorteo.publicar_en).getTime() || 0, publicaciones.length ? Math.min(...publicaciones) : 0);
    const limite = reservas.vencimiento_minutos * 60 * 1000;
    // Corte: lo reservado antes de este instante (y publicado antes) ya venció.
    const corte = new Date(ahora.getTime() - limite);
    if (publicadoEn > corte.getTime()) return [];
    // Solo las de ESTE sorteo y ya vencidas (una anticipada vence desde la publicación).
    const vencidas = [];
    for (const fila of leidas.filas || []) {
        if (fila.identidad_evento_real !== sorteo.identidad_evento_real || !fila.reservado_en) continue;
        const desde = Math.max(new Date(fila.reservado_en).getTime(), publicadoEn);
        if (ahora.getTime() - desde >= limite) vencidas.push(fila);
    }
    if (vencidas.length === 0) return [];
    const r = await rifas.liberar(usuarioId, sorteo.tabla_id, vencidas.map(f => f.numero), {},
        rifas.actor({ origen: "sistema", motivo: `vencimiento (${reservas.vencimiento_minutos} min)` }),
        // La base vuelve a comprobar, con la fila bloqueada, que la reserva sigue
        // siendo anterior al corte y de ESTE sorteo (no libera una reserva nueva).
        { rifa: leidas.rifa, reservadoAntesDe: corte, identidadEventoReal: sorteo.identidad_evento_real });
    const hechos = new Set((r.liberados || []).map(n => require("../rifas/formato").aTexto(n, leidas.rifa?.cifras ?? 2)));
    const liberadas = vencidas.filter(f => hechos.has(f.numero));
    for (const fila of liberadas) {
        await deps.supabase.from("reservas_actividad").insert({
            usuario_id: usuarioId, tabla: sorteo.tabla, tabla_id: sorteo.tabla_id, numero: fila.numero, evento_id: activos[0].id,
            tipo: "liberado",
            detalle: { motivo: "vencimiento", minutos: reservas.vencimiento_minutos, comprador: fila.comprador || null, contacto: fila.contacto || null },
            realizado_por: "bot:vencimiento"
        });
    }
    if (liberadas.length) await deps.actualizarEvento(activos[0]);
    return liberadas.map(f => ({ sorteo: sorteo.id, numero: f.numero }));
}

// Recuperación de publicaciones interrumpidas: sorteos/recuperacionPublicacion.js (F4-G).

// ----------------------------------------------------------------- tick ---

// sorteoId: ver publicarPendientes (publicación pedida por el administrador).
async function tick(sock, { ahora = new Date(), deps = null, sorteoId = null } = {}) {

    if (!sock?.context?.usuarioId) return { ok: false, motivo: "sin_tenant" };

    const d = deps || dependenciasReales();

    // Antes que nada: lo que una caída del proceso dejó «publicando».
    const recuperacion = await recuperarAtascados({ sock, deps: d, ahora });
    const publicacion = await publicarPendientes({ sock, deps: d, ahora, sorteoId });
    const mensajes = await procesarPublicados({ sock, deps: d, ahora });
    const vencimientos = await liberarVencidas({ sock, deps: d, ahora });

    return { ok: true, recuperacion, publicacion, mensajes, vencimientos };

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
    dependenciasReales,
    publicarPendientes,
    procesarPublicados,
    liberarVencidas,
    liberarVencidasRifa,
    iniciarPublicadorSorteos,
    detenerPublicadorSorteos,
    instanteBogota,
    sinPromesaDeReintento,
    esInstantaneo,
    ERROR_IMAGEN,
    MAX_INTENTOS_AUTOMATICOS,
    ANTICIPO_REINICIO_MS
};
