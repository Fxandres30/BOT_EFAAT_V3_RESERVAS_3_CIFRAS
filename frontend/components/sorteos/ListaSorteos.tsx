"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { apiSorteos, describirError, type Sorteo, type SorteoGestionado } from "@/services/sorteos/apiSorteos";
import { ESTADO_PROGRAMACION, etiquetaGrupo, etiquetaOperativo, textoCancelacion, textoReservas } from "@/services/sorteos/estadosSorteo";
import { mostrarFecha } from "./fechas";
import styles from "./Sorteos.module.css";

// Un sorteo se puede editar mientras no se haya publicado en ningún grupo.
// Compartido con el botón «Editar» de /tablas/[precio] (AnuncioSorteoModal).
export function esEditable(s: Sorteo): boolean {
    return (s.estado === "borrador" || s.estado === "programado") && !(s.grupos || []).some(g => g.estado !== "pendiente" && g.estado !== "cancelado");
}

const fechaLegible = (yyyyMmDd?: string | null) => (yyyyMmDd ? yyyyMmDd.split("-").reverse().join("/") : null);

interface Props {
    sorteos: SorteoGestionado[];
    onVistaPrevia: (id: string) => void;
    onEditar: (sorteo: Sorteo) => void;
    onDetalle: (id: string) => void;
    onEliminar: (sorteo: SorteoGestionado) => void;
    onActualizado: () => void;
    /** Lista de archivados: textos del estado vacío. */
    archivados?: boolean;
}

// Cada tarjeta muestra los tres estados (programación, operativo y por
// grupo) y SOLO las acciones que el backend permite en ese estado; el
// backend las vuelve a validar.
export default function ListaSorteos({ sorteos, onVistaPrevia, onEditar, onDetalle, onEliminar, onActualizado, archivados = false }: Props) {

    const [ocupado, setOcupado] = useState<string | null>(null);
    const [mensaje, setMensaje] = useState<string | null>(null);

    async function ejecutar(clave: string, accion: () => Promise<{ ok: boolean; aviso?: string; motivo?: string; error?: string; mensaje?: string }>) {
        // Doble clic: mientras una acción está en curso no se lanza otra.
        if (ocupado) return;
        setOcupado(clave);
        setMensaje(null);
        const r = await accion();
        setOcupado(null);
        if (!r.ok) setMensaje(describirError(r as { motivo: string; error?: string; mensaje?: string }));
        else if (r.aviso) setMensaje(r.aviso);
        onActualizado();
    }

    if (!sorteos.length) {
        return archivados
            ? <EmptyState icon={<CalendarClock size={28} />} title="No hay programaciones archivadas" description="Las que archives aparecerán aquí; se pueden restaurar." />
            : <EmptyState icon={<CalendarClock size={28} />} title="No hay sorteos programados" description="Crea uno con «Nuevo sorteo». Los sorteos detectados en los grupos siguen apareciendo en Eventos." />;
    }

    return (
        <div className={styles.lista}>

            {mensaje && <p className={`${styles.alerta} ${styles.alertaAviso}`} role="status">{mensaje}</p>}

            {sorteos.map(s => {

                const g = s.gestion;
                const programacion = ESTADO_PROGRAMACION[s.estado];
                const operativo = etiquetaOperativo(s);
                const reservas = textoReservas(s);
                const ocupada = ocupado?.startsWith(s.id) ?? false;

                return (
                    <Card key={s.id} padding="md" className={styles.tarjeta}>

                        <div className={styles.tarjetaCabecera}>
                            <h3 className={styles.tarjetaTitulo}>{s.config.nombre}</h3>
                            <div className={styles.insignias}>
                                <Badge tone={programacion.tono} dot title="Estado de la programación">{programacion.texto}</Badge>
                                <Badge tone={operativo.tono} title="Estado del sorteo en los grupos">{operativo.texto}</Badge>
                                {g.necesita_intervencion && <Badge tone="error">Requiere tu intervención</Badge>}
                                {g.archivado_en && <Badge tone="neutral">Archivada</Badge>}
                            </div>
                        </div>

                        <div className={styles.meta}>
                            <span>Publicación: {mostrarFecha(s.publicar_en)}</span>
                            <span>Sorteo: {fechaLegible(s.config.fecha_sorteo) ? `${fechaLegible(s.config.fecha_sorteo)} ` : ""}{s.config.hora_fin} · cierre {s.config.hora_cierre || "—"}</span>
                            <span>${Number(s.config.valor).toLocaleString("es-CO")} por número · {s.cantidad_numeros} números</span>
                            <span>Versión {s.version}{s.confirmado_version === s.version ? " (confirmada)" : s.estado === "borrador" ? " (sin confirmar)" : ""}</span>
                            {g.ultima_actualizacion && <span>Actualizado: {mostrarFecha(g.ultima_actualizacion)}</span>}
                        </div>

                        <p className={styles.ayuda}>{g.operativo.detalle}{reservas ? ` Reservas: ${reservas}.` : ""}</p>

                        {g.ultimo_error && <p className={styles.error}>{g.ultimo_error}</p>}

                        <ul className={styles.grupos}>
                            {g.grupos.map(gr => {
                                const etiqueta = etiquetaGrupo(gr);
                                return (
                                    <li key={gr.id} className={styles.grupo}>
                                        <Badge tone={etiqueta.tono} size="sm">{etiqueta.texto}</Badge>
                                        {gr.nombre || gr.grupo_id}
                                        {gr.intentos > 1 && <span className={styles.ayuda}>{gr.intentos} intentos</span>}
                                        {gr.estado !== "publicado" && gr.estado !== "pendiente" && gr.ultimo_error && <span className={styles.error}>{gr.ultimo_error}</span>}
                                        {gr.en_espera && <span className={styles.ayuda}>{gr.explicacion}</span>}
                                        {gr.intervencion && <span className={styles.error}>{gr.intervencion}</span>}
                                        {gr.puede_reintentar && (
                                            <Button size="sm" variant="secondary" loading={ocupado === `${s.id}:${gr.grupo_id}`} disabled={!!ocupado}
                                                onClick={() => {
                                                    if (window.confirm("Revisa primero el grupo en WhatsApp: si el anuncio ya llegó, reintentar lo publicaría de nuevo. ¿Reintentar?")) {
                                                        ejecutar(`${s.id}:${gr.grupo_id}`, () => apiSorteos.reintentarGrupo(s.id, gr.grupo_id));
                                                    }
                                                }}>
                                                Reintentar
                                            </Button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>

                        <div className={styles.acciones}>
                            <Button size="sm" variant="secondary" onClick={() => onDetalle(s.id)}>Detalles e historial</Button>
                            {g.acciones.confirmar
                                ? <Button size="sm" variant="primary" onClick={() => onVistaPrevia(s.id)}>Revisar y confirmar</Button>
                                : <Button size="sm" variant="ghost" onClick={() => onVistaPrevia(s.id)}>Vista previa</Button>}
                            {g.acciones.editar && <Button size="sm" variant="secondary" onClick={() => onEditar(s)}>Editar</Button>}
                            {g.acciones.cancelar && (
                                <Button size="sm" variant="danger" loading={ocupado === `${s.id}:cancelar`} disabled={!!ocupado && !ocupada}
                                    onClick={() => {
                                        if (window.confirm(textoCancelacion(s))) ejecutar(`${s.id}:cancelar`, () => apiSorteos.cancelar(s.id));
                                    }}>
                                    Cancelar programación
                                </Button>
                            )}
                            {g.acciones.archivar && (
                                <Button size="sm" variant="ghost" loading={ocupado === `${s.id}:archivar`} disabled={!!ocupado}
                                    onClick={() => ejecutar(`${s.id}:archivar`, () => apiSorteos.archivar(s.id, true))}>
                                    Archivar
                                </Button>
                            )}
                            {g.acciones.restaurar && (
                                <Button size="sm" variant="secondary" loading={ocupado === `${s.id}:restaurar`} disabled={!!ocupado}
                                    onClick={() => ejecutar(`${s.id}:restaurar`, () => apiSorteos.archivar(s.id, false))}>
                                    Restaurar
                                </Button>
                            )}
                            {/* Siempre visible fuera del archivo: el modal muestra el impacto
                                y, si no se puede borrar, por qué y la alternativa segura. */}
                            {!g.archivado_en && (
                                <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => onEliminar(s)}>Eliminar…</Button>
                            )}
                        </div>

                    </Card>
                );

            })}

        </div>
    );

}
