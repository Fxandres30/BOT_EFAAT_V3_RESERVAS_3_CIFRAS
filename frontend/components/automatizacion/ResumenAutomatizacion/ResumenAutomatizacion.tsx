"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Info, PauseCircle, PlayCircle, RefreshCw, Send, ShieldCheck, Wifi } from "lucide-react";

import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

import { formatearMomento } from "@/services/automatizacion/estadoProgramacion";
import { avisosAutomatizacion, proximosEnvios, resumirVista } from "@/services/automatizacion/vistaGrupos";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";
import { useEstadoAutomatizacion } from "../compartido/useEstadoAutomatizacion";
import StickerPagoResumen from "../compartido/StickerPagoResumen";
import { horaLegible, restanteCorto } from "../compartido/estados";
import styles from "../compartido/Automatizacion.module.css";

// Resumen de Automatización: solo indicadores reales (autorizaciones,
// conexión en vivo, configuración y seguimiento de envíos). Lo que aún no
// se pudo consultar se muestra como «…» o «—», nunca como 0.
export default function ResumenAutomatizacion() {

    const estado = useEstadoAutomatizacion();
    const { usuarioId, cargando, error, grupos, filas, sesiones, seguimiento, seguimientoFallo, ahora } = estado;

    const resumen = resumirVista(grupos, !!seguimiento);
    const avisos = avisosAutomatizacion(grupos, sesiones);
    const proximos = proximosEnvios(filas, 6);

    // Sorteos en curso con cierre conocido, para el bloque de actividad.
    const enCurso = filas
        .filter((f) => f.evento)
        .sort((a, b) => (a.cierre?.getTime() ?? Infinity) - (b.cierre?.getTime() ?? Infinity))
        .slice(0, 6);

    return (

        <div className={styles.page}>

            <AutomatizacionHeader
                title="Resumen"
                actions={usuarioId && (
                    <Button size="sm" variant="secondary" onClick={() => estado.recargar()} loading={estado.actualizando} disabled={estado.actualizando}>
                        <RefreshCw size={13} /> Actualizar
                    </Button>
                )}
            />

            {cargando ? (

                <div className={styles.state}>Cargando resumen…</div>

            ) : !usuarioId ? (

                <div className={styles.state}>Debes iniciar sesión para ver Automatización.</div>

            ) : (

                <>

                    {error && (
                        <p className={styles.avisoError}><AlertTriangle size={15} /> <span className={styles.avisoTexto}>{error}</span></p>
                    )}

                    <div className={styles.kpis6}>
                        <StatCard
                            label="Grupos autorizados"
                            value={resumen.autorizados}
                            icon={<ShieldCheck size={16} />}
                            hint={resumen.autorizacionesPausadas > 0 ? `${resumen.autorizacionesPausadas} con autorización pausada` : "Pueden recibir mensajes automáticos"}
                        />
                        <StatCard
                            label="Grupos conectados"
                            value={resumen.autorizadosConectados ?? "…"}
                            tone={resumen.autorizadosConectados === null ? "default" : resumen.autorizadosConectados < resumen.autorizados ? "warning" : "success"}
                            icon={<Wifi size={16} />}
                            hint={resumen.autorizadosConectados === null ? "Comprobando tu WhatsApp" : `de ${resumen.autorizados} autorizados · ${resumen.visiblesEnWhatsApp} visibles en tu WhatsApp`}
                        />
                        <StatCard
                            label="Activas"
                            value={resumen.operativas ?? "…"}
                            tone={resumen.operativas ? "primary" : "default"}
                            icon={<PlayCircle size={16} />}
                            hint={resumen.operativas === null
                                ? "Comprobando tu WhatsApp"
                                : resumen.activasSinEnvio
                                    ? `Pueden enviar · ${resumen.activasSinEnvio} más activa${resumen.activasSinEnvio === 1 ? "" : "s"} sin poder enviar`
                                    : "Automatizaciones que pueden enviar"}
                        />
                        <StatCard
                            label="En pausa"
                            value={resumen.pausadas}
                            icon={<PauseCircle size={16} />}
                            hint="Automatizaciones pausadas; su configuración se conserva"
                        />
                        <StatCard
                            label="Mensajes programados"
                            value={resumen.programados}
                            icon={<CalendarClock size={16} />}
                            hint="Recordatorios activos en grupos activos"
                        />
                        <StatCard
                            label="Próximos envíos"
                            value={resumen.pendientes ?? "—"}
                            tone={resumen.pendientes ? "success" : "default"}
                            icon={<Send size={16} />}
                            hint={resumen.pendientes === null
                                ? seguimientoFallo ? "No pudimos consultar los envíos" : "Consultando…"
                                : proximos[0] ? `El siguiente en ${restanteCorto(proximos[0].restanteMs)}` : "Pendientes en los sorteos en curso"}
                        />
                    </div>

                    <section className={styles.avisos} aria-label="Avisos">
                        {sesiones === null ? (
                            <p className={styles.avisoInfo}><Info size={15} /><span className={styles.avisoTexto}>Comprobando la conexión de tu WhatsApp…</span></p>
                        ) : avisos.length === 0 ? (
                            <p className={styles.todoBien}>
                                <CheckCircle2 size={15} />
                                <span className={styles.avisoTexto}><strong>Todo en orden</strong>Tu WhatsApp está conectado y no hay problemas con tus grupos autorizados.</span>
                            </p>
                        ) : avisos.map((a) => (
                            <div key={a.id} className={a.tono === "error" ? styles.avisoError : a.tono === "info" ? styles.avisoInfo : styles.aviso} role={a.tono === "error" ? "alert" : "status"}>
                                {a.tono === "info" ? <Info size={15} /> : <AlertTriangle size={15} />}
                                <span className={styles.avisoTexto}><strong>{a.titulo}</strong>{a.detalle}</span>
                                {a.filtro ? (
                                    <Link href={`/automatizacion/grupos?filtro=${a.filtro}`} prefetch={false} className={styles.avisoAccion}>Ver grupos</Link>
                                ) : a.id.startsWith("errores") || a.id === "sesion-no-activa" ? (
                                    <Link href="/automatizacion/programacion?vista=actividad" prefetch={false} className={styles.avisoAccion}>Ver actividad</Link>
                                ) : a.id.includes("whatsapp") || a.id.includes("desconectada") ? (
                                    <Link href="/sesiones" prefetch={false} className={styles.avisoAccion}>Ir a Sesiones</Link>
                                ) : null}
                            </div>
                        ))}
                    </section>

                    {grupos.length === 0 ? (

                        <EmptyState
                            title="Aún no tienes grupos en Automatización"
                            description="Autoriza un grupo de tu WhatsApp para empezar a enviar mensajes automáticos."
                            action={<Link href="/automatizacion/grupos" prefetch={false} className={styles.accionPrincipal}>Ir a Grupos</Link>}
                        />

                    ) : (

                        <div className={styles.dosColumnas}>

                            <section className={styles.panel} aria-labelledby="titulo-proximos">
                                <div className={styles.panelCabecera}>
                                    <div>
                                        <h2 id="titulo-proximos" className={styles.panelTitulo}><Send size={16} /> Próximos envíos</h2>
                                        <p className={styles.panelDescripcion}>Recordatorios que saldrán en los sorteos en curso.</p>
                                    </div>
                                    <Link href="/automatizacion/programacion" prefetch={false} className={styles.enlace}>Centro de control <ArrowRight size={13} /></Link>
                                </div>
                                {!seguimiento ? (
                                    <p className={styles.vacio}>{seguimientoFallo ? "No pudimos consultar los envíos. No se muestra ningún estado sin confirmar." : "Consultando…"}</p>
                                ) : proximos.length === 0 ? (
                                    <p className={styles.vacio}>No hay recordatorios pendientes ahora. Se programan solos cuando se detecta un sorteo en un grupo con automatización activa.</p>
                                ) : (
                                    <ul className={styles.lista}>
                                        {proximos.map((p) => (
                                            <li key={`${p.grupoId}-${p.offset}`} className={styles.listaFila}>
                                                <span className={styles.listaPrincipal}>
                                                    <span className={styles.listaNombre}>{p.nombre}</span>
                                                    <span className={styles.listaDetalle}>
                                                        Recordatorio {p.offset} min antes del cierre{p.momento ? ` · ${formatearMomento(p.momento, ahora)}` : ""}
                                                    </span>
                                                </span>
                                                <span className={styles.listaValor}>en {restanteCorto(p.restanteMs)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>

                            <div className={styles.page} style={{ gap: 16 }}>

                                <StickerPagoResumen usuarioId={usuarioId} />

                                <section className={styles.panel} aria-labelledby="titulo-sorteos">
                                    <div className={styles.panelCabecera}>
                                        <div>
                                            <h2 id="titulo-sorteos" className={styles.panelTitulo}><CalendarClock size={16} /> Sorteos en curso</h2>
                                            <p className={styles.panelDescripcion}>Detectados en tus grupos con automatización.</p>
                                        </div>
                                    </div>
                                    {!seguimiento ? (
                                        <p className={styles.vacio}>{seguimientoFallo ? "No disponible." : "Consultando…"}</p>
                                    ) : enCurso.length === 0 ? (
                                        <p className={styles.vacio}>Ningún sorteo activo en este momento.</p>
                                    ) : (
                                        <ul className={styles.lista}>
                                            {enCurso.map((f) => (
                                                <li key={f.config.grupo_id} className={styles.listaFila}>
                                                    <span className={styles.listaPrincipal}>
                                                        <span className={styles.listaNombre}>{f.evento?.nombre_evento || "Sorteo sin nombre"}</span>
                                                        <span className={styles.listaDetalle}>{f.nombre}{f.config.activo ? "" : " · Automatización pausada"}</span>
                                                    </span>
                                                    <span className={styles.listaValor}>
                                                        {f.cierre
                                                            ? f.cierre.getTime() > ahora.getTime() ? `cierra en ${restanteCorto(f.cierre.getTime() - ahora.getTime())}` : "cierre alcanzado"
                                                            : f.horaCierre ? `cierra ${horaLegible(f.horaCierre)}` : "sin hora de cierre"}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </section>

                            </div>

                        </div>

                    )}

                </>

            )}

        </div>

    );

}
