"use client";

import { useState } from "react";

import { Button, Modal } from "@/components/ui";
import { apiSorteos, describirError, type SorteoGestionado } from "@/services/sorteos/apiSorteos";
import { resumenEliminacion, textoCancelacion } from "@/services/sorteos/estadosSorteo";
import { mostrarFecha } from "./fechas";
import styles from "./Sorteos.module.css";

interface Props {
    sorteo: SorteoGestionado;
    onClose: () => void;
    /** Operación hecha (eliminada, cancelada o archivada): mensaje para la lista. */
    onHecho: (mensaje: string | null) => void;
}

// Confirmación de «Eliminar»: muestra SIEMPRE el sorteo, los grupos, lo
// publicado y las reservas. Si tiene actividad no se borra: explica por qué
// y ofrece la acción segura (cancelar o archivar). El backend vuelve a
// comprobarlo todo con la versión que se ve aquí.
export default function EliminarSorteoModal({ sorteo, onClose, onHecho }: Props) {

    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const r = resumenEliminacion(sorteo);

    async function ejecutar(accion: () => Promise<{ ok: boolean; aviso?: string; motivo?: string; mensaje?: string }>, exito: string) {
        if (ocupado) return;
        setOcupado(true);
        setError(null);
        const res = await accion();
        setOcupado(false);
        if (!res.ok) { setError(describirError(res as { motivo: string; mensaje?: string })); return; }
        onHecho(res.aviso || exito);
    }

    return (
        <Modal
            open
            onClose={() => { if (!ocupado) onClose(); }}
            title={r.posible ? "Eliminar programación" : "Esta programación no se puede eliminar"}
            size="md"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={ocupado}>Volver</Button>
                    {r.posible && (
                        <Button variant="danger" loading={ocupado} onClick={() => ejecutar(() => apiSorteos.eliminar(sorteo.id, sorteo.version), "Programación eliminada.")}>
                            Eliminar definitivamente
                        </Button>
                    )}
                    {!r.posible && r.alternativa === "cancelar" && (
                        <Button variant="danger" loading={ocupado} onClick={() => {
                            if (window.confirm(textoCancelacion(sorteo))) ejecutar(() => apiSorteos.cancelar(sorteo.id), "Programación cancelada.");
                        }}>
                            Cancelar programación
                        </Button>
                    )}
                    {!r.posible && r.alternativa === "archivar" && (
                        <Button loading={ocupado} onClick={() => ejecutar(() => apiSorteos.archivar(sorteo.id, true), "Programación archivada.")}>
                            Archivar
                        </Button>
                    )}
                </>
            }
        >
            <div className={styles.stack}>

                {error && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{error}</p>}

                <section className={styles.seccion} aria-label="Sorteo">
                    <h3 className={styles.seccionTitulo}>{r.nombre}</h3>
                    <p className={styles.ayuda}>Publicación: {mostrarFecha(sorteo.publicar_en)} · versión {sorteo.version}</p>
                </section>

                <section className={styles.seccion} aria-label="Grupos afectados">
                    <h3 className={styles.seccionTitulo}>Grupos ({r.grupos.length}) · publicaciones realizadas: {r.publicaciones}</h3>
                    <ul className={styles.grupos}>
                        {r.grupos.map(g => (
                            <li key={g.nombre} className={styles.grupo}>
                                {g.nombre} — {g.estado}{g.publicado_en ? ` (publicado ${mostrarFecha(g.publicado_en)})` : ""}
                            </li>
                        ))}
                    </ul>
                </section>

                <section className={styles.seccion} aria-label="Reservas relacionadas">
                    <h3 className={styles.seccionTitulo}>Reservas relacionadas</h3>
                    <p className={styles.ayuda}>{r.reservas || "Ninguna."}</p>
                </section>

                {!r.posible && (
                    <div className={`${styles.alerta} ${styles.alertaAviso}`} role="status">
                        <p>No se elimina porque:</p>
                        <ul>{r.bloqueos.map(b => <li key={b}>{b}</li>)}</ul>
                    </div>
                )}

                <p className={`${styles.alerta} ${r.posible ? styles.alertaError : styles.alertaInfo}`}>{r.consecuencia}</p>

            </div>
        </Modal>
    );

}
