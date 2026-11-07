"use client";

import Link from "next/link";
import { Bell, Lock, Pencil, RefreshCw, Rocket, TableProperties, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/Badge";

import { formatHora12 } from "@/lib/formatHora";
import { formatearRestante } from "@/services/automatizacion/estadoProgramacion";
import { listarProgramaciones } from "@/services/automatizacion/centroAutomatizaciones";
import { nombreCategoria } from "@/services/automatizacion/tiposCategorias";
import { estadoTipos } from "@/services/automatizacion/vistaGrupos";

import type { FilaGrupo } from "./filaGrupo";
import type { SeccionEditor } from "./TarjetaGrupo";
import styles from "./CentroAutomatizaciones.module.css";

// Vista del Centro de control organizada por tipo de mensaje automático.
// Solo presenta la configuración real de cada grupo; editar abre el mismo
// editor de siempre (o los Detalles del grupo para la apertura, que el
// editor del Centro no administra).

interface Props {
    filas: FilaGrupo[];
    onEditar: (grupoId: string, seccion: SeccionEditor) => void;
}

interface FilaTipo {
    fila: FilaGrupo;
    activo: boolean;
    detalle: string;
    extra?: string | null;
}

interface Bloque {
    id: string;
    titulo: string;
    descripcion: string;
    icono: LucideIcon;
    seccion: SeccionEditor | "detalles";
    filas: FilaTipo[];
}

function seleccion(categoria: string | null | undefined): string {
    return categoria ? `Mensajes «${nombreCategoria(categoria)}»` : "Cualquier mensaje activo";
}

export default function VistaPorTipo({ filas, onEditar }: Props) {

    const bloques: Bloque[] = [
        {
            id: "apertura",
            titulo: "Aperturas",
            descripcion: "Mensaje que se envía al abrir el grupo para un sorteo.",
            icono: Rocket,
            seccion: "detalles",
            filas: filas.map((f) => ({ fila: f, activo: estadoTipos(f.config).apertura, detalle: seleccion(f.config.mensaje_apertura?.categoria) }))
        },
        {
            id: "recordatorios",
            titulo: "Recordatorios",
            descripcion: "Mensajes programados unos minutos antes del cierre del sorteo.",
            icono: Bell,
            seccion: "programaciones",
            filas: filas.map((f) => {
                const activos = listarProgramaciones(f.config.recordatorios).filter((p) => p.cfg.activo);
                return {
                    fila: f,
                    activo: activos.length > 0,
                    detalle: activos.length === 0 ? "Ninguno activo" : activos.map((p) => `${p.minutos} min`).join(" · ") + " antes del cierre",
                    extra: f.config.activo && f.resumen.proximo?.restanteMs != null ? `Siguiente en ${formatearRestante(f.resumen.proximo.restanteMs)}` : null
                };
            })
        },
        {
            id: "actualizacion",
            titulo: "Actualizaciones",
            descripcion: "Avisos de movimiento cuando entran nuevas reservas.",
            icono: RefreshCw,
            seccion: "reglas",
            filas: filas.map((f) => ({
                fila: f,
                activo: estadoTipos(f.config).actualizacion,
                detalle: seleccion(f.config.mensaje_actualizacion?.categoria),
                extra: `Cada ${f.config.umbral_reservas} reservas nuevas · espera ${f.config.cooldown_minutos} min`
            }))
        },
        {
            id: "cierre",
            titulo: "Cierres",
            descripcion: "Mensaje al confirmarse el cierre real del sorteo.",
            icono: Lock,
            seccion: "reglas",
            filas: filas.map((f) => ({ fila: f, activo: estadoTipos(f.config).cierre, detalle: seleccion(f.config.mensaje_cierre?.categoria) }))
        },
        {
            id: "tabla",
            titulo: "Tabla inicial",
            descripcion: "Publica la tabla del sorteo una vez, a la hora elegida.",
            icono: TableProperties,
            seccion: "tabla",
            filas: filas.map((f) => ({
                fila: f,
                activo: estadoTipos(f.config).tablaInicial,
                detalle: f.config.publicacion_inicial_tabla?.activo ? `A partir de las ${formatHora12(f.config.publicacion_inicial_tabla.hora)}` : "No se publica"
            }))
        }
    ];

    return (

        <div className={styles.porTipo}>

            {bloques.map((b) => {

                const Icono = b.icono;
                const activos = b.filas.filter((x) => x.activo && x.fila.config.activo).length;

                return (

                    <section key={b.id} className={styles.tipoPanel} aria-labelledby={`tipo-${b.id}`}>

                        <header className={styles.tipoPanelCabecera}>
                            <span className={styles.tipoPanelIcono} aria-hidden="true"><Icono size={16} /></span>
                            <div className={styles.tipoPanelTexto}>
                                <h3 id={`tipo-${b.id}`} className={styles.tipoPanelTitulo}>{b.titulo}</h3>
                                <p className={styles.tipoPanelDescripcion}>{b.descripcion}</p>
                            </div>
                            <Badge size="sm" tone={activos > 0 ? "success" : "neutral"}>{activos} de {b.filas.length} activos</Badge>
                        </header>

                        <ul className={styles.tipoLista}>
                            {b.filas.map(({ fila, activo, detalle, extra }) => {

                                const pausadoGeneral = !fila.config.activo;
                                const tono = pausadoGeneral ? "neutral" : activo ? "success" : "neutral";
                                const texto = pausadoGeneral ? "Grupo en pausa" : activo ? "Activo" : "Pausado";

                                return (
                                    <li key={fila.config.grupo_id} className={styles.tipoItem}>
                                        <span className={styles.tipoItemPrincipal}>
                                            <span className={styles.tipoItemNombre} title={fila.nombre}>{fila.nombre}</span>
                                            <span className={styles.tipoItemDetalle}>{detalle}{extra ? ` · ${extra}` : ""}</span>
                                        </span>
                                        <Badge size="sm" tone={tono} dot>{texto}</Badge>
                                        {b.seccion === "detalles" ? (
                                            <Link
                                                href={`/automatizacion/grupos/${encodeURIComponent(fila.config.grupo_id)}`}
                                                prefetch={false}
                                                className={styles.iconoBoton}
                                                title="Configurar en Detalles del grupo"
                                                aria-label={`Configurar ${b.titulo.toLowerCase()} de ${fila.nombre}`}
                                            >
                                                <Pencil size={13} />
                                            </Link>
                                        ) : (
                                            <button
                                                type="button"
                                                className={styles.iconoBoton}
                                                title="Configurar"
                                                aria-label={`Configurar ${b.titulo.toLowerCase()} de ${fila.nombre}`}
                                                onClick={() => onEditar(fila.config.grupo_id, b.seccion as SeccionEditor)}
                                            >
                                                <Pencil size={13} />
                                            </button>
                                        )}
                                    </li>
                                );

                            })}
                        </ul>

                    </section>

                );

            })}

        </div>

    );

}
