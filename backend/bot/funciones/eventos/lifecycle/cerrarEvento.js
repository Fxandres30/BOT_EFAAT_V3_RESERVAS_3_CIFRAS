const supabase = require("../../../../lib/supabase");
const { cerrarGrupoDetallado } = require("../grupos/cerrarGrupo");
const executionGuard = require("../../../../automation/executionGuard");
const { vigente, finDelEvento, motivoGestion, PREFIJO_NORMALIZADO } = require("../../../../shared/eventos/estadosGestion");

// ==========================================================================
// ORQUESTADOR CENTRAL DEL CIERRE (F3-B, 06/11/2026).
//
// Este archivo es el ÚNICO mecanismo que ejecuta el final de una fila de
// eventos_bot (un sorteo en un grupo). Cada modalidad conserva su disparador,
// su motivo, sus condiciones y sus columnas (reglas comerciales); aquí solo
// se centraliza CÓMO se ejecuta:
//   - validar la transición (estadosGestion);
//   - concurrencia: la escritura SIEMPRE va condicionada en la base (WHERE),
//     así que de dos cierres simultáneos solo escribe uno (idempotencia en la
//     persistencia, no en memoria);
//   - WhatsApp según la política de la modalidad, con reintentos;
//   - un único respaldo para bases sin las columnas opcionales;
//   - historial (registrarHistorialEvento).
// Los avisos de cierre NO se envían aquí: los envían el scheduler y el
// publicador al ver activo=false, como siempre.
// Ver docs/arquitectura/F3_CIERRE_REAPERTURA.md.
// ==========================================================================

// Perfil de cada modalidad (lo que hace hoy cada una; ver C6).
//   requiere: vigente      sorteo en curso (activo=true y sin fin)
//             activa       activo=true (sustituciones: como siempre)
//             cancelable   cualquier fila salvo una ya inactiva y cancelada
//                          (la regla de siempre de «cancelar»)
//             cualquiera   cualquier fila
//             c3           activo=true pero ya terminada (normalización)
//   whatsapp: antes | despues | no
const MODALIDADES = Object.freeze({
    hora: { fin: "cerrado", requiere: "vigente", whatsapp: "antes" },
    pagados: { fin: "cerrado", requiere: "vigente", whatsapp: "antes" },
    recuperado: { fin: "cerrado", requiere: "vigente", whatsapp: "antes" },
    cerrar: { fin: "cerrado", requiere: "vigente", whatsapp: "despues" },
    desactivar: { fin: "desactivado", requiere: "vigente", whatsapp: "no" },
    cancelar: { fin: "cancelado", requiere: "cancelable", whatsapp: "no" },
    eliminar: { fin: "eliminado", requiere: "cualquiera", whatsapp: "no" },
    sustitucion_anuncio: { fin: "cerrado", requiere: "activa", whatsapp: "no" },
    sustitucion_precio: { fin: "cerrado", requiere: "activa", whatsapp: "no" },
    sustitucion_reinicio: { fin: "cerrado", requiere: "activa", whatsapp: "no" },
    sustitucion_reabrir: { fin: "cerrado", requiere: "activa", whatsapp: "no" },
    normalizacion: { fin: null, requiere: "c3", whatsapp: "no" }
});

// Columnas que pueden faltar en una base sin las migraciones 023 / 039.
const OPCIONALES = ["cierre_estado", "cierre_motivo", "cerrado_en", "cierre_intentos", "cierre_ultimo_error", "cierre_ultimo_intento_en", "archivado_en"];
const SIN_COLUMNA = new Set(["42703", "PGRST204"]);

function cumpleRequisito(fila, requiere) {
    switch (requiere) {
        case "vigente": return vigente(fila);
        case "activa": return fila?.activo === true;
        case "cancelable": return !!fila && !(!fila.activo && motivoGestion(fila) === "cancelado");
        case "cualquiera": return !!fila;
        case "c3": return fila?.activo === true && finDelEvento(fila) !== null;
        default: return false;
    }
}

// Condición de la escritura en la BASE: lo que tiene que seguir siendo cierto
// en el instante de escribir. vigente/activa/c3: activo=true; las demás: el
// estado y el motivo leídos (otra acción entretanto => no se escribe).
function aplicarCondicion(query, fila, requiere) {
    if (requiere === "vigente" || requiere === "activa" || requiere === "c3") return query.eq("activo", true);
    let q = fila.activo === null || fila.activo === undefined ? query.is("activo", null) : query.eq("activo", fila.activo);
    q = fila.estado === null || fila.estado === undefined ? q.is("estado", null) : q.eq("estado", fila.estado);
    return q;
}

// UPDATE condicionado de UNA fila. Respaldo único para bases antiguas: sin
// una columna opcional se quita esa (o todas las opcionales) y se repite; con
// una restricción antigua sobre `estado` se guarda "cerrado" y el motivo real
// queda en cierre_motivo. -> { escrita, error }
async function escribirFin(db, { fila, cambios, requiere, usuarioId = null }) {

    const escribir = (c) => {
        let q = db.from("eventos_bot").update(c).eq("id", fila.id);
        if (usuarioId) q = q.eq("usuario_id", usuarioId);
        return aplicarCondicion(q, fila, requiere).select("id");
    };

    let datos = { ...cambios };
    let { data, error } = await escribir(datos);

    while (error && SIN_COLUMNA.has(error.code)) {
        const m = String(error.message || "").match(/'(\w+)' column|column "?(?:\w+\.)?(\w+)"? (?:of relation|does not exist)/i);
        const columna = m ? (m[1] || m[2]) : null;
        const quitar = columna && OPCIONALES.includes(columna) && columna in datos ? [columna] : OPCIONALES;
        const siguiente = Object.fromEntries(Object.entries(datos).filter(([k]) => !quitar.includes(k)));
        if (Object.keys(siguiente).length === Object.keys(datos).length) break;
        datos = siguiente;
        ({ data, error } = await escribir(datos));
    }

    if (error?.code === "23514" && datos.estado && !["abierto", "cerrado"].includes(datos.estado)) {
        ({ data, error } = await escribir({ ...datos, estado: "cerrado" }));
    }

    if (error) return { escrita: false, error };

    return { escrita: Boolean(data?.length), error: null };

}

// Historial de cada operación del orquestador. Tabla eventos_bot_historial
// (migración 048, preparada y NO aplicada): sin ella, registro estructurado
// en el log, como la auditoría 032. Nunca lanza.
const TABLA_HISTORIAL = "eventos_bot_historial";
const SIN_TABLA = new Set(["42P01", "PGRST205"]);
let historialSinTablaAvisado = false;

async function registrarHistorialEvento(db, registro) {

    const fila = {
        usuario_id: registro.usuarioId || null,
        evento_id: registro.eventoId || null,
        identidad_evento_real: registro.identidad || null,
        grupo_id: registro.grupoId || null,
        modalidad: registro.modalidad,
        actor: String(registro.actor || "sistema").slice(0, 200),
        motivo: registro.motivo ? String(registro.motivo).slice(0, 300) : null,
        resultado: registro.resultado,
        detalle: registro.detalle || {}
    };

    try {
        if (fila.usuario_id) {
            const { error } = await db.from(TABLA_HISTORIAL).insert(fila);
            if (!error) return true;
            if (SIN_TABLA.has(error.code)) {
                if (!historialSinTablaAvisado) {
                    historialSinTablaAvisado = true;
                    console.warn("⚠️ [HISTORIAL EVENTOS] eventos_bot_historial no existe todavía (falta la migración 048): el historial queda en el log.");
                }
            } else {
                console.error("❌ [HISTORIAL EVENTOS] no se pudo registrar:", error.code || error.message);
            }
        }
    } catch (err) {
        console.error("❌ [HISTORIAL EVENTOS] excepción registrando:", err?.message);
    }

    console.log(`📝 [HISTORIAL EVENTOS] ${JSON.stringify(fila)}`);
    return false;

}

// Fallo de WhatsApp DESPUÉS de marcar la fila (cierre manual): queda
// abierto=true con el error; el worker lo reintenta (reintentarCierresWhatsapp)
// con la misma espera creciente. No toca cierre_estado (el sorteo SÍ está
// cerrado). Nunca lanza.
async function registrarFalloWhatsappTrasCierre(db, fila, error) {
    const cambios = {
        cierre_intentos: (Number(fila.cierre_intentos) || 0) + 1,
        cierre_ultimo_error: String(error || "WhatsApp no confirmó el cierre").slice(0, 500),
        cierre_ultimo_intento_en: new Date().toISOString()
    };
    try {
        const { error: e } = await db.from("eventos_bot").update(cambios).eq("id", fila.id);
        if (!e) Object.assign(fila, cambios);
    } catch { /* best-effort */ }
}

// ¿El grupo de WhatsApp lo usa OTRO sorteo vigente (de cualquier cuenta)?
// Cerrarlo le impediría recibir reservas.
async function grupoEnUsoPorOtro(db, fila) {
    const { data, error } = await db.from("eventos_bot").select("*").eq("grupo_id", fila.grupo_id).eq("activo", true);
    if (error) return true; // sin poder comprobarlo, no se cierra
    return (data || []).some(o => o.id !== fila.id && vigente(o));
}

// ==========================================================================
// Cierre PROTEGIDO del grupo de WhatsApp de una fila (endurecimiento F3).
//
// Un cierre automático (WhatsApp antes de escribir) y uno manual (WhatsApp
// después de escribir) de la MISMA fila pueden coincidir, en el mismo
// proceso o en procesos distintos; también el reintento del worker. Sin
// protección, cada uno llamaba a WhatsApp. Ahora todos pasan por el registro
// central de ejecuciones (executionGuard, tabla automation_actions, clave
// ÚNICA en Postgres), así que solo uno llama:
//   clave  CIERRE_GRUPO:<grupo_id>:<id de la fila>
//   ok     el grupo ya se cerró => los demás NO llaman («ya_cerrado»)
//   en_progreso  otro lo está cerrando ahora => «en_curso» (no es un fallo:
//          el automático no marca nada y lo vuelve a mirar en su siguiente
//          ciclo; el manual queda pendiente y lo resuelve el reintento)
//   error  el último intento falló => se RETOMA (compare-and-swap), así los
//          reintentos de siempre siguen funcionando
// La clave se libera al reabrir la fila (reabrirFila), para que el siguiente
// cierre vuelva a cerrar el grupo. Además un 'ok' de más de
// VIGENCIA_CIERRE_OK_MS y un 'en_progreso' de más de
// EN_PROGRESO_VENCIDO_MS (proceso muerto a mitad) se retoman.
// Si el registro no está disponible (error al insertar, fila sin cuenta), se
// llama a WhatsApp directamente, como antes: la protección nunca impide
// cerrar.
// -> { ok, via: "llamada"|"ya_cerrado"|"sin_registro", enCurso?, error? }
// ==========================================================================
const TIPO_CIERRE_GRUPO = "CIERRE_GRUPO";
const EN_PROGRESO_VENCIDO_MS = 5 * 60 * 1000;
const VIGENCIA_CIERRE_OK_MS = 10 * 60 * 1000;

const claveCierreGrupo = (fila) => `${TIPO_CIERRE_GRUPO}:${fila.grupo_id}:${fila.id}`;

async function llamarCierreWhatsapp(sock, grupoId) {
    try { return await cerrarGrupoDetallado({ sock, grupoId }); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
}

async function cerrarGrupoProtegido({ db = supabase, sock, fila }) {

    if (!fila?.id || !fila?.usuario_id || !fila?.grupo_id) {
        const r = await llamarCierreWhatsapp(sock, fila?.grupo_id);
        return { ...r, via: "sin_registro" };
    }

    let g;
    try {
        g = await executionGuard.ejecutarUnaVez({
            db,
            claveIdempotencia: claveCierreGrupo(fila),
            grupoId: fila.grupo_id,
            usuarioId: fila.usuario_id,
            tipoAccion: TIPO_CIERRE_GRUPO,
            retomar: { trasError: true, enProgresoVencidoMs: EN_PROGRESO_VENCIDO_MS, okVencidoMs: VIGENCIA_CIERRE_OK_MS },
            ejecutar: async () => {
                const r = await llamarCierreWhatsapp(sock, fila.grupo_id);
                if (!r.ok) throw new Error(String(r.error || "WhatsApp no confirmó el cierre"));
                return { grupo_id: fila.grupo_id, evento_id: fila.id };
            }
        });
    } catch (e) {
        g = { ejecutada: false, motivo: "error_registro", error: e };
    }

    if (g.ejecutada) return { ok: true, via: "llamada" };
    if (g.motivo === "fallo_ejecucion") return { ok: false, via: "llamada", error: g.error?.message || String(g.error) };
    if (g.motivo === "ya_ok") return { ok: true, via: "ya_cerrado" };
    if (g.motivo === "ya_en_progreso") return { ok: false, enCurso: true, via: "en_curso", error: "cierre_en_curso_en_otro_proceso" };
    if (g.motivo === "ya_error") return { ok: false, via: "ya_error", error: g.accion?.detalle?.mensaje || "el último intento falló" };

    // error_insert, conflicto_desconocido, error_registro: sin protección,
    // como antes de F3.
    console.warn(`⚠️ [CIERRE] registro de ejecución no disponible (${g.motivo}): se cierra el grupo sin protección.`);
    const r = await llamarCierreWhatsapp(sock, fila.grupo_id);
    return { ...r, via: "sin_registro" };

}

// Al reabrir: el siguiente cierre de la fila vuelve a cerrar el grupo.
async function liberarCierreGrupo(db, fila, motivo) {
    if (!fila?.id || !fila?.grupo_id) return true;
    try { return await executionGuard.retirarClave(claveCierreGrupo(fila), { db, motivo }); } catch { return false; }
}

// ==========================================================================
// terminarFila: la ÚNICA ejecución del fin de una fila.
//   modalidad  clave de MODALIDADES
//   cambios    columnas de la modalidad (las de siempre)
//   cerrarGrupo false => no se toca WhatsApp aunque la política lo pida
// -> { escrita, yaTerminada, transicionInvalida, whatsapp, error }
//      whatsapp: "cerrado" | "fallido" | "omitido_en_uso" | "no_aplica"
// ==========================================================================
async function terminarFila({ db = supabase, sock = null, fila, modalidad, cambios, usuarioId = null, cerrarGrupo = true, actor = "sistema", motivo = null }) {

    const perfil = MODALIDADES[modalidad];
    if (!perfil) throw new Error(`modalidad de cierre desconocida: ${modalidad}`);

    const base = { escrita: false, yaTerminada: false, transicionInvalida: false, whatsapp: "no_aplica", error: null };

    const historial = (resultado, detalle, motivoHistorial = motivo) => registrarHistorialEvento(db, {
        usuarioId: usuarioId || fila?.usuario_id, eventoId: fila?.id, identidad: fila?.identidad_evento_real, grupoId: fila?.grupo_id,
        modalidad, actor, motivo: motivoHistorial, resultado, detalle: { fin: perfil.fin, ...detalle }
    });

    if (!cumpleRequisito(fila, perfil.requiere)) {
        const resultado = { ...base, transicionInvalida: true, yaTerminada: !vigente(fila) };
        if (fila) await historial("rechazado", { razon: "transicion_invalida", estado_leido: finDelEvento(fila) || (vigente(fila) ? "vigente" : "terminada") });
        return resultado;
    }

    const conWhatsapp = cerrarGrupo && perfil.whatsapp !== "no" && Boolean(fila.grupo_id);

    // Política «antes» (automático): sin la confirmación de WhatsApp no se
    // marca nada; el worker lo reintenta en su próximo ciclo.
    // El grupo se cierra por el registro central (cerrarGrupoProtegido): si
    // otro cierre de esta fila ya lo cerró, no se vuelve a llamar.
    let viaWhatsapp = null;
    if (conWhatsapp && perfil.whatsapp === "antes") {
        const r = await cerrarGrupoProtegido({ db, sock, fila });
        viaWhatsapp = r.via;
        if (r.enCurso) {
            // Otro proceso está cerrando este grupo ahora mismo: no es un
            // fallo (no cuenta intento); se vuelve a mirar en el siguiente
            // ciclo, cuando ya habrá terminado.
            console.log(`⏳ Evento ${fila.id}: otro proceso está cerrando el grupo — se revisa en el siguiente ciclo.`);
            return { ...base, whatsapp: "en_curso" };
        }
        if (!r.ok) {
            console.log(`⏳ Evento ${fila.id}: WhatsApp no confirmó el cierre del grupo — NO se marca cerrado, se reintentará (activo=true). Motivo: ${r.error}`);
            await registrarFalloCierre(fila, r.error, db);
            await historial("error", { whatsapp: "fallido", via: r.via, error: String(r.error || "").slice(0, 300), intento: Number(fila.cierre_intentos) || 0 });
            return { ...base, whatsapp: "fallido", error: r.error };
        }
    }

    // cambios: objeto, o función (fila) => objeto si dependen del estado de
    // la fila (p. ej. cancelar conserva el cerrado_en de una ya cerrada).
    const columnasDe = (f) => (typeof cambios === "function" ? cambios(f) : cambios);

    let escritura = await escribirFin(db, { fila, cambios: columnasDe(fila), requiere: perfil.requiere, usuarioId });

    // Cancelar y eliminar valen también sobre una fila que otra acción acaba de
    // cerrar: si la condición (estado leído) falló, se relee y se reintenta UNA
    // vez con el estado actual, si la transición sigue siendo válida. Nunca se
    // escribe a ciegas sobre un estado que no se ha leído.
    if (!escritura.error && !escritura.escrita && (perfil.requiere === "cancelable" || perfil.requiere === "cualquiera")) {
        let q = db.from("eventos_bot").select("*").eq("id", fila.id);
        if (usuarioId) q = q.eq("usuario_id", usuarioId);
        const { data: actual, error: errorLectura } = await q.maybeSingle();
        if (!errorLectura && actual && cumpleRequisito(actual, perfil.requiere)) {
            escritura = await escribirFin(db, { fila: actual, cambios: columnasDe(actual), requiere: perfil.requiere, usuarioId });
        }
    }

    if (escritura.error) {
        console.log("❌ Error cerrando evento");
        console.dir(escritura.error, { depth: null });
        const mensaje = escritura.error.message || String(escritura.error);
        await historial("error", { escritura: String(escritura.error.code || mensaje).slice(0, 300), whatsapp: viaWhatsapp ? "cerrado" : "no_aplica", via: viaWhatsapp });
        return { ...base, whatsapp: viaWhatsapp ? "cerrado" : "no_aplica", error: mensaje };
    }

    const resultado = { ...base, escrita: escritura.escrita, yaTerminada: !escritura.escrita, whatsapp: conWhatsapp && perfil.whatsapp === "antes" ? "cerrado" : "no_aplica" };

    // Política «después» (panel): solo quien escribió cierra WhatsApp.
    if (escritura.escrita && conWhatsapp && perfil.whatsapp === "despues") {
        if (await grupoEnUsoPorOtro(db, fila)) {
            resultado.whatsapp = "omitido_en_uso";
        } else {
            const r = sock ? await cerrarGrupoProtegido({ db, sock, fila }) : { ok: false, error: "sin_sesion" };
            viaWhatsapp = r.via || null;
            if (r.ok) {
                await db.from("eventos_bot").update({ abierto: false, cierre_ultimo_error: null }).eq("id", fila.id);
                resultado.whatsapp = "cerrado";
            } else if (r.enCurso) {
                // Otro proceso lo está cerrando: queda pendiente y el
                // reintento del worker lo da por resuelto (o lo cierra si
                // aquel falló).
                await registrarFalloWhatsappTrasCierre(db, fila, r.error);
                resultado.whatsapp = "en_curso";
            } else {
                await registrarFalloWhatsappTrasCierre(db, fila, r.error);
                resultado.whatsapp = r.error === "sin_sesion" ? "sin_sesion" : "fallido";
                resultado.errorWhatsapp = r.error;
            }
        }
    }

    await registrarHistorialEvento(db, {
        usuarioId: usuarioId || fila.usuario_id, eventoId: fila.id, identidad: fila.identidad_evento_real, grupoId: fila.grupo_id,
        modalidad, actor, motivo: motivo ?? columnasDe(fila).cierre_motivo ?? null,
        resultado: resultado.escrita ? "ok" : "ya_terminada",
        detalle: { whatsapp: resultado.whatsapp, fin: perfil.fin, ...(viaWhatsapp ? { via: viaWhatsapp } : {}), ...(resultado.errorWhatsapp ? { error: String(resultado.errorWhatsapp).slice(0, 300) } : {}) }
    });

    return resultado;

}

// Reintentos de WhatsApp de los cierres «después» (panel): filas ya cerradas
// en la base cuyo grupo de WhatsApp no se pudo cerrar (abierto=true y el error
// registrado). Mismo ritmo que el cierre automático (esperaAntesDeReintentar);
// a los 10 intentos se deja de reintentar y queda el error para revisarlo. Si
// el grupo lo usa ya otro sorteo vigente, no se cierra y se da por resuelto.
// Lo llama workerEventos en cada ciclo. Nunca lanza.
const MAX_REINTENTOS_WHATSAPP = 10;

async function reintentarCierresWhatsapp({ db = supabase, sock, usuarioId, ahora = Date.now() }) {

    const informe = [];
    if (!sock || !usuarioId) return informe;

    try {

        const { data, error } = await db.from("eventos_bot").select("*")
            .eq("usuario_id", usuarioId).eq("activo", false).eq("abierto", true)
            .like("cierre_motivo", "panel:cerrado%").not("cierre_ultimo_error", "is", null);

        if (error) return informe;

        for (const fila of data || []) {

            if ((Number(fila.cierre_intentos) || 0) >= MAX_REINTENTOS_WHATSAPP) continue;
            if (esperaAntesDeReintentar(fila, ahora) > 0) continue;

            if (await grupoEnUsoPorOtro(db, fila)) {
                await db.from("eventos_bot").update({ cierre_ultimo_error: null }).eq("id", fila.id);
                informe.push({ eventoId: fila.id, resultado: "omitido_en_uso" });
                await registrarHistorialEvento(db, {
                    usuarioId: fila.usuario_id, eventoId: fila.id, identidad: fila.identidad_evento_real, grupoId: fila.grupo_id,
                    modalidad: "cerrar", actor: "reintento", motivo: fila.cierre_motivo || null, resultado: "ok",
                    detalle: { reintento: true, whatsapp: "omitido_en_uso" }
                });
                continue;
            }

            const r = await cerrarGrupoProtegido({ db, sock, fila });

            // Otro proceso lo está cerrando: no cuenta intento; siguiente ciclo.
            if (r.enCurso) { informe.push({ eventoId: fila.id, resultado: "en_curso" }); continue; }

            const intento = (Number(fila.cierre_intentos) || 0) + 1;

            if (r.ok) {
                await db.from("eventos_bot").update({ abierto: false, cierre_ultimo_error: null }).eq("id", fila.id);
                informe.push({ eventoId: fila.id, resultado: "cerrado", via: r.via });
            } else {
                await registrarFalloWhatsappTrasCierre(db, fila, r.error);
                informe.push({ eventoId: fila.id, resultado: "fallido" });
            }

            await registrarHistorialEvento(db, {
                usuarioId: fila.usuario_id, eventoId: fila.id, identidad: fila.identidad_evento_real, grupoId: fila.grupo_id,
                modalidad: "cerrar", actor: "reintento", motivo: fila.cierre_motivo || null,
                resultado: r.ok ? "ok" : "error",
                detalle: { reintento: true, intento, whatsapp: r.ok ? "cerrado" : "fallido", via: r.via || null, ...(r.ok ? {} : { error: String(r.error || "").slice(0, 300) }) }
            });

        }

    } catch (err) {
        console.error("❌ [CIERRE] error reintentando cierres de WhatsApp:", err?.message);
    }

    return informe;

}

// ==========================================================================
// reabrirFila: la ÚNICA ejecución de una reapertura (F3-D).
//   cambios  columnas de la reapertura (las de siempre: activo=true,
//            estado abierto, abierto=false para que el worker reabra
//            WhatsApp, nueva hora_cierre, cierre_* limpios)
// Condicionada al estado leído (otra acción entretanto => no se escribe).
// Después restaura el ciclo de automatización: el vivo si sigue, o uno nuevo
// de reapertura (motorEventos.abrirCicloDeReapertura), para que vuelvan los
// recordatorios y el siguiente cierre se anuncie una vez. No toca WhatsApp,
// reservas, pagos ni el permiso de reservas.
// -> { escrita, transicionInvalida, fila, ciclo, error }
// ==========================================================================
async function reabrirFila({ db = supabase, fila, cambios, usuarioId = null, actor = "panel", ahora = new Date() }) {

    const base = { escrita: false, transicionInvalida: false, fila: null, ciclo: null, error: null };

    if (!fila || vigente(fila) || motivoGestion(fila) === "eliminado") return { ...base, transicionInvalida: true };

    const escritura = await escribirFin(db, { fila, cambios, requiere: "cualquiera", usuarioId });
    const historialReapertura = (resultado, detalle) => registrarHistorialEvento(db, {
        usuarioId: usuarioId || fila.usuario_id, eventoId: fila.id, identidad: fila.identidad_evento_real, grupoId: fila.grupo_id,
        modalidad: "reapertura", actor, motivo: `reabierto (antes: ${finDelEvento(fila) || "cerrado"})`, resultado, detalle
    });
    if (escritura.error) {
        await historialReapertura("error", { escritura: String(escritura.error.code || escritura.error.message || escritura.error).slice(0, 300) });
        return { ...base, error: escritura.error.message || String(escritura.error) };
    }
    if (!escritura.escrita) {
        await historialReapertura("rechazado", { razon: "estado_cambiado" });
        return base;
    }

    // El siguiente cierre de esta fila debe volver a cerrar el grupo.
    const claveLiberada = await liberarCierreGrupo(db, fila, "reapertura");

    let q = db.from("eventos_bot").select("*").eq("id", fila.id);
    if (usuarioId) q = q.eq("usuario_id", usuarioId);
    const { data: actual } = await q.maybeSingle();

    let ciclo = null;
    if (actual) {
        const motor = require("../../../../automation/motorEventos");
        ciclo = await motor.abrirCicloDeReapertura({ evento: actual, ahora });
    }

    await registrarHistorialEvento(db, {
        usuarioId: usuarioId || fila.usuario_id, eventoId: fila.id, identidad: fila.identidad_evento_real, grupoId: fila.grupo_id,
        modalidad: "reapertura", actor, motivo: `reabierto (antes: ${finDelEvento(fila) || "cerrado"})`, resultado: "ok",
        detalle: { hora_cierre: cambios.hora_cierre ?? null, ciclo: ciclo?.eventSession?.id || null, ciclo_nuevo: Boolean(ciclo?.nuevo), motivo_ciclo: ciclo?.motivo || null, clave_cierre_liberada: claveLiberada }
    });

    return { ...base, escrita: true, fila: actual, ciclo };

}

// ==========================================================================
// deshacerSustitucion: deshace las sustituciones de un sorteo nuevo que no se
// pudo guardar (todo o nada de reemplazarAnteriores). Mismo algoritmo de
// siempre (antes vivía en unSorteoPorPrecio.revertirReemplazo, fuera del
// orquestador y sin historial): restaura las columnas leídas, SOLO si la fila
// sigue cerrada por ESTE reemplazo (mismo cierre_motivo); nunca reabre algo
// que otra acción cerró después. No toca WhatsApp (las sustituciones nunca lo
// tocan), reservas ni pagos. Cada fila queda en el historial con la
// modalidad de la sustitución y resultado «error» (la sustitución no llegó a
// efectuarse): detalle.deshecha dice si se restauró. Nunca lanza.
// -> número de filas restauradas
// ==========================================================================
async function deshacerSustitucion({ db = supabase, usuarioId, filas, motivo, modalidad = "sustitucion_precio", actor = "sistema" }) {

    let restauradas = 0;

    for (const f of filas || []) {

        const restaurar = {
            activo: f.activo, estado: f.estado,
            cierre_estado: f.cierre_estado ?? null, cierre_motivo: f.cierre_motivo ?? null, cerrado_en: f.cerrado_en ?? null,
            actualizado_en: new Date().toISOString()
        };

        let deshecha = false;
        let fallo = null;
        try {
            const { data, error } = await db.from("eventos_bot").update(restaurar)
                .eq("usuario_id", usuarioId).eq("id", f.id).eq("cierre_motivo", motivo).select();
            if (error) fallo = error.message || String(error);
            else deshecha = Array.isArray(data) && data.length === 1;
        } catch (e) {
            fallo = e?.message || String(e);
        }

        if (fallo) console.error(`❌ [UN SORTEO POR PRECIO] no se pudo deshacer el cierre de ${f.id}:`, fallo);
        if (deshecha) restauradas++;

        await registrarHistorialEvento(db, {
            usuarioId: usuarioId || f.usuario_id, eventoId: f.id, identidad: f.identidad_evento_real, grupoId: f.grupo_id,
            modalidad: MODALIDADES[modalidad] ? modalidad : "sustitucion_precio", actor, motivo, resultado: "error",
            detalle: { deshecha, razon: "sorteo_nuevo_no_guardado", ...(fallo ? { error: String(fallo).slice(0, 300) } : {}), ...(!deshecha && !fallo ? { omitida: "cambiada_despues" } : {}) }
        });

    }

    return restauradas;

}

// Normalización de una fila C3 (activo=true pero ya terminada): activo=false,
// el motivo que tenía con el prefijo «normalizado: » (silencioso, sin aviso
// tardío; el motivo original se sigue interpretando) y nada más. No toca
// WhatsApp, estado, cierre_estado, reservas ni pagos. El scheduler termina su
// ciclo sin aviso al ver activo=false.
async function normalizarCierre({ db = supabase, fila, usuarioId = null, actor = "sistema", ahora = new Date() }) {
    const previo = fila?.cierre_motivo || finDelEvento(fila) || "cerrado";
    return terminarFila({
        db, fila, usuarioId, actor, modalidad: "normalizacion", cerrarGrupo: false,
        cambios: { activo: false, cierre_motivo: `${PREFIJO_NORMALIZADO}${previo}`.slice(0, 200), actualizado_en: ahora.toISOString() }
    });
}

// Columna inexistente: la migración 023 (estado de cierre por grupo) todavía
// no se aplicó. El cierre NUNCA depende de esas columnas: sin ellas se
// comporta exactamente como antes.
const COLUMNA_INEXISTENTE = "42703";

// Reintentos: los 3 primeros fallos se reintentan en cada ciclo del worker
// (30 s); después, con espera creciente hasta 30 min, para no saturar la
// cola de IQ con un grupo donde el bot no tiene permisos.
const REINTENTOS_INMEDIATOS = 3;
const ESPERA_BASE_MS = 30 * 1000;
const ESPERA_MAXIMA_MS = 30 * 60 * 1000;

function esperaAntesDeReintentar(fila, ahora = Date.now()) {

    const intentos = Number(fila?.cierre_intentos) || 0;

    if (intentos < REINTENTOS_INMEDIATOS || !fila?.cierre_ultimo_intento_en) return 0;

    const espera = Math.min(ESPERA_BASE_MS * 2 ** (intentos - REINTENTOS_INMEDIATOS + 1), ESPERA_MAXIMA_MS);
    const transcurrido = ahora - new Date(fila.cierre_ultimo_intento_en).getTime();

    return Math.max(0, espera - transcurrido);

}

// Registro best-effort del fallo de cierre de UN grupo. Nunca lanza.
async function registrarFalloCierre(fila, error, db = supabase) {

    const intentos = (Number(fila.cierre_intentos) || 0) + 1;

    const cambios = {
        cierre_estado: intentos >= 10 ? "requiere_revision" : "fallido",
        cierre_intentos: intentos,
        cierre_ultimo_error: String(error || "WhatsApp no confirmó el cierre").slice(0, 500),
        cierre_ultimo_intento_en: new Date().toISOString()
    };

    try {

        // Solo sobre la fila aún activa: si otro cierre (p. ej. el manual) la
        // terminó entretanto, no se le pone un cierre_estado de fallo.
        const { error: errorUpdate } = await db.from("eventos_bot").update(cambios).eq("id", fila.id).eq("activo", true);

        if (!errorUpdate) {
            Object.assign(fila, cambios);
        } else if (errorUpdate.code !== COLUMNA_INEXISTENTE) {
            console.log("⚠️ No se pudo registrar el fallo de cierre:", errorUpdate.message);
        }

    } catch (err) {

        console.log("⚠️ No se pudo registrar el fallo de cierre:", err?.message);

    }

}

// ==========================================================================
// Cierra el GRUPO REAL de WhatsApp de UNA fila de eventos_bot puntual y, si
// WhatsApp confirma, marca ESA fila como cerrada. No propaga a hermanos —
// eso lo hace cerrarEvento() más abajo, llamando a esta misma función para
// cada uno. Es exactamente la lógica que ya tenía cerrarEvento() antes de
// este cambio, sin ninguna diferencia de comportamiento para un evento sin
// hermanos (el caso de siempre).
// ==========================================================================
// cerrarGrupo=false: solo se marca la fila (su grupo de WhatsApp ya es de
// otro sorteo vigente, ver procesarSorteo.js).
async function cerrarFilaDeEvento({ sock, fila, motivo, cerrarGrupo = true, modalidad = "hora" }) {

    if (!fila) return false;

    // Ya terminada (cerrada, gestionada o C3): nada que hacer, como siempre.
    if (!vigente(fila)) return true;

    // Modalidades automáticas (hora, pagados, recuperado): política «antes»
    // del orquestador. WhatsApp primero; sin su confirmación NO se marca
    // nada y el worker lo reintenta (cerrarGrupo/groupSettingUpdate es
    // idempotente). Antes se marcaba primero y, si WhatsApp fallaba, la base
    // y WhatsApp quedaban divergentes para siempre. Columnas: las de siempre.
    const instante = new Date().toISOString();

    const r = await terminarFila({
        sock,
        fila,
        modalidad,
        cerrarGrupo,
        motivo,
        cambios: {
            activo: false,
            abierto: false,
            estado: "cerrado",
            actualizado_en: instante,
            cierre_estado: "cerrado",
            cierre_motivo: String(motivo || "").slice(0, 200),
            cierre_ultimo_error: null,
            cierre_ultimo_intento_en: instante,
            cerrado_en: instante
        }
    });

    if (r.whatsapp === "fallido" || r.whatsapp === "en_curso" || r.error) return false;

    fila.activo = false;

    if (!r.escrita) {

        console.log(`ℹ️ Evento ${fila.id}: ya estaba cerrado o gestionado por otro proceso — no se reescribe.`);

        return true;

    }

    console.log(`🔒 Evento ${fila.id} cerrado (${motivo})`);

    return true;

}

// ==========================================================================
// Otras filas de eventos_bot (de otros grupos) que representan el MISMO
// sorteo real (misma identidad_evento_real, mismo tenant) y siguen activas.
// Decisión aprobada explícitamente: "el cierre es del evento real, no del
// grupo" — si Grupo A cierra, los grupos B/C que anunciaron el MISMO sorteo
// deben cerrarse también, para que ninguno siga aceptando reservas de un
// evento que ya cerró en otro. Ver bot/funciones/eventos/identidadEventoReal.js.
//
// Si identidad_evento_real todavía no existe (evento previo a la migración
// 015_identidad_evento_real.sql), no hay nada que buscar: se comporta
// exactamente igual que antes de este cambio (solo cierra el grupo propio).
// ==========================================================================
async function buscarGruposHermanosActivos(fila) {

    if (!fila.identidad_evento_real) return [];

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("identidad_evento_real", fila.identidad_evento_real)
        .eq("usuario_id", fila.usuario_id)
        .eq("activo", true);

    if (error) {

        console.log("❌ Error buscando grupos hermanos del mismo evento real");
        console.dir(error, { depth: null });

        return [];

    }

    return data || [];

}

async function cerrarEvento({

    sock,
    evento,
    motivo

}) {

    if (!evento) return false;

    if (!evento.activo) return true;

    const cerradoPropio = await cerrarFilaDeEvento({ sock, fila: evento, motivo });

    if (!cerradoPropio) return false;

    // ============================================================
    // 3. PROPAGAR EL CIERRE A LOS GRUPOS HERMANOS DEL MISMO EVENTO REAL
    // ============================================================
    // Cada hermano se cierra con la MISMA función segura de arriba: si
    // WhatsApp no confirma el cierre de un hermano puntual, ESE hermano
    // simplemente queda activo=true — el worker lo reintenta en su próximo
    // ciclo normal (hora_cierre/verificarTodosPagados ya aislados por
    // evento real, así que vuelve a evaluar "cerrar" igual, sin necesitar
    // ningún mecanismo de reconciliación nuevo). Un fallo propagando a un
    // hermano NUNCA revierte el cierre ya confirmado del grupo que originó
    // la acción.
    try {

        const hermanos = await buscarGruposHermanosActivos(evento);

        for (const hermano of hermanos) {

            await cerrarFilaDeEvento({

                sock,
                fila: hermano,
                motivo: `${motivo} (evento compartido, propagado desde grupo ${evento.grupo_id})`

            });

        }

    } catch (error) {

        console.error("❌ Error propagando cierre a grupos hermanos del mismo evento real:", error?.message);

    }

    return true;

}

module.exports = {
    deshacerSustitucion,
    cerrarGrupoProtegido,
    claveCierreGrupo,
    cerrarEvento,
    cerrarFilaDeEvento,
    esperaAntesDeReintentar,
    // Orquestador central (F3-B)
    MODALIDADES,
    terminarFila,
    normalizarCierre,
    reabrirFila,
    reintentarCierresWhatsapp,
    escribirFin,
    registrarHistorialEvento,
    grupoEnUsoPorOtro
};
