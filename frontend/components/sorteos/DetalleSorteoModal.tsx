"use client";

import { useEffect, useState } from "react";

import { Badge, Button, Modal } from "@/components/ui";
import { apiSorteos, describirError, type DetalleSorteo } from "@/services/sorteos/apiSorteos";
import { ESTADO_PROGRAMACION, etiquetaGrupo, etiquetaOperativo, textoReservas } from "@/services/sorteos/estadosSorteo";
import { mostrarFecha } from "./fechas";
import styles from "./Sorteos.module.css";

interface Props {
    sorteoId: string;
    onClose: () => void;
}

const EVENTO: Record<DetalleSorteo["gestion"]["grupos"][number]["evento"], string> = {
    sin_evento: "Sorteo no creado en el grupo",
    abierto: "Sorteo abierto en el grupo",
    cerrado: "Sorteo cerrado en el grupo",
    reutilizado: "El grupo ya pasó a otro sorteo"
};

// Qué pasó con la programación y con cada grupo: cuándo se publicó, cuántos
// intentos hubo, qué falló y si hace falta intervenir. Solo lectura.
export default function DetalleSorteoModal({ sorteoId, onClose }: Props) {

    const [detalle, setDetalle] = useState<DetalleSorteo | null>(null);
    const [error, setError] = useState<string | null>(null);

    // La página remonta este modal (key) por cada sorteo.
    useEffect(() => {
        async function cargar() {
            const r = await apiSorteos.detalle(sorteoId);
            if (r.ok) setDetalle(r.data);
            else setError(describirError(r));
        }
        cargar();
    }, [sorteoId]);

    const d = detalle;

    return (
        <Modal open onClose={onClose} title={d ? d.config.nombre : "Detalles de la programación"} size="lg"
            footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
            <div className={styles.stack}>

                {error && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{error}</p>}
                {!d && !error && <p className={styles.ayuda}>Cargando detalles…</p>}

                {d && (
                    <>
                        <section className={styles.seccion} aria-label="Estados">
                            <h3 className={styles.seccionTitulo}>Estados</h3>
                            <div className={styles.insignias}>
                                <Badge tone={ESTADO_PROGRAMACION[d.estado].tono} dot>Programación: {ESTADO_PROGRAMACION[d.estado].texto}</Badge>
                                <Badge tone={etiquetaOperativo(d).tono}>{etiquetaOperativo(d).texto}</Badge>
                                {d.gestion.necesita_intervencion && <Badge tone="error">Requiere tu intervención</Badge>}
                                {d.gestion.archivado_en && <Badge tone="neutral">Archivada el {mostrarFecha(d.gestion.archivado_en)}</Badge>}
                            </div>
                            <p className={styles.ayuda}>{d.gestion.operativo.detalle}</p>
                            {d.gestion.ultimo_error && <p className={styles.error}>{d.gestion.ultimo_error}</p>}
                        </section>

                        <section className={styles.seccion} aria-label="Datos">
                            <h3 className={styles.seccionTitulo}>Datos</h3>
                            <dl className={styles.datos}>
                                <dt>Publicación</dt><dd>{mostrarFecha(d.publicar_en)}</dd>
                                <dt>Sorteo</dt><dd>{d.config.fecha_sorteo ? `${d.config.fecha_sorteo.split("-").reverse().join("/")} ` : ""}{d.config.hora_fin}</dd>
                                <dt>Cierre de reservas</dt><dd>{d.config.hora_cierre || "—"}</dd>
                                <dt>Precio y números</dt><dd>${Number(d.config.valor).toLocaleString("es-CO")} · {d.cantidad_numeros} números</dd>
                                <dt>Versión</dt><dd>{d.version}{d.confirmado_version ? ` (confirmada la ${d.confirmado_version}${d.confirmado_en ? `, ${mostrarFecha(d.confirmado_en)}` : ""})` : " (sin confirmar)"}</dd>
                                <dt>Reservas</dt><dd>{textoReservas(d) || "Ninguna"}</dd>
                                <dt>Intentos de publicación</dt><dd>{d.gestion.impacto.intentos}{d.gestion.impacto.reintentos_manuales ? ` · ${d.gestion.impacto.reintentos_manuales} reintento(s) manual(es)` : ""}</dd>
                                <dt>Última actualización</dt><dd>{mostrarFecha(d.gestion.ultima_actualizacion)}</dd>
                            </dl>
                        </section>

                        <section className={styles.seccion} aria-label="Grupos">
                            <h3 className={styles.seccionTitulo}>Grupos</h3>
                            <ul className={styles.grupos}>
                                {d.gestion.grupos.map(g => {
                                    const etiqueta = etiquetaGrupo(g);
                                    return (
                                        <li key={g.id} className={styles.grupoDetalle}>
                                            <div className={styles.grupo}>
                                                <Badge tone={etiqueta.tono} size="sm">{etiqueta.texto}</Badge>
                                                <strong>{g.nombre || g.grupo_id}</strong>
                                                <span className={styles.ayuda}>{EVENTO[g.evento]}</span>
                                            </div>
                                            <p className={styles.ayuda}>{g.explicacion}</p>
                                            {g.resumen && <p className={styles.ayuda}>{g.resumen}</p>}
                                            <p className={styles.ayuda}>
                                                Intentos: {g.intentos}{g.reintentos_manuales ? ` · reintentos manuales: ${g.reintentos_manuales}` : ""}
                                                {g.publicado_en ? ` · publicado ${mostrarFecha(g.publicado_en)}` : ""}
                                                {g.actualizado_en ? ` · actualizado ${mostrarFecha(g.actualizado_en)}` : ""}
                                            </p>
                                            {g.intervencion && <p className={styles.error}>{g.intervencion}</p>}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>

                        <section className={styles.seccion} aria-label="Historial">
                            <h3 className={styles.seccionTitulo}>Historial</h3>
                            <ol className={styles.lineaTiempo}>
                                {d.historial.map((h, i) => (
                                    <li key={`${h.en}-${i}`}><span className={styles.ayuda}>{mostrarFecha(h.en)}</span> {h.texto}</li>
                                ))}
                            </ol>
                            {!d.historial_completo && (
                                <p className={styles.ayuda}>El registro de operaciones (cancelar, eliminar, archivar, reintentar) todavía no está activado: se muestran los datos que guarda la programación.</p>
                            )}
                        </section>
                    </>
                )}

            </div>
        </Modal>
    );

}
