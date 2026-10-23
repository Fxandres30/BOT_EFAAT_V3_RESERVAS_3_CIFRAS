"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { formatHora12 } from "@/lib/formatHora";

import type { AutomationConfig } from "@/services/automatizacion/automationConfigs";
import type { CicloAutomatizacion, EventoActivo } from "@/services/automatizacion/seguimientoProgramacion";
import { nombreCategoria } from "@/services/automatizacion/tiposCategorias";
import {
    AccionRegistrada,
    ConexionGrupo,
    EstadoRecordatorio,
    calcularCierreReal,
    claveRecordatorio,
    estadoRecordatorio,
    fechaValida,
    formatearHace,
    formatearMomento,
    formatearRestante,
    nombreAccion,
    resumirEnvios
} from "@/services/automatizacion/estadoProgramacion";

import styles from "./ProgramacionAutomatizacion.module.css";

type Props = {
    config: AutomationConfig;
    nombre: string;
    conexion: ConexionGrupo | "comprobando";
    evento: EventoActivo | null;
    ciclo: CicloAutomatizacion | null;
    acciones: AccionRegistrada[];
    // false = no se pudo leer el seguimiento: no se afirma ningún estado.
    datosDisponibles: boolean;
    // null = no se pudo leer; [] = el usuario no tiene ninguna activa.
    sesionesActivas: string[] | null;
    ahora: Date;
};

const TEXTO_CONEXION: Record<Props["conexion"], string> = {
    conectado: "Conectado",
    no_visto: "No aparece en tus sesiones conectadas",
    sin_sesion: "Sin sesión conectada",
    no_verificable: "Conexión sin verificar",
    comprobando: "Comprobando conexión…"
};

type Tono = "neutro" | "info" | "ok" | "aviso" | "error";

const TONO_CLASE: Record<Tono, string> = {
    neutro: styles.tonoNeutro,
    info: styles.tonoInfo,
    ok: styles.tonoOk,
    aviso: styles.tonoAviso,
    error: styles.tonoError
};

const TONO_ESTADO: Record<EstadoRecordatorio, Tono> = {
    desactivado: "neutro",
    sin_evento: "neutro",
    sin_hora: "aviso",
    programado: "info",
    proximo: "info",
    pendiente: "info",
    enviando: "info",
    sin_registro: "aviso",
    sin_confirmar: "aviso",
    enviado: "ok",
    omitido: "neutro",
    error: "error",
    no_enviado: "aviso"
};

const TEXTO_ESTADO_ACCION: Record<string, string> = {
    ok: "enviado",
    error: "error",
    en_progreso: "en curso"
};

export default function TarjetaProgramacion({ config, nombre, conexion, evento, ciclo, acciones, datosDisponibles, sesionesActivas, ahora }: Props) {

    // El Scheduler solo procesa ciclos "abierto" (scheduler.js::procesarEventSession).
    const cicloAbierto = !!evento && ciclo?.estado === "abierto";

    const snapshot = ciclo?.datos_evento_snapshot || null;
    const horaCierre = snapshot?.hora_cierre || evento?.hora_cierre || null;
    const fechaEvento = snapshot?.fecha_evento || evento?.fecha_evento || null;
    const cierre = evento ? calcularCierreReal(fechaEvento, horaCierre) : null;

    const porClave = new Map(acciones.map((a) => [a.clave_idempotencia, a]));

    const recordatorios = Object.entries(config.recordatorios || {})
        .map(([texto, cfg]) => ({ offset: Number(texto), cfg }))
        .filter((r) => Number.isFinite(r.offset) && r.offset >= 0)
        .sort((a, b) => b.offset - a.offset)
        .map(({ offset, cfg }) => ({
            cfg,
            resultado: estadoRecordatorio({
                offset,
                activo: cfg?.activo === true,
                cierre,
                cicloAbierto,
                accion: ciclo ? porClave.get(claveRecordatorio(ciclo.id, offset)) || null : null,
                ahora
            })
        }));

    const { proximo, ultimoEnviado } = resumirEnvios(recordatorios.map((r) => r.resultado), acciones);

    const hayActivos = recordatorios.some((r) => r.cfg?.activo === true);
    const sesionNoActiva = cicloAbierto && hayActivos && sesionesActivas !== null &&
        (!ciclo?.session_id || !sesionesActivas.includes(ciclo.session_id));

    const restanteCierre = cierre ? cierre.getTime() - ahora.getTime() : null;

    return (

        <div className={styles.card}>

            <div className={styles.cardHeader}>
                <span className={styles.cardName} title={nombre}>{nombre}</span>
                <Link
                    href={`/automatizacion/grupos/${encodeURIComponent(config.grupo_id)}`}
                    className={styles.editLink}
                >
                    Editar
                </Link>
            </div>

            <div className={styles.badges}>
                <span className={`${styles.badge} ${TONO_CLASE[conexion === "conectado" ? "ok" : conexion === "comprobando" ? "neutro" : "aviso"]}`}>
                    {TEXTO_CONEXION[conexion]}
                </span>
                <span className={`${styles.badge} ${TONO_CLASE[config.activo ? "ok" : "neutro"]}`}>
                    Automatización {config.activo ? "activa" : "desactivada"}
                </span>
            </div>

            {/* Evento activo y cierre */}
            {!datosDisponibles ? (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Estado del evento no disponible</span>
                    <span className={styles.nota}>No pudimos consultarlo; los recordatorios se muestran sin confirmar.</span>
                </div>

            ) : !evento ? (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Sin evento activo</span>
                </div>

            ) : (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>{evento.nombre_evento || "Evento sin nombre"}</span>
                    <span className={styles.eventoCierre}>
                        {cierre ? (
                            <>
                                Cierre {formatearMomento(cierre, ahora)}
                                {" · "}
                                {restanteCierre !== null && restanteCierre > 0
                                    ? <strong>faltan {formatearRestante(restanteCierre)}</strong>
                                    : <strong>hora de cierre alcanzada</strong>}
                            </>
                        ) : horaCierre ? (
                            <>Cierre {formatHora12(horaCierre)} · fecha no confirmada</>
                        ) : (
                            <>Sin hora de cierre registrada</>
                        )}
                    </span>
                    {!ciclo && (
                        <span className={styles.nota}>La automatización no está en marcha para este evento.</span>
                    )}
                    {ciclo && ciclo.estado !== "abierto" && (
                        <span className={styles.nota}>
                            {ciclo.estado === "pendiente" ? "Esperando la apertura del grupo." : "El evento se está cerrando."}
                        </span>
                    )}
                </div>

            )}

            {sesionNoActiva && (
                <p className={styles.alerta}>
                    <AlertTriangle size={14} />
                    Este evento es de una sesión de WhatsApp que no está activa: sus recordatorios no se enviarán mientras no lo esté.
                </p>
            )}

            {/* Próximo recordatorio y último envío */}
            {evento && (
                <div className={styles.resumen}>
                    <span>
                        Próximo:{" "}
                        {proximo && proximo.restanteMs !== null
                            ? <strong>{proximo.offset} min antes · en {formatearRestante(proximo.restanteMs)}</strong>
                            : "ninguno pendiente"}
                    </span>
                    <span>
                        Último envío:{" "}
                        {ultimoEnviado
                            ? <>{ultimoEnviado.tipo} · {formatearMomento(ultimoEnviado.en, ahora)} ({formatearHace(ultimoEnviado.en, ahora)})</>
                            : "ninguno registrado en este evento"}
                    </span>
                </div>
            )}

            {/* Recordatorios con su estado real */}
            <div className={styles.section}>

                {recordatorios.length === 0 && (
                    <p className={styles.nota}>Sin recordatorios configurados.</p>
                )}

                {recordatorios.map(({ cfg, resultado }) => (

                    <div key={resultado.offset} className={styles.recordatorio}>

                        <div className={styles.row}>
                            <span>
                                {resultado.offset} min antes
                                {resultado.momento && evento && (
                                    <span className={styles.rowHora}> · {formatearMomento(resultado.momento, ahora)}</span>
                                )}
                            </span>
                            {datosDisponibles || resultado.estado === "desactivado" ? (
                                <span className={`${styles.badge} ${TONO_CLASE[TONO_ESTADO[resultado.estado]]}`}>
                                    {resultado.etiqueta}
                                    {resultado.restanteMs !== null && ` · ${formatearRestante(resultado.restanteMs)}`}
                                </span>
                            ) : (
                                <span className={`${styles.badge} ${TONO_CLASE.neutro}`}>Sin confirmar</span>
                            )}
                        </div>

                        <span className={styles.recordatorioInfo}>
                            {nombreCategoria(cfg?.categoria ?? null)}
                            {resultado.registradoEn && ` · ${formatearMomento(resultado.registradoEn, ahora)}`}
                            {datosDisponibles && resultado.motivo && ` · ${resultado.motivo}`}
                        </span>

                    </div>

                ))}

            </div>

            <div className={styles.row}>
                <span>Tabla inicial</span>
                <span className={styles.rowValue}>
                    <span className={`${styles.dot} ${config.publicacion_inicial_tabla?.activo ? styles.dotOn : ""}`} aria-hidden="true" />
                    {config.publicacion_inicial_tabla?.activo
                        ? formatHora12(config.publicacion_inicial_tabla.hora)
                        : "desactivada"}
                </span>
            </div>

            <div className={styles.foot}>
                <span>Actualización: {config.mensaje_actualizacion?.activo ? "sí" : "no"}</span>
                <span>Umbral: {config.umbral_reservas}</span>
                <span>Espera entre avisos: {config.cooldown_minutos} min</span>
            </div>

            {/* Diagnóstico: identificadores e historial del evento */}
            <details className={styles.detalles}>
                <summary>Detalles e historial</summary>

                <dl className={styles.detallesLista}>
                    <dt>Identificador del grupo</dt>
                    <dd><code>{config.grupo_id}</code></dd>
                    {ciclo && (
                        <>
                            <dt>Ciclo de automatización</dt>
                            <dd><code>{ciclo.id}</code> · {ciclo.estado}</dd>
                        </>
                    )}
                </dl>

                {acciones.length === 0 ? (
                    <p className={styles.nota}>
                        {ciclo ? "Sin envíos registrados en este evento." : "No hay historial: no hay un evento con la automatización en marcha."}
                    </p>
                ) : (
                    <ul className={styles.historial}>
                        {acciones.map((a) => {
                            const en = fechaValida(a.finalizado_en) || fechaValida(a.ejecutado_en);
                            const omitido = (a.detalle?.resultado as Record<string, unknown> | undefined)?.omitido === true;
                            const detalle = typeof a.detalle?.mensaje === "string" ? a.detalle.mensaje : null;
                            return (
                                <li key={a.id}>
                                    <span>{nombreAccion(a.tipo_accion)}</span>
                                    <span className={styles.rowValue}>
                                        {omitido ? "omitido" : TEXTO_ESTADO_ACCION[a.estado] || a.estado}
                                        {en && ` · ${formatearMomento(en, ahora)}`}
                                    </span>
                                    {detalle && <code className={styles.historialDetalle}>{detalle}</code>}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </details>

        </div>

    );

}
