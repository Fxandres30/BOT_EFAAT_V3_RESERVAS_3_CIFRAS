"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { Badge, Button, Card, EmptyState, type BadgeTone } from "@/components/ui";
import { apiSorteos, describirError, type EstadoGrupo, type EstadoSorteo, type Sorteo } from "@/services/sorteos/apiSorteos";
import { mostrarFecha } from "./fechas";
import styles from "./Sorteos.module.css";

const ESTADO_SORTEO: Record<EstadoSorteo, { texto: string; tono: BadgeTone }> = {
    borrador: { texto: "Borrador (sin confirmar)", tono: "neutral" },
    programado: { texto: "Programado", tono: "primary" },
    publicando: { texto: "Publicando", tono: "warning" },
    publicado: { texto: "Publicado", tono: "success" },
    publicado_parcial: { texto: "Publicado en parte", tono: "warning" },
    fallido: { texto: "Falló", tono: "error" },
    cancelado: { texto: "Cancelado", tono: "neutral" }
};

const ESTADO_GRUPO: Record<EstadoGrupo, { texto: string; tono: BadgeTone }> = {
    pendiente: { texto: "Pendiente", tono: "neutral" },
    publicando: { texto: "Publicando", tono: "warning" },
    publicado: { texto: "Publicado", tono: "success" },
    fallido: { texto: "Reintentando", tono: "warning" },
    requiere_revision: { texto: "Requiere revisión", tono: "error" },
    cancelado: { texto: "Cancelado", tono: "neutral" }
};

// Prefijo del publicador (backend/sorteos/publicador.js) para un grupo que
// espera a que se resuelva un conflicto real (p. ej. el sorteo actual sigue
// abierto): no está perdido, se publicará en cuanto se pueda.
const EN_ESPERA = "En espera: ";

// Un sorteo se puede editar mientras no se haya publicado en ningún grupo.
// Compartido con el botón «Editar» de /tablas/[precio] (AnuncioSorteoModal).
export function esEditable(s: Sorteo): boolean {
    return (s.estado === "borrador" || s.estado === "programado") && !(s.grupos || []).some(g => g.estado !== "pendiente" && g.estado !== "cancelado");
}

interface Props {
    sorteos: Sorteo[];
    onVistaPrevia: (id: string) => void;
    onEditar: (sorteo: Sorteo) => void;
    onActualizado: () => void;
}

export default function ListaSorteos({ sorteos, onVistaPrevia, onEditar, onActualizado }: Props) {

    const [ocupado, setOcupado] = useState<string | null>(null);
    const [mensaje, setMensaje] = useState<string | null>(null);

    async function ejecutar(clave: string, accion: () => Promise<{ ok: boolean; aviso?: string; motivo?: string; error?: string }>) {
        setOcupado(clave);
        setMensaje(null);
        const r = await accion();
        setOcupado(null);
        if (!r.ok) setMensaje(describirError(r as { motivo: string; error?: string }));
        else if (r.aviso) setMensaje(r.aviso);
        onActualizado();
    }

    if (!sorteos.length) {
        return <EmptyState icon={<CalendarClock size={28} />} title="No hay sorteos programados" description="Crea uno con «Nuevo sorteo». Los sorteos detectados por el bot siguen apareciendo en Eventos." />;
    }

    return (
        <div className={styles.lista}>

            {mensaje && <p className={`${styles.alerta} ${styles.alertaAviso}`}>{mensaje}</p>}

            {sorteos.map(s => {

                const estado = ESTADO_SORTEO[s.estado];
                const editable = esEditable(s);
                const cancelable = s.estado === "borrador" || s.estado === "programado" || s.estado === "publicando";

                return (
                    <Card key={s.id} padding="md" className={styles.tarjeta}>

                        <div className={styles.tarjetaCabecera}>
                            <h3 className={styles.tarjetaTitulo}>{s.config.nombre}</h3>
                            <Badge tone={estado.tono} dot>{estado.texto}</Badge>
                        </div>

                        <div className={styles.meta}>
                            <span>Publicación: {mostrarFecha(s.publicar_en)}</span>
                            <span>Sorteo: {s.config.hora_fin} · cierre {s.config.hora_cierre}</span>
                            <span>${Number(s.config.valor).toLocaleString("es-CO")} por número · {s.cantidad_numeros} números</span>
                            <span>Versión {s.version}</span>
                        </div>

                        <ul className={styles.grupos}>
                            {(s.grupos || []).map(g => (
                                <li key={g.id} className={styles.grupo}>
                                    {g.estado === "pendiente" && g.ultimo_error?.startsWith(EN_ESPERA)
                                        ? <Badge tone="warning" size="sm">En espera</Badge>
                                        : <Badge tone={ESTADO_GRUPO[g.estado].tono} size="sm">{ESTADO_GRUPO[g.estado].texto}</Badge>}
                                    {g.grupo_nombre || g.grupo_id}
                                    {g.ultimo_error && g.estado !== "publicado" && <span className={styles.error}>{g.ultimo_error}</span>}
                                    {g.estado === "requiere_revision" && s.estado !== "cancelado" && (
                                        <Button size="sm" variant="secondary" loading={ocupado === `${s.id}:${g.grupo_id}`}
                                            onClick={() => {
                                                if (window.confirm("Revisa primero el grupo en WhatsApp: si el anuncio ya llegó, reintentar lo publicaría de nuevo. ¿Reintentar?")) {
                                                    ejecutar(`${s.id}:${g.grupo_id}`, () => apiSorteos.reintentarGrupo(s.id, g.grupo_id));
                                                }
                                            }}>
                                            Reintentar
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>

                        <div className={styles.acciones}>
                            <Button size="sm" variant={s.estado === "borrador" ? "primary" : "secondary"} onClick={() => onVistaPrevia(s.id)}>
                                {s.estado === "borrador" ? "Revisar y confirmar" : "Vista previa"}
                            </Button>
                            {editable && <Button size="sm" variant="secondary" onClick={() => onEditar(s)}>Editar</Button>}
                            {cancelable && (
                                <Button size="sm" variant="danger" loading={ocupado === s.id}
                                    onClick={() => {
                                        if (window.confirm("¿Cancelar la programación? Lo ya publicado no se deshace.")) {
                                            ejecutar(s.id, () => apiSorteos.cancelar(s.id));
                                        }
                                    }}>
                                    Cancelar
                                </Button>
                            )}
                        </div>

                    </Card>
                );

            })}

        </div>
    );

}
