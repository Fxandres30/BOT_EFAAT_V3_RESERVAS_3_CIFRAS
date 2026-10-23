// ==========================================================================
// sorteos/disponibilidad.js — comprobaciones previas a publicar un sorteo
// programado. Solo lectura. Devuelven BLOQUEOS (impiden publicar) y AVISOS
// (se muestran en la vista previa; no impiden).
//
// Reglas que protegen sorteos activos y pagos:
//   - Un grupo con un sorteo ACTIVO distinto nunca se reemplaza (hoy cada
//     grupo tiene una sola fila en eventos_bot: publicar encima dejaría
//     huérfanas las reservas del sorteo activo).
//   - La tabla de números del cliente debe existir completa y no tener
//     números reservados/pagados de OTRO sorteo: nunca se reinicia sola. El
//     sorteo puede pedir el reinicio seguro (reinicioTabla.js, migración
//     030: archiva y libera, nunca toca un sorteo activo) y confirmarlo en la
//     vista previa; se hace al publicar, y esos números dejan de bloquear la
//     programación (seReiniciara).
//
// Programación FUTURA (2026-10-22): el conflicto de grupo se decide con
// FECHAS, no solo con activo=true. Hay dos momentos:
//   - Al revisar/confirmar (publicarEn = la publicación programada): un
//     sorteo actual cuyo cierre llega ANTES de esa publicación no es un
//     conflicto (estará cerrado cuando toque publicar). Sí lo es uno que
//     seguirá abierto entonces (o cuyo cierre no se conoce: conservador) y
//     otro sorteo programado en el mismo grupo cuyo periodo abierto se
//     solape con el de éste.
//   - Al publicar (sin publicarEn): cualquier sorteo distinto todavía activo
//     en el grupo es un conflicto REAL en ese momento. El publicador espera
//     (no lo reemplaza nunca).
// ==========================================================================

const supabase = require("../lib/supabase");
const { numerosEsperados } = require("../bot/funciones/eventos/sorteoReal");
const { instanteBogota, partesBogota, fechaSorteoDe } = require("./validar");

const formatoCorto = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
const legible = (d) => (d ? formatoCorto.format(d) : "sin fecha");

// Instante en que un sorteo de eventos_bot deja de admitir reservas (lo que
// usa verificarHoraCierre). Sin fecha_evento: el día de hoy (comportamiento
// de siempre). null = no se puede saber (sin hora de cierre).
function cierreDeEvento(evento, ahora = new Date()) {
    if (!evento?.hora_cierre) return null;
    const fecha = evento.fecha_evento ? String(evento.fecha_evento).slice(0, 10) : partesBogota(ahora).fecha;
    return instanteBogota(fecha, String(evento.hora_cierre).slice(0, 5));
}

// Periodo abierto de un sorteo programado: [publicación, cierre].
function periodoProgramado(sorteo) {
    const desde = new Date(sorteo.publicar_en);
    const fecha = fechaSorteoDe(sorteo.config, sorteo.publicar_en);
    const hasta = sorteo.config?.hora_cierre ? instanteBogota(fecha, sorteo.config.hora_cierre) : null;
    return { desde, hasta };
}

// ¿Estará abierto `evento` en el instante `momento`? (desconocido = sí)
function seguiraAbierto(evento, momento, ahora) {
    if (evento.activo === false) return false;
    const cierre = cierreDeEvento(evento, ahora);
    return !cierre || cierre.getTime() > momento.getTime();
}

async function revisarTabla({ usuarioId, tabla, cifras, cantidad, identidad, seReiniciara = false }) {

    const bloqueos = [];
    const avisos = [];

    const { data, error } = await supabase
        .from(tabla)
        .select("numero, estado, identidad_evento_real")
        .eq("usuario_id", usuarioId);

    if (error) {
        console.error("❌ [SORTEOS] no se pudo leer la tabla de números:", error.message);
        bloqueos.push("No pudimos revisar la tabla de números en este momento. Inténtalo de nuevo en unos minutos.");
        return { bloqueos, avisos, resumen: null };
    }

    const esperados = new Set(numerosEsperados({ cifras, cantidad_numeros: cantidad }));
    const presentes = new Set((data || []).map(f => String(f.numero)).filter(n => esperados.has(n)));

    const ocupadosOtro = (data || []).filter(f =>
        (f.estado === "reservado" || f.estado === "pagado") && f.identidad_evento_real !== identidad
    ).length;

    const retenidos = (data || []).filter(f => f.estado === "bloqueado" || f.estado === "en_proceso").length;

    if (presentes.size < esperados.size) {
        bloqueos.push(`La tabla de números está incompleta (${presentes.size}/${esperados.size}). Créala o reiníciala desde Tablas.`);
    }

    if (ocupadosOtro > 0 && seReiniciara) {
        avisos.push(`Al publicar se reiniciará la tabla (no ahora): ${ocupadosOtro} número(s) reservados o pagados de sorteos anteriores se archivarán (no se borran) y quedarán libres, si en ese momento sigue siendo seguro.`);
    } else if (ocupadosOtro > 0) {
        bloqueos.push(`La tabla tiene ${ocupadosOtro} número(s) reservados o pagados de otro sorteo. Edita el sorteo y elige «Reiniciar la tabla antes de publicar» (se archivan al publicar, no se borran; nunca se tocan los de un sorteo activo).`);
    }

    if (retenidos > 0) {
        avisos.push(`Hay ${retenidos} número(s) bloqueados o en proceso: no se pueden vender y el sorteo no se cerrará por pagos mientras sigan así.`);
    }

    return {
        bloqueos,
        avisos,
        resumen: { esperados: esperados.size, presentes: presentes.size, ocupadosOtroSorteo: ocupadosOtro, retenidos }
    };

}

// Grupo: debe estar autorizado por este cliente y no tener, en el momento
// de publicar, otro sorteo abierto.
//
// publicarEn: instante de la publicación programada (revisión/confirmación).
// Sin él, se revisa el momento actual (publicador).
// sorteoId / cierreNuevo: para comparar con los demás sorteos programados
// del cliente en el mismo grupo (solo en la revisión).
//
// Devuelve { bloqueo, tipo, espera, avisos, eventoActual }:
//   tipo:   null | "no_autorizado" | "error_lectura" | "sorteo_activo" |
//           "otra_cuenta" | "programado_solapado"
//   espera: texto cuando hoy hay un sorteo activo que habrá cerrado antes de
//           la publicación (no bloquea: "Programado").
async function revisarGrupo({ usuarioId, grupoId, identidad, autorizados, publicarEn = null, ahora = new Date(), sorteoId = null, cierreNuevo = null }) {

    if (!autorizados.has(grupoId)) {
        return { bloqueo: "El grupo no está autorizado para este usuario.", tipo: "no_autorizado", espera: null, avisos: [] };
    }

    // Todas las filas del grupo: con varios clientes puede haber una por
    // cliente (antes .maybeSingle() fallaba y el mensaje era confuso).
    const { data, error } = await supabase
        .from("eventos_bot")
        .select("id, usuario_id, activo, estado, identidad_evento_real, nombre_evento, hora_fin, hora_cierre, fecha_evento")
        .eq("grupo_id", grupoId);

    if (error) {
        console.error("❌ [SORTEOS] no se pudo revisar el grupo:", error.message);
        return { bloqueo: "No pudimos revisar este grupo en este momento. Inténtalo de nuevo en unos minutos.", tipo: "error_lectura", espera: null, avisos: [] };
    }

    const momento = publicarEn ? new Date(publicarEn) : ahora;
    const futuro = Boolean(publicarEn);

    // Cada sorteo programado tiene su propia fila: el grupo puede conservar
    // las de sorteos anteriores (cerrados). Cuentan TODAS las activas de
    // otra identidad, no una fila cualquiera del cliente.
    const propias = (data || []).filter(f => f.usuario_id === usuarioId);
    const propio = propias.find(f => f.activo) || propias[0] || null;
    const activosDistintos = propias.filter(f => f.activo && f.identidad_evento_real !== identidad);
    let espera = null;

    if (activosDistintos.length) {

        const nombreDe = (f) => `${f.nombre_evento || "sin nombre"} ${f.hora_fin || ""}`.trim();

        if (!futuro) {
            return {
                bloqueo: `El grupo todavía tiene abierto el sorteo «${nombreDe(activosDistintos[0])}». No se reemplaza: se publicará en cuanto cierre.`,
                tipo: "sorteo_activo", espera: null, avisos: [], eventoActual: propio
            };
        }

        const abierto = activosDistintos.find(f => seguiraAbierto(f, momento, ahora));

        if (abierto) {
            const cierreActual = cierreDeEvento(abierto, ahora);
            return {
                bloqueo: cierreActual
                    ? `El sorteo actual «${nombreDe(abierto)}» sigue abierto hasta el ${legible(cierreActual)}, después de la publicación programada (${legible(momento)}). Programa la publicación después de ese cierre.`
                    : `El grupo tiene un sorteo activo («${nombreDe(abierto)}») sin hora de cierre conocida. Espera a que cierre o programa la publicación para después del cierre.`,
                tipo: "sorteo_activo", espera: null, avisos: [], eventoActual: abierto
            };
        }

        espera = activosDistintos
            .map(f => `Hoy está activo «${nombreDe(f)}» (cierra el ${legible(cierreDeEvento(f, ahora))}); este sorteo se publicará después, el ${legible(momento)}. El sorteo actual no se modifica.`)
            .join(" ");

    }

    // Sorteo de OTRO cliente en el mismo grupo: no se revela cuál.
    const ajenos = (data || []).filter(f => f.usuario_id !== usuarioId && f.activo);
    if (ajenos.some(f => (futuro ? seguiraAbierto(f, momento, ahora) : true))) {
        return {
            bloqueo: futuro
                ? "Otra cuenta tiene en este grupo un sorteo que seguirá abierto en la fecha de publicación. Elige otro grupo u otra fecha."
                : "Otra cuenta tiene un sorteo abierto en este grupo. Se publicará en cuanto termine.",
            tipo: "otra_cuenta", espera: null, avisos: [], eventoActual: propio
        };
    }

    // Otro sorteo PROGRAMADO del cliente en este grupo con el periodo abierto
    // solapado: el segundo nunca podría publicarse a su hora.
    if (futuro && sorteoId) {
        const solapado = await programadoSolapado({ usuarioId, grupoId, sorteoId, desde: momento, hasta: cierreNuevo });
        if (solapado.error) {
            return { bloqueo: "No pudimos revisar los demás sorteos programados de este grupo. Inténtalo de nuevo en unos minutos.", tipo: "error_lectura", espera: null, avisos: [], eventoActual: propio };
        }
        if (solapado.sorteo) {
            const p = periodoProgramado(solapado.sorteo);
            return {
                bloqueo: `Ya hay otro sorteo programado en este grupo («${solapado.sorteo.config?.nombre || "sin nombre"}», se publica el ${legible(p.desde)} y cierra el ${legible(p.hasta)}) que estaría abierto a la vez. Cambia la fecha de publicación de uno de los dos.`,
                tipo: "programado_solapado", espera: null, avisos: [], eventoActual: propio
            };
        }
    }

    return { bloqueo: null, tipo: null, espera, avisos: [], eventoActual: propio };

}

// Primer sorteo programado (confirmado y sin publicar del todo) del MISMO
// cliente en el grupo cuyo periodo abierto se cruza con [desde, hasta].
async function programadoSolapado({ usuarioId, grupoId, sorteoId, desde, hasta }) {

    const { data: filas, error } = await supabase
        .from("sorteos_programados_grupos")
        .select("sorteo_id, estado")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .in("estado", ["pendiente", "publicando", "fallido"]);

    if (error) return { error };

    const ids = [...new Set((filas || []).map(f => f.sorteo_id).filter(id => id !== sorteoId))];
    if (!ids.length) return { sorteo: null };

    const { data: sorteos, error: e2 } = await supabase
        .from("sorteos_programados")
        .select("id, estado, publicar_en, config")
        .eq("usuario_id", usuarioId)
        .in("id", ids)
        .in("estado", ["programado", "publicando"]);

    if (e2) return { error: e2 };

    const fin = (d) => (d ? d.getTime() : Infinity);

    const sorteo = (sorteos || []).find(s => {
        const p = periodoProgramado(s);
        return p.desde.getTime() < fin(hasta) && desde.getTime() < fin(p.hasta);
    }) || null;

    return { sorteo };

}

// Cierre de los sorteos activos del cliente con estas identidades (sus
// filas de eventos_bot). Map identidad -> instante de cierre, o null si
// alguna fila activa no tiene cierre conocido. Una identidad sin filas no
// aparece (no se puede saber cuándo termina).
async function cierresDeIdentidades(usuarioId, identidades, ahora = new Date()) {

    const lista = [...new Set(identidades.filter(Boolean))];
    if (!lista.length) return { ok: true, cierres: new Map() };

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("identidad_evento_real, activo, hora_cierre, fecha_evento")
        .eq("usuario_id", usuarioId)
        .in("identidad_evento_real", lista);

    if (error) return { ok: false, cierres: new Map() };

    const cierres = new Map();
    for (const ev of data || []) {
        if (ev.activo === false) continue;
        const c = cierreDeEvento(ev, ahora);
        const previo = cierres.has(ev.identidad_evento_real) ? cierres.get(ev.identidad_evento_real) : undefined;
        if (previo === null || !c) cierres.set(ev.identidad_evento_real, null);
        else cierres.set(ev.identidad_evento_real, previo && previo > c ? previo : c);
    }

    return { ok: true, cierres };

}

module.exports = {
    revisarTabla,
    revisarGrupo,
    cierresDeIdentidades,
    cierreDeEvento,
    legible
};
