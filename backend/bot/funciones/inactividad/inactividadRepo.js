// ==========================================================================
// inactividadRepo.js — capa de datos del control de inactividad (ver
// supabase_migrations/022_control_inactividad_miembros.sql).
//
// Solo persiste/consulta. No decide expulsiones (eso es evaluarMiembro.js)
// ni resuelve identidad (eso sigue siendo obtenerUsuarioGlobal.js).
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { instanteColombia } = require("../../../shared/tiempo/colombia");

const VIOLACION_UNICA = "23505";
const TABLA_NO_EXISTE = "42P01";
const PAGINA = 1000;

function migracionPendiente(error) {
    return !!error && error.code === TABLA_NO_EXISTE;
}

// ---------------------------------------------------------------------------
// Fecha de pago de una fila de la tabla dinámica -> Date (o null).
// fecha_pago "YYYY-MM-DD" y hora_pago en hora de Colombia (UTC-5, sin
// horario de verano). Formatos de hora_pago que existen:
//   "8:36:42"   lo que escriben marcarReservasPagadasPorAdmin.js y
//               services/reservaManual.js (shared/tiempo/colombia.js::
//               fechaHoraRegistro = toLocaleTimeString "es-CO", sin cero
//               inicial antes de las 10:00; "0:05:00" a medianoche);
//   "08:36:42"  el mismo dato si la columna es `time` (Postgres lo rellena)
//               y los datos de prueba; "08:36" sin segundos;
//   "24:05:00"  Intl antiguo formateaba así la medianoche: mismo día, 00:05
//               (comportamiento de siempre).
// CORRECCIÓN F1-C (06/11/2026): antes solo se aceptaba la hora con dos
// cifras, así que todo pago anterior a las 10:00 contaba como de las 00:00.
// Lo demás conserva el comportamiento anterior (lo fija
// tests/inactividad/fechaCompraDeFila.test.js comparando con la versión
// antigua):
//   - hora vacía o con otro formato ("basura", "8:36:42 p. m.") -> 00:00:00
//     de ESE día, como siempre: la fecha de pago es válida y es lo que
//     cuenta para los 15 días;
//   - hora con el formato correcto pero imposible ("25:00:00", "10:60:00")
//     -> null, como siempre (y como shared/tiempo/colombia.js::
//     instanteColombia): es un dato corrupto, no se le inventa una hora;
//   - sin fecha_pago, o con una fecha que no existe en el calendario
//     (2026-02-30) -> null: no se inventa ninguna fecha. Antes una fecha
//     imposible se desplazaba al mes siguiente (2 de marzo).
// ---------------------------------------------------------------------------
const HORA_PAGO = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const dosCifras = (n) => String(n).padStart(2, "0");

// "HH:MM:SS" normalizada; "00:00:00" si no hay hora legible; null si la
// hora tiene el formato correcto pero no existe.
function horaDePago(horaPago) {

    const m = String(horaPago ?? "").trim().match(HORA_PAGO);

    if (!m) return "00:00:00";

    const h = Number(m[1]) === 24 ? 0 : Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3] ?? 0);

    if (h > 23 || min > 59 || s > 59) return null;

    return `${dosCifras(h)}:${dosCifras(min)}:${dosCifras(s)}`;

}

function fechaDeCalendario(fecha) {

    const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!m) return false;

    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);

}

function fechaCompraDeFila({ fecha_pago, hora_pago }) {

    if (!fechaDeCalendario(fecha_pago)) return null;

    const hora = horaDePago(hora_pago);

    return hora === null ? null : instanteColombia(fecha_pago, hora);

}

// ==========================================================================
// Ejecuciones + candado (exclusión mutua entre procesos)
// ==========================================================================

async function tomarEjecucion({ usuarioId, sessionId, modo, lockMinutos, ahora = new Date() }) {

    // Una ejecución 'en_curso' demasiado vieja es de un proceso que murió:
    // se marca abandonada para no bloquear el control para siempre.
    const umbral = new Date(ahora.getTime() - lockMinutos * 60 * 1000).toISOString();

    const { error: errorAbandono } = await supabase
        .from("inactividad_ejecuciones")
        .update({ estado: "abandonada", finalizado_en: ahora.toISOString(), error: "candado vencido (proceso interrumpido)" })
        .eq("usuario_id", usuarioId)
        .eq("estado", "en_curso")
        .lt("iniciado_en", umbral);

    if (migracionPendiente(errorAbandono)) return { ok: false, motivo: "migracion_pendiente" };

    const { data, error } = await supabase
        .from("inactividad_ejecuciones")
        .insert({
            usuario_id: usuarioId,
            session_id: sessionId || null,
            modo,
            estado: "en_curso",
            iniciado_en: ahora.toISOString()
        })
        .select()
        .single();

    if (error) {
        if (error.code === VIOLACION_UNICA) return { ok: false, motivo: "otra_ejecucion_en_curso" };
        if (migracionPendiente(error)) return { ok: false, motivo: "migracion_pendiente" };
        return { ok: false, motivo: "error_supabase", error: error.message };
    }

    return { ok: true, ejecucion: data };

}

async function finalizarEjecucion(id, { estado, resumen = {}, error = null, ahora = new Date() }) {

    const { error: errorUpdate } = await supabase
        .from("inactividad_ejecuciones")
        .update({ estado, resumen, error, finalizado_en: ahora.toISOString() })
        .eq("id", id)
        .eq("estado", "en_curso");

    if (errorUpdate) {
        console.error(`❌ [INACTIVIDAD] no se pudo cerrar la ejecución ${id}:`, errorUpdate.message);
        return false;
    }

    return true;

}

// Inicio de la última ejecución COMPLETADA del tenant (Date o null).
async function ultimaEjecucionCompletada(usuarioId) {

    const { data, error } = await supabase
        .from("inactividad_ejecuciones")
        .select("iniciado_en")
        .eq("usuario_id", usuarioId)
        .eq("estado", "completada")
        .order("iniciado_en", { ascending: false })
        .limit(1);

    if (error) return { ok: false, motivo: migracionPendiente(error) ? "migracion_pendiente" : "error_supabase", error: error.message };

    const fila = (data || [])[0];

    return { ok: true, iniciadoEn: fila ? new Date(fila.iniciado_en) : null };

}

// ==========================================================================
// Grupos y compras
// ==========================================================================

// Grupos COMERCIALES del tenant: los que tienen (o tuvieron) un sorteo en
// eventos_bot. Solo en ellos existen compras que medir.
async function gruposComerciales(usuarioId) {

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("grupo_id, grupo_nombre, tabla")
        .eq("usuario_id", usuarioId);

    if (error) return { ok: false, error: error.message, grupos: [] };

    const porGrupo = new Map();

    for (const fila of data || []) {
        if (fila?.grupo_id && !porGrupo.has(fila.grupo_id)) porGrupo.set(fila.grupo_id, fila);
    }

    return { ok: true, grupos: [...porGrupo.values()] };

}

// Compras CONFIRMADAS que siguen visibles en las tablas dinámicas del
// tenant: SOLO estado='pagado' (reservado -> pagado lo hacen el sticker de
// administrador o el panel). Nunca 'reservado'.
async function comprasConfirmadasDesdeTablas(usuarioId, tablas) {

    const compras = [];
    const errores = [];

    for (const tabla of [...new Set(tablas.filter(Boolean))]) {

        for (let desde = 0; ; desde += PAGINA) {

            const { data, error } = await supabase
                .from(tabla)
                .select("usuario_global_id, grupo_id, fecha_pago, hora_pago")
                .eq("usuario_id", usuarioId)
                .eq("estado", "pagado")
                .order("numero", { ascending: true })
                .range(desde, desde + PAGINA - 1);

            if (error) {
                errores.push({ tabla, error: error.message });
                break;
            }

            for (const fila of data || []) {

                const fecha = fechaCompraDeFila(fila);

                if (fila.usuario_global_id && fila.grupo_id && fecha) {
                    compras.push({ grupoId: fila.grupo_id, usuarioGlobalId: fila.usuario_global_id, fecha });
                }

            }

            if (!data || data.length < PAGINA) break;

        }

    }

    return { compras, errores };

}

// Registra una compra confirmada. Solo AVANZA la fecha (nunca la retrocede):
// el UPDATE está condicionado a que la guardada sea nula o más antigua, así
// que dos registros simultáneos no pueden dejar la fecha vieja.
async function registrarCompraConfirmada({ usuarioId, grupoId, usuarioGlobalId, fecha, origen }) {

    if (!usuarioId || !grupoId || !usuarioGlobalId || !(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
        return { ok: false, motivo: "datos_incompletos" };
    }

    const iso = fecha.toISOString();

    const { error: errorInsert } = await supabase
        .from("inactividad_miembros")
        .insert({
            usuario_id: usuarioId,
            grupo_id: grupoId,
            usuario_global_id: usuarioGlobalId,
            ultima_compra_en: iso,
            ultima_compra_origen: origen,
            // La compra prueba que estaba en el grupo en esa fecha.
            seguimiento_desde: iso
        });

    if (!errorInsert) return { ok: true, accion: "creado" };

    // FK: el usuario o el tenant de la fila ya no existen. No es un fallo
    // de infraestructura: no hay miembro al que atribuir la compra.
    if (errorInsert.code === "23503") return { ok: false, motivo: "referencia_inexistente", error: errorInsert.message };

    if (errorInsert.code !== VIOLACION_UNICA) {
        return { ok: false, motivo: migracionPendiente(errorInsert) ? "migracion_pendiente" : "error_supabase", error: errorInsert.message };
    }

    // Dos UPDATE condicionados (nula / más antigua) en vez de un filtro
    // .or() con timestamps, que PostgREST exige entrecomillar. Cada uno es
    // atómico por sí solo; juntos equivalen a GREATEST().
    const cambios = { ultima_compra_en: iso, ultima_compra_origen: origen, actualizado_en: new Date().toISOString() };
    let actualizadas = 0;

    for (const condicion of ["nula", "anterior"]) {

        let query = supabase
            .from("inactividad_miembros")
            .update(cambios)
            .eq("usuario_id", usuarioId)
            .eq("grupo_id", grupoId)
            .eq("usuario_global_id", usuarioGlobalId);

        query = condicion === "nula" ? query.is("ultima_compra_en", null) : query.lt("ultima_compra_en", iso);

        const { data, error } = await query.select("id");

        if (error) return { ok: false, motivo: "error_supabase", error: error.message };

        actualizadas += (data || []).length;

    }

    return { ok: true, accion: actualizadas ? "actualizado" : "sin_cambio" };

}

// Registra como compra confirmada cada fila que ACABA de pasar a 'pagado'
// (resultado de marcarReservasPagadasPorAdmin). Best-effort: nunca lanza y
// nunca afecta al pago, que ya quedó guardado. El grupo es el de la fila
// (donde se hizo la reserva); si falta, el del evento.
async function registrarComprasDeFilas({ usuarioId, filas = [], grupoIdPorDefecto = null, origen }) {

    let registradas = 0;

    try {

        for (const fila of filas) {

            const fecha = fechaCompraDeFila(fila);
            const grupoId = fila?.grupo_id || grupoIdPorDefecto;

            if (!fecha || !grupoId || !fila?.usuario_global_id) continue;

            const r = await registrarCompraConfirmada({ usuarioId, grupoId, usuarioGlobalId: fila.usuario_global_id, fecha, origen });

            if (r.ok) registradas++;

        }

    } catch (err) {

        console.error("⚠️ [INACTIVIDAD] no se pudo registrar la compra confirmada:", err?.message);

    }

    return { registradas };

}

// ==========================================================================
// Seguimiento por grupo
// ==========================================================================

async function seguimientosDelGrupo(usuarioId, grupoId) {

    const { data, error } = await supabase
        .from("inactividad_miembros")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId);

    if (error) return { ok: false, error: error.message, filas: [] };

    return { ok: true, filas: data || [] };

}

async function crearSeguimiento({ usuarioId, grupoId, usuarioGlobalId, ahora }) {

    const iso = ahora.toISOString();

    const { data, error } = await supabase
        .from("inactividad_miembros")
        .insert({
            usuario_id: usuarioId,
            grupo_id: grupoId,
            usuario_global_id: usuarioGlobalId,
            seguimiento_desde: iso,
            presente: true,
            ultima_vez_visto_en: iso
        })
        .select()
        .single();

    if (error) {

        // Otra ruta (p. ej. un pago) la creó entre la lectura y este INSERT.
        if (error.code === VIOLACION_UNICA) {

            const { data: existente } = await supabase
                .from("inactividad_miembros")
                .select("*")
                .eq("usuario_id", usuarioId)
                .eq("grupo_id", grupoId)
                .eq("usuario_global_id", usuarioGlobalId)
                .maybeSingle();

            return { ok: !!existente, fila: existente || null };

        }

        return { ok: false, error: error.message, fila: null };

    }

    return { ok: true, fila: data };

}

// Lectura FRESCA de un seguimiento (revalidación justo antes de expulsar).
async function obtenerSeguimiento(id) {

    const { data, error } = await supabase
        .from("inactividad_miembros")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) return { ok: false, error: error.message, fila: null };

    return { ok: true, fila: data || null };

}

async function actualizarSeguimiento(id, campos) {

    const { error } = await supabase
        .from("inactividad_miembros")
        .update({ ...campos, actualizado_en: new Date().toISOString() })
        .eq("id", id);

    if (error) {
        console.error(`❌ [INACTIVIDAD] no se pudo actualizar el seguimiento ${id}:`, error.message);
        return false;
    }

    return true;

}

// Inserta la bitácora y devuelve los ids en el mismo orden (para poder
// completar después el resultado de cada expulsión).
async function registrarEvaluaciones(filas) {

    if (!filas.length) return { ok: true, ids: [] };

    const { data, error } = await supabase.from("inactividad_evaluaciones").insert(filas).select("id");

    if (error) {
        console.error("❌ [INACTIVIDAD] no se pudo registrar la bitácora de evaluaciones:", error.message);
        return { ok: false, error: error.message, ids: [] };
    }

    return { ok: true, ids: (data || []).map(f => f.id) };

}

async function actualizarEvaluacion(id, campos) {

    if (!id) return false;

    const { error } = await supabase.from("inactividad_evaluaciones").update(campos).eq("id", id);

    if (error) {
        console.error(`❌ [INACTIVIDAD] no se pudo actualizar la evaluación ${id}:`, error.message);
        return false;
    }

    return true;

}

// Retención de la bitácora (crece por miembro y día). Solo borra filas de
// inactividad_evaluaciones de ESTE tenant más viejas que `dias`.
async function purgarEvaluacionesAntiguas(usuarioId, dias, ahora = new Date()) {

    if (!usuarioId || !(dias > 0)) return { ok: true, omitido: true };

    const umbral = new Date(ahora.getTime() - dias * 24 * 3600 * 1000).toISOString();

    const { error } = await supabase
        .from("inactividad_evaluaciones")
        .delete()
        .eq("usuario_id", usuarioId)
        .lt("creado_en", umbral);

    if (error) return { ok: false, error: error.message };

    return { ok: true };

}

module.exports = {
    fechaCompraDeFila,
    tomarEjecucion,
    finalizarEjecucion,
    ultimaEjecucionCompletada,
    gruposComerciales,
    comprasConfirmadasDesdeTablas,
    registrarCompraConfirmada,
    registrarComprasDeFilas,
    seguimientosDelGrupo,
    crearSeguimiento,
    obtenerSeguimiento,
    actualizarSeguimiento,
    registrarEvaluaciones,
    actualizarEvaluacion,
    purgarEvaluacionesAntiguas
};
