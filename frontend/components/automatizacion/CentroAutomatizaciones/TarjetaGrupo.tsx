"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarPlus, Copy, History, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { formatearHace, formatearMomento } from "@/services/automatizacion/estadoProgramacion";
import { estadoTipos, motivoSinEnvio, puedeEnviarFila, tieneErrorEnvio } from "@/services/automatizacion/vistaGrupos";

import { AUTORIZACION, CONEXION, TIPOS_VISIBLES, horaLegible, restanteCorto } from "../compartido/estados";
import type { FilaGrupo } from "./filaGrupo";
import styles from "./CentroAutomatizaciones.module.css";

// Sin sección «mensajes»: el contenido se administra solo en /mensajes.
export type SeccionEditor = "general" | "programaciones" | "tabla" | "reglas";

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

export default function TarjetaGrupo({ fila, ahora, seleccionada, cambiandoActivo, onSeleccionar, onAlternarActivo, onEditar, onHistorial, onDuplicar }: Props) {

    const { config, evento, cierre, horaCierre, resumen } = fila;
    const activo = config.activo === true;
    const conexion = CONEXION[fila.conexion];
    const restante = cierre ? cierre.getTime() - ahora.getTime() : null;
    const tipos = estadoTipos(config);
    const envia = puedeEnviarFila(fila);
    const motivo = activo && envia === false ? motivoSinEnvio(fila.conexion, fila.autorizado) : null;

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
                        <Badge tone={conexion.tono} size="sm" dot title={conexion.explicacion}>{conexion.texto}</Badge>
                        {fila.autorizado === false && <Badge tone={AUTORIZACION.no_autorizado.tono} size="sm">No autorizado</Badge>}
                        {motivo
                            ? <Badge tone="warning" size="sm" title={motivo}>Activa · no envía</Badge>
                            : <Badge tone={activo ? "primary" : "neutral"} size="sm">{activo ? "Automatización activa" : "Automatización pausada"}</Badge>}
                    </div>
                </div>

            </div>

            {motivo && (
                <p className={styles.alerta}><AlertTriangle size={14} /> {motivo} Mientras tanto no saldrá ningún mensaje automático.</p>
            )}

            {!fila.datosDisponibles ? (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Sorteo no disponible</span>
                    <span className={styles.eventoCierre}>No pudimos consultarlo; no se muestra ningún estado de envío.</span>
                </div>

            ) : !evento ? (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Sin sorteo en curso</span>
                    <span className={styles.eventoCierre}>Los mensajes se programan cuando se detecte el próximo sorteo en el grupo.</span>
                </div>

            ) : (

                <div className={styles.evento}>
                    <span className={styles.eventoNombre}>Sorteo: {evento.nombre_evento || "sin nombre"}</span>
                    <span className={styles.eventoCierre}>
                        {cierre ? (
                            <>
                                Cierre {formatearMomento(cierre, ahora)} ·{" "}
                                {restante !== null && restante > 0
                                    ? <strong>faltan {restanteCorto(restante)}</strong>
                                    : <strong>cierre alcanzado</strong>}
                            </>
                        ) : horaCierre ? (
                            <>Cierre {horaLegible(horaCierre)} · fecha no confirmada</>
                        ) : (
                            <>Sin hora de cierre registrada</>
                        )}
                    </span>
                    {!fila.ciclo && <span className={styles.eventoCierre}>La automatización no está en marcha para este sorteo.</span>}
                    {fila.ciclo && fila.ciclo.estado !== "abierto" && (
                        <span className={styles.eventoCierre}>
                            {fila.ciclo.estado === "pendiente" ? "Esperando la apertura del grupo." : "El sorteo se está cerrando."}
                        </span>
                    )}
                </div>

            )}

            {fila.sesionNoActiva && (
                <p className={styles.alerta}>
                    <AlertTriangle size={14} />
                    El sorteo está en un WhatsApp que no está en servicio: sus mensajes no saldrán mientras no lo esté.
                </p>
            )}

            <div className={styles.tiposFila} aria-label="Mensajes automáticos de este grupo">
                {TIPOS_VISIBLES.map((t) => (
                    <span key={t.clave} className={`${styles.tipoChip} ${tipos[t.clave] ? styles.tipoChipOn : ""}`}>
                        {t.texto} · {tipos[t.clave] ? "activo" : "pausado"}
                    </span>
                ))}
            </div>

            <dl className={styles.datos}>
                <div className={styles.dato}>
                    <dt>Programados</dt>
                    <dd>
                        {fila.recordatorios.length === 0
                            ? "Ninguno"
                            : `${fila.recordatorios.filter((r) => r.activo).length} de ${fila.recordatorios.length} activos`}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Próximo envío</dt>
                    <dd>
                        {!activo
                            ? "En pausa"
                            : motivo ? "No saldrá"
                                : resumen.proximo && resumen.proximo.restanteMs !== null
                                    ? `Recordatorio en ${restanteCorto(resumen.proximo.restanteMs)}`
                                    : evento ? "Ninguno pendiente" : "Sin sorteo"}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Último enviado</dt>
                    <dd>
                        {resumen.ultimoEnviado
                            ? `${resumen.ultimoEnviado.tipo} · ${formatearHace(resumen.ultimoEnviado.en, ahora)}`
                            : evento ? "Ninguno en este sorteo" : "—"}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Tabla inicial</dt>
                    <dd>
                        {config.publicacion_inicial_tabla?.activo
                            ? `Activa · ${horaLegible(config.publicacion_inicial_tabla.hora)}`
                            : "Pausada"}
                    </dd>
                </div>
            </dl>

            {tieneErrorEnvio(fila) && (
                <p className={styles.alertaError}>
                    <AlertTriangle size={14} /> Hubo un error de envío en este sorteo. Revisa la actividad.
                </p>
            )}

            <div className={styles.cardPie}>
                <div className={styles.cardAcciones}>
                    <button type="button" className={styles.accionPrincipal} onClick={() => onEditar("general")}>
                        <Settings2 size={13} /> Configurar
                    </button>
                    <button type="button" className={styles.accion} onClick={() => onEditar("programaciones")} title="Programar recordatorios">
                        <CalendarPlus size={13} /> Programar
                    </button>
                    <button type="button" className={styles.accion} onClick={onHistorial}>
                        <History size={13} /> Actividad
                    </button>
                </div>
                <div className={styles.pieSecundario}>
                    <label className={styles.interruptorTexto}>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={activo}
                            className={`${styles.switch} ${activo ? styles.switchOn : ""}`}
                            disabled={cambiandoActivo}
                            onClick={onAlternarActivo}
                        />
                        {activo ? "Automatización activa" : "Automatización pausada"}
                    </label>
                    <span className={styles.enlacesPie}>
                        <button type="button" className={styles.enlaceBiblioteca} onClick={onDuplicar} title="Copiar esta configuración a otros grupos">
                            <Copy size={12} /> Copiar
                        </button>
                        <Link href={`/automatizacion/grupos/${encodeURIComponent(config.grupo_id)}`} prefetch={false} className={styles.enlaceBiblioteca}>
                            Detalles <ArrowRight size={12} />
                        </Link>
                    </span>
                </div>
            </div>

        </article>

    );

}
