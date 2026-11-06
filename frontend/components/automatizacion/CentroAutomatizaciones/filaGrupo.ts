import type { AutomationConfig } from "@/services/automatizacion/automationConfigs";
import type { CicloAutomatizacion, EventoActivo, SeguimientoProgramacion } from "@/services/automatizacion/seguimientoProgramacion";
import type { SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import {
    AccionRegistrada,
    ConexionGrupo,
    ResultadoRecordatorio,
    ResumenEnvios,
    calcularCierreReal,
    claveRecordatorio,
    conexionDeGrupo,
    estadoRecordatorio,
    resolverNombreGrupo,
    resumirEnvios
} from "@/services/automatizacion/estadoProgramacion";
import { listarProgramaciones } from "@/services/automatizacion/centroAutomatizaciones";

// Todo lo que una tarjeta (y el editor) necesita de un grupo, calculado una
// sola vez a partir de datos reales. Nada se supone: sin seguimiento
// (`datosDisponibles=false`) no se afirma ningún estado de envío.
export interface FilaGrupo {
    config: AutomationConfig;
    nombre: string;
    conexion: ConexionGrupo | "comprobando";
    autorizado: boolean | null; // null = no se pudo leer
    datosDisponibles: boolean;
    evento: EventoActivo | null;
    ciclo: CicloAutomatizacion | null;
    cicloAbierto: boolean;
    cierre: Date | null;
    horaCierre: string | null;
    acciones: AccionRegistrada[];
    recordatorios: { clave: string; categoria: string | null; activo: boolean; resultado: ResultadoRecordatorio }[];
    resumen: ResumenEnvios;
    programadosActivos: number;
    pendientes: number;
    sesionNoActiva: boolean;
}

export function nombreEnVivo(grupoId: string, sesiones: SesionConGrupos[] | null): string | null {

    for (const sesion of sesiones || []) {
        const grupo = sesion.grupos.find((g) => g.id === grupoId);
        if (grupo?.nombre) return grupo.nombre;
    }

    return null;

}

export function construirFila(
    config: AutomationConfig,
    seguimiento: SeguimientoProgramacion | null,
    sesiones: SesionConGrupos[] | null,
    autorizados: Set<string> | null,
    ahora: Date
): FilaGrupo {

    const evento = seguimiento?.eventos[config.grupo_id] || null;
    const cicloGrupo = seguimiento?.ciclos[config.grupo_id] || null;
    const ciclo = cicloGrupo && evento && (!cicloGrupo.evento_id || cicloGrupo.evento_id === evento.id) ? cicloGrupo : null;
    const acciones = ciclo ? seguimiento?.acciones[ciclo.id] || [] : [];

    // El Scheduler solo procesa ciclos "abierto".
    const cicloAbierto = !!evento && ciclo?.estado === "abierto";

    const snapshot = ciclo?.datos_evento_snapshot || null;
    const horaCierre = snapshot?.hora_cierre || evento?.hora_cierre || null;
    const fechaEvento = snapshot?.fecha_evento || evento?.fecha_evento || null;
    const cierre = evento ? calcularCierreReal(fechaEvento, horaCierre) : null;

    const porClave = new Map(acciones.map((a) => [a.clave_idempotencia, a]));

    const recordatorios = listarProgramaciones(config.recordatorios).map(({ clave, minutos, cfg }) => ({
        clave,
        categoria: cfg.categoria,
        activo: cfg.activo,
        resultado: estadoRecordatorio({
            offset: minutos,
            activo: cfg.activo,
            cierre,
            cicloAbierto,
            accion: ciclo ? porClave.get(claveRecordatorio(ciclo.id, minutos)) || null : null,
            ahora,
            automatizacionActiva: config.activo === true
        })
    }));

    const resumen = resumirEnvios(recordatorios.map((r) => r.resultado), acciones);

    const sesionesActivas = seguimiento ? seguimiento.sesionesActivas : null;
    const hayActivos = recordatorios.some((r) => r.activo);

    return {
        config,
        nombre: resolverNombreGrupo(
            nombreEnVivo(config.grupo_id, sesiones),
            evento?.grupo_nombre,
            seguimiento?.nombres[config.grupo_id],
            cicloGrupo?.datos_evento_snapshot?.grupo_nombre
        ),
        conexion: sesiones ? conexionDeGrupo(config.grupo_id, sesiones) : "comprobando",
        autorizado: autorizados ? autorizados.has(config.grupo_id) : null,
        datosDisponibles: !!seguimiento,
        evento,
        ciclo,
        cicloAbierto,
        cierre,
        horaCierre,
        acciones,
        recordatorios,
        resumen,
        programadosActivos: config.activo ? recordatorios.filter((r) => r.activo).length : 0,
        pendientes: seguimiento
            ? recordatorios.filter((r) => ["programado", "proximo", "pendiente"].includes(r.resultado.estado)).length
            : 0,
        sesionNoActiva: cicloAbierto && hayActivos && sesionesActivas !== null &&
            (!ciclo?.session_id || !sesionesActivas.includes(ciclo.session_id))
    };

}
