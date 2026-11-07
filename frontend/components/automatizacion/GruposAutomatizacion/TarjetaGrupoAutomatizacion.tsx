"use client";

import Link from "next/link";
import { AlertTriangle, CalendarPlus, History, Pause, Play, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/Badge";

import { formatHora12 } from "@/lib/formatHora";
import { formatearHace, formatearMomento, formatearRestante } from "@/services/automatizacion/estadoProgramacion";
import { estadoTipos, GrupoVista } from "@/services/automatizacion/vistaGrupos";

import type { FilaGrupo } from "../CentroAutomatizaciones/filaGrupo";
import { AUTOMATIZACION, AUTORIZACION, CONEXION, TIPOS_VISIBLES } from "../compartido/estados";
import styles from "../compartido/Automatizacion.module.css";

interface Props {
    grupo: GrupoVista<FilaGrupo>;
    ahora: Date;
    stickerPropio: boolean | null | undefined; // undefined = cargando · null = no se pudo consultar
    stickerGeneral: boolean | null;  // null = aún cargando
    procesando: boolean;
    onAutorizar: () => void;
    onReactivarAutorizacion: () => void;
    onDesactivarAutorizacion: () => void;
    onAlternarAutomatizacion: () => void;
    onConfigurar: () => void;
    onProgramar: () => void;
}

export default function TarjetaGrupoAutomatizacion({
    grupo, ahora, stickerPropio, stickerGeneral, procesando,
    onAutorizar, onReactivarAutorizacion, onDesactivarAutorizacion, onAlternarAutomatizacion, onConfigurar, onProgramar
}: Props) {

    const { fila } = grupo;
    const conexion = CONEXION[grupo.conexion];
    const autorizacion = AUTORIZACION[grupo.estadoAutorizacion];
    const automatizacion = AUTOMATIZACION[grupo.estadoAutomatizacion];
    const tipos = fila ? estadoTipos(fila.config) : null;
    const activa = grupo.estadoAutomatizacion === "activa";
    const detalle = `/automatizacion/grupos/${encodeURIComponent(grupo.grupoId)}`;
    const restante = fila?.cierre ? fila.cierre.getTime() - ahora.getTime() : null;

    const sticker = stickerPropio === undefined
        ? "…"
        : stickerPropio
        ? "Propio de este grupo"
        : stickerPropio === null
            ? "—"
            : stickerGeneral === null ? "…" : stickerGeneral ? "Predeterminado" : "Ninguno configurado";

    return (

        <article className={`${styles.card} ${activa || grupo.estadoAutomatizacion === "sin_configurar" ? "" : styles.cardAtenuada}`}>

            <div className={styles.cardCabecera}>
                <div className={styles.cardTitulo}>
                    {grupo.nombre ? (
                        <span className={styles.cardNombre} title={grupo.nombre}>{grupo.nombre}</span>
                    ) : (
                        <span className={styles.cardNombreSin}>Grupo sin nombre disponible</span>
                    )}
                    {grupo.nombre && !grupo.nombreConfirmado && <span className={styles.nombreNota}>Último nombre registrado</span>}
                    <div className={styles.badges}>
                        <Badge tone={conexion.tono} size="sm" dot title={conexion.explicacion}>{conexion.texto}</Badge>
                        <Badge tone={autorizacion.tono} size="sm" title={autorizacion.explicacion}>{autorizacion.texto}</Badge>
                        <Badge tone={automatizacion.tono} size="sm" title={automatizacion.explicacion}>{automatizacion.texto}</Badge>
                    </div>
                </div>
            </div>

            {fila && (
                !fila.datosDisponibles ? (
                    <div className={styles.sorteo}>
                        <span className={styles.sorteoNombre}>Sorteo actual no disponible</span>
                        <span>No pudimos consultarlo ahora.</span>
                    </div>
                ) : fila.evento ? (
                    <div className={styles.sorteo}>
                        <span className={styles.sorteoNombre}>{fila.evento.nombre_evento || "Sorteo sin nombre"}</span>
                        <span>
                            {fila.cierre
                                ? <>Cierre {formatearMomento(fila.cierre, ahora)} · {restante !== null && restante > 0 ? `faltan ${formatearRestante(restante)}` : "cierre alcanzado"}</>
                                : fila.horaCierre ? `Cierre ${formatHora12(fila.horaCierre)}` : "Sin hora de cierre registrada"}
                        </span>
                    </div>
                ) : (
                    <div className={styles.sorteo}>
                        <span className={styles.sorteoNombre}>Sin sorteo activo</span>
                        <span>Los mensajes se programan cuando se detecte el próximo sorteo.</span>
                    </div>
                )
            )}

            {tipos && (
                <div className={styles.tipos} aria-label="Mensajes automáticos de este grupo">
                    {TIPOS_VISIBLES.map((t) => (
                        <span key={t.clave} className={styles.tipo}>
                            {t.texto}
                            <span className={`${styles.tipoEstado} ${tipos[t.clave] ? styles.tipoOn : ""}`}>{tipos[t.clave] ? "Activo" : "Pausado"}</span>
                        </span>
                    ))}
                </div>
            )}

            <dl className={styles.datos}>
                <div className={styles.dato}>
                    <dt>Programados</dt>
                    <dd>{fila ? (fila.recordatorios.length === 0 ? "Ninguno" : `${fila.recordatorios.filter((r) => r.activo).length} de ${fila.recordatorios.length} activos`) : "—"}</dd>
                </div>
                <div className={styles.dato}>
                    <dt>Próximo envío</dt>
                    <dd>
                        {!fila ? "—"
                            : !activa ? "En pausa"
                                : !fila.datosDisponibles ? "No disponible"
                                    : fila.resumen.proximo && fila.resumen.proximo.restanteMs !== null
                                        ? `Recordatorio en ${formatearRestante(fila.resumen.proximo.restanteMs)}`
                                        : fila.evento ? "Ninguno pendiente" : "Sin sorteo"}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Último enviado</dt>
                    <dd>
                        {fila?.resumen.ultimoEnviado
                            ? `${fila.resumen.ultimoEnviado.tipo} · ${formatearHace(fila.resumen.ultimoEnviado.en, ahora)}`
                            : fila?.evento ? "Ninguno en este sorteo" : "—"}
                    </dd>
                </div>
                <div className={styles.dato}>
                    <dt>Sticker de pago</dt>
                    <dd>{sticker}</dd>
                </div>
            </dl>

            {fila?.recordatorios.some((r) => r.resultado.estado === "error") && (
                <p className={styles.alertaError}><AlertTriangle size={13} /> Hubo un error de envío en este sorteo. Consulta la actividad.</p>
            )}
            {fila?.sesionNoActiva && (
                <p className={styles.alerta}><AlertTriangle size={13} /> El sorteo está en un WhatsApp que no está en servicio: sus mensajes no saldrán.</p>
            )}
            {activa && grupo.estadoAutorizacion !== "autorizado" && (
                <p className={styles.alerta}><AlertTriangle size={13} /> Automatización activa, pero el grupo no está autorizado: no enviará mensajes.</p>
            )}

            <div className={styles.cardAcciones}>

                {grupo.estadoAutorizacion === "no_autorizado" && (
                    <button type="button" className={styles.accionPrincipal} onClick={onAutorizar} disabled={procesando}>
                        <ShieldCheck size={13} /> {procesando ? "Autorizando…" : "Autorizar"}
                    </button>
                )}

                {grupo.estadoAutorizacion === "pausada" && (
                    <button type="button" className={styles.accionPrincipal} onClick={onReactivarAutorizacion} disabled={procesando}>
                        <ShieldCheck size={13} /> {procesando ? "Reactivando…" : "Reactivar autorización"}
                    </button>
                )}

                <button type="button" className={grupo.estadoAutorizacion === "autorizado" ? styles.accionPrincipal : styles.accion} onClick={onConfigurar}>
                    <Settings2 size={13} /> Configurar
                </button>

                <button type="button" className={styles.accion} onClick={onProgramar} title="Programar recordatorios antes del cierre">
                    <CalendarPlus size={13} /> Programar
                </button>

                {fila && (
                    <Link href={`/automatizacion/programacion?vista=actividad&grupo=${encodeURIComponent(fila.config.grupo_id)}`} prefetch={false} className={styles.accion}>
                        <History size={13} /> Actividad
                    </Link>
                )}

                {fila && (
                    <button
                        type="button"
                        className={activa ? styles.accionPeligro : styles.accion}
                        onClick={onAlternarAutomatizacion}
                        disabled={procesando}
                        aria-label={activa ? "Pausar automatización" : "Reactivar automatización"}
                    >
                        {activa ? <><Pause size={13} /> Pausar</> : <><Play size={13} /> Reactivar</>}
                    </button>
                )}

                <Link href={detalle} prefetch={false} className={styles.accion} title="Inicio del día, apertura, recordatorios, cierre y sticker propio">
                    <SlidersHorizontal size={13} /> Detalles
                </Link>

            </div>

            <details className={styles.avanzado}>
                <summary>Detalles avanzados</summary>
                <p>ID de WhatsApp: <span className={styles.mono}>{grupo.grupoId}</span></p>
                {grupo.sesiones.length > 0 && <p>Visto por: {grupo.sesiones.map((s) => s.nombreSesion).join(", ")}</p>}
                {grupo.estadoAutorizacion === "autorizado" && grupo.conexion !== "conectado" && grupo.conexion !== "comprobando" && grupo.autorizacion && (
                    <p>
                        <button type="button" className={styles.accionPeligro} onClick={onDesactivarAutorizacion} disabled={procesando}>
                            Desactivar autorización
                        </button>
                    </p>
                )}
            </details>

        </article>

    );

}
