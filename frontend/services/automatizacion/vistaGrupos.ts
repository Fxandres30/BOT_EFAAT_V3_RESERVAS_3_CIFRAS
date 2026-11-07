import type { AutomationConfig } from "./automationConfigs";
import type { GrupoAutorizado } from "./gruposAutorizados";
import type { SesionConGrupos } from "./gruposDisponibles";
import { SIN_NOMBRE } from "./estadoProgramacion";
import type { ResultadoRecordatorio } from "./estadoProgramacion";
import { mergearGrupos, normalizarGrupoId } from "./mergeGrupos";
import type { SesionInfo } from "./mergeGrupos";

// ==========================================================================
// Vista unificada de grupos del panel de Automatización (lógica PURA, sin
// red ni Supabase, para poder probarla aislada).
//
// Junta, por grupo_id (la única identidad, ver mergeGrupos.ts):
//   - la consulta EN VIVO de las sesiones de WhatsApp (conexión),
//   - grupos_autorizados (autorización),
//   - automation_configs + seguimiento ya calculado en FilaGrupo
//     (automatización, sorteo, próximos envíos).
// Nunca inventa un dato: si algo no se pudo consultar se dice
// «comprobando» / «sin verificar», jamás «conectado» o «0».
// No escribe nada ni cambia ninguna regla de autorización o de envío.
// ==========================================================================

export type ConexionVista = "conectado" | "no_visto" | "sin_sesion" | "no_verificable" | "comprobando";
export type AutorizacionVista = "autorizado" | "pausada" | "no_autorizado";
export type AutomatizacionVista = "activa" | "pausada" | "sin_configurar";

// Lo mínimo de FilaGrupo (components/automatizacion/CentroAutomatizaciones/
// filaGrupo.ts) que necesita esta vista — estructural, para no depender de
// un componente.
export interface FilaResumen {
    config: AutomationConfig;
    nombre: string;
    evento: { nombre_evento: string | null } | null;
    cierre: Date | null;
    horaCierre: string | null;
    datosDisponibles: boolean;
    cicloAbierto: boolean;
    sesionNoActiva: boolean;
    programadosActivos: number;
    pendientes: number;
    recordatorios: { clave: string; categoria: string | null; activo: boolean; resultado: ResultadoRecordatorio }[];
    // Registros de envío del sorteo en curso (cualquier tipo de mensaje).
    acciones?: { estado: string; tipo_accion?: string }[];
    // Conexión y autorización vistas por el Centro (FilaGrupo).
    conexion?: string;
    autorizado?: boolean | null;
    resumen: {
        proximo: ResultadoRecordatorio | null;
        ultimoEnviado: { tipo: string; en: Date } | null;
    };
}

export interface GrupoVista<F extends FilaResumen = FilaResumen> {
    grupoId: string;
    // Nombre real de WhatsApp si está conectado; si no, el último nombre
    // registrado (marcado con nombreConfirmado=false); null si no hay.
    nombre: string | null;
    nombreConfirmado: boolean;
    conexion: ConexionVista;
    sesiones: SesionInfo[];
    autorizacion: GrupoAutorizado | null;
    estadoAutorizacion: AutorizacionVista;
    estadoAutomatizacion: AutomatizacionVista;
    fila: F | null;
}

export function estadoAutorizacion(auth: GrupoAutorizado | null): AutorizacionVista {
    if (!auth) return "no_autorizado";
    return auth.activo ? "autorizado" : "pausada";
}

export function estadoAutomatizacion(config: Pick<AutomationConfig, "activo"> | null | undefined): AutomatizacionVista {
    if (!config) return "sin_configurar";
    return config.activo === true ? "activa" : "pausada";
}

// sesiones === null → la consulta en vivo aún no termina.
export function conexionVista(conectadoAhora: boolean, sesiones: SesionConGrupos[] | null): ConexionVista {

    if (sesiones === null) return "comprobando";
    if (conectadoAhora) return "conectado";

    const conectadas = sesiones.filter((s) => s.estado === "conectada");

    if (conectadas.length > 0) return "no_visto";
    if (sesiones.some((s) => s.estado === "no_verificable")) return "no_verificable";

    return "sin_sesion";

}

export function construirGruposVista<F extends FilaResumen>(
    sesiones: SesionConGrupos[] | null,
    autorizados: GrupoAutorizado[],
    filas: F[]
): GrupoVista<F>[] {

    const { disponibles, historicos } = mergearGrupos(sesiones || [], autorizados);

    const filaPorGrupo = new Map<string, F>();
    for (const f of filas) filaPorGrupo.set(normalizarGrupoId(f.config.grupo_id), f);

    const vistos = new Set<string>();
    const resultado: GrupoVista<F>[] = [];

    function nombreRegistrado(fila: F | null): string | null {
        // FilaGrupo ya resuelve el mejor nombre real disponible y nunca usa
        // el identificador técnico; «Grupo sin nombre…» se trata como null.
        const n = fila?.nombre?.trim() || "";
        return n && !n.endsWith("@g.us") && n !== SIN_NOMBRE ? n : null;
    }

    for (const g of disponibles) {
        const fila = filaPorGrupo.get(g.grupoId) || null;
        vistos.add(g.grupoId);
        const enVivo = g.nombre && g.nombre !== g.grupoId ? g.nombre : null;
        resultado.push({
            grupoId: g.grupoId,
            nombre: enVivo || nombreRegistrado(fila),
            nombreConfirmado: !!enVivo,
            conexion: conexionVista(true, sesiones),
            sesiones: g.sesiones,
            autorizacion: g.autorizacion,
            estadoAutorizacion: estadoAutorizacion(g.autorizacion),
            estadoAutomatizacion: estadoAutomatizacion(fila?.config),
            fila
        });
    }

    for (const g of historicos) {
        if (vistos.has(g.grupoId)) continue;
        const fila = filaPorGrupo.get(g.grupoId) || null;
        vistos.add(g.grupoId);
        resultado.push({
            grupoId: g.grupoId,
            nombre: nombreRegistrado(fila),
            nombreConfirmado: false,
            conexion: conexionVista(false, sesiones),
            sesiones: [],
            autorizacion: g.autorizacion,
            estadoAutorizacion: estadoAutorizacion(g.autorizacion),
            estadoAutomatizacion: estadoAutomatizacion(fila?.config),
            fila
        });
    }

    // Grupos con automatización guardada pero sin autorización ni presencia
    // actual en WhatsApp: se muestran para que no queden ocultos.
    for (const [grupoId, fila] of filaPorGrupo) {
        if (vistos.has(grupoId)) continue;
        vistos.add(grupoId);
        resultado.push({
            grupoId,
            nombre: nombreRegistrado(fila),
            nombreConfirmado: false,
            conexion: conexionVista(false, sesiones),
            sesiones: [],
            autorizacion: null,
            estadoAutorizacion: "no_autorizado",
            estadoAutomatizacion: estadoAutomatizacion(fila.config),
            fila
        });
    }

    return resultado;

}

// ------------------------------------------------- capacidad de envío ---

// Error de envío en el sorteo en curso, de CUALQUIER tipo de mensaje
// (recordatorio, apertura, actualización, cierre, tabla inicial…).
export function tieneErrorEnvio(fila: FilaResumen | null | undefined): boolean {
    if (!fila) return false;
    return fila.recordatorios.some((r) => r.resultado.estado === "error") ||
        (fila.acciones || []).some((a) => a.estado === "error");
}

// ¿Puede este grupo enviar mensajes automáticos AHORA? Exige las tres
// condiciones reales: automatización activa, grupo autorizado y visible en
// un WhatsApp conectado. null = aún no se sabe (conexión comprobándose).
export function puedeEnviar(g: GrupoVista): boolean | null {
    if (g.estadoAutomatizacion !== "activa" || g.estadoAutorizacion !== "autorizado") return false;
    if (g.conexion === "comprobando") return null;
    return g.conexion === "conectado";
}

// Lo mismo desde una fila del Centro de control (FilaGrupo).
export function puedeEnviarFila(f: Pick<FilaResumen, "config" | "conexion" | "autorizado">): boolean | null {
    if (f.config.activo !== true || f.autorizado === false) return false;
    if (f.conexion === "comprobando" || f.autorizado === null || f.autorizado === undefined) return null;
    return f.conexion === "conectado";
}

// Motivo, en palabras sencillas, por el que una automatización activa no
// enviará mensajes. null si puede enviar o si aún no se sabe.
export function motivoSinEnvio(conexion: string | undefined, autorizado: boolean | null | undefined): string | null {
    if (autorizado === false) return "El grupo no está autorizado.";
    if (conexion === "no_visto") return "El grupo no aparece en tu WhatsApp.";
    if (conexion === "sin_sesion") return "Tu WhatsApp no está conectado.";
    return null;
}

// ----------------------------------------------------- tipos de mensaje ---

export interface EstadoTipos {
    apertura: boolean;
    recordatorios: boolean;
    actualizacion: boolean;
    cierre: boolean;
    tablaInicial: boolean;
}

// Mismos criterios que ya usa ConfiguracionGrupo.tsx: la apertura cuenta
// como activa salvo que esté explícitamente en false.
export function estadoTipos(config: AutomationConfig): EstadoTipos {
    return {
        apertura: config.mensaje_apertura?.activo !== false,
        recordatorios: Object.values(config.recordatorios || {}).some((c) => c?.activo === true),
        actualizacion: config.mensaje_actualizacion?.activo === true,
        cierre: config.mensaje_cierre?.activo === true,
        tablaInicial: config.publicacion_inicial_tabla?.activo === true
    };
}

// ------------------------------------------------------------- filtros ---

export type FiltroGrupos = "todos" | "autorizados" | "por_autorizar" | "sin_conexion" | "pausados";

export function coincideFiltro(g: GrupoVista, filtro: FiltroGrupos): boolean {
    switch (filtro) {
        case "autorizados": return g.estadoAutorizacion === "autorizado";
        case "por_autorizar": return g.estadoAutorizacion !== "autorizado";
        case "sin_conexion": return g.conexion === "no_visto" || g.conexion === "sin_sesion";
        case "pausados": return g.estadoAutomatizacion === "pausada";
        default: return true;
    }
}

export function filtrarGrupos<G extends GrupoVista>(grupos: G[], filtro: FiltroGrupos, texto: string): G[] {
    const q = texto.trim().toLowerCase();
    return grupos.filter((g) =>
        coincideFiltro(g, filtro) &&
        (!q || (g.nombre || "").toLowerCase().includes(q) || g.grupoId.toLowerCase().includes(q))
    );
}

// Orden estable: primero lo que necesita atención del administrador.
export function ordenarGrupos<G extends GrupoVista>(grupos: G[]): G[] {
    const peso = (g: G) =>
        (g.estadoAutorizacion === "autorizado" ? 0 : 2) +
        (g.conexion === "conectado" ? 0 : 1);
    return [...grupos].sort((a, b) =>
        peso(a) - peso(b) || (a.nombre || "~").localeCompare(b.nombre || "~", "es"));
}

// ------------------------------------------------------------- resumen ---

export interface ProximoEnvio {
    grupoId: string;
    nombre: string;
    offset: number;
    momento: Date | null;
    restanteMs: number;
}

// Próximos recordatorios reales del sorteo en curso (estado «programado» o
// «próximo» calculado por estadoRecordatorio), de todos los grupos con la
// automatización activa, del más cercano al más lejano.
export function proximosEnvios(filas: FilaResumen[], limite = 5): ProximoEnvio[] {

    const lista: ProximoEnvio[] = [];

    for (const f of filas) {
        if (f.config.activo !== true) continue;
        for (const r of f.recordatorios) {
            const est = r.resultado.estado;
            if ((est === "programado" || est === "proximo") && r.resultado.restanteMs !== null) {
                lista.push({
                    grupoId: f.config.grupo_id,
                    nombre: f.nombre,
                    offset: r.resultado.offset,
                    momento: r.resultado.momento,
                    restanteMs: r.resultado.restanteMs
                });
            }
        }
    }

    return lista.sort((a, b) => a.restanteMs - b.restanteMs).slice(0, limite);

}

export interface ResumenAutomatizacionVista {
    // Automatización activa Y grupo autorizado Y conectado. null = comprobando.
    operativas: number | null;
    // Activas en configuración pero sin poder enviar (sin autorización o
    // sin conexión). null = comprobando.
    activasSinEnvio: number | null;
    autorizados: number;
    autorizacionesPausadas: number;
    autorizadosConectados: number | null; // null = comprobando
    visiblesEnWhatsApp: number | null;
    activas: number;
    pausadas: number;
    programados: number;
    pendientes: number | null; // null = seguimiento no disponible
}

export function resumirVista(grupos: GrupoVista[], seguimientoDisponible: boolean): ResumenAutomatizacionVista {

    const comprobando = grupos.some((g) => g.conexion === "comprobando");
    const autorizados = grupos.filter((g) => g.estadoAutorizacion === "autorizado");
    const filas = grupos.map((g) => g.fila).filter(Boolean) as FilaResumen[];

    const capacidad = grupos.filter((g) => g.estadoAutomatizacion === "activa").map(puedeEnviar);
    const sinSaber = capacidad.some((c) => c === null);

    return {
        operativas: sinSaber ? null : capacidad.filter((c) => c === true).length,
        activasSinEnvio: sinSaber ? null : capacidad.filter((c) => c === false).length,
        autorizados: autorizados.length,
        autorizacionesPausadas: grupos.filter((g) => g.estadoAutorizacion === "pausada").length,
        autorizadosConectados: comprobando ? null : autorizados.filter((g) => g.conexion === "conectado").length,
        visiblesEnWhatsApp: comprobando ? null : grupos.filter((g) => g.conexion === "conectado").length,
        activas: filas.filter((f) => f.config.activo === true).length,
        pausadas: filas.filter((f) => f.config.activo !== true).length,
        programados: filas.reduce((n, f) => n + f.programadosActivos, 0),
        pendientes: seguimientoDisponible ? filas.reduce((n, f) => n + f.pendientes, 0) : null
    };

}

export type TonoAviso = "error" | "aviso" | "info";

export interface AvisoAutomatizacion {
    id: string;
    tono: TonoAviso;
    titulo: string;
    detalle: string;
    filtro?: FiltroGrupos;
}

function plural(n: number, uno: string, varios: string) {
    return `${n} ${n === 1 ? uno : varios}`;
}

// Avisos claros para el administrador, solo con hechos comprobados.
export function avisosAutomatizacion(grupos: GrupoVista[], sesiones: SesionConGrupos[] | null): AvisoAutomatizacion[] {

    const avisos: AvisoAutomatizacion[] = [];

    if (sesiones !== null) {

        const conectadas = sesiones.filter((s) => s.estado === "conectada");
        const desconectadas = sesiones.filter((s) => s.estado === "desconectada");
        const sinVerificar = sesiones.filter((s) => s.estado === "no_verificable");

        if (sesiones.length === 0) {
            avisos.push({
                id: "sin-whatsapp", tono: "error",
                titulo: "No tienes ningún WhatsApp vinculado",
                detalle: "Vincula tu número en «Sesiones» para que EFAAT pueda ver tus grupos y enviar mensajes."
            });
        } else if (conectadas.length === 0 && desconectadas.length > 0) {
            avisos.push({
                id: "whatsapp-desconectado", tono: "error",
                titulo: "Tu WhatsApp no está conectado",
                detalle: "Mientras no esté conectado no saldrá ningún mensaje automático. Reconéctalo en «Sesiones»."
            });
        } else if (desconectadas.length > 0) {
            avisos.push({
                id: "alguna-desconectada", tono: "aviso",
                titulo: plural(desconectadas.length, "sesión de WhatsApp desconectada", "sesiones de WhatsApp desconectadas"),
                detalle: desconectadas.map((s) => s.nombreSesion).join(", ")
            });
        }

        if (sinVerificar.length > 0) {
            avisos.push({
                id: "sin-verificar", tono: "aviso",
                titulo: "No pudimos comprobar tu WhatsApp ahora",
                detalle: "Algunos estados de conexión no están confirmados. Tu configuración no cambió; vuelve a intentarlo en unos minutos."
            });
        }

    }

    const hayConectada = (sesiones || []).some((s) => s.estado === "conectada");
    const consultaIncompleta = (sesiones || []).some((s) => s.estado === "no_verificable");

    const autorizadosNoVistos = grupos.filter((g) => g.estadoAutorizacion === "autorizado" && g.conexion === "no_visto");
    if (hayConectada && !consultaIncompleta && autorizadosNoVistos.length > 0) {
        avisos.push({
            id: "autorizados-no-vistos", tono: "aviso",
            titulo: `${plural(autorizadosNoVistos.length, "grupo autorizado no aparece", "grupos autorizados no aparecen")} en tu WhatsApp`,
            detalle: "Puede que el grupo se haya eliminado o que tu número ya no forme parte de él. Su configuración se conserva.",
            filtro: "sin_conexion"
        });
    }

    const activaSinAutorizar = grupos.filter((g) => g.estadoAutomatizacion === "activa" && g.estadoAutorizacion !== "autorizado");
    if (activaSinAutorizar.length > 0) {
        avisos.push({
            id: "activa-sin-autorizar", tono: "aviso",
            titulo: `${plural(activaSinAutorizar.length, "grupo tiene", "grupos tienen")} la automatización activa sin autorización`,
            detalle: "No enviarán mensajes automáticos hasta que autorices (o reactives) el grupo.",
            filtro: "por_autorizar"
        });
    }

    const conErrores = grupos.filter((g) => tieneErrorEnvio(g.fila));
    if (conErrores.length > 0) {
        avisos.push({
            id: "errores-envio", tono: "error",
            titulo: `${plural(conErrores.length, "grupo tuvo", "grupos tuvieron")} un error de envío en el sorteo actual`,
            detalle: "Revisa la actividad del grupo en el Centro de control."
        });
    }

    const sesionInactiva = grupos.filter((g) => g.fila?.sesionNoActiva);
    if (sesionInactiva.length > 0) {
        avisos.push({
            id: "sesion-no-activa", tono: "aviso",
            titulo: `${plural(sesionInactiva.length, "grupo tiene", "grupos tienen")} el sorteo en un WhatsApp que no está en servicio`,
            detalle: "Sus mensajes programados no saldrán mientras ese WhatsApp no esté en servicio."
        });
    }

    const porAutorizar = grupos.filter((g) => g.conexion === "conectado" && g.estadoAutorizacion === "no_autorizado");
    if (porAutorizar.length > 0) {
        avisos.push({
            id: "por-autorizar", tono: "info",
            titulo: `${plural(porAutorizar.length, "grupo de tu WhatsApp aún no está autorizado", "grupos de tu WhatsApp aún no están autorizados")}`,
            detalle: "Autorízalos si quieres que EFAAT automatice sus mensajes.",
            filtro: "por_autorizar"
        });
    }

    return avisos;

}
