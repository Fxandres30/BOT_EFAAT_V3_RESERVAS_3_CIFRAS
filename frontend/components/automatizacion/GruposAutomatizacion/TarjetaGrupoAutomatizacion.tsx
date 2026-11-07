"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarPlus, History, Info, Settings2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/Badge";

import { formatearHace, formatearMomento } from "@/services/automatizacion/estadoProgramacion";
import { estadoTipos, GrupoVista, puedeEnviar, tieneErrorEnvio } from "@/services/automatizacion/vistaGrupos";

import type { FilaGrupo } from "../CentroAutomatizaciones/filaGrupo";
import { AUTOMATIZACION, AUTORIZACION, CONEXION, TIPOS_VISIBLES, horaLegible, restanteCorto } from "../compartido/estados";
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
    const tipos = fila ? estadoTipos(fila.config) : null;
    const activa = grupo.estadoAutomatizacion === "activa";
    const envia = puedeEnviar(grupo);
    const sinConexion = grupo.conexion === "no_visto" || grupo.conexion === "sin_sesion";
    const detalle = `/automatizacion/grupos/${encodeURIComponent(grupo.grupoId)}`;
    const restante = fila?.cierre ? fila.cierre.getTime() - ahora.getTime() : null;

    // Activa en la configuración pero sin poder enviar: se dice claramente.
    const automatizacion = activa && envia === false
        ? { texto: "Activa · no envía", tono: "warning" as const, explicacion: "La automatización está activa, pero este grupo no puede recibir mensajes ahora." }
        : AUTOMATIZACION[grupo.estadoAutomatizacion];

    const sticker = stickerPropio === undefined
        ? "…"
        : stickerPropio
            ? "Propio de este grupo"
            : stickerPropio === null
                ? "—"
                : stickerGeneral === null ? "…" : stickerGeneral ? "Predeterminado" : "Ninguno configurado";

    const proximo = !fila ? "—"
        : !activa ? "En pausa"
            : envia === false ? "No saldrá"
                : !fila.datosDisponibles ? "No disponible"
                    : fila.resumen.proximo && fila.resumen.proximo.restanteMs !== null
                        ? `En ${restanteCorto(fila.resumen.proximo.restanteMs)}`
                        : fila.evento ? "Ninguno pendiente" : "Sin sorteo";

    return (

        <article className={`${styles.card} ${activa || grupo.estadoAutomatizacion === "sin_configurar" ? "" : styles.cardAtenuada}`}>

            <div className={styles.cardTitulo}>
                {grupo.nombre ? (
                    <span className={styles.cardNombre} title={grupo.nombre}>{grupo.nombre}</span>
                ) : (
                    <span className={styles.cardNombreSin}>Nombre desconocido</span>
                )}
                {grupo.nombre && !grupo.nombreConfirmado && <span className={styles.nombreNota}>Último nombre registrado</span>}
                {!grupo.nombre && <span className={styles.nombreNota}>El ID del grupo está en «Detalles avanzados».</span>}
                <div className={styles.badges}>
                    <Badge tone={conexion.tono} size="sm" dot title={conexion.explicacion}>{conexion.texto}</Badge>
                    <Badge tone={autorizacion.tono} size="sm" title={autorizacion.explicacion}>{autorizacion.texto}</Badge>
                    <Badge tone={automatizacion.tono} size="sm" title={automatizacion.explicacion}>{automatizacion.texto}</Badge>
                </div>
            </div>

            {sinConexion && (
                <p className={styles.explicacion}>
                    <Info size={13} aria-hidden="true" />
                    <span>
                        {grupo.conexion === "sin_sesion"
                            ? "Tu WhatsApp no está conectado, así que este grupo no puede recibir mensajes. Reconéctalo en «Sesiones»."
                            : "Tu WhatsApp no ve este grupo: pudo eliminarse o tu número ya no está en él. Mientras tanto no recibirá mensajes; su configuración se conserva."}
                        {grupo.estadoAutorizacion === "no_autorizado" && " Autorizarlo solo guarda el permiso: no lo conecta."}
                    </span>
                </p>
            )}

            {fila && fila.evento && fila.datosDisponibles && (
                <div className={styles.sorteo}>
                    <span className={styles.sorteoNombre}>Sorteo: {fila.evento.nombre_evento || "sin nombre"}</span>
                    <span>
                        {fila.cierre
                            ? <>Cierre {formatearMomento(fila.cierre, ahora)} · {restante !== null && restante > 0 ? `faltan ${restanteCorto(restante)}` : "cierre alcanzado"}</>
                            : fila.horaCierre ? `Cierre ${horaLegible(fila.horaCierre)}` : "Sin hora de cierre registrada"}
                    </span>
                </div>
            )}
            {fila && !fila.datosDisponibles && (
                <div className={styles.sorteo}><span>No pudimos consultar el sorteo de este grupo ahora.</span></div>
            )}
            {fila && fila.datosDisponibles && !fila.evento && (
                <div className={styles.sorteo}><span>Sin sorteo en curso. Los mensajes se programan cuando se detecte el próximo.</span></div>
            )}

            {tipos && (
                <div className={styles.pildoras} aria-label="Mensajes automáticos de este grupo">
                    {TIPOS_VISIBLES.map((t) => (
                        <span
                            key={t.clave}
                            className={`${styles.pildora} ${tipos[t.clave] ? styles.pildoraOn : ""}`}
                            title={`${t.texto}: ${tipos[t.clave] ? "activo" : "pausado"}${!activa ? " (el grupo está en pausa)" : ""}`}
                        >
                            {t.texto} · {tipos[t.clave] ? "activo" : "pausado"}
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
                    <dd>{proximo}</dd>
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

            {tieneErrorEnvio(fila) && (
                <p className={styles.alertaError}><AlertTriangle size={13} /> Hubo un error de envío en este sorteo. Consulta la actividad.</p>
            )}
            {fila?.sesionNoActiva && (
                <p className={styles.alerta}><AlertTriangle size={13} /> El sorteo está en un WhatsApp que no está en servicio: sus mensajes no saldrán.</p>
            )}
            {activa && grupo.estadoAutorizacion !== "autorizado" && (
                <p className={styles.alerta}><AlertTriangle size={13} /> La automatización está activa, pero el grupo no está autorizado: no enviará mensajes.</p>
            )}

            <div className={styles.cardAcciones}>

                {grupo.estadoAutorizacion === "no_autorizado" && (
                    <button type="button" className={sinConexion ? styles.accion : styles.accionPrincipal} onClick={onAutorizar} disabled={procesando}>
                        <ShieldCheck size={13} /> {procesando ? "Autorizando…" : sinConexion ? "Autorizar igualmente" : "Autorizar"}
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

                {grupo.estadoAutorizacion === "autorizado" && (
                    <button type="button" className={styles.accion} onClick={onProgramar} title="Programar recordatorios antes del cierre">
                        <CalendarPlus size={13} /> Programar
                    </button>
                )}

                {fila && grupo.estadoAutorizacion === "autorizado" && (
                    <Link href={`/automatizacion/programacion?vista=actividad&grupo=${encodeURIComponent(fila.config.grupo_id)}`} prefetch={false} className={styles.accion}>
                        <History size={13} /> Actividad
                    </Link>
                )}

            </div>

            <div className={styles.cardPie}>
                {fila ? (
                    <label className={styles.interruptor}>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={activa}
                            className={`${styles.switch} ${activa ? styles.switchOn : ""}`}
                            onClick={onAlternarAutomatizacion}
                            disabled={procesando}
                        />
                        <span>{activa ? "Automatización activa" : "Automatización pausada"}</span>
                    </label>
                ) : (
                    <span className={styles.nota}>Sin automatización configurada</span>
                )}
                <Link href={detalle} prefetch={false} className={styles.enlace}>
                    Detalles <ArrowRight size={13} aria-hidden="true" />
                </Link>
            </div>

            <details className={styles.avanzado}>
                <summary>Detalles avanzados</summary>
                <p>ID de WhatsApp: <span className={styles.mono}>{grupo.grupoId}</span></p>
                {grupo.sesiones.length > 0 && <p>Visto por: {grupo.sesiones.map((s) => s.nombreSesion).join(", ")}</p>}
                {grupo.estadoAutorizacion === "autorizado" && sinConexion && grupo.autorizacion && (
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
