// ==========================================================================
// sorteos/gestionEventos.js — administración de los sorteos que YA están en
// los grupos (eventos_bot), los haya detectado el bot o publicado el panel.
//
// Antes el panel solo podía editar premios/cierre de un sorteo activo y
// administrar las PROGRAMACIONES (sorteos_programados): un sorteo en curso
// no se podía cerrar, reabrir, desactivar en un grupo, cancelar ni quitar
// de la vista; había que esperar a su cierre automático.
//
// Acciones (siempre con el usuario del token; un evento ajeno = 404):
//   cerrar      fin normal del sorteo (como el cierre por hora): deja de
//               aceptar reservas y, si hay sesión, se cierra el grupo de
//               WhatsApp (solo si no queda otro sorteo activo en él). Los
//               avisos de cierre configurados se envían como siempre.
//   reabrir     vuelve a aceptar reservas. El cierre de reservas debe estar
//               en el futuro (se puede indicar una hora nueva). Si el grupo
//               tiene otro sorteo activo, se rechaza salvo `sustituir`. El
//               grupo de WhatsApp lo abre el worker de eventos (abierto=false
//               -> reconciliación de apertura, el mecanismo de siempre).
//   desactivar  lo apaga sin anunciar nada: sin reservas, recordatorios ni
//               avisos de cierre. Sus pagos pendientes siguen siendo deuda.
//   cancelar    el sorteo no se juega (todos sus grupos): como desactivar,
//               sin deuda, y cancela sus publicaciones programadas pendientes.
//   eliminar    eliminación LÓGICA (todos sus grupos): se oculta del panel y
//               de las consultas; reservas, pagos e historial se conservan.
//
// Alcance: "grupo" (solo la fila de ese grupo; los demás grupos siguen según
// su configuración) o "todos" (todas las filas del mismo sorteo, unidas por
// identidad_evento_real). cancelar y eliminar son siempre de todo el sorteo.
//
// Nunca se cambia un número, estado de reserva ni importe: solo eventos_bot
// (y las publicaciones programadas PENDIENTES del mismo sorteo).
// ==========================================================================

const supabase = require("../lib/supabase");
const repo = require("./repo");
const { instanteBogota, HORA } = require("./validar");
const { motivoGestion, eliminado } = require("../shared/eventos/estadosGestion");

const ACCIONES = new Set(["cerrar", "reabrir", "desactivar", "cancelar", "eliminar"]);
const SIN_COLUMNA = new Set(["42703", "PGRST204"]);
// Columnas opcionales (migraciones 023 y 039): sin ellas se guarda lo básico.
const OPCIONALES = ["cierre_estado", "cierre_motivo", "cerrado_en", "cierre_intentos", "cierre_ultimo_error", "cierre_ultimo_intento_en", "archivado_en"];
const DIAS_RECIENTES = 30;

const falla = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

const nombreDe = (f) => `${f.nombre_evento || "Sorteo"} ${f.hora_fin ? String(f.hora_fin).slice(0, 5) : ""}`.trim();

// ------------------------------------------------------------- lectura ---

async function filasDelSorteo(usuarioId, eventoId) {

    const { data: evento, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("id", eventoId).maybeSingle();

    if (error) return falla("error_supabase", { error: error.message });
    if (!evento || eliminado(evento)) return falla("no_encontrado");

    if (!evento.identidad_evento_real) return { ok: true, evento, filas: [evento] };

    const { data, error: e2 } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", evento.identidad_evento_real);

    if (e2) return falla("error_supabase", { error: e2.message });

    const filas = (data || []).filter(f => !eliminado(f));
    if (!filas.some(f => f.id === evento.id)) filas.unshift(evento);

    return { ok: true, evento, filas };

}

async function contarNumeros(usuarioId, tabla, identidad) {
    if (!tabla || !identidad) return { reservados: 0, pagados: 0, ok: true };
    const { data, error } = await supabase.from(tabla).select("estado")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", identidad);
    const filas = data || [];
    return { ok: !error, reservados: filas.filter(f => f.estado === "reservado").length, pagados: filas.filter(f => f.estado === "pagado").length };
}

function estadoFila(f) {
    if (f.activo) return "en_curso";
    return motivoGestion(f) || "cerrado";
}

// Sorteos del cliente de los últimos días (activos e inactivos, nunca los
// eliminados), uno por sorteo real con el estado de CADA grupo.
async function listar(usuarioId, { ahora = new Date() } = {}) {

    const { data, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).order("creado_en", { ascending: false }).limit(300);

    if (error) return falla("error_supabase", { error: error.message });

    const limite = ahora.getTime() - DIAS_RECIENTES * 24 * 60 * 60 * 1000;
    const reciente = (f) => [f.actualizado_en, f.creado_en, f.fecha_evento]
        .some(x => x && new Date(x).getTime() >= limite);

    const grupos = new Map();
    for (const f of data || []) {
        if (eliminado(f) || !(f.activo || reciente(f))) continue;
        const k = f.identidad_evento_real || `evento:${f.id}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(f);
    }

    const lista = [];

    for (const filas of grupos.values()) {

        // Representante: la activa, si no la más reciente.
        const base = filas.find(f => f.activo) || filas[0];
        const numeros = await contarNumeros(usuarioId, base.tabla, base.identidad_evento_real);

        lista.push({
            id: base.id,
            identidad: base.identidad_evento_real || null,
            nombre: base.nombre_evento || null,
            fecha_evento: base.fecha_evento ? String(base.fecha_evento).slice(0, 10) : null,
            hora_fin: base.hora_fin || null,
            hora_cierre: base.hora_cierre || null,
            valor: Number(String(base.valor ?? "").replace(/[^\d]/g, "")) || null,
            estado: filas.some(f => f.activo) ? "en_curso" : estadoFila(base),
            reservados: numeros.reservados,
            pagados: numeros.pagados,
            grupos: filas.map(f => ({
                evento_id: f.id,
                grupo_id: f.grupo_id,
                grupo_nombre: f.grupo_nombre || null,
                estado: estadoFila(f),
                abierto_whatsapp: f.abierto !== false
            }))
        });

    }

    return { ok: true, data: lista };

}

// ------------------------------------------------------------ escritura ---

// UPDATE de UNA fila del cliente, tolerante a una base sin las columnas
// opcionales y a una restricción antigua sobre `estado` (en ese caso se
// guarda "cerrado" y el motivo real queda en cierre_motivo).
async function actualizarFila(usuarioId, id, cambios) {

    const escribir = (c) => supabase.from("eventos_bot").update(c).eq("usuario_id", usuarioId).eq("id", id);

    let { error } = await escribir(cambios);

    if (error && SIN_COLUMNA.has(error.code)) {
        const basico = Object.fromEntries(Object.entries(cambios).filter(([k]) => !OPCIONALES.includes(k)));
        ({ error } = await escribir(basico));
    }

    if (error?.code === "23514" && !["abierto", "cerrado"].includes(cambios.estado)) {
        ({ error } = await escribir({ ...cambios, estado: "cerrado" }));
    }

    return error ? { ok: false, error: error.message } : { ok: true };

}

function cambiosFin(tipo, motivo, ahora) {
    return {
        activo: false,
        estado: tipo,
        cierre_estado: "cerrado",
        cierre_motivo: motivo,
        cerrado_en: ahora.toISOString(),
        cierre_ultimo_error: null,
        actualizado_en: ahora.toISOString()
    };
}

// Publicaciones programadas PENDIENTES del mismo sorteo (identidad): en esos
// grupos ya no se publicará. Lo publicado no se toca. grupoId = solo ese.
async function detenerPublicacionesPendientes(usuarioId, identidad, grupoId = null) {

    if (!identidad) return 0;

    const { data: programas, error } = await supabase.from("sorteos_programados").select("id, estado")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", identidad);

    if (error || !programas?.length) return 0;

    let detenidas = 0;

    for (const p of programas) {

        const grupos = await repo.gruposDelSorteo(usuarioId, p.id);

        for (const g of grupos.data || []) {
            if (grupoId && g.grupo_id !== grupoId) continue;
            if (!["pendiente", "fallido"].includes(g.estado)) continue;
            const r = await repo.marcarGrupoSi(usuarioId, g.id, [g.estado], { estado: "cancelado", ultimo_error: "Detenido desde la administración del sorteo." });
            if (r.ok && r.data) detenidas++;
        }

        // Sin ningún grupo por publicar, la programación deja de estar en curso.
        if (!grupoId && ["borrador", "programado"].includes(p.estado)) {
            await repo.actualizarSorteoSi(usuarioId, p.id, { estados: ["borrador", "programado"] }, { estado: "cancelado" });
        }

    }

    return detenidas;

}

// Otros sorteos ACTIVOS del cliente en ese grupo (distinta identidad).
async function activosDelGrupo(usuarioId, grupoId, excluirIdentidad) {
    const { data, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("grupo_id", grupoId).eq("activo", true);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data || []).filter(f => f.identidad_evento_real !== excluirIdentidad || !excluirIdentidad) };
}

async function cerrarWhatsApp({ usuarioId, filas, socketDe }) {

    const sock = socketDe ? socketDe(usuarioId) : null;
    const informe = [];

    for (const f of filas) {

        if (!sock) { informe.push({ grupo_id: f.grupo_id, whatsapp: "sin_sesion" }); continue; }

        // Cualquier sorteo activo en el grupo, también de OTRA cuenta: cerrar
        // el grupo de WhatsApp le impediría recibir reservas.
        const { data: activos, error } = await supabase.from("eventos_bot").select("id")
            .eq("grupo_id", f.grupo_id).eq("activo", true);
        if (error || (activos || []).length) { informe.push({ grupo_id: f.grupo_id, whatsapp: "omitido_otro_sorteo_activo" }); continue; }

        try {
            const { cerrarGrupoDetallado } = require("../bot/funciones/eventos/grupos/cerrarGrupo");
            const r = await cerrarGrupoDetallado({ sock, grupoId: f.grupo_id });
            if (r?.ok) await actualizarFila(usuarioId, f.id, { abierto: false });
            informe.push({ grupo_id: f.grupo_id, whatsapp: r?.ok ? "cerrado" : "fallido", error: r?.ok ? null : (r?.error || null) });
        } catch (err) {
            informe.push({ grupo_id: f.grupo_id, whatsapp: "fallido", error: err?.message || String(err) });
        }

    }

    return informe;

}

// accion: cerrar | reabrir | desactivar | cancelar | eliminar
// opciones: { alcance: "grupo"|"todos", sustituir, hora_cierre, cerrar_grupo_whatsapp }
async function aplicar(usuarioId, eventoId, entrada = {}, { ahora = new Date(), socketDe = null } = {}) {

    const accion = String(entrada.accion || "");
    if (!ACCIONES.has(accion)) return falla("validacion", { errores: [{ campo: "accion", mensaje: "Acción desconocida." }] });

    const alcance = ["cancelar", "eliminar"].includes(accion) ? "todos" : (entrada.alcance === "todos" ? "todos" : "grupo");

    const r = await filasDelSorteo(usuarioId, eventoId);
    if (!r.ok) return r;

    const { evento, filas } = r;
    const identidad = evento.identidad_evento_real || null;
    const alcanzadas = alcance === "todos" ? filas : [evento];
    const resultado = { accion, alcance, grupos: [], whatsapp: [], publicaciones_detenidas: 0 };

    if (accion === "cerrar" || accion === "desactivar") {

        const objetivo = alcanzadas.filter(f => f.activo);
        if (!objetivo.length) return falla("estado_invalido", { mensaje: alcance === "grupo" ? "El sorteo ya no está activo en este grupo." : "El sorteo ya no está activo en ningún grupo." });

        const cambios = accion === "cerrar"
            ? cambiosFin("cerrado", "panel:cerrado manualmente", ahora)
            : cambiosFin("desactivado", "panel:desactivado", ahora);

        for (const f of objetivo) {
            const u = await actualizarFila(usuarioId, f.id, cambios);
            if (!u.ok) return falla("error_supabase", { error: u.error, resultado });
            resultado.grupos.push({ evento_id: f.id, grupo_id: f.grupo_id, estado: accion === "cerrar" ? "cerrado" : "desactivado" });
        }

        if (accion === "cerrar" && entrada.cerrar_grupo_whatsapp !== false) {
            resultado.whatsapp = await cerrarWhatsApp({ usuarioId, filas: objetivo, socketDe });
        }

        if (accion === "desactivar") {
            resultado.publicaciones_detenidas = await detenerPublicacionesPendientes(usuarioId, identidad, alcance === "grupo" ? evento.grupo_id : null);
        }

    }

    if (accion === "cancelar" || accion === "eliminar") {

        const cambios = accion === "cancelar"
            ? cambiosFin("cancelado", "panel:cancelado", ahora)
            : { ...cambiosFin("eliminado", "panel:eliminado", ahora), archivado_en: ahora.toISOString() };

        for (const f of alcanzadas) {
            // Un sorteo ya terminado conserva cómo terminó, salvo al eliminarlo.
            if (accion === "cancelar" && !f.activo && motivoGestion(f) === "cancelado") continue;
            const u = await actualizarFila(usuarioId, f.id, f.activo ? cambios : { ...cambios, cerrado_en: f.cerrado_en || cambios.cerrado_en });
            if (!u.ok) return falla("error_supabase", { error: u.error, resultado });
            resultado.grupos.push({ evento_id: f.id, grupo_id: f.grupo_id, estado: accion === "cancelar" ? "cancelado" : "eliminado" });
        }

        resultado.publicaciones_detenidas = await detenerPublicacionesPendientes(usuarioId, identidad, null);

    }

    if (accion === "reabrir") {

        const objetivo = alcanzadas.filter(f => !f.activo);
        if (!objetivo.length) return falla("estado_invalido", { mensaje: "El sorteo ya está activo." });

        // Cierre de reservas: el indicado o el que tenía; debe ser futuro y
        // no posterior a la hora del sorteo.
        const horaCierre = entrada.hora_cierre !== undefined ? String(entrada.hora_cierre || "") : String(evento.hora_cierre || "").slice(0, 5);
        const fecha = evento.fecha_evento ? String(evento.fecha_evento).slice(0, 10) : null;
        const instante = HORA.test(horaCierre) && fecha ? instanteBogota(fecha, horaCierre) : null;

        if (!instante) return falla("validacion", { errores: [{ campo: "hora_cierre", mensaje: "Indica la hora de cierre de reservas (HH:MM, 24 h)." }] });
        if (evento.hora_fin && horaCierre > String(evento.hora_fin).slice(0, 5)) return falla("validacion", { errores: [{ campo: "hora_cierre", mensaje: "El cierre no puede ser posterior a la hora del sorteo." }] });
        if (instante.getTime() <= ahora.getTime() + 60 * 1000) {
            return falla("validacion", { errores: [{ campo: "hora_cierre", mensaje: `El cierre de reservas (${fecha} ${horaCierre}) ya pasó: indica una hora de cierre futura o cambia la fecha del sorteo.` }] });
        }

        // Otro sorteo activo en alguno de esos grupos.
        const conflictos = [];
        for (const f of objetivo) {
            const otros = await activosDelGrupo(usuarioId, f.grupo_id, identidad);
            if (!otros.ok) return falla("error_supabase", { error: otros.error });
            conflictos.push(...otros.data.filter(o => o.id !== f.id));
        }

        if (conflictos.length && entrada.sustituir !== true) {
            return falla("conflicto", {
                mensaje: `El grupo ya tiene otro sorteo activo (${[...new Set(conflictos.map(nombreDe))].join(", ")}). Ciérralo o desactívalo, o confirma que este lo sustituye.`,
                conflictos: conflictos.map(c => ({ evento_id: c.id, grupo_id: c.grupo_id, nombre: nombreDe(c) }))
            });
        }

        for (const c of conflictos) {
            const u = await actualizarFila(usuarioId, c.id, cambiosFin("cerrado", `sustituido por ${nombreDe(evento)} (reabierto desde el panel)`, ahora));
            if (!u.ok) return falla("error_supabase", { error: u.error, resultado });
            resultado.grupos.push({ evento_id: c.id, grupo_id: c.grupo_id, estado: "sustituido" });
        }

        const cambios = {
            activo: true,
            estado: "abierto",
            // El worker de eventos abre el grupo en WhatsApp (reconciliación).
            abierto: false,
            hora_cierre: horaCierre,
            cierre_estado: null,
            cierre_motivo: null,
            cerrado_en: null,
            cierre_intentos: 0,
            cierre_ultimo_error: null,
            archivado_en: null,
            actualizado_en: ahora.toISOString()
        };

        for (const f of objetivo) {
            const u = await actualizarFila(usuarioId, f.id, cambios);
            if (!u.ok) return falla("error_supabase", { error: u.error, resultado });
            resultado.grupos.push({ evento_id: f.id, grupo_id: f.grupo_id, estado: "en_curso" });
        }

    }

    console.log(`🛠️ [GESTIÓN SORTEOS] ${accion} (${alcance}) ${nombreDe(evento)}: ${resultado.grupos.map(g => `${g.grupo_id}=${g.estado}`).join(", ")}`);

    return { ok: true, data: resultado };

}

module.exports = { listar, aplicar, ACCIONES };
