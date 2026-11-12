// ==========================================================================
// sorteos/gruposSorteo.js — GRUPOS de un sorteo del panel (04/11/2026).
//
// Una sola fuente de verdad para «a qué grupos pertenece este sorteo»: las
// filas de sorteos_programados_grupos de su programación. La usan IGUAL:
//   - «Editar» del sorteo activo (sorteosActivos.editar),
//   - «Cambiar grupos» de Tablas (routes/tablas.js: guardar y compartir),
//   - el publicador, que es el ÚNICO que activa el sorteo en un grupo.
//
// cambiarGrupos: solo GUARDA la asociación, nunca publica.
//   - grupo nuevo   → fila 'pendiente' (el MISMO sorteo: misma identidad,
//                     tabla y números; no se crea otro sorteo ni otra tabla);
//   - grupo quitado → deja de ser destino: si aún no se publicó, 'cancelado';
//                     si el sorteo ya estaba activo ahí, se DESACTIVA en ese
//                     grupo con la acción existente de Eventos («Desactivar
//                     en este grupo»: sin reservas, recordatorios ni avisos
//                     nuevos; reservas, pagos e historia se conservan);
//   - los demás grupos no se tocan.
// También copia la selección a los destinos de «Compartir» de la tabla del
// precio (destinos_compartir_tabla), para que Tablas use los mismos grupos.
//
// publicarGruposNuevos: publica AHORA solo en los grupos 'pendiente' (y los
// que quedaron en error) de un sorteo que ya se publicó, con el publicador
// de siempre (publicador.tick con sorteoId): crea el evento del grupo con la
// identidad del sorteo, lo abre y envía el anuncio una vez (ExecutionGuard).
// Los grupos ya publicados nunca se reclaman, así que no reciben nada.
// ==========================================================================

const repo = require("./repo");

const falla = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

// Estados de una programación que ya publicó (o lo intentó) en algún grupo.
const ESTADOS_PUBLICADOS = ["publicando", "publicado", "publicado_parcial", "fallido"];
const QUITADO = "Quitado de los grupos del sorteo por el administrador.";

const reloj = { ahora: () => new Date() };

// Dependencias sustituibles en las pruebas.
const deps = {
    socketDe: (usuarioId) => require("../services/baileys/manager").getSocketActivoDe(usuarioId),
    puedeActuar: (sock) => require("../services/baileys/propiedadSesion").puedeActuar(sock),
    publicadorDeps: null
};

const vigentes = (grupos) => grupos.filter(g => g.estado !== "cancelado");

function normalizar(grupos) {
    const destinos = require("../services/destinosCompartir");
    return destinos.normalizarGrupos(grupos);
}

// Fila REAL del sorteo en el grupo (por identidad: evento_bot_id puede
// apuntar a una fila reutilizada por otro sorteo).
async function eventoDelGrupo(usuarioId, sorteo, grupoId) {
    const { consultarEventoDelSorteo } = require("../bot/funciones/eventos/consultarEvento");
    return consultarEventoDelSorteo(grupoId, usuarioId, sorteo.identidad_evento_real);
}

// ¿El sorteo está (o estuvo) activo en este grupo? Lee eventos_bot.
async function estadoEnGrupo(usuarioId, sorteo, g) {
    if (!sorteo.identidad_evento_real) return { ok: true, fila: null };
    const r = await eventoDelGrupo(usuarioId, sorteo, g.grupo_id);
    if (!r.ok) return { ok: false };
    return { ok: true, fila: r.data };
}

// Copia best-effort a los destinos de «Compartir» de la tabla del precio.
async function sincronizarDestinos(usuarioId, sorteo, ids) {
    try {
        const destinos = require("../services/destinosCompartir");
        const r = await destinos.guardarDestinos(usuarioId, Number(sorteo.config?.valor), ids);
        return r.ok ? null : (r.motivo === "migracion_pendiente" ? null : "No se pudo copiar la selección a los grupos de «Compartir» de la tabla.");
    } catch {
        return "No se pudo copiar la selección a los grupos de «Compartir» de la tabla.";
    }
}

// grupos: ids de WhatsApp elegidos (la selección COMPLETA).
async function cambiarGrupos(usuarioId, sorteoId, grupos, { origen = "panel" } = {}) {

    const ids = normalizar(grupos);
    if (!ids) return falla("grupos_invalidos", { mensaje: "La selección de grupos no es válida." });
    if (!ids.length) return falla("sin_grupos", { mensaje: "Elige al menos un grupo. Para retirar el sorteo de todos, usa Eventos." });

    const actual = await repo.obtenerSorteo(usuarioId, sorteoId);
    if (!actual.ok) return actual;
    const sorteo = actual.data;

    if (sorteo.estado === "cancelado") return falla("estado_invalido", { estado: "cancelado", mensaje: "El sorteo está cancelado." });
    if (sorteo.archivado_en) return falla("estado_invalido", { estado: "archivado", mensaje: "El sorteo está archivado." });

    // Solo grupos autorizados y activos del cliente (los del formulario).
    const autorizados = await repo.gruposAutorizados(usuarioId);
    if (!autorizados.ok) return falla("error_grupos");
    const porId = new Map(autorizados.data.map(g => [g.grupo_id, g]));
    const ajenos = ids.filter(id => !porId.has(id));
    if (ajenos.length) return falla("destinos_no_disponibles", { invalidos: ajenos, mensaje: "Alguno de los grupos ya no está autorizado o activo." });

    const filas = sorteo.grupos;
    const actuales = vigentes(filas);
    const agregar = ids.filter(id => !actuales.some(g => g.grupo_id === id));
    const quitar = actuales.filter(g => !ids.includes(g.grupo_id));

    // Un grupo que se está publicando en este instante no se puede quitar.
    const enCurso = quitar.filter(g => g.estado === "publicando");
    if (enCurso.length) return falla("publicando", { mensaje: `Se está publicando ahora en ${enCurso.map(g => g.grupo_nombre || g.grupo_id).join(", ")}: espera a que termine.` });

    if (!agregar.length && !quitar.length) {
        return { ok: true, data: { agregados: [], quitados: [], desactivados: [], sin_cambios: actuales.length, avisos: [], sorteo, por_publicar: 0, se_publicara_a_su_hora: false } };
    }

    // Misma regla que «Editar» antes de publicar (servicio.editar, D3): con
    // reservas anticipadas no se cambian los grupos de un sorteo sin publicar.
    if (!ESTADOS_PUBLICADOS.includes(sorteo.estado)) {
        const reservasAnticipadas = require("./reservasAnticipadas");
        const a = await reservasAnticipadas.anticipadasDelSorteo(usuarioId, sorteo);
        if (!a.ok) return falla("error_supabase");
        if (a.total) return falla("reservas_anticipadas", { cantidad: a.total, mensaje: `No se pueden cambiar los grupos: el sorteo tiene ${a.total} reserva(s) anticipada(s). Libéralas antes desde Tablas o conserva los grupos.` });
    }

    const resultado = { agregados: [], quitados: [], desactivados: [], sin_cambios: actuales.length - quitar.length, avisos: [] };

    // ---- agregar: el MISMO sorteo, fila pendiente (no publica).
    for (const id of agregar) {

        const nombre = porId.get(id)?.nombre || null;
        const previa = filas.find(g => g.grupo_id === id);

        if (previa) {
            // Ya tuvo este sorteo y se quitó. Si el sorteo sigue registrado
            // en el grupo como terminado (se desactivó), volver a ponerlo es
            // reabrirlo: eso se decide en Eventos, no aquí.
            const e = await estadoEnGrupo(usuarioId, sorteo, previa);
            if (!e.ok) return falla("error_supabase", { mensaje: "No se pudo comprobar el sorteo en el grupo; no se cambió nada más.", resultado });
            if (e.fila && e.fila.activo !== true) {
                resultado.avisos.push(`${nombre || id}: este sorteo ya estuvo en el grupo y se desactivó. Para volver a activarlo, reábrelo en Eventos.`);
                continue;
            }
            const r = await repo.marcarGrupoSi(usuarioId, previa.id, ["cancelado"], {
                estado: e.fila?.activo ? "publicado" : "pendiente",
                ultimo_error: null,
                intentos: 0,
                grupo_nombre: nombre || previa.grupo_nombre || null,
                // Una nueva solicitud de envío: la anterior pudo quedar registrada.
                reintentos_manuales: (Number(previa.reintentos_manuales) || 0) + (e.fila?.activo ? 0 : 1)
            });
            if (!r.ok) return falla("error_supabase", { resultado });
            resultado.agregados.push({ grupo_id: id, nombre, estado: e.fila?.activo ? "publicado" : "pendiente" });
            continue;
        }

        const r = await repo.agregarGrupo(usuarioId, sorteoId, { grupo_id: id, nombre });
        if (!r.ok) return falla("error_supabase", { resultado });
        resultado.agregados.push({ grupo_id: id, nombre, estado: "pendiente" });

    }

    // ---- quitar: deja de ser destino; lo publicado se desactiva SOLO ahí.
    for (const g of quitar) {

        const e = await estadoEnGrupo(usuarioId, sorteo, g);
        if (!e.ok) return falla("error_supabase", { mensaje: "No se pudo comprobar el sorteo en el grupo; no se cambió nada más.", resultado });

        // Publicación COMPARTIDA (K3, F4-F.1): si en este grupo la publicó OTRA
        // programación del mismo sorteo, el evento es de ella: quitar el grupo
        // de ESTA programación no lo desactiva (solo deja de ser su destino).
        const deOtra = e.fila?.activo === true &&
            (await require("./publicacionCompartida").gruposAdoptados(require("../lib/supabase"), sorteo, [g])).has(g.grupo_id);

        if (e.fila?.activo === true && !deOtra) {
            const gestion = require("./gestionEventos");
            const d = await gestion.aplicar(usuarioId, e.fila.id, { accion: "desactivar", alcance: "grupo" });
            if (!d.ok) return falla("error_desactivar", { mensaje: `No se pudo desactivar el sorteo en ${g.grupo_nombre || g.grupo_id}: ${d.mensaje || d.motivo}`, resultado });
            resultado.desactivados.push({ grupo_id: g.grupo_id, nombre: g.grupo_nombre || null, evento_id: e.fila.id });
        }

        // La fila de la programación conserva su historia (publicado_en,
        // intentos, evento) y solo deja de ser destino.
        await repo.marcarGrupoSi(usuarioId, g.id, [g.estado, "cancelado"], { estado: "cancelado", ultimo_error: QUITADO });
        resultado.quitados.push({ grupo_id: g.grupo_id, nombre: g.grupo_nombre || null, estaba: g.estado });

    }

    const aviso = await sincronizarDestinos(usuarioId, sorteo, ids);
    if (aviso) resultado.avisos.push(aviso);

    await repo.registrarHistorial(usuarioId, sorteoId, "cambiar_grupos", "hecho", {
        origen,
        agregados: resultado.agregados.map(g => g.nombre || g.grupo_id),
        quitados: resultado.quitados.map(g => g.nombre || g.grupo_id)
    });

    // Lo que queda por publicar en un sorteo que ya se publicó: se hace con
    // publicarGruposNuevos (nunca al guardar). Si aún no se publicó, a su hora.
    const final = await repo.obtenerSorteo(usuarioId, sorteoId);
    if (!final.ok) return final;
    const pendientes = final.data.grupos.filter(g => g.estado === "pendiente").length;

    return {
        ok: true,
        data: {
            ...resultado,
            sorteo: final.data,
            por_publicar: ESTADOS_PUBLICADOS.includes(final.data.estado) ? pendientes : 0,
            se_publicara_a_su_hora: !ESTADOS_PUBLICADOS.includes(final.data.estado) && pendientes > 0
        }
    };

}

// Estado por grupo, en el idioma del panel.
function resumen(sorteo) {
    const grupos = vigentes(sorteo.grupos).map(g => ({ grupo_id: g.grupo_id, nombre: g.grupo_nombre || null, estado: g.estado, error: g.ultimo_error || null }));
    const cuenta = (e) => grupos.filter(g => g.estado === e).length;
    return { sorteo_id: sorteo.id, estado: sorteo.estado, publicados: cuenta("publicado"), pendientes: cuenta("pendiente") + cuenta("publicando"), fallidos: cuenta("fallido"), en_revision: cuenta("requiere_revision"), grupos };
}

// imagen: captura PNG que el panel hizo de la tabla (Buffer ya validado
// desde «Compartir», o data URL desde «Editar»), opcional. Se guarda como LA
// imagen del sorteo (capturaProgramada.js) con la huella de la tabla de
// ESTE momento (o la enviada, que debe coincidir); el publicador la usa como
// en cualquier publicación. Sin ella, la ya guardada si la tabla no cambió.
// Opcionales (operaciones de «Compartir», 04/11 — no cambian qué se publica
// ni cuándo):
//   - anuncio: { texto, activo } instantánea del mensaje aprobado para ESTA
//     operación (sale de la misma fuente, destinosCompartir.textoParaCompartir);
//     así una edición posterior no cambia una publicación ya en curso.
//   - observar: { alPreparar(grupoId), alEnviar(grupoId) } progreso real.
async function publicarGruposNuevos(usuarioId, sorteoId, { imagen = null, huella = null, anuncio = null, observar = null } = {}) {

    const actual = await repo.obtenerSorteo(usuarioId, sorteoId);
    if (!actual.ok) return actual;
    const sorteo = actual.data;

    if (sorteo.archivado_en || sorteo.estado === "cancelado") return falla("estado_invalido", { estado: sorteo.estado, mensaje: "El sorteo no está vigente." });
    if (!ESTADOS_PUBLICADOS.includes(sorteo.estado)) {
        return falla("aun_no_publicado", { mensaje: "El sorteo todavía no se ha publicado: los grupos nuevos se publicarán con él, a su hora." });
    }

    const nuevos = sorteo.grupos.filter(g => g.estado === "pendiente");
    if (!nuevos.length) return { ok: true, data: { ...resumen(sorteo), nada_que_publicar: true } };

    const sock = deps.socketDe(usuarioId);
    if (!sock) return falla("sin_sesion_activa");
    if (!deps.puedeActuar(sock)) return falla("sesion_no_disponible");

    if (imagen) {
        const capturas = require("./capturaProgramada");
        const png = Buffer.isBuffer(imagen) ? imagen : require("../services/destinosCompartir").imagenPng(imagen);
        if (!png) return falla("imagen_invalida", { mensaje: "La imagen de la tabla no es un PNG válido: no se publicó nada." });
        const actualHuella = await capturas.huellaActual(sorteo);
        if (huella && huella !== actualHuella) {
            return falla("tabla_cambiada", { mensaje: "La tabla cambió mientras preparabas la publicación (reservas o pagos nuevos). Vuelve a intentarlo para capturar la imagen actual." });
        }
        try {
            await capturas.guardar(sorteoId, { version: Number(sorteo.confirmado_version), huella: actualHuella, png, origen: "grupos_nuevos" });
        } catch (err) {
            console.error("❌ [GRUPOS DEL SORTEO] no se pudo guardar la imagen:", err?.message);
            return falla("error_imagen", { mensaje: "No se pudo guardar la imagen de la tabla en el servidor: no se publicó nada. Inténtalo de nuevo." });
        }
    }

    // El sorteo vuelve a «publicando» para que el publicador lo tome; al
    // terminar, finalizarSorteo deja su estado real.
    if (sorteo.estado !== "publicando") {
        await repo.actualizarSorteoSi(usuarioId, sorteoId, { estados: ["publicado", "publicado_parcial", "fallido"] }, { estado: "publicando" });
    }

    const publicador = require("./publicador");
    let d = deps.publicadorDeps;
    if (anuncio || observar) {
        const base = d || publicador.dependenciasReales();
        const avisar = (fn, grupoId) => { try { fn?.(grupoId); } catch { /* solo progreso */ } };
        d = {
            ...base,
            ...(anuncio ? { textoParaCompartir: async () => ({ ok: true, origen: "sorteo", texto: anuncio.activo === false ? "" : anuncio.texto, activo: anuncio.activo !== false }) } : {}),
            ...(observar ? {
                guardarEvento: async (args) => { avisar(observar.alPreparar, args?.grupoId); return base.guardarEvento(args); },
                compartirEnGrupos: async (args) => { avisar(observar.alEnviar, args?.grupos?.[0]?.grupo_id); return base.compartirEnGrupos(args); }
            } : {})
        };
    }

    try {
        await publicador.tick(sock, { ahora: reloj.ahora(), deps: d, sorteoId });
    } catch (err) {
        console.error("❌ [GRUPOS DEL SORTEO] error al publicar en los grupos nuevos:", err?.message);
    }

    const final = await repo.obtenerSorteo(usuarioId, sorteoId);
    if (!final.ok) return final;

    const hechos = final.data.grupos.filter(g => nuevos.some(n => n.id === g.id));
    await repo.registrarHistorial(usuarioId, sorteoId, "publicar_grupos_nuevos", hechos.every(g => g.estado === "publicado") ? "ok" : "parcial", {
        grupos: hechos.map(g => ({ grupo: g.grupo_nombre || g.grupo_id, estado: g.estado, error: g.ultimo_error || null }))
    });

    return { ok: true, data: { ...resumen(final.data), publicados_ahora: hechos.filter(g => g.estado === "publicado").map(g => g.grupo_id) } };

}

// ------------------------------------------------ sorteo detectado (04/11) ---
// Un sorteo DETECTADO en WhatsApp no tiene programación: sus grupos solo
// existen como filas de eventos_bot. Para agregarlo a otros grupos con el
// mismo flujo (publicador), el administrador lo pasa EXPLÍCITAMENTE a
// gestionarse desde el panel: se crea su programación con la MISMA
// identidad (identidad_evento_real), tabla y datos del evento, y sus grupos
// actuales se registran como ya publicados (con su evento). No se crea otro
// sorteo, ni se toca eventos_bot, la tabla, las reservas o el historial, ni
// se envía nada. Sin recordatorios ni aviso de cierre propios: sigue usando
// los generales del grupo (prioridadComunicaciones). Idempotente.
//
// cuentas: las cuentas de pago del anuncio que recibirán los grupos nuevos
// (un sorteo detectado no las guarda).
async function vincularSorteoDetectado(usuarioId, eventoId, { cuentas } = {}) {

    const supabase = require("../lib/supabase");
    const sorteosActivos = require("./sorteosActivos");
    const { consolidarMensajes } = require("./mensajes");
    const tablasCliente = require("../bot/funciones/eventos/tablasCliente");
    const { finDelEvento } = require("../shared/eventos/estadosGestion");

    const v = await sorteosActivos.obtener(usuarioId, eventoId);
    if (!v.ok) return v;
    const activo = v.data;

    // Ya tiene programación vigente: nada que crear.
    const previa = await programacionDeIdentidad(usuarioId, activo.identidad);
    if (previa) return { ok: true, data: { sorteo_programado_id: previa.id, ya_existia: true } };
    if (!activo.identidad) return falla("sin_identidad", { mensaje: "Este sorteo no tiene identidad registrada: no se puede gestionar desde el panel." });

    const ids = [...new Set((Array.isArray(cuentas) ? cuentas : []).map(String))];
    if (!ids.length) return falla("validacion", { errores: [{ campo: "cuentas", mensaje: "Elige al menos una cuenta de pago: irán en el anuncio de los grupos nuevos." }] });
    const cuentasActivas = await repo.cuentasActivasPorId(usuarioId, ids);
    if (!cuentasActivas.ok) return cuentasActivas;
    if (cuentasActivas.data.length !== ids.length) return falla("validacion", { errores: [{ campo: "cuentas", mensaje: "Alguna cuenta de pago no existe o está inactiva." }] });

    // La tabla del sorteo debe ser la configurada hoy para su precio (la que
    // usará el publicador): si no, se dice y no se crea nada.
    // Motor único de rifas (12/11/2026): la programación hereda la RIFA del
    // sorteo detectado (eventos_bot.tabla_id); sin ella no se crea nada (la
    // 054 rechaza en la base cualquier programación sin rifa).
    let conf;
    if (require("../rifas/motor").motorNuevo()) {
        if (!activo.tabla_id) return falla("tabla_distinta", { mensaje: "Este sorteo no tiene una tabla (rifa) asignada: asígnala en Tablas antes de gestionarlo desde el panel." });
        let rifa;
        try {
            rifa = await require("../rifas/numerosSorteo").rifaDe(usuarioId, { tablaId: activo.tabla_id });
        } catch (e) {
            return falla("error_supabase", { error: e.message });
        }
        if (!rifa || Number(rifa.precio) !== Number(String(activo.valor).replace(/[^0-9]/g, ""))) {
            return falla("tabla_distinta", { mensaje: `La tabla (rifa) de este sorteo ya no existe o no es de $${activo.valor}: no se puede gestionar desde el panel.` });
        }
        conf = { tabla: activo.tabla, cifras: rifa.cifras, cantidad: rifa.cantidad };
    } else {
        conf = await tablasCliente.obtenerConfiguracionCliente(usuarioId, activo.valor);
        if (!conf || conf.tabla !== activo.tabla) return falla("tabla_distinta", { mensaje: `La tabla configurada para $${activo.valor} ya no es la de este sorteo (${activo.tabla}): no se puede gestionar desde el panel.` });
    }

    // Todas las filas ACTIVAS del sorteo (sus grupos), por identidad.
    const { data: filas, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", activo.identidad).eq("activo", true);
    if (error) return falla("error_supabase");
    const vivas = (filas || []).filter(f => !finDelEvento(f) && f.grupo_id);
    if (!vivas.length) return falla("estado_invalido", { mensaje: "El sorteo ya no está activo en ningún grupo." });

    const ahora = reloj.ahora();
    const snapshot = ids.map(i => cuentasActivas.data.find(c => c.id === i))
        .map(({ id, nombre, tipo, titular, numero, instrucciones }) => ({ id, nombre, tipo, titular, numero, instrucciones }));
    // El texto que ya guardó el panel para este sorteo detectado (o ninguno:
    // la plantilla por defecto con los datos del evento).
    const mensajes = consolidarMensajes({
        publicacion: activo.publicacion || "",
        aviso_cierre: "",
        ...(activo.publicacion_meta?.estilo ? { publicacion_meta: { estilo: activo.publicacion_meta.estilo } } : {})
    }, null, { ahora });
    // Nunca después de este momento: el publicador solo toma programaciones
    // con publicar_en ya cumplido (un reloj desfasado la dejaría fuera).
    const primera = vivas.map(f => f.creado_en).filter(Boolean).map(x => new Date(x)).sort((a, b) => a - b)[0];
    const inicio = (primera && primera.getTime() <= ahora.getTime() ? primera : ahora).toISOString();

    const config = {
        modalidad: activo.cifras === 3 ? "tres_cifras" : "dos_cifras",
        nombre: activo.nombre,
        loteria_id: null,
        hora_fin: activo.hora_fin ? String(activo.hora_fin).slice(0, 5) : null,
        hora_cierre: activo.hora_cierre ? String(activo.hora_cierre).slice(0, 5) : null,
        valor: activo.valor,
        premios: activo.premios,
        grupos: vivas.map(f => f.grupo_id),
        cuentas: ids,
        publicar_en: new Date(inicio).toISOString(),
        fecha_sorteo: activo.fecha_evento,
        tabla: { reiniciar: false, liberar_bloqueados: false },
        diseno: null,
        sustituir_activo: false,
        // Sin ciclo automático: solo se publica cuando el administrador lo pide.
        publicacion_inmediata: true,
        mensajes,
        recordatorios: [],
        reservas: { liberar_no_pagados: false, vencimiento_minutos: null },
        cantidad_numeros: activo.cantidad_numeros,
        origen: "whatsapp",
        evento_origen_id: activo.id
    };

    const creado = await repo.crearSorteo(usuarioId, {
        config,
        cuentas_snapshot: snapshot,
        plantilla_id: null,
        tabla: activo.tabla,
        tabla_id: activo.tabla_id ?? null,
        cifras: conf.cifras,
        cantidad_numeros: activo.cantidad_numeros || conf.cantidad,
        publicar_en: config.publicar_en,
        identidad_evento_real: activo.identidad,
        estado: "publicado",
        version: 1,
        confirmado_version: 1,
        confirmado_en: ahora.toISOString()
    });
    if (!creado.ok) return creado;

    // Dos peticiones a la vez: gana la programación más antigua; la otra se
    // anula (no se borra) y se devuelve la ganadora.
    const todas = await supabase.from("sorteos_programados").select("id, creado_en")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", activo.identidad).neq("estado", "cancelado")
        .order("creado_en", { ascending: true });
    const ganadora = (todas.data || [])[0];
    if (ganadora && ganadora.id !== creado.data.id) {
        await repo.actualizarSorteoSi(usuarioId, creado.data.id, {}, { estado: "cancelado" });
        return { ok: true, data: { sorteo_programado_id: ganadora.id, ya_existia: true } };
    }

    // Sus grupos actuales: ya publicados, con su evento (nada se reenvía).
    const ins = await repo.insertarGrupos(usuarioId, creado.data.id, vivas.map(f => ({
        grupo_id: f.grupo_id, grupo_nombre: f.grupo_nombre || null, estado: "publicado",
        evento_bot_id: f.id, publicado_en: f.creado_en || inicio, intentos: 0
    })));
    if (!ins.ok) {
        await repo.actualizarSorteoSi(usuarioId, creado.data.id, {}, { estado: "cancelado" });
        return falla("error_supabase", { mensaje: "No se pudieron registrar los grupos del sorteo; no se cambió nada." });
    }

    await repo.registrarHistorial(usuarioId, creado.data.id, "vincular_detectado", "hecho", {
        evento_id: activo.id, identidad: activo.identidad, grupos: vivas.map(f => f.grupo_nombre || f.grupo_id)
    });

    return { ok: true, data: { sorteo_programado_id: creado.data.id, ya_existia: false } };

}

// Programación del panel a la que pertenece un sorteo activo (por identidad).
async function programacionDeIdentidad(usuarioId, identidad) {
    if (!identidad) return null;
    const supabase = require("../lib/supabase");
    // select("*"): archivado_en solo existe con la 038; pedirlo por nombre
    // sin ella daría error y todos los sorteos parecerían «sin programación».
    const { data, error } = await supabase.from("sorteos_programados").select("*")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", identidad).neq("estado", "cancelado")
        .order("creado_en", { ascending: false }).limit(10);
    // Falla cerrado: sin poder leerlo no se decide (ni se crea otra).
    if (error) throw new Error(`No se pudo leer la programación del sorteo: ${error.message}`);
    // Criterio único (F4-F.1): la más reciente, salvo una adoptante pura.
    const p = await require("./publicacionCompartida").elegirProgramacion(supabase, usuarioId, data);
    return p && !p.archivado_en ? { id: p.id, estado: p.estado, archivado_en: p.archivado_en || null } : null;
}

module.exports = { cambiarGrupos, publicarGruposNuevos, vincularSorteoDetectado, programacionDeIdentidad, resumen, deps, reloj, ESTADOS_PUBLICADOS };
