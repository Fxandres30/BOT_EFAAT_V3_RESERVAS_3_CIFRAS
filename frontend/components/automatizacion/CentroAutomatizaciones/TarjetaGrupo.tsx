"use client";

import Link from "next/link";
import { AlertTriangle, CalendarPlus, Copy, History, MessageSquareText, Settings2, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { formatHora12 } from "@/lib/formatHora";
import { formatearHace, formatearMomento, formatearRestante } from "@/services/automatizacion/estadoProgramacion";

import type { FilaGrupo } from "./filaGrupo";
import styles from "./CentroAutomatizaciones.module.css";

export type SeccionEditor = "general" | "programaciones" | "mensajes" | "tabla" | "reglas";

interface Props {
    fila: FilaGrupo;
    ahora: Date;
    seleccionada: boolean;
    cambiandoActivo: boolean;
    onSeleccionar: () => void;
    onAlternarActivo: () => void;
    onEditar: (seccion: SeccionEditor) => void;
    onHistorial: () => void;
    onDuplicar: () => void;
}

const CONEXION: Record<FilaGrupo["conexion"], { texto: string; tono: BadgeTone }> = {
    conectado: { texto: "Conectado", tono: "success" },
    no_visto: { texto: "No aparece en WhatsApp", tono: "error" },
    sin_sesion: { texto: "Sin WhatsApp conectado", tono: "error" },
    no_verificable: { texto: "Conexión sin verificar", tono: "warning" },
    comprobando: { texto: "Comprobando…", tono: "neutral" }
};

export default function TarjetaGrupo({ fila, ahora, seleccionada, cambiandoActivo, onSeleccionar, onAlternarActivo, onEditar, onHistorial, onDuplicar }: Props) {

    const { config, evento, cierre, horaCierre, resumen } = fila;
    const activo = config.activo === true;
    const conexion = CONEXION[fila.conexion];
    const restante = cierre ? cierre.getTime() - ahora.getTime() : null;

    return (

        <article className={`${styles.card} ${seleccionada ? styles.cardSeleccionada : ""} ${activo ? "" : styles.cardApagada}`}>

            <div className={styles.cardHeader}>

                <input
                    type="checkbox"
                    className={styles.check}
                    checked={seleccionada}
                    onChange={onSeleccionar}
                    aria-label={`Seleccionar ${fila.nombre}`}
                />

                <div className={styles.cardTitulo}>
                    <span className={styles.cardNombre} title={fila.nombre}>{fila.nombre}</span>
                    <div className={styles.badges}>
                        <Badge tone={conexion.tono} size="sm" dot>{conexion.texto}</Badge>
                        <Badge tone={activo ? "success" : "neutral"} size="sm">
                            {activo ? "Automatización activa" : "Automatización desactivada"}
                        </Badge>
                        {fila.autorizado === false && <Badge tone="warning" size="sm">Grupo no autorizado</Badge>}
                    </div>
                </div>

                <button
                    type="button"
                    role="switch"
                    aria-checked={activo}
                    aria-label={activo ? `Desactivar la automatización de ${fila.nombre}` : `Activar la automatización de ${fila.nombre}`}
                    title={activo ? "Desactivar automatización" : "Activar automatización"}
                    className={`${styles.switch} ${activo ? styles.switchOn : ""}`}
                    disabled={cambiandoActivo}
                    onClick={onAlternarActivo}
                />

            </div>

            {!fila.datosDisponibles ? (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Estado del evento no disponible</span>
                    <span className={styles.eventoCierre}>No pudimos consultarlo; no se muestra ningún estado de envío.</span>
                </div>

            ) : !evento ? (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Sin evento activo</span>
                    <span className={styles.eventoCierre}>Los mensajes se programan cuando se detecte el próximo sorteo en el grupo.</span>
                </div>

            ) : (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Evento activo · {evento.nombre_evento || "Sorteo sin nombre"}</span>
                    <span className={styles.eventoCierre}>
                        {cierre ? (
                            <>
                                Cierre {formatearMomento(cierre, ahora)} ·{" "}
                                {restante !== null && restante > 0
                                    ? <strong>faltan {formatearRestante(restante)}</strong>
                                    : <strong>hora de cierre alcanzada</strong>}
                            </>
                        ) : horaCierre ? (
                            <>Cierre {formatHora12(horaCierre)} · fecha no confirmada</>
                        ) : (
                            <>Sin hora de cierre registrada</>
                        )}
                    </span>
                    {!fila.ciclo && <span className={styles.eventoCierre}>La automatización no está en marcha para este evento.</span>}
                    {fila.ciclo && fila.ciclo.estado !== "abierto" && (
                        <span className={styles.eventoCierre}>
                            {fila.ciclo.estado === "pendiente" ? "Esperando la apertura del grupo." : "El evento se está cerrando."}
                        </span>
                    )}
                </div>

            )}

            {fila.sesionNoActiva && (
                <p className={styles.alerta}>
                    <AlertTriangle size={14} />
                    El evento es de una sesión de WhatsApp que no está activa: sus mensajes no saldrán mientras no lo esté.
                </p>
            )}

            <dl className={styles.datos}>
                <div className={styles.dato}>
                    <dt>Programados</dt>
                    <dd>
                        {fila.recordatorios.length === 0
                            ? "Ninguno"
                            : `${fila.recordatorios.filter((r) => r.activo).length} activos de ${fila.recordatorios.length}`}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Próximo mensaje</dt>
                    <dd>
                        {!activo
                            ? "En pausa"
                            : resumen.proximo && resumen.proximo.restanteMs !== null
                                ? `${resumen.proximo.offset} min antes · en ${formatearRestante(resumen.proximo.restanteMs)}`
                                : evento ? "Ninguno pendiente" : "Sin evento"}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Último enviado</dt>
                    <dd>
                        {resumen.ultimoEnviado
                            ? `${resumen.ultimoEnviado.tipo} · ${formatearHace(resumen.ultimoEnviado.en, ahora)}`
                            : evento ? "Ninguno en este evento" : "—"}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Tabla inicial</dt>
                    <dd>
                        {config.publicacion_inicial_tabla?.activo
                            ? `Activa · ${formatHora12(config.publicacion_inicial_tabla.hora)}`
                            : "Desactivada"}
                    </dd>
                </div>
            </dl>

            {fila.recordatorios.some((r) => r.resultado.estado === "error") && (
                <p className={styles.alertaError}>
                    <AlertTriangle size={14} /> Hubo un error de envío en este evento. Revisa el historial.
                </p>
            )}

            <div className={styles.cardPie}>
                <div className={styles.cardAcciones}>
                    <button type="button" className={styles.accionPrincipal} onClick={() => onEditar("general")}>
                        <Settings2 size={13} /> Editar
                    </button>
                    <button type="button" className={styles.accion} onClick={() => onEditar("programaciones")} title="Agregar programación">
                        <CalendarPlus size={13} /> Programar
                    </button>
                    <button type="button" className={styles.accion} onClick={() => onEditar("mensajes")} title="Administrar mensajes">
                        <MessageSquareText size={13} /> Mensajes
                    </button>
                    <button type="button" className={styles.accion} onClick={onHistorial} title="Consultar historial">
                        <History size={13} /> Historial
                    </button>
                    <button type="button" className={styles.accion} onClick={onDuplicar} title="Copiar esta configuración a otros grupos">
                        <Copy size={13} /> Duplicar
                    </button>
                    <Link
                        href={`/automatizacion/grupos/${encodeURIComponent(config.grupo_id)}`}
                        prefetch={false}
                        className={styles.accion}
                        title="Detalles del grupo: inicio del día, apertura y sticker de pago"
                    >
                        <SlidersHorizontal size={13} /> Detalles
                    </Link>
                </div>
            </div>

        </article>

    );

}
