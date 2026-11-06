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
const { motivoGestion, eliminado, estadoEnGrupoPorActivo, enCursoPorActivo, vigente, MODOS_RESERVA, modoReservas, puedeReservar } = require("../shared/eventos/estadosGestion");
const { verificarHoraCierre } = require("../bot/funciones/eventos/lifecycle/verificarHoraCierre");
// Orquestador central del cierre (F3): todas las acciones pasan por él.
const orquestador = require("../bot/funciones/eventos/lifecycle/cerrarEvento");
const { sorteosActivosDelPrecio } = require("../shared/eventos/unSorteoPorPrecio");
const { ESTADOS_EDITABLES } = require("./estadosProgramacion");

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

// Conteo de números por identidad: repo.contarNumerosIdentidad (F1-B).

// Estado de cada grupo y del sorteo: criterio C (anterior, solo `activo`)
// de la fuente única, estadosGestion.estadoEnGrupoPorActivo /
// enCursoPorActivo (F2). Pasarlo al canónico (estadoEnGrupo) es una decisión
// pendiente: una fila activo=true ya cerrada pasaría de «En curso» a
// «Cerrado» en Eventos.
const estadoFila = estadoEnGrupoPorActivo;
const enCurso = enCursoPorActivo;

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
        if (eliminado(f) || !(enCurso(f) || reciente(f))) continue;
        const k = f.identidad_evento_real || `evento:${f.id}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(f);
    }

    const lista = [];

    for (const filas of grupos.values()) {

        // Representante: la activa, si no la más reciente.
        const base = filas.find(enCurso) || filas[0];
        // En curso: toda su tabla (UNA TABLA = UN SORTEO). Cerrado: la tabla
        // puede ser ya de otro sorteo; solo la identidad de la fila lo recuerda.
        const numeros = filas.some(enCurso)
            ? await repo.contarNumerosTabla(usuarioId, base.tabla)
            : await repo.contarNumerosIdentidad(usuarioId, base.tabla, base.identidad_evento_real);

        lista.push({
            id: base.id,
            identidad: base.identidad_evento_real || null,
            nombre: base.nombre_evento || null,
            fecha_evento: base.fecha_evento ? String(base.fecha_evento).slice(0, 10) : null,
            hora_fin: base.hora_fin || null,
            hora_cierre: base.hora_cierre || null,
            valor: Number(String(base.valor ?? "").replace(/[^\d]/g, "")) || null,
            estado: filas.some(enCurso) ? "en_curso" : estadoFila(base),
            reservados: numeros.reservados,
            pagados: numeros.pagados,
            // Permiso de reservas (F3-E): decisión del administrador, aparte del estado.
            reservas_modo: modoReservas(base),
            acepta_reservas: puedeReservar({ evento: base, cierrePasado: verificarHoraCierre(base, ahora) }).permitido,
            grupos: filas.map(f => ({
                evento_id: f.id,
                grupo_id: f.grupo_id,
                grupo_nombre: f.grupo_nombre || null,
                estado: estadoFila(f),
                abierto_whatsapp: f.abierto !== false,
                reservas_modo: modoReservas(f)
            }))
        });

    }

    return { ok: true, data: lista };

}

// ------------------------------------------------------------ escritura ---

// Columna que el error dice que no existe (Postgres 42703 o caché de
// PostgREST PGRST204), o null si el mensaje no la nombra.
function columnaFaltante(error) {
    const m = String(error?.message || "").match(/'(\w+)' column|column "?(?:\w+\.)?(\w+)"? (?:of relation|does not exist)/i);
    return m ? (m[1] || m[2]) : null;
}

// UPDATE de UNA fila del cliente, tolerante a una base sin las columnas
// opcionales y a una restricción antigua sobre `estado` (en ese caso se
// guarda "cerrado" y el motivo real queda en cierre_motivo).
// Solo se omite la columna que falta: sin la 039 (archivado_en) se siguen
// escribiendo las de cierre de la 023, porque cierre_motivo es lo que marca
// un sorteo eliminado/cancelado/desactivado y lo que se limpia al reabrir.
async function actualizarFila(usuarioId, id, cambios) {

    const escribir = (c) => supabase.from("eventos_bot").update(c).eq("usuario_id", usuarioId).eq("id", id);

    let datos = cambios;
    let { error } = await escribir(datos);

    while (error && SIN_COLUMNA.has(error.code)) {
        const columna = columnaFaltante(error);
        const quitar = columna && OPCIONALES.includes(columna) && columna in datos ? [columna] : OPCIONALES;
        const siguiente = Object.fromEntries(Object.entries(datos).filter(([k]) => !quitar.includes(k)));
        if (Object.keys(siguiente).length === Object.keys(datos).length) break;
        datos = siguiente;
        ({ error } = await escribir(datos));
    }

    if (error?.code === "23514" && !["abierto", "cerrado"].includes(datos.estado)) {
        ({ error } = await escribir({ ...datos, estado: "cerrado" }));
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
        if (!grupoId && ESTADOS_EDITABLES.includes(p.estado)) {
            await repo.actualizarSorteoSi(usuarioId, p.id, { estados: ESTADOS_EDITABLES }, { estado: "cancelado" });
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

        const objetivo = alcanzadas.filter(enCurso);
        if (!objetivo.length) return falla("estado_invalido", { mensaje: alcance === "grupo" ? "El sorteo ya no está activo en este grupo." : "El sorteo ya no está activo en ningún grupo." });

        const cambios = accion === "cerrar"
            ? cambiosFin("cerrado", "panel:cerrado manualmente", ahora)
            : cambiosFin("desactivado", "panel:desactivado", ahora);

        // Orquestador central (F3-C): escritura condicionada en la base,
        // WhatsApp «después» con reintento (solo «cerrar») e historial.
        // Una fila activo=true que YA había terminado (C3) se normaliza en
        // silencio: no se reescribe su motivo ni se anuncia un cierre tardío.
        const sock = socketDe ? socketDe(usuarioId) : null;
        const actor = entrada.operador || "panel";
        const cerrarWa = accion === "cerrar" && entrada.cerrar_grupo_whatsapp !== false;

        for (const f of objetivo) {

            const r = vigente(f)
                ? await orquestador.terminarFila({ db: supabase, fila: f, modalidad: accion, cambios, usuarioId, sock, cerrarGrupo: cerrarWa, actor })
                : await orquestador.normalizarCierre({ db: supabase, fila: f, usuarioId, actor, ahora });

            if (r.error) return falla("error_supabase", { error: r.error, resultado });
            if (!r.escrita) continue; // otra acción la terminó entretanto: no se pisa

            resultado.grupos.push({ evento_id: f.id, grupo_id: f.grupo_id, estado: vigente(f) ? (accion === "cerrar" ? "cerrado" : "desactivado") : "normalizado" });

            if (cerrarWa && vigente(f)) {
                const wa = { cerrado: "cerrado", fallido: "fallido", sin_sesion: "sin_sesion", omitido_en_uso: "omitido_otro_sorteo_activo" }[r.whatsapp] || r.whatsapp;
                resultado.whatsapp.push({ grupo_id: f.grupo_id, whatsapp: wa, error: r.errorWhatsapp || null });
            }

        }

        if (!resultado.grupos.length) {
            return falla("estado_cambio", { mensaje: "El sorteo cambió mientras se aplicaba la acción (otra acción o el cierre automático lo terminó). Revisa su estado." });
        }

        if (accion === "desactivar") {
            resultado.publicaciones_detenidas = await detenerPublicacionesPendientes(usuarioId, identidad, alcance === "grupo" ? evento.grupo_id : null);
        }

    }

    if (accion === "cancelar" || accion === "eliminar") {

        const cambios = accion === "cancelar"
            ? cambiosFin("cancelado", "panel:cancelado", ahora)
            : { ...cambiosFin("eliminado", "panel:eliminado", ahora), archivado_en: ahora.toISOString() };

        let intentadas = 0;

        for (const f of alcanzadas) {
            // Un sorteo ya terminado conserva cómo terminó, salvo al eliminarlo
            // (regla de siempre; en el orquestador: requisito «cancelable»).
            if (accion === "cancelar" && !enCurso(f) && motivoGestion(f) === "cancelado") continue;
            intentadas++;
            // Orquestador (F3-C): condicionado al estado leído; si otra acción
            // la cambió entretanto, se relee y se aplica sobre el estado actual
            // (cancelar y eliminar también valen sobre una fila cerrada). Las
            // columnas se calculan con la fila que de verdad se escribe.
            const r = await orquestador.terminarFila({
                db: supabase, fila: f, modalidad: accion, usuarioId, actor: entrada.operador || "panel",
                cambios: (x) => (enCurso(x) ? cambios : { ...cambios, cerrado_en: x.cerrado_en || cambios.cerrado_en })
            });
            if (r.error) return falla("error_supabase", { error: r.error, resultado });
            if (!r.escrita) continue;
            resultado.grupos.push({ evento_id: f.id, grupo_id: f.grupo_id, estado: accion === "cancelar" ? "cancelado" : "eliminado" });
        }

        if (intentadas && !resultado.grupos.length) {
            return falla("estado_cambio", { mensaje: "El sorteo cambió mientras se aplicaba la acción. Revisa su estado y vuelve a intentarlo." });
        }

        resultado.publicaciones_detenidas = await detenerPublicacionesPendientes(usuarioId, identidad, null);

    }

    if (accion === "reabrir") {

        const objetivo = alcanzadas.filter(f => !enCurso(f));
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

        // UN SORTEO POR PRECIO (01/11): también el sorteo activo del MISMO
        // precio en otros grupos. Sustituirlo (con la misma confirmación) lo
        // cierra en todos ellos; la 043 no admitiría dos activos del precio.
        // Los de otros precios en otros grupos no se tocan.
        const delPrecio = await sorteosActivosDelPrecio(supabase, { usuarioId, valor: evento.valor, identidad });
        if (!delPrecio.ok) return falla("error_supabase", { error: delPrecio.error?.message });
        conflictos.push(...delPrecio.filas.filter(o => !conflictos.some(c => c.id === o.id) && !objetivo.some(f => f.id === o.id)));

        if (conflictos.length && entrada.sustituir !== true) {
            return falla("conflicto", {
                mensaje: `El grupo o el precio ya tienen otro sorteo activo (${[...new Set(conflictos.map(nombreDe))].join(", ")}). Ciérralo o desactívalo, o confirma que este lo sustituye (si es del mismo precio, se cerrará en todos sus grupos).`,
                conflictos: conflictos.map(c => ({ evento_id: c.id, grupo_id: c.grupo_id, nombre: nombreDe(c) }))
            });
        }

        for (const c of conflictos) {
            // Orquestador (F3-C), modalidad «sustitución al reabrir»: mismas
            // columnas, condicionado a que siga activo (si otra acción lo
            // cerró entretanto, ya no es un conflicto).
            const u = await orquestador.terminarFila({
                db: supabase, fila: c, modalidad: "sustitucion_reabrir", usuarioId, actor: entrada.operador || "panel",
                cambios: cambiosFin("cerrado", `sustituido por ${nombreDe(evento)} (reabierto desde el panel)`, ahora)
            });
            if (u.error) return falla("error_supabase", { error: u.error, resultado });
            if (u.escrita) resultado.grupos.push({ evento_id: c.id, grupo_id: c.grupo_id, estado: "sustituido" });
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

        // Reapertura central (F3-D): condicionada al estado leído, con
        // historial, y restaura el ciclo de automatización (el vivo o uno
        // nuevo de reapertura) para que vuelvan los recordatorios y el
        // siguiente cierre se anuncie una vez.
        for (const f of objetivo) {
            const u = await orquestador.reabrirFila({ db: supabase, fila: f, cambios, usuarioId, actor: entrada.operador || "panel", ahora });
            if (u.error) return falla("error_supabase", { error: u.error, resultado });
            if (!u.escrita) continue; // otra acción la cambió entretanto
            resultado.grupos.push({ evento_id: f.id, grupo_id: f.grupo_id, estado: "en_curso", ciclo: u.ciclo?.nuevo ? "nuevo" : (u.ciclo?.eventSession ? "vivo" : (u.ciclo?.motivo || null)) });
        }

        if (!resultado.grupos.some(g => g.estado === "en_curso")) {
            return falla("estado_cambio", { mensaje: "El sorteo cambió mientras se reabría. Revisa su estado y vuelve a intentarlo." });
        }

    }

    console.log(`🛠️ [GESTIÓN SORTEOS] ${accion} (${alcance}) ${nombreDe(evento)}: ${resultado.grupos.map(g => `${g.grupo_id}=${g.estado}`).join(", ")}`);

    return { ok: true, data: resultado };

}

// ------------------------------------------------- permiso de reservas ---

// cambiarPermisoReservas(usuarioId, eventoId, { modo, operador }) — F3-E.
// Decisión del ADMINISTRADOR, independiente del estado del sorteo: se escribe
// en TODAS las filas del sorteo (misma identidad). Nunca la cambia ninguna
// automatización. Queda en el historial con el valor anterior y el nuevo.
// Sin la migración 047: falla clara, sin tocar nada.
async function cambiarPermisoReservas(usuarioId, eventoId, { modo, operador = "panel" } = {}) {

    if (!MODOS_RESERVA.includes(modo)) {
        return falla("validacion", { errores: [{ campo: "modo", mensaje: "Elige: según el estado, permitidas o desactivadas." }] });
    }

    const r = await filasDelSorteo(usuarioId, eventoId);
    if (!r.ok) return r;

    const grupos = [];

    for (const f of r.filas) {
        const anterior = modoReservas(f);
        const { error } = await supabase.from("eventos_bot").update({ reservas_modo: modo }).eq("usuario_id", usuarioId).eq("id", f.id);
        if (error && SIN_COLUMNA.has(error.code)) {
            return falla("migracion_pendiente", { mensaje: "Falta aplicar la migración 047 (permiso de reservas) en la base: el permiso no se puede cambiar todavía. Todos los sorteos siguen «según el estado»." });
        }
        if (error) return falla("error_supabase", { error: error.message, grupos });
        grupos.push({ evento_id: f.id, grupo_id: f.grupo_id, reservas_modo: modo });
        await orquestador.registrarHistorialEvento(supabase, {
            usuarioId, eventoId: f.id, identidad: f.identidad_evento_real, grupoId: f.grupo_id,
            modalidad: "permiso_reservas", actor: operador, motivo: `${anterior} → ${modo}`, resultado: "ok",
            detalle: { anterior, nuevo: modo }
        });
    }

    console.log(`🛠️ [GESTIÓN SORTEOS] permiso de reservas «${modo}» en ${grupos.length} grupo(s) (${operador}).`);

    return { ok: true, data: { reservas_modo: modo, grupos } };

}

module.exports = { listar, aplicar, cambiarPermisoReservas, ACCIONES };
