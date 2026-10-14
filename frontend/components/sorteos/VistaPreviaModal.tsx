"use client";

import { useEffect, useState } from "react";

import { Modal, Button, Badge } from "@/components/ui";
import { apiSorteos, describirError, type VistaPrevia } from "@/services/sorteos/apiSorteos";
import { mostrarFecha } from "./fechas";
import styles from "./Sorteos.module.css";

interface Props {
    sorteoId: string | null;
    onClose: () => void;
    onConfirmado: () => void;
}

export default function VistaPreviaModal({ sorteoId, onClose, onConfirmado }: Props) {

    const [vista, setVista] = useState<VistaPrevia | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [revisado, setRevisado] = useState(false);
    const [confirmando, setConfirmando] = useState(false);

    // La página remonta este modal (key) por cada sorteo: el estado empieza
    // limpio sin reiniciarlo dentro del efecto.
    useEffect(() => {

        if (!sorteoId) return;

        async function cargar(id: string) {
            const r = await apiSorteos.vistaPrevia(id);
            if (r.ok) setVista(r.data);
            else setError(describirError(r));
        }

        cargar(sorteoId);

    }, [sorteoId]);

    async function confirmar() {

        if (!vista) return;

        setConfirmando(true);
        setError(null);

        const r = await apiSorteos.confirmar(vista.id, vista.version);

        setConfirmando(false);

        if (!r.ok) {
            setError([describirError(r), ...(r.bloqueos || []), ...(r.errores || []).map(e => e.mensaje)].join(" "));
            return;
        }

        onConfirmado();

    }

    return (
        <Modal
            open={!!sorteoId}
            onClose={onClose}
            size="lg"
            title="Vista previa"
            description={vista ? `Se publicará el ${mostrarFecha(vista.publicar_en)} (hora de Colombia).` : undefined}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={confirmando}>Cerrar</Button>
                    {vista?.estado === "borrador" && (
                        <Button onClick={confirmar} loading={confirmando} disabled={!vista.puede_confirmar || !revisado}>
                            Confirmar y programar
                        </Button>
                    )}
                </>
            }
        >
            <div className={styles.stack}>

                {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}
                {!vista && !error && <p className={styles.ayuda}>Cargando vista previa…</p>}

                {vista && (
                    <>
                        {vista.bloqueos.length > 0 && (
                            <div className={`${styles.alerta} ${styles.alertaError}`}>
                                <strong>No se puede programar todavía:</strong>
                                <ul>{vista.bloqueos.map((b, i) => <li key={i}>{b}</li>)}</ul>
                            </div>
                        )}

                        {vista.avisos.length > 0 && (
                            <div className={`${styles.alerta} ${styles.alertaAviso}`}>
                                <ul>{vista.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
                            </div>
                        )}

                        <section className={styles.seccion}>
                            <h3 className={styles.seccionTitulo}>Anuncio que se publicará</h3>
                            <pre className={styles.mensaje}>{vista.publicacion}</pre>
                        </section>

                        {vista.recordatorios.length > 0 && (
                            <section className={styles.seccion}>
                                <h3 className={styles.seccionTitulo}>Recordatorios</h3>
                                {vista.recordatorios.map((r, i) => (
                                    <div key={i}>
                                        <p className={styles.ayuda}>{r.minutos_antes_cierre} min antes del cierre</p>
                                        <pre className={styles.mensaje}>{r.texto}</pre>
                                    </div>
                                ))}
                            </section>
                        )}

                        {vista.aviso_cierre && (
                            <section className={styles.seccion}>
                                <h3 className={styles.seccionTitulo}>Aviso al cerrar</h3>
                                <pre className={styles.mensaje}>{vista.aviso_cierre}</pre>
                            </section>
                        )}

                        <section className={styles.seccion}>
                            <h3 className={styles.seccionTitulo}>Grupos</h3>
                            <ul className={styles.grupos}>
                                {vista.grupos.map(g => (
                                    <li key={g.grupo_id} className={styles.grupo}>
                                        <Badge tone={g.bloqueo ? "error" : "success"} dot>{g.bloqueo ? "Bloqueado" : "Listo"}</Badge>
                                        {g.nombre || g.grupo_id}
                                        {g.bloqueo && <span className={styles.error}>{g.bloqueo}</span>}
                                    </li>
                                ))}
                            </ul>
                        </section>

                        {vista.tabla && (
                            <p className={styles.ayuda}>
                                Tabla de números: {vista.tabla.presentes}/{vista.tabla.esperados} números
                                {vista.tabla.retenidos ? ` · ${vista.tabla.retenidos} bloqueados o en proceso` : ""}
                            </p>
                        )}

                        {vista.estado === "borrador" && vista.puede_confirmar && (
                            <label className={styles.check}>
                                <input type="checkbox" checked={revisado} onChange={e => setRevisado(e.target.checked)} />
                                Revisé el anuncio, la fecha, los grupos, los premios, el valor y las cuentas.
                            </label>
                        )}
                    </>
                )}

            </div>
        </Modal>
    );

}
