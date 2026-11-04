// ==========================================================================
// operacionesCompartir.js — operaciones de «Compartir tabla» con progreso
// REAL y cancelación (04/11).
//
// Una operación = una pulsación de «Confirmar y enviar» (su id es el
// solicitudId que genera el panel). Guarda:
//   - la instantánea del mensaje aprobado (texto ya generado y su revisión):
//     todos los grupos de la operación reciben ESE texto aunque el sorteo se
//     edite mientras tanto;
//   - el estado de cada grupo, que solo cambia con lo que de verdad pasa en
//     el backend (compartirTabla.compartirEnGrupos y el publicador):
//       en_cola -> preparando -> enviando -> enviado | error | cancelado
//   - la petición de cancelación (idempotente).
//
// El registro vive en la MEMORIA del proceso (no hace falta migración). Si
// el proceso se reinicia se pierde el progreso, nunca la protección contra
// duplicados: cada envío está registrado en automation_actions con la clave
// de su solicitud y grupo (ExecutionGuard), así que repetir la misma
// solicitud nunca reenvía a un grupo ya hecho.
//
// Aislamiento: una operación solo la ve y la cancela su dueño (usuario del
// token). Nada de aquí envía mensajes.
// ==========================================================================

const RETENCION_MS = 30 * 60 * 1000;
const MAX_POR_USUARIO = 30;

const TERMINALES_GRUPO = new Set(["enviado", "error", "cancelado"]);
const TERMINALES_OPERACION = new Set(["completada", "con_errores", "cancelada", "fallida"]);

// id -> operación (interna)
const registro = new Map();

const ahoraIso = (reloj) => (reloj ? reloj() : new Date()).toISOString();

function purgar(ahoraMs = Date.now()) {
    for (const [id, op] of registro) {
        if (op.terminada_en && ahoraMs - Date.parse(op.terminada_en) > RETENCION_MS) registro.delete(id);
    }
    const porUsuario = new Map();
    for (const op of registro.values()) {
        if (!porUsuario.has(op.usuario_id)) porUsuario.set(op.usuario_id, []);
        porUsuario.get(op.usuario_id).push(op);
    }
    for (const lista of porUsuario.values()) {
        const viejas = lista.filter(o => o.terminada_en).sort((a, b) => a.creada_en.localeCompare(b.creada_en));
        while (lista.length > MAX_POR_USUARIO && viejas.length) {
            const o = viejas.shift();
            registro.delete(o.id);
            lista.splice(lista.indexOf(o), 1);
        }
    }
}

// grupos: [{ grupo_id, nombre, tipo: "compartir" | "activar" }]
// anuncio: { texto, activo, revision, origen }
function crear({ id, usuarioId, precio, grupos, anuncio = null }) {
    purgar();
    const ahora = ahoraIso();
    const op = {
        id,
        usuario_id: usuarioId,
        precio: Number(precio),
        estado: "en_curso",
        etapa: "Preparando el envío…",
        creada_en: ahora,
        actualizada_en: ahora,
        terminada_en: null,
        cancelacion_solicitada_en: null,
        motivo: null,
        mensaje_error: null,
        aviso: null,
        anuncio,
        grupos: grupos.map(g => ({ grupo_id: g.grupo_id, nombre: g.nombre || null, tipo: g.tipo || "compartir", estado: "en_cola", error: null, actualizado_en: ahora }))
    };
    registro.set(id, op);
    return op;
}

const interna = (usuarioId, id) => {
    const op = registro.get(id);
    return op && op.usuario_id === usuarioId ? op : null;
};

function vista(op) {
    if (!op) return null;
    const cuenta = (e) => op.grupos.filter(g => g.estado === e).length;
    const total = op.grupos.length;
    const enviados = cuenta("enviado");
    const fallidos = cuenta("error");
    const cancelados = cuenta("cancelado");
    const terminados = enviados + fallidos + cancelados;
    return {
        id: op.id,
        precio: op.precio,
        estado: op.estado,
        etapa: op.etapa,
        terminada: TERMINALES_OPERACION.has(op.estado),
        cancelacion_solicitada: Boolean(op.cancelacion_solicitada_en),
        cancelacion_solicitada_en: op.cancelacion_solicitada_en,
        creada_en: op.creada_en,
        actualizada_en: op.actualizada_en,
        terminada_en: op.terminada_en,
        motivo: op.motivo,
        mensaje_error: op.mensaje_error,
        aviso: op.aviso,
        mensaje: op.anuncio ? { texto: op.anuncio.texto, activo: op.anuncio.activo !== false, revision: op.anuncio.revision ?? null, origen: op.anuncio.origen || null } : null,
        totales: {
            total,
            enviados,
            fallidos,
            cancelados,
            en_curso: op.grupos.filter(g => g.estado === "preparando" || g.estado === "enviando").length,
            pendientes: total - terminados,
            porcentaje: total ? Math.round((terminados / total) * 100) : 100
        },
        grupos: op.grupos.map(g => ({ ...g }))
    };
}

function obtener(usuarioId, id) {
    return vista(interna(usuarioId, id));
}

// Operación en curso (no terminada) del cliente para esa tabla, o null.
function activaDe(usuarioId, precio) {
    for (const op of registro.values()) {
        if (op.usuario_id === usuarioId && op.precio === Number(precio) && !TERMINALES_OPERACION.has(op.estado)) return vista(op);
    }
    return null;
}

// Operaciones del cliente (más recientes primero), opcionalmente de un precio.
function listar(usuarioId, { precio = null } = {}) {
    purgar();
    return [...registro.values()]
        .filter(o => o.usuario_id === usuarioId && (precio == null || o.precio === Number(precio)))
        .sort((a, b) => b.creada_en.localeCompare(a.creada_en))
        .map(vista);
}

// Idempotente: repetirla devuelve el mismo estado. Una operación ya
// terminada no cambia (lo enviado, enviado está).
function cancelar(usuarioId, id) {
    const op = interna(usuarioId, id);
    if (!op) return { ok: false, motivo: "no_encontrada" };
    if (TERMINALES_OPERACION.has(op.estado)) return { ok: true, ya_terminada: true, data: vista(op) };
    const ya = Boolean(op.cancelacion_solicitada_en);
    if (!ya) {
        op.cancelacion_solicitada_en = ahoraIso();
        op.estado = "cancelando";
        op.etapa = "Cancelando: no se empezará ningún grupo más. El que ya se está enviando termina y se informa.";
        op.actualizada_en = op.cancelacion_solicitada_en;
    }
    return { ok: true, ya_solicitada: ya, data: vista(op) };
}

const cancelada = (op) => Boolean(op?.cancelacion_solicitada_en);

function marcarGrupo(op, grupoId, estado, { error = null, detalle = null } = {}) {
    const g = op.grupos.find(x => x.grupo_id === grupoId);
    if (!g || TERMINALES_GRUPO.has(g.estado)) return;
    g.estado = estado;
    g.error = error;
    if (detalle) g.detalle = detalle;
    g.actualizado_en = ahoraIso();
    op.actualizada_en = g.actualizado_en;
}

function etapa(op, texto) {
    if (op.cancelacion_solicitada_en) return;
    op.etapa = texto;
    op.actualizada_en = ahoraIso();
}

// Cierra la operación. Grupos sin resultado: cancelados si se pidió
// cancelar; si no, error con `motivoSinEnvio` (nunca quedan «en cola»).
function terminar(op, { motivo = null, mensaje = null, aviso = null, motivoSinEnvio = "No se envió a este grupo." } = {}) {
    for (const g of op.grupos) {
        if (TERMINALES_GRUPO.has(g.estado)) continue;
        if (op.cancelacion_solicitada_en) marcarGrupo(op, g.grupo_id, "cancelado");
        else marcarGrupo(op, g.grupo_id, "error", { error: mensaje || motivoSinEnvio });
    }
    const hay = (e) => op.grupos.some(g => g.estado === e);
    op.estado = motivo && !hay("enviado") && !hay("cancelado") ? "fallida"
        : hay("cancelado") ? "cancelada"
            : hay("error") ? "con_errores"
                : "completada";
    op.motivo = motivo;
    op.mensaje_error = mensaje;
    op.aviso = aviso;
    const enviados = op.grupos.filter(g => g.estado === "enviado").length;
    op.etapa = op.estado === "cancelada"
        ? `Envío cancelado. Se publicó en ${enviados} de ${op.grupos.length} grupo(s); lo ya publicado no se retira de WhatsApp.`
        : op.estado === "fallida" ? (mensaje || "No se pudo completar el envío.")
            : `Terminado: publicado en ${enviados} de ${op.grupos.length} grupo(s).`;
    op.terminada_en = ahoraIso();
    op.actualizada_en = op.terminada_en;
    return vista(op);
}

// Solo pruebas.
function _reiniciar() { registro.clear(); }

module.exports = { crear, obtener, activaDe, listar, cancelar, cancelada, marcarGrupo, etapa, terminar, vista, interna, _reiniciar, TERMINALES_OPERACION };
