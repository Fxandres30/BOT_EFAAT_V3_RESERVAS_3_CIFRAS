// ==========================================================================
// sorteos/sorteosActivos.js — el sorteo ACTIVO de una tabla, venga de donde
// venga: detectado por el bot en un grupo o creado desde el panel y ya
// publicado. Los dos viven en eventos_bot (guardarEvento.js): una fila por
// grupo y cliente, unidas por identidad_evento_real.
//
// Antes el panel solo miraba sorteos_programados, así que un sorteo
// detectado por el bot no se podía abrir ni editar desde Tablas.
//
// Relación de campos (auditoría 22/10):
//   - usuario_id: dueño (el de la sesión de WhatsApp que lo detectó o
//     publicó). Es el ÚNICO filtro de propiedad; sale siempre del token.
//   - session_id: solo informativo (qué WhatsApp lo guardó).
//   - grupo_id: una fila por grupo; varias filas con la misma identidad son
//     el MISMO sorteo (comparten la cuadrícula de números).
//   - valor -> tabla física según tablas_cliente del cliente.
//   - activo/estado: activo=true y estado distinto de "cerrado".
//
// Qué se puede editar con el sorteo en curso (y por qué el resto no):
//   - nombre/lotería, fecha, hora del sorteo y valor forman las identidades
//     del sorteo: identidad_evento_real (con ella se guardan reservas y
//     pagos) e identidad del ciclo del scheduler (mensajes por grupo).
//     Cambiarlos separaría reservas o repetiría mensajes: BLOQUEADOS.
//   - tabla y cantidad de números: nunca con el sorteo en curso.
//   - grupos: añadir o quitar publicaría o retiraría el sorteo: BLOQUEADO.
//   - premios y cierre de reservas: editables (validados).
//   - cuentas de pago y estilo de la tabla: solo si el sorteo nació en el
//     panel (los detectados no los guardan).
//   - texto de la publicación (el que acompaña al anuncio): editable.
//     Panel: config.mensajes.publicacion del sorteo programado (el mismo
//     campo del formulario de creación). Detectado: el bot NO guarda el
//     texto del anuncio de WhatsApp, así que se guarda aparte en
//     eventos_bot.publicacion_panel (migración 036) con la identidad del
//     sorteo: la fila de un grupo se reutiliza en el sorteo siguiente y
//     un texto de otra identidad no se muestra. Solo informativo.
// Nada de esto toca la tabla de números ni envía mensajes.
//
// Límite conocido: si el administrador vuelve a publicar el anuncio en el
// grupo, el detector toma otra vez premios y cierre del texto del anuncio.
// ==========================================================================

const supabase = require("../lib/supabase");
const repo = require("./repo");
const tablasCliente = require("../bot/funciones/eventos/tablasCliente");
const { normalizarPremios, instanteBogota, partesBogota, HORA, texto, LIMITES } = require("./validar");

// Columna inexistente (migración 036 sin aplicar), en Postgres o PostgREST.
const SIN_COLUMNA = new Set(["42703", "PGRST204"]);

const MOTIVO_IDENTIDAD = "Forma la identidad del sorteo en curso: con ella se guardan sus reservas y pagos y se programan los mensajes de cada grupo. Cambiarlo separaría las reservas existentes. Para cambiarlo, deja cerrar este sorteo y crea uno nuevo.";

const CAMPOS_BLOQUEADOS = {
    nombre: MOTIVO_IDENTIDAD,
    fecha_evento: MOTIVO_IDENTIDAD,
    hora_fin: MOTIVO_IDENTIDAD,
    valor: `${MOTIVO_IDENTIDAD} Además, el valor decide la tabla de números.`,
    tabla: "La tabla de números no cambia mientras el sorteo está en curso.",
    grupos: "Añadir o quitar grupos publicaría o retiraría el sorteo en WhatsApp; no se hace desde la edición."
};

const falla = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

const digitos = (v) => Number(String(v ?? "").replace(/[^\d]/g, "")) || null;

function abierto(e) {
    return e.activo !== false && e.estado !== "cerrado";
}

// Filas activas del cliente (opcional: solo las de ese precio y su tabla).
async function filasActivas(usuarioId, precio = null) {

    const { data, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("activo", true)
        .order("creado_en", { ascending: false });

    if (error) return { ok: false, motivo: "error_supabase", error: error.message };

    let filas = (data || []).filter(abierto);

    if (precio) {
        const config = await tablasCliente.obtenerConfiguracionCliente(usuarioId, precio);
        if (!config) return { ok: true, data: [] };
        filas = filas.filter(e => digitos(e.valor) === Number(precio) && (!e.tabla || e.tabla === config.tabla));
    }

    return { ok: true, data: filas };

}

// Clave del sorteo real (varias filas = varios grupos del mismo sorteo).
const claveDe = (e) => e.identidad_evento_real || `evento:${e.id}`;

// Texto guardado desde el panel para un sorteo detectado, solo si es de
// ESTE sorteo (la fila puede venir de uno anterior del mismo grupo).
function publicacionDetectado(filas) {
    const guardado = filas.map(f => f.publicacion_panel).find(p => p?.identidad === claveDe(filas[0]));
    return typeof guardado?.texto === "string" ? guardado.texto : "";
}

async function contarNumeros(usuarioId, tabla, identidad) {
    if (!tabla || !identidad) return { reservados: 0, pagados: 0 };
    const { data } = await supabase.from(tabla).select("estado")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", identidad);
    const filas = data || [];
    return { reservados: filas.filter(f => f.estado === "reservado").length, pagados: filas.filter(f => f.estado === "pagado").length };
}

async function sorteoProgramadoDe(usuarioId, identidad) {
    if (!identidad) return null;
    const { data } = await supabase.from("sorteos_programados").select("*")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", identidad)
        .order("creado_en", { ascending: false }).limit(1);
    return data?.[0] || null;
}

// Vista unificada de un sorteo activo para el panel.
async function vista(usuarioId, filas) {

    const base = filas[0];
    const programado = await sorteoProgramadoDe(usuarioId, base.identidad_evento_real);
    const numeros = await contarNumeros(usuarioId, base.tabla, base.identidad_evento_real);
    const desdePanel = Boolean(programado);

    return {
        id: base.id,
        origen: desdePanel ? "panel" : "detectado",
        sorteo_programado_id: programado?.id || null,
        identidad: base.identidad_evento_real || null,
        nombre: base.nombre_evento || null,
        fecha_evento: base.fecha_evento ? String(base.fecha_evento).slice(0, 10) : null,
        hora_fin: base.hora_fin || null,
        hora_cierre: base.hora_cierre || null,
        valor: digitos(base.valor),
        premios: Array.isArray(base.premios) ? base.premios : [],
        tabla: base.tabla || null,
        cantidad_numeros: base.cantidad_numeros || null,
        estado: base.estado || null,
        grupos: filas.map(f => ({ evento_id: f.id, grupo_id: f.grupo_id, grupo_nombre: f.grupo_nombre || null, abierto: f.abierto !== false })),
        reservados: numeros.reservados,
        pagados: numeros.pagados,
        // Solo los sorteos del panel guardan cuentas y estilo propios.
        cuentas: desdePanel ? (programado.cuentas_snapshot || []) : null,
        cuentas_ids: desdePanel ? (programado.config?.cuentas || []) : null,
        diseno: desdePanel ? (programado.config?.diseno || null) : null,
        mensajes: desdePanel ? (programado.config?.mensajes || null) : null,
        // Texto que acompaña al anuncio ("" = no guardado: el panel usa la
        // plantilla por defecto; en un detectado, nadie lo escribió aún).
        publicacion: desdePanel ? (programado.config?.mensajes?.publicacion || "") : publicacionDetectado(filas),
        recordatorios: desdePanel ? (programado.config?.recordatorios || []) : null,
        campos: {
            ...Object.fromEntries(Object.entries(CAMPOS_BLOQUEADOS).map(([c, motivo]) => [c, { editable: false, motivo }])),
            premios: { editable: true },
            hora_cierre: { editable: true, motivo: "Debe ser posterior a este momento y no después de la hora del sorteo." },
            cuentas: desdePanel
                ? { editable: true, motivo: "Se usan en los recordatorios y avisos que falten; lo ya enviado no cambia." }
                : { editable: false, motivo: "Los sorteos detectados en el grupo no guardan cuentas de pago: siguen las del anuncio del grupo." },
            diseno: desdePanel
                ? { editable: true, motivo: "Se usa en las próximas imágenes de la tabla de este sorteo." }
                : { editable: false, motivo: "Usa el diseño de la tabla de este precio: cámbialo en Tablas → Personalizar." },
            publicacion: desdePanel
                ? { editable: true, motivo: "Guardar no envía nada y lo ya publicado en los grupos no cambia; un grupo que siga pendiente de publicar recibirá este texto. Vacío = plantilla por defecto." }
                : { editable: true, motivo: "EFAAT no guarda el texto del anuncio de WhatsApp. Lo que escribas aquí queda solo en el panel: no cambia ni reenvía el mensaje del grupo." },
            mensajes: { editable: false, motivo: desdePanel ? "Los recordatorios y el aviso de cierre de un sorteo en curso no se cambian desde aquí." : "Los sorteos detectados no tienen mensajes propios: usan los de Automatización." }
        }
    };

}

// Sorteos activos del cliente (todos, o los de un precio).
async function listar(usuarioId, { precio = null } = {}) {

    const r = await filasActivas(usuarioId, precio);
    if (!r.ok) return r;

    const grupos = new Map();
    for (const f of r.data) {
        const k = claveDe(f);
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(f);
    }

    const lista = [];
    for (const filas of grupos.values()) lista.push(await vista(usuarioId, filas));

    return { ok: true, data: lista };

}

// Filas del MISMO sorteo que el evento `id`, solo si es de este cliente.
async function filasDelEvento(usuarioId, id) {

    const { data: evento, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("id", id).maybeSingle();

    if (error) return falla("error_supabase", { error: error.message });
    if (!evento) return falla("no_encontrado");
    if (!abierto(evento)) return falla("estado_invalido", { estado: evento.estado || "cerrado", mensaje: "El sorteo ya cerró: no se puede editar." });

    if (!evento.identidad_evento_real) return { ok: true, data: [evento] };

    const { data: hermanos, error: e2 } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", evento.identidad_evento_real).eq("activo", true);

    if (e2) return falla("error_supabase", { error: e2.message });

    const filas = (hermanos || []).filter(abierto);
    return { ok: true, data: [evento, ...filas.filter(f => f.id !== evento.id)] };

}

async function obtener(usuarioId, id) {
    const r = await filasDelEvento(usuarioId, id);
    if (!r.ok) return r;
    return { ok: true, data: await vista(usuarioId, r.data) };
}

const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Edita el sorteo activo del evento `id` (y sus otros grupos).
// entrada: { premios?, hora_cierre?, cuentas?, diseno?, publicacion?, base: { premios, hora_cierre, publicacion? } }
// `base` = lo que el panel vio; si cambió entretanto, no se pisa.
async function editar(usuarioId, id, entrada = {}, { ahora = new Date(), resolverDiseno } = {}) {

    const r = await filasDelEvento(usuarioId, id);
    if (!r.ok) return r;

    const filas = r.data;
    const actual = await vista(usuarioId, filas);
    const errores = [];

    // Campos de identidad, tabla o grupos: si llegan DISTINTOS, se rechaza
    // explicando por qué (nunca se ignoran en silencio).
    const comparables = { nombre: actual.nombre, fecha_evento: actual.fecha_evento, hora_fin: actual.hora_fin, valor: actual.valor, tabla: actual.tabla, grupos: actual.grupos.map(g => g.grupo_id).sort() };
    for (const [campo, motivo] of Object.entries(CAMPOS_BLOQUEADOS)) {
        if (entrada[campo] === undefined) continue;
        const enviado = campo === "grupos" ? [...(entrada.grupos || [])].sort() : campo === "valor" ? digitos(entrada.valor) : entrada[campo];
        if (!igual(enviado, comparables[campo])) errores.push({ campo, mensaje: motivo });
    }

    const base = entrada.base || {};
    if (!igual(base.premios, actual.premios) || (base.hora_cierre ?? null) !== (actual.hora_cierre ?? null)
        || (base.publicacion !== undefined && base.publicacion !== actual.publicacion)) {
        return falla("version_cambiada", { mensaje: "El sorteo cambió desde que lo abriste (por ejemplo, EFAAT leyó de nuevo el anuncio). Vuelve a abrirlo." });
    }

    const cambiosEvento = {};

    if (entrada.premios !== undefined) {
        const premios = normalizarPremios(entrada.premios);
        if (!premios.length) errores.push({ campo: "premios", mensaje: "Agrega al menos un premio." });
        else if (!igual(premios, actual.premios)) cambiosEvento.premios = premios;
    }

    if (entrada.hora_cierre !== undefined && entrada.hora_cierre !== actual.hora_cierre) {
        const hc = String(entrada.hora_cierre || "");
        const fecha = actual.fecha_evento || partesBogota(ahora).fecha;
        const instante = HORA.test(hc) ? instanteBogota(fecha, hc) : null;
        if (!instante) errores.push({ campo: "hora_cierre", mensaje: "Hora de cierre inválida (formato HH:MM, 24 h)." });
        else if (actual.hora_fin && hc > String(actual.hora_fin).slice(0, 5)) errores.push({ campo: "hora_cierre", mensaje: "El cierre no puede ser posterior a la hora del sorteo." });
        else if (instante.getTime() <= ahora.getTime() + 60 * 1000) errores.push({ campo: "hora_cierre", mensaje: "El cierre debe ser al menos 1 minuto en el futuro: uno pasado cerraría el sorteo con reservas en curso." });
        else cambiosEvento.hora_cierre = hc;
    }

    // Cuentas y estilo: solo sorteos del panel.
    const programado = actual.sorteo_programado_id ? await repo.obtenerSorteo(usuarioId, actual.sorteo_programado_id) : null;
    const cambiosProgramado = {};

    const cuentasEnviadas = Array.isArray(entrada.cuentas) ? [...entrada.cuentas].map(String).sort() : null;
    if (entrada.cuentas !== undefined && !igual(cuentasEnviadas, [...(actual.cuentas_ids || [])].sort())) {
        if (!programado?.ok) {
            errores.push({ campo: "cuentas", mensaje: actual.campos.cuentas.motivo });
        } else {
            const ids = [...new Set(cuentasEnviadas || [])];
            const cuentas = await repo.cuentasActivasPorId(usuarioId, ids);
            if (!cuentas.ok) return cuentas;
            if (!ids.length) errores.push({ campo: "cuentas", mensaje: "Deja al menos una cuenta de pago." });
            else if (cuentas.data.length !== ids.length) errores.push({ campo: "cuentas", mensaje: "Alguna cuenta de pago no existe o está inactiva." });
            else {
                cambiosProgramado.cuentas = ids;
                cambiosProgramado.cuentas_snapshot = ids.map(i => cuentas.data.find(c => c.id === i))
                    .map(({ id: cid, nombre, tipo, titular, numero, instrucciones }) => ({ id: cid, nombre, tipo, titular, numero, instrucciones }));
            }
        }
    }

    if (entrada.diseno !== undefined && !igual(entrada.diseno, actual.diseno)) {
        if (!programado?.ok) {
            errores.push({ campo: "diseno", mensaje: actual.campos.diseno.motivo });
        } else {
            const d = await resolverDiseno(usuarioId, entrada.diseno, actual.valor);
            if (!d.ok) return d;
            if (d.error) errores.push(d.error);
            else cambiosProgramado.diseno = d.diseno;
        }
    }

    // Texto de la publicación: panel -> su config; detectado -> el evento.
    if (entrada.publicacion !== undefined) {
        const publicacion = texto(entrada.publicacion, LIMITES.mensaje);
        if (publicacion !== actual.publicacion) {
            if (programado?.ok) cambiosProgramado.publicacion = publicacion;
            else cambiosEvento.publicacion_panel = { identidad: claveDe(filas[0]), texto: publicacion, actualizado_en: new Date().toISOString() };
        }
    }

    if (errores.length) return falla("validacion", { errores });

    if (!Object.keys(cambiosEvento).length && !Object.keys(cambiosProgramado).length) {
        return { ok: true, data: actual, aviso: "No había cambios que guardar." };
    }

    // Reservas y pagos ANTES: el guardado no toca la tabla de números.
    const antes = await contarNumeros(usuarioId, actual.tabla, actual.identidad);

    if (Object.keys(cambiosEvento).length) {
        const { error } = await supabase.from("eventos_bot")
            .update({ ...cambiosEvento, actualizado_en: new Date().toISOString() })
            .eq("usuario_id", usuarioId).in("id", filas.map(f => f.id));
        if (error && SIN_COLUMNA.has(error.code) && cambiosEvento.publicacion_panel) {
            return falla("migracion_pendiente", { migracion: "036_publicacion_sorteo_detectado.sql", mensaje: "Guardar el texto de un sorteo detectado todavía no está disponible. No se guardó ningún cambio." });
        }
        if (error) return falla("error_supabase", { error: error.message });
    }

    // Sorteo del panel: su configuración sigue al evento (recordatorios y
    // aviso de cierre se calculan con ella).
    if (programado?.ok) {
        const p = programado.data;
        const config = {
            ...p.config,
            ...(cambiosEvento.premios ? { premios: cambiosEvento.premios } : {}),
            ...(cambiosEvento.hora_cierre ? { hora_cierre: cambiosEvento.hora_cierre } : {}),
            ...(cambiosProgramado.cuentas ? { cuentas: cambiosProgramado.cuentas } : {}),
            ...(cambiosProgramado.diseno ? { diseno: cambiosProgramado.diseno } : {}),
            ...(cambiosProgramado.publicacion !== undefined ? { mensajes: { ...p.config?.mensajes, publicacion: cambiosProgramado.publicacion } } : {})
        };
        const cambios = { config, ...(cambiosProgramado.cuentas_snapshot ? { cuentas_snapshot: cambiosProgramado.cuentas_snapshot } : {}) };
        const u = await repo.actualizarSorteoSi(usuarioId, p.id, {}, cambios);
        if (!u.ok) return u;
    }

    const despues = await contarNumeros(usuarioId, actual.tabla, actual.identidad);
    if (antes.reservados !== despues.reservados || antes.pagados !== despues.pagados) {
        // Solo puede deberse a reservas/pagos reales llegando a la vez (el
        // guardado no escribe en la tabla); se informa, no se revierte nada.
        console.warn("⚠️ [SORTEOS ACTIVOS] reservas/pagos cambiaron durante la edición (actividad simultánea del bot).");
    }

    return obtener(usuarioId, id);

}

module.exports = { listar, obtener, editar, CAMPOS_BLOQUEADOS };
