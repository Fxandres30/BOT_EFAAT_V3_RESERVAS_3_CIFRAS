// ==========================================================================
// sorteos/administracion.js — gestión de las programaciones desde el panel:
// estados, detalle, cancelar, eliminar y archivar.
//
// Tres estados distintos, que nunca se deducen uno del otro:
//   - de la PROGRAMACIÓN (sorteos_programados.estado): borrador, programado,
//     publicando, publicado, publicado_parcial, fallido, cancelado.
//   - de la PUBLICACIÓN en cada grupo (sorteos_programados_grupos.estado).
//   - OPERATIVO del sorteo, leído de eventos_bot por su identidad:
//       pendiente     todavía no se publicó en ningún grupo;
//       en_curso      reservas abiertas en algún grupo, o ya cerradas pero
//                     la hora del sorteo no ha llegado;
//       terminado     se publicó, sus reservas cerraron y su hora pasó (o
//                     el grupo ya pasó a otro sorteo: la fila de
//                     eventos_bot se reutiliza);
//       cancelado     se canceló sin llegar a ningún grupo;
//       sin_publicar  falló o su cierre pasó sin publicarse.
//   «Publicado» no significa «terminado»: lo decide eventos_bot.
//
// Cancelar, eliminar y archivar (siempre con el usuario del token):
//   - cancelar: detiene lo PENDIENTE. Nada publicado se deshace, ninguna
//     reserva se toca. Un grupo en revisión que ya tiene evento (el anuncio
//     pudo haber llegado) no se cancela: lo decide el administrador.
//   - eliminar: borra la fila de la programación SOLO si nunca tuvo
//     actividad (sin intentos, evento, reservas ni reinicio de tabla).
//     Antes la saca del alcance del publicador (pasa a 'cancelado' con un
//     UPDATE condicionado), vuelve a comprobarlo y borra con otro
//     condicionado. Si algo cambió entretanto, la deja como estaba.
//   - archivar: la oculta del listado sin borrar nada (migración 038).
// Cada operación deja su resultado REAL en el historial (038; sin ella, en
// el log del proceso).
// ==========================================================================

const repo = require("./repo");
const reservasAnticipadas = require("./reservasAnticipadas");
const { fechaSorteoDe, instanteBogota } = require("./validar");
const { legible } = require("./disponibilidad");
const { MAX_INTENTOS_AUTOMATICOS } = require("./publicador");

const ESTADOS_EDITABLES = ["borrador", "programado"];
// Solo una programación que nunca pasó a publicarse puede borrarse.
const ESTADOS_ELIMINABLES = ["borrador", "programado", "cancelado"];
// Prefijo del publicador para un grupo que espera un conflicto real.
const EN_ESPERA = "En espera: ";

const falla = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

// Igual que sorteosActivos: abierto mientras no esté cerrado.
const abierto = (e) => e.activo !== false && e.estado !== "cerrado";

// Un grupo se cancela si todavía no se publicó. En revisión, solo si nunca
// se creó su evento (no pudo llegar ningún anuncio).
function grupoCancelable(g) {
    return g.estado === "pendiente" || g.estado === "fallido" || (g.estado === "requiere_revision" && !g.evento_bot_id);
}

// ------------------------------------------------------------- contexto ---

// Lo que hace falta para describir varias programaciones con pocas
// consultas: sus grupos, los eventos de sus identidades y los números no
// libres de esas identidades en cada tabla. `ok` = todo se pudo leer.
async function cargarContexto(usuarioId, sorteos) {

    const identidades = [...new Set(sorteos.map(s => s.identidad_evento_real).filter(Boolean))];

    const [grupos, eventos] = await Promise.all([
        repo.gruposDeSorteos(usuarioId, sorteos.map(s => s.id)),
        repo.eventosPorIdentidad(usuarioId, identidades)
    ]);

    const numeros = [];
    let numerosOk = true;
    const porTabla = new Map();
    for (const s of sorteos) {
        if (!s.tabla || !s.identidad_evento_real) continue;
        porTabla.set(s.tabla, [...(porTabla.get(s.tabla) || []), s.identidad_evento_real]);
    }
    for (const [tabla, ids] of porTabla) {
        const r = await repo.numerosPorIdentidad(usuarioId, tabla, [...new Set(ids)]);
        if (!r.ok) numerosOk = false;
        else numeros.push(...r.data.map(n => ({ ...n, tabla })));
    }

    return {
        ok: grupos.ok && eventos.ok && numerosOk,
        grupos: grupos.data || [],
        eventos: eventos.data || [],
        numeros,
        sorteos
    };

}

// Eventos y números se guardan por IDENTIDAD, no por programación. Si otra
// programación vigente del cliente tiene la misma identidad (p. ej. se
// canceló una y se creó otra igual), los de esa identidad son de la otra,
// salvo que ésta tenga un grupo enlazado a un evento.
function propiosDe(sorteo, grupos, ctx) {

    const identidad = sorteo.identidad_evento_real;
    if (!identidad) return { eventos: [], numeros: [] };

    const enlazado = grupos.some(g => g.evento_bot_id);
    const otraVigente = ctx.sorteos.some(o => o.id !== sorteo.id && o.identidad_evento_real === identidad && o.estado !== "cancelado");
    if (!enlazado && otraVigente && sorteo.estado === "cancelado") return { eventos: [], numeros: [] };

    return {
        eventos: ctx.eventos.filter(e => e.identidad_evento_real === identidad),
        numeros: ctx.numeros.filter(n => n.tabla === sorteo.tabla && n.identidad_evento_real === identidad)
    };

}

// -------------------------------------------------------------- estados ---

function estadoOperativo(sorteo, grupos, eventos, ahora) {

    const fecha = fechaSorteoDe(sorteo.config, sorteo.publicar_en);
    const cierre = sorteo.config?.hora_cierre ? instanteBogota(fecha, sorteo.config.hora_cierre) : null;
    const juego = sorteo.config?.hora_fin ? instanteBogota(fecha, sorteo.config.hora_fin) : null;

    const abiertos = eventos.filter(abierto);
    const sePublico = eventos.length > 0 || grupos.some(g => g.estado === "publicado" || g.publicado_en);

    if (abiertos.length) {
        return { estado: "en_curso", reservas: "abiertas", detalle: `Reservas abiertas en ${abiertos.length} grupo(s)${cierre ? `; cierran el ${legible(cierre)}` : ""}.` };
    }

    if (sePublico) {
        if (juego && ahora.getTime() < juego.getTime()) {
            return { estado: "en_curso", reservas: "cerradas", detalle: `Reservas cerradas; el sorteo se juega el ${legible(juego)}.` };
        }
        return {
            estado: "terminado",
            reservas: "cerradas",
            detalle: eventos.length ? "Reservas cerradas y la hora del sorteo ya pasó." : "Se publicó; esos grupos ya pasaron a otro sorteo."
        };
    }

    if (sorteo.estado === "cancelado") return { estado: "cancelado", reservas: null, detalle: "Se canceló antes de publicarse: no llegó a ningún grupo." };
    if (cierre && ahora.getTime() >= cierre.getTime()) return { estado: "sin_publicar", reservas: null, detalle: "El cierre de reservas pasó sin que se publicara en ningún grupo." };
    if (sorteo.estado === "fallido") return { estado: "sin_publicar", reservas: null, detalle: "No se pudo publicar en ningún grupo." };

    return {
        estado: "pendiente",
        reservas: null,
        detalle: sorteo.estado === "borrador"
            ? "Sin confirmar: no se publicará hasta que revises la vista previa y lo confirmes."
            : `Se publicará el ${legible(new Date(sorteo.publicar_en))}.`
    };

}

// Qué pasó con UN grupo, en palabras, y si necesita al administrador.
function explicarGrupo(g, sorteo, eventosPorId) {

    const ev = g.evento_bot_id ? eventosPorId.get(g.evento_bot_id) : null;
    const evento = !g.evento_bot_id ? "sin_evento" : !ev ? "reutilizado" : abierto(ev) ? "abierto" : "cerrado";
    const intentos = Number(g.intentos) || 0;
    const manuales = Number(g.reintentos_manuales) || 0;
    const enEspera = g.estado === "pendiente" && String(g.ultimo_error || "").startsWith(EN_ESPERA);

    let explicacion;
    let intervencion = null;

    switch (g.estado) {
        case "pendiente":
            explicacion = enEspera ? g.ultimo_error : g.ultimo_error || "Esperando la hora de publicación.";
            break;
        case "publicando":
            explicacion = "Publicándose en este momento.";
            break;
        case "publicado":
            explicacion = `Publicado el ${legible(new Date(g.publicado_en))}${intentos > 1 ? ` (en el intento ${intentos})` : ""}${manuales ? ` tras ${manuales} reintento(s) manual(es)` : ""}.`;
            break;
        case "fallido":
            explicacion = `Falló el intento ${intentos} de ${MAX_INTENTOS_AUTOMATICOS}; se reintentará solo. ${g.ultimo_error || ""}`.trim();
            break;
        case "requiere_revision":
            explicacion = g.ultimo_error || "Requiere revisión.";
            intervencion = g.evento_bot_id
                ? "Revisa el grupo en WhatsApp: el anuncio pudo haber llegado. Si no llegó, reintenta; si llegó, no hagas nada (el sorteo sigue ahí)."
                : "No se publicó (ver el motivo). Reintenta cuando se resuelva o cancela la programación.";
            break;
        case "cancelado":
            explicacion = `Cancelado: no se publicará.${g.ultimo_error ? ` Último motivo antes de cancelar: ${g.ultimo_error}` : ""}`;
            break;
        default:
            explicacion = g.ultimo_error || g.estado;
    }

    // El evento se creó pero el anuncio no salió, y el sorteo sigue abierto
    // en el grupo: nada lo cierra solo salvo su hora de cierre.
    if (!intervencion && g.estado !== "publicado" && evento === "abierto") {
        intervencion = "Se creó el sorteo en este grupo pero el anuncio no se envió, y sigue abierto. Si no debe continuar, ciérralo desde Eventos.";
    }

    return {
        id: g.id,
        grupo_id: g.grupo_id,
        nombre: g.grupo_nombre || null,
        estado: g.estado,
        en_espera: enEspera,
        intentos,
        reintentos_manuales: manuales,
        publicado_en: g.publicado_en || null,
        actualizado_en: g.actualizado_en || null,
        ultimo_error: g.ultimo_error || null,
        evento,
        explicacion,
        intervencion,
        puede_reintentar: g.estado === "requiere_revision" && sorteo.estado !== "cancelado" && !sorteo.archivado_en
    };

}

function calcularImpacto(sorteo, grupos, eventos, numeros, lecturaOk) {

    const cuenta = (estado) => grupos.filter(g => g.estado === estado).length;
    const reservados = numeros.filter(n => n.estado === "reservado").length;
    const pagados = numeros.filter(n => n.estado === "pagado").length;

    return {
        lectura_ok: lecturaOk,
        grupos: {
            total: grupos.length,
            pendientes: cuenta("pendiente"),
            publicando: cuenta("publicando"),
            publicados: cuenta("publicado"),
            fallidos: cuenta("fallido"),
            en_revision: cuenta("requiere_revision"),
            cancelados: cuenta("cancelado"),
            con_evento: grupos.filter(g => g.evento_bot_id).length
        },
        intentos: grupos.reduce((n, g) => n + (Number(g.intentos) || 0), 0),
        reintentos_manuales: grupos.reduce((n, g) => n + (Number(g.reintentos_manuales) || 0), 0),
        eventos: { total: eventos.length, abiertos: eventos.filter(abierto).length },
        reservas: { reservados, pagados, otros: numeros.length - reservados - pagados, total: numeros.length },
        // Reservas tomadas antes de publicar (sin evento todavía).
        anticipadas: eventos.length === 0 ? numeros.length : 0,
        reinicio_hecho: !!sorteo.config?.tabla?.reiniciado_en
    };

}

// ¿Se puede borrar la fila sin perder nada? Cada motivo en palabras.
function evaluarEliminacion(sorteo, impacto) {

    const bloqueos = [];
    const g = impacto.grupos;

    if (!impacto.lectura_ok) bloqueos.push("No se pudo comprobar la actividad del sorteo; inténtalo de nuevo.");
    if (!ESTADOS_ELIMINABLES.includes(sorteo.estado)) bloqueos.push("La programación ya pasó a publicación: se conserva su registro.");
    if (g.publicados || g.publicando) bloqueos.push(`Se publicó (o se está publicando) en ${g.publicados + g.publicando} grupo(s).`);
    if (g.con_evento) bloqueos.push(`Se creó el sorteo en ${g.con_evento} grupo(s).`);
    if (impacto.intentos || impacto.reintentos_manuales) bloqueos.push(`Hubo ${impacto.intentos + impacto.reintentos_manuales} intento(s) de publicación: se conserva su historial.`);
    if (impacto.eventos.total) bloqueos.push(`El sorteo existe en ${impacto.eventos.total} grupo(s) de WhatsApp.`);
    if (impacto.reservas.total) bloqueos.push(`Tiene ${impacto.reservas.total} número(s) tomados (${impacto.reservas.reservados} reservado(s), ${impacto.reservas.pagados} pagado(s)): nunca se borran desde aquí.`);
    if (impacto.reinicio_hecho) bloqueos.push("Ya reinició la tabla al publicar: se conserva el registro.");

    return { posible: bloqueos.length === 0, bloqueos };

}

function accionesPermitidas(sorteo, grupos, operativo, eliminacion) {

    const archivado = !!sorteo.archivado_en;
    const editable = ESTADOS_EDITABLES.includes(sorteo.estado);
    const sinPublicar = grupos.every(g => g.estado === "pendiente" || g.estado === "cancelado");
    const algoEnMarcha = grupos.some(g => ["pendiente", "publicando", "fallido"].includes(g.estado));
    const revisionSinDecidir = operativo.estado === "sin_publicar" && grupos.some(g => g.estado === "requiere_revision");

    return {
        vista_previa: true,
        confirmar: !archivado && sorteo.estado === "borrador",
        editar: !archivado && editable && sinPublicar,
        cancelar: !archivado && sorteo.estado !== "cancelado" && (editable || grupos.some(grupoCancelable)),
        eliminar: !archivado && eliminacion.posible,
        archivar: !archivado && !editable && sorteo.estado !== "publicando" && !algoEnMarcha && !revisionSinDecidir
            && ["terminado", "cancelado", "sin_publicar"].includes(operativo.estado),
        restaurar: archivado
    };

}

// Todo lo que el panel muestra de UNA programación.
function gestionDe(sorteo, ctx, ahora) {

    const grupos = ctx.grupos.filter(g => g.sorteo_id === sorteo.id);
    const { eventos, numeros } = propiosDe(sorteo, grupos, ctx);
    const eventosPorId = new Map(eventos.map(e => [e.id, e]));

    const operativo = ctx.ok
        ? estadoOperativo(sorteo, grupos, eventos, ahora)
        : { estado: "desconocido", reservas: null, detalle: "No se pudo leer el estado del sorteo en los grupos." };
    const impacto = calcularImpacto(sorteo, grupos, eventos, numeros, ctx.ok);
    const eliminacion = evaluarEliminacion(sorteo, impacto);
    const acciones = accionesPermitidas(sorteo, grupos, operativo, eliminacion);
    const detalleGrupos = grupos.map(g => explicarGrupo(g, sorteo, eventosPorId));

    // Si no se puede borrar, qué hacer en su lugar.
    const alternativa = eliminacion.posible ? null : acciones.cancelar ? "cancelar" : acciones.archivar ? "archivar" : null;

    const fechas = [sorteo.actualizado_en, ...grupos.map(g => g.actualizado_en)].filter(Boolean).sort();

    return {
        grupos,
        gestion: {
            operativo,
            impacto,
            acciones,
            eliminacion: { ...eliminacion, alternativa },
            grupos: detalleGrupos,
            necesita_intervencion: detalleGrupos.some(g => g.intervencion),
            ultimo_error: sorteo.ultimo_error || null,
            ultima_actualizacion: fechas[fechas.length - 1] || null,
            archivado_en: sorteo.archivado_en || null
        }
    };

}

// ------------------------------------------------------------ consultas ---

// Listado del panel con grupos, estado operativo y acciones permitidas.
async function listar(usuarioId, { ahora = new Date() } = {}) {

    const lista = await repo.listarSorteos(usuarioId);
    if (!lista.ok) return lista;

    const ctx = await cargarContexto(usuarioId, lista.data);

    return {
        ok: true,
        data: lista.data.map(s => {
            const { grupos, gestion } = gestionDe(s, ctx, ahora);
            return { ...s, grupos, gestion };
        })
    };

}

async function gestionDeUno(usuarioId, sorteo, ahora) {
    // Para atribuir eventos y números por identidad hacen falta las demás
    // programaciones del cliente con esa misma identidad.
    const todas = await repo.listarSorteos(usuarioId);
    const otras = (todas.data || []).filter(s => s.id !== sorteo.id && s.identidad_evento_real === sorteo.identidad_evento_real);
    const ctx = await cargarContexto(usuarioId, [sorteo, ...otras]);
    return gestionDe(sorteo, { ...ctx, ok: ctx.ok && todas.ok }, ahora);
}

// Línea de tiempo: lo que guardan las columnas de la programación y sus
// grupos, más el historial de operaciones (038) si existe.
function lineaDeTiempo(sorteo, grupos, historial) {

    const eventos = [
        { en: sorteo.creado_en, tipo: "creado", texto: "Programación creada." },
        sorteo.confirmado_en && { en: sorteo.confirmado_en, tipo: "confirmado", texto: `Confirmada la versión ${sorteo.confirmado_version}.` },
        sorteo.config?.tabla?.reiniciado_en && { en: sorteo.config.tabla.reiniciado_en, tipo: "tabla", texto: "Tabla reiniciada antes de publicar." },
        ...grupos.filter(g => g.publicado_en).map(g => ({ en: g.publicado_en, tipo: "publicado", texto: `Publicado en ${g.grupo_nombre || g.grupo_id}.` })),
        ...historial.map(h => ({ en: h.creado_en, tipo: h.accion, texto: textoHistorial(h) })),
        sorteo.cancelado_en && !historial.some(h => h.accion === "cancelar") && { en: sorteo.cancelado_en, tipo: "cancelar", texto: "Programación cancelada." },
        sorteo.archivado_en && !historial.some(h => h.accion === "archivar") && { en: sorteo.archivado_en, tipo: "archivar", texto: "Archivada." }
    ].filter(e => e && e.en);

    return eventos.sort((a, b) => String(a.en).localeCompare(String(b.en)));

}

function textoHistorial(h) {
    const d = h.detalle || {};
    switch (h.accion) {
        case "cancelar": return `Cancelada por el administrador: ${d.cancelados ?? 0} grupo(s) cancelado(s)${d.en_curso ? `, ${d.en_curso} se estaban publicando` : ""}${d.en_revision ? `, ${d.en_revision} en revisión sin cancelar` : ""}.`;
        case "archivar": return "Archivada.";
        case "restaurar": return "Restaurada del archivo.";
        case "reintentar": return `Reintento manual pedido para ${d.grupo_nombre || d.grupo_id || "un grupo"}.`;
        case "eliminar": return h.resultado === "rechazado" ? `Eliminación rechazada: ${(d.bloqueos || []).join(" ")}` : "Eliminada.";
        default: return `${h.accion}: ${h.resultado}`;
    }
}

async function detalle(usuarioId, id, { ahora = new Date() } = {}) {

    const s = await repo.obtenerSorteo(usuarioId, id);
    if (!s.ok) return s;

    const { grupos: _, ...sorteo } = s.data;
    const { grupos, gestion } = await gestionDeUno(usuarioId, sorteo, ahora);
    const historial = await repo.historialDelSorteo(usuarioId, id);

    return {
        ok: true,
        data: {
            ...sorteo,
            grupos,
            gestion,
            historial: lineaDeTiempo(sorteo, grupos, historial.ok ? historial.data : []),
            historial_completo: historial.ok
        }
    };

}

// ------------------------------------------------------------- cancelar ---

// Estado final de una programación que ya pasó a publicación, cuando no le
// queda nada en marcha. Como finalizarSorteo del publicador, pero desde
// 'publicando', 'fallido' o 'publicado_parcial'. Nunca pasa a 'cancelado'
// si el sorteo existe en algún grupo (el detector lo sigue reconociendo
// como programado por su identidad).
async function cerrarTrasCancelar(usuarioId, sorteo, ahora) {

    const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
    if (!grupos.ok) return;
    if (grupos.data.some(g => ["pendiente", "publicando", "fallido"].includes(g.estado))) return;

    const vivos = grupos.data.filter(g => g.estado !== "cancelado");
    const publicados = vivos.filter(g => g.estado === "publicado").length;

    let estado;
    if (publicados) estado = publicados === vivos.length ? "publicado" : "publicado_parcial";
    else {
        const eventos = await repo.eventosPorIdentidad(usuarioId, sorteo.identidad_evento_real ? [sorteo.identidad_evento_real] : []);
        estado = vivos.length === 0 && eventos.ok && !eventos.data.length ? "cancelado" : "fallido";
    }

    await repo.actualizarSorteoSi(usuarioId, sorteo.id, { estados: ["publicando", "fallido", "publicado_parcial"] },
        { estado, ...(estado === "cancelado" ? { cancelado_en: ahora.toISOString() } : {}) });

}

async function cancelar(usuarioId, id, { ahora = new Date() } = {}) {

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    const s = actual.data;

    if (s.archivado_en) return falla("estado_invalido", { estado: "archivado", mensaje: "La programación está archivada." });
    // Doble clic o dos pestañas: la segunda no hace nada.
    if (s.estado === "cancelado") return { ok: true, data: s, aviso: "La programación ya estaba cancelada; no se hizo nada más." };

    const editable = ESTADOS_EDITABLES.includes(s.estado);
    if (!editable && !s.grupos.some(grupoCancelable)) {
        return falla("nada_que_cancelar", {
            mensaje: "No queda nada pendiente que cancelar: lo publicado no se deshace desde aquí. El sorteo sigue en los grupos hasta su cierre; para cerrarlo antes, usa Eventos."
        });
    }

    // Sin publicar y con reservas anticipadas: cancelar las dejaría sin
    // sorteo. Primero se resuelven (D3). Si no se pueden contar, no se hace.
    if (reservasAnticipadas.ESTADOS_SIN_PUBLICAR.includes(s.estado)) {
        const r = await reservasAnticipadas.anticipadasDelSorteo(usuarioId, s);
        if (!r.ok) return falla("error_supabase");
        if (r.total) {
            return falla("reservas_anticipadas", {
                mensaje: `No se puede cancelar: el sorteo tiene ${r.total} reserva(s) anticipada(s). Libéralas antes desde Tablas.`,
                cantidad: r.total
            });
        }
    }

    // 1. La programación primero: con este UPDATE condicionado el
    //    publicador (que solo toma 'programado') ya no la publicará. Si el
    //    publicador la tomó un instante antes, se sigue con los grupos.
    let cancelada = false;
    if (editable) {
        const r = await repo.actualizarSorteoSi(usuarioId, id, { estados: ESTADOS_EDITABLES }, { estado: "cancelado", cancelado_en: ahora.toISOString() });
        if (!r.ok && r.motivo !== "conflicto") return r;
        cancelada = r.ok;
        if (!cancelada) {
            const otra = await repo.obtenerSorteo(usuarioId, id);
            if (otra.ok && otra.data.estado === "cancelado") return { ok: true, data: otra.data, aviso: "La programación ya estaba cancelada; no se hizo nada más." };
        }
    }

    // 2. Grupos sin publicar, cada uno con un UPDATE condicionado a su
    //    estado leído: uno que el publicador acaba de reclamar no se toca.
    const grupos = await repo.gruposDelSorteo(usuarioId, id);
    if (!grupos.ok) return grupos;

    const resultado = { cancelados: [], en_curso: [], publicados: [], en_revision: [], eventos_abiertos: [] };

    for (const g of grupos.data) {
        const nombre = g.grupo_nombre || g.grupo_id;
        if (grupoCancelable(g)) {
            const r = await repo.marcarGrupoSi(usuarioId, g.id, [g.estado], { estado: "cancelado" });
            if (r.ok && r.data) {
                resultado.cancelados.push(nombre);
                if (g.evento_bot_id) resultado.eventos_abiertos.push({ nombre, evento_bot_id: g.evento_bot_id });
            } else resultado.en_curso.push(nombre);
        } else if (g.estado === "publicando") resultado.en_curso.push(nombre);
        else if (g.estado === "publicado") resultado.publicados.push(nombre);
        else if (g.estado === "requiere_revision") resultado.en_revision.push(nombre);
    }

    // Un grupo cancelado cuyo evento se creó sin anuncio: ¿sigue abierto?
    if (resultado.eventos_abiertos.length) {
        const ev = await repo.eventosPorIdentidad(usuarioId, s.identidad_evento_real ? [s.identidad_evento_real] : []);
        const abiertos = new Set((ev.data || []).filter(abierto).map(e => e.id));
        resultado.eventos_abiertos = resultado.eventos_abiertos.filter(x => abiertos.has(x.evento_bot_id)).map(x => x.nombre);
    }

    // 3. Ya en publicación: su estado final según lo que quedó.
    if (!cancelada) await cerrarTrasCancelar(usuarioId, s, ahora);

    const final = await repo.obtenerSorteo(usuarioId, id);
    if (!final.ok) return final;

    const resumen = {
        cancelados: resultado.cancelados.length,
        en_curso: resultado.en_curso.length,
        publicados: resultado.publicados.length,
        en_revision: resultado.en_revision.length,
        eventos_abiertos: resultado.eventos_abiertos.length
    };

    await repo.registrarHistorial(usuarioId, id, "cancelar", final.data.estado === "cancelado" ? "cancelado" : "cancelado_parcial", {
        estado_previo: s.estado, estado_final: final.data.estado, version: s.version, ...resumen, grupos: resultado
    });

    const avisos = [];
    if (resumen.cancelados) avisos.push(`Se cancelaron ${resumen.cancelados} grupo(s) pendiente(s): ya no se publicarán.`);
    if (resumen.en_curso) avisos.push(`${resumen.en_curso} grupo(s) se estaban publicando en ese momento y no se pudieron detener (${resultado.en_curso.join(", ")}); revisa su estado en unos segundos.`);
    // Lo ya publicado NO se deshace: sigue vivo y se cierra con las reglas normales.
    if (resumen.publicados) avisos.push(`Ya estaba publicado en ${resumen.publicados} grupo(s): ahí sigue activo hasta su cierre.`);
    if (resumen.en_revision) avisos.push(`${resumen.en_revision} grupo(s) en revisión no se cancelaron porque el anuncio pudo haber llegado (${resultado.en_revision.join(", ")}): revísalos en WhatsApp.`);
    if (resumen.eventos_abiertos) avisos.push(`En ${resultado.eventos_abiertos.join(", ")} se había creado el sorteo sin anuncio y sigue abierto: ciérralo desde Eventos si no debe continuar.`);

    return { ok: true, data: final.data, aviso: avisos.join(" ") || null, resultado: resumen };

}

// ------------------------------------------------------------- eliminar ---

async function eliminar(usuarioId, id, { version, confirmacion } = {}, { ahora = new Date() } = {}) {

    if (confirmacion !== true) return falla("confirmacion_requerida");

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    const { grupos: _, ...s } = actual.data;

    // La confirmación se dio sobre ESTA versión.
    if (Number(version) !== s.version) return falla("version_cambiada", { version_actual: s.version });

    const rechazo = (eliminacion) => falla("no_eliminable", {
        mensaje: `No se puede eliminar: ${eliminacion.bloqueos.join(" ")}${eliminacion.alternativa === "cancelar" ? " Puedes cancelarla." : eliminacion.alternativa === "archivar" ? " Puedes archivarla." : ""}`,
        bloqueos: eliminacion.bloqueos,
        alternativa: eliminacion.alternativa
    });

    const antes = await gestionDeUno(usuarioId, s, ahora);
    if (!antes.gestion.acciones.eliminar) return rechazo(antes.gestion.eliminacion);

    // 1. Fuera del alcance del publicador y de las reservas anticipadas
    //    (ambos solo toman 'programado'), con la versión confirmada.
    const previo = s.estado;
    if (previo !== "cancelado") {
        const r = await repo.actualizarSorteoSi(usuarioId, id, { version: s.version, estados: [previo] }, { estado: "cancelado", cancelado_en: ahora.toISOString() });
        if (!r.ok) return r.motivo === "conflicto" ? falla("version_cambiada") : r;
    }

    // 2. Se vuelve a comprobar con los datos de AHORA: entre la primera
    //    lectura y el paso 1 pudo entrar una reserva o un intento.
    const fresco = await repo.obtenerSorteo(usuarioId, id);
    const despues = fresco.ok ? await gestionDeUno(usuarioId, (({ grupos: _g, ...x }) => x)(fresco.data), ahora) : null;

    if (!despues || !despues.gestion.eliminacion.posible) {
        if (previo !== "cancelado") {
            await repo.actualizarSorteoSi(usuarioId, id, { version: s.version, estados: ["cancelado"] }, { estado: previo, cancelado_en: s.cancelado_en || null });
        }
        const eliminacion = despues?.gestion.eliminacion || { bloqueos: ["No se pudo volver a comprobar el sorteo."], alternativa: null };
        await repo.registrarHistorial(usuarioId, id, "eliminar", "rechazado", { bloqueos: eliminacion.bloqueos, estado: previo });
        return rechazo(eliminacion);
    }

    // 3. Borrado condicionado (misma versión, 'cancelado'). Si otra
    //    petición lo borró primero, no hay nada que borrar.
    const d = await repo.eliminarSorteoSi(usuarioId, id, { version: s.version, estados: ["cancelado"] });
    if (!d.ok) return d.motivo === "conflicto" ? falla("no_encontrado") : d;

    await repo.registrarHistorial(usuarioId, id, "eliminar", "eliminado", {
        nombre: s.config?.nombre || null,
        publicar_en: s.publicar_en,
        version: s.version,
        estado_previo: previo,
        grupos: despues.grupos.map(g => g.grupo_nombre || g.grupo_id)
    });

    return {
        ok: true,
        data: { id, eliminado: true, nombre: s.config?.nombre || null },
        aviso: "Programación eliminada. No se tocó ningún grupo, tabla ni reserva."
    };

}

// ------------------------------------------------------------- archivar ---

async function archivar(usuarioId, id, { archivar: valor = true } = {}, { ahora = new Date() } = {}) {

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    const { grupos: _, ...s } = actual.data;

    if (valor && s.archivado_en) return { ok: true, data: actual.data, aviso: "Ya estaba archivada." };
    if (!valor && !s.archivado_en) return { ok: true, data: actual.data, aviso: "No estaba archivada." };

    if (valor) {
        const { gestion } = await gestionDeUno(usuarioId, s, ahora);
        if (!gestion.acciones.archivar) {
            return falla("estado_invalido", {
                mensaje: "Solo se archiva una programación sin nada pendiente cuyo sorteo terminó, se canceló o no llegó a publicarse. Cancela antes lo pendiente o espera a que termine."
            });
        }
    }

    const r = await repo.marcarArchivado(usuarioId, id, { estado: s.estado, archivado: valor, ahora });
    if (!r.ok) return r.motivo === "conflicto" ? falla("version_cambiada") : r;

    await repo.registrarHistorial(usuarioId, id, valor ? "archivar" : "restaurar", "hecho", { estado: s.estado });

    return repo.obtenerSorteo(usuarioId, id);

}

module.exports = {
    listar,
    detalle,
    cancelar,
    eliminar,
    archivar,
    // Para pruebas y para el publicador.
    estadoOperativo,
    grupoCancelable
};
